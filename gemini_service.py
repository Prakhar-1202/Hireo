"""
Gemini-powered resume analysis.
FIXED: Better model order, retry on rate limits, cleaner error messages.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any

logger = logging.getLogger(__name__)

# Prefer `google-genai` (newer). Fall back to `google-generativeai` if needed.
try:
    from google import genai as google_genai
    from google.genai import types as genai_types
    HAS_GOOGLE_GENAI = True
except ImportError:
    HAS_GOOGLE_GENAI = False
    google_genai = None
    genai_types = None

if not HAS_GOOGLE_GENAI:
    try:
        import google.generativeai as genai_legacy
    except ImportError:
        genai_legacy = None
else:
    genai_legacy = None

ROLE_CARD_STYLES = (
    {
        "bgClass": "bg-primary-fixed",
        "textClass": "text-on-primary-fixed",
        "statusClass": "bg-surface-container text-primary",
    },
    {
        "bgClass": "bg-secondary-fixed",
        "textClass": "text-on-secondary-fixed",
        "statusClass": "bg-surface-container-highest text-secondary",
    },
    {
        "bgClass": "bg-tertiary-fixed",
        "textClass": "text-on-tertiary-fixed",
        "statusClass": "bg-surface-container text-on-surface-variant",
    },
)

# FIX 1: Put the fastest, most reliable model first
MODEL_FALLBACKS = (
    "gemini-2.0-flash",       # Fastest and most available
    "gemini-1.5-flash",       # Good fallback
    "gemini-2.5-flash",       # Newer but sometimes busy
    "gemini-1.5-pro",         # Slower but high quality
)


class GeminiAnalysisError(Exception):
    """Raised when Gemini fails or returns unusable data."""


def _api_key() -> str:
    key = os.getenv("GEMINI_API_KEY", "").strip()
    if not key:
        raise GeminiAnalysisError(
            "GEMINI_API_KEY is not set. Go to Vercel → Your Project → Settings → "
            "Environment Variables and add GEMINI_API_KEY."
        )
    return key


def _ensure_api_configured() -> None:
    _api_key()
    if not HAS_GOOGLE_GENAI and genai_legacy:
        genai_legacy.configure(api_key=os.getenv("GEMINI_API_KEY", "").strip())


_genai_client: Any = None


def _get_google_genai_client() -> Any:
    global _genai_client
    if _genai_client is None:
        _genai_client = google_genai.Client(api_key=_api_key())
    return _genai_client


def _model_names() -> list[str]:
    custom = os.getenv("GEMINI_MODEL", "").strip()
    if custom:
        return [custom] + [m for m in MODEL_FALLBACKS if m != custom]
    return list(MODEL_FALLBACKS)


def _clip_resume(text: str) -> str:
    # FIX 2: Keep limit reasonable — 8000 chars is ~4 pages, enough for any resume
    max_chars = int(os.getenv("MAX_RESUME_CHARS", "8000"))
    if len(text) <= max_chars:
        return text
    logger.warning("Resume truncated: %s → %s chars", len(text), max_chars)
    return text[:max_chars] + "\n\n[Resume was trimmed because it was too long]"


def _build_prompt(text: str, role: str) -> str:
    text = _clip_resume(text)
    return f"""Analyze this resume for the target role: {role}.

Resume:
{text}

Return ONLY valid JSON (no markdown fences, no commentary) with this exact structure:
{{
  "score": <integer from 0 to 100, overall resume fit for the role>,
  "matchedSkills": [<short skill strings visible or implied in the resume>],
  "missingSkills": [<important skills for this role that the resume lacks>],
  "strengths": [<2-4 concise bullet strings highlighting candidate strengths>],
  "suggestions": [
    {{"title": <short headline>, "desc": <1-2 sentences>, "icon": <Material Symbols icon name>}}
  ],
  "recommendedRoles": [
    {{"role": <job title>, "industry": <short sector label>, "match": <integer 0-100>, "icon": <Material Symbols name>}}
  ]
}}

Rules:
- Keep arrays substantive: skills ≤ 15, missingSkills ≤ 6, suggestions 3-4, recommendedRoles 3.
- Icons must be simple snake_case Material Symbols names (e.g. code, cloud, psychology).
- Score and match values must be integers.
- Do NOT wrap the JSON in markdown code blocks.
"""


def _extract_json_object(raw: str) -> dict[str, Any]:
    raw = raw.strip()
    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
        raw = re.sub(r"\s*```\s*$", "", raw)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        logger.warning("Primary JSON parse failed, trying brace slice: %s", e)
        start = raw.find("{")
        end = raw.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise GeminiAnalysisError("Model did not return valid JSON") from e
        data = json.loads(raw[start: end + 1])

    if not isinstance(data, dict):
        raise GeminiAnalysisError("Model JSON root must be an object")
    return data


def _response_text(response: Any) -> str:
    """Safely read text from a GenerateContentResponse."""
    try:
        t = getattr(response, "text", None)
        if t:
            return str(t).strip()
    except Exception as e:
        logger.debug("response.text unavailable: %s", e)

    chunks: list[str] = []
    for cand in getattr(response, "candidates", None) or []:
        content = getattr(cand, "content", None)
        if not content:
            continue
        for part in getattr(content, "parts", None) or []:
            if getattr(part, "text", None):
                chunks.append(part.text)

    out = "".join(chunks).strip()
    if not out:
        raise GeminiAnalysisError("Empty or blocked model response — try a different resume or check API quotas")
    return out


def _new_sdk_safety() -> list[Any]:
    assert genai_types is not None
    return [
        genai_types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="BLOCK_ONLY_HIGH"),
        genai_types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="BLOCK_ONLY_HIGH"),
        genai_types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="BLOCK_ONLY_HIGH"),
        genai_types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="BLOCK_ONLY_HIGH"),
    ]


def _generate_raw_json_new(model_name: str, prompt: str) -> str:
    assert genai_types is not None
    client = _get_google_genai_client()
    safety = _new_sdk_safety()

    try:
        response = client.models.generate_content(
            model=model_name,
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                temperature=0.3,
                max_output_tokens=2048,  # FIX 3: Reduced from 8192 — resumes don't need that much output
                response_mime_type="application/json",
                safety_settings=safety,
            ),
        )
        return _response_text(response)
    except Exception as e:
        logger.warning("[%s] JSON MIME failed: %s", model_name, e)

    try:
        response = client.models.generate_content(
            model=model_name,
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                temperature=0.3,
                max_output_tokens=2048,
                safety_settings=safety,
            ),
        )
        return _response_text(response)
    except Exception as e:
        logger.warning("[%s] Plain also failed: %s", model_name, e)
        raise GeminiAnalysisError(f"Model {model_name} failed") from e


def _legacy_generation_config(*, json_mode: bool) -> Any:
    assert genai_legacy is not None
    kwargs: dict[str, Any] = {"temperature": 0.3, "max_output_tokens": 2048}
    if json_mode:
        kwargs["response_mime_type"] = "application/json"
    try:
        return genai_legacy.types.GenerationConfig(**kwargs)
    except Exception:
        return kwargs


def _generate_raw_json_legacy(model_name: str, prompt: str) -> str:
    assert genai_legacy is not None
    model = genai_legacy.GenerativeModel(model_name)

    try:
        response = model.generate_content(
            prompt,
            generation_config=_legacy_generation_config(json_mode=True),
        )
        return _response_text(response)
    except Exception as e:
        logger.warning("[%s] JSON MIME (legacy) failed: %s", model_name, e)

    try:
        response = model.generate_content(
            prompt,
            generation_config=_legacy_generation_config(json_mode=False),
        )
        return _response_text(response)
    except Exception as e:
        logger.warning("[%s] Plain (legacy) failed: %s", model_name, e)
        raise GeminiAnalysisError(f"Model {model_name} failed") from e


def _generate_raw_json(model_name: str, prompt: str) -> str:
    if HAS_GOOGLE_GENAI:
        return _generate_raw_json_new(model_name, prompt)
    return _generate_raw_json_legacy(model_name, prompt)


def _normalize_suggestions(items: Any) -> list[dict[str, str]]:
    if not isinstance(items, list):
        return []
    out: list[dict[str, str]] = []
    for item in items:
        if isinstance(item, str):
            out.append({"title": "Suggestion", "desc": item, "icon": "lightbulb"})
            continue
        if isinstance(item, dict):
            out.append({
                "title": str(item.get("title", "Tip")),
                "desc": str(item.get("desc") or item.get("description", "")),
                "icon": str(item.get("icon", "auto_awesome")),
            })
    return out[:6]


def _normalize_roles(items: Any) -> list[dict[str, Any]]:
    if not isinstance(items, list):
        return []
    roles: list[dict[str, Any]] = []
    for i, item in enumerate(items[:6]):
        if not isinstance(item, dict):
            continue
        style = ROLE_CARD_STYLES[i % len(ROLE_CARD_STYLES)]
        try:
            match = int(item.get("match", 0))
        except (TypeError, ValueError):
            match = 0
        match = max(0, min(100, match))
        roles.append({
            "role": str(item.get("role", "Role")),
            "industry": str(item.get("industry", "Technology")),
            "icon": str(item.get("icon", "work")),
            "match": match,
            "status": str(item.get("status", "Recommended")),
            **style,
        })
    return roles


def normalize_gemini_payload(parsed: dict[str, Any]) -> dict[str, Any]:
    """Map Gemini keys to the exact shape expected by script.js displayResults()."""
    skills = parsed.get("matchedSkills") or parsed.get("skills") or []
    if not isinstance(skills, list):
        skills = []
    skills = [str(s) for s in skills if s is not None][:20]

    missing = parsed.get("missingSkills") or []
    if not isinstance(missing, list):
        missing = []
    missing = [str(s) for s in missing if s is not None][:10]

    strengths_raw = parsed.get("strengths") or []
    if not isinstance(strengths_raw, list):
        strengths_raw = []
    strengths = [str(s) for s in strengths_raw if s is not None][:6]

    suggestions = _normalize_suggestions(parsed.get("suggestions"))
    roles = _normalize_roles(parsed.get("recommendedRoles") or parsed.get("roles"))

    try:
        score = int(parsed.get("score", 0))
    except (TypeError, ValueError):
        score = 0
    score = max(0, min(100, score))

    return {
        "score": score,
        "skills": skills,
        "missingSkills": missing,
        "strengths": strengths,
        "suggestions": suggestions,
        "roles": roles,
    }


def analyze_resume_with_gemini(text: str, role: str) -> dict[str, Any]:
    """
    Call Gemini and return a dict ready for the frontend.
    Raises GeminiAnalysisError on all failures.
    """
    _ensure_api_configured()
    prompt = _build_prompt(text, role)
    last_error: Exception | None = None

    for model_name in _model_names():
        try:
            raw = _generate_raw_json(model_name, prompt)
            parsed = _extract_json_object(raw)
            payload = normalize_gemini_payload(parsed)
            logger.info(
                "Gemini OK (%s): score=%s skills=%s roles=%s",
                model_name, payload["score"], len(payload["skills"]), len(payload["roles"]),
            )
            return payload

        except (GeminiAnalysisError, json.JSONDecodeError, ValueError) as e:
            last_error = e
            logger.warning("Model %s failed: %s", model_name, e)
            # FIX 4: Small delay before trying next model to avoid rate-limit cascade
            time.sleep(0.5)
            continue

        except Exception as e:
            last_error = e
            logger.exception("Model %s unexpected error", model_name)
            time.sleep(0.5)
            continue

    raise GeminiAnalysisError("All Gemini models failed") from last_error
