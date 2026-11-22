"""Resolve official sources for a customer turn through its deployment's own MCP bindings."""
import json
import re
from datetime import timedelta

import httpx
from mcp import ClientSession, McpError
from mcp.client.streamable_http import streamablehttp_client
from decision_model import predict

SERVICES = "http://127.0.0.1:45210/mcp"


async def official_service(profile, query):
    if not any(c.get("to")==SERVICES for c in profile.get("connections",[])):return None
    hint = query+" "+profile.get("display_name",profile["name"])+" "+profile.get("description","")
    state = next((s for s in ("Telangana","Andhra Pradesh") if s.casefold() in query.casefold()),None)
    if not state:
        states = [s for s in ("Telangana","Andhra Pradesh") if s.casefold() in hint.casefold()]
        if len(states)!=1:return None
        state = states[0]
    route,_ = predict(query)
    if route!="gov_services":return None
    try:
        async with streamablehttp_client(SERVICES,timeout=timedelta(seconds=5)) as (reader,writer,_):
            async with ClientSession(reader,writer) as session:
                await session.initialize()
                result = await session.call_tool("search_services",{"state":state,"query":query})
                if result.isError or not result.content:return None
                row = json.loads(result.content[0].text)
                if isinstance(row,list):row = row[0]
                return {k:row[k] for k in ("title","description","url","department","state")}
    except (ExceptionGroup,httpx.HTTPError,McpError,TimeoutError,ValueError,KeyError,IndexError,AttributeError):
        return None
