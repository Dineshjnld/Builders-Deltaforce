"""Use structured generation for the local Qwen model in the Accelerator designer."""

import asyncio
import re
import os
from pathlib import Path
from urllib.parse import quote, unquote
import json

import httpx
from langchain.agents.middleware.types import hook_config
from langchain_core.messages import AIMessage, HumanMessage
from pyhocon import ConfigFactory
from middleware.design_brief import collect, GREETING, BUILD, localize
from middleware.connectors import select_tools
from neuro_san_studio.agent_network_designer.middleware.agent_network_definition_middleware import (
    AgentNetworkDefinitionMiddleware,
)


class LocalNetworkDesigner(AgentNetworkDefinitionMiddleware):
    async def activity(self, sender, recipient, detail):
        if self.progress_reporter:
            await self.progress_reporter.async_report_progress({"builder_activity":{"sender":sender,"recipient":recipient,"detail":detail}})

    @hook_config(can_jump_to=["end"])
    async def abefore_model(self, state, runtime):
        data = self.sly_data
        config = ConfigFactory.parse_file(str(Path("config/llm_config.hocon")))
        if (
            any(data.get(k) for k in ("skip_designer", "agent_network_definition", "agent_network_hocon_file", "agent_reservations"))
        ):
            return await super().abefore_model(state, runtime)

        messages = state["messages"]
        last_user = next((i for i in range(len(messages)-1,-1,-1) if isinstance(messages[i],HumanMessage)), None)
        if last_user is None:
            return self.finish("What problem should the agent network solve?")
        # Neuro SAN sends chat_context back to the browser, but can omit mutated sly_data.
        # Rebuild the brief from this conversation's own transcript when the next request arrives.
        if not data.get("design_brief"):
            for old in messages[:last_user]:
                if isinstance(old, HumanMessage):
                    collect(data, old.text.split("\n\nRespond concisely in ",1)[0])
                elif isinstance(old, AIMessage):
                    saved = re.search(r"/playground\?network=(deltaforce%2F[a-z0-9_]+)",old.text,re.I)
                    if saved:
                        name = unquote(saved.group(1))
                        file = Path("registries",name+".studio")
                        if file.is_file():
                            data.pop("revision",None)
                            data.update(studio_network=name,studio_graph=json.loads(file.read_text(encoding="utf8")),brief_dirty=False)
        message = messages[last_user].text
        graph = data.get("studio_graph")
        network = data.get("studio_network")
        intent = message.split("\n\nRespond concisely in ", 1)[0].strip()
        if re.search(r"(use cases?|scenarios?|service ideas)",intent,re.I) and re.search(r"(suggest|examples?|list|show|what)",intent,re.I):
            rows = json.loads(Path("government_sources.json").read_text(encoding="utf-8"))
            state = next((s for s in ("Andhra Pradesh","Telangana") if s.lower() in intent.lower()), None)
            return self.finish("\n".join(["Here are public-service networks you can build:", *[
                f"- {r['state']} · [{r['title']}]({r['url']})" for r in rows if not state or r["state"]==state
            ], "Which problem would you like your network to solve?"]))
        confirmation = re.fullmatch(
            r"(?:(create|run|open|save|deploy)( it| the network)?|इसे खोलो|इसे खोलें|खोलें|"
            r"సేవ్ చేయండి|తెరవండి|దీన్ని తెరవండి)[.!।]?", intent, re.I
        )
        if network and not data.get("brief_dirty") and (confirmation or BUILD.fullmatch(intent) or GREETING.fullmatch(intent)):
            return self.finish(f"Your network is ready. [Open Playground](/playground?network={quote(network, safe='')}) · [Deploy](/deploy?network={quote(network, safe='')})")
        reply, design_input = collect(data, intent)
        if reply:
            return self.finish(localize(reply,message))
        if config.get("llm_config.model_name", "") != "local-qwen" or data.get("llm_config"):
            messages = list(state["messages"])
            for index in range(len(messages)-1, -1, -1):
                if isinstance(messages[index], HumanMessage):
                    messages[index] = HumanMessage(content=design_input, id=messages[index].id)
                    break
            state["messages"] = messages
            return await super().abefore_model(state, runtime)
        try:
            async with httpx.AsyncClient(base_url=os.environ.get("DELTA_STUDIO_URL", "http://127.0.0.1:45174"), timeout=130) as studio:
                if data.get("brief_dirty") or not (confirmation and graph and network):
                    await self.activity("Brief coordinator","Network architect","Sending the confirmed goal, audience, inputs and outcome for graph design.")
                    design = await studio.post("/api/studio?action=chat", json={"message": design_input, "current": graph})
                    design.raise_for_status()
                    graph = design.json()["graph"]
                    await self.activity("Network architect","Connector selector",f"Submitted {len(graph['agents'])} role assignments for tool selection.")
                    select_tools(graph, data.get("design_brief") or {}, design_input, data.get("studio_graph"))
                    bindings = [a["name"]+" → "+", ".join(a["tools"]) for a in graph["agents"] if a["tools"]]
                    await self.activity("Connector selector","Graph validator","; ".join(bindings) if bindings else "No external tools assigned.")
                    agents = {a["id"]: a["name"] for a in graph["agents"]}
                    edges = {key: [] for key in agents}
                    for route in graph["routes"]:
                        edges[route["from"]].append(agents[route["to"]])
                    if self.progress_reporter:
                        await self.progress_reporter.async_report_progress({"connectivity_info": [
                            {"origin": name, "tools": edges[key], "display_as": "llm_agent"}
                            for key, name in agents.items()
                        ]})
                    saved = await studio.post("/api/studio", json=graph)
                    saved.raise_for_status()
                    await self.activity("Graph validator","Studio registry","Validated connections and saved the network definition.")
                    network = saved.json()["network"]
                    data.update(studio_graph=graph, studio_network=network, brief_dirty=False)
                    data.pop("revision",None)
                    # DeltaSAN watches the root manifest, which includes the Studio registry.
                    Path("registries/manifest.hocon").touch(exist_ok=True)
                url = "/api/v1/" + quote(network, safe="/") + "/connectivity"
                for _ in range(5):
                    response = await studio.get(url)
                    if response.is_success and response.json().get("connectivity_info"):
                        break
                    await asyncio.sleep(1)
                else:
                    return self.finish(f"Your network is saved. [Open Playground](/playground?network={quote(network,safe='')}) to test it as soon as the runtime loads it.")
            roles = "\n".join(f"- **{a['name']}** — {a['task']}" for a in graph["agents"])
            link = "/playground?network=" + quote(network, safe="")
            deploy = "/deploy?network=" + quote(network, safe="")
            return self.finish(f"**{graph['title']}**\n\n{roles}\n\n[Test in Playground]({link}) · [Prepare deployment]({deploy})")
        except httpx.HTTPStatusError as exc:
            try:
                reason = exc.response.json().get("error") or str(exc.response.status_code)
            except ValueError:
                reason = str(exc.response.status_code)
            return self.finish(f"The designer could not complete this request. {reason}")
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            return self.finish(f"The designer could not complete this request. {exc}")

    @staticmethod
    def finish(text):
        return {"messages": [AIMessage(content=text)], "jump_to": "end"}
