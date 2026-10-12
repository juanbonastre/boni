from __future__ import annotations

from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from boni.app import create_app
from boni.config import Settings
from boni.service import Service
from boni.sources.finanzas import FinanzasSource
from boni.sources.mcp_client import McpSource
from boni.store import Store
from tests.fake_vault_mcp import FakeVault

TZ = ZoneInfo("Europe/Madrid")
NOW = datetime(2026, 10, 12, 18, 30, tzinfo=TZ)

CATEGORIES = """---
type: index
summary: Canonical list of money categories.
categories:
  - comida/restaurante
  - comida/comida-rapida
  - comida/supermercado
  - bebida/cafe
  - bebida/alcohol
  - suscripciones
  - compras/ropa
  - transporte/gasolina
  - gestiones
  - otros/desconocido
  - ingreso/nomina
  - inversion
  - transferencia/interna
  - transferencia/prestamo
---

# Categorias
"""

PEOPLE = {
    "lucia-ferri": "Friend from Italy",
    "mario-vidal": "Friend",
    "tomas": "Friend",
    "pablo-soler-gil": "Colleague",
}


def movement(name: str, date: str, amount: float, category: str, **extra: object) -> tuple[str, str]:
    y, m = date[:4], date[5:7]
    lines = ["---", "type: movement", f"date: {date}", f"amount: {amount}", "currency: EUR", f"category: {category}"]
    for k, v in extra.items():
        lines.append(f'{k}: "{v}"' if isinstance(v, str) else f"{k}: {v}")
    lines += ["status: conciliado", "---", "", f"# {name}", ""]
    return f"registros/finanzas/movimientos/{y}/{m}/{name}.md", "\n".join(lines)


def debt(name: str, date: str, movement_name: str, amount: float, status: str) -> tuple[str, str]:
    text = "\n".join(["---", "type: debt", f"date: {date}", 'person: "[[tomas]]"',
                      f'movement: "[[{movement_name}]]"', f"amount: {amount}", "direction: me-deben",
                      f"status: {status}", "---", "", f"# {name}", ""])
    return f"registros/finanzas/deudas/{name}.md", text


NOTES = [
    # October 2026 (current month)
    movement("2026-10-03-1400-mercadona", "2026-10-03", -45.20, "comida/supermercado"),
    movement("2026-10-05-2130-ramen", "2026-10-05", -24.50, "comida/restaurante"),
    movement("2026-10-06-0900-spotify", "2026-10-06", -10.99, "suscripciones"),
    movement("2026-10-07-1000-traspaso", "2026-10-07", -500, "transferencia/interna"),
    movement("2026-10-08-0800-nomina", "2026-10-08", 2100, "ingreso/nomina"),
    movement("2026-10-09-1000-cafe", "2026-10-09", -1.60, "bebida/cafe"),
    movement("2026-10-10-1200-zapatos", "2026-10-10", -60, "compras/ropa"),
    movement("2026-10-11-1200-devolucion-zapatos", "2026-10-11", 60, "compras/ropa",
             settles="[[2026-10-10-1200-zapatos]]"),
    # September 2026
    movement("2026-09-18-2258-kumo", "2026-09-18", -94.10, "comida/restaurante", my_share=14.41),
    movement("2026-09-18-2303-bizum-recibido", "2026-09-18", 16.67, "comida/restaurante",
             settles="[[2026-09-18-tomas-kumo]]"),
    movement("2026-09-20-2200-cena", "2026-09-20", -30, "comida/restaurante", my_share=15),
    movement("2026-09-21-1000-super", "2026-09-21", -80, "comida/supermercado"),
    movement("2026-09-22-2300-cervezas", "2026-09-22", -12, "bebida/alcohol"),
    debt("2026-09-18-tomas-kumo", "2026-09-18", "2026-09-18-2258-kumo", 16.67, "pagada"),
    debt("2026-09-20-tomas-cena", "2026-09-20", "2026-09-20-2200-cena", 15, "perdonada"),
    # August and July 2026; nothing between Nov 2025 and Jun 2026 (a gap, not zero spending)
    movement("2026-08-10-2100-pizzeria", "2026-08-10", -40, "comida/restaurante"),
    movement("2026-08-11-1000-gasolina", "2026-08-11", -50, "transporte/gasolina"),
    movement("2026-07-28-1000-casa", "2026-07-28", -95000, "inversion"),
    movement("2026-07-29-1000-dni", "2026-07-29", -20, "gestiones"),
]


@pytest.fixture
def vault(tmp_path: Path) -> FakeVault:
    v = FakeVault(tmp_path / "vault")
    v.write("registros/finanzas/categorias.md", CATEGORIES)
    for slug, summary in PEOPLE.items():
        v.write(f"registros/personas/{slug}.md", f"---\ntype: person\nsummary: {summary}\n---\n\n# {slug}\n")
    for path, text in NOTES:
        v.write(path, text)
    return v


@pytest.fixture
def service(vault: FakeVault, tmp_path: Path) -> Service:
    mcp = McpSource("vault", vault.server)
    return Service(Store(str(tmp_path / "boni.sqlite3")), FinanzasSource(mcp, ttl_s=0), TZ, now=lambda: NOW)


@pytest.fixture
def client(service: Service) -> TestClient:
    app = create_app(Settings(), service=service, run_outbox=False)
    token = service.store.add_device("test-laptop")
    with TestClient(app, headers={"Authorization": f"Bearer {token}"}) as c:
        yield c
