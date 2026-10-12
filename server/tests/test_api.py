"""End to end: HTTP API -> service -> MCP client (real SDK, protocol 2026-07-28) -> fake vault-mcp over temp files."""

import asyncio
import uuid

from fastapi.testclient import TestClient

from tests.conftest import NOW


def capture(client: TestClient, values: dict, cid: str | None = None, created_at: str | None = None):
    body = {"action": "expenses.capture", "client_id": cid or str(uuid.uuid4()), "values": values,
            "created_at": created_at or NOW.isoformat()}
    return client.post("/api/v1/actions", json=body)


EXPENSE = {"kind": "gasto", "amount": "12,50", "account": "revolut", "category": "comida/restaurante",
           "concept": "Menu con Lucia", "merchant": "Bar Pepe", "people": ["lucia-ferri"], "date": "today"}


def test_auth_required(client: TestClient):
    assert client.get("/api/v1/home", headers={"Authorization": ""}).status_code == 401
    r = client.get("/api/v1/home", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "unauthorized"
    assert client.get("/healthz", headers={"Authorization": ""}).json()["status"] == "ok"


def test_home_and_capture_screen(client: TestClient):
    home = client.get("/api/v1/home").json()
    types = [c["type"] for c in home["components"]]
    assert types == ["button", "chart_card", "chart_card", "chart_card"]
    form = client.get("/api/v1/screens/capture-expense").json()["components"][0]
    ids = [f["id"] for f in form["fields"]]
    assert ids[:4] == ["kind", "amount", "account", "category"] and form["submit"]["action"] == "expenses.capture"
    assert client.get("/api/v1/screens/nope").status_code == 404


def test_options_search_is_accent_insensitive(client: TestClient):
    r = client.get("/api/v1/options/people", params={"q": "peña"}).json()
    assert [o["value"] for o in r["options"]] == ["pablo-soler-gil"]
    assert r["options"][0]["label"] == "Pablo Soler Gil" and r["options"][0]["hint"] == "Colleague"
    cats = [o["value"] for o in client.get("/api/v1/options/categories").json()["options"]]
    assert cats[0] == "comida/restaurante" and cats[-1].startswith(("ingreso", "inversion", "transferencia"))
    assert client.get("/api/v1/options/nope").status_code == 404


def test_capture_writes_movement_note(client: TestClient, vault):
    r = capture(client, EXPENSE).json()
    assert r["status"] == "ok" and r["navigate"] == "home"
    path = "registros/finanzas/movimientos/2026/10/2026-10-12-1830-menu-con-lucia.md"
    assert r["message"] == "Guardado: 2026-10-12-1830-menu-con-lucia"
    text = vault.read(path)
    assert "amount: -12.50\n" in text and 'time: "18:30"' in text and "account: revolut" in text
    assert 'people: ["[[lucia-ferri]]"]' in text and "status: pendiente" in text and "source: manual" in text
    assert vault.writes[0]["reason"].startswith("boni: capture from test-laptop")
    # Same name again -> -2
    r2 = capture(client, EXPENSE).json()
    assert r2["message"].endswith("menu-con-lucia-2")
    # The account becomes the default for this device
    form = client.get("/api/v1/screens/capture-expense").json()["components"][0]
    assert next(f for f in form["fields"] if f["id"] == "account")["default"] == "revolut"


def test_capture_is_idempotent(client: TestClient, vault):
    cid = str(uuid.uuid4())
    a = capture(client, EXPENSE, cid).json()
    b = capture(client, EXPENSE, cid).json()
    assert a == b and len(vault.writes) == 1


def test_capture_validation(client: TestClient, vault):
    cid = str(uuid.uuid4())
    bad = EXPENSE | {"amount": "0", "category": "comida/caviar", "people": ["nadie"], "date": "2026-12-01"}
    r = capture(client, bad, cid).json()
    assert r["status"] == "invalid"
    assert set(r["field_errors"]) == {"amount", "category", "people", "date"}
    assert vault.writes == []
    # The client fixes the form and resends with the same client_id
    assert capture(client, EXPENSE, cid).json()["status"] == "ok"


def test_shared_expense_computes_my_share(client: TestClient, vault):
    values = EXPENSE | {"amount": 90, "people": ["tomas", "mario-vidal"], "shared": True,
                        "invited": ["lucia-ferri"], "date": "2026-10-11"}
    r = capture(client, values).json()
    assert r["status"] == "ok"
    text = vault.read("registros/finanzas/movimientos/2026/10/2026-10-11-menu-con-lucia.md")
    # 3 people (invited ones are added), 1 invited: 90 * 2 / 4
    assert "my_share: 45.00" in text and "time:" not in text
    assert 'invited: ["[[lucia-ferri]]"]' in text


def test_offline_capture_is_queued_then_written(client: TestClient, vault, service):
    vault.down = True
    cid = str(uuid.uuid4())
    r = capture(client, EXPENSE | {"date": "today"}, cid, created_at="2026-10-11T21:05:00+02:00").json()
    assert r["status"] == "queued"
    assert capture(client, EXPENSE, cid).json()["status"] == "queued"  # retry from the client: still queued
    assert client.get("/healthz").json()["sources"]["vault"] == "unreachable"
    vault.down = False
    assert asyncio.run(service.flush_outbox()) == 1
    # "today" is the day the user saved it, with the time from the device
    assert '"21:05"' in vault.read("registros/finanzas/movimientos/2026/10/2026-10-11-2105-menu-con-lucia.md")
    assert capture(client, EXPENSE, cid).json()["status"] == "ok"
    assert asyncio.run(service.flush_outbox()) == 0


def test_chart_data(client: TestClient):
    charts = client.get("/api/v1/charts").json()["charts"]
    assert [c["id"] for c in charts] == ["spending-by-category", "monthly-spending", "eating-out"]
    d = client.get("/api/v1/charts/spending-by-category/data").json()
    assert d["total"] == 82.29 and d["series"][0]["points"][0]["key"] == "comida" and not d["stale"]
    d = client.get("/api/v1/charts/spending-by-category/data", params={"drill": "comida"}).json()
    assert d["drill"] == "comida" and len(d["series"][0]["points"]) == 2
    d = client.get("/api/v1/charts/monthly-spending/data").json()
    assert d["average"] == 82.14
    assert client.get("/api/v1/charts/nope/data").status_code == 404


def test_chart_data_served_stale_when_source_down(client: TestClient, vault, service):
    service.fin.ttl_s = 0  # every request goes to the source
    assert client.get("/api/v1/charts/eating-out/data").status_code == 200
    vault.down = True
    d = client.get("/api/v1/charts/eating-out/data").json()
    assert d["stale"] is True
    r = client.get("/api/v1/charts/monthly-spending/data")  # same months: cached too
    assert r.status_code == 200
    service.fin._cache.clear()
    r = client.get("/api/v1/charts/monthly-spending/data")
    assert r.status_code == 503 and r.json()["error"]["code"] == "source_unavailable"


def test_widgets_per_device(client: TestClient):
    w = client.get("/api/v1/widgets").json()["widgets"]
    assert [x["chart_id"] for x in w] == ["spending-by-category", "monthly-spending", "eating-out"]
