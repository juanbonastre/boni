"""Boni's own SQLite database: accounts and sessions (and the old device tokens), the capture outbox, chart definitions,
widgets and preferences per device.
The real data stays in its sources (the vault); this file only holds what is Boni's."""

from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from boni import auth
from boni.contract import PALETTE, ChartSpec, Widget
from boni.expenses.note import slug
from boni.stats.charts import DEFAULT_CHARTS

SCHEMA = """
CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    token_hash TEXT NOT NULL UNIQUE,
    created TEXT NOT NULL,
    last_seen TEXT
);
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    pass TEXT NOT NULL,
    created TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device TEXT NOT NULL,
    created TEXT NOT NULL,
    last_seen REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS captures (
    client_id TEXT PRIMARY KEY,
    device TEXT NOT NULL,
    action TEXT NOT NULL,
    request TEXT NOT NULL,          -- the ActionRequest JSON as received
    status TEXT NOT NULL,           -- queued | written | invalid | failed
    result TEXT,                    -- ActionResult JSON returned to the client
    path TEXT,                      -- note written in the source
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    created TEXT NOT NULL,
    updated TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS charts (
    id TEXT PRIMARY KEY,
    spec TEXT NOT NULL,
    position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS widgets (
    device TEXT NOT NULL,
    id TEXT NOT NULL,
    chart_id TEXT NOT NULL,
    size TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (device, id)
);
CREATE TABLE IF NOT EXISTS prefs (
    device TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (device, key)
);
"""


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@dataclass(frozen=True)
class Capture:
    client_id: str
    device: str
    action: str
    request: dict[str, Any]
    status: str
    result: dict[str, Any] | None
    path: str | None
    error: str | None
    attempts: int


class Store:
    def __init__(self, path: str):
        self._db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._db.execute("PRAGMA journal_mode=WAL")
            self._db.execute("PRAGMA foreign_keys=ON")
            self._db.executescript(SCHEMA)
        self._seed_charts()
        self._colour_old_charts()

    def close(self) -> None:
        self._db.close()

    def _q(self, sql: str, args: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._db.execute(sql, args).fetchall()

    # ----- devices -----
    def add_device(self, name: str) -> str:
        """Creates a device and returns its token (shown once; only the hash is stored)."""
        token = secrets.token_urlsafe(32)
        self._q("INSERT INTO devices (name, token_hash, created) VALUES (?, ?, ?)", (name, hash_token(token), _now()))
        self._seed_widgets(name)
        return token

    def remove_device(self, name: str) -> bool:
        with self._lock:
            n = self._db.execute("DELETE FROM devices WHERE name = ?", (name,)).rowcount
            self._db.execute("DELETE FROM widgets WHERE device = ?", (name,))
        return n > 0

    def devices(self) -> list[dict[str, Any]]:
        return [dict(r) for r in self._q("SELECT name, created, last_seen FROM devices ORDER BY name")]

    def device_for_token(self, token: str) -> str | None:
        rows = self._q("SELECT name FROM devices WHERE token_hash = ?", (hash_token(token),))
        if not rows:
            return None
        self._q("UPDATE devices SET last_seen = ? WHERE name = ?", (_now(), rows[0]["name"]))
        return rows[0]["name"]

    # ----- accounts and sessions -----
    def add_user(self, name: str, password: str) -> None:
        if not auth.USER_NAME.match(name):
            raise ValueError("A user name is 2-32 letters, digits, . _ -")
        if len(password) < auth.MIN_PASSWORD:
            raise ValueError(f"The password needs at least {auth.MIN_PASSWORD} characters")
        self._q("INSERT INTO users (name, pass, created) VALUES (?, ?, ?)",
                (name, auth.hash_password(password), _now()))

    def set_password(self, name: str, password: str) -> bool:
        """A new password; every session of that user ends."""
        if len(password) < auth.MIN_PASSWORD:
            raise ValueError(f"The password needs at least {auth.MIN_PASSWORD} characters")
        with self._lock:
            n = self._db.execute("UPDATE users SET pass = ? WHERE name = ?",
                                 (auth.hash_password(password), name)).rowcount
            self._db.execute("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE name = ?)", (name,))
        return n > 0

    def remove_user(self, name: str) -> bool:
        with self._lock:
            return self._db.execute("DELETE FROM users WHERE name = ?", (name,)).rowcount > 0

    def users(self) -> list[dict[str, Any]]:
        rows = self._q("SELECT u.name, u.created, COUNT(s.token_hash) AS sessions FROM users u "
                       "LEFT JOIN sessions s ON s.user_id = u.id GROUP BY u.id ORDER BY u.name")
        return [dict(r) for r in rows]

    def login(self, name: str, password: str, device: str) -> tuple[str, str] | None:
        """A new session for `device`, or None when the name or the password is wrong. Returns (token, user name)."""
        rows = self._q("SELECT id, name, pass FROM users WHERE name = ?", (name,))
        if not auth.check(password, rows[0]["pass"] if rows else None):
            return None
        token = secrets.token_urlsafe(32)
        self._q("INSERT INTO sessions (token_hash, user_id, device, created, last_seen) VALUES (?, ?, ?, ?, ?)",
                (hash_token(token), rows[0]["id"], device, _now(), time.time()))
        return token, rows[0]["name"]

    def logout(self, token: str) -> None:
        self._q("DELETE FROM sessions WHERE token_hash = ?", (hash_token(token),))

    def account_for_token(self, token: str, now: float | None = None) -> tuple[str | None, str] | None:
        """(user, device) of a session, or (None, device) of an old device token; None if neither. A session unused for
        90 days ends here."""
        now = time.time() if now is None else now
        h = hash_token(token)
        rows = self._q("SELECT s.device, s.last_seen, u.name FROM sessions s JOIN users u ON u.id = s.user_id "
                       "WHERE s.token_hash = ?", (h,))
        if rows:
            if now - rows[0]["last_seen"] > auth.SESSION_IDLE_S:
                self._q("DELETE FROM sessions WHERE token_hash = ?", (h,))
                return None
            if now - rows[0]["last_seen"] > 60:  # one write a minute at most
                self._q("UPDATE sessions SET last_seen = ? WHERE token_hash = ?", (now, h))
            return rows[0]["name"], rows[0]["device"]
        device = self.device_for_token(token)
        return (None, device) if device is not None else None

    # ----- charts and widgets -----
    def _seed_charts(self) -> None:
        if self._q("SELECT 1 FROM charts LIMIT 1"):
            return
        for i, spec in enumerate(DEFAULT_CHARTS):
            self._q("INSERT INTO charts (id, spec, position) VALUES (?, ?, ?)", (spec.id, spec.model_dump_json(), i))

    def _colour_old_charts(self) -> None:
        """Charts saved before charts had a colour get one, once: the seeds their usual one, the rest from the palette
        by position (the first clients chose a colour by chart id)."""
        seeds = {c.id: c.color for c in DEFAULT_CHARTS}
        for i, r in enumerate(self._q("SELECT id, spec FROM charts ORDER BY position")):
            raw = json.loads(r["spec"])
            if "color" in raw:
                continue
            raw["color"] = seeds.get(r["id"]) or PALETTE[i % len(PALETTE)]
            self._q("UPDATE charts SET spec = ? WHERE id = ?", (json.dumps(raw), r["id"]))

    def charts(self) -> list[ChartSpec]:
        return [ChartSpec.model_validate_json(r["spec"]) for r in self._q("SELECT spec FROM charts ORDER BY position")]

    def chart(self, chart_id: str) -> ChartSpec | None:
        rows = self._q("SELECT spec FROM charts WHERE id = ?", (chart_id,))
        return ChartSpec.model_validate_json(rows[0]["spec"]) if rows else None

    def _free_id(self, table: str, base: str, device: str | None = None) -> str:
        where = " AND device = ?" if device is not None else ""
        n = 1
        while True:
            cid = base if n == 1 else f"{base}-{n}"
            args: tuple[Any, ...] = (cid, device) if device is not None else (cid,)
            if not self._q(f"SELECT 1 FROM {table} WHERE id = ?{where}", args):
                return cid
            n += 1

    def create_chart(self, spec: ChartSpec) -> ChartSpec:
        """Stores a new chart at the end; its id comes from the title (unique)."""
        spec = spec.model_copy(update={"id": self._free_id("charts", slug(spec.title) or "grafica")})
        with self._lock:
            pos = self._db.execute("SELECT COALESCE(MAX(position) + 1, 0) FROM charts").fetchone()[0]
            self._db.execute("INSERT INTO charts (id, spec, position) VALUES (?, ?, ?)",
                             (spec.id, spec.model_dump_json(), pos))
        return spec

    def update_chart(self, chart_id: str, spec: ChartSpec) -> ChartSpec | None:
        spec = spec.model_copy(update={"id": chart_id})
        with self._lock:
            n = self._db.execute("UPDATE charts SET spec = ? WHERE id = ?", (spec.model_dump_json(), chart_id)).rowcount
        return spec if n else None

    def delete_chart(self, chart_id: str) -> bool:
        """Deletes a chart and the widgets showing it (on every device)."""
        with self._lock:
            n = self._db.execute("DELETE FROM charts WHERE id = ?", (chart_id,)).rowcount
            self._db.execute("DELETE FROM widgets WHERE chart_id = ?", (chart_id,))
        return n > 0

    def order_charts(self, ids: list[str]) -> None:
        """Puts the given charts first, in that order; the rest keep their relative order after them."""
        current = [c.id for c in self.charts()]
        wanted = [i for i in dict.fromkeys(ids) if i in current]
        final = wanted + [i for i in current if i not in wanted]
        with self._lock:
            for pos, cid in enumerate(final):
                self._db.execute("UPDATE charts SET position = ? WHERE id = ?", (pos, cid))

    def _seed_widgets(self, device: str) -> None:
        for i, spec in enumerate(self.charts()):
            self._q("INSERT OR IGNORE INTO widgets (device, id, chart_id, size, position) VALUES (?, ?, ?, ?, ?)",
                    (device, f"w-{spec.id}", spec.id, "medium", i))

    def widgets(self, device: str) -> list[Widget]:
        rows = self._q("SELECT id, chart_id, size FROM widgets WHERE device = ? ORDER BY position", (device,))
        return [Widget(id=r["id"], chart_id=r["chart_id"], size=r["size"]) for r in rows]

    def add_widget(self, device: str, chart_id: str, size: str) -> Widget:
        wid = self._free_id("widgets", f"w-{chart_id}", device)
        with self._lock:
            pos = self._db.execute("SELECT COALESCE(MAX(position) + 1, 0) FROM widgets WHERE device = ?",
                                   (device,)).fetchone()[0]
            self._db.execute("INSERT INTO widgets (device, id, chart_id, size, position) VALUES (?, ?, ?, ?, ?)",
                             (device, wid, chart_id, size, pos))
        return Widget(id=wid, chart_id=chart_id, size=size)  # type: ignore[arg-type]

    def update_widget(self, device: str, widget_id: str, chart_id: str, size: str) -> Widget | None:
        with self._lock:
            n = self._db.execute("UPDATE widgets SET chart_id = ?, size = ? WHERE device = ? AND id = ?",
                                 (chart_id, size, device, widget_id)).rowcount
        return Widget(id=widget_id, chart_id=chart_id, size=size) if n else None  # type: ignore[arg-type]

    def delete_widget(self, device: str, widget_id: str) -> bool:
        with self._lock:
            return self._db.execute("DELETE FROM widgets WHERE device = ? AND id = ?",
                                    (device, widget_id)).rowcount > 0

    # ----- prefs -----
    def pref(self, device: str, key: str) -> str | None:
        rows = self._q("SELECT value FROM prefs WHERE device = ? AND key = ?", (device, key))
        return rows[0]["value"] if rows else None

    def set_pref(self, device: str, key: str, value: str) -> None:
        self._q("INSERT INTO prefs (device, key, value) VALUES (?, ?, ?) "
                "ON CONFLICT(device, key) DO UPDATE SET value = excluded.value", (device, key, value))

    # ----- captures (outbox) -----
    def capture(self, client_id: str) -> Capture | None:
        rows = self._q("SELECT * FROM captures WHERE client_id = ?", (client_id,))
        if not rows:
            return None
        r = rows[0]
        return Capture(r["client_id"], r["device"], r["action"], json.loads(r["request"]), r["status"],
                       json.loads(r["result"]) if r["result"] else None, r["path"], r["error"], r["attempts"])

    def insert_capture(self, client_id: str, device: str, action: str, request: dict[str, Any]) -> bool:
        """False if this client_id was already received (idempotent retry)."""
        with self._lock:
            cur = self._db.execute(
                "INSERT OR IGNORE INTO captures (client_id, device, action, request, status, created, updated) "
                "VALUES (?, ?, ?, ?, 'queued', ?, ?)",
                (client_id, device, action, json.dumps(request), _now(), _now()))
            return cur.rowcount == 1

    def update_capture(self, client_id: str, *, status: str, result: dict[str, Any] | None = None,
                       path: str | None = None, error: str | None = None, attempt: bool = False) -> None:
        self._q("UPDATE captures SET status = ?, result = COALESCE(?, result), path = COALESCE(?, path), error = ?, "
                "attempts = attempts + ?, updated = ? WHERE client_id = ?",
                (status, json.dumps(result) if result is not None else None, path, error, 1 if attempt else 0,
                 _now(), client_id))

    def queued_captures(self) -> list[Capture]:
        rows = self._q("SELECT client_id FROM captures WHERE status = 'queued' ORDER BY created")
        return [c for r in rows if (c := self.capture(r["client_id"])) is not None]

    def discard_capture(self, client_id: str) -> None:
        """Forget a capture that was rejected on arrival (nothing was saved; the client may resend it)."""
        self._q("DELETE FROM captures WHERE client_id = ?", (client_id,))
