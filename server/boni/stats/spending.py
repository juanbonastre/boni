"""The single definition of "spending" (gasto). Keep in sync with gastos-app `tools/finanzas.py` (`NOT_EXPENSE`,
`is_spending`) and the vault's `registros/finanzas/README.md` ("Reglas de calculo").

- Only spending categories count: not `ingreso/`, `inversion`, `transferencia/` (internal transfers, loan payments).
- An expense (negative amount) counts as Juan's share: `my_share` if set, else the whole amount.
- A positive movement of a spending category that `settles` a debt is a friend paying back their part: it was never
  Juan's spending (my_share already excludes it), so it counts 0.
- A positive movement that `settles` an expense (a shop refund) reduces spending.
- A positive movement of a spending category without `settles` is not classified yet: counts 0.
- A debt Juan decided not to collect (`perdonada`, `invitacion`, direction `me-deben`) becomes his spending, on the
  date and category of the original expense.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date

from boni.sources.finanzas import Debt, Movement

NOT_SPENDING = ("ingreso/", "inversion", "transferencia/")
FORGIVEN = ("perdonada", "invitacion")


def is_spending(category: str) -> bool:
    return not (category or "").startswith(NOT_SPENDING)


@dataclass(frozen=True)
class SpendingItem:
    date: date
    category: str
    value: float  # positive = spending, negative = refund


def movement_spending(m: Movement, debt_names: set[str]) -> float:
    if not is_spending(m.category):
        return 0.0
    if m.amount < 0:
        return m.my_share if m.my_share is not None else -m.amount
    if m.amount > 0 and m.settles and m.settles not in debt_names:
        return -m.amount
    return 0.0


def spending_items(movements: Iterable[Movement], debts: Iterable[Debt]) -> list[SpendingItem]:
    movements = list(movements)
    debts = list(debts)
    debt_names = {d.name for d in debts}
    by_name = {m.name: m for m in movements}
    out = [SpendingItem(m.date, m.category, v) for m in movements if (v := movement_spending(m, debt_names)) != 0.0]
    for d in debts:
        if d.status in FORGIVEN and d.direction == "me-deben":
            m = by_name.get(d.movement)
            if m is not None and is_spending(m.category):
                out.append(SpendingItem(m.date, m.category, d.amount))
    return out
