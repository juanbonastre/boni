"""Generic chart engine: a ChartSpec + money records -> ChartData.

Records are one per money movement (plus one per forgiven debt), carrying every field the builder can group or filter
by. The single definition of "spending" lives in boni.stats.spending; this module only slices it.
"""

from __future__ import annotations

import calendar
from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from boni.contract import (
    CatalogItem,
    ChartCatalog,
    ChartData,
    ChartFilterRule,
    ChartPoint,
    ChartSeries,
    ChartSpec,
    Dimension,
    FieldInfo,
)
from boni.expenses.note import ascii_text
from boni.sources.finanzas import Debt, Movement, title_from_slug
from boni.stats.spending import forgiven, is_spending, movement_spending

MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
          "noviembre", "diciembre"]
MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
WEEKDAYS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"]
ALL_START = date(2024, 1, 1)  # "all" period: earliest month looked at (data starts Sep 2024)
MAX_SPLIT = 6
REST = "_rest"
OTHER = "_other"

TIME_FIELDS = {"date"}
MULTI_FIELDS = {"people", "invited", "related"}
NUMBER_FIELDS = {"amount"}
SPLIT_KINDS = {"bar", "stacked_bar", "line", "area", "table"}


class SpecError(ValueError):
    """The chart definition is not valid; the message is for Juan (Spanish, no accents)."""


# ---------------------------------------------------------------- records
@dataclass(frozen=True)
class Rec:
    date: date
    spending: float  # Juan's spending (negative = refund); 0 if not spending
    income: float  # income (ingreso/...), positive
    counted: bool  # an expense of Juan's (for count / average)
    amount: float  # the movement's signed amount, as in the bank
    category: str
    account: str
    merchant: str
    concept: str
    status: str
    source: str
    people: tuple[str, ...]
    invited: tuple[str, ...]
    related: tuple[str, ...]

    @property
    def group(self) -> str:
        return (self.category or "otros").split("/", 1)[0] or "otros"

    def values(self, field: str) -> list[str]:
        if field in MULTI_FIELDS:
            vals = getattr(self, field)
            return list(vals) if vals else [""]
        if field == "group":
            return [self.group]
        if field == "date":
            return [self.date.isoformat()]
        if field == "amount":
            return [str(abs(self.amount))]
        return [getattr(self, field) or ""]


def _rec(m: Movement, spending: float, income: float, counted: bool) -> Rec:
    return Rec(m.date, spending, income, counted, m.amount, m.category, m.account, m.merchant, m.concept, m.status,
               m.source, m.people, m.invited, m.related)


def records(movements: Iterable[Movement], debts: Iterable[Debt]) -> list[Rec]:
    movements, debts = list(movements), list(debts)
    debt_names = {d.name for d in debts}
    out = []
    for m in movements:
        sp = movement_spending(m, debt_names)
        inc = m.amount if m.category.startswith("ingreso/") and m.amount > 0 else 0.0
        out.append(_rec(m, sp, inc, counted=m.amount < 0 and is_spending(m.category) and sp > 0))
    # a debt Juan decided not to collect becomes his spending, on the expense's date and fields
    out += [_rec(m, amount, 0.0, counted=False) for m, amount in forgiven(movements, debts)]
    return out


# ---------------------------------------------------------------- dates
def last_day(y: int, m: int) -> date:
    return date(y, m, calendar.monthrange(y, m)[1])


def shift_months(d: date, n: int) -> date:
    y, m = divmod(d.year * 12 + d.month - 1 + n, 12)
    return date(y, m + 1, min(d.day, calendar.monthrange(y, m + 1)[1]))


def months_between(start: date, end: date) -> list[tuple[int, int]]:
    out, y, m = [], start.year, start.month
    while (y, m) <= (end.year, end.month):
        out.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def _month_aligned(start: date, end: date) -> bool:
    return start.day == 1 and end == last_day(end.year, end.month)


def period_range(spec: ChartSpec, today: date) -> tuple[date, date]:
    p = spec.period
    first = today.replace(day=1)
    match p.kind:
        case "this_month":
            return first, last_day(today.year, today.month)
        case "last_month":
            s = shift_months(first, -1)
            return s, last_day(s.year, s.month)
        case "last_months":
            return shift_months(first, -((p.months or 12) - 1)), last_day(today.year, today.month)
        case "this_year":
            return date(today.year, 1, 1), date(today.year, 12, 31)
        case "last_year":
            return date(today.year - 1, 1, 1), date(today.year - 1, 12, 31)
        case "last_days":
            return today - timedelta(days=(p.days or 30) - 1), today
        case "range":
            return date.fromisoformat(str(p.start)), date.fromisoformat(str(p.end))
        case _:  # all
            return ALL_START, last_day(today.year, today.month)


def compare_range(spec: ChartSpec, start: date, end: date, today: date) -> tuple[date, date] | None:
    if spec.compare == "none":
        return None
    if spec.compare == "previous_year":
        ps, pe = shift_months(start, -12), shift_months(end, -12)
        cut = shift_months(today, -12)
    elif _month_aligned(start, end):
        n = (end.year - start.year) * 12 + end.month - start.month + 1
        ps, pe = shift_months(start, -n), last_day(*divmod_month(shift_months(end.replace(day=1), -n)))
        cut = shift_months(today, -n)
    else:
        days = (end - start).days + 1
        ps, pe = start - timedelta(days=days), end - timedelta(days=days)
        cut = today - timedelta(days=days)
    if start <= today <= end:  # the current period is not over: compare the same stretch ("so far")
        pe = min(pe, cut)
    return ps, pe


def divmod_month(d: date) -> tuple[int, int]:
    return d.year, d.month


def months_needed(spec: ChartSpec, today: date) -> list[tuple[int, int]]:
    start, end = period_range(spec, today)
    c = compare_range(spec, start, end, today)
    if c:
        start = min(start, c[0])
    return months_between(start, end)


def describe_range(start: date, end: date, today: date) -> str:
    if _month_aligned(start, end):
        if (start.year, start.month) == (end.year, end.month):
            text = f"{MONTHS[start.month - 1]} {start.year}"
        elif start.month == 1 and end.month == 12 and start.year == end.year:
            text = str(start.year)
        else:
            text = f"{MONTHS_SHORT[start.month - 1]} {start.year} - {MONTHS_SHORT[end.month - 1]} {end.year}"
    else:
        text = f"{start.day}/{start.month}/{start.year} - {end.day}/{end.month}/{end.year}"
    if start <= today <= end and today < end:
        text += " - hasta hoy"
    return text


# ---------------------------------------------------------------- time buckets
@dataclass(frozen=True)
class Bucket:
    key: str
    label: str
    start: date
    end: date


def time_key(d: date, gran: str) -> str:
    match gran:
        case "day":
            return d.isoformat()
        case "week":
            y, w, _ = d.isocalendar()
            return f"{y}-W{w:02d}"
        case "quarter":
            return f"{d.year}-Q{(d.month - 1) // 3 + 1}"
        case "year":
            return str(d.year)
        case "weekday":
            return str(d.isoweekday())
        case _:
            return f"{d.year:04d}-{d.month:02d}"


def time_buckets(start: date, end: date, gran: str) -> list[Bucket]:
    if gran == "weekday":
        return [Bucket(str(i + 1), WEEKDAYS[i], start, end) for i in range(7)]
    many_years = start.year != end.year
    out: list[Bucket] = []
    d = start
    while d <= end:
        match gran:
            case "day":
                b_end = d
                label = f"{d.day}/{d.month}"
            case "week":
                monday = d - timedelta(days=d.weekday())
                b_end = monday + timedelta(days=6)
                label = f"{monday.day} {MONTHS_SHORT[monday.month - 1]}"
            case "quarter":
                q = (d.month - 1) // 3
                b_end = last_day(d.year, q * 3 + 3)
                label = f"T{q + 1} {d.year % 100:02d}"
            case "year":
                b_end = date(d.year, 12, 31)
                label = str(d.year)
            case _:
                b_end = last_day(d.year, d.month)
                label = MONTHS_SHORT[d.month - 1] + (f" {d.year % 100:02d}" if many_years else "")
        out.append(Bucket(time_key(d, gran), label, d, min(b_end, end)))
        d = b_end + timedelta(days=1)
    return out


# ---------------------------------------------------------------- filters and labels
def fold(v: object) -> str:
    return ascii_text(str(v)).lower().strip()


def _num(v: object) -> float | None:
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return None


def _prefix_match(value: str, prefix: str, category_like: bool) -> bool:
    if not category_like:
        return value.startswith(prefix)
    p = prefix.rstrip("/")
    return value == p or value.startswith(p + "/")


def matches(r: Rec, rule: ChartFilterRule) -> bool:
    field, op = rule.field, rule.op
    if field == "date":
        bound = str(rule.values[0]) if rule.values else ""
        iso = r.date.isoformat()
        return (iso >= bound) if op == "gte" else (iso <= bound) if op == "lte" else True
    if field == "amount":
        n = _num(rule.values[0]) if rule.values else None
        if n is None:
            return True
        return abs(r.amount) >= n if op == "gte" else abs(r.amount) <= n if op == "lte" else True
    vals = [fold(v) for v in r.values(field)]
    wanted = [fold(v) for v in rule.values]
    cat = field in ("category", "group")
    match op:
        case "in":
            return any(v in wanted for v in vals)
        case "not_in":
            return not any(v in wanted for v in vals)
        case "prefix":
            return any(_prefix_match(v, w, cat) for v in vals for w in wanted)
        case "not_prefix":
            return not any(_prefix_match(v, w, cat) for v in vals for w in wanted)
        case "contains":
            return any(w and w in v for v in vals for w in wanted)
        case "not_contains":
            return not any(w and w in v for v in vals for w in wanted)
        case "empty":
            return all(v == "" for v in vals)
        case "not_empty":
            return any(v != "" for v in vals)
    return True


def nice(s: str) -> str:
    s = s.replace("-", " ").strip()
    return s[:1].upper() + s[1:]


ACCOUNTS = {"efectivo": "Efectivo", "revolut": "Revolut", "ing": "ING"}
EMPTY_LABEL = {"group": "(sin grupo)", "category": "(sin categoria)", "account": "(sin cuenta)",
               "merchant": "(sin comercio)", "concept": "(sin concepto)", "people": "(nadie)", "invited": "(nadie)",
               "related": "(sin proyecto ni evento)", "status": "(sin estado)", "source": "(sin origen)"}


def labeler(field: str, keys: Iterable[str]) -> Callable[[str], str]:
    keys = [k for k in keys if k not in (REST, OTHER)]
    if field == "category":
        groups = {k.split("/", 1)[0] for k in keys if k}
        one_group = len(groups) <= 1

        def cat(k: str) -> str:
            if not k:
                return EMPTY_LABEL["category"]
            g, _, sub = k.partition("/")
            if not sub:
                return nice(g)
            return nice(sub) if one_group else f"{nice(sub)} ({g})"
        return cat

    def lab(k: str) -> str:
        if not k:
            return EMPTY_LABEL.get(field, "(vacio)")
        if field == "group":
            return nice(k)
        if field == "account":
            return ACCOUNTS.get(k, nice(k))
        if field in ("people", "invited"):
            return title_from_slug(k)
        if field in ("status", "source"):
            return nice(k)
        return k
    return lab


# ---------------------------------------------------------------- measures
def relevant(r: Rec, measure: str) -> bool:
    if measure == "income":
        return r.income > 0
    return r.spending != 0 or r.counted


def measure_value(measure: str, recs: list[Rec]) -> float:
    if measure == "income":
        v = sum(r.income for r in recs)
    elif measure == "count":
        v = float(sum(1 for r in recs if r.counted))
    elif measure == "average":
        n = sum(1 for r in recs if r.counted)
        v = sum(r.spending for r in recs) / n if n else 0.0
    else:
        v = sum(r.spending for r in recs)
    return round(v + 0.0, 2)


# ---------------------------------------------------------------- validation
def validate(spec: ChartSpec) -> None:
    errors = []
    if not spec.title.strip():
        errors.append("Ponle un titulo")
    if spec.kind != "number":
        if spec.x is None:
            errors.append("Elige que va en el eje (agrupar por)")
        elif spec.x.field in NUMBER_FIELDS:
            errors.append("No se puede agrupar por importe")
    if spec.split is not None:
        if spec.kind not in SPLIT_KINDS:
            errors.append("Este tipo de grafica no admite separar en series")
        if spec.split.field in NUMBER_FIELDS:
            errors.append("No se puede separar por importe")
        if spec.x is not None and spec.split.field == spec.x.field and spec.split.granularity == spec.x.granularity:
            errors.append("Las series y el eje no pueden ser el mismo campo")
        if spec.compare != "none":
            errors.append("Comparar con otro periodo no se puede combinar con separar en series")
    if spec.kind == "stacked_bar" and spec.split is None:
        errors.append("Las barras apiladas necesitan un campo para separar en series")
    if spec.kind == "donut" and spec.compare != "none":
        errors.append("El anillo no admite comparar")
    if spec.top is not None and not 1 <= spec.top <= 50:
        errors.append("Mostrar los N primeros: entre 1 y 50")
    p = spec.period
    if p.kind == "last_months" and not 1 <= (p.months or 0) <= 60:
        errors.append("Ultimos meses: entre 1 y 60")
    if p.kind == "last_days" and not 1 <= (p.days or 0) <= 731:
        errors.append("Ultimos dias: entre 1 y 731")
    if p.kind == "range":
        try:
            if date.fromisoformat(str(p.start)) > date.fromisoformat(str(p.end)):
                errors.append("La fecha de inicio es posterior a la de fin")
        except ValueError:
            errors.append("Fechas del periodo no validas")
    for f in spec.filters:
        if f.field in ("date", "amount") and f.op not in ("gte", "lte"):
            errors.append(f"Filtro de {f.field}: solo mayor o igual / menor o igual")
        if f.field not in ("date", "amount") and f.op in ("gte", "lte"):
            errors.append(f"Filtro de {f.field}: operacion no valida")
        if f.op not in ("empty", "not_empty") and not f.values:
            errors.append(f"Filtro de {f.field}: falta el valor")
    if errors:
        raise SpecError("; ".join(errors))


# ---------------------------------------------------------------- compute
def _drill(spec: ChartSpec, key: str, start: date, end: date) -> tuple[ChartSpec, date, date]:
    """Open one point: a group shows its categories; a time bucket shows its groups; any other value shows groups."""
    x = spec.x
    assert x is not None
    s = spec.model_copy(deep=True)
    s.split, s.compare, s.top = None, "none", None
    if x.field == "group":
        s.filters.append(ChartFilterRule(field="category", op="prefix", values=[key]))
        s.x = Dimension(field="category")
    elif x.field == "date":
        for b in time_buckets(start, end, x.granularity or "month"):
            if b.key == key:
                start, end = b.start, b.end
        s.x = Dimension(field="group")
        if s.kind not in ("hbar", "donut", "table"):
            s.kind = "hbar"
    else:
        s.filters.append(ChartFilterRule(field=x.field, op="in", values=[key]))
        s.x = Dimension(field="group")
    if s.kind in ("line", "area", "stacked_bar"):
        s.kind = "hbar"
    return s, start, end


def compute(spec: ChartSpec, recs: list[Rec], months_with_data: set[tuple[int, int]], today: date, now: datetime,
            drill: str | None = None, stale: bool = False) -> ChartData:
    validate(spec)
    start, end = period_range(spec, today)
    sub_prefix = ""
    if drill is not None and spec.x is not None and drill not in (REST, OTHER):
        if spec.x.field == "date" and spec.x.granularity == "weekday":
            weekday = int(drill)
            recs = [r for r in recs if r.date.isoweekday() == weekday]
            sub_prefix = WEEKDAYS[weekday - 1].capitalize() + " - "
            spec2 = spec.model_copy(deep=True)
            spec2.x, spec2.kind = Dimension(field="group"), "hbar"
            spec2.split, spec2.compare, spec2.top = None, "none", None
            spec = spec2
        else:
            label = labeler(spec.x.field, [drill])(drill) if spec.x.field != "date" else ""
            spec, start, end = _drill(spec, drill, start, end)
            sub_prefix = (label + " - ") if label else ""
    measure = spec.measure
    rules = spec.filters

    def select(a: date, b: date) -> list[Rec]:
        return [r for r in recs if a <= r.date <= b and relevant(r, measure) and all(matches(r, f) for f in rules)]

    current = select(start, end)
    cmp = compare_range(spec, start, end, today)
    previous = select(*cmp) if cmp else []
    total = measure_value(measure, current)
    previous_total = measure_value(measure, previous) if cmp else None
    delta = None
    if previous_total:
        delta = round((total - previous_total) / abs(previous_total) * 100, 1)

    subtitle = sub_prefix + describe_range(start, end, today)
    cmp_name = ""
    if cmp:
        # an unfinished period is compared "so far", but named by its whole months
        cmp_end = last_day(cmp[1].year, cmp[1].month) if _month_aligned(start, end) else cmp[1]
        cmp_name = describe_range(cmp[0], cmp_end, today).replace(" - hasta hoy", "")
        subtitle += " - frente a " + cmp_name
    base = dict(chart_id=spec.id, title=spec.title, subtitle=subtitle, kind=spec.kind, measure=measure,
                unit="" if measure == "count" else "EUR", total=total, previous_total=previous_total, delta_pct=delta,
                computed_at=now, stale=stale, drill=drill)

    if spec.kind == "number":
        series = [ChartSeries(key="total", name=spec.title,
                              points=[ChartPoint(key="total", label="Total", value=total)])]
        if cmp:
            series.append(ChartSeries(key="previous", name=cmp_name, role="compare",
                                      points=[ChartPoint(key="total", label="Total", value=previous_total or 0.0)]))
        return ChartData(series=series, **base)

    x = spec.x
    assert x is not None
    is_time = x.field == "date"
    gran = x.granularity or "month"

    def keys_of(r: Rec, dim: Dimension) -> list[str]:
        if dim.field == "date":
            return [time_key(r.date, dim.granularity or "month")]
        return [fold(v) if dim.field in ("category", "group", "account", "status", "source") else v
                for v in r.values(dim.field)]

    def grouped(rs: list[Rec], dim: Dimension) -> dict[str, list[Rec]]:
        g: dict[str, list[Rec]] = defaultdict(list)
        for r in rs:
            for k in dict.fromkeys(keys_of(r, dim)):
                g[k].append(r)
        return g

    by_x = grouped(current, x)
    # ---- X keys and their order
    if is_time:
        buckets = time_buckets(start, end, gran)
        if spec.period.kind == "all":  # skip the empty months before the first data
            first = next((i for i, b in enumerate(buckets) if b.key in by_x), len(buckets) - 1)
            buckets = buckets[max(first, 0):]
        x_keys = [b.key for b in buckets]
        labels = {b.key: b.label for b in buckets}

        def no_data(b: Bucket) -> bool:
            return gran != "weekday" and not any(m in months_with_data for m in months_between(b.start, b.end))

        flags = {b.key: (b.start <= today <= b.end and today < b.end and gran != "weekday", no_data(b))
                 for b in buckets}
        if spec.sort in ("value_desc", "value_asc"):
            x_keys.sort(key=lambda k: measure_value(measure, by_x.get(k, [])), reverse=spec.sort == "value_desc")
    else:
        # a category whose purchases were refunded adds up to 0: not worth a bar
        x_keys = [k for k in by_x if abs(measure_value(measure, by_x[k])) >= 0.005]
        lab = labeler(x.field, x_keys)
        labels = {k: lab(k) for k in x_keys}
        flags = {}
        if spec.sort == "label":
            x_keys.sort(key=lambda k: fold(labels[k]))
        else:
            x_keys.sort(key=lambda k: measure_value(measure, by_x[k]), reverse=spec.sort != "value_asc")
        top = spec.top or (6 if spec.kind == "donut" else None)
        if top and len(x_keys) > top:
            rest = x_keys[top - 1:] if spec.kind == "donut" else x_keys[top:]
            keep = x_keys[: len(x_keys) - len(rest)]
            by_x[REST] = [r for k in rest for r in by_x[k]]
            labels[REST] = f"Resto ({len(rest)})"
            x_keys = keep + [REST]

    def points(group: dict[str, list[Rec]]) -> list[ChartPoint]:
        out = []
        for k in x_keys:
            partial, nd = flags.get(k, (False, False))
            out.append(ChartPoint(key=k, label=labels.get(k, k), value=measure_value(measure, group.get(k, [])),
                                  partial=partial, no_data=nd))
        return out

    series: list[ChartSeries] = []
    if spec.split is not None:
        by_split = grouped(current, spec.split)
        split_keys = sorted((k for k in by_split if abs(measure_value(measure, by_split[k])) >= 0.005),
                            key=lambda k: measure_value(measure, by_split[k]), reverse=True)
        if spec.split.field == "date":
            split_keys = [b.key for b in time_buckets(start, end, spec.split.granularity or "month")
                          if b.key in split_keys]
        if len(split_keys) > MAX_SPLIT:
            others = split_keys[MAX_SPLIT - 1:]
            by_split[OTHER] = [r for k in others for r in by_split[k]]
            split_keys = split_keys[: MAX_SPLIT - 1] + [OTHER]
        if spec.split.field == "date":
            sb = {b.key: b.label for b in time_buckets(start, end, spec.split.granularity or "month")}
            slab: Callable[[str], str] = lambda k: sb.get(k, k)  # noqa: E731
        else:
            slab = labeler(spec.split.field, split_keys)
        for sk in split_keys:
            name = "Otros" if sk == OTHER else slab(sk)
            series.append(ChartSeries(key=sk, name=name, role="split", points=points(grouped(by_split[sk], x))))
    else:
        series.append(ChartSeries(key="main", name=spec.title, points=points(by_x)))

    if cmp:
        prev_by_x = grouped(previous, x)
        if is_time:
            prev_buckets = time_buckets(cmp[0], cmp[1], gran)
            aligned = {x_keys[i]: prev_by_x.get(b.key, []) for i, b in enumerate(prev_buckets) if i < len(x_keys)}
        else:
            aligned = {k: prev_by_x.get(k, []) for k in x_keys if k != REST}
            if REST in x_keys:
                kept = set(x_keys)
                aligned[REST] = [r for k, rs in prev_by_x.items() if k not in kept for r in rs]
        pts = [p.model_copy(update={"value": measure_value(measure, aligned.get(p.key, [])), "partial": False,
                                    "no_data": False}) for p in points({})]
        series.append(ChartSeries(key="previous", name=cmp_name, role="compare", points=pts))

    average = None
    if is_time and gran != "weekday" and spec.split is None and spec.kind in ("bar", "line", "area") \
            and measure != "average":
        complete = [p.value for p in series[0].points if not p.partial and not p.no_data]
        average = round(sum(complete) / len(complete), 2) if complete else None

    drillable = spec.drilldown and drill is None and spec.kind in ("bar", "hbar", "donut", "table", "line", "area",
                                                                   "stacked_bar")
    x_label = {"date": {"day": "Dia", "week": "Semana", "month": "Mes", "quarter": "Trimestre", "year": "Ano",
                        "weekday": "Dia de la semana"}.get(gran, "Fecha")}.get(x.field)
    return ChartData(series=series, average=average, drilldown=drillable, x_label=x_label, **base)


# ---------------------------------------------------------------- catalog for the client's builder
SET_OPS = ["in", "not_in"]
TEXT_OPS = ["in", "not_in", "contains", "not_contains", "empty", "not_empty"]
MULTI_OPS = ["in", "not_in", "contains", "empty", "not_empty"]


def catalog() -> ChartCatalog:
    f = FieldInfo
    return ChartCatalog(
        fields=[
            f(id="date", label="Fecha", kind="time", ops=["gte", "lte"]),
            f(id="group", label="Grupo de categoria", kind="set", ops=SET_OPS, source="groups"),
            f(id="category", label="Categoria", kind="set", ops=["in", "not_in", "prefix", "not_prefix"],
              source="categories"),
            f(id="account", label="Cuenta", kind="set", ops=SET_OPS, source="accounts"),
            f(id="merchant", label="Comercio", kind="text", ops=TEXT_OPS, source="merchants"),
            f(id="concept", label="Concepto", kind="text", ops=["contains", "not_contains", "empty", "not_empty"]),
            f(id="people", label="Con quien", kind="multi", ops=MULTI_OPS, source="people"),
            f(id="invited", label="Invitados", kind="multi", ops=MULTI_OPS, source="people"),
            f(id="related", label="Proyecto o evento", kind="multi", ops=MULTI_OPS, source="related"),
            f(id="status", label="Estado", kind="set", ops=SET_OPS, source="statuses"),
            f(id="source", label="Origen", kind="set", ops=SET_OPS, source="sources"),
            f(id="amount", label="Importe", kind="number", ops=["gte", "lte"], can_group=False),
        ],
        kinds=[CatalogItem(id=k, label=v, help=h) for k, v, h in [
            ("bar", "Barras", "Comparar valores; con fechas, la evolucion"),
            ("stacked_bar", "Barras apiladas", "Cada barra repartida entre las series"),
            ("hbar", "Barras horizontales", "Rankings: categorias, comercios, personas"),
            ("line", "Linea", "Evolucion en el tiempo"),
            ("area", "Area", "Evolucion en el tiempo, con relleno"),
            ("donut", "Anillo", "Reparto de un total entre pocas partes"),
            ("number", "Cifra", "Un numero grande, con la diferencia frente a otro periodo"),
            ("table", "Tabla", "Los valores exactos")]],
        measures=[CatalogItem(id="spending", label="Gasto", help="Tu parte, sin reembolsos ni traspasos"),
                  CatalogItem(id="income", label="Ingresos"),
                  CatalogItem(id="count", label="Numero de gastos"),
                  CatalogItem(id="average", label="Gasto medio", help="Gasto dividido entre numero de gastos")],
        granularities=[CatalogItem(id=k, label=v) for k, v in [
            ("day", "Dia"), ("week", "Semana"), ("month", "Mes"), ("quarter", "Trimestre"), ("year", "Ano"),
            ("weekday", "Dia de la semana")]],
        periods=[CatalogItem(id=k, label=v) for k, v in [
            ("this_month", "Este mes"), ("last_month", "Mes pasado"), ("last_months", "Ultimos meses"),
            ("this_year", "Este ano"), ("last_year", "Ano pasado"), ("last_days", "Ultimos dias"),
            ("range", "Entre fechas"), ("all", "Todo")]],
        compares=[CatalogItem(id=k, label=v) for k, v in [
            ("none", "Sin comparar"), ("previous_period", "Periodo anterior"),
            ("previous_year", "Mismo periodo del ano anterior")]],
    )
