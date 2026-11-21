import hashlib
import hmac
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from services.whatsapp.app import create_app
from services.whatsapp.client import WhatsAppCloudAPI


SETTINGS = {
    "WHATSAPP_APP_SECRET": "synthetic-secret",
    "WHATSAPP_VERIFY_TOKEN": "synthetic-verify",
    "WHATSAPP_PHONE_NUMBER_ID": "123",
    "WHATSAPP_CASE_ORG": "demo",
    "WHATSAPP_CASE_DEPARTMENT": "Sanitation",
    "WHATSAPP_GRAPH_API_VERSION": "v27.0",
    "WHATSAPP_ACCESS_TOKEN": "synthetic-access",
}
TEXT = "<b>Synthetic pothole on Oak Street</b>"
ROUTE = "/webhooks/whatsapp"


def signed_event(value, field="messages"):
    body = json.dumps({
        "object": "whatsapp_business_account",
        "entry": [{"id": "456", "changes": [{"field": field, "value": value}]}],
    }).encode()
    signature = hmac.new(SETTINGS["WHATSAPP_APP_SECRET"].encode(), body, hashlib.sha256)
    return body, {"X-Hub-Signature-256": "sha256=" + signature.hexdigest()}


class WebhookTests(unittest.TestCase):
    def setUp(self):
        self.directory = self.enterContext(tempfile.TemporaryDirectory())
        environment = {
            **SETTINGS, "DB_PATH": str(Path(self.directory) / "test.sqlite"),
            "DELTA_DEMO": "1", "PORT": "0", "HOST": "127.0.0.1", "DELTA_HTTPS": "0",
        }
        self.enterContext(patch.dict(os.environ, environment))
        self.server = subprocess.Popen(
            ["node", "services/api/server.mjs"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        self.addCleanup(self.stop_server)
        # Node reports its ephemeral address once the database and migrations are ready.
        for line in self.server.stdout:
            if line.startswith("FieldOS listening on port "):
                self.base_url = "http://127.0.0.1:" + line.split()[-1]
                break
        else:
            self.fail("FieldOS server failed to start")
        self.dashboard = self.enterContext(httpx.Client(base_url=self.base_url, timeout=5))
        self.webhook = self.enterContext(TestClient(create_app()))

    def stop_server(self):
        self.server.terminate()
        self.server.communicate(timeout=5)

    def test_verification(self):
        query = {"hub.mode": "subscribe", "hub.verify_token": SETTINGS["WHATSAPP_VERIFY_TOKEN"],
                 "hub.challenge": "012345"}
        reply = self.webhook.get(ROUTE, params=query)
        self.assertEqual((reply.status_code, reply.text), (200, "012345"))
        query["hub.verify_token"] = "wrong"
        self.assertEqual(self.webhook.get(ROUTE, params=query).status_code, 403)

    def test_signed_delivery_and_replay_reach_only_scoped_dashboard(self):
        self.assertEqual(self.dashboard.get("/api/cases").status_code, 401)
        event = {"metadata": {"phone_number_id": "123"}, "messages": [
            {"from": "15550101010", "id": "wamid.synthetic.text", "type": "text",
             "text": {"body": TEXT}},
            {"from_user_id": "US.synthetic", "id": "wamid.synthetic.image", "type": "image"},
        ]}
        body, headers = signed_event(event)
        self.assertEqual(self.webhook.post(ROUTE, content=body).status_code, 403)
        self.assertEqual(self.webhook.post(ROUTE, content=body + b" ", headers=headers).status_code, 403)
        event["metadata"]["phone_number_id"] = "999"
        other_body, other_headers = signed_event(event)
        self.assertEqual(self.webhook.post(ROUTE, content=other_body, headers=other_headers).status_code, 200)

        status_body, status_headers = signed_event({
            "metadata": {"phone_number_id": "123"}, "statuses": [{"id": "wamid.sent"}],
        })
        self.assertEqual(self.webhook.post(ROUTE, content=status_body, headers=status_headers).status_code, 200)
        login = self.dashboard.post("/api/login", json={
            "email": "admin@vennela.example", "password": "FieldOS-demo-2026",
        })
        login.raise_for_status()
        self.assertEqual(self.dashboard.get("/api/cases").json(), [])

        for _ in range(2):
            self.assertEqual(self.webhook.post(ROUTE, content=body, headers=headers).status_code, 200)
        cases = self.dashboard.get("/api/cases").json()
        self.assertEqual(len(cases), 2)
        self.assertEqual({row["message_type"]: row["message_text"] for row in cases},
                         {"text": TEXT, "image": None})
        self.assertNotIn("sender", cases[0])

        other = {"name": "Synthetic workspace", "department": "Sanitation",
                 "email": "other@example.test", "password": "Synthetic-password"}
        self.dashboard.post("/api/organizations", json=other).raise_for_status()
        self.dashboard.post("/api/login", json=other).raise_for_status()
        self.assertEqual(self.dashboard.get("/api/cases").json(), [])


class CloudAPITests(unittest.TestCase):
    @patch.dict(os.environ, SETTINGS)
    def test_official_requests_and_graph_error(self):
        requests = []

        def graph(request):
            self.assertEqual(str(request.url), "https://graph.facebook.com/v27.0/123/messages")
            self.assertEqual(request.headers["Authorization"], "Bearer synthetic-access")
            requests.append(json.loads(request.content))
            if len(requests) == 3:
                return httpx.Response(400, json={"error": {"message": "Synthetic Graph error"}})
            return httpx.Response(200, json={"messages": [{"id": "wamid.outbound"}]})

        with httpx.Client(transport=httpx.MockTransport(graph)) as transport:
            client = WhatsAppCloudAPI(transport)
            self.assertEqual(client.send_text("15550101010", "Received")["messages"][0]["id"],
                             "wamid.outbound")
            client.send_template("15550101010", "hello_world", "en_US")
            with self.assertRaises(httpx.HTTPStatusError):
                client.send_text("15550101010", "Rejected")

        common = {"messaging_product": "whatsapp", "to": "15550101010"}
        self.assertEqual(requests[0], {**common, "type": "text", "text": {"body": "Received"}})
        self.assertEqual(requests[1], {**common, "type": "template",
                                     "template": {"name": "hello_world", "language": {"code": "en_US"}}})
