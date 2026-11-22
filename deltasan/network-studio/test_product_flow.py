import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient
from middleware.design_brief import collect

with patch.dict(os.environ, DELTA_CITY_TOKEN="test-only"):
    import customer


class BuilderTests(unittest.TestCase):
    def test_greeting_and_incomplete_confirmation_cannot_build(self):
        data = {}
        for text in ("hi", "build it", "hello"):
            reply, design = collect(data, text)
            self.assertIn("problem", reply)
            self.assertIsNone(design)
        for text in ("Route library questions", "Patrons", "Chat only", "Suggest next steps"):
            self.assertIsNone(collect(data, text)[1])
        self.assertIn("brief", collect(data, "hi")[0])
        self.assertIsNone(collect(data, "Outcome: Ask a librarian to approve fines")[1])
        design = collect(data, "build it")[1]
        self.assertIn("approve fines", design)
        self.assertIn("Patrons", design)
        self.assertIsNone(collect(data, "start over")[1])
        self.assertNotIn("design_brief", data)


class CustomerTests(unittest.TestCase):
    def test_customer_greeting_and_identity_match_each_deployment(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            registry = root / "index.json"
            rows = {key: {"enabled":True, "name":name, "org_name":org, "agents":["Coordinator"], "description":purpose}
                    for key,name,org,purpose in [("library","Library Help Desk","DeltaForce Demo","Answer library circulation questions"),
                                                  ("travel","Travel Desk","Example Travel","Plan trips")]}
            registry.write_text(json.dumps(rows))
            with patch.multiple(customer, REGISTRY=registry, DB=root/"test.db"), TestClient(customer.app) as c:
                for key, profile in rows.items():
                    api = f"/api/customer/{key}"
                    auth = {"Authorization":"Bearer " + c.post(api+"/sessions").json()["token"]}
                    for message in ("hi", "who are you", "Hello, what's your name?"):
                        c.post(api+"/turns", headers=auth, json={"message":message,"id":str(uuid4())}).raise_for_status()
                        turn = c.get(api+"/turns", headers=auth).json()[-1]
                        self.assertEqual(turn["state"], "answered")
                        self.assertIn(profile["name"],turn["answer"])
                        self.assertIn(profile["org_name"],turn["answer"])
                        self.assertIn(profile["description"].lower(),turn["answer"].lower())
                self.assertIsNone(customer.introduction(rows["library"],"Hi, how do I renew a book?",""))

    def test_review_precedes_execution_and_is_scoped_to_session(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            registry = root / "index.json"
            registry.write_text('{"demo":{"enabled":true,"name":"Desk","agents":["Desk"],"org_name":"Test"}}')
            with patch.multiple(customer, REGISTRY=registry, DB=root/"test.db", ADMIN="reviewer"), TestClient(customer.app) as c:
                api = "/api/customer/demo"
                def session():
                    return {"Authorization":"Bearer "+c.post(api+"/sessions").json()["token"]}
                first, second = session(), session()
                admin = {"Authorization":"Bearer reviewer"}
                self.assertEqual(c.get("/operator/reviews",headers=first).status_code,403)
                c.post("/operator/reviews",headers=admin,json={"action":"require","id":"demo"}).raise_for_status()
                body = {"message":"Please review the refund","id":str(uuid4())}
                with patch.object(customer,"run_turn",new_callable=AsyncMock) as execute:
                    for _ in range(2):
                        self.assertEqual(c.post(api+"/turns",headers=first,json=body).json()["state"],"pending")
                    execute.assert_not_awaited()
                    self.assertEqual(c.get(api+"/turns",headers=second).json(),[])
                    decision={"id":body["id"],"action":"approve"}
                    self.assertEqual(c.post("/operator/reviews",headers=first,json=decision).status_code,403)
                    c.post("/operator/reviews",headers=admin,json=decision).raise_for_status()
                    self.assertEqual(c.post("/operator/reviews",headers=admin,json=decision).status_code,409)
                    execute.assert_awaited_once_with("demo",body["id"])
                registry.write_text('{"demo":{"enabled":false}}')
                self.assertEqual(c.get(api+"/turns",headers=first).status_code,404)
                self.assertEqual(c.get("/api/reviews").status_code,404)


if __name__=="__main__":
    unittest.main()
