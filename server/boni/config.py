"""Settings from environment variables. Secrets (tokens) only come from the environment, never from repo files."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class Settings:
    db_path: str = "boni.sqlite3"
    vault_mcp_url: str = ""
    vault_mcp_token: str = field(default="", repr=False)
    timezone: str = "Europe/Madrid"
    outbox_interval_s: float = 60.0
    cache_ttl_s: float = 120.0
    warm_interval_s: float = 110.0  # background refresh, a bit below the cache TTL so requests rarely wait

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    @staticmethod
    def from_env(env: dict[str, str] | None = None) -> Settings:
        e = os.environ if env is None else env
        return Settings(
            db_path=e.get("BONI_DB", "boni.sqlite3"),
            vault_mcp_url=e.get("BONI_VAULT_MCP_URL", ""),
            vault_mcp_token=e.get("BONI_VAULT_MCP_TOKEN", ""),
            timezone=e.get("BONI_TZ", "Europe/Madrid"),
            outbox_interval_s=float(e.get("BONI_OUTBOX_INTERVAL", "60")),
            cache_ttl_s=float(e.get("BONI_CACHE_TTL", "120")),
            warm_interval_s=float(e.get("BONI_WARM_INTERVAL", "110")),
        )
