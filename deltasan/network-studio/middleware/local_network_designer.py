"""Use structured generation for the local Qwen model in the Accelerator designer."""

import asyncio
import re
from pathlib import Path
from urllib.parse import quote

import httpx
from langchain.agents.middleware.types import hook_config
from langchain_core.messages import AIMessage, HumanMessage
from pyhocon import ConfigFactory
from neuro_san_studio.agent_network_designer.middleware.agent_network_definition_middleware import (
    AgentNetworkDefinitionMiddleware,
)


class LocalNetworkDesigner(AgentNetworkDefinitionMiddleware):
    @hook_config(can_jump_to=["end"])
    async def abefore_model(self, state, runtime):
        data = self.sly_data
        config = ConfigFactory.parse_file(str(Path("config/llm_config.hocon")))
        if (
            config.get("llm_config.model_name", "") != "local-qwen"
            or data.get("llm_config")
            or any(data.get(k) for k in ("skip_designer", "agent_network_definition", "agent_network_hocon_file", "agent_reservations"))
        ):
            return await super().abefore_model(state, runtime)

        message = next((m.text for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), "")
        graph = data.get("studio_graph")
        network = data.get("studio_network")
        confirmation = re.fullmatch(r"(create|run|open|save|deploy)( it| the network)?[.!]?", message.strip(), re.I)
        try:
            async with httpx.AsyncClient(base_url="http://127.0.0.1:45174", timeout=130) as studio:
                if not (confirmation and graph and network):
                    design = await studio.post("/api/studio?action=chat", json={"message": message, "current": graph})
                    design.raise_for_status()
                    graph = design.json()["graph"]
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
                    network = saved.json()["network"]
                    data.update(studio_graph=graph, studio_network=network)
                    # DeltaSAN watches the root manifest, which includes the Studio registry.
                    Path("registries/manifest.hocon").touch(exist_ok=True)
                url = "/api/v1/" + quote(network, safe="/") + "/connectivity"
                for _ in range(45):
                    response = await studio.get(url)
                    if response.is_success and response.json().get("connectivity_info"):
                        break
                    await asyncio.sleep(1)
                else:
                    return self.finish("Your network was saved. The runtime is still loading it. Type ‘open it’ to check again.")
            roles = "\n".join(f"- **{a['name']}** — {a['task']}" for a in graph["agents"])
            link = "/multiAgentAccelerator?network=" + quote(network, safe="")
            deploy = "/deploy?network=" + quote(network, safe="")
            return self.finish(f"**{graph['title']}**\n\n{roles}\n\n[Open this network]({link}) · [Prepare deployment]({deploy})")
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
