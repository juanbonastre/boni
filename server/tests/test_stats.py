from datetime import date

import pytest

from boni.sources.finanzas import Debt, Movement, parse_categories, parse_movement
from boni.stats.charts import DEFAULT_CHARTS, compute, months_back
from boni.stats.spending import is_spending, movement_spending, spending_items
from tests.conftest import CATEGORIES, NOW

D = date(2026, 9, 18)


def mv(amount, category="comida/restaurante", my_share=None, settles="", name="m", d=D):
    return Movement(name=name, date=d, amount=amount, category=category, my_share=my_share, settles=settles)


def test_is_spending_matches_finanzas_py():
    assert is_spending("comida/restaurante") and is_spending("otros/desconocido") and is_spending("")
    for c in ("ingreso/nomina", "inversion", "transferencia/interna", "transferencia/prestamo"):
        assert not is_spending(c)


def test_movement_spending_rules():
    debts = {"2026-09-18-tomas-kumo"}
    assert movement_spending(mv(-94.10, my_share=14.41), debts) == 14.41
    assert movement_spending(mv(-10), debts) == 10
    # A friend paying back their part: never Juan's spending
    assert movement_spending(mv(16.67, settles="2026-09-18-tomas-kumo"), debts) == 0
    # A shop refund settles the expense itself: reduces spending
    assert movement_spending(mv(60, settles="2026-10-10-1200-zapatos"), debts) == -60
    # Unclassified positive in a spending category, transfers, income
    assert movement_spending(mv(5), debts) == 0
    assert movement_spending(mv(-500, "transferencia/interna"), debts) == 0
    assert movement_spending(mv(2100, "ingreso/nomina"), debts) == 0


def test_forgiven_debt_counts_as_spending_on_the_expense_date():
    cena = mv(-30, my_share=15, name="cena", d=date(2026, 9, 20))
    debts = [Debt("d1", "cena", 15, "me-deben", "perdonada"), Debt("d2", "cena", 7, "me-deben", "pagada"),
             Debt("d3", "cena", 3, "debo", "perdonada")]
    items = spending_items([cena], debts)
    assert sorted(i.value for i in items) == [15, 15]
    assert all(i.date == date(2026, 9, 20) and i.category == "comida/restaurante" for i in items)


def test_parse_movement_and_categories():
    m = parse_movement({"path": "a/b/2026-09-18-2258-kumo.md", "date": "2026-09-18", "amount": "-94,10",
                        "my_share": 14.41, "category": "comida/restaurante", "settles": None,
                        "people": ["[[tomas|Tomas]]"]})
    assert m is not None and m.amount == -94.10 and m.people == ("tomas",) and m.name == "2026-09-18-2258-kumo"
    assert parse_movement({"path": "x.md", "date": "", "amount": -1}) is None
    cats = parse_categories(CATEGORIES)
    assert cats[0] == "comida/restaurante" and "transferencia/prestamo" in cats and len(cats) == 14
    assert parse_categories("---\ncategories: [a/b, \"c\"]\n---\n") == ["a/b", "c"]


def test_months_back():
    assert months_back(date(2026, 2, 5), 3) == [(2025, 12), (2026, 1), (2026, 2)]


@pytest.fixture
def items_and_months():
    from tests.conftest import NOTES
    from tests.fake_vault_mcp import frontmatter
    movements, debts = [], []
    for path, text in NOTES:
        fm = frontmatter(text) | {"path": path}
        if fm["type"] == "movement":
            from boni.sources.finanzas import parse_movement as pm
            movements.append(pm(fm))
        else:
            from boni.sources.finanzas import parse_debt
            debts.append(parse_debt(fm))
    return spending_items(movements, debts), {(m.date.year, m.date.month) for m in movements}


def spec(chart_id):
    return next(c for c in DEFAULT_CHARTS if c.id == chart_id)


def test_spending_by_category_this_month(items_and_months):
    items, months = items_and_months
    data = compute(spec("spending-by-category"), items, months, NOW.date(), NOW)
    pts = data.series[0].points
    assert [(p.key, p.label, p.value) for p in pts] == [
        ("comida", "Comida", 69.70), ("suscripciones", "Suscripciones", 10.99), ("bebida", "Bebida", 1.60)]
    assert data.total == 82.29 and data.drilldown and data.subtitle == "octubre 2026 - hasta hoy"


def test_drilldown_into_a_group(items_and_months):
    items, months = items_and_months
    data = compute(spec("spending-by-category"), items, months, NOW.date(), NOW, drill="comida")
    assert [(p.key, p.label, p.value) for p in data.series[0].points] == [
        ("comida/supermercado", "Supermercado", 45.20), ("comida/restaurante", "Restaurante", 24.50)]
    assert data.drill == "comida" and not data.drilldown and data.subtitle.startswith("Comida - ")


def test_monthly_spending_marks_gaps_and_current_month(items_and_months):
    items, months = items_and_months
    data = compute(spec("monthly-spending"), items, months, NOW.date(), NOW)
    pts = {p.key: p for p in data.series[0].points}
    assert len(pts) == 12 and list(pts)[0] == "2025-11" and list(pts)[-1] == "2026-10"
    assert pts["2026-09"].value == 136.41  # 14.41 + 15 + 15 (forgiven) + 80 + 12
    assert pts["2026-08"].value == 90 and pts["2026-07"].value == 20  # the house (inversion) does not count
    assert pts["2026-10"].partial and pts["2026-10"].value == 82.29
    assert pts["2026-03"].no_data and pts["2026-03"].value == 0
    assert data.average == 82.14  # (20 + 90 + 136.41) / 3: complete months with data only
    assert pts["2026-10"].label == "oct"


def test_eating_out(items_and_months):
    items, months = items_and_months
    data = compute(spec("eating-out"), items, months, NOW.date(), NOW)
    pts = {p.key: p.value for p in data.series[0].points}
    assert pts["2026-10"] == 26.10  # ramen + cafe (no supermarket)
    assert pts["2026-09"] == 56.41  # kumo share + cena share + forgiven debt + beers
    assert pts["2026-08"] == 40 and pts["2026-07"] == 0
