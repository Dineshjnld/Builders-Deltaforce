import os
import sqlite3
import unittest
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi.testclient import TestClient

from .evolution import INSTANCE, create_app


class ApprovalTests(unittest.TestCase):
    def test_approved_response_dispatches_once_and_records_provider_id(self):
        with TemporaryDirectory() as folder:
            database = str(Path(folder) / "test.sqlite")
            with closing(sqlite3.connect(database)) as db, db:
                migrations = Path(__file__).resolve().parents[2] / "infrastructure/migrations"
                for migration in sorted(migrations.glob("*.sql")):
                    db.executescript(migration.read_text(encoding="utf-8-sig"))
                db.execute("INSERT INTO organizations VALUES('demo','Demo')")
            env = {
                "DB_PATH": database,
                "WHATSAPP_CASE_ORG":"demo",
                "WHATSAPP_CASE_DEPARTMENT":"Sanitation",
                "EVOLUTION_WEBHOOK_KEY": "test-webhook",
                "EVOLUTION_APPROVAL_KEY": "test-approval",
                "EVOLUTION_URL": "http://provider.invalid",
                "EVOLUTION_API_KEY": "test-provider",
            }
            with patch.dict(os.environ, env), patch(
                "services.whatsapp.evolution.EvolutionAPI.send_text",
                return_value={"key": {"id": "provider-result"}},
            ) as send, TestClient(create_app()) as client:
                webhook = client.post(
                    "/webhooks/evolution",
                    headers={"X-Evolution-Webhook-Key": env["EVOLUTION_WEBHOOK_KEY"]},
                    json={
                        "instance": INSTANCE,
                        "event": "messages.upsert",
                        "data": {
                            "key": {"id": "outbound-test", "remoteJid": "15550100001@s.whatsapp.net",
                                    "fromMe": False},
                            "message": {"conversation": "Synthetic complaint"},
                        },
                    },
                )
                self.assertEqual(webhook.json(), {"stored": True})
                with closing(sqlite3.connect(database)) as db:
                    case_id = db.execute("SELECT id FROM cases").fetchone()[0]
                approval = {"case_id": case_id, "org": "demo", "department": "Sanitation",
                            "approver": "test supervisor", "body": "Test approval"}
                endpoint = "/internal/approved-response"
                headers = {"X-Approval-Key": env["EVOLUTION_APPROVAL_KEY"]}
                self.assertEqual(client.post(endpoint, json=approval).status_code, 403)
                wrong_org = dict(approval, org="other")
                self.assertEqual(client.post(endpoint, json=wrong_org, headers=headers).status_code, 404)
                self.assertEqual(client.post(endpoint, json=approval, headers=headers).json(), {"state": "accepted"})
                self.assertEqual(client.post(endpoint, json=approval, headers=headers).status_code, 409)
                send.assert_called_once_with("15550100001", "Test approval")
                with closing(sqlite3.connect(database)) as db:
                    self.assertEqual(
                        db.execute("SELECT state,provider_id FROM whatsapp_responses").fetchone(),
                        ("accepted", "provider-result"),
                    )
                    self.assertEqual(
                        db.execute("SELECT action FROM whatsapp_audit ORDER BY id").fetchall(),
                        [("case_created",), ("response_approved",), ("response_accepted",)],
                    )
