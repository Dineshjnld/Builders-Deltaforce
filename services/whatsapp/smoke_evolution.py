"""Replay synthetic Evolution events through the running demo without sending WhatsApp messages."""
import base64
import os
import sqlite3
from contextlib import closing
from uuid import uuid4

import httpx

from .evolution import INSTANCE


def main():
    marker = uuid4().hex[:10]
    sample = b"synthetic attachment payload"
    encoded = base64.b64encode(sample).decode()
    fixtures = [
        ("text", {"conversation": f"SYNTHETIC {marker}: Application reference = DEMO-42."}),
        ("image", {"imageMessage": {"caption": f"SYNTHETIC {marker}: Supporting application document.", "mimetype": "image/png"},
                   "base64": encoded}),
        ("voice", {"audioMessage": {"mimetype": "audio/ogg", "ptt": True}, "base64": encoded}),
    ]
    with httpx.Client(base_url="http://127.0.0.1:8788", timeout=10) as intake:
        for kind, content in fixtures:
            event = {
                "event": "messages.upsert", "instance": INSTANCE,
                "data": {
                    "key": {"id": f"fixture-{marker}-{kind}", "remoteJid": "15550100001@s.whatsapp.net",
                            "fromMe": False},
                    "message": content,
                },
            }
            assert intake.post("/webhooks/evolution", json=event).status_code == 403
            headers = {"X-Evolution-Webhook-Key": os.environ["EVOLUTION_WEBHOOK_KEY"]}
            for stored in (True, False):
                result = intake.post("/webhooks/evolution", json=event, headers=headers)
                result.raise_for_status()
                assert result.json() == {"stored": stored}, result.json()

    with closing(sqlite3.connect(os.environ["DB_PATH"])) as db:
        rows = db.execute(
            "SELECT case_id, attachment FROM evolution_messages WHERE provider_id LIKE ?",
            (f"fixture-{marker}-%",),
        ).fetchall()
        assert len(rows) == 3 and sum(blob == sample for _, blob in rows) == 2
    ids = {case_id for case_id, _ in rows}
    with httpx.Client(base_url="http://fieldos:8787", timeout=10) as dashboard:
        login = dashboard.post("/api/login", json={
            "email": "officer@studio.example", "password": "AgentStudio-demo-2026"
        })
        login.raise_for_status()
        response = dashboard.get("/api/cases")
        response.raise_for_status()
        cases = [case for case in response.json() if case["id"] in ids]
        assert {case["message_type"] for case in cases} == {"text", "image", "voice"}
        assert sum(case["has_attachment"] for case in cases) == 2
        denied = dashboard.post(f"/api/cases/{cases[0]['id']}/response", json={"text": "Synthetic"})
        assert denied.status_code == 403
    print(f"Replay {marker}: three visible dashboard API cases, two stored attachments, "
          "duplicates suppressed, invalid webhook key and officer send denied.")


if __name__ == "__main__":
    main()
