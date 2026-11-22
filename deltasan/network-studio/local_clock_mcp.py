"""Read-only local clock for DeltaSAN agents. Run with the Studio Python environment."""
from datetime import datetime
from zoneinfo import ZoneInfo
from mcp.server.fastmcp import FastMCP

server = FastMCP("DeltaSAN clock", host="127.0.0.1", port=45186, stateless_http=True)

@server.tool()
def current_time(timezone: str = "UTC") -> str:
    """Return the current date and time in an IANA timezone such as Asia/Kolkata or UTC."""
    return datetime.now(ZoneInfo(timezone)).isoformat(timespec="seconds")

if __name__ == "__main__":
    server.run(transport="streamable-http")

