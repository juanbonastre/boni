"""Live changes for the clients (`GET /api/v1/events`, server-sent events): what changed, so they load it again
instead of polling. In memory: a client that reconnects loads everything once."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime

from boni.contract import ChangeEvent


class Events:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[ChangeEvent]] = set()

    def publish(self, what: str) -> None:
        event = ChangeEvent(what=what, at=datetime.now(UTC))  # type: ignore[arg-type]
        for q in list(self._subscribers):
            if q.full():  # a client that does not read: drop its oldest event
                q.get_nowait()
            q.put_nowait(event)

    async def stream(self, heartbeat_s: float = 25.0) -> AsyncIterator[str]:
        """The SSE text for one client: `changed` events, and a comment now and then so proxies keep it open."""
        q: asyncio.Queue[ChangeEvent] = asyncio.Queue(maxsize=50)
        self._subscribers.add(q)
        try:
            yield ": connected\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=heartbeat_s)
                except TimeoutError:
                    yield ": ping\n\n"
                    continue
                yield f"event: changed\ndata: {event.model_dump_json()}\n\n"
        finally:
            self._subscribers.discard(q)

    @property
    def listeners(self) -> int:
        return len(self._subscribers)
