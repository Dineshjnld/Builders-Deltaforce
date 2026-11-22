"""Loopback-only OpenAI-compatible inference with pre-response failover."""
import os
import json

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse, Response
from ai_settings import setting

app = FastAPI(docs_url=None, openapi_url=None, redoc_url=None)


@app.post("/v1/chat/completions")
async def complete(req: Request):
    body = await req.json()
    primary = os.getenv("DELTA_PRIMARY_URL", "http://127.0.0.1:45185/v1")
    candidates = [(primary, None, "local-qwen")]
    key = setting("OPENAI_API_KEY")
    if key:
        candidates.append(("https://api.openai.com/v1", key, setting("OPENAI_FALLBACK_MODEL","gpt-4.1-mini")))
    for base, token, model in candidates:
        data = {**body, "model":model}
        if token and "max_tokens" in data:
            data["max_completion_tokens"] = data.pop("max_tokens")
        # Leave time for a standby completion inside Studio's 120-second request budget.
        timeout = 75 if token else (22 if key else 110)
        client = httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=4))
        response = None
        try:
            # Never forward caller-supplied provider credentials.
            headers = {"Authorization":"Bearer "+token} if token else {}
            request = client.build_request("POST",base+"/chat/completions",json=data,headers=headers)
            response = await client.send(request,stream=True)
            if response.status_code >= 400:
                if response.status_code in (408,429) or response.status_code>=500 or (not token and key and response.status_code==400 and body.get("response_format")):
                    await response.aclose()
                    await client.aclose()
                    continue
                raise HTTPException(response.status_code,"Model rejected the request.")
            if data.get("stream"):
                async def chunks():
                    try:
                        async for chunk in response.aiter_bytes():
                            yield chunk
                    finally:
                        await response.aclose()
                        await client.aclose()
                return StreamingResponse(chunks(), media_type="text/event-stream")
            result = json.loads(await response.aread())
            if not result.get("choices"):
                raise ValueError("Missing choices")
            if body.get("response_format",{}).get("type")=="json_schema":
                content = result["choices"][0].get("message",{}).get("content")
                if not isinstance(content,str) or not isinstance(json.loads(content),dict):
                    raise ValueError("Incomplete structured response")
            await response.aclose()
            await client.aclose()
            return Response(json.dumps(result),media_type="application/json")
        except HTTPException:
            await client.aclose()
            raise
        except (httpx.HTTPError, ValueError):
            if response is not None:
                await response.aclose()
            await client.aclose()
    raise HTTPException(503,"Configured inference providers are unavailable.")
