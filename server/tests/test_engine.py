"""The chart engine on the test vault (tests/conftest.py NOTES; today is 2026-10-12) and on hand-made movements."""

from datetime import date

import pytest

from boni.contract import ChartFilterRule, ChartSpec, Dimension, Period
from boni.sources.finanzas import Movement, parse_debt, parse_movement
from boni.stats import engine
from boni.stats.charts import DEFAULT_CHARTS
from boni.stats.engine import SpecError
from tests.conftest import NOTES, NOW
from tests.fake_vault_mcp import frontmatter

TODAY = NOW.date()


@pytest.fixture(scope="module")
def data():
    movements, debts = [], []
    for path, text in NOTES:
        fm = frontmatter(text) | {"path": path}
        if fm["type"] == "movement":
            movements.append(parse_movement(fm))
        else:
            debts.append(parse_debt(fm))
    return engine.records(movements, debts), {(m.date.year, m.date.month) for m in movements}


def run(data, spec: ChartSpec, drill=None):
    recs, months = data
    return engine.compute(spec, recs, months, TODAY, NOW, drill=drill)


def default(chart_id):
    return next(c for c in DEFAULT_CHARTS if c.id == chart_id)


def pts(d, i=0):
    return [(p.key, p.value) for p in d.series[i].points]


def spec(**kw):
    kw.setdefault("title", "T")
    kw.setdefault("period", Period(kind="this_month"))
    return ChartSpec(**kw)


GROUP = Dimension(field="group")
CATEGORY = Dimension(field="category")
MONTH = Dimension(field="date", granularity="month")


# ---------------------------------------------------------------- the default charts (same numbers as Boni 0.1)
def test_spending_by_category_this_month(data):
    d = run(data, default("spending-by-category"))
    assert [(p.key, p.label, p.value) for p in d.series[0].points] == [
        ("comida", "Comida", 69.70), ("suscripciones", "Suscripciones", 10.99), ("bebida", "Bebida", 1.60)]
    # shoes bought and refunded add up to 0: no "Compras" bar
    assert d.total == 82.29 and d.drilldown and d.subtitle == "octubre 2026 - hasta hoy"


def test_drilldown_into_a_group(data):
    d = run(data, default("spending-by-category"), drill="comida")
    assert [(p.key, p.label, p.value) for p in d.series[0].points] == [
        ("comida/supermercado", "Supermercado", 45.20), ("comida/restaurante", "Restaurante", 24.50)]
    assert d.drill == "comida" and not d.drilldown and d.subtitle == "Comida - octubre 2026 - hasta hoy"


def test_monthly_spending_marks_gaps_and_current_month(data):
    d = run(data, default("monthly-spending"))
    p = {x.key: x for x in d.series[0].points}
    assert len(p) == 12 and list(p)[0] == "2025-11" and list(p)[-1] == "2026-10"
    assert p["2026-09"].value == 136.41  # 14.41 + 15 + 15 (forgiven) + 80 + 12
    assert p["2026-08"].value == 90 and p["2026-07"].value == 20  # the house (inversion) does not count
    assert p["2026-10"].partial and p["2026-10"].value == 82.29 and p["2026-10"].label == "oct 26"
    assert p["2026-03"].no_data and p["2026-03"].value == 0
    assert d.average == 82.14  # (20 + 90 + 136.41) / 3: complete months with data only
    assert d.x_label == "Mes" and d.subtitle == "nov 2025 - oct 2026 - hasta hoy"


def test_drill_into_a_month_shows_its_groups(data):
    d = run(data, default("monthly-spending"), drill="2026-09")
    assert d.kind == "hbar" and pts(d) == [("comida", 124.41), ("bebida", 12)]
    assert d.subtitle == "septiembre 2026" and d.total == 136.41


def test_eating_out(data):
    p = dict(pts(run(data, default("eating-out"))))
    assert p["2026-10"] == 26.10  # ramen + cafe (no supermarket)
    assert p["2026-09"] == 56.41  # kumo share + cena share + forgiven debt + beers
    assert p["2026-08"] == 40 and p["2026-07"] == 0


def test_legacy_spec_is_upgraded():
    s = ChartSpec.model_validate({"id": "eating-out", "title": "Comida fuera", "kind": "line", "group_by": "month",
                                  "period": {"kind": "last_months", "months": 12},
                                  "filter": {"include": ["comida/"], "exclude": ["comida/supermercado"]}})
    assert s.x == MONTH and [(f.op, f.values) for f in s.filters] == [
        ("prefix", ["comida/"]), ("not_prefix", ["comida/supermercado"])]
    assert s.filter.include == [] and s.group_by == "month"
    # round trip keeps it stable (stored specs are re-read on every request)
    assert ChartSpec.model_validate_json(s.model_dump_json()) == s


# ---------------------------------------------------------------- builder options
def test_compare_with_previous_period(data):
    d = run(data, spec(kind="number", period=Period(kind="range", start="2026-09-01", end="2026-09-30"),
                       compare="previous_period"))
    assert d.total == 136.41 and d.previous_total == 90 and d.delta_pct == 51.6
    assert d.subtitle == "septiembre 2026 - frente a agosto 2026"
    assert [s.role for s in d.series] == ["main", "compare"]


def test_compare_current_month_uses_the_same_stretch(data):
    d = run(data, spec(kind="number", compare="previous_period"))
    # October 1-12 against September 1-12 (nothing yet in September by the 12th)
    assert d.total == 82.29 and d.previous_total == 0 and d.delta_pct is None


def test_compare_previous_year_aligns_months(data):
    d = run(data, spec(kind="bar", x=MONTH, period=Period(kind="last_months", months=3), compare="previous_year"))
    assert [s.key for s in d.series] == ["main", "previous"]
    assert [p.key for p in d.series[1].points] == ["2026-08", "2026-09", "2026-10"]
    assert all(p.value == 0 for p in d.series[1].points) and d.series[1].name == "ago 2025 - oct 2025"


def test_split_into_series(data):
    d = run(data, spec(kind="stacked_bar", x=MONTH, split=GROUP, period=Period(kind="last_months", months=3)))
    assert [s.name for s in d.series] == ["Comida", "Transporte", "Bebida", "Suscripciones"]
    assert pts(d, 0) == [("2026-08", 40), ("2026-09", 124.41), ("2026-10", 69.70)]
    assert pts(d, 2) == [("2026-08", 0), ("2026-09", 12), ("2026-10", 1.60)]
    assert all(s.role == "split" for s in d.series) and d.average is None


def test_top_folds_the_rest(data):
    d = run(data, spec(kind="hbar", x=CATEGORY, period=Period(kind="this_year"), top=3))
    assert [(p.label, p.value) for p in d.series[0].points] == [
        ("Supermercado (comida)", 125.20), ("Restaurante (comida)", 108.91), ("Gasolina (transporte)", 50),
        ("Resto (4)", 44.59)]
    assert d.subtitle == "2026 - hasta hoy"


def test_donut_keeps_six_slices(data):
    d = run(data, spec(kind="donut", x=CATEGORY, period=Period(kind="all")))
    assert len(d.series[0].points) == 6 and d.series[0].points[-1].key == engine.REST


def test_count_average_and_income(data):
    count = run(data, spec(kind="hbar", x=GROUP, measure="count"))
    assert dict(pts(count)) == {"comida": 2, "suscripciones": 1, "bebida": 1, "compras": 1} and count.unit == ""
    avg = run(data, spec(kind="number", measure="average"))
    assert avg.total == round(82.29 / 5, 2)
    assert run(data, spec(kind="number", measure="income")).total == 2100


def test_weekday_buckets_and_drill(data):
    s = spec(kind="bar", x=Dimension(field="date", granularity="weekday"), period=Period(kind="last_months", months=3),
             drilldown=True)
    d = run(data, s)
    assert [p.label for p in d.series[0].points] == ["lun", "mar", "mie", "jue", "vie", "sab", "dom"]
    assert sum(p.value for p in d.series[0].points) == d.total == 82.29 + 136.41 + 90
    sat = run(data, s, drill="6")  # Saturdays: 2026-10-03 mercadona, 2026-08-... none, 2026-09-...
    assert sat.kind == "hbar" and sat.subtitle.startswith("Sab - ")


def test_period_all_skips_the_empty_start(data):
    d = run(data, spec(kind="bar", x=MONTH, period=Period(kind="all")))
    assert d.series[0].points[0].key == "2026-07"


def test_week_and_day_buckets():
    weeks = engine.time_buckets(date(2026, 9, 28), date(2026, 10, 12), "week")
    assert [b.key for b in weeks] == ["2026-W40", "2026-W41", "2026-W42"] and weeks[0].label == "28 sep"
    days = engine.time_buckets(date(2026, 10, 10), date(2026, 10, 12), "day")
    assert [b.label for b in days] == ["10/10", "11/10", "12/10"]


def test_filters_on_people_merchant_amount():
    def m(name, amount, **kw):
        return Movement(name=name, date=date(2026, 10, 2), amount=amount, category="comida/restaurante", **kw)
    recs = engine.records([
        m("a", -30, people=("lucia-ferri",), merchant="Bar Pepe", account="revolut"),
        m("b", -12, people=("tomas", "lucia-ferri"), merchant="Café Central"),
        m("c", -100, merchant="Asador"),
    ], [])

    def total(*rules, x=None):
        s = spec(kind="number" if x is None else "hbar", x=x, filters=list(rules))
        return engine.compute(s, recs, {(2026, 10)}, TODAY, NOW)

    assert total(ChartFilterRule(field="people", op="in", values=["lucia-ferri"])).total == 42
    assert total(ChartFilterRule(field="people", op="empty")).total == 100
    assert total(ChartFilterRule(field="merchant", op="contains", values=["cafe"])).total == 12  # accents ignored
    assert total(ChartFilterRule(field="amount", op="gte", values=[20])).total == 130
    assert total(ChartFilterRule(field="account", op="not_in", values=["revolut"])).total == 112
    by_person = total(x=Dimension(field="people"))
    assert [(p.label, p.value) for p in by_person.series[0].points] == [
        ("(nadie)", 100), ("Lucia Ferri", 42), ("Tomas", 12)]
    assert by_person.total == 142  # the total counts each movement once


@pytest.mark.parametrize("kw, message", [
    ({"title": " ", "kind": "number"}, "Ponle un titulo"),
    ({"kind": "bar"}, "Elige que va en el eje"),
    ({"kind": "stacked_bar", "x": MONTH}, "necesitan un campo para separar"),
    ({"kind": "donut", "x": GROUP, "split": CATEGORY}, "no admite separar"),
    ({"kind": "bar", "x": MONTH, "split": GROUP, "compare": "previous_year"}, "no se puede combinar"),
    ({"kind": "bar", "x": Dimension(field="amount")}, "No se puede agrupar por importe"),
    ({"kind": "number", "filters": [ChartFilterRule(field="people", op="in")]}, "falta el valor"),
    ({"kind": "number", "period": Period(kind="last_months", months=0)}, "Ultimos meses"),
])
def test_validation_messages(kw, message):
    with pytest.raises(SpecError, match=message):
        engine.validate(spec(**kw))


def test_months_needed_includes_the_compared_period():
    s = spec(kind="number", compare="previous_year")
    assert engine.months_needed(s, TODAY) == [(2025, 10), (2025, 11), (2025, 12), (2026, 1), (2026, 2), (2026, 3),
                                              (2026, 4), (2026, 5), (2026, 6), (2026, 7), (2026, 8), (2026, 9),
                                              (2026, 10)]
