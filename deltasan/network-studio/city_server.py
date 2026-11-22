"""Local deployment API for networks served by the DeltaSAN runtime."""

import asyncio
import hmac
import json
import os
import re
import time
import uuid
from pathlib import Path

import httpx
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pyhocon import ConfigFactory
from ai_settings import select_theme
from starlette.middleware.trustedhost import TrustedHostMiddleware

ROOT = Path(__file__).resolve().parent
CITY = ROOT / "registries" / "city"
INDEX = CITY / "deployments.json"
TOKEN = os.environ["DELTA_CITY_TOKEN"]
STUDIO = os.getenv("DELTA_STUDIO_URL", "http://127.0.0.1:45174")
CUSTOMER = os.getenv("DELTA_CUSTOMER_ORIGIN", "http://127.0.0.1:45192").rstrip("/")
CITY_ORIGIN = os.getenv("DELTA_CITY_ORIGIN", "http://127.0.0.1:45187")
app = FastAPI(title="DeltaSAN Deployments")
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "host.docker.internal"])
lock = asyncio.Lock()


def atomic_write(path, content):
    temp = path.with_suffix("." + uuid.uuid4().hex + ".tmp")
    temp.write_text(content, encoding="utf-8")
    os.replace(temp, path)


def records():
    return json.loads(INDEX.read_text(encoding="utf-8")) if INDEX.exists() else {}


def reconcile(entries):
    manifest = {"city/" + key + ".hocon": True for key, row in entries.items() if row["enabled"]}
    atomic_write(CITY / "manifest.hocon", json.dumps(manifest, indent=2))
    os.utime(ROOT / "registries" / "manifest.hocon", None)


def commit(entries):
    atomic_write(INDEX, json.dumps(entries, indent=2))
    reconcile(entries)


@app.on_event("startup")
async def restore():
    if INDEX.exists():
        reconcile(records())


@app.middleware("http")
async def authorize_changes(request: Request, call_next):
    if request.method not in ("HEAD", "GET", "OPTIONS"):
        own_origin = request.headers.get("origin") in {CITY_ORIGIN, CITY_ORIGIN.replace("127.0.0.1","localhost")}
        token_ok = hmac.compare_digest(request.headers.get("authorization", ""), "Bearer " + TOKEN)
        if not own_origin and not token_ok:
            return JSONResponse({"detail": "Open the local deployment console or authenticate the publishing request."}, 403)
    return await call_next(request)


def validate_source(content):
    # Parse data-only HOCON. The local runtime supplies its model configuration.
    content = re.sub(r'(?m)^\s*include\s+"config/llm_config\.hocon"\s*,?\s*$', "", content)
    if re.search(r"\binclude\b|\$\{", content, re.I):
        raise ValueError("External includes and environment substitutions are unsupported in a deployment.")
    try:
        spec = ConfigFactory.parse_string(content, resolve=False).as_plain_ordered_dict()
    except Exception as exc:
        raise ValueError("The file is not valid, self-contained HOCON.") from exc
    tools = spec.get("tools")
    if not isinstance(tools, list) or not 1 <= len(tools) <= 64:
        raise ValueError("Supply a network with 1 to 64 agent or toolbox definitions.")
    if set(spec) - {"tools", "metadata", "max_execution_seconds"}:
        raise ValueError("Use the portable HOCON export from Studio. The local runtime supplies the model.")
    limit = spec.get("max_execution_seconds", 120)
    if not isinstance(limit, int) or not 1 <= limit <= 300:
        raise ValueError("The execution limit must be between 1 and 300 seconds.")
    catalog = {"https://mcp.deepwiki.com/mcp", "https://api.you.com/mcp?profile=free", "http://127.0.0.1:45186/mcp",
               "http://127.0.0.1:45210/mcp","http://127.0.0.1:45211/mcp","https://mcp.mospi.gov.in/"}
    catalog_file = ROOT / "registries/deltaforce/tools.catalog"
    if catalog_file.exists():
        catalog.update(entry["target"] for entry in json.loads(catalog_file.read_text()).values() if entry.get("type") == "MCP")
    names = set()
    for tool in tools:
        if not isinstance(tool, dict) or set(tool) - {"name", "function", "instructions", "tools", "toolbox"}:
            raise ValueError("Each node must be a data-defined agent or a registered toolbox.")
        name = tool.get("name")
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", name) or name in names:
            raise ValueError("Agent names must be unique identifiers.")
        names.add(name)
        if "toolbox" in tool and tool["toolbox"] != "web_fetch":
            raise ValueError("This toolbox is unavailable on the local runtime.")
        if "toolbox" not in tool and (not isinstance(tool.get("instructions"), str) or not isinstance(tool.get("function"), dict)):
            raise ValueError("Each agent needs instructions and a function description.")
    for tool in tools:
        targets = tool.get("tools", [])
        if not isinstance(targets, list) or any(not isinstance(t, str) or t not in names | catalog for t in targets):
            raise ValueError("Every connection must target an agent in the file or a configured MCP server.")
    if "toolbox" in tools[0]:
        raise ValueError("The entry node must be an agent.")
    return spec


async def runtime_networks():
    try:
        async with httpx.AsyncClient(timeout=4) as client:
            r = await client.get(os.getenv("DELTA_RUNTIME_URL","http://127.0.0.1:45184") + "/api/v1/list")
            r.raise_for_status()
            return {a["agent_name"] for a in r.json()["agents"]}
    except (httpx.HTTPError, ValueError, KeyError):
        return None


def describe(key, row, live):
    network = "city/" + key
    status = "stopped" if not row["enabled"] else "ready" if live is not None and network in live else "building"
    if status == "building" and time.time() - row["updated"] > 150:
        status = "failed"
    return {**row, "id": key, "status": status, "network": network, "url": CUSTOMER + "/chat/" + key,
            "playground_url": os.getenv("DELTA_PUBLIC_STUDIO_ORIGIN", STUDIO) + "/playground?network=city%2F" + key,
            "error": "Runtime did not report this network as loaded." if status == "failed" else None}


@app.get("/app/")
async def console():
    return FileResponse(ROOT / "city.html", headers={"Content-Security-Policy": "frame-ancestors 'self' " + STUDIO + " " + STUDIO.replace("127.0.0.1","localhost")})


@app.get("/health")
async def health():
    return {"status": "ok", "port_pool": {"mode": "shared-runtime"}, "version": "local"}


@app.get("/deployments")
@app.get("/directory")
async def directory():
    live = await runtime_networks()
    return {"deployments": [describe(k, v, live) for k, v in records().items()]}


@app.post("/deployments", status_code=202)
async def deploy(file: UploadFile = File(...), name: str = Form(...), org_name: str = Form(...)):
    name, org_name = name.strip(), org_name.strip()
    if not re.fullmatch(r"[A-Za-z0-9_ -]{1,90}", name) or not re.fullmatch(r"[\w &'().,/+#-]{1,40}", org_name):
        raise HTTPException(422, "Enter a network name and an organization of up to 40 characters.")
    raw = await file.read(524289)
    if len(raw) > 524288:
        raise HTTPException(413, "Network files must be under 512 KiB.")
    try:
        spec = validate_source(raw.decode("utf-8-sig"))
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, str(exc)) from exc
    key = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:48] + "_" + uuid.uuid4().hex[:12]
    theme = await select_theme({"name":name,"description":str(spec["tools"][0].get("function",{}).get("description",""))[:500]})
    async with lock:
        entries = records()
        if any(r["name"].casefold() == name.casefold() and r["org_name"].casefold() == org_name.casefold() for r in entries.values()):
            raise HTTPException(409, "This organization already has a deployment with that name.")
        atomic_write(CITY / (key + ".hocon"), '{\ninclude "config/llm_config.hocon"\n' + json.dumps(spec, indent=2)[1:])
        entries[key] = {"name": name, "org_name": org_name, "theme": theme, "updated": time.time(), "enabled": True,
                        "display_name": re.sub(r"_[0-9a-f]{12}$", "", name).replace("_", " "),
                        "description": str(spec["tools"][0].get("function",{}).get("description",""))[:500],
                        "agents": [t["name"] for t in spec["tools"] if "toolbox" not in t],
                        "connections": [{"from": t["name"], "to": dest} for t in spec["tools"] for dest in t.get("tools", [])]}
        commit(entries)
    return describe(key, entries[key], set())


@app.delete("/deployments/{key}")
async def stop_deployment(key: str):
    return await change_state(key, "unpublish")


@app.get("/deployments/{key}/wait")
async def wait(key: str, timeout: int = 45):
    end = time.monotonic() + min(60, max(0, timeout))
    while True:
        row = records().get(key)
        if not row:
            raise HTTPException(404, "Unknown deployment.")
        item = describe(key, row, await runtime_networks())
        if item["status"] != "building":
            return item
        if time.monotonic() >= end:
            return JSONResponse(item, 504)
        await asyncio.sleep(1)


@app.post("/deployments/{key}/{action}")
async def change_state(key: str, action: str):
    if action not in {"publish", "unpublish", "restart"}:
        raise HTTPException(404, "Unknown deployment action.")
    async with lock:
        entries = records()
        if key not in entries:
            raise HTTPException(404, "Unknown deployment.")
        entries[key].update(enabled=action != "unpublish", updated=time.time())
        if action == "restart":
            os.utime(CITY / (key + ".hocon"), None)
        commit(entries)
    return describe(key, entries[key], set())
