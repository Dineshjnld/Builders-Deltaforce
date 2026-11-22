import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

with patch.dict(os.environ, DELTA_CITY_TOKEN="test-local-publisher"):
    import city_server as city


class LocalDeploymentTest(unittest.TestCase):
    def test_upload_stop_and_resume_the_same_copy(self):
        spec = {"tools": [{"name": "Editor", "function": {"description": "Edit notes"}, "instructions": "Edit notes."}]}
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            registry = root / "registries/city"
            registry.mkdir(parents=True)
            (registry.parent / "manifest.hocon").write_text("{}")
            with patch.multiple(city, ROOT=root, CITY=registry, INDEX=registry / "deployments.json"), TestClient(
                city.app, base_url="http://localhost:45187", headers={"Origin": "http://localhost:45187"}
            ) as client:
                uploaded = client.post("/deployments", data={"name": "Notes", "org_name": "Operations"},
                                       files={"file": ("notes.hocon", json.dumps(spec))})
                self.assertEqual(uploaded.status_code, 202)
                key = uploaded.json()["id"]
                manifest = registry / "manifest.hocon"
                self.assertIn("city/" + key + ".hocon", json.loads(manifest.read_text()))
                self.assertEqual(client.delete("/deployments/" + key).json()["status"], "stopped")
                self.assertEqual(json.loads(manifest.read_text()), {})
                self.assertEqual(client.post(f"/deployments/{key}/publish").json()["id"], key)
                with patch.object(city, "runtime_networks", AsyncMock(return_value={"city/" + key})):
                    self.assertEqual(client.get("/directory").json()["deployments"][0]["status"], "ready")

    def test_rejects_external_includes_and_unknown_tools(self):
        with self.assertRaises(ValueError):
            city.validate_source('include "outside.hocon"')
        with self.assertRaises(ValueError):
            city.validate_source(json.dumps({"tools": [{"name": "Editor", "instructions": "Edit", "function": {},
                                                        "tools": ["missing"]}]}))


if __name__ == "__main__":
    unittest.main()
