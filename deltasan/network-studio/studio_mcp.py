"""Configure the HTTP client used for the You.com MCP connection."""

from functools import partial
from urllib.parse import urlsplit

import httpx
from langchain_mcp_adapters.client import MultiServerMCPClient
from neuro_san.internals.run_context.langchain.mcp import langchain_mcp_adapter


def configure_you_transport():
    # Neuro SAN forwards headers from HOCON. Supply the adapter's Python-only
    # client factory here so this endpoint can negotiate HTTP/2 for SSE.
    def studio_client(connections, **kwargs):
        configured = {}
        for name, connection in connections.items():
            url = urlsplit(connection.get("url", ""))
            if connection.get("transport") == "streamable_http" and (
                url.scheme, url.hostname, url.path
            ) == ("https", "api.you.com", "/mcp"):
                connection = dict(connection)
                connection.setdefault("httpx_client_factory", partial(httpx.AsyncClient, http2=True))
            configured[name] = connection
        return MultiServerMCPClient(configured, **kwargs)

    langchain_mcp_adapter.MultiServerMCPClient = studio_client
