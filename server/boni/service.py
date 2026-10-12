"""Boni's logic between the HTTP API and the sources: screens, captures (with outbox), charts, options."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from datetime import UTC, date, datetime
from typing import Any

from boni.contract import (
    ActionRequest,
    ActionResult,
    ButtonComponent,
    ChartCardComponent,
    ChartData,
    Option,
    Screen,
)
from boni.expenses import capture as expense_capture
from boni.expenses.note import ascii_text, base_name, render
from boni.sources.finanzas import FinanzasSource
from boni.sources.mcp_client import SourceError, SourceUnavailable
from boni.stats.charts import compute, months_for
from boni.stats.spending import is_spending, spending_items
from boni.store import Capture, Store

log = logging.getLogger("boni")
QUEUED_MESSAGE = "Guardado en Boni: se escribira en cuanto vuelva la conexion"


class NotFound(Exception):
    pass


class Unavailable(Exception):
    pass


class Service:
    def __init__(self, store: Store, finanzas: FinanzasSource, tz: Any, now: Callable[[], datetime] | None = None):
        self.store = store
        self.fin = finanzas
        self.tz = tz
        self._now = now or (lambda: datetime.now(UTC))
        self._write_lock = asyncio.Lock()
        self.source_state: dict[str, str] = {"vault": "ok" if finanzas.mcp.configured else "not_configured"}

    def now(self) -> datetime:
        return self._now().astimezone(self.tz)

    def today(self) -> date:
        return self.now().date()

    def _mark(self, ok: bool) -> None:
        if self.fin.mcp.configured:
            self.source_state["vault"] = "ok" if ok else "unreachable"

    # ----- screens -----
    def home(self) -> Screen:
        comps: list[Any] = [ButtonComponent(label="Apuntar gasto", screen=expense_capture.SCREEN_ID, icon="add")]
        comps += [ChartCardComponent(chart_id=c.id, title=c.title, size="wide" if c.kind == "hbar" else "medium")
                  for c in self.store.charts()]
        return Screen(id="home", title="Boni", components=comps)

    def screen(self, screen_id: str, device: str) -> Screen:
        if screen_id == "home":
            return self.home()
        if screen_id == expense_capture.SCREEN_ID:
            return expense_capture.screen(self.store.pref(device, "last_account"))
        raise NotFound(screen_id)

    # ----- options -----
    async def options(self, source: str, q: str = "", limit: int = 50) -> list[Option]:
        key = ascii_text(q).lower().strip()
        try:
            if source == "categories":
                cats = await self.fin.categories()
                # Spending categories first: the form is mostly used for expenses.
                cats = sorted(cats, key=lambda c: (not is_spending(c), cats.index(c)))
                opts = [Option(value=c, label=c) for c in cats]
            elif source == "people":
                opts = [Option(value=p.slug, label=p.label, hint=p.hint) for p in await self.fin.people()]
            else:
                raise NotFound(source)
        except SourceUnavailable as e:
            self._mark(False)
            raise Unavailable(str(e)) from e
        self._mark(True)
        if key:
            words = key.split()
            opts = [o for o in opts if all(w in ascii_text(f"{o.label} {o.value}").lower() for w in words)]
        return opts[:limit]

    # ----- charts -----
    async def chart_data(self, chart_id: str, drill: str | None = None) -> ChartData:
        spec = self.store.chart(chart_id)
        if spec is None:
            raise NotFound(chart_id)
        today = self.today()
        months = months_for(spec, today)
        stale = False
        try:
            movements = await self.fin.movements(months)
            debts = await self.fin.debts()
            self._mark(True)
        except SourceUnavailable as e:
            self._mark(False)
            movements, debts = self.fin.cached_movements(months), self.fin.cached_debts()
            if movements is None or debts is None:
                raise Unavailable(str(e)) from e
            stale = True
        with_data = {(m.date.year, m.date.month) for m in movements}
        items = spending_items(movements, debts)
        return compute(spec, items, with_data, today, self.now(), drill=drill, stale=stale)

    # ----- actions -----
    async def action(self, req: ActionRequest, device: str) -> ActionResult:
        if req.action != expense_capture.ACTION:
            return ActionResult(status="error", message=f"Accion desconocida: {req.action}")
        cid = str(req.client_id)
        if not self.store.insert_capture(cid, device, req.action, req.model_dump(mode="json")):
            prev = self.store.capture(cid)
            assert prev is not None
            if prev.result:
                return ActionResult.model_validate(prev.result)
            return ActionResult(status="queued", message=QUEUED_MESSAGE)
        cap = self.store.capture(cid)
        assert cap is not None
        return await self._process(cap, first=True)

    async def flush_outbox(self) -> int:
        """Retry queued captures. Returns how many were written."""
        written = 0
        for cap in self.store.queued_captures():
            res = await self._process(cap, first=False)
            if res.status == "ok":
                written += 1
            elif res.status == "queued":
                break  # source still down: try again next round
        return written

    async def _process(self, cap: Capture, first: bool) -> ActionResult:
        async with self._write_lock:
            current = self.store.capture(cap.client_id)
            if current is None or current.status != "queued":
                return ActionResult.model_validate(current.result) if current and current.result else \
                    ActionResult(status="error", message="Captura no encontrada")
            req = ActionRequest.model_validate(cap.request)
            created = req.created_at.astimezone(self.tz) if req.created_at else None
            # The day the user saved it, not the day the queue was flushed.
            today = created.date() if created else self.today()
            try:
                cats: list[str] | None = await self.fin.categories()
                people: set[str] | None = {p.slug for p in await self.fin.people()}
            except SourceUnavailable:
                self._mark(False)
                cats = people = None
            draft, errors = expense_capture.validate(req.values, categories=cats, people=people,
                                                     created_at=created, today=today)
            if errors:
                res = ActionResult(status="invalid", message="Revisa los campos marcados", field_errors=errors)
                if first:
                    # Nothing was saved: the client fixes the form and may resend with the same client_id.
                    self.store.discard_capture(cap.client_id)
                else:
                    self.store.update_capture(cap.client_id, status="invalid", result=res.model_dump(),
                                              error="; ".join(f"{k}: {v}" for k, v in errors.items()), attempt=True)
                    log.warning("queued capture %s became invalid: %s", cap.client_id, errors)
                return res
            assert draft is not None
            queued = ActionResult(status="queued", message=QUEUED_MESSAGE, navigate="home")
            if cats is None:
                self.store.update_capture(cap.client_id, status="queued", result=queued.model_dump(),
                                          error="source unavailable", attempt=True)
                return queued
            try:
                path = await self.fin.create_movement(
                    draft.date, base_name(draft), render(draft, today),
                    reason=f"boni: capture from {cap.device} ({cap.client_id[:8]})")
            except SourceUnavailable as e:
                self._mark(False)
                self.store.update_capture(cap.client_id, status="queued", result=queued.model_dump(),
                                          error=str(e)[:500], attempt=True)
                return queued
            except SourceError as e:
                res = ActionResult(status="error", message=f"No se pudo escribir: {e}")
                self.store.update_capture(cap.client_id, status="failed", result=res.model_dump(),
                                          error=str(e)[:500], attempt=True)
                log.error("capture %s failed: %s", cap.client_id, e)
                return res
            self._mark(True)
            res = ActionResult(status="ok", message="Guardado: " + path.rsplit("/", 1)[-1].removesuffix(".md"),
                               navigate="home")
            self.store.update_capture(cap.client_id, status="written", result=res.model_dump(), path=path,
                                      attempt=True)
            self.store.set_pref(cap.device, "last_account", draft.account)
            log.info("capture %s written to %s", cap.client_id, path)
            return res
