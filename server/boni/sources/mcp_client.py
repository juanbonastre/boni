"""Generic MCP client for data sources (Streamable HTTP, protocol 2026-07-28, official SDK).

One short-lived connection per batch of calls (`async with source.connect() as s`): MCP is stateless since 2026-07-28,
so there is nothing to keep open, and a NAS restart of the source never leaves Boni with a dead session.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Any

import httpx2
from mcp import Client
from mcp.types import Implementation

from boni import VERSION


class SourceError(Exception):
    """The source answered but refused or failed the call (bad arguments, file exists...). Not worth retrying."""


class SourceUnavailable(Exception):
    """The source could not be reached (network, auth, server down). Worth retrying later."""


ServerFactory = Callable[[], Any]


class McpSource:
    """`target` is a URL (production) or a factory returning an in-process MCP server (tests)."""

    def __init__(self, name: str, target: str | ServerFactory, token: str = "", timeout_s: float = 30.0):
        self.name = name
        self._target = target
        self._token = token
        self._timeout = timeout_s

    @property
    def configured(self) -> bool:
        return bool(self._target)

    @asynccontextmanager
    async def connect(self) -> AsyncIterator[Session]:
        if not self._target:
            raise SourceUnavailable(f"{self.name}: not configured")
        info = Implementation(name="boni", version=VERSION)
        in_body = False
        try:
            if isinstance(self._target, str):
                from mcp.client.streamable_http import streamable_http_client

                headers = {"Authorization": f"Bearer {self._token}"} if self._token else {}
                async with httpx2.AsyncClient(headers=headers, timeout=self._timeout) as http:
                    transport = streamable_http_client(self._target, http_client=http)
                    async with Client(transport, client_info=info, read_timeout_seconds=self._timeout) as c:
                        in_body = True
                        yield Session(self.name, c)
            else:
                async with Client(self._target(), client_info=info) as c:
                    in_body = True
                    yield Session(self.name, c)
        except BaseException as e:
            # Over HTTP the SDK's task groups wrap whatever leaves the body in an ExceptionGroup: unwrap it, so callers
            # see the SourceError / SourceUnavailable they expect. Errors from the caller's body pass through; only
            # connecting is translated.
            inner = _unwrap(e)
            if isinstance(inner, (SourceError, SourceUnavailable)) or (in_body and isinstance(inner, Exception)):
                if inner is e:
                    raise
                raise inner from None
            if not isinstance(inner, Exception):
                raise
            raise SourceUnavailable(f"{self.name}: {type(inner).__name__}: {inner}") from e


def _unwrap(e: BaseException) -> BaseException:
    while isinstance(e, BaseExceptionGroup) and len(e.exceptions) == 1:
        e = e.exceptions[0]
    return e


class Session:
    def __init__(self, name: str, client: Client):
        self.name = name
        self._c = client

    async def call(self, tool: str, arguments: dict[str, Any]) -> Any:
        """Call a tool and return its JSON result (structured content, or the JSON text of the first content block)."""
        try:
            r = await self._c.call_tool(tool, arguments)
        except Exception as e:
            raise SourceUnavailable(f"{self.name}.{tool}: {type(e).__name__}: {e}") from e
        text = "".join(getattr(b, "text", "") for b in r.content)
        if r.is_error:
            raise SourceError(f"{self.name}.{tool}: {text or 'error'}")
        if r.structured_content is not None:
            return r.structured_content
        try:
            return json.loads(text)
        except ValueError:
            return text
