/**
 * AI Job Assistant Lite — Frontend JavaScript
 * Handles: Resume upload, API calls, results display, Job Tracker
 */

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────
const API_URL = "https://hireo-1-9x6m.onrender.com/analyze";

/** Target role for AI analysis (optional #targetRole in HTML overrides). */
const DEFAULT_TARGET_ROLE = "Software Developer";

function getTargetRole() {
  const el = document.getElementById("targetRole");
  const v = el && typeof el.value === "string" ? el.value.trim() : "";
  return v || DEFAULT_TARGET_ROLE;
}

// ─────────────────────────────────────────────
// SECTION NAVIGATION
// ─────────────────────────────────────────────

/**
 * Show a specific section by ID and update active nav link
 * @param {string} sectionId - ID of the section to show
 * @param {HTMLElement} clickedLink - The nav link that was clicked
 */
function showSection(sectionId) {
  // Hide all sections
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));

  // Show target section
  const target = document.getElementById(sectionId);
  if (target) target.classList.add("active");

  // Update active nav links across both desktop and mobile
  document.querySelectorAll(".nav-link").forEach(l => {
    l.classList.remove("active");
  });

  document.querySelectorAll(`[onclick*="${sectionId}"]`).forEach(l => {
    if (l.classList.contains("nav-link")) {
      l.classList.add("active");
    }
  });

  // Special: load tracker when switching to it
  if (sectionId === "tracker-section") renderTracker();

  return false; // prevent default anchor behavior
}

// ─────────────────────────────────────────────
// FILE UPLOAD (Drag & Drop + File Picker)
// ─────────────────────────────────────────────

const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const resumeTextarea = document.getElementById("resumeText");
const charCount = document.getElementById("charCount");

// Update character count as user types
resumeTextarea.addEventListener("input", () => {
  const len = resumeTextarea.value.length;
  charCount.textContent = `${len} character${len !== 1 ? "s" : ""}`;
});

// Drag & Drop events on the drop zone
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

// File input change (the "Choose File" button)
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (file) handleFile(file);
});

/**
 * Read a dropped/selected file and put its text into the textarea
 * Parses PDFs locally using pdf.js
 * @param {File} file
 */
async function handleFile(file) {
  hideError();
  
  if (!file.name.endsWith(".txt") && !file.name.endsWith(".pdf")) {
    showError("Please upload a .txt or .pdf file.");
    return;
  }

  if (file.name.endsWith(".pdf")) {
    try {
      resumeTextarea.value = "Extracting text from PDF, please wait...";
      resumeTextarea.disabled = true;
      
      const pdfjsLib = window['pdfjs-dist/build/pdf'];
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
      
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
      let fullText = "";
      
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(" ");
        fullText += pageText + "\n";
      }
      
      resumeTextarea.value = fullText.trim();
      resumeTextarea.disabled = false;
      resumeTextarea.dispatchEvent(new Event("input")); // update char count
    } catch (e) {
      showError("Failed to extract PDF text natively: " + e.message);
      resumeTextarea.value = "";
      resumeTextarea.disabled = false;
    }
  } else {
    // Standard TXT parsing
    const reader = new FileReader();
    reader.onload = (e) => {
      resumeTextarea.value = e.target.result;
      resumeTextarea.dispatchEvent(new Event("input")); // update char count
    };
    reader.readAsText(file);
  }
}

// ─────────────────────────────────────────────
// RESUME ANALYSIS — Main Feature
// ─────────────────────────────────────────────

/**
 * Send resume text to Flask backend and display results
 */
async function analyzeResume() {
  const text = resumeTextarea.value.trim();

  // Validate input
  if (!text) {
    showError("Please paste your resume text or upload a file first.");
    return;
  }
  if (text.length < 50) {
    showError("Resume text is too short. Please add more content.");
    return;
  }

  // Show loader, hide error
  hideError();
  showLoader(true);

  // ── Real API call to Flask backend ──
  const role = getTargetRole();

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, role }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      if (errData.detail) console.error("Server detail:", errData.detail);
      const msg = errData.error || `Server error ${response.status}`;
      throw new Error(msg);
    }

    const data = await response.json();
    console.log("API response:", data);

    showLoader(false);
    displayResults(data);
    showSection("results-section");

  } catch (err) {
    showLoader(false);
    if (err.message.includes("Failed to fetch") || err.message.includes("NetworkError") || err.message.includes("Load failed")) {
      showError("⚠️ Cannot reach the backend. Make sure Flask is running: python app.py (port 5000)");
    } else if (err.message === "AI analysis failed") {
      showError("AI analysis failed");
    } else {
      showError("Error: " + err.message);
    }
    return;
  }
}

// ─────────────────────────────────────────────
// DISPLAY RESULTS
// ─────────────────────────────────────────────

/**
 * Render the full mock analysis layout
 * @param {object} data 
 */
function displayResults(data) {
  const noResults = document.getElementById("no-results");
  const resultsContent = document.getElementById("results-content");

  noResults.style.display = "none";
  resultsContent.style.display = "block";
  resultsContent.hidden = false; // Cleanup native attribute if present

  const skills = Array.isArray(data.skills) ? data.skills : [];
  const missingSkills = Array.isArray(data.missingSkills) ? data.missingSkills : [];
  const strengths = Array.isArray(data.strengths) ? data.strengths : [];
  const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
  const roles = Array.isArray(data.roles) ? data.roles : [];

  // ── Score ──
  document.getElementById("resumeScoreDisplay").textContent =
    data.score != null ? String(data.score) : "—";

  // ── Skills ──
  const skillsGrid = document.getElementById("skillsGrid");
  skillsGrid.innerHTML = skills.map((skill, i) => 
    `<span class="bg-secondary-container text-on-secondary-container px-4 py-2 rounded-full font-label text-sm font-medium" style="animation-delay: ${i * 0.05}s">${skill}</span>`
  ).join("");

  // ── Missing Skills ──
  const missingGrid = document.getElementById("missingSkillsGrid");
  missingGrid.innerHTML = missingSkills.map((skill, i) => 
    `<span class="bg-error-container/50 text-on-error-container px-3 py-1 rounded-full font-label text-xs font-semibold" style="animation-delay: ${i * 0.05}s">${skill}</span>`
  ).join("");

  // ── Strengths ──
  const strengthsList = document.getElementById("strengthsList");
  strengthsList.innerHTML = strengths.map((str, i) => 
    `<li class="flex items-start gap-2" style="animation-delay: ${i * 0.05}s">
        <span class="material-symbols-outlined text-secondary text-base shrink-0 mt-0.5">check_circle</span>
        <span class="font-body text-sm text-on-surface-variant leading-snug">${str}</span>
    </li>`
  ).join("");

  // ── Suggestions ──
  const suggList = document.getElementById("suggestionsList");
  suggList.innerHTML = suggestions.map((sugg, i) => {
    const icon = (sugg && sugg.icon) ? sugg.icon : "auto_awesome";
    const title = (sugg && sugg.title) ? sugg.title : "Suggestion";
    const desc = (sugg && sugg.desc) ? sugg.desc : "";
    return `<li class="flex gap-4" style="animation-delay: ${i * 0.07}s">
      <div class="flex-shrink-0 w-8 h-8 rounded-full bg-tertiary-fixed flex items-center justify-center">
        <span class="material-symbols-outlined text-on-tertiary-fixed text-sm" data-icon="${icon}">${icon}</span>
      </div>
      <div>
        <h4 class="font-headline font-bold text-sm text-on-surface mb-1">${title}</h4>
        <p class="font-body text-sm text-on-surface-variant leading-relaxed">${desc}</p>
      </div>
    </li>`;
  }).join("");

  // ── Roles ──
  const rolesGrid = document.getElementById("rolesGrid");
  rolesGrid.innerHTML = roles.map((job, i) => {
    const bgClass = job.bgClass || "bg-primary-fixed";
    const textClass = job.textClass || "text-on-primary-fixed";
    const statusClass = job.statusClass || "bg-surface-container text-primary";
    const jRole = job.role || "Role";
    const industry = job.industry || "";
    const icon = job.icon || "work";
    const status = job.status || "Recommended";
    const match = job.match != null ? job.match : "—";
    return `<div class="bg-surface-container-lowest rounded-xl p-6 shadow-[0px_12px_32px_rgba(25,28,29,0.04)] hover:shadow-[0px_16px_40px_rgba(25,28,29,0.08)] transition-all group cursor-pointer" style="animation-delay: ${i * 0.06}s">
      <div class="w-12 h-12 ${bgClass} rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
        <span class="material-symbols-outlined ${textClass}">${icon}</span>
      </div>
      <h4 class="font-headline font-bold text-lg text-on-surface mb-1">${jRole}</h4>
      <p class="font-body text-on-surface-variant text-sm mb-4">${industry}</p>
      <div class="flex items-center gap-2">
        <span class="${statusClass} text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded">${status}</span>
        <span class="text-xs text-outline font-medium">${match}% Match</span>
      </div>
    </div>`;
  }).join("");
}

// ─────────────────────────────────────────────
// LOADER & ERROR HELPERS
// ─────────────────────────────────────────────

function showLoader(visible) {
  document.getElementById("loader").hidden = !visible;
}

function showError(message) {
  const box = document.getElementById("errorBox");
  box.textContent = message;
  box.hidden = false;
}

function hideError() {
  document.getElementById("errorBox").hidden = true;
}

// ─────────────────────────────────────────────
// JOB TRACKER — localStorage based
// ─────────────────────────────────────────────

const STORAGE_KEY = "jobai_applications";

/**
 * Get all applications from localStorage
 * @returns {Array<{id, company, role, status, date}>}
 */
function getApplications() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

/**
 * Save applications array to localStorage
 * @param {Array} apps
 */
function saveApplications(apps) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(apps));
}

/**
 * Add a new application from the form inputs
 */
function addApplication() {
  const company = document.getElementById("companyInput").value.trim();
  const role = document.getElementById("roleInput").value.trim();
  const status = document.getElementById("statusInput").value;

  if (!company) {
    alert("Please enter a company name.");
    document.getElementById("companyInput").focus();
    return;
  }
  if (!role) {
    alert("Please enter a job role.");
    document.getElementById("roleInput").focus();
    return;
  }

  const apps = getApplications();

  // Create new entry
  const newApp = {
    id: Date.now(),                            // unique ID
    company,
    role,
    status,
    date: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
  };

  apps.unshift(newApp); // Add to beginning of list
  saveApplications(apps);

  // Clear form
  document.getElementById("companyInput").value = "";
  document.getElementById("roleInput").value = "";
  document.getElementById("statusInput").value = "Applied";

  // Re-render list
  renderTracker();
}

/**
 * Delete an application by ID
 * @param {number} id
 */
function deleteApplication(id) {
  if (!confirm("Remove this application?")) return;
  const apps = getApplications().filter(a => a.id !== id);
  saveApplications(apps);
  renderTracker();
}

/**
 * Render the stats and applications list
 */
function renderTracker() {
  const apps = getApplications();
  const statsRow = document.getElementById("statsRow");
  const appList = document.getElementById("appList");
  const emptyTracker = document.getElementById("emptyTracker");

  // ── Stats ──
  const counts = {
    Total: apps.length,
    Applied: apps.filter(a => a.status === "Applied").length,
    Interview: apps.filter(a => a.status === "Interview").length,
    Offer: apps.filter(a => a.status === "Offer 🎉" || a.status === "Offer").length,
  };

  const statStyles = {
    Total: "text-on-surface border-outline-variant/10",
    Applied: "text-secondary border-secondary/20",
    Interview: "text-tertiary-container border-tertiary-container/20",
    Offer: "text-primary border-primary/20"
  };

  statsRow.innerHTML = Object.entries(counts).map(([label, num]) => `
    <div class="bg-surface-container-lowest p-6 rounded-xl text-center border shadow-[0px_4px_16px_rgba(25,28,29,0.02)] ${statStyles[label].split(" ")[1]}">
      <div class="font-headline text-3xl font-extrabold mb-1 ${statStyles[label].split(" ")[0]}">${num}</div>
      <div class="text-[10px] font-label uppercase tracking-widest text-on-surface-variant opacity-80">${label}</div>
    </div>
  `).join("");

  // ── Applications List ──
  appList.innerHTML = "";

  if (apps.length === 0) {
    emptyTracker.classList.remove("hidden");
    statsRow.classList.add("hidden");
    return;
  }

  emptyTracker.classList.add("hidden");
  statsRow.classList.remove("hidden");

  apps.forEach(app => {
    const item = document.createElement("div");
    item.className = "app-item";

    // Clean status class (remove emoji for CSS class name)
    const statusClass = app.status.replace(" 🎉", "");

    item.className = "bg-surface-container-lowest p-5 rounded-xl border border-outline-variant/15 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-primary/30 transition-colors shadow-sm";

    let statusBg = "bg-surface-container-high text-on-surface-variant";
    if (statusClass === "Interview") statusBg = "bg-tertiary-container/10 text-tertiary-container";
    if (statusClass === "Offer") statusBg = "bg-primary/10 text-primary";
    if (statusClass === "Rejected") statusBg = "bg-error-container text-on-error-container";

    item.innerHTML = `
      <div class="flex-1 min-w-0">
        <div class="font-headline font-bold text-on-surface truncate pb-1">${escapeHtml(app.company)}</div>
        <div class="text-xs text-on-surface-variant mt-0.5">${escapeHtml(app.role)} <span class="mx-1 opacity-50">•</span> ${app.date}</div>
      </div>
      <div class="flex items-center gap-3 flex-shrink-0">
        <span class="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${statusBg}">${app.status}</span>
        <button class="text-outline hover:text-error transition-colors p-2 rounded-full hover:bg-error/10 active:scale-95 flex items-center justify-center" onclick="deleteApplication(${app.id})" title="Delete">
          <span class="material-symbols-outlined text-[18px]">delete</span>
        </button>
      </div>
    `;
    appList.appendChild(item);
  });
}

/**
 * Escape HTML to prevent XSS from user-typed inputs
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ─────────────────────────────────────────────
// AUTOCOMPLETE SUGGESTIONS
// ─────────────────────────────────────────────

const JOB_ROLES = [
  { title: "Frontend Developer", keywords: ["front", "web", "ui", "react", "angular", "vue"] },
  { title: "Frontend Engineer", keywords: ["front", "web", "ui", "react"] },
  { title: "UI Developer", keywords: ["front", "ui", "web", "interface"] },
  { title: "React Developer", keywords: ["front", "react", "web", "ui"] },
  { title: "Web Developer", keywords: ["front", "web", "full", "stack"] },
  { title: "Backend Developer", keywords: ["back", "server", "node", "python", "java", "api"] },
  { title: "Backend Engineer", keywords: ["back", "server", "api"] },
  { title: "Full Stack Developer", keywords: ["full", "front", "back", "web", "stack"] },
  { title: "Software Engineer", keywords: ["software", "dev", "engineer", "coder"] },
  { title: "Data Scientist", keywords: ["data", "science", "ml", "ai", "python"] },
  { title: "Data Analyst", keywords: ["data", "analytics", "sql"] },
  { title: "Machine Learning Engineer", keywords: ["ml", "ai", "data"] },
  { title: "DevOps Engineer", keywords: ["devops", "cloud", "aws", "docker", "ci", "cd"] },
  { title: "Product Manager", keywords: ["product", "pm", "manager"] },
  { title: "UI/UX Designer", keywords: ["ui", "ux", "design", "figma"] },
  { title: "Mobile Developer", keywords: ["mobile", "ios", "android", "app"] },
  { title: "iOS Developer", keywords: ["mobile", "ios", "apple", "swift"] },
  { title: "Android Developer", keywords: ["mobile", "android", "kotlin"] }
];

const roleInput = document.getElementById("roleInput");
const roleSuggestions = document.getElementById("roleSuggestions");

roleInput.addEventListener("input", () => {
  const query = roleInput.value.toLowerCase().trim();
  roleSuggestions.innerHTML = "";

  if (!query) {
    roleSuggestions.classList.add("hidden");
    return;
  }

  const matches = [];
  for (const role of JOB_ROLES) {
    if (role.title.toLowerCase().includes(query) || role.keywords.some(k => k.includes(query))) {
      matches.push(role.title);
    }
    if (matches.length >= 5) break; // Suggest 5 relevant roles
  }

  if (matches.length === 0) {
    roleSuggestions.classList.add("hidden");
    return;
  }

  matches.forEach(role => {
    const item = document.createElement("div");
    item.className = "px-4 py-2.5 hover:bg-primary/5 cursor-pointer text-on-surface transition-colors border-b border-outline-variant/10 last:border-0";

    // Highlight exact string match if exists seamlessly
    const regex = new RegExp(`(${query})`, "gi");
    item.innerHTML = role.replace(regex, `<span class="font-bold text-primary">$1</span>`);

    item.addEventListener("mousedown", (e) => {
      // mousedown fires before input blur, preventing race conditions
      e.preventDefault();
      roleInput.value = role;
      roleSuggestions.classList.add("hidden");
    });

    roleSuggestions.appendChild(item);
  });

  roleSuggestions.classList.remove("hidden");
});

roleInput.addEventListener("blur", () => {
  roleSuggestions.classList.add("hidden");
});

roleInput.addEventListener("focus", () => {
  if (roleInput.value.trim() && roleSuggestions.children.length > 0) {
    roleSuggestions.classList.remove("hidden");
  }
});

// ─────────────────────────────────────────────
// INIT — Run on page load
// ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Initialize tracker stats (hidden until tracker section is opened)
  renderTracker();

  // Set initial section correctly from nav
  // Nav links logic handled inline directly in HTML via onclick
});
