"""Accounts and sessions (as Boni Calendar's server), live events and chart colours."""

import asyncio
import json
import sqlite3
import time

import pytest
from fastapi.testclient import TestClient

from boni import auth
from boni.app import create_app
from boni.config import Settings
from boni.contract import PALETTE, ChangeEvent
from boni.service import Service
from boni.store import Store
from tests.conftest import NOW, movement

PASSWORD = "una-contrasena-larga"


@pytest.fixture
def anon(service: Service) -> TestClient:
    service.store.add_user("ejemplo", PASSWORD)
    with TestClient(create_app(Settings(), service=service, run_outbox=False)) as c:
        yield c


def login(c: TestClient, device: str = "portatil", password: str = PASSWORD, user: str = "ejemplo"):
    return c.post("/api/v1/login", json={"user": user, "password": password, "device": device})


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_passwords_are_scrypt_hashes():
    h = auth.hash_password(PASSWORD)
    assert h.startswith("scrypt$") and PASSWORD not in h
    assert auth.verify_password(PASSWORD, h) and not auth.verify_password("otra-contrasena-larga", h)
    assert not auth.verify_password(PASSWORD, "plain$x$y") and not auth.check(PASSWORD, None)


def test_accounts_are_made_by_the_admin(service: Service):
    with pytest.raises(ValueError):
        service.store.add_user("x", PASSWORD)  # name too short
    with pytest.raises(ValueError):
        service.store.add_user("ejemplo", "corta")
    service.store.add_user("ejemplo", PASSWORD)
    assert [u["name"] for u in service.store.users()] == ["ejemplo"]


def test_login_session_logout(anon: TestClient):
    assert anon.get("/api/v1/home").status_code == 401
    bad = login(anon, password="no-es-la-buena-no")
    assert bad.status_code == 401 and bad.json()["error"]["code"] == "bad_login"
    r = login(anon).json()
    assert r["user"] == "ejemplo" and r["device"] == "portatil" and len(r["token"]) > 30
    h = bearer(r["token"])
    assert anon.get("/api/v1/me", headers=h).json() == {"user": "ejemplo", "device": "portatil"}
    assert anon.get("/api/v1/home", headers=h).status_code == 200
    assert anon.post("/api/v1/logout", headers=h).status_code == 204
    assert anon.get("/api/v1/home", headers=h).status_code == 401


def test_the_token_is_never_stored(anon: TestClient, tmp_path):
    token = login(anon).json()["token"]
    rows = anon.app.state.service.store._q("SELECT token_hash FROM sessions")
    assert len(rows) == 1 and rows[0]["token_hash"] != token and token not in rows[0]["token_hash"]


def test_widgets_and_preferences_follow_the_device_name(anon: TestClient):
    a = bearer(login(anon, "portatil").json()["token"])
    b = bearer(login(anon, "sobremesa").json()["token"])
    before = anon.get("/api/v1/widgets", headers=a).json()["widgets"]
    assert anon.post("/api/v1/widgets", headers=a, json={"chart_id": "eating-out"}).status_code == 201
    mine = anon.get("/api/v1/widgets", headers=a).json()["widgets"]
    theirs = anon.get("/api/v1/widgets", headers=b).json()["widgets"]
    assert len(mine) == len(before) + 1 and len(theirs) == len(before)


def test_old_device_tokens_keep_working_until_removed(anon: TestClient):
    store = anon.app.state.service.store
    token = store.add_device("portatil")
    assert anon.get("/api/v1/me", headers=bearer(token)).json() == {"user": None, "device": "portatil"}
    store.remove_device("portatil")
    assert anon.get("/api/v1/me", headers=bearer(token)).status_code == 401


def test_sessions_end_after_90_idle_days_and_with_a_new_password(service: Service):
    service.store.add_user("ejemplo", PASSWORD)
    token, _ = service.store.login("ejemplo", PASSWORD, "portatil")
    later = time.time() + 89 * 86400
    assert service.store.account_for_token(token, now=later) == ("ejemplo", "portatil")
    assert service.store.account_for_token(token, now=later + 89 * 86400) == ("ejemplo", "portatil")  # it was used
    assert service.store.account_for_token(token, now=later + 180 * 86400) is None
    token, _ = service.store.login("ejemplo", PASSWORD, "portatil")
    service.store.set_password("ejemplo", "otra-contrasena-larga")
    assert service.store.account_for_token(token) is None


def test_too_many_failed_logins_wait(anon: TestClient):
    for _ in range(5):
        assert login(anon, password="no-es-la-buena-no").status_code == 401
    r = login(anon)  # even the right password waits now
    assert r.status_code == 429 and r.json()["error"]["code"] == "too_many"


def test_login_guard_limits():
    t = [0.0]
    g = auth.LoginGuard(per_user=2, per_address=3, window_s=100, per_minute=100, now=lambda: t[0])
    g.failed("ana", "1.1.1.1")
    g.failed("ANA", "2.2.2.2")
    assert not g.allow("ana", "3.3.3.3")
    t[0] = 101
    assert g.allow("ana", "3.3.3.3")
    g.failed("x", "9.9.9.9")
    g.failed("y", "9.9.9.9")
    g.failed("z", "9.9.9.9")
    assert not g.allow("w", "9.9.9.9")
    g.succeeded("ana")


async def next_event(stream, timeout: float = 2.0) -> ChangeEvent:
    while True:
        chunk = await asyncio.wait_for(anext(stream), timeout)
        if chunk.startswith("event: changed"):
            return ChangeEvent.model_validate_json(chunk.split("data: ", 1)[1])


def test_changes_are_announced_live(service: Service, vault):
    async def run() -> None:
        stream = service.events.stream(heartbeat_s=0.05)
        assert (await anext(stream)).startswith(": connected")
        spec = service.store.chart("eating-out")
        service.update_chart("eating-out", spec.model_copy(update={"title": "Fuera"}))
        assert (await next_event(stream)).what == "charts"
        service.add_widget("portatil", "eating-out", "medium")
        assert (await next_event(stream)).what == "widgets"
        # the vault changed between two refresh rounds (a capture from another app): "data"
        await service.warm()
        path, text = movement("2026-10-12-1000-cafe", "2026-10-12", -1.5, "bebida/cafe")
        vault.write(path, text)
        await service.warm()
        assert (await next_event(stream)).what == "data"
        await stream.aclose()
        assert service.events.listeners == 0

    asyncio.run(run())


def test_the_events_route_needs_a_session(anon: TestClient):
    assert anon.get("/api/v1/events").status_code == 401


def test_charts_have_a_colour_from_the_palette(client: TestClient, tmp_path):
    charts = client.get("/api/v1/charts").json()["charts"]
    assert [c["color"] for c in charts] == ["#60a5fa", "#a78bfa", "#fb923c"]
    spec = charts[0] | {"color": "#123456"}
    assert client.put(f"/api/v1/charts/{spec['id']}", json=spec).status_code == 200
    assert client.put(f"/api/v1/charts/{spec['id']}", json=spec | {"color": "rojo"}).status_code == 422
    assert all(c in PALETTE for c in ("#60a5fa", "#a78bfa", "#fb923c"))


def test_charts_saved_before_colours_get_one_once(tmp_path):
    path = str(tmp_path / "old.sqlite3")
    Store(path).close()
    db = sqlite3.connect(path)
    for (cid, spec) in db.execute("SELECT id, spec FROM charts").fetchall():
        raw = json.loads(spec)
        raw.pop("color", None)
        db.execute("UPDATE charts SET spec = ? WHERE id = ?", (json.dumps(raw), cid))
    db.execute("INSERT INTO charts (id, spec, position) VALUES ('mia', ?, 9)",
               (json.dumps({"id": "mia", "title": "Mía", "kind": "bar", "period": {"kind": "this_month"}}),))
    db.commit()
    db.close()
    colours = {c.id: c.color for c in Store(path).charts()}
    assert colours["eating-out"] == "#fb923c" and colours["mia"] in PALETTE
    assert NOW.year == 2026


def test_removing_an_old_token_keeps_the_widgets_of_a_device_that_logged_in(service: Service):
    store = service.store
    store.add_user("ejemplo", PASSWORD)
    store.add_device("portatil")
    store.add_widget("portatil", "eating-out", "medium")
    before = store.widgets("portatil")
    store.login("ejemplo", PASSWORD, "portatil")  # the same computer, now with an account
    assert store.remove_device("portatil")
    assert store.widgets("portatil") == before and len(before) > 0
    # a device that never logged in loses them with its token
    store.add_device("viejo")
    store.add_widget("viejo", "eating-out", "medium")
    store.remove_device("viejo")
    assert store.widgets("viejo") == []
