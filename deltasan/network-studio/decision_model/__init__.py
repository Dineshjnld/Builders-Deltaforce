"""Local connector selector. Returns (route, score) and never invokes a tool."""
from functools import lru_cache
import gzip
import json
import math
from pathlib import Path
import re
import unicodedata

ROOT = Path(__file__).resolve().parent
ROUTES = ("gov_services", "gov_weather", "none")
ABSTAIN_SCORE = 0.52

# Routing is advisory. The two government connectors expose read-only operations.
# Direct requests for private records or transactions should be left to the caller.
ACTION = re.compile(
    r"^(?:(?:please|kindly|can you|could you|i want you to) )*"
    r"(?:approve|grant|issue|submit|sign and submit|transfer|pay|cancel|delete|release funds|"
    r"change (?:my|the owner|the assessed)|update (?:my|the register)|share .*private)\b"
)
PRIVATE = re.compile(r"(?:someone else.s|neighbou?r.s|किसी और का|ఆయన ఆధార్).*(?:record|detail|number|login|file|नंबर|నంబర్)|\b(?:otp|password|login credentials)\b")


def features(text):
    normalized = unicodedata.normalize("NFKC", text).casefold()
    words = "".join(c if unicodedata.category(c)[0] in "LMN" else " " for c in normalized).split()
    result = {}
    for w in words:
        result["w:" + w] = 1.0
        padded = "^" + w + "$"
        for n in (3, 4):
            for i in range(len(padded) - n + 1):
                result["c:" + padded[i:i+n]] = 0.24
    for left, right in zip(words, words[1:]):
        result["b:" + left + " " + right] = 0.7
    return result


@lru_cache(maxsize=1)
def _model():
    with gzip.open(ROOT / "router.json.gz", "rt", encoding="utf8") as stream:
        return json.load(stream)


def predict(query):
    """Return a route and its model score. A low-margin suggestion abstains."""
    text = str(query or "")[:12000].strip().casefold()
    if not text or ACTION.search(text) or PRIVATE.search(text):
        return "none", 1.0
    model = _model()
    logits = model["bias"].copy()
    matches = 0
    for token, value in features(text).items():
        weights = model["weights"].get(token)
        if weights is not None:
            matches += 1
            for k, weight in enumerate(weights):
                logits[k] += weight * value
    if matches < 3:
        return "none", 0.0
    maximum = max(logits)
    exp = [math.exp(x - maximum) for x in logits]
    ix = logits.index(maximum)
    score = exp[ix] / sum(exp)
    return (ROUTES[ix] if score >= ABSTAIN_SCORE else "none"), round(score, 4)
