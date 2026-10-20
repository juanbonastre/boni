"""Golden results for the Boni API v1 port (apps/server/src/v1): the ORIGINAL Python server of the first Boni
(legacy/boni/server) computes each case; the TypeScript port must give the same (v1.test.ts). Run it again only when the
cases change, with a Python that has pydantic:

    /path/to/python make_golden.py && npx biome format --write .

Invented values only (the repo is public).
"""

import asyncio
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[4] / "legacy" / "boni" / "server"))

from boni.contract import ChartSpec  # noqa: E402
from boni.expenses import capture  # noqa: E402
from boni.expenses.note import base_name, render, slug, suggested_share  # noqa: E402
from boni.service import Service  # noqa: E402
from boni.sources.finanzas import Movement, Person, parse_categories, parse_debt, parse_movement  # noqa: E402
from boni.stats import engine  # noqa: E402
from boni.stats.charts import DEFAULT_CHARTS  # noqa: E402

out: dict = {}
out["screen"] = capture.screen(None).model_dump(mode="json")
out["screen_revolut"] = capture.screen("revolut").model_dump(mode="json")
out["catalog"] = engine.catalog().model_dump(mode="json")
out["default_charts"] = [c.model_dump(mode="json") for c in DEFAULT_CHARTS]

RAW_SPECS = [
    {"title": "Legado por grupo", "kind": "hbar", "group_by": "category_group", "period": {"kind": "this_month"}},
    {"title": "Legado por mes", "kind": "bar", "group_by": "month", "period": {"kind": "last_months", "months": 6},
     "filter": {"include": ["comida/"], "exclude": ["comida/supermercado"]}},
    {"title": "Fecha sin granularidad", "kind": "line", "x": {"field": "date"}, "split": {"field": "date"}, "period": {"kind": "all"}},
    {"title": "Completa", "kind": "table", "x": {"field": "merchant"}, "period": {"kind": "range", "start": "2026-01-01", "end": "2026-02-01"},
     "filters": [{"field": "amount", "op": "gte", "values": [10]}], "top": 5, "sort": "label", "drilldown": True, "home": False, "color": "#f472b6",
     "extra_unknown": 1},
]
out["specs"] = [{"raw": r, "spec": ChartSpec.model_validate(r).model_dump(mode="json")} for r in RAW_SPECS]

TODAY = date(2026, 10, 19)
CATS = ["comida/restaurante", "comida/supermercado", "bebida/cafe", "ingreso/nomina", "transferencia/ahorro", "ocio/cine"]
PEOPLE = {"lucia-ferri", "tomas", "pablo-soler-gil"}
TZ = timezone(timedelta(hours=2))
VALUES = [
    {"kind": "gasto", "amount": "94,1", "account": "revolut", "category": "comida/restaurante", "concept": 'Cena "Kumo"', "merchant": "Kumo",
     "people": ["lucia-ferri", "tomas"], "shared": True, "invited": ["lucia-ferri"], "date": "2026-09-18"},
    {"kind": "gasto", "amount": 90, "account": "efectivo", "category": "comida/restaurante", "concept": "Cena", "people": ["tomas", "lucia-ferri", "pablo-soler-gil"],
     "shared": True, "invited": ["tomas"], "date": "today"},
    {"kind": "gasto", "amount": "12.345", "account": "ing", "category": "bebida/cafe", "concept": "", "merchant": "  Café Ñandú  ", "date": "today"},
    {"kind": "ingreso", "amount": "20", "account": "ing", "category": "ingreso/nomina", "concept": "", "merchant": "", "date": "2026-10-18"},
    {"kind": "gasto", "amount": "10", "account": "revolut", "category": "comida/restaurante", "shared": True, "people": ["tomas"], "my_share": "3,5", "date": "2026-10-19"},
    {"kind": "gasto", "amount": "10", "account": "revolut", "category": "comida/restaurante", "shared": True, "people": ["tomas"], "my_share": "15", "date": "2026-10-19"},
    {"kind": "otro", "amount": "0", "account": "bbva", "category": "", "date": "2026-13-01"},
    {"kind": "gasto", "amount": "100001", "account": "ing", "category": "inventada", "people": ["nadie"], "date": "2026-10-25", "concept": "x" * 201},
    {"kind": "gasto", "amount": "5", "account": "ing", "category": "ocio/cine", "shared": True, "people": [], "date": "2026-10-20"},
    {"amount": "abc", "account": "efectivo", "category": "ocio/cine"},
]
CREATED = [datetime(2026, 9, 18, 22, 58, tzinfo=TZ), datetime(2026, 10, 19, 9, 5, tzinfo=TZ), None, datetime(2026, 10, 19, 8, 0, tzinfo=TZ), None, None, None, None, None, None]
captures = []
for values, created in zip(VALUES, CREATED, strict=True):
    for cats, people in ((CATS, PEOPLE), (None, None)):
        today = created.date() if created else TODAY
        d, errors = capture.validate(values, categories=cats, people=people, created_at=created, today=today)
        item = {"values": values, "created_at": created.isoformat() if created else None, "today": today.isoformat(),
                "lists": cats is not None, "errors": errors}
        if d is not None:
            item["base_name"] = base_name(d)
            item["note"] = render(d, TODAY)
        captures.append(item)
out["captures"] = captures
out["shares"] = [{"amount": a, "people": p, "invited": i, "share": str(suggested_share(__import__("decimal").Decimal(a), p, i))}
                 for a, p, i in [("90", 3, 1), ("94.1", 2, 1), ("10", 2, 0), ("0.05", 2, 0), ("100", 6, 2), ("33.33", 2, 1)]]
out["slugs"] = [{"text": t, "max": m, "slug": slug(t, m)} for t, m in [("Cena con Peña y Ruíz!", 60), ("Cafe con leche en la cafeteria", 10),
                                                                    ("  ¡Hola!  ", 60), ("---", 60), ("Ü-ber_cool 2.0", 60)]]

CAT_NOTES = [
    "---\ntype: wiki\ncategories:\n  - comida/restaurante\n  - \"bebida/cafe\"\n  - 'ocio/cine'\nother: 1\n---\nbody\n",
    "---\ncategories: [comida/a, \"comida/b\", ocio]\n---\n",
    "no frontmatter\n",
]
out["categories"] = [{"text": t, "categories": parse_categories(t)} for t in CAT_NOTES]
ROWS = [
    {"path": "registros/finanzas/movimientos/2026/10/2026-10-19-cafe.md", "date": "2026-10-19", "amount": -1.6, "category": "bebida/cafe",
     "people": ["[[tomas]]", "[[lucia-ferri|Lucía]]"], "settles": "[[d-001#x]]", "merchant": " Bar ", "my_share": "0,8", "account": "efectivo"},
    {"path": "registros/finanzas/movimientos/2026/10/x.md", "date": "2026-10-19T10:00:00", "amount": "12", "category": None, "related": "[[viaje]]"},
    {"path": "registros/finanzas/movimientos/2026/10/bad.md", "date": "nope", "amount": 1},
    {"path": "registros/finanzas/movimientos/2026/10/bad2.md", "date": "2026-10-19", "amount": ""},
]
out["movements"] = [{"row": r, "movement": (lambda m: None if m is None else {**m.__dict__, "date": m.date.isoformat(), "people": list(m.people),
                                                                                 "invited": list(m.invited), "related": list(m.related)})(parse_movement(r))} for r in ROWS]
DROWS = [{"path": "registros/finanzas/deudas/d-001.md", "movement": "[[2026-10-19-cena]]", "amount": "-12,5", "direction": None, "status": "pendiente"},
         {"path": "registros/finanzas/deudas/d-002.md", "movement": "x", "amount": None}]
out["debts"] = [{"row": r, "debt": (lambda d: None if d is None else {**d.__dict__, "date": d.date.isoformat() if d.date else None})(parse_debt(r))} for r in DROWS]


class FakeFin:
    class mcp:
        configured = True

    def __init__(self, movements, cats, people):
        self._m, self._c, self._p = movements, cats, people

    async def movements(self, months, force=False):
        # As FinanzasSource: month by month in the order asked for, each month's notes by name.
        return [m for ym in months for m in sorted(self._m, key=lambda m: m.name) if (m.date.year, m.date.month) == ym]

    async def categories(self, force=False):
        return self._c

    async def people(self, force=False):
        return self._p


class FakeStore:
    def charts(self):
        return []

    def pref(self, d, k):
        return None


MOVS = [Movement(name=f"m{i}", date=date(2026, 10, 1) - timedelta(days=40 * i), amount=-5.0, category="ocio/cine",
                 merchant=mer, related=rel, status=st, source=src)
        for i, (mer, rel, st, src) in enumerate([("Cine Ficticio", ("viaje-ejemplo",), "pendiente", "manual"), ("cine ficticio", (), "conciliado", "banco"),
                                                 ("Bar Inventado", ("viaje-ejemplo", "curso-ejemplo"), "", "boni"), ("Óptica Demo", (), "conciliado", "banco"),
                                                 ("Muy Viejo", (), "x", "y")] * 4)]
PEOPLE_LIST = [Person("lucia-ferri", "Lucia Ferri", "Amiga"), Person("tomas", "Tomas", None)]
svc = Service(FakeStore(), FakeFin(MOVS, CATS, PEOPLE_LIST), TZ, now=lambda: datetime(2026, 10, 19, 12, 0, tzinfo=TZ))
opts = []
for source, q, limit in [("categories", "", 50), ("categories", "com", 50), ("groups", "", 50), ("accounts", "", 50), ("people", "luc", 50),
                         ("merchants", "", 50), ("merchants", "cine", 1), ("related", "", 50), ("statuses", "", 50), ("sources", "", 50)]:
    opts.append({"source": source, "q": q, "limit": limit, "options": [o.model_dump(mode="json") for o in asyncio.run(svc.options(source, q, limit))]})
out["options"] = opts
out["movements_for_options"] = [{**m.__dict__, "date": m.date.isoformat(), "people": [], "invited": [], "related": list(m.related)} for m in MOVS]

(HERE / "v1.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
print(f"{len(captures)} captures, {len(opts)} option lists, {len(out['specs'])} specs")
