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


NEW_CHART = {"title": "Restaurantes por mes", "kind": "bar", "x": {"field": "date", "granularity": "month"},
             "period": {"kind": "last_months", "months": 6},
             "filters": [{"field": "category", "op": "in", "values": ["comida/restaurante"]}]}


def test_chart_builder_crud(client: TestClient):
    cat = client.get("/api/v1/charts/catalog").json()
    assert {f["id"] for f in cat["fields"]} >= {"date", "group", "category", "merchant", "people", "amount"}
    assert [k["id"] for k in cat["kinds"]][:3] == ["bar", "stacked_bar", "hbar"]

    r = client.post("/api/v1/charts", json=NEW_CHART)
    assert r.status_code == 201
    chart = r.json()
    assert chart["id"] == "restaurantes-por-mes" and chart["home"] is True
    assert client.post("/api/v1/charts", json=NEW_CHART).json()["id"] == "restaurantes-por-mes-2"
    d = client.get("/api/v1/charts/restaurantes-por-mes/data").json()
    assert {p["key"]: p["value"] for p in d["series"][0]["points"]}["2026-09"] == 44.41  # 14.41 + 15 + 15 (forgiven)
    home = [c["chart_id"] for c in client.get("/api/v1/home").json()["components"] if c["type"] == "chart_card"]
    assert home[-2:] == ["restaurantes-por-mes", "restaurantes-por-mes-2"]

    # edit: hide from home, change kind; the id stays
    r = client.put("/api/v1/charts/restaurantes-por-mes-2", json=NEW_CHART | {"kind": "line", "home": False,
                                                                          "id": "ignored"})
    assert r.status_code == 200 and r.json()["id"] == "restaurantes-por-mes-2" and r.json()["kind"] == "line"
    home = [c["chart_id"] for c in client.get("/api/v1/home").json()["components"] if c["type"] == "chart_card"]
    assert "restaurantes-por-mes-2" not in home
    assert client.get("/api/v1/charts/restaurantes-por-mes-2").json()["kind"] == "line"

    # order: the given ids first
    ids = [c["id"] for c in client.put("/api/v1/charts/order", json={"ids": ["eating-out", "restaurantes-por-mes",
                                                                             "nope"]}).json()["charts"]]
    assert ids == ["eating-out", "restaurantes-por-mes", "spending-by-category", "monthly-spending",
                   "restaurantes-por-mes-2"]

    # delete: the chart and the widgets showing it
    w = client.post("/api/v1/widgets", json={"chart_id": "restaurantes-por-mes", "size": "large"}).json()
    assert w == {"id": "w-restaurantes-por-mes", "chart_id": "restaurantes-por-mes", "size": "large"}
    assert client.delete("/api/v1/charts/restaurantes-por-mes").status_code == 204
    assert client.get("/api/v1/charts/restaurantes-por-mes/data").status_code == 404
    assert "restaurantes-por-mes" not in [x["chart_id"] for x in client.get("/api/v1/widgets").json()["widgets"]]
    assert client.delete("/api/v1/charts/restaurantes-por-mes").status_code == 404
    assert client.put("/api/v1/charts/nope", json=NEW_CHART).status_code == 404


def test_invalid_chart_is_rejected_with_a_message(client: TestClient):
    bad = NEW_CHART | {"kind": "stacked_bar"}
    r = client.post("/api/v1/charts", json=bad)
    assert r.status_code == 422 and r.json()["error"] == {
        "code": "invalid", "message": "Las barras apiladas necesitan un campo para separar en series"}
    assert client.post("/api/v1/charts/preview", json={"spec": bad}).status_code == 422
    assert client.post("/api/v1/charts", json={"title": "x"}).json()["error"]["code"] == "bad_request"


def test_preview_does_not_save(client: TestClient):
    spec = {"title": "Por comercio", "kind": "hbar", "x": {"field": "merchant"}, "period": {"kind": "all"},
            "filters": [{"field": "merchant", "op": "not_empty"}]}
    d = client.post("/api/v1/charts/preview", json={"spec": spec}).json()
    assert [(p["label"], p["value"]) for p in d["series"][0]["points"]] == [("Ramen Kagura", 24.5), ("Kumo", 14.41)]
    assert d["chart_id"] == "" and len(client.get("/api/v1/charts").json()["charts"]) == 3


def test_widget_management(client: TestClient):
    w = client.post("/api/v1/widgets", json={"chart_id": "eating-out"}).json()
    assert w["id"] == "w-eating-out-2" and w["size"] == "medium"
    r = client.put(f"/api/v1/widgets/{w['id']}", json={"chart_id": "monthly-spending", "size": "small"})
    assert r.json() == {"id": "w-eating-out-2", "chart_id": "monthly-spending", "size": "small"}
    assert client.post("/api/v1/widgets", json={"chart_id": "nope"}).status_code == 422
    assert client.delete(f"/api/v1/widgets/{w['id']}").status_code == 204
    assert client.delete(f"/api/v1/widgets/{w['id']}").status_code == 404
    # widgets belong to the device: another device does not see this one's changes
    assert len(client.get("/api/v1/widgets").json()["widgets"]) == 3


def test_builder_option_sources(client: TestClient):
    def values(source):
        return [(o["value"], o["label"]) for o in client.get(f"/api/v1/options/{source}").json()["options"]]
    assert values("groups")[:3] == [("comida", "Comida"), ("bebida", "Bebida"), ("suscripciones", "Suscripciones")]
    assert values("accounts") == [("efectivo", "Efectivo"), ("revolut", "Revolut"), ("ing", "ING")]
    assert ("Kumo", "Kumo") in values("merchants") and values("related") == [("cumple-tomas", "Cumple tomas")]
    assert values("statuses")[0] == ("conciliado", "Conciliado")



def test_first_expense_of_a_new_month(service, vault):
    # November has no folder yet: vault-mcp answers "not found" for it; Boni treats it as an empty month and creates it.
    from datetime import date

    note = "---\ntype: movement\n---\n"
    path = asyncio.run(service.fin.create_movement(date(2026, 11, 2), "2026-11-02-cafe", note, "t"))
    assert path == "registros/finanzas/movimientos/2026/11/2026-11-02-cafe.md"
    assert asyncio.run(service.fin.movements([(2026, 12)])) == []


def test_warm_up_fills_the_cache(service, vault):
    service.fin.ttl_s = 3600
    asyncio.run(service.warm())
    vault.down = True  # everything the clients ask for is now served from memory
    from fastapi.testclient import TestClient as TC

    from boni.app import create_app
    from boni.config import Settings
    token = service.store.add_device("warm-test")
    app = create_app(Settings(), service=service, run_outbox=False)
    with TC(app, headers={"Authorization": f"Bearer {token}"}) as c:
        for chart in ("spending-by-category", "monthly-spending", "eating-out"):
            d = c.get(f"/api/v1/charts/{chart}/data").json()
            assert d["stale"] is False, chart
        assert c.get("/api/v1/options/people").status_code == 200
        assert c.get("/api/v1/options/categories").status_code == 200


COFFEE = {"label": "Café", "screen": "capture-expense", "mode": "save", "color": "#fb923c",
          "values": {"kind": "gasto", "amount": 1.6, "account": "efectivo", "category": "bebida/cafe"}}


def test_shortcuts_crud(client: TestClient, service):
    assert client.get("/api/v1/shortcuts").json() == {"shortcuts": []}
    a = client.post("/api/v1/shortcuts", json=COFFEE)
    assert a.status_code == 201 and a.json()["id"] == "cafe" and a.json()["values"]["amount"] == 1.6
    b = client.post("/api/v1/shortcuts", json={"label": " Café ", "screen": "capture-expense"}).json()
    assert b["id"] == "cafe-2" and b["label"] == "Café" and b["mode"] == "open" and b["values"] == {}
    # order, update, delete
    ids = [s["id"] for s in client.put("/api/v1/shortcuts/order", json={"ids": ["cafe-2"]}).json()["shortcuts"]]
    assert ids == ["cafe-2", "cafe"]
    r = client.put("/api/v1/shortcuts/cafe", json=COFFEE | {"label": "Café con leche", "id": "other"}).json()
    assert r["id"] == "cafe" and r["label"] == "Café con leche"
    assert client.delete("/api/v1/shortcuts/cafe-2").status_code == 204
    assert client.delete("/api/v1/shortcuts/cafe-2").status_code == 404
    assert client.put("/api/v1/shortcuts/nope", json=COFFEE).status_code == 404
    assert [s["label"] for s in client.get("/api/v1/shortcuts").json()["shortcuts"]] == ["Café con leche"]


def test_invalid_shortcut_is_rejected_with_a_message(client: TestClient):
    bad = [COFFEE | {"screen": "nope"}, COFFEE | {"screen": "home"}, COFFEE | {"values": {"tip": 1}},
           COFFEE | {"color": "#123456"}, COFFEE | {"label": "  "}]
    for body in bad:
        r = client.post("/api/v1/shortcuts", json=body)
        assert r.status_code == 422 and r.json()["error"]["message"], body
    assert client.post("/api/v1/shortcuts", json=COFFEE | {"label": ""}).status_code == 422
    assert client.get("/api/v1/shortcuts").json() == {"shortcuts": []}


def test_shortcut_changes_reach_the_live_stream(client: TestClient, service):
    seen: list[str] = []
    service.events.publish = seen.append  # type: ignore[method-assign]
    sc = client.post("/api/v1/shortcuts", json=COFFEE).json()
    client.put(f"/api/v1/shortcuts/{sc['id']}", json=COFFEE)
    client.put("/api/v1/shortcuts/order", json={"ids": []})
    client.delete(f"/api/v1/shortcuts/{sc['id']}")
    assert seen == ["shortcuts"] * 4
