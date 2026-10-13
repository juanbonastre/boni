"""In-process stand-in for vault-mcp 0.4.0: the tools Boni uses, with the same argument names and result shapes
(observed against the real server on 2026-10-12), over a temporary folder of Markdown notes."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError


def frontmatter(text: str) -> dict[str, Any]:
    if not text.startswith("---\n"):
        return {}
    end = text.find("\n---", 3)
    data = yaml.safe_load(text[4:end]) or {}
    return {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in data.items()}


class FakeVault:
    def __init__(self, root: Path):
        self.root = root
        self.writes: list[dict[str, Any]] = []
        self.down = False  # simulate the NAS being unreachable

    def write(self, rel: str, text: str) -> None:
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)

    def read(self, rel: str) -> str:
        return (self.root / rel).read_text()

    def server(self) -> MCPServer:
        if self.down:
            raise ConnectionError("vault-mcp unreachable (simulated)")
        s = MCPServer("vault-mcp-fake")
        root = self.root

        @s.tool()
        def query_notes(type: str | None = None, folder: str = "", tag: str | None = None,
                        where: dict[str, str] | None = None, date_field: str = "date", date_from: str | None = None,
                        date_to: str | None = None, fields: list[str] | None = None, limit: int = 50) -> dict:
            base = root / folder
            if not base.exists():  # like vault-mcp's _resolve
                raise ToolError(f"not found: {folder}")
            out = []
            for p in sorted(base.rglob("*.md")):
                fm = frontmatter(p.read_text())
                if type and fm.get("type") != type:
                    continue
                if where and any(str(fm.get(k)) != v for k, v in where.items()):
                    continue
                d = str(fm.get(date_field) or "")
                if (date_from and d < date_from) or (date_to and d > date_to):
                    continue
                row: dict[str, Any] = {"path": str(p.relative_to(root)), "type": fm.get("type")}
                for k in ["date", "status", *(fields or [])]:
                    if k in fm:
                        row[k] = fm[k]
                out.append(row)
            out.sort(key=lambda r: str(r.get(date_field) or ""), reverse=True)
            return {"result": out[: max(1, min(limit, 500))]}  # MAX_LIST in vault-mcp

        @s.tool()
        def read_note(path: str, max_chars: int = 60000) -> dict:
            p = root / path
            if not p.exists():
                raise ToolError(f"not found: {path}")
            text = p.read_text()
            return {"path": path, "size": len(text), "truncated": False, "content": text[:max_chars]}

        @s.tool()
        def create_note(path: str, content: str, reason: str) -> dict:
            p = root / path
            if p.exists():
                raise ToolError(f"already exists: {path}")
            if not path.endswith(".md") or ".." in path:
                raise ToolError("bad path")
            frontmatter(content)  # must parse, like the real server
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content)
            self.writes.append({"path": path, "reason": reason})
            return {"path": path, "commit": f"fake{len(self.writes):03d}", "state_before": None}

        return s
