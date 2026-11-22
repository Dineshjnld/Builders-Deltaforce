"""Mask known identifier formats before a new customer turn enters the workflow."""
import json
import re
from pathlib import Path

RULES = [(re.compile(pattern, re.I), f"[{kind} removed]")
         for kind, pattern in json.loads(Path(__file__).with_name("privacy_rules.json").read_text())]


def mask_identifiers(text):
    for pattern, replacement in RULES:
        text = pattern.sub(replacement, text)
    return text


def mask_context(value, message_text=False):
    """Keep runtime routing IDs intact when replaying a conversation saved before masking."""
    if isinstance(value, list):
        return [mask_context(item, message_text) for item in value]
    if isinstance(value, dict):
        return {key:mask_context(item, key in {"text","content","message","answer"}) for key,item in value.items()}
    return mask_identifiers(value) if message_text and isinstance(value, str) else value
