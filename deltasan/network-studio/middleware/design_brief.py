"""Collect an explicit design brief before invoking the graph compiler."""
import re

FIELDS = {
    "goal": "What problem should the agent network solve?",
    "audience": "Who will use it?",
    "inputs": "What information or tools can the agents use? Say “chat only” if there are no integrations.",
    "outcome": "What should the network return or do, and what needs human approval?",
}
BUILD = re.compile(r"(?:yes|confirm|build|create|go ahead|build it|create it|build (?:the |this )?network|हाँ|हां|बनाओ|बनाएँ|बनाइए|అవును|నిర్మించండి|సృష్టించండి)[.!।]?", re.I)
GREETING = re.compile(r"(?:hi+|hello|hey|good (?:morning|afternoon|evening)|thanks?|thank you|नमस्ते|हाय|నమస్కారం|హాయ్)[\s!.।]*", re.I)


def localize(reply, text):
    if text.endswith("in Telugu for spoken playback.") or re.search(r"[ఀ-౿]", text):
        questions = ["ఈ నెట్‌వర్క్ ఏ సమస్యను పరిష్కరించాలి?", "దీన్ని ఎవరు ఉపయోగిస్తారు?",
                     "ఏ సమాచారం లేదా సాధనాలు ఉపయోగించవచ్చు?", "ఏ ఫలితం కావాలి? ఏ పనికి మనిషి అనుమతి అవసరం?"]
        labels = ["లక్ష్యం","వినియోగదారులు","సమాచారం","ఫలితం"]
        title, confirm, hello = "మీ అవసరాలు","నెట్‌వర్క్ సృష్టించడానికి **నిర్మించండి** అని చెప్పండి.","నమస్కారం! "
    elif text.endswith("in Hindi for spoken playback.") or re.search(r"[ऀ-ॿ]", text):
        questions = ["नेटवर्क को कौन सी समस्या हल करनी चाहिए?", "इसका इस्तेमाल कौन करेगा?",
                     "एजेंट कौन सी जानकारी या टूल इस्तेमाल कर सकते हैं?", "क्या परिणाम चाहिए और किन कामों के लिए इंसानी मंज़ूरी चाहिए?"]
        labels = ["लक्ष्य","उपयोगकर्ता","जानकारी","परिणाम"]
        title, confirm, hello = "आपकी ज़रूरतें","नेटवर्क बनाने के लिए **बनाइए** कहें।","नमस्ते! "
    else:
        return reply
    for key, question, label in zip(FIELDS, questions, labels):
        reply = reply.replace(FIELDS[key], question).replace(f"**{key.title()}**", f"**{label}**")
    return reply.replace("Hello! ", hello).replace("Your design brief", title).replace(
        "Say **build it** to create the network, or tell me which field to change.", confirm)


def collect(data, message):
    """Return (chat reply, confirmed design input). Only confirmation can produce input."""
    brief = dict(data.get("design_brief") or {})
    text = message.strip()
    command = text.casefold().strip(".!? ")
    if command in {"start over", "new agent", "new network"}:
        for key in ("studio_graph", "studio_network", "design_brief", "brief_confirmable", "brief_dirty"):
            data.pop(key, None)
        return FIELDS["goal"], None
    missing = next((field for field in FIELDS if not brief.get(field)), None)
    if BUILD.fullmatch(text) and data.get("brief_confirmable") and not missing:
        return None, "\n".join(f"{field}: {brief[field]}" for field in FIELDS)
    if GREETING.fullmatch(text) or BUILD.fullmatch(text) or not text:
        return ("Hello! " if not brief else "") + (FIELDS[missing] if missing else summary(brief)), None
    if re.fullmatch(r"(?:what can you do|how does (?:this|it) work|can you help(?: me)?)\??",text,re.I):
        return "I can design agents, connect their tools, and let you test them in Playground. " + (
            FIELDS[missing] if missing else summary(brief)), None
    labels = re.findall(r"(?:^|[;\n])\s*(goal|audience|inputs|outcome)\s*:\s*([^;\n]+)", text, re.I)
    if labels:
        brief.update({field.lower(): value.strip()[:1500] for field, value in labels})
    elif missing:
        if missing == "goal" and (len(text) < 8 or command in {"build an agent", "build a network", "create an agent", "help me", "make an agent"}):
            return FIELDS["goal"], None
        brief[missing] = text[:1500]
    else:
        return "Which requirement should change? Send Goal:, Audience:, Inputs:, or Outcome: followed by the change.\n\n" + summary(brief), None
    data["design_brief"] = brief
    data["brief_dirty"] = True
    missing = next((field for field in FIELDS if not brief.get(field)), None)
    data["brief_confirmable"] = missing is None
    return (FIELDS[missing] if missing else summary(brief)), None


def summary(brief):
    return "**Your design brief**\n\n" + "\n".join(f"- **{key.title()}** — {brief[key]}" for key in FIELDS) + "\n\nSay **build it** to create the network, or tell me which field to change."
