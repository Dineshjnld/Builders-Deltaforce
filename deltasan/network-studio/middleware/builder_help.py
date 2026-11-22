"""Read-only builder questions. These exchanges never supply a field or confirm a build."""
import json
import re
from difflib import get_close_matches
from functools import lru_cache
from pathlib import Path

QUESTION = re.compile(r"^(?:please\s+)?(?:what|whar|wat|which|why|where|how|who|can (?:you|we|i)|do (?:you|we|i)|does|is (?:there|it)|are (?:there|these)|list|show|tell|explain|suggest|examples?)\b|[?？]|(?:చెప్పు|చెప్పండి|कौन|बताओ|बताइए)|\b(?:cheppu|cheppandi|enti|kya|batao)\b", re.I)
TOPICS = {
    "tools": ("integration", "integrations", "connector", "connectors", "tools", "tool", "mcp", "mcps", "apis"),
    "controls": ("privacy", "pii", "encryption", "encrypted", "guardrails", "guardrail", "security", "approval", "approvals", "customization", "customisation", "customize", "customise"),
}


def help_topic(text):
    lower = text.casefold().strip()
    if re.match(r"^(goal|audience|inputs|outcome)\s*:", lower):
        return None
    words = re.findall(r"[a-z]+", lower)
    asking = QUESTION.search(lower)
    if asking and re.search(r"use[ -]?cases?|scenarios?|service ideas", lower):
        return "scenarios"
    for topic, names in TOPICS.items():
        if asking or len(words) <= 2 and all(w in names for w in words):
            if any(w in names or (len(w) >= 6 and get_close_matches(w, names, n=1, cutoff=.78)) for w in words):
                return topic
    if asking and re.search(r"ఇంటిగ్రేష|కనెక్టర్|టూల్|సాధనా|इंटीग्रेशन|कनेक्टर|टूल", lower):
        return "tools"
    if asking and re.search(r"గోప్యత|ఎన్క్రిప్షన్|गोपनीयता|एन्क्रिप्शन", lower):
        return "controls"
    if asking and not re.match(r"^(?:please )?(show|list|suggest|explain)\b", lower):
        return "question"
    return None


@lru_cache(maxsize=1)
def scenarios():
    return json.loads((Path(__file__).resolve().parents[1] / "government_sources.json").read_text(encoding="utf-8"))


def answer_help(topic, text, brief, catalog):
    telugu = bool(re.search(r"[ఀ-౿]|\b(?:cheppu|cheppandi|enti)\b", text, re.I))
    hindi = bool(re.search(r"[ऀ-ॿ]", text))
    if topic == "scenarios":
        region = next((s for s in ("Andhra Pradesh", "Telangana") if s.lower() in text.lower()), None)
        return "Here are public-service networks you can build:\n\n" + "\n".join(
            f"- {row['state']} · [{row['title']}]({row['url']})" for row in scenarios() if not region or row["state"] == region)
    if topic == "tools":
        if not catalog:
            return "I couldn’t load this Studio’s integration catalog. Ask again to retry, or choose chat only."
        answer = "Integrations in this Studio:\n\n" + "\n".join(
            f"- **{tool['label']}** — {tool['description']}" for tool in catalog.values())
        if re.search(r"hospital|outpatient|patient", brief.get("goal", ""), re.I) and "gov_services" in catalog:
            answer += "\n\nFor your hospital desk, the public services directory can point patients to official services. Live appointment slots and private records need an authorized hospital connector."
        if telugu or hindi:
            title = "మీరు ఉపయోగించగల కనెక్టర్లు ఇవి." if telugu else "इस स्टूडियो में ये कनेक्टर उपलब्ध हैं।"
            answer = title + "\n\n" + "\n".join("- **" + tool["label"] + "**" for tool in catalog.values())
            if "gov_services" in catalog and re.search(r"hospital|outpatient|patient|ఆసుపత్రి|अस्पताल", brief.get("goal", ""), re.I):
                answer += ("\n\nమీ ఆసుపత్రి కోసం పబ్లిక్ సర్వీసుల డైరెక్టరీని ఎంచుకోవచ్చు. అపాయింట్‌మెంట్లు లేదా రోగుల రికార్డులకు ఆసుపత్రి అనుమతించిన కనెక్టర్ అవసరం." if telugu else
                           "\n\nअस्पताल की जानकारी के लिए सार्वजनिक सेवा निर्देशिका चुन सकते हैं। अपॉइंटमेंट और मरीज़ के रिकॉर्ड के लिए अस्पताल का अधिकृत कनेक्टर चाहिए।")
        return answer
    if topic == "controls":
        return ("**Customization** — Change the goal, audience, inputs or outcome in chat. You can revise roles and connections after building and set the organization name when publishing.\n\n"
                "**Personal data** — New chat messages mask common email, Indian mobile, PAN, 12-digit ID and labelled patient ID formats. Names and free-text medical details can still pass through. Use synthetic examples in Studio.\n\n"
                "**Guardrails** — The builder waits for confirmation. Chat only disables external tools. In Playground, an operator can require approval before every customer turn. The public service directory is read-only.\n\n"
                "**Encryption and voice** — The public deployment uses HTTPS and an encrypted AWS disk for stored chat. The application can read session history for the conversation and authorized reviews. Cloud speech sends audio to OpenAI before text masking. Choose local speech in the voice panel or require local speech for new customer sessions in Playground.")
    if telugu:
        return "నెట్‌వర్క్ రూపకల్పనకు సమస్య, వినియోగదారులు, సమాచార వనరులు, ఆశించిన ఫలితం కావాలి. ఉదాహరణలు, కనెక్టర్లు లేదా గోప్యత గురించి అడగవచ్చు."
    if hindi:
        return "नेटवर्क बनाने के लिए समस्या, उपयोगकर्ता, सूचना स्रोत और अपेक्षित परिणाम बताइए। आप उदाहरणों, कनेक्टर या गोपनीयता के बारे में भी पूछ सकते हैं।"
    return ("I can explain integrations, privacy, approvals, or how to customize this network. "
            "For the brief, describe the service problem, people who will use it, information sources, or expected result.")
