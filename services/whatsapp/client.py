import os
import re
from typing import Protocol

import httpx


class WhatsAppCloudAPI:
    def __init__(self, client: httpx.Client):
        version = os.environ["WHATSAPP_GRAPH_API_VERSION"]
        phone_id = os.environ["WHATSAPP_PHONE_NUMBER_ID"]
        token = os.environ["WHATSAPP_ACCESS_TOKEN"]
        if not re.fullmatch(r"v[0-9]+\.[0-9]+", version) or not re.fullmatch(r"[0-9]+", phone_id) or not token.strip():
            raise ValueError("Configure the Graph API version, phone ID, and access token.")
        self.client = client
        self.url = f"https://graph.facebook.com/{version}/{phone_id}/messages"
        self.authorization = f"Bearer {token}"

    def send_text(self, recipient: str, body: str):
        return self._send(recipient, "text", {"body": body})

    def send_template(self, recipient: str, name: str, language: str, components: list | None = None):
        template = {"name": name, "language": {"code": language}}
        if components is not None:
            template["components"] = components
        return self._send(recipient, "template", template)

    def _send(self, recipient, kind, content):
        response = self.client.post(
            self.url,
            headers={"Authorization": self.authorization},
            json={"messaging_product": "whatsapp", "to": recipient, "type": kind, kind: content},
            timeout=15,
            follow_redirects=False,
        )
        response.raise_for_status()
        return response.json()

class MessagingConnector(Protocol):
    def send_text(self, recipient: str, body: str) -> dict: ...


class EvolutionAPI:
    def __init__(self, client: httpx.Client, instance: str):
        self.client = client
        self.instance = instance

    def send_text(self, recipient: str, body: str) -> dict:
        response = self.client.post(
            f"/message/sendText/{self.instance}", json={"number": recipient, "text": body}
        )
        response.raise_for_status()
        return response.json()

