from datetime import date

from boni.sources.finanzas import Debt, Movement, parse_categories, parse_movement
from boni.stats.spending import is_spending, movement_spending, spending_items
from tests.conftest import CATEGORIES

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
