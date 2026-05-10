"""
Flask API for Hireo resume analyzer — Gemini-backed /analyze.
FIXED: Added request timeout, better CORS, robust error messages.
"""

import logging
import os
import signal

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

# FIX 1: Allow requests from any origin (fixes "works on one device but not another")
CORS(app, resources={r"/*": {"origins": "*"}})

# FIX 2: Max resume size to prevent slowness from huge uploads
MAX_TEXT_LENGTH = 15000  # ~10 pages of resume text is plenty


class TimeoutError(Exception):
    pass


def timeout_handler(signum, frame):
    raise TimeoutError("Analysis took too long")


@app.route("/", methods=["GET"])
def home():
    return jsonify({"status": "ok", "message": "Hireo Resume Analyzer API is running ✅"})


@app.route("/analyze", methods=["POST"])
def analyze():
    """
    POST /analyze
    Body: { "text": "...", "role": "..." }
    Returns: { score, skills, missingSkills, strengths, suggestions, roles }
    """
    # FIX 3: Handle malformed JSON gracefully
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"error": "Invalid request. Please send JSON data."}), 400

    text = (data.get("text") or data.get("resume_text") or "").strip()
    role = (data.get("role") or "").strip() or "Software Developer"

    logger.info("[analyze] text_len=%s role=%s", len(text), role[:80])

    # FIX 4: Better validation messages
    if not text:
        return jsonify({"error": "No resume text found. Please upload a file or paste your resume."}), 400

    if len(text) < 50:
        return jsonify({"error": "Resume text is too short. Please provide more content."}), 400

    # FIX 5: Trim very long resumes to avoid slowness
    if len(text) > MAX_TEXT_LENGTH:
        logger.warning("Resume trimmed from %s to %s chars", len(text), MAX_TEXT_LENGTH)
        text = text[:MAX_TEXT_LENGTH]

    try:
        # FIX 6: Add a 55-second timeout (Vercel functions time out at 60s)
        # Only works on Linux (Vercel's environment), silently skipped on Windows/Mac
        try:
            signal.signal(signal.SIGALRM, timeout_handler)
            signal.alarm(55)
        except (AttributeError, OSError):
            pass  # Windows doesn't support SIGALRM — that's ok

        payload = analyze_resume_with_gemini(text, role)

        try:
            signal.alarm(0)  # Cancel the alarm
        except (AttributeError, OSError):
            pass

    except TimeoutError:
        logger.warning("Analysis timed out")
        return jsonify({
            "error": "Analysis took too long. Please try again with a shorter resume, or try again in a moment."
        }), 504

    except GeminiAnalysisError as e:
        logger.warning("Gemini analysis failed: %s", e)
        # FIX 7: User-friendly error message
        return jsonify({
            "error": "AI analysis failed. This usually means the Gemini API key is missing or invalid. "
                     "Please check your GEMINI_API_KEY in Vercel environment variables."
        }), 502

    except Exception as e:
        logger.exception("Unexpected error during analysis")
        return jsonify({"error": "An unexpected error occurred. Please try again."}), 500

    logger.info(
        "[analyze] success score=%s skills=%s roles=%s",
        payload["score"],
        len(payload["skills"]),
        len(payload["roles"]),
    )

    return jsonify(payload)


if __name__ == "__main__":
    print("\n✅ Hireo Resume Analyzer Backend")
    print("   Set GEMINI_API_KEY in your .env file")
    print("   API: http://127.0.0.1:5000/analyze\n")
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", "5000")))
