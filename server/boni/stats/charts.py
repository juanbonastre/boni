"""Chart definitions and their computation. A chart is a `ChartSpec` (stored in SQLite, editable later by the AI);
the numbers come from `spending_items` and are computed on every request (cached reads underneath)."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime

from boni.contract import ChartData, ChartFilter, ChartPoint, ChartSeries, ChartSpec, Period
from boni.stats.spending import SpendingItem

MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
          "noviembre", "diciembre"]
MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

EATING_OUT = ChartFilter(include=["comida/", "bebida/cafe", "bebida/alcohol"], exclude=["comida/supermercado"])

DEFAULT_CHARTS = [
    ChartSpec(id="spending-by-category", title="Gasto del mes", kind="hbar", group_by="category_group",
              period=Period(kind="this_month"), drilldown=True),
    ChartSpec(id="monthly-spending", title="Gasto por mes", kind="bar", group_by="month",
              period=Period(kind="last_months", months=12)),
    ChartSpec(id="eating-out", title="Comida fuera", kind="line", group_by="month",
              period=Period(kind="last_months", months=12), filter=EATING_OUT),
]


def months_back(today: date, n: int) -> list[tuple[int, int]]:
    """The n months ending with today's month, oldest first."""
    y, m = today.year, today.month
    out = []
    for _ in range(max(n, 1)):
        out.append((y, m))
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    return out[::-1]


def months_for(spec: ChartSpec, today: date) -> list[tuple[int, int]]:
    if spec.period.kind == "this_month":
        return [(today.year, today.month)]
    return months_back(today, spec.period.months or 12)


def matches(category: str, f: ChartFilter) -> bool:
    if f.include and not any(category.startswith(p) for p in f.include):
        return False
    return not any(category.startswith(p) for p in f.exclude)


def nice(s: str) -> str:
    s = s.replace("-", " ").strip()
    return s[:1].upper() + s[1:]


def group_of(category: str) -> str:
    return (category or "otros").split("/", 1)[0] or "otros"


def sub_label(category: str) -> str:
    return nice(category.split("/", 1)[1] if "/" in category else category)


def r2(x: float) -> float:
    return round(x + 0.0, 2)


def compute(spec: ChartSpec, items: list[SpendingItem], months_with_data: set[tuple[int, int]], today: date,
            now: datetime, drill: str | None = None, stale: bool = False) -> ChartData:
    months = months_for(spec, today)
    month_set = set(months)
    sel = [i for i in items if (i.date.year, i.date.month) in month_set and matches(i.category, spec.filter)]
    if drill is not None:
        sel = [i for i in sel if group_of(i.category) == drill]

    if spec.group_by == "month":
        sums: dict[tuple[int, int], float] = defaultdict(float)
        for i in sel:
            sums[(i.date.year, i.date.month)] += i.value
        points = [
            ChartPoint(key=f"{y:04d}-{m:02d}", label=MONTHS_SHORT[m - 1], value=r2(sums[(y, m)]),
                       partial=(y, m) == (today.year, today.month), no_data=(y, m) not in months_with_data)
            for y, m in months
        ]
        complete = [p.value for p in points if not p.partial and not p.no_data]
        average = r2(sum(complete) / len(complete)) if complete else None
        first, last = months[0], months[-1]
        subtitle = f"{MONTHS_SHORT[first[1] - 1]} {first[0]} - {MONTHS_SHORT[last[1] - 1]} {last[0]}"
    else:
        by_group = spec.group_by == "category_group" and drill is None
        sums2: dict[str, float] = defaultdict(float)
        for i in sel:
            sums2[group_of(i.category) if by_group else i.category] += i.value
        ranked = sorted(((k, v) for k, v in sums2.items() if abs(v) >= 0.005), key=lambda kv: -kv[1])
        points = [ChartPoint(key=k, label=nice(k) if by_group else sub_label(k), value=r2(v)) for k, v in ranked]
        average = None
        y, m = months[-1]
        subtitle = f"{MONTHS[m - 1]} {y}" + (" - hasta hoy" if (y, m) == (today.year, today.month) else "")
        if drill is not None:
            subtitle = f"{nice(drill)} - {subtitle}"

    return ChartData(
        chart_id=spec.id,
        title=spec.title,
        subtitle=subtitle,
        kind="hbar" if drill is not None and spec.kind == "hbar" else spec.kind,
        series=[ChartSeries(name=spec.title, points=points)],
        total=r2(sum(i.value for i in sel)),
        average=average,
        drilldown=spec.drilldown and drill is None,
        drill=drill,
        computed_at=now,
        stale=stale,
    )
