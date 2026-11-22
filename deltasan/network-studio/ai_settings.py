"""Optional server-side model configuration for published networks."""
import json
import os
import re
from pathlib import Path

import httpx
from dotenv import dotenv_values

THEMES = {
    "health": "hospital|health|clinic|patient|medical",
    "agriculture": "agriculture|crop|farmer|irrigation",
    "library": "library|circulation|librarian",
    "education": "school|student|scholarship|education",
    "civic": "government|municipal|citizen|pension|certificate|meeseva|revenue",
}


def setting(name, default=""):
    local = Path(os.getenv("LOCALAPPDATA", "/opt")) / "DeltaSAN/config/.env"
    file = Path(os.getenv("DELTA_AI_ENV", str(local)))
    values = dotenv_values(file, interpolate=False) if file.is_file() else {}
    return values.get(name) or os.getenv(name) or default


def domain_theme(profile):
    description = " ".join(str(profile.get(k, "")) for k in ("name", "description", "org_name"))
    return next((theme for theme, pattern in THEMES.items() if re.search(pattern, description, re.I)), "general")


async def select_theme(profile):
    fallback = domain_theme(profile)
    key = setting("OPENAI_API_KEY")
    if not key:
        return fallback
    options = list(THEMES) + ["general"]
    try:
        async with httpx.AsyncClient(timeout=6) as client:
            result = await client.post("https://api.openai.com/v1/chat/completions", headers={"Authorization":"Bearer "+key},
                json={"model":setting("OPENAI_THEME_MODEL","gpt-4.1-mini"),"messages":[
                    {"role":"system","content":"Pick a visual theme for this deployed agent from: "+", ".join(options)+". Return just the theme identifier."},
                    {"role":"user","content":json.dumps(profile, ensure_ascii=False)}],"max_completion_tokens":20})
            result.raise_for_status()
            theme = result.json()["choices"][0]["message"]["content"].strip().lower()
            return theme if theme in options else fallback
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError, AttributeError):
        return fallback
