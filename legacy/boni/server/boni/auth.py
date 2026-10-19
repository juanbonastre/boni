"""Accounts and logins, as in Boni Calendar's server: accounts are made by the administrator (`boni user add`), never
by sign-up; a device logs in once with a name and keeps a session token, of which the server stores only the hash. A
session not used for 90 days ends. Failed logins are limited per user, per address and overall."""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import time
from collections.abc import Callable

SCRYPT = {"n": 16384, "r": 8, "p": 1}
KEYLEN = 32
MIN_PASSWORD = 12
USER_NAME = re.compile(r"^[a-z0-9._-]{2,32}$", re.IGNORECASE)
SESSION_IDLE_S = 90 * 86400


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    h = hashlib.scrypt(password.encode(), salt=salt, dklen=KEYLEN, **SCRYPT)
    return f"scrypt${base64.b64encode(salt).decode()}${base64.b64encode(h).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        kind, salt, want = stored.split("$")
        if kind != "scrypt":
            return False
        want_b = base64.b64decode(want)
        got = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), dklen=len(want_b), **SCRYPT)
    except ValueError:
        return False
    return hmac.compare_digest(got, want_b)


# Hashed once: logins for unknown users do the same work as real ones (timing does not tell who exists).
_DUMMY = hash_password("not a real password, only for timing")


def check(password: str, stored: str | None) -> bool:
    ok = verify_password(password, stored or _DUMMY)
    return stored is not None and ok


class LoginGuard:
    """Failed logins per user and per address in a window, and attempts per minute overall. Kept in memory: a restart
    forgets them (an attacker cannot restart the server). A locked user keeps the sessions already open."""

    def __init__(self, per_user: int = 5, per_address: int = 10, window_s: float = 900, per_minute: int = 30,
                 now: Callable[[], float] = time.monotonic):
        self.per_user, self.per_address, self.window_s, self.per_minute = per_user, per_address, window_s, per_minute
        self.now = now
        self._failures: dict[str, list[float]] = {}
        self._attempts: list[float] = []

    def _recent(self, key: str) -> list[float]:
        since = self.now() - self.window_s
        kept = [t for t in self._failures.get(key, []) if t > since]
        if kept:
            self._failures[key] = kept
        else:
            self._failures.pop(key, None)
        return kept

    def allow(self, user: str, address: str) -> bool:
        now = self.now()
        self._attempts = [t for t in self._attempts if t > now - 60]
        if len(self._attempts) >= self.per_minute:
            return False
        self._attempts.append(now)
        return (len(self._recent(f"u:{user.lower()}")) < self.per_user
                and len(self._recent(f"a:{address}")) < self.per_address)

    def failed(self, user: str, address: str) -> None:
        now = self.now()
        for key in (f"u:{user.lower()}", f"a:{address}"):
            self._failures[key] = [*self._recent(key), now]

    def succeeded(self, user: str) -> None:
        """A good login clears that user's failures (not the address's: one good guess is not a pass)."""
        self._failures.pop(f"u:{user.lower()}", None)
