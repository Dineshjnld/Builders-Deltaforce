"""Customer-only web origin and a credentialed operator review queue."""
import hashlib
import asyncio
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import closing, contextmanager
from pathlib import Path
from uuid import UUID

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from ai_settings import domain_theme, setting
from civic_context import official_service
from pyhocon import ConfigFactory
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
REGISTRY = ROOT / "registries/city/deployments.json"
DB = Path(os.environ.get("DELTA_CONVERSATIONS_DB", ROOT / "customer.sqlite3"))
UI = os.environ.get("DELTA_STUDIO_URL", "http://127.0.0.1:45175")
RUNTIME = os.environ.get("DELTA_RUNTIME_URL", "http://127.0.0.1:45184")
ADMIN = os.environ["DELTA_CITY_TOKEN"]
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@contextmanager
def database():
    with closing(sqlite3.connect(DB, timeout=10)) as connection:
        connection.row_factory = sqlite3.Row
        with connection:
            yield connection


@app.on_event("startup")
def setup():
    with database() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, network TEXT NOT NULL, context TEXT);
        CREATE TABLE IF NOT EXISTS turns (id TEXT PRIMARY KEY, session TEXT NOT NULL, message TEXT NOT NULL,
            language TEXT, state TEXT NOT NULL, answer TEXT, created REAL NOT NULL);
        CREATE UNIQUE INDEX IF NOT EXISTS current_turn ON turns(session) WHERE state IN ('pending','running');
        CREATE TABLE IF NOT EXISTS policy (network TEXT PRIMARY KEY, review INTEGER NOT NULL);
        """)
        db.execute("UPDATE turns SET state='failed',answer='This turn timed out. Please try again.' WHERE state='running' AND created<?", (time.time()-300,))
        db.execute("CREATE TABLE IF NOT EXISTS turn_activity (id TEXT PRIMARY KEY, activity TEXT)")
        db.execute("CREATE TABLE IF NOT EXISTS voice_usage (day TEXT PRIMARY KEY, sessions INTEGER NOT NULL)")


def deployment(key):
    rows = json.loads(REGISTRY.read_text(encoding="utf-8-sig")) if REGISTRY.exists() else {}
    row = rows.get(key)
    if not row or not row["enabled"]:
        raise HTTPException(404, "This deployment is unavailable.")
    return row


def identity(req, key):
    token = req.headers.get("authorization", "").removeprefix("Bearer ")
    digest = hashlib.sha256(token.encode()).hexdigest()
    with database() as db:
        row = db.execute("SELECT * FROM sessions WHERE id=? AND network=?", (digest, key)).fetchone()
    if not row:
        raise HTTPException(401, "Start a new conversation.")
    return row


def operator(req):
    if not hmac.compare_digest(req.headers.get("authorization", ""), "Bearer " + ADMIN):
        raise HTTPException(403, "Studio operator access required.")


@app.get("/api/customer/{key}")
def info(key: str):
    row = deployment(key)
    with database() as db:
        policy = db.execute("SELECT review FROM policy WHERE network=?", (key,)).fetchone()
    return {"name": row.get("display_name") or row["name"], "organization": row["org_name"],
            "agents": row["agents"], "description":row.get("description",""), "review": bool(policy and policy[0]),
            "theme":row.get("theme") or domain_theme(row), "realtime":bool(setting("OPENAI_API_KEY"))}


@app.post("/api/customer/{key}/sessions")
def begin(key: str):
    deployment(key)
    token = secrets.token_urlsafe(32)
    with database() as db:
        db.execute("INSERT INTO sessions VALUES(?,?,NULL)", (hashlib.sha256(token.encode()).hexdigest(), key))
    return {"token": token}


@app.get("/api/customer/{key}/turns")
def history(key: str, req: Request):
    deployment(key)
    session = identity(req, key)
    with database() as db:
        rows = db.execute("SELECT t.id,message,state,answer,a.activity FROM turns t LEFT JOIN turn_activity a ON a.id=t.id WHERE session=? ORDER BY created", (session["id"],))
        return [dict(r) for r in rows]


@app.get("/api/customer/{key}/events")
async def events(key: str, turn: UUID, req: Request):
    deployment(key)
    session = identity(req,key)
    def current():
        with database() as db:
            row = db.execute("SELECT t.id,message,state,answer,a.activity FROM turns t LEFT JOIN turn_activity a ON a.id=t.id WHERE t.id=? AND session=?", (str(turn), session["id"])).fetchone()
            return dict(row) if row else None
    if not current(): raise HTTPException(404)
    async def changes():
        previous = None
        for i in range(360):
            row = current()
            if not row: return
            if row != previous:
                yield "data: "+json.dumps(row,ensure_ascii=False)+"\n\n"
                previous = row
            elif i % 20 == 0:
                yield ": heartbeat\n\n"
            if row["state"] not in ("pending","running"): return
            await asyncio.sleep(0.45)
    return StreamingResponse(changes(),media_type="text/event-stream",headers={"Cache-Control":"no-store","X-Accel-Buffering":"no"})


@app.api_route("/operator/realtime",methods=["GET","POST"])
async def operator_voice(req: Request):
    operator(req)
    if req.method == "GET": return {"enabled":bool(setting("OPENAI_API_KEY"))}
    return await negotiate(req)


@app.post("/api/customer/{key}/voice")
async def customer_voice(key: str, req: Request):
    deployment(key)
    identity(req,key)
    return await negotiate(req)


async def negotiate(req):
    key = setting("OPENAI_API_KEY")
    if not key: raise HTTPException(503,"Cloud voice is not configured.")
    raw = await req.body()
    if not raw.startswith(b"v=0") or len(raw)>65536: raise HTTPException(400,"Invalid audio offer.")
    day = time.strftime("%Y-%m-%d",time.gmtime())
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("INSERT OR IGNORE INTO voice_usage VALUES(?,0)", (day,))
        if not db.execute("UPDATE voice_usage SET sessions=sessions+1 WHERE day=? AND sessions<?",(day,int(setting("DELTA_VOICE_SESSIONS_PER_DAY","24")))).rowcount:
            raise HTTPException(429,"Cloud voice session allowance reached.")
    config = {"type":"realtime","model":setting("OPENAI_REALTIME_MODEL","gpt-realtime-2.1-mini"),
              "instructions":"Speak the authorized network reply in the user's language. Preserve names and approval decisions.",
              "audio":{"input":{"transcription":{"model":"gpt-4o-mini-transcribe"},
                                "turn_detection":{"type":"server_vad","silence_duration_ms":360,"create_response":False,"interrupt_response":True}},
                       "output":{"voice":"marin"}}}
    try:
        async with httpx.AsyncClient(timeout=17) as c:
            r = await c.post("https://api.openai.com/v1/realtime/calls",headers={"Authorization":"Bearer "+key},
                files={"sdp":(None,raw,"application/sdp"),"session":(None,json.dumps(config),"application/json")})
            r.raise_for_status()
            return Response(r.content,media_type="application/sdp",headers={"Cache-Control":"no-store"})
    except httpx.HTTPError:
        with database() as db: db.execute("UPDATE voice_usage SET sessions=sessions-1 WHERE day=?",(day,))
        raise HTTPException(503,"Cloud voice could not connect. Local speech is available.")


class Turn(BaseModel):
    id: UUID
    message: str = Field(min_length=1, max_length=4000)
    language: str = Field(default="", max_length=30)
    review: bool = False


_GREETING = re.compile(r"(?:hi+|hello|hey|good (?:morning|afternoon|evening)|namaste|नमस्ते|हाय|हैलो|నమస్కారం|హాయ్|హలో)(?: there)?")
_IDENTITY = re.compile(
    r"(?:who (?:are you|am i (?:talking|speaking) to|is this)|what (?:are you|is your (?:name|role|purpose)|do you do|can you (?:do|help(?: me)? with))"
    r"|what(?:'s|’s) your (?:name|role|purpose)|tell me (?:about yourself|who you are)|introduce yourself"
    r"|who (?:created|made|built|runs|operates) you|are you (?:claude|chatgpt|an? anthropic (?:ai|assistant))"
    r"|आप कौन हैं|तुम कौन हो|आपका नाम क्या है|మీరు ఎవరు|నువ్వు ఎవరు|మీ పేరు ఏమిటి)"
)
_MODEL = re.compile(
    r"(?:what|which) (?:ai |language |llm )?(?:model|provider)(?: (?:are you(?: using)?|do you use|powers you|is this))?"
    r"|(?:are you|were you) (?:powered|made|built|created) by (?:anthropic|openai|google|alibaba)"
    r"|do you (?:use|run on) (?:claude|gpt|chatgpt|qwen|gemini)"
)


def configured_model():
    try:
        model = ConfigFactory.parse_file(str(ROOT / "config/llm_config.hocon"), resolve=False).get("llm_config.model_name", "")
        return model if isinstance(model, str) and re.fullmatch(r"[\w./:-]{1,128}", model) else ""
    except (OSError, ValueError, KeyError):
        return ""


def introduction(profile, message, language):
    text = " ".join(message.casefold().split()).strip(" .,!?।")
    greeting = _GREETING.fullmatch(text)
    if not greeting:
        text = re.sub(r"^(?:hi|hello|hey)[ ,!]+", "", text)
        if not _IDENTITY.fullmatch(text) and not _MODEL.fullmatch(text):
            return None
    name = profile.get("display_name") or profile["name"]
    org = profile["org_name"]
    purpose = (profile.get("description") or "").strip()
    if _MODEL.fullmatch(text):
        model = configured_model()
        return f"I’m {name}, the assistant for {org}. " + (f"This deployment uses the model identifier {model}." if model else "Model details are available from the Studio operator.")
    if language == "Hindi" or re.search(r"[\u0900-\u097f]", text):
        return ("नमस्ते! " if greeting else "") + f"मैं {name} हूँ, {org} का सहायक।" + (" मेरा काम है: " + purpose if purpose else "")
    if language == "Telugu" or re.search(r"[\u0c00-\u0c7f]", text):
        return ("నమస్కారం! " if greeting else "") + f"నేను {name}, {org} సహాయకుడిని." + (" నా పని: " + purpose if purpose else "")
    reply = ("Hello! " if greeting else "") + f"I’m {name}, the assistant for {org}."
    if purpose:
        if re.match(r"^(answer|assist|check|collect|create|draft|explain|find|guide|help|manage|prepare|process|provide|resolve|review|route|summarize|support|track|triage)\b", purpose, re.I):
            reply += " I can " + purpose[0].lower() + purpose[1:].rstrip(".") + "."
        else:
            reply += " " + purpose.rstrip(".") + "."
    return reply


async def run_turn(key, turn_id):
    with database() as db:
        row = db.execute("SELECT t.*,s.context FROM turns t JOIN sessions s ON s.id=t.session WHERE t.id=?", (turn_id,)).fetchone()
    try:
        profile = deployment(key)
        intro = introduction(profile, row["message"], row["language"])
        if intro:
            with database() as db:
                db.execute("UPDATE turns SET state='answered',answer=? WHERE id=?", (intro, turn_id))
            return
        # Give existing and newly published networks the same customer-facing identity on every turn.
        details = {"name": profile.get("display_name") or profile["name"], "organization": profile["org_name"],
                   "purpose": profile.get("description", "")}
        prompt = ("You are speaking as the deployed assistant described by this profile: " +
                  json.dumps(details, ensure_ascii=False) +
                  ". Use this identity when relevant. Claims about model developers or providers require verified configuration. "
                  "Answer the customer's request directly.\n\nCustomer message:\n" + row["message"])
        if row["language"] in ("Telugu","Hindi","English"):
            prompt += "\nReply concisely in " + row["language"] + "."
        source = await official_service(profile,row["message"])
        if source:
            prompt += "\nVerified public-service directory result: "+json.dumps(source,ensure_ascii=False)+". Use this source; refer applications and decisions to the responsible office."
            with database() as db:
                db.execute("INSERT OR REPLACE INTO turn_activity VALUES(?,?)",(turn_id,"Service directory → "+source["department"]))
        payload = {"user_message":{"type":"HUMAN","text":prompt}, "chat_filter":{"chat_filter_type":"MAXIMAL"}}
        if row["context"]:
            payload["chat_context"] = json.loads(row["context"])
        answer, context, last_activity = "", None, None
        async with httpx.AsyncClient(timeout=145) as client:
            async with client.stream("POST", f"{RUNTIME}/api/v1/city/{key}/streaming_chat", json=payload) as stream:
                stream.raise_for_status()
                async for line in stream.aiter_lines():
                    if not line.strip():
                        continue
                    message = json.loads(line).get("response", {})
                    path = [part.get("tool") for part in (message.get("origin") or []) if isinstance(part,dict) and part.get("tool") in profile.get("agents",[])]
                    if path and path != last_activity:
                        with database() as db:
                            db.execute("INSERT OR REPLACE INTO turn_activity(id,activity) VALUES(?,?)", (turn_id," → ".join(path)))
                        last_activity = path
                    if message.get("type") == "AGENT_FRAMEWORK":
                        answer = message.get("text") or answer
                        context = message.get("chat_context") or context
        if not answer:
            raise ValueError("Missing final answer")
        if source and source["url"] not in answer:
            answer += "\n\n"+source["title"]+" · "+source["url"]
        with database() as db:
            if context:
                db.execute("UPDATE sessions SET context=? WHERE id=?", (json.dumps(context), row["session"]))
            db.execute("UPDATE turns SET state='answered',answer=? WHERE id=?", (answer, turn_id))
    except (httpx.HTTPError, ValueError, HTTPException):
        with database() as db:
            db.execute("UPDATE turns SET state='failed',answer=? WHERE id=?", ("The network could not finish this turn. Please try again.", turn_id))


@app.post("/api/customer/{key}/turns")
async def send(key: str, body: Turn, req: Request, background: BackgroundTasks):
    deployment(key)
    session = identity(req, key)
    turn_id = str(body.id)
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        previous = db.execute("SELECT session,state FROM turns WHERE id=?", (turn_id,)).fetchone()
        if previous and previous["session"] == session["id"]:
            return {"state":previous["state"]}
        policy = db.execute("SELECT review FROM policy WHERE network=?", (key,)).fetchone()
        pending = body.review or bool(policy and policy[0])
        try:
            db.execute("INSERT INTO turns(id,session,message,language,state,created) VALUES(?,?,?,?,?,?)", (turn_id,session["id"],body.message,body.language,"pending" if pending else "running",time.time()))
        except sqlite3.IntegrityError:
            raise HTTPException(409, "Finish the current turn first.")
    if not pending:
        if req.headers.get("prefer")=="respond-async":
            background.add_task(run_turn,key,turn_id)
            return {"state":"running"}
        await run_turn(key, turn_id)
    return {"state":"pending" if pending else "finished"}


@app.get("/operator/reviews")
def queue(req: Request):
    operator(req)
    with database() as db:
        rows = db.execute("SELECT t.id,t.message,s.network FROM turns t JOIN sessions s ON t.session=s.id WHERE state='pending' ORDER BY created")
        return {"pending":[dict(r) for r in rows],"required":[r[0] for r in db.execute("SELECT network FROM policy WHERE review=1")]}


class Decision(BaseModel):
    action: str
    id: str = Field(max_length=150)


@app.post("/operator/reviews")
async def decide(body: Decision, req: Request):
    operator(req)
    if body.action in ("require","optional"):
        deployment(body.id)
        with database() as db:
            db.execute("INSERT OR REPLACE INTO policy VALUES(?,?)", (body.id, int(body.action=="require")))
        return {"ok":True}
    if body.action not in ("approve","decline"):
        raise HTTPException(400, "Unknown decision.")
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT s.network FROM sessions s JOIN turns t ON s.id=t.session WHERE t.id=? AND t.state='pending'", (body.id,)).fetchone()
        if not row:
            raise HTTPException(409,"This request has already been resolved.")
        deployment(row[0])
        db.execute("UPDATE turns SET state=?,answer=? WHERE id=?", ("running",None,body.id) if body.action=="approve" else ("declined","A reviewer declined this request.",body.id))
    if body.action=="approve":
        await run_turn(row[0],body.id)
    return {"ok":True}


@app.api_route("/{path:path}", methods=["GET","POST"])
async def frontend(path: str, req: Request):
    # This origin serves customer pages, assets and voice. Studio APIs and navigation stay on the operator origin.
    if not (re.fullmatch(r"chat/[\w-]+",path) or path.startswith("_next/static/") or
            path in {"deltaforce-logo.svg","deltaforce-logo-dark.svg","voice-capture.js","api/voice/transcribe","api/voice/speak"}):
        raise HTTPException(404)
    if ".." in path.split("/") or "\\" in path:
        raise HTTPException(400)
    if path.startswith("api/voice/") and req.headers.get("x-deltasan-voice")!="1":
        raise HTTPException(403)
    body = bytearray()
    async for chunk in req.stream():
        body.extend(chunk)
        if len(body)>1000000:
            raise HTTPException(413)
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.request(req.method, f"{UI}/{path}", params=req.query_params, content=bytes(body),
                                        headers={"x-deltasan-voice":"1"} if path.startswith("api/voice/") else {})
    return Response(response.content, status_code=response.status_code, headers={
        "Content-Type":response.headers.get("content-type","application/octet-stream"),
        "Cache-Control": "public, max-age=31536000, immutable" if path.startswith("_next/static/") else "no-store",
        "Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff",
        "Content-Security-Policy":"frame-ancestors " + os.getenv("DELTA_EMBED_ORIGINS","'self' https: http://localhost:* http://127.0.0.1:*")})
