from datetime import date, time
from decimal import Decimal

from boni.expenses.note import MovementDraft, base_name, render, slug, suggested_share


def draft(**kw) -> MovementDraft:
    base = dict(kind="gasto", amount=Decimal("94.1"), account="revolut", category="comida/restaurante",
                concept='Cena "Kumo"', merchant="Kumo", date=date(2026, 9, 18), time=time(22, 58),
                people=["lucia-ferri", "tomas"], invited=["lucia-ferri"], my_share=Decimal("62.733"))
    base.update(kw)
    return MovementDraft(**base)


def test_render_matches_gastos_app_format():
    # Same lines, order and quoting as MovementNote.render in gastos-app (gastos/Movement.kt).
    assert render(draft(), date(2026, 10, 12)) == "\n".join([
        "---",
        "type: movement",
        "date: 2026-09-18",
        'time: "22:58"',
        "amount: -94.10",
        "currency: EUR",
        "my_share: 62.73",
        "account: revolut",
        "category: comida/restaurante",
        'merchant: "Kumo"',
        'concept: "Cena \\"Kumo\\""',
        'people: ["[[lucia-ferri]]", "[[tomas]]"]',
        'invited: ["[[lucia-ferri]]"]',
        "related: []",
        "status: pendiente",
        "source: manual",
        "bank_ref: ",
        "created: 2026-10-12",
        "---",
        "",
        '# Cena "Kumo" 94,10 EUR',
        "",
    ])


def test_render_income_without_optional_fields():
    text = render(draft(kind="ingreso", amount=Decimal("20"), merchant="", concept="", time=None, people=[],
                        invited=[], my_share=None), date(2026, 10, 12))
    assert "amount: 20.00" in text
    assert "\nmerchant: \n" in text and "\nmy_share: \n" in text and 'concept: ""' in text
    assert "time:" not in text
    assert "# Movimiento 20,00 EUR" in text


def test_base_name_and_slug():
    assert slug("Cena con Pe\u00f1a y Ru\u00edz!") == "cena-con-pena-y-ruiz"
    assert slug("Cafe con leche en la cafeteria", 10) == "cafe-con-l"
    assert base_name(draft()) == "2026-09-18-2258-cena-kumo"
    assert base_name(draft(time=None, concept="", merchant="")) == "2026-09-18-movimiento"


def test_suggested_share():
    # 3 people with Juan, 1 invited: Juan pays his part and the invited one's: 90 * 2 / 4
    assert suggested_share(Decimal("90"), people=3, invited=1) == Decimal("45.00")
