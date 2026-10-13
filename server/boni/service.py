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
    ChartSpec,
    Option,
    Screen,
    Widget,
)
from boni.expenses import capture as expense_capture
from boni.expenses.note import ascii_text, base_name, render
from boni.sources.finanzas import FinanzasSource
from boni.sources.mcp_client import SourceError, SourceUnavailable
from boni.stats import engine
from boni.stats.engine import SpecError
from boni.stats.spending import is_spending
from boni.store import Capture, Store

log = logging.getLogger("boni")
QUEUED_MESSAGE = "Guardado en Boni: se escribira en cuanto vuelva la conexion"
VALUES_MONTHS = 24  # option lists built from movements (merchants, projects...) look at the last 24 months
STATUSES = {"pendiente": "Pendiente", "conciliado": "Conciliado"}
SOURCES = {"manual": "Manual", "banco": "Banco", "boni": "Boni"}


class NotFound(Exception):
    pass


class Unavailable(Exception):
    pass


class Invalid(Exception):
    """A chart or widget definition that cannot be saved; the message is for Juan."""


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
        comps += [ChartCardComponent(chart_id=c.id, title=c.title,
                                     size="wide" if c.kind in ("hbar", "table") else "small" if c.kind == "number"
                                     else "medium")
                  for c in self.store.charts() if c.home]
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
            elif source == "groups":
                groups = list(dict.fromkeys(c.split("/", 1)[0] for c in await self.fin.categories()))
                opts = [Option(value=g, label=engine.nice(g)) for g in groups]
            elif source == "accounts":
                opts = [Option(value=k, label=v) for k, v in engine.ACCOUNTS.items()]
            elif source in ("merchants", "related", "statuses", "sources"):
                opts = await self._values_from_movements(source)
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

    async def _values_from_movements(self, source: str) -> list[Option]:
        """Distinct values seen in recent movements, most used first."""
        field = {"merchants": "merchant", "related": "related", "statuses": "status", "sources": "source"}[source]
        today = self.today()
        months = engine.months_between(engine.shift_months(today.replace(day=1), -(VALUES_MONTHS - 1)), today)
        counts: dict[str, int] = {}
        labels: dict[str, str] = {}
        for m in await self.fin.movements(months):
            vals = m.related if field == "related" else (getattr(m, field),)
            for v in vals:
                if not v:
                    continue
                k = engine.fold(v) if field != "related" else v
                counts[k] = counts.get(k, 0) + 1
                labels.setdefault(k, v)
        known = {"statuses": STATUSES, "sources": SOURCES}.get(source, {})
        for k in known:
            counts.setdefault(k, 0)
        keys = sorted(counts, key=lambda k: (-counts[k], k))
        return [Option(value=labels.get(k, k), label=known.get(k) or engine.nice(labels.get(k, k)))
                for k in keys]

    # ----- background warm-up -----
    async def warm(self) -> None:
        """Refresh in the background what clients ask for, so their requests are served from memory: the months of every
        chart, debts, categories and people. Errors are only logged (the next round tries again)."""
        today = self.today()
        months = {m for spec in self.store.charts() for m in engine.months_needed(spec, today)}
        months |= set(engine.months_between(engine.shift_months(today.replace(day=1), -(VALUES_MONTHS - 1)), today))
        months = sorted(months)
        try:
            await self.fin.movements(months, force=True)
            await self.fin.debts(force=True)
            await self.fin.categories(force=True)
            await self.fin.people(force=True)
            self._mark(True)
        except SourceUnavailable as e:
            self._mark(False)
            log.warning("warm-up: source unavailable: %s", e)
        except SourceError as e:
            log.warning("warm-up failed: %s", e)

    # ----- charts -----
    async def _records(self, months: list[tuple[int, int]]) -> tuple[list[engine.Rec], set[tuple[int, int]], bool]:
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
        return engine.records(movements, debts), with_data, stale

    async def compute(self, spec: ChartSpec, drill: str | None = None) -> ChartData:
        today = self.today()
        try:
            engine.validate(spec)
            recs, with_data, stale = await self._records(engine.months_needed(spec, today))
            return engine.compute(spec, recs, with_data, today, self.now(), drill=drill, stale=stale)
        except SpecError as e:
            raise Invalid(str(e)) from e

    async def chart_data(self, chart_id: str, drill: str | None = None) -> ChartData:
        spec = self.store.chart(chart_id)
        if spec is None:
            raise NotFound(chart_id)
        return await self.compute(spec, drill)

    def _checked(self, spec: ChartSpec) -> ChartSpec:
        try:
            engine.validate(spec)
        except SpecError as e:
            raise Invalid(str(e)) from e
        return spec.model_copy(update={"title": spec.title.strip()})

    def create_chart(self, spec: ChartSpec) -> ChartSpec:
        return self.store.create_chart(self._checked(spec))

    def update_chart(self, chart_id: str, spec: ChartSpec) -> ChartSpec:
        saved = self.store.update_chart(chart_id, self._checked(spec))
        if saved is None:
            raise NotFound(chart_id)
        return saved

    def delete_chart(self, chart_id: str) -> None:
        if not self.store.delete_chart(chart_id):
            raise NotFound(chart_id)

    # ----- widgets -----
    def _known_chart(self, chart_id: str) -> None:
        if self.store.chart(chart_id) is None:
            raise Invalid(f"No existe la grafica {chart_id}")

    def add_widget(self, device: str, chart_id: str, size: str) -> Widget:
        self._known_chart(chart_id)
        return self.store.add_widget(device, chart_id, size)

    def update_widget(self, device: str, widget_id: str, chart_id: str, size: str) -> Widget:
        self._known_chart(chart_id)
        w = self.store.update_widget(device, widget_id, chart_id, size)
        if w is None:
            raise NotFound(widget_id)
        return w

    def delete_widget(self, device: str, widget_id: str) -> None:
        if not self.store.delete_widget(device, widget_id):
            raise NotFound(widget_id)

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
