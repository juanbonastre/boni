"""Golden results for the chart engine port (packages/views): the ORIGINAL Python engine of the first Boni
(legacy/boni/server/boni/stats/engine.py) computes every spec below on invented data; the TypeScript engine must
give the same (chart.test.ts). Run it again only when the cases change:

    /path/to/a/python-with-pydantic make_golden.py

Invented data only (the repo is public): a seeded generator, names like ana-ejemplo.
"""

import json
import random
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / "legacy" / "boni" / "server"))

from boni.contract import ChartSpec  # noqa: E402
from boni.sources.finanzas import Debt, Movement  # noqa: E402
from boni.stats.engine import SpecError, compute, records  # noqa: E402

rnd = random.Random(20261019)
CATS = ["comida/supermercado", "comida/restaurante", "comida/cafeteria", "bebida/cafe", "bebida/alcohol", "ocio/cine",
        "ocio/conciertos", "transporte/taxi", "transporte/tren", "hogar/luz", "suscripciones/musica", "salud/farmacia",
        "regalos", ""]
PEOPLE = ["ana-ejemplo", "luis-ejemplo", "marta-ejemplo"]
ACCOUNTS = ["efectivo", "revolut", "ing"]
MERCHANTS = ["Mercado Ejemplo", "Bar Inventado", "Cine Ficticio", "Taxi Prueba", "Farmacia Demo", ""]

movements: list[dict] = []
debts: list[dict] = []
day = date(2025, 9, 1)
n = 0
while day <= date(2026, 10, 19):
    for _ in range(rnd.choice([0, 0, 1, 1, 2, 3])):
        n += 1
        cat = rnd.choice(CATS)
        amount = -round(rnd.uniform(1, 90), 2)
        m = {"name": f"m{n:04d}", "date": day.isoformat(), "amount": amount, "category": cat,
             "account": rnd.choice(ACCOUNTS), "merchant": rnd.choice(MERCHANTS), "concept": rnd.choice(["", "cena", "compra", "regalo de Ana", "Café"]),
             "status": rnd.choice(["pendiente", "conciliado"]), "source": rnd.choice(["manual", "banco", ""]),
             "people": [], "invited": [], "related": [], "my_share": None, "settles": ""}
        if rnd.random() < 0.25:
            m["people"] = rnd.sample(PEOPLE, rnd.choice([1, 2]))
            m["my_share"] = round(-amount / (len(m["people"]) + 1), 2)
            for p in m["people"]:
                n += 1
                dname = f"d{n:04d}"
                st = rnd.choice(["pendiente", "pagada", "perdonada", "invitacion"])
                debts.append({"name": dname, "movement": m["name"], "amount": m["my_share"], "direction": "me-deben", "status": st})
                if st == "pagada":
                    movements.append({"name": f"m{n:04d}p", "date": (day + timedelta(days=rnd.randint(0, 20))).isoformat(),
                                      "amount": m["my_share"], "category": cat, "account": "revolut", "merchant": "",
                                      "concept": "me devuelve", "status": "conciliado", "source": "banco", "people": [p],
                                      "invited": [], "related": [], "my_share": None, "settles": dname})
        if rnd.random() < 0.1:
            m["invited"] = rnd.sample(PEOPLE, 1)
        if rnd.random() < 0.1:
            m["related"] = [rnd.choice(["viaje-ejemplo", "curso-ejemplo"])]
        movements.append(m)
        if rnd.random() < 0.05:  # a shop refund of part of it
            n += 1
            movements.append({**m, "name": f"m{n:04d}r", "amount": round(-amount / 2, 2), "my_share": None,
                              "settles": m["name"], "concept": "devolución", "people": [], "invited": []})
    if day.day == 28:
        n += 1
        movements.append({"name": f"m{n:04d}", "date": day.isoformat(), "amount": 1800.0, "category": "ingreso/nomina",
                          "account": "ing", "merchant": "Empresa Ejemplo", "concept": "nómina", "status": "conciliado",
                          "source": "banco", "people": [], "invited": [], "related": [], "my_share": None, "settles": ""})
        n += 1
        movements.append({"name": f"m{n:04d}", "date": day.isoformat(), "amount": -300.0, "category": "transferencia/ahorro",
                          "account": "ing", "merchant": "", "concept": "ahorro", "status": "conciliado", "source": "banco",
                          "people": [], "invited": [], "related": [], "my_share": None, "settles": ""})
    day += timedelta(days=1)


def to_movement(d: dict) -> Movement:
    return Movement(name=d["name"], date=date.fromisoformat(d["date"]), amount=d["amount"], category=d["category"],
                    my_share=d["my_share"], settles=d["settles"], people=tuple(d["people"]), invited=tuple(d["invited"]),
                    related=tuple(d["related"]), account=d["account"], merchant=d["merchant"], concept=d["concept"],
                    status=d["status"], source=d["source"])


def to_debt(d: dict) -> Debt:
    return Debt(name=d["name"], movement=d["movement"], amount=d["amount"], direction=d["direction"], status=d["status"])


recs = records([to_movement(m) for m in movements], [to_debt(d) for d in debts])
months = {(date.fromisoformat(m["date"]).year, date.fromisoformat(m["date"]).month) for m in movements}

P = lambda kind, **kw: {"kind": kind, **kw}  # noqa: E731
X = lambda field, gran=None: {"field": field, **({"granularity": gran} if gran else {})}  # noqa: E731
CASES = [
    ("mes por grupo", {"title": "Gasto del mes", "kind": "hbar", "x": X("group"), "period": P("this_month"), "drilldown": True}),
    ("mes por grupo, mes pasado", {"title": "Mes pasado", "kind": "hbar", "x": X("group"), "period": P("last_month")}),
    ("evolución 12 meses con media", {"title": "Por mes", "kind": "bar", "x": X("date", "month"), "period": P("last_months", months=12)}),
    ("evolución todo", {"title": "Todo", "kind": "line", "x": X("date", "month"), "period": P("all")}),
    ("cifra con periodo anterior", {"title": "Cifra", "kind": "number", "period": P("this_month"), "compare": "previous_period"}),
    ("cifra con año anterior", {"title": "Cifra año", "kind": "number", "period": P("this_year"), "compare": "previous_year"}),
    ("comida fuera", {"title": "Comida fuera", "kind": "bar", "x": X("date", "month"), "period": P("last_months", months=6),
                       "filters": [{"field": "category", "op": "prefix", "values": ["comida"]}, {"field": "category", "op": "not_in", "values": ["comida/supermercado"]}]}),
    ("por categoría top 5", {"title": "Top", "kind": "hbar", "x": X("category"), "period": P("this_year"), "top": 5}),
    ("anillo por grupo", {"title": "Anillo", "kind": "donut", "x": X("group"), "period": P("last_months", months=3)}),
    ("anillo muchas categorías", {"title": "Anillo cat", "kind": "donut", "x": X("category"), "period": P("all")}),
    ("tabla por cuenta", {"title": "Cuentas", "kind": "table", "x": X("account"), "period": P("all"), "sort": "label"}),
    ("comercios ascendente", {"title": "Comercios", "kind": "hbar", "x": X("merchant"), "period": P("all"), "sort": "value_asc"}),
    ("con quién", {"title": "Con quien", "kind": "hbar", "x": X("people"), "period": P("all")}),
    ("invitados", {"title": "Invitados", "kind": "hbar", "x": X("invited"), "period": P("all")}),
    ("proyectos", {"title": "Proyectos", "kind": "table", "x": X("related"), "period": P("all")}),
    ("estado y origen", {"title": "Estado", "kind": "table", "x": X("status"), "split": X("source"), "period": P("all")}),
    ("por semana", {"title": "Semanas", "kind": "bar", "x": X("date", "week"), "period": P("last_days", days=60)}),
    ("por día", {"title": "Dias", "kind": "line", "x": X("date", "day"), "period": P("last_days", days=20)}),
    ("por trimestre", {"title": "Trimestres", "kind": "bar", "x": X("date", "quarter"), "period": P("all")}),
    ("por año", {"title": "Años", "kind": "bar", "x": X("date", "year"), "period": P("all")}),
    ("día de la semana", {"title": "Dia semana", "kind": "bar", "x": X("date", "weekday"), "period": P("last_months", months=6), "drilldown": True}),
    ("entre fechas", {"title": "Rango", "kind": "bar", "x": X("date", "month"), "period": P("range", start="2025-11-15", end="2026-02-10")}),
    ("entre fechas comparado", {"title": "Rango cmp", "kind": "bar", "x": X("date", "week"), "period": P("range", start="2026-03-03", end="2026-04-20"), "compare": "previous_period"}),
    ("barras apiladas por grupo", {"title": "Apiladas", "kind": "stacked_bar", "x": X("date", "month"), "split": X("group"), "period": P("last_months", months=8)}),
    ("series por año", {"title": "Series fecha", "kind": "line", "x": X("group"), "split": X("date", "year"), "period": P("all")}),
    ("ingresos por mes", {"title": "Ingresos", "kind": "bar", "measure": "income", "x": X("date", "month"), "period": P("this_year")}),
    ("número de gastos", {"title": "Cuantos", "kind": "bar", "measure": "count", "x": X("group"), "period": P("last_months", months=4)}),
    ("gasto medio", {"title": "Medio", "kind": "bar", "measure": "average", "x": X("date", "month"), "period": P("last_months", months=4)}),
    ("comparar categorías año anterior", {"title": "Cat cmp", "kind": "hbar", "x": X("category"), "period": P("this_month"), "compare": "previous_year", "top": 4}),
    ("comparar meses periodo anterior", {"title": "Mes cmp", "kind": "bar", "x": X("date", "month"), "period": P("last_months", months=3), "compare": "previous_period"}),
    ("ordenado por valor en el tiempo", {"title": "Orden", "kind": "bar", "x": X("date", "month"), "period": P("this_year"), "sort": "value_desc"}),
    ("filtros de texto", {"title": "Texto", "kind": "hbar", "x": X("group"), "period": P("all"),
                          "filters": [{"field": "concept", "op": "contains", "values": ["cafe"]}]}),
    ("filtros vacíos", {"title": "Vacios", "kind": "hbar", "x": X("account"), "period": P("all"),
                        "filters": [{"field": "merchant", "op": "empty"}, {"field": "people", "op": "not_empty"}]}),
    ("filtros de importe y fecha", {"title": "Importe", "kind": "hbar", "x": X("group"), "period": P("all"),
                                    "filters": [{"field": "amount", "op": "gte", "values": [20]}, {"field": "amount", "op": "lte", "values": ["60,5"]},
                                                {"field": "date", "op": "gte", "values": ["2026-01-01"]}]}),
    ("filtros de conjunto", {"title": "Conjunto", "kind": "hbar", "x": X("category"), "period": P("all"),
                             "filters": [{"field": "group", "op": "in", "values": ["ocio", "Transporte"]}, {"field": "account", "op": "not_in", "values": ["efectivo"]},
                                         {"field": "category", "op": "not_prefix", "values": ["ocio/cine"]}, {"field": "invited", "op": "not_contains", "values": ["ana"]}]}),
    ("sin categoría", {"title": "Sin cat", "kind": "table", "x": X("category"), "period": P("all"), "filters": [{"field": "category", "op": "empty"}]}),
    ("prefijo de comercio", {"title": "Prefijo", "kind": "table", "x": X("merchant"), "period": P("all"), "filters": [{"field": "merchant", "op": "prefix", "values": ["bar"]}]}),
    ("muchas series", {"title": "Series", "kind": "line", "x": X("date", "month"), "split": X("category"), "period": P("last_months", months=5)}),
    ("este año comparado sin cerrar", {"title": "Año", "kind": "line", "x": X("date", "month"), "period": P("this_year"), "compare": "previous_year"}),
    ("año pasado", {"title": "Año pasado", "kind": "bar", "x": X("date", "quarter"), "period": P("last_year")}),
]
DRILLS = [("mes por grupo", "comida"), ("evolución 12 meses con media", "2026-03"), ("por categoría top 5", "_rest"),
          ("con quién", "ana-ejemplo"), ("día de la semana", "3"), ("tabla por cuenta", "revolut"),
          ("por semana", "2026-W38"), ("barras apiladas por grupo", "2026-05")]
INVALID = [
    {"title": " ", "kind": "bar", "x": X("amount"), "period": P("last_months", months=0)},
    {"title": "x", "kind": "donut", "x": X("group"), "split": X("account"), "period": P("all"), "compare": "previous_period"},
    {"title": "x", "kind": "stacked_bar", "x": X("group"), "period": P("range", start="2026-05-01", end="2026-01-01"), "top": 99},
    {"title": "x", "kind": "hbar", "x": X("group"), "split": X("group"), "period": P("last_days", days=900),
     "filters": [{"field": "date", "op": "in", "values": ["x"]}, {"field": "merchant", "op": "gte", "values": [1]}, {"field": "account", "op": "in", "values": []}]},
    {"title": "x", "kind": "bar", "period": P("all")},
]
TODAYS = [date(2026, 10, 19), date(2026, 3, 31)]
NOW = datetime(2026, 10, 19, 20, 0, 0)


def run(spec: dict, today: date, drill: str | None = None) -> dict:
    try:
        data = compute(ChartSpec.model_validate({"id": "c1", **spec}), recs, months, today, NOW, drill=drill)
    except SpecError as e:
        return {"error": str(e)}
    out = data.model_dump(mode="json", exclude={"computed_at"})
    return out


cases = []
for today in TODAYS:
    for name, spec in CASES:
        cases.append({"name": name, "today": today.isoformat(), "spec": spec, "drill": None, "result": run(spec, today)})
    for name, key in DRILLS:
        spec = dict(CASES)[name]
        cases.append({"name": f"{name} / {key}", "today": today.isoformat(), "spec": {**spec, "drilldown": True}, "drill": key,
                      "result": run({**spec, "drilldown": True}, today, key)})
for i, spec in enumerate(INVALID):
    cases.append({"name": f"inválida {i}", "today": TODAYS[0].isoformat(), "spec": spec, "drill": None, "result": run(spec, TODAYS[0])})

(HERE / "money.json").write_text(json.dumps({"movements": movements, "debts": debts}, ensure_ascii=False, indent=1) + "\n")
(HERE / "cases.json").write_text(json.dumps(cases, ensure_ascii=False, indent=1) + "\n")
print(f"{len(movements)} movements, {len(debts)} debts, {len(cases)} cases")
