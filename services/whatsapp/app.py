import hashlib
import hmac
import os
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field, ValidationError, model_validator
from starlette.concurrency import run_in_threadpool


class Message(BaseModel):
    id: str = Field(min_length=1)
    phone: str | None = Field(default=None, alias="from")
    user_id: str | None = Field(default=None, alias="from_user_id")
    type: str = Field(min_length=1)
    text: dict[str, str] | None = None

    @model_validator(mode="after")
    def require_sender(self):
        if not (self.user_id or self.phone):
            raise ValueError("Missing WhatsApp sender")
        return self


class MessageUpdate(BaseModel):
    metadata: dict[str, str] = Field(default_factory=dict)
    messages: list[Message] = Field(default_factory=list)


class Change(BaseModel):
    field: str
    value: dict


class Entry(BaseModel):
    changes: list[Change]


class Envelope(BaseModel):
    object: str
    entry: list[Entry]


def create_app():
    app_secret = os.environ["WHATSAPP_APP_SECRET"].encode()
    verify_token = os.environ["WHATSAPP_VERIFY_TOKEN"].encode()
    phone_id = os.environ["WHATSAPP_PHONE_NUMBER_ID"]
    org = os.environ["WHATSAPP_CASE_ORG"]
    department = os.environ["WHATSAPP_CASE_DEPARTMENT"]
    database = os.environ.get("DB_PATH", "var/fieldos.sqlite")
    if not all((app_secret, verify_token, org.strip(), department.strip())) or not (
        phone_id.isascii() and phone_id.isdecimal()
    ):
        raise ValueError("Configure nonempty WhatsApp secrets and routing, and a numeric phone ID.")

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/webhooks/whatsapp")
    def verify(request: Request):
        query = request.query_params
        challenge = query.get("hub.challenge", "")
        if (
            query.get("hub.mode") != "subscribe"
            or not hmac.compare_digest(query.get("hub.verify_token", "").encode(), verify_token)
            or not (challenge.isascii() and challenge.isdecimal())
        ):
            raise HTTPException(403, "Verification failed")
        return PlainTextResponse(challenge)

    @app.post("/webhooks/whatsapp")
    async def receive(request: Request):
        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > 4 * 1024 * 1024:
                raise HTTPException(413, "Webhook payload too large")
            body.extend(chunk)
        signature = request.headers.get("X-Hub-Signature-256", "")
        expected = "sha256=" + hmac.new(app_secret, body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected.encode(), signature.encode()):
            raise HTTPException(403, "Invalid webhook signature")

        try:
            envelope = Envelope.model_validate_json(body)
            messages = []
            if envelope.object == "whatsapp_business_account":
                for entry in envelope.entry:
                    for change in entry.changes:
                        if change.field == "messages":
                            update = MessageUpdate.model_validate(change.value)
                            if update.metadata.get("phone_number_id") == phone_id:
                                messages.extend(update.messages)
        except ValidationError:
            raise HTTPException(400, "Invalid webhook payload") from None

        if messages:
            await run_in_threadpool(save_cases, database, org, department, messages)
        return {"ok": True}

    return app


def save_cases(database, org, department, messages):
    received_at = datetime.now(timezone.utc).isoformat()
    rows = [
        (str(uuid4()), org, department, message.id, message.user_id or message.phone, message.type,
         (message.text or {}).get("body"), received_at)
        for message in messages
    ]
    with closing(sqlite3.connect(database)) as connection, connection:
        connection.execute("PRAGMA foreign_keys=ON")
        connection.executemany(
            """
            INSERT INTO cases (id, org, department, whatsapp_message_id, sender,
                               message_type, message_text, received_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(whatsapp_message_id) DO NOTHING
            """,
            rows,
        )
