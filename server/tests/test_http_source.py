"""The production path: McpSource over Streamable HTTP with a bearer token, against the fake vault served by uvicorn
(stateless + JSON responses, like vault-mcp)."""

import asyncio
import socket
import threading
import time

import pytest
import uvicorn
from starlette.types import ASGIApp, Receive, Scope, Send

from boni.sources.finanzas import FinanzasSource
from boni.sources.mcp_client import McpSource, SourceUnavailable

TOKEN = "test-token-not-a-secret"


class BearerCheck:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and dict(scope["headers"]).get(b"authorization") != f"Bearer {TOKEN}".encode():
            await send({"type": "http.response.start", "status": 401, "headers": []})
            await send({"type": "http.response.body", "body": b"unauthorized"})
            return
        await self.app(scope, receive, send)


@pytest.fixture
def http_url(vault):
    app = BearerCheck(vault.server().streamable_http_app(stateless_http=True, json_response=True))
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="on"))
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    yield f"http://127.0.0.1:{port}/mcp"
    server.should_exit = True
    t.join(5)


def test_reads_over_http_with_token(http_url):
    fin = FinanzasSource(McpSource("vault", http_url, TOKEN))
    cats = asyncio.run(fin.categories())
    assert "comida/restaurante" in cats
    movements = asyncio.run(fin.movements([(2026, 9)]))
    assert {m.name for m in movements} >= {"2026-09-18-2258-kumo"}


def test_wrong_token_is_unavailable(http_url):
    fin = FinanzasSource(McpSource("vault", http_url, "wrong"))
    with pytest.raises(SourceUnavailable):
        asyncio.run(fin.categories())


def test_unreachable_url_is_unavailable():
    fin = FinanzasSource(McpSource("vault", "http://127.0.0.1:9/mcp", TOKEN, timeout_s=2))
    with pytest.raises(SourceUnavailable):
        asyncio.run(fin.categories())
