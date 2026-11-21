import base64
import binascii
import hmac
import json
import os
import re
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from uuid import uuid4

import httpx
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from .client import EvolutionAPI, MessagingConnector

INSTANCE = "deltaforce-demo"
DIRECT = re.compile(r"([0-9]{5,20})@(s\.whatsapp\.net|lid)")
MAX_BODY = 12 * 1024 * 1024


class Approval(BaseModel):
    case_id: str
    org: str
    department: str
    approver: str
    body: str = Field(min_length=1, max_length=4096)


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def audit(db, action, subject, detail):
    db.execute(
        "INSERT INTO whatsapp_audit(timestamp,action,subject,detail) VALUES(?,?,?,?)",
        (utc_now(), action, subject, detail),
    )


def normalize(data):
    key, message = data.get("key"), data.get("message")
    if not isinstance(key, dict) or not isinstance(message, dict) or key.get("fromMe") is not False:
        return None
    sender, provider_id = key.get("remoteJid"), key.get("id")
    if not isinstance(sender, str) or not DIRECT.fullmatch(sender):
        return None
    if not isinstance(provider_id, str) or not 1 <= len(provider_id) <= 200:
        return None
    alternate = key.get("remoteJidAlt")
    if sender.endswith("@lid") and isinstance(alternate, str) and DIRECT.fullmatch(alternate):
        sender = alternate

    text = message.get("conversation")
    if isinstance(message.get("extendedTextMessage"), dict):
        text = message["extendedTextMessage"].get("text")
    if isinstance(text, str):
        return provider_id, sender, "text", text, None, None

    for field, kind in (("imageMessage", "image"), ("audioMessage", "voice")):
        media = message.get(field)
        if isinstance(media, dict):
            mime = media.get("mimetype")
            caption = media.get("caption")
            attachment = None
            encoded = message.get("base64")
            if isinstance(encoded, str):
                try:
                    attachment = base64.b64decode(encoded, validate=True)
                except (ValueError, binascii.Error):
                    pass
            return provider_id, sender, kind, caption if isinstance(caption, str) else None, (
                mime if isinstance(mime, str) else None
            ), attachment
    return None


def create_app():
    database = os.environ["DB_PATH"]
    webhook_key = os.environ["EVOLUTION_WEBHOOK_KEY"].encode()
    approval_key = os.environ["EVOLUTION_APPROVAL_KEY"].encode()
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    def connect():
        db = sqlite3.connect(database)
        db.execute("PRAGMA foreign_keys=ON")
        return db

    def authorize(request, header, key):
        if not hmac.compare_digest(request.headers.get(header, "").encode(), key):
            raise HTTPException(403, "Invalid connector key")

    def receive(payload):
        event, data = payload.get("event"), payload.get("data")
        if payload.get("instance") != INSTANCE or not isinstance(data, dict):
            return {"stored": False}
        if event == "connection.update":
            state = data.get("state") or data.get("connectionStatus")
            if state in ("open", "close", "connecting"):
                reason = data.get("statusReason")
                detail = f"{state} ({reason})" if isinstance(reason, int) else state
                with closing(connect()) as db, db:
                    audit(db, "connection", INSTANCE, detail)
            return {"stored": False}
        normalized = normalize(data) if event == "messages.upsert" else None
        if normalized is None:
            return {"stored": False}

        provider_id, sender, kind, text, mime, attachment = normalized
        case_id = str(uuid4())
        with closing(connect()) as db, db:
            inserted = db.execute(
                """
                INSERT INTO cases(id, org, department, whatsapp_message_id, sender,
                                  message_type, message_text, received_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(whatsapp_message_id) DO NOTHING
                """,
                (case_id, os.environ["WHATSAPP_CASE_ORG"], os.environ["WHATSAPP_CASE_DEPARTMENT"],
                 f"evolution:{INSTANCE}:{provider_id}", sender, kind, text, utc_now()),
            ).rowcount
            if inserted:
                db.execute(
                    "INSERT INTO evolution_messages VALUES(?,?,?,?,?)",
                    (case_id, INSTANCE, provider_id, mime, attachment),
                )
                audit(db, "case_created", case_id, kind)
        return {"stored": bool(inserted)}

    @app.get("/health")
    def health():
        with closing(connect()) as db:
            db.execute("SELECT 1 FROM evolution_messages LIMIT 1")
        return {"ok": True}

    @app.post("/webhooks/evolution")
    async def webhook(request: Request):
        authorize(request, "X-Evolution-Webhook-Key", webhook_key)
        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > MAX_BODY:
                raise HTTPException(413, "Webhook payload too large")
            body.extend(chunk)
        try:
            payload = json.loads(body)
        except (ValueError, UnicodeError):
            raise HTTPException(400, "Invalid webhook JSON") from None
        if not isinstance(payload, dict):
            raise HTTPException(400, "Invalid webhook envelope")
        return await run_in_threadpool(receive, payload)

    @app.get("/internal/device-state")
    def device_state(request: Request):
        authorize(request, "X-Approval-Key", approval_key)
        try:
            response = httpx.get(os.environ["EVOLUTION_URL"] + "/instance/connectionState/" + INSTANCE,
                                 headers={"apikey": os.environ["EVOLUTION_API_KEY"]}, timeout=2)
            response.raise_for_status()
            state = response.json()["instance"]["state"]
        except (httpx.HTTPError, KeyError, ValueError, TypeError):
            state = "unknown"
        return {"state": state if state in ("open", "close", "connecting") else "unknown"}

    @app.post("/internal/approved-response")
    def approved_response(approval: Approval, request: Request):
        authorize(request, "X-Approval-Key", approval_key)
        with closing(connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                """
                SELECT c.sender FROM cases c JOIN evolution_messages e ON c.id=e.case_id
                WHERE c.id=? AND c.org=? AND c.department=? AND e.provider_id NOT LIKE 'fixture-%'
                """, (approval.case_id, approval.org, approval.department)
            ).fetchone()
            if row is None:
                raise HTTPException(404, "Case not found")
            recipient = DIRECT.fullmatch(row[0])
            if recipient is None or recipient[2] != "s.whatsapp.net":
                raise HTTPException(409, "No phone-number address is available for this sender")
            if db.execute("SELECT 1 FROM whatsapp_responses WHERE case_id=?", (approval.case_id,)).fetchone():
                raise HTTPException(409, "This case already has an approved send attempt")
            db.execute(
                "INSERT INTO whatsapp_responses VALUES(?,?,?,'sending',NULL)",
                (approval.case_id, approval.approver, approval.body),
            )
            audit(db, "response_approved", approval.case_id, approval.approver)

        provider_id = None
        try:
            with httpx.Client(
                base_url=os.environ["EVOLUTION_URL"],
                headers={"apikey": os.environ["EVOLUTION_API_KEY"]},
                timeout=15,
            ) as client:
                connector: MessagingConnector = EvolutionAPI(client, INSTANCE)
                result = connector.send_text(recipient[1], approval.body)
                provider_id = result["key"]["id"]
        except (httpx.HTTPError, ValueError, TypeError, KeyError):
            pass
        state = "accepted" if isinstance(provider_id, str) and provider_id else "uncertain"
        with closing(connect()) as db, db:
            db.execute(
                "UPDATE whatsapp_responses SET state=?,provider_id=? WHERE case_id=?",
                (state, provider_id if state == "accepted" else None, approval.case_id),
            )
            audit(db, "response_" + state, approval.case_id, approval.approver)
        if state == "uncertain":
            raise HTTPException(502, "Send outcome is uncertain. Check the test account before retrying.")
        return {"state": state}

    return app

