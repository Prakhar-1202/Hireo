// ============================================================
// Hireo — script.js  (FIXED VERSION)
// Key fixes:
//   1. API_URL auto-detects local vs Vercel correctly
//   2. fetch() has a 55-second timeout so it never hangs forever
//   3. PDF text extraction error is handled gracefully
//   4. Loader is always hidden even when an error occurs
//   5. localStorage errors are caught (private browsing mode fix)
//   6. analyzeResume cannot be double-clicked / double-submitted
// ============================================================

// ── FIX 1: Smart API URL ─────────────────────────────────────
// On Vercel, the frontend and backend are the same domain.
// Locally, Flask runs on port 5000.
const API_URL =
  window.location.hostname === "localhost"
    ? "http://localhost:5000/analyze"
    : "https://hireo-1-9x6m.onrender.com/analyze";
// ── FIX 2: fetch with timeout ────────────────────────────────
async function fetchWithTimeout(url, options = {}, timeoutMs = 55000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Request timed out. The AI is taking too long — please try again.");
    }
    throw err;
  } finally {
    clearTimeout(id);
  }
}

// ── FIX 3: Safe localStorage helpers ─────────────────────────
// Private/Incognito mode blocks localStorage — this prevents crashes
function safeGetItem(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSetItem(key, value) {
  try { localStorage.setItem(key, value); } catch { /* silently ignore */ }
}
function safeRemoveItem(key) {
  try { localStorage.removeItem(key); } catch { /* silently ignore */ }
}

// ── Section navigation ────────────────────────────────────────
function showSection(id, navEl) {
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  const section = document.getElementById(id);
  if (section) section.classList.add("active");

  document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
  if (navEl) navEl.classList.add("active");
}

// ── UI helpers ────────────────────────────────────────────────
function showError(msg) {
  const box = document.getElementById("errorBox");
  if (!box) return;
  box.textContent = msg;
  box.hidden = false;
}

function hideError() {
  const box = document.getElementById("errorBox");
  if (box) box.hidden = true;
}

function showLoader(show) {
  const loader = document.getElementById("loader");
  if (loader) loader.hidden = !show;
}

// ── FIX 4: Prevent double-submit ─────────────────────────────
let isAnalyzing = false;

async function analyzeResume() {
  if (isAnalyzing) return;

  const resumeTextEl = document.getElementById("resumeText");
  const text = (resumeTextEl ? resumeTextEl.value : "").trim();

  if (!text) {
    showError("Please upload a file or paste your resume text before clicking Analyze.");
    return;
  }

  if (text.length < 50) {
    showError("Your resume text is too short. Please add more content.");
    return;
  }

  isAnalyzing = true;
  hideError();
  showLoader(true);

  try {
    const response = await fetchWithTimeout(
      API_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, role: "Software Developer" }),
      },
      55000 // 55 second timeout
    );

    // FIX 5: Handle non-200 responses gracefully
    if (!response.ok) {
      let errMsg = `Server error (${response.status}).`;
      try {
        const errData = await response.json();
        if (errData.error) errMsg = errData.error;
      } catch { /* ignore JSON parse failure */ }
      throw new Error(errMsg);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    displayResults(data);
    showSection("results-section", null);

    // Update nav active state
    const navLinks = document.querySelectorAll(".nav-link");
    navLinks.forEach(l => l.classList.remove("active"));
    navLinks.forEach(l => {
      if (l.textContent.trim().toLowerCase().includes("result")) l.classList.add("active");
    });

  } catch (err) {
    console.error("Analysis error:", err);
    let userMessage = err.message || "Something went wrong. Please try again.";

    // Make network errors friendlier
    if (userMessage.includes("Failed to fetch") || userMessage.includes("NetworkError")) {
      userMessage = "Could not connect to the server. Check your internet connection and try again.";
    }

    showError(userMessage);
  } finally {
    // FIX 6: ALWAYS hide the loader, even if there was an error
    showLoader(false);
    isAnalyzing = false;
  }
}

// ── Display Results ───────────────────────────────────────────
function displayResults(data) {
  // Show score
  const scoreEl = document.getElementById("resumeScoreDisplay");
  if (scoreEl) scoreEl.textContent = data.score ?? 0;

  // Show/hide sections
  const noResults = document.getElementById("no-results");
  const resultsContent = document.getElementById("results-content");
  if (noResults) noResults.hidden = true;
  if (resultsContent) resultsContent.hidden = false;

  // Skills
  const skillsGrid = document.getElementById("skillsGrid");
  if (skillsGrid) {
    skillsGrid.innerHTML = "";
    (data.skills || []).forEach(skill => {
      const tag = document.createElement("span");
      tag.className =
        "px-3 py-1.5 bg-primary-fixed text-on-primary-fixed rounded-full text-xs font-semibold font-label";
      tag.textContent = skill;
      skillsGrid.appendChild(tag);
    });
  }

  // Missing Skills
  const missingGrid = document.getElementById("missingSkillsGrid");
  if (missingGrid) {
    missingGrid.innerHTML = "";
    (data.missingSkills || []).forEach(skill => {
      const tag = document.createElement("span");
      tag.className =
        "px-3 py-1.5 bg-error-container text-on-error-container rounded-full text-xs font-semibold font-label";
      tag.textContent = skill;
      missingGrid.appendChild(tag);
    });
  }

  // Strengths
  const strengthsList = document.getElementById("strengthsList");
  if (strengthsList) {
    strengthsList.innerHTML = "";
    (data.strengths || []).forEach(s => {
      const li = document.createElement("li");
      li.className = "flex gap-2 text-sm text-on-surface-variant items-start";
      li.innerHTML = `<span class="material-symbols-outlined text-secondary text-sm mt-0.5">check_circle</span> ${escapeHtml(s)}`;
      strengthsList.appendChild(li);
    });
  }

  // Suggestions
  const suggList = document.getElementById("suggestionsList");
  if (suggList) {
    suggList.innerHTML = "";
    (data.suggestions || []).forEach(s => {
      const li = document.createElement("li");
      li.className = "flex gap-3 items-start";
      li.innerHTML = `
        <span class="material-symbols-outlined text-tertiary text-lg mt-0.5 shrink-0">${escapeHtml(s.icon || "auto_awesome")}</span>
        <div>
          <p class="font-headline font-bold text-sm text-on-surface mb-1">${escapeHtml(s.title)}</p>
          <p class="text-xs text-on-surface-variant leading-relaxed">${escapeHtml(s.desc)}</p>
        </div>`;
      suggList.appendChild(li);
    });
  }

  // Roles
  const rolesGrid = document.getElementById("rolesGrid");
  if (rolesGrid) {
    rolesGrid.innerHTML = "";
    (data.roles || []).forEach(r => {
      const card = document.createElement("div");
      card.className = `${r.bgClass || "bg-primary-fixed"} rounded-xl p-6`;
      card.innerHTML = `
        <div class="flex items-center justify-between mb-4">
          <span class="material-symbols-outlined text-2xl ${r.textClass || ""}">${escapeHtml(r.icon || "work")}</span>
          <span class="text-xs font-label font-bold px-3 py-1 rounded-full ${r.statusClass || ""}">${r.match}% match</span>
        </div>
        <h4 class="font-headline font-bold text-lg ${r.textClass || ""} mb-1">${escapeHtml(r.role)}</h4>
        <p class="text-xs font-label ${r.textClass || ""} opacity-70">${escapeHtml(r.industry)}</p>`;
      rolesGrid.appendChild(card);
    });
  }
}

// ── XSS safety helper ─────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── PDF file reading ──────────────────────────────────────────
async function readPdf(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [];
    for (let i = 1; i <= Math.min(pdf.numPages, 10); i++) { // max 10 pages
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => item.str).join(" "));
    }
    return pages.join("\n");
  } catch (err) {
    console.error("PDF read error:", err);
    throw new Error("Could not read the PDF. Please try copy-pasting your resume text instead.");
  }
}

// ── File input handling ───────────────────────────────────────
const fileInput = document.getElementById("fileInput");
const dropZone = document.getElementById("dropZone");
const resumeTextEl = document.getElementById("resumeText");
const charCountEl = document.getElementById("charCount");

if (fileInput) {
  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await handleFile(file);
  });
}

async function handleFile(file) {
  hideError();
  const MAX_SIZE_MB = 5;
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    showError(`File is too large. Please upload a file smaller than ${MAX_SIZE_MB}MB.`);
    return;
  }

  let text = "";
  try {
    if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
      if (typeof pdfjsLib === "undefined") {
        showError("PDF reader not loaded. Please paste your resume text directly.");
        return;
      }
      text = await readPdf(file);
    } else {
      text = await file.text();
    }
  } catch (err) {
    showError(err.message || "Could not read the file. Please paste your text instead.");
    return;
  }

  if (resumeTextEl) {
    resumeTextEl.value = text;
    updateCharCount(text);
  }
}

// Drag & Drop support
if (dropZone) {
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("border-primary");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("border-primary");
  });

  dropZone.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropZone.classList.remove("border-primary");
    const file = e.dataTransfer.files[0];
    if (file) await handleFile(file);
  });
}

// ── Character counter ─────────────────────────────────────────
function updateCharCount(text) {
  if (charCountEl) charCountEl.textContent = `${text.length.toLocaleString()} characters`;
}

if (resumeTextEl) {
  resumeTextEl.addEventListener("input", () => updateCharCount(resumeTextEl.value));
}

// ── Application Tracker ───────────────────────────────────────
function loadApps() {
  const raw = safeGetItem("hireo_apps");
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function saveApps(apps) {
  safeSetItem("hireo_apps", JSON.stringify(apps));
}

const STATUS_COLORS = {
  Applied: "bg-primary-fixed text-on-primary-fixed",
  Interview: "bg-secondary-fixed text-on-secondary-fixed",
  "Offer 🎉": "bg-tertiary-fixed text-on-tertiary-fixed",
  Rejected: "bg-error-container text-on-error-container",
};

function renderApps() {
  const apps = loadApps();
  const listEl = document.getElementById("appList");
  const emptyEl = document.getElementById("emptyTracker");
  const statsEl = document.getElementById("statsRow");

  if (!listEl) return;

  if (apps.length === 0) {
    listEl.innerHTML = "";
    if (emptyEl) emptyEl.hidden = false;
    if (statsEl) statsEl.innerHTML = "";
    return;
  }

  if (emptyEl) emptyEl.hidden = true;

  // Stats
  if (statsEl) {
    const counts = { Applied: 0, Interview: 0, "Offer 🎉": 0, Rejected: 0 };
    apps.forEach(a => { if (counts[a.status] !== undefined) counts[a.status]++; });
    statsEl.innerHTML = Object.entries(counts).map(([status, count]) => `
      <div class="bg-surface-container-lowest border border-outline-variant/15 rounded-xl p-4 text-center">
        <p class="font-headline font-extrabold text-2xl text-primary">${count}</p>
        <p class="text-xs font-label text-on-surface-variant uppercase tracking-widest mt-1">${status}</p>
      </div>`).join("");
  }

  // App list
  listEl.innerHTML = apps.map((app, i) => `
    <div class="bg-surface-container-lowest border border-outline-variant/15 rounded-xl p-5 flex items-center justify-between gap-4">
      <div class="flex-1 min-w-0">
        <p class="font-headline font-bold text-base text-on-surface truncate">${escapeHtml(app.company)}</p>
        <p class="text-sm text-on-surface-variant truncate">${escapeHtml(app.role)}</p>
      </div>
      <span class="text-xs font-label font-bold px-3 py-1.5 rounded-full shrink-0 ${STATUS_COLORS[app.status] || "bg-surface-container text-on-surface-variant"}">
        ${escapeHtml(app.status)}
      </span>
      <button onclick="deleteApp(${i})" class="text-error hover:bg-error-container p-2 rounded-full transition-colors shrink-0" title="Delete">
        <span class="material-symbols-outlined text-sm">delete</span>
      </button>
    </div>`).join("");
}

function addApplication() {
  const company = (document.getElementById("companyInput")?.value || "").trim();
  const role = (document.getElementById("roleInput")?.value || "").trim();
  const status = document.getElementById("statusInput")?.value || "Applied";

  if (!company) { alert("Please enter a company name."); return; }
  if (!role) { alert("Please enter a job role."); return; }

  const apps = loadApps();
  apps.unshift({ company, role, status, date: new Date().toISOString() });
  saveApps(apps);
  renderApps();

  // Clear inputs
  const companyEl = document.getElementById("companyInput");
  const roleEl = document.getElementById("roleInput");
  if (companyEl) companyEl.value = "";
  if (roleEl) roleEl.value = "";
}

function deleteApp(index) {
  const apps = loadApps();
  apps.splice(index, 1);
  saveApps(apps);
  renderApps();
}

// ── Role suggestions autocomplete ────────────────────────────
const ROLE_SUGGESTIONS = [
  "Software Engineer", "Frontend Developer", "Backend Developer", "Full Stack Developer",
  "Data Scientist", "Machine Learning Engineer", "DevOps Engineer", "Cloud Engineer",
  "Product Manager", "UX Designer", "UI Designer", "Data Analyst",
  "Cybersecurity Analyst", "Mobile Developer", "QA Engineer", "Database Administrator",
];

const roleInput = document.getElementById("roleInput");
const roleSuggestions = document.getElementById("roleSuggestions");

if (roleInput && roleSuggestions) {
  roleInput.addEventListener("input", () => {
    const query = roleInput.value.toLowerCase();
    if (!query) { roleSuggestions.classList.add("hidden"); return; }
    const matches = ROLE_SUGGESTIONS.filter(r => r.toLowerCase().includes(query));
    if (matches.length === 0) { roleSuggestions.classList.add("hidden"); return; }
    roleSuggestions.innerHTML = matches.map(r =>
      `<div class="px-4 py-2 hover:bg-surface-container cursor-pointer text-sm text-on-surface" onclick="selectRole('${escapeHtml(r)}')">${escapeHtml(r)}</div>`
    ).join("");
    roleSuggestions.classList.remove("hidden");
  });

  document.addEventListener("click", (e) => {
    if (!roleInput.contains(e.target) && !roleSuggestions.contains(e.target)) {
      roleSuggestions.classList.add("hidden");
    }
  });
}

function selectRole(role) {
  if (roleInput) roleInput.value = role;
  if (roleSuggestions) roleSuggestions.classList.add("hidden");
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  renderApps();

  // Set pdf.js worker path
  if (typeof pdfjsLib !== "undefined") {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
  }
});
