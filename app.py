"""
Flask API for Hireo resume analyzer — Gemini-backed /analyze.
"""

import logging
import os

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

from flask import Flask, jsonify, request
from flask_cors import CORS

from gemini_service import GeminiAnalysisError, analyze_resume_with_gemini

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)


@app.route("/", methods=["GET"])
def home():
    return jsonify({"status": "ok", "message": "Resume analyzer API is running"})


@app.route("/analyze", methods=["POST"])
def analyze():
    """
    POST /analyze
    Body: { "text": "...", "role": "..." }  (legacy: resume_text)
    Returns: { score, skills, missingSkills, strengths, suggestions, roles }
    """
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or data.get("resume_text") or "").strip()
    role = (data.get("role") or "").strip() or "Software Developer"

    logger.info(
        "[analyze] keys=%s text_len=%s role=%s",
        list(data.keys()),
        len(text),
        role[:80] if role else "",
    )

    if not text:
        return jsonify({"error": "Missing 'text' in request body"}), 400
    if len(text) < 50:
        return jsonify({"error": "Resume text is too short. Please provide more content."}), 400

    try:
        payload = analyze_resume_with_gemini(text, role)
    except GeminiAnalysisError as e:
        logger.warning("Gemini analysis failed: %s", e)
        body: dict = {"error": "AI analysis failed"}
        if os.getenv("SHOW_AI_ERROR_DETAIL", "").lower() in ("1", "true", "yes"):
            body["detail"] = str(e)
        return jsonify(body), 502

    logger.info(
        "[analyze] response score=%s skills=%s missing=%s roles=%s",
        payload["score"],
        len(payload["skills"]),
        len(payload["missingSkills"]),
        len(payload["roles"]),
    )
    logger.debug("[analyze] payload=%s", payload)
    return jsonify(payload)


if __name__ == "__main__":
    print("\n✅  Resume analyzer backend (Gemini)")
    print("    pip install -r requirements.txt")
    print("    Set GEMINI_API_KEY (e.g. in .env). Prefer package: google-genai")
    print("    Debug: SHOW_AI_ERROR_DETAIL=1 to include `detail` in 502 JSON")
    print("    API: http://127.0.0.1:5000/analyze\n")
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", "5000")))
