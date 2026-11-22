import unittest
from middleware.connectors import select_tools
from middleware.design_brief import collect
from ai_settings import domain_theme


class ReleaseTests(unittest.TestCase):
    def test_only_requested_connector_is_bound(self):
        agents = [{"name":"Desk","task":"Receive a request","tools":["mospi","clock","gov_weather","gov_services"]},
                  {"name":"Revenue","task":"Find official income certificate guidance","tools":["gov_weather","gov_services"]}]
        brief = {"goal":"Telangana MeeSeva income certificate guidance","inputs":"Official state service directory"}
        select_tools({"agents":agents},brief," ".join(brief.values()))
        self.assertEqual([tool for a in agents for tool in a["tools"]],["gov_services"])
        select_tools({"agents":agents},{"inputs":"chat only"},"chat only")
        self.assertFalse(any(a["tools"] for a in agents))

    def test_voice_revision_requires_confirmation(self):
        data = {}
        for text in ("Design a library desk","Patrons","Chat only","Suggest renewals"):
            collect(data,text)
        data["studio_network"] = "deltaforce/library"
        self.assertIn("Proposed network edit",collect(data,"Add a circulation specialist")[0])
        self.assertIn("circulation specialist",collect(data,"build it")[1])
        self.assertIn("School librarians",collect(data,"Change the audience to School librarians")[0])

    def test_contextual_theme_without_remote_key(self):
        self.assertEqual(domain_theme({"name":"Hospital appointments"}),"health")
        self.assertEqual(domain_theme({"name":"Library Help Desk"}),"library")
