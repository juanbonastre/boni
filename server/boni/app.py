"""HTTP API v1 for the clients (contract: boni/contract.py, api/)."""


import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from boni import API_VERSION, VERSION
from boni.config import Settings
from boni.contract import (
    ActionRequest,
    ActionResult,
    ChartData,
    ChartsResponse,
    ErrorBody,
    ErrorResponse,
    Health,
    OptionsResponse,
    Screen,
    WidgetsResponse,
)
from boni.service import NotFound, Service, Unavailable
from boni.sources.finanzas import FinanzasSource
from boni.sources.mcp_client import McpSource
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

    @app.exception_handler(RequestValidationError)
    async def _bad_request(_r: Request, e: RequestValidationError) -> JSONResponse:
        return err(422, "bad_request", str(e.errors()[:3]))

    # No `from __future__ import annotations` in this file: FastAPI must resolve the local `Device` alias.
    def device(authorization: Annotated[str | None, Header()] = None) -> str:
        if not authorization or not authorization.startswith("Bearer "):
            raise ApiError(401, "unauthorized", "Falta el token del dispositivo")
        name = svc.store.device_for_token(authorization.removeprefix("Bearer ").strip())
        if name is None:
            raise ApiError(401, "unauthorized", "Token no valido")
        return name

    Device = Annotated[str, Depends(device)]

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

    @app.get("/api/v1/charts", response_model=ChartsResponse)
    async def charts(_d: Device) -> ChartsResponse:
        return ChartsResponse(charts=svc.store.charts())

    @app.get("/api/v1/charts/{chart_id}/data", response_model=ChartData)
    async def chart_data(chart_id: str, _d: Device, drill: str | None = None) -> ChartData:
        return await svc.chart_data(chart_id, drill)

    @app.get("/api/v1/widgets", response_model=WidgetsResponse)
    async def widgets(d: Device) -> WidgetsResponse:
        return WidgetsResponse(widgets=svc.store.widgets(d))

    return app
