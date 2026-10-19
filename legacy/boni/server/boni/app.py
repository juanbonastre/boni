"""HTTP API v1 for the clients (contract: boni/contract.py, api/)."""


import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response, StreamingResponse

from boni import API_VERSION, VERSION
from boni.auth import LoginGuard
from boni.config import Settings
from boni.contract import (
    Account,
    ActionRequest,
    ActionResult,
    ChartCatalog,
    ChartData,
    ChartOrder,
    ChartPreviewRequest,
    ChartSpec,
    ChartsResponse,
    ErrorBody,
    ErrorResponse,
    Health,
    LoginRequest,
    LoginResult,
    OptionsResponse,
    Screen,
    Shortcut,
    ShortcutOrder,
    ShortcutsResponse,
    Widget,
    WidgetRequest,
    WidgetsResponse,
)
from boni.service import Invalid, NotFound, Service, Unavailable
from boni.sources.finanzas import FinanzasSource
from boni.sources.mcp_client import McpSource
from boni.stats import engine
from boni.store import Store

log = logging.getLogger("boni")


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


def build_service(settings: Settings, vault_target=None) -> Service:
    """`vault_target`: override for tests (an in-process MCP server factory)."""
    mcp = McpSource("vault", vault_target or settings.vault_mcp_url, settings.vault_mcp_token)
    return Service(Store(settings.db_path), FinanzasSource(mcp, ttl_s=settings.cache_ttl_s), settings.tz)


def create_app(settings: Settings, service: Service | None = None, run_outbox: bool = True) -> FastAPI:
    svc = service or build_service(settings)

    async def outbox_loop() -> None:
        while True:
            await asyncio.sleep(settings.outbox_interval_s)
            try:
                n = await svc.flush_outbox()
                if n:
                    log.info("outbox: %d capture(s) written", n)
            except Exception:  # never let the loop die
                log.exception("outbox round failed")

    async def warm_loop() -> None:
        while True:
            try:
                await svc.warm()
            except Exception:  # never let the loop die
                log.exception("warm-up round failed")
            await asyncio.sleep(settings.warm_interval_s)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        tasks = [asyncio.create_task(outbox_loop()), asyncio.create_task(warm_loop())] if run_outbox else []
        yield
        for task in tasks:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    app = FastAPI(title="Boni", version=VERSION, lifespan=lifespan)
    app.state.service = svc

    def err(status: int, code: str, message: str) -> JSONResponse:
        return JSONResponse(ErrorResponse(error=ErrorBody(code=code, message=message)).model_dump(), status_code=status)

    @app.exception_handler(ApiError)
    async def _api_error(_r: Request, e: ApiError) -> JSONResponse:
        return err(e.status, e.code, e.message)

    @app.exception_handler(NotFound)
    async def _not_found(_r: Request, e: NotFound) -> JSONResponse:
        return err(404, "not_found", f"No existe: {e}")

    @app.exception_handler(Unavailable)
    async def _unavailable(_r: Request, e: Unavailable) -> JSONResponse:
        log.warning("source unavailable: %s", e)
        return err(503, "source_unavailable", "No se puede llegar a los datos ahora mismo")

    @app.exception_handler(Invalid)
    async def _invalid(_r: Request, e: Invalid) -> JSONResponse:
        return err(422, "invalid", str(e))

    @app.exception_handler(RequestValidationError)
    async def _bad_request(_r: Request, e: RequestValidationError) -> JSONResponse:
        return err(422, "bad_request", str(e.errors()[:3]))

    # No `from __future__ import annotations` in this file: FastAPI must resolve the local `Device` alias.
    def bearer(authorization: str | None) -> str:
        if not authorization or not authorization.startswith("Bearer "):
            raise ApiError(401, "unauthorized", "Falta la sesión: entra con tu usuario")
        return authorization.removeprefix("Bearer ").strip()

    def account(authorization: Annotated[str | None, Header()] = None) -> Account:
        found = svc.store.account_for_token(bearer(authorization))
        if found is None:
            raise ApiError(401, "unauthorized", "La sesión ha terminado: vuelve a entrar")
        return Account(user=found[0], device=found[1])

    def device(acc: Annotated[Account, Depends(account)]) -> str:
        return acc.device

    Device = Annotated[str, Depends(device)]
    guard = LoginGuard()

    # ----- accounts (as Boni Calendar's server) -----
    @app.post("/api/v1/login", response_model=LoginResult)
    async def login(req: LoginRequest, request: Request) -> LoginResult:
        name = req.user.strip()
        address = request.client.host if request.client else "unknown"
        if not guard.allow(name, address):
            log.warning("login refused (too many attempts): %r from %s", name, address)
            raise ApiError(429, "too_many", "Demasiados intentos: espera unos minutos")
        device_name = req.device.strip()[:80] or "equipo"
        # scrypt takes a moment: off the event loop
        found = await asyncio.to_thread(svc.store.login, name, req.password, device_name)
        if found is None:
            guard.failed(name, address)
            log.warning("login failed: %r from %s", name, address)
            raise ApiError(401, "bad_login", "Usuario o contraseña incorrectos")
        guard.succeeded(name)
        log.info("login: %s on %s", found[1], device_name)
        return LoginResult(token=found[0], user=found[1], device=device_name)

    @app.post("/api/v1/logout", status_code=204)
    async def logout(authorization: Annotated[str | None, Header()] = None) -> Response:
        svc.store.logout(bearer(authorization))
        return Response(status_code=204)

    @app.get("/api/v1/me", response_model=Account)
    async def me(acc: Annotated[Account, Depends(account)]) -> Account:
        return acc

    @app.get("/api/v1/events")
    async def events(_d: Device) -> StreamingResponse:
        return StreamingResponse(svc.events.stream(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})

    @app.get("/healthz", response_model=Health)
    async def healthz() -> Health:
        return Health(version=VERSION, api_version=API_VERSION, sources=svc.source_state)  # type: ignore[arg-type]

    @app.get("/api/v1/home", response_model=Screen)
    async def home(_d: Device) -> Screen:
        return svc.home()

    @app.get("/api/v1/screens/{screen_id}", response_model=Screen)
    async def screen(screen_id: str, d: Device) -> Screen:
        return svc.screen(screen_id, d)

    @app.get("/api/v1/options/{source}", response_model=OptionsResponse)
    async def options(source: str, _d: Device, q: str = "",
                      limit: Annotated[int, Query(ge=1, le=500)] = 50) -> OptionsResponse:
        return OptionsResponse(source=source, options=await svc.options(source, q, limit))

    @app.post("/api/v1/actions", response_model=ActionResult)
    async def actions(req: ActionRequest, d: Device) -> ActionResult:
        return await svc.action(req, d)

    # ----- charts (fixed paths before /charts/{chart_id}) -----
    @app.get("/api/v1/charts", response_model=ChartsResponse)
    async def charts(_d: Device) -> ChartsResponse:
        return ChartsResponse(charts=svc.store.charts())

    @app.post("/api/v1/charts", response_model=ChartSpec, status_code=201)
    async def create_chart(spec: ChartSpec, _d: Device) -> ChartSpec:
        return svc.create_chart(spec)

    @app.get("/api/v1/charts/catalog", response_model=ChartCatalog)
    async def chart_catalog(_d: Device) -> ChartCatalog:
        return engine.catalog()

    @app.post("/api/v1/charts/preview", response_model=ChartData)
    async def chart_preview(req: ChartPreviewRequest, _d: Device) -> ChartData:
        return await svc.compute(req.spec, req.drill)

    @app.put("/api/v1/charts/order", response_model=ChartsResponse)
    async def chart_order(order: ChartOrder, _d: Device) -> ChartsResponse:
        svc.order_charts(order.ids)
        return ChartsResponse(charts=svc.store.charts())

    @app.get("/api/v1/charts/{chart_id}", response_model=ChartSpec)
    async def chart(chart_id: str, _d: Device) -> ChartSpec:
        spec = svc.store.chart(chart_id)
        if spec is None:
            raise NotFound(chart_id)
        return spec

    @app.put("/api/v1/charts/{chart_id}", response_model=ChartSpec)
    async def update_chart(chart_id: str, spec: ChartSpec, _d: Device) -> ChartSpec:
        return svc.update_chart(chart_id, spec)

    @app.delete("/api/v1/charts/{chart_id}", status_code=204)
    async def delete_chart(chart_id: str, _d: Device) -> Response:
        svc.delete_chart(chart_id)
        return Response(status_code=204)

    @app.get("/api/v1/charts/{chart_id}/data", response_model=ChartData)
    async def chart_data(chart_id: str, _d: Device, drill: str | None = None) -> ChartData:
        return await svc.chart_data(chart_id, drill)

    # ----- shortcuts (fixed paths before /shortcuts/{shortcut_id}) -----
    @app.get("/api/v1/shortcuts", response_model=ShortcutsResponse)
    async def shortcuts(_d: Device) -> ShortcutsResponse:
        return ShortcutsResponse(shortcuts=svc.store.shortcuts())

    @app.post("/api/v1/shortcuts", response_model=Shortcut, status_code=201)
    async def create_shortcut(sc: Shortcut, d: Device) -> Shortcut:
        return svc.create_shortcut(sc, d)

    @app.put("/api/v1/shortcuts/order", response_model=ShortcutsResponse)
    async def shortcut_order(order: ShortcutOrder, _d: Device) -> ShortcutsResponse:
        svc.order_shortcuts(order.ids)
        return ShortcutsResponse(shortcuts=svc.store.shortcuts())

    @app.put("/api/v1/shortcuts/{shortcut_id}", response_model=Shortcut)
    async def update_shortcut(shortcut_id: str, sc: Shortcut, d: Device) -> Shortcut:
        return svc.update_shortcut(shortcut_id, sc, d)

    @app.delete("/api/v1/shortcuts/{shortcut_id}", status_code=204)
    async def delete_shortcut(shortcut_id: str, _d: Device) -> Response:
        svc.delete_shortcut(shortcut_id)
        return Response(status_code=204)

    # ----- widgets of the calling device -----
    @app.get("/api/v1/widgets", response_model=WidgetsResponse)
    async def widgets(d: Device) -> WidgetsResponse:
        return WidgetsResponse(widgets=svc.store.widgets(d))

    @app.post("/api/v1/widgets", response_model=Widget, status_code=201)
    async def add_widget(req: WidgetRequest, d: Device) -> Widget:
        return svc.add_widget(d, req.chart_id, req.size)

    @app.put("/api/v1/widgets/{widget_id}", response_model=Widget)
    async def update_widget(widget_id: str, req: WidgetRequest, d: Device) -> Widget:
        return svc.update_widget(d, widget_id, req.chart_id, req.size)

    @app.delete("/api/v1/widgets/{widget_id}", status_code=204)
    async def delete_widget(widget_id: str, d: Device) -> Response:
        svc.delete_widget(d, widget_id)
        return Response(status_code=204)

    return app
