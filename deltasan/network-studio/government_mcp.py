"""Read-only civic service and weather sources for Andhra Pradesh and Telangana."""
import json
import re
import sys
from pathlib import Path
from datetime import datetime, timezone
from html.parser import HTMLParser

import httpx
from mcp.server.fastmcp import FastMCP

sources = json.loads(Path(__file__).with_name("government_sources.json").read_text(encoding="utf-8"))
services = FastMCP("State service directory", host="127.0.0.1", port=45210, stateless_http=True)
weather = FastMCP("Regional IMD observations", host="127.0.0.1", port=45211, stateless_http=True)
centres = {"Telangana":"hyderabad","Andhra Pradesh":"amaravati"}


@services.tool()
def search_services(state: str, query: str) -> list[dict]:
    """Find official AP or Telangana service guidance. Supply the full state name and topic."""
    words = set(re.findall(r"\w+",query.casefold())) - {"and","the","for","pradesh","andhra","telangana"}
    ranked = []
    for row in sources:
        if row["state"].casefold() != state.strip().casefold():
            continue
        terms = set(re.findall(r"\w+"," ".join([row["title"],row["department"],*row["topics"]]).casefold()))
        score = len(words & terms)
        if score:
            ranked.append((score,row))
    return [r for _,r in sorted(ranked,key=lambda pair:-pair[0])[:4]]


class PageText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hidden = 0
        self.parts = []

    def handle_starttag(self,tag,attrs):
        if tag in ("style","script"): self.hidden += 1

    def handle_endtag(self,tag):
        if tag in ("style","script"): self.hidden = max(0,self.hidden-1)

    def handle_data(self,data):
        if not self.hidden and data.strip(): self.parts.append(" ".join(data.split()))


async def page_text(url):
    async with httpx.AsyncClient(timeout=9,headers={"User-Agent":"DeltaSAN-Civic/1.0"}) as client:
        async with client.stream("GET",url) as r:
            r.raise_for_status()
            text = ""
            async for part in r.aiter_text():
                text += part
                if len(text)>=650000: break
    page = PageText()
    page.feed(text[:650000])
    return " ".join(page.parts)


@services.tool()
async def read_service(service_id: str) -> dict:
    """Read an official page by ID returned from search_services. Cite its URL and defer transactions to the department."""
    row = next((row for row in sources if row["id"]==service_id),None)
    if not row: return {"error":"Unknown service"}
    text = await page_text(row["url"])
    at = next((i for term in row["topics"] if (i:=text.lower().find(term.lower()))>=0),0)
    return {**row,"retrieved_at":datetime.now(timezone.utc).isoformat(),"excerpt":text[max(0,at-120):at+3000]}


@weather.tool()
async def read_imd_observations(state: str) -> dict:
    """Read the official regional weather page. Supply Andhra Pradesh or Telangana. Quote observation times and units from the source."""
    centre = centres.get(state)
    if not centre: return {"error":"Choose Andhra Pradesh or Telangana"}
    url = "https://mausam.imd.gov.in/"+centre+"/"
    text = await page_text(url)
    at = text.lower().find("current weather across major cities")
    return {"source":url,"retrieved_at":datetime.now(timezone.utc).isoformat(),
            "observations":text[at:at+1600] if at>=0 else None}


if __name__ == "__main__":
    (weather if sys.argv[1:] == ["weather"] else services).run(transport="streamable-http")
