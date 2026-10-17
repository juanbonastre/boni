"""'Apuntar gasto': the form the clients render, its validation, and the conversion to a movement draft."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

from boni.contract import (
    AmountField,
    ChoiceField,
    Condition,
    DateField,
    FormComponent,
    MultiChoiceField,
    Option,
    Screen,
    SubmitAction,
    TextField,
    ToggleField,
)
from boni.expenses.note import MovementDraft, suggested_share

ACTION = "expenses.capture"
SCREEN_ID = "capture-expense"
ACCOUNTS = [Option(value="efectivo", label="Efectivo"), Option(value="revolut", label="Revolut"),
            Option(value="ing", label="ING")]
KINDS = [Option(value="gasto", label="Gasto"), Option(value="ingreso", label="Ingreso")]
MAX_AMOUNT = Decimal("100000")


def screen(last_account: str | None = None) -> Screen:
    shared = Condition(field="shared", equals=True)
    form = FormComponent(
        id="expense",
        fields=[
            ChoiceField(id="kind", label="Tipo", options=KINDS, default="gasto", required=True),
            AmountField(id="amount", label="Importe", required=True, max=float(MAX_AMOUNT)),
            ChoiceField(id="account", label="Cuenta", options=ACCOUNTS, default=last_account or "efectivo",
                        required=True),
            ChoiceField(id="category", label="Categoria", source="categories", searchable=True, style="dropdown",
                        required=True),
            TextField(id="concept", label="Concepto", placeholder="Que fue", max_length=200),
            TextField(id="merchant", label="Comercio", max_length=120),
            MultiChoiceField(id="people", label="Con quien", source="people", searchable=True),
            ToggleField(id="shared", label="Pague yo por otros"),
            MultiChoiceField(id="invited", label="A quien he invitado", source="people", searchable=True,
                             help="No te devuelven nada", visible_when=shared),
            AmountField(id="my_share", label="Mi parte", visible_when=shared,
                        help="Vacio: se calcula (importe x (1 + invitados) / (personas + 1))"),
            DateField(id="date", label="Fecha", default="today", required=True),
        ],
        submit=SubmitAction(action=ACTION, label="Guardar"),
    )
    return Screen(id=SCREEN_ID, title="Apuntar gasto", components=[form])


def _decimal(v: Any) -> Decimal | None:
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    try:
        return Decimal(str(v).strip().replace(",", "."))
    except InvalidOperation:
        return None


def _str_list(v: Any) -> list[str]:
    if v is None:
        return []
    if isinstance(v, str):
        return [v] if v else []
    return [str(x) for x in v if str(x)]


def validate(values: dict[str, Any], *, categories: list[str] | None, people: set[str] | None,
             created_at: datetime | None, today: date) -> tuple[MovementDraft | None, dict[str, str]]:
    """Returns (draft, {}) or (None, field errors). `categories`/`people` None = source unreachable: skip those checks
    (the outbox validates again before writing)."""
    errors: dict[str, str] = {}
    kind = str(values.get("kind") or "gasto")
    if kind not in ("gasto", "ingreso"):
        errors["kind"] = "Tipo no valido"
    amount = _decimal(values.get("amount"))
    if amount is None or amount <= 0:
        errors["amount"] = "Pon un importe mayor que 0"
    elif amount > MAX_AMOUNT:
        errors["amount"] = "Importe demasiado alto"
    account = str(values.get("account") or "")
    if account not in {o.value for o in ACCOUNTS}:
        errors["account"] = "Elige una cuenta"
    category = str(values.get("category") or "").strip()
    if not category:
        errors["category"] = "Elige una categoria"
    elif categories is not None and category not in categories:
        errors["category"] = "Esa categoria no esta en la lista"
    concept = str(values.get("concept") or "").strip()
    merchant = str(values.get("merchant") or "").strip()
    if len(concept) > 200:
        errors["concept"] = "Demasiado largo"
    if len(merchant) > 120:
        errors["merchant"] = "Demasiado largo"
    who = list(dict.fromkeys(_str_list(values.get("people"))))
    shared = bool(values.get("shared"))
    invited = list(dict.fromkeys(_str_list(values.get("invited")))) if shared else []
    for p in invited:  # like the app: invited people are also people
        if p not in who:
            who.append(p)
    if people is not None:
        unknown = [p for p in who if p not in people]
        if unknown:
            errors["people"] = "No encuentro: " + ", ".join(unknown)
    my_share = _decimal(values.get("my_share")) if shared else None
    if shared:
        if not who:
            errors["people"] = "Si pagaste por otros, di con quien"
        elif my_share is None and amount is not None and amount > 0:
            my_share = suggested_share(amount, len(who), len(invited))
        if my_share is not None and amount is not None and not (Decimal(0) <= my_share <= amount):
            errors["my_share"] = "Tu parte tiene que estar entre 0 y el importe"
    raw_date = str(values.get("date") or "today")
    try:
        d = today if raw_date == "today" else date.fromisoformat(raw_date)
    except ValueError:
        d = None
        errors["date"] = "Fecha no valida"
    if d is not None and d > today + timedelta(days=1):
        errors["date"] = "La fecha es futura"
    if errors:
        return None, errors
    assert amount is not None and d is not None
    t: time | None = None
    if created_at is not None and created_at.date() == d:
        t = time(created_at.hour, created_at.minute)
    return MovementDraft(kind=kind, amount=amount, account=account, category=category, concept=concept,
                         merchant=merchant, date=d, time=t, people=who, invited=invited, my_share=my_share), {}
