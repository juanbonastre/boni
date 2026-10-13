"""Money data adapter. The ONLY module that knows the vault's finance note formats (registros/finanzas/README.md),
reached through vault-mcp tools (`query_notes`, `read_note`, `create_note`). Everything else in Boni sees plain records.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from boni.sources.mcp_client import McpSource, Session, SourceError

FIN = "registros/finanzas"
MOV = FIN + "/movimientos"
DEBTS = FIN + "/deudas"
CATEGORIES_NOTE = FIN + "/categorias.md"
PEOPLE = "registros/personas"
QUERY_LIMIT = 500  # vault-mcp caps query_notes at 500 (MAX_LIST); a full page may be truncated -> error
MOVEMENT_FIELDS = ["time", "amount", "my_share", "category", "settles", "people", "invited", "merchant", "concept",
                   "account", "status"]
DEBT_FIELDS = ["person", "movement", "amount", "direction", "status"]


def link_name(v: Any) -> str:
    """'[[name|alias]]' -> 'name'."""
    s = str(v or "").strip()
    if s.startswith("[[") and s.endswith("]]"):
        s = s[2:-2]
    return s.split("|", 1)[0].split("#", 1)[0].strip()


def as_list(v: Any) -> list[Any]:
    if v is None or v == "":
        return []
    return list(v) if isinstance(v, list) else [v]


def to_float(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return None


def note_name(path: str) -> str:
    return path.rsplit("/", 1)[-1].removesuffix(".md")


@dataclass(frozen=True)
class Movement:
    name: str
    date: date
    amount: float
    category: str
    my_share: float | None = None
    settles: str = ""
    people: tuple[str, ...] = ()


@dataclass(frozen=True)
class Debt:
    name: str
    movement: str
    amount: float
    direction: str
    status: str
    date: date | None = None


@dataclass(frozen=True)
class Person:
    slug: str
    label: str
    hint: str | None = None


def _parse_date(v: Any) -> date | None:
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def parse_movement(row: dict[str, Any]) -> Movement | None:
    d = _parse_date(row.get("date"))
    amount = to_float(row.get("amount"))
    if d is None or amount is None:
        return None
    return Movement(
        name=note_name(row["path"]),
        date=d,
        amount=amount,
        category=str(row.get("category") or ""),
        my_share=to_float(row.get("my_share")),
        settles=link_name(row.get("settles")),
        people=tuple(link_name(p) for p in as_list(row.get("people"))),
    )


def parse_debt(row: dict[str, Any]) -> Debt | None:
    amount = to_float(row.get("amount"))
    if amount is None:
        return None
    return Debt(
        name=note_name(row["path"]),
        movement=link_name(row.get("movement")),
        amount=abs(amount),
        direction=str(row.get("direction") or "me-deben"),
        status=str(row.get("status") or ""),
        date=_parse_date(row.get("date")),
    )


def title_from_slug(slug: str) -> str:
    return " ".join(w[:1].upper() + w[1:] for w in slug.split("-") if w)


def parse_categories(note_text: str) -> list[str]:
    """The `categories:` block list of categorias.md front matter."""
    out: list[str] = []
    lines = note_text.replace("\r\n", "\n").split("\n")
    if not lines or lines[0] != "---":
        return out
    in_key = False
    for line in lines[1:]:
        if line == "---":
            break
        if line.startswith("categories:"):
            rest = line.split(":", 1)[1].strip()
            if rest.startswith("[") and rest.endswith("]"):
                return [x.strip().strip("\"'") for x in rest[1:-1].split(",") if x.strip()]
            in_key = True
            continue
        if in_key:
            s = line.strip()
            if s.startswith("- "):
                out.append(s[2:].strip().strip("\"'"))
            elif s and not line.startswith(" "):
                in_key = False
    return out


@dataclass
class _Cached:
    at: float
    value: Any


@dataclass
class FinanzasSource:
    """Reads movements, debts, categories and people; writes new movement notes. Caches reads for `ttl_s` seconds."""

    mcp: McpSource
    ttl_s: float = 120.0          # movements and debts
    lists_ttl_s: float = 900.0    # categories and people change rarely
    _cache: dict[str, _Cached] = field(default_factory=dict)

    # ----- cache -----
    def _get(self, key: str, ttl: float | None = None) -> Any | None:
        c = self._cache.get(key)
        if c and time.monotonic() - c.at < (self.ttl_s if ttl is None else ttl):
            return c.value
        return None

    def _stale(self, key: str) -> Any | None:
        c = self._cache.get(key)
        return c.value if c else None

    def _put(self, key: str, value: Any) -> Any:
        self._cache[key] = _Cached(time.monotonic(), value)
        return value

    def invalidate_month(self, year: int, month: int) -> None:
        self._cache.pop(f"mov:{year:04d}-{month:02d}", None)
        self._cache.pop(f"names:{year:04d}-{month:02d}", None)

    # ----- reads -----
    async def _query(self, s: Session, **kw: Any) -> list[dict[str, Any]]:
        try:
            res = await s.call("query_notes", {"limit": QUERY_LIMIT, **kw})
        except SourceError as e:
            # vault-mcp answers "not found: <folder>" for a month without notes yet: that is an empty month.
            if kw.get("folder") and f"not found: {kw['folder']}" in str(e):
                return []
            raise
        rows = res.get("result", res) if isinstance(res, dict) else res
        if not isinstance(rows, list):
            raise SourceError(f"query_notes: unexpected result {type(rows).__name__}")
        if len(rows) >= QUERY_LIMIT:
            raise SourceError(f"query_notes: {len(rows)} results, limit reached ({kw.get('folder')})")
        return rows

    async def movements(self, months: list[tuple[int, int]], force: bool = False) -> list[Movement]:
        """Movements of the given (year, month) folders (cached per month)."""
        out: list[Movement] = []
        missing = []
        for y, m in months:
            v = None if force else self._get(f"mov:{y:04d}-{m:02d}")
            if v is None:
                missing.append((y, m))
            else:
                out.extend(v)
        if missing:
            async with self.mcp.connect() as s:
                for y, m in missing:
                    rows = await self._query(s, type="movement", folder=f"{MOV}/{y:04d}/{m:02d}",
                                             fields=MOVEMENT_FIELDS)
                    mv = [x for x in (parse_movement(r) for r in rows) if x is not None]
                    out.extend(self._put(f"mov:{y:04d}-{m:02d}", mv))
        return out

    def cached_movements(self, months: list[tuple[int, int]]) -> list[Movement] | None:
        """Last known movements even if expired (source down); None if any month was never loaded."""
        out: list[Movement] = []
        for y, m in months:
            v = self._stale(f"mov:{y:04d}-{m:02d}")
            if v is None:
                return None
            out.extend(v)
        return out

    async def debts(self, force: bool = False) -> list[Debt]:
        v = None if force else self._get("debts")
        if v is not None:
            return v
        async with self.mcp.connect() as s:
            rows = await self._query(s, type="debt", folder=DEBTS, fields=DEBT_FIELDS)
        return self._put("debts", [x for x in (parse_debt(r) for r in rows) if x is not None])

    def cached_debts(self) -> list[Debt] | None:
        return self._stale("debts")

    async def categories(self, force: bool = False) -> list[str]:
        v = None if force else self._get("categories", self.lists_ttl_s)
        if v is not None:
            return v
        async with self.mcp.connect() as s:
            res = await s.call("read_note", {"path": CATEGORIES_NOTE})
        text = res.get("content") if isinstance(res, dict) else None
        if not text:
            raise SourceError("categorias.md: empty or unreadable")
        return self._put("categories", parse_categories(text))

    async def people(self, force: bool = False) -> list[Person]:
        v = None if force else self._get("people", self.lists_ttl_s)
        if v is not None:
            return v
        async with self.mcp.connect() as s:
            rows = await self._query(s, type="person", folder=PEOPLE, fields=["summary"])
        people = [Person(note_name(r["path"]), title_from_slug(note_name(r["path"])), r.get("summary") or None)
                  for r in rows]
        people.sort(key=lambda p: p.label.lower())
        return self._put("people", people)

    async def taken_names(self, s: Session, year: int, month: int) -> set[str]:
        """Note names already in a month folder (any type), to pick a free file name."""
        rows = await self._query(s, folder=f"{MOV}/{year:04d}/{month:02d}")
        return {note_name(r["path"]) for r in rows}

    # ----- writes -----
    async def create_movement(self, d: date, base: str, content: str, reason: str) -> str:
        """Write a movement note at movimientos/YYYY/MM/<base>[-N].md; returns the path written."""
        folder = f"{MOV}/{d.year:04d}/{d.month:02d}"
        async with self.mcp.connect() as s:
            taken = await self.taken_names(s, d.year, d.month)
            for attempt in range(3):
                n = 1
                while (name := base if n == 1 else f"{base}-{n}") in taken:
                    n += 1
                path = f"{folder}/{name}.md"
                try:
                    await s.call("create_note", {"path": path, "content": content, "reason": reason})
                except SourceError:
                    # Maybe someone wrote that name meanwhile (another device via Syncthing): look again, retry.
                    taken = await self.taken_names(s, d.year, d.month)
                    if name in taken and attempt < 2:
                        continue
                    raise
                self.invalidate_month(d.year, d.month)
                return path
        raise SourceError("could not find a free note name")
