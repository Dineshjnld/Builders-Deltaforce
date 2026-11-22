"""Bind public tools to requested data needs, with at most one owner per new connector."""
import re
from decision_model import predict

INTENT = {
    "gov_weather":r"weather|rainfall|monsoon|forecast|meteorolog|imd\b|వాతావరణ|बारिश",
    "gov_services":r"meeseva|mee seva|government service|certificate|state (?:service|directory)|public service|revenue officer|municipal|scholarship",
    "mospi":r"\bmospi\b|esankhyiki|inflation|consumer price index|labour force|official statistics|statistical dataset",
    "clock":r"\bclock\b|time ?zone|current (?:time|date)",
    "fetch":r"web ?fetch|supplied (?:web ?page|url)|read (?:a |the |given )?url",
    "search":r"you\.com|general web search|search the web",
    "docs":r"deepwiki|github repositor|code documentation",
}


def select_tools(graph, brief, instructions, previous=None):
    agents = graph["agents"]
    if re.search(r"chat[ -]only|no (?:external )?(?:tools|integrations|connectors)",brief.get("inputs",""),re.I):
        for agent in agents: agent["tools"] = []
        return
    old = {a["name"]:set(a["tools"]) for a in (previous or {}).get("agents",[])}
    goal_route, _ = predict(brief.get("goal",instructions))
    requested = {k for k,pattern in INTENT.items() if re.search(pattern,instructions,re.I)}
    if goal_route != "none": requested.add(goal_route)
    selected = {a["name"]:set(a["tools"]) for a in agents}
    for agent in agents:
        # Preserve requested edits to existing tool assignments and explicitly named catalog tools.
        agent["tools"] = [tool for tool in agent["tools"] if tool in old.get(agent["name"],set()) or
                          (tool not in INTENT and tool in instructions)]
    for key in sorted(requested):
        if any(key in a["tools"] for a in agents):continue
        def rank(a):
            route,score = predict(a["task"])
            return (score if route==key else 0, bool(re.search(INTENT[key],a["task"],re.I)),
                    key in selected[a["name"]],a is not agents[0])
        owner = max(agents,key=rank)
        owner["tools"].append(key)
