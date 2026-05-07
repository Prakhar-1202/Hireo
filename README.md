# ⚡ AI Job Assistant Lite — Setup Guide

## Folder Structure
```
ai-job-assistant/
├── backend/
│   ├── app.py              ← Flask API (edit skill lists here)
│   └── requirements.txt
└── frontend/
    ├── index.html          ← Original (unchanged)
    ├── style.css           ← Original (unchanged)
    └── script.js           ← Only analyzeResume() updated to use real fetch
```

---

## Run in 3 Steps

### Step 1 — Install Python packages
```bash
cd backend
pip install -r requirements.txt
```

### Step 2 — Start Flask
```bash
python app.py
# You should see: API running at http://localhost:5000
```

### Step 3 — Open the frontend
Open `frontend/index.html` directly in your browser, OR run:
```bash
cd frontend
python -m http.server 8080
# Visit: http://localhost:8080
```

---

## What the API Returns
```json
{
  "score": 72,
  "skills": ["Python", "React.js", "SQL"],
  "missingSkills": ["Docker", "AWS", "CI/CD"],
  "strengths": ["Strong backend experience", "Solid data skills"],
  "suggestions": [
    { "title": "Add quantifiable results", "desc": "...", "icon": "trending_up" }
  ],
  "roles": [
    { "role": "Backend Developer", "industry": "Startups", "match": 85, ... }
  ]
}
```

## Test Resume Text
```
John Doe | Software Engineering Student
Skills: Python, JavaScript, React, SQL, Flask, Git, Docker, HTML, CSS
Projects: Built REST API using Flask, data analysis using Pandas and NumPy.
Improved app performance by 40%. Worked in Agile team using Git and GitHub.
```
