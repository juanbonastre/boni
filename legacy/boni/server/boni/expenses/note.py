"""Movement note text. Port of `MovementNote` (gastos-app, gastos/Movement.kt): same name, front matter and heading,
so notes written by Boni and by the Android app are indistinguishable for the reconciliation (finanzas.py)."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, time
from decimal import ROUND_HALF_UP, Decimal


def ascii_text(s: str) -> str:
    """'Pena Ruiz' with accents removed (vault rule: never accents or n-tilde in generated names)."""
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def slug(s: str, max_len: int = 60) -> str:
    """'Cena con Pena!' -> 'cena-con-pena' (Slug.of in gastos-app)."""
    return re.sub(r"[^a-z0-9]+", "-", ascii_text(s).lower()).strip("-")[:max_len].strip("-")


def yaml_quote(s: str) -> str:
    """Double-quoted YAML scalar (Frontmatter.quote in gastos-app)."""
    out = ['"']
    for c in s:
        if c == '"':
            out.append('\\"')
        elif c == "\\":
            out.append("\\\\")
        elif c == "\n":
            out.append("\\n")
        elif c == "\t":
            out.append("\\t")
        elif c < " ":
            out.append(f"\\u{ord(c):04x}")
        else:
            out.append(c)
    out.append('"')
    return "".join(out)


def flow_list(items: list[str]) -> str:
    return "[" + ", ".join(yaml_quote(x) for x in items) + "]"


def money(x: Decimal) -> str:
    return str(x.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def euros(x: Decimal) -> str:
    return money(abs(x)).replace(".", ",")


@dataclass(frozen=True)
class MovementDraft:
    kind: str  # "gasto" | "ingreso"
    amount: Decimal  # positive, as typed
    account: str
    category: str
    concept: str
    merchant: str
    date: date
    time: time | None = None
    people: list[str] = field(default_factory=list)  # person note slugs
    invited: list[str] = field(default_factory=list)  # subset of people
    related: list[str] = field(default_factory=list)
    my_share: Decimal | None = None

    @property
    def signed_amount(self) -> Decimal:
        return -abs(self.amount) if self.kind == "gasto" else abs(self.amount)


def base_name(d: MovementDraft) -> str:
    t = f"-{d.time.hour:02d}{d.time.minute:02d}" if d.time else ""
    s = slug(d.concept.strip() or d.merchant.strip(), 40) or "movimiento"
    return f"{d.date.isoformat()}{t}-{s}"


def render(d: MovementDraft, created: date) -> str:
    lines = ["---", "type: movement", f"date: {d.date.isoformat()}"]
    if d.time:
        lines.append(f'time: "{d.time.hour:02d}:{d.time.minute:02d}"')
    merchant = d.merchant.strip()
    title = d.concept.strip() or merchant or "Movimiento"
    lines += [
        f"amount: {money(d.signed_amount)}",
        "currency: EUR",
        "my_share: " + (money(abs(d.my_share)) if d.my_share is not None else ""),
        f"account: {d.account}",
        f"category: {d.category}",
        "merchant: " + (yaml_quote(merchant) if merchant else ""),
        "concept: " + yaml_quote(d.concept.strip()),
        "people: " + flow_list([f"[[{p}]]" for p in d.people]),
        "invited: " + flow_list([f"[[{p}]]" for p in d.invited]),
        "related: " + flow_list([f"[[{r}]]" for r in d.related]),
        "status: pendiente",
        "source: manual",
        "bank_ref: ",
        f"created: {created.isoformat()}",
        "---",
        "",
        f"# {title} {euros(d.amount)} EUR",
        "",
    ]
    return "\n".join(lines)


def suggested_share(amount: Decimal, people: int, invited: int) -> Decimal:
    """Juan's part when he paid for others: amount * (1 + invited) / (people + 1) (gastos-app ExpenseViewModel)."""
    return (abs(amount) * (1 + invited) / (people + 1)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
