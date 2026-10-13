"""The charts a new Boni database starts with. A chart is a `ChartSpec` (stored in SQLite, edited from the clients'
chart builder and later by the AI); `boni.stats.engine` computes it on every request (cached reads underneath)."""

from __future__ import annotations

from boni.contract import ChartFilterRule, ChartSpec, Dimension, Period

EATING_OUT = [
    ChartFilterRule(field="category", op="prefix", values=["comida/", "bebida/cafe", "bebida/alcohol"]),
    ChartFilterRule(field="category", op="not_prefix", values=["comida/supermercado"]),
]

DEFAULT_CHARTS = [
    ChartSpec(id="spending-by-category", title="Gasto del mes", kind="hbar", x=Dimension(field="group"),
              period=Period(kind="this_month"), drilldown=True),
    ChartSpec(id="monthly-spending", title="Gasto por mes", kind="bar", x=Dimension(field="date", granularity="month"),
              period=Period(kind="last_months", months=12), drilldown=True),
    ChartSpec(id="eating-out", title="Comida fuera", kind="line", x=Dimension(field="date", granularity="month"),
              period=Period(kind="last_months", months=12), filters=EATING_OUT),
]
