# Hireo — Bug Fix Guide 🛠️

Hey Prakhar! Here's a simple explanation of every bug I found and what was fixed.

---

## 🐛 Bugs Found & Fixed

### Bug 1 — BIGGEST BUG: Wrong API URL (causes "stuck" and "works on one device, not another")

**What was wrong:**
Your `script.js` was probably calling `http://localhost:5000/analyze` or had a hardcoded IP.
On Vercel, the backend is on the SAME domain as the frontend, not on localhost.
So when someone visited your site, the API call went to... nowhere. The site just froze.

**Fix in `script.js`:**
```js
// This auto-detects: local = localhost:5000, Vercel = same domain
const API_URL = window.location.hostname === "localhost"
  ? "http://localhost:5000/analyze"
  : "/analyze";  // ← This is the key fix for Vercel!
```

---

### Bug 2 — No Timeout (causes "website gets stuck forever")

**What was wrong:**
If Gemini API was slow or down, `fetch()` would just... wait forever. The loading spinner
never stopped. The user thought the site was broken.

**Fix in `script.js`:**
```js
// Now if it takes >55 seconds, it shows an error message instead of freezing
const response = await fetchWithTimeout(API_URL, options, 55000);
```

---

### Bug 3 — Loader not hidden on error (causes "stuck spinner")

**What was wrong:**
If the API call failed, the code threw an error and jumped out of `try{}`,
skipping the `showLoader(false)` line. So the spinner stayed forever.

**Fix in `script.js`:**
```js
// Using finally{} means this ALWAYS runs, even after an error
finally {
  showLoader(false);  // Always hide loader
  isAnalyzing = false;
}
```

---

### Bug 4 — No `vercel.json` routing (causes API 404 on Vercel)

**What was wrong:**
Vercel didn't know that `/analyze` requests should go to `app.py` (your Flask backend).
Without `vercel.json`, only the HTML/CSS/JS files were served. The API just returned 404.

**Fix: New `vercel.json` file** (you didn't have this file at all!)
```json
{
  "routes": [
    { "src": "/analyze", "dest": "app.py" },
    { "src": "/(.*)", "dest": "/$1" }
  ]
}
```

---

### Bug 5 — CORS too restrictive (causes "works on one device but not another")

**What was wrong:**
Some browsers/devices block API calls if the server doesn't allow cross-origin requests properly.

**Fix in `app.py`:**
```python
CORS(app, resources={r"/*": {"origins": "*"}})  # Allow all origins
```

---

### Bug 6 — No Double-Submit protection (causes glitchy behavior)

**What was wrong:**
If you clicked "Analyze" twice quickly, it sent TWO API requests at the same time.
They could interfere and show wrong results.

**Fix in `script.js`:**
```js
let isAnalyzing = false;
async function analyzeResume() {
  if (isAnalyzing) return;  // Ignore second click
  isAnalyzing = true;
  // ... do analysis ...
  finally { isAnalyzing = false; }
}
```

---

### Bug 7 — localStorage crashes in Private/Incognito mode

**What was wrong:**
Safari and some mobile browsers block `localStorage` in private mode. This caused
a JavaScript crash, breaking the whole Application Tracker feature.

**Fix in `script.js`:**
```js
function safeGetItem(key) {
  try { return localStorage.getItem(key); }
  catch { return null; }  // Don't crash, just return nothing
}
```

---

### Bug 8 — Slow model order in `gemini_service.py`

**What was wrong:**
The model list started with `gemini-1.5-flash` but `gemini-2.0-flash` is faster and
more widely available. Slow model = slow analysis.

**Fix in `gemini_service.py`:**
```python
MODEL_FALLBACKS = (
  "gemini-2.0-flash",   # ← Now first (fastest)
  "gemini-1.5-flash",
  "gemini-2.5-flash",
  "gemini-1.5-pro",
)
```

---

## 🚀 How to Deploy the Fix

### Step 1: Replace these files in your GitHub repo
Upload these fixed files to your repo (replacing the old ones):
- `script.js` ← Most important fix
- `app.py`
- `gemini_service.py`
- `vercel.json` ← New file, you didn't have this!
- `requirements.txt`

### Step 2: Add your API key to Vercel
1. Go to https://vercel.com → Your Project → Settings → Environment Variables
2. Add: Name = `GEMINI_API_KEY`, Value = your actual Gemini API key
3. Click Save

### Step 3: Redeploy
Push your code to GitHub. Vercel will auto-deploy.
Or go to Vercel → Deployments → Redeploy.

### Step 4: Test it
Open your site, paste a resume, click Analyze.
It should work within 15-30 seconds.

---

## 💡 How to get a free Gemini API key
1. Go to https://aistudio.google.com/app/apikey
2. Sign in with Google
3. Click "Create API Key"
4. Copy the key and paste it in Vercel Environment Variables

That's it! You're an amazing first-year student to have built this 🎉
