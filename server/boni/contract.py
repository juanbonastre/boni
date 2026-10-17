"""Client <-> server contract (API v1). Source of truth for `api/schema/`.

Rules: additive changes only within v1; clients ignore unknown fields and render a placeholder for unknown component
types. Run `python -m boni.contract --write` after changing a model; `tests/test_contract.py` fails on drift.

Form fields are a superset of MCP elicitation's form schema: every field maps to a flat JSON Schema primitive
(see `field_json_schema`), so a Boni form can be offered as an elicitation request and vice versa.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Model(BaseModel):
    model_config = ConfigDict(extra="ignore")


# ---------- common ----------
class Option(Model):
    value: str
    label: str
    hint: str | None = None


class Condition(Model):
    """Show a field only when another field of the same form has this value."""

    field: str
    equals: Any


class _FieldBase(Model):
    id: str
    label: str
    required: bool = False
    help: str | None = None
    visible_when: Condition | None = None


class AmountField(_FieldBase):
    type: Literal["amount"] = "amount"
    currency: str = "EUR"
    default: float | None = None
    min: float | None = 0.01
    max: float | None = None


class TextField(_FieldBase):
    type: Literal["text"] = "text"
    default: str | None = None
    max_length: int | None = None
    multiline: bool = False
    placeholder: str | None = None


class DateField(_FieldBase):
    type: Literal["date"] = "date"
    default: str | None = Field(None, description="ISO date, or 'today' (device's local date)")


class ChoiceField(_FieldBase):
    """Pick one. Either inline `options` or a server `source` (GET /options/{source}?q=)."""

    type: Literal["choice"] = "choice"
    options: list[Option] | None = None
    source: str | None = None
    searchable: bool = False
    style: Literal["chips", "dropdown"] = "chips"
    default: str | None = None


class MultiChoiceField(_FieldBase):
    """Pick several (checkboxes / chips). Inline `options` or a server `source`."""

    type: Literal["multi_choice"] = "multi_choice"
    options: list[Option] | None = None
    source: str | None = None
    searchable: bool = False
    default: list[str] = []


class ToggleField(_FieldBase):
    type: Literal["toggle"] = "toggle"
    default: bool = False


FormField = Annotated[
    AmountField | TextField | DateField | ChoiceField | MultiChoiceField | ToggleField,
    Field(discriminator="type"),
]


# ---------- components ----------
class SubmitAction(Model):
    action: str = Field(description="Action name sent in POST /actions, e.g. 'expenses.capture'")
    label: str


class TextComponent(Model):
    type: Literal["text"] = "text"
    text: str
    style: Literal["title", "body", "caption"] = "body"


class ButtonComponent(Model):
    """Navigates to another server screen."""

    type: Literal["button"] = "button"
    label: str
    screen: str
    icon: str | None = Field(None, description="Hint, e.g. 'add'; clients may ignore it")
    style: Literal["primary", "secondary"] = "primary"


class FormComponent(Model):
    type: Literal["form"] = "form"
    id: str
    fields: list[FormField]
    submit: SubmitAction


class ChartCardComponent(Model):
    type: Literal["chart_card"] = "chart_card"
    chart_id: str
    title: str
    size: Literal["small", "medium", "wide"] = "medium"


Component = Annotated[
    TextComponent | ButtonComponent | FormComponent | ChartCardComponent,
    Field(discriminator="type"),
]


class Screen(Model):
    api_version: str = "1"
    id: str
    title: str
    components: list[Component]


# ---------- charts ----------
# A chart is a DEFINITION (ChartSpec), never data: the server computes it, the client draws it, and later the AI edits
# it from natural language. The builder works on generic records (one per money movement) and their fields:
FieldId = Literal["date", "group", "category", "account", "merchant", "concept", "people", "invited", "related",
                  "status", "source", "amount"]
Granularity = Literal["day", "week", "month", "quarter", "year", "weekday"]
ChartKind = Literal["bar", "stacked_bar", "hbar", "line", "area", "donut", "number", "table"]
Measure = Literal["spending", "income", "count", "average"]


class Dimension(Model):
    """What the X axis (or the series split) is made of: a field, and for `date` a time granularity."""

    field: FieldId
    granularity: Granularity | None = Field(None, description="Only for field=date (default month)")


class ChartFilterRule(Model):
    """One filter. Text ops compare accent/case-insensitively; `prefix` on category matches a whole group
    ("comida/" or "comida"); multi-valued fields (people, invited, related) match if ANY value matches."""

    field: FieldId
    op: Literal["in", "not_in", "prefix", "not_prefix", "contains", "not_contains", "gte", "lte", "empty", "not_empty"]
    values: list[str | float] = []


class Period(Model):
    kind: Literal["this_month", "last_month", "last_months", "this_year", "last_year", "last_days", "range", "all"]
    months: int | None = Field(None, description="For last_months: how many months, current one included")
    days: int | None = Field(None, description="For last_days: how many days, today included")
    start: str | None = Field(None, description="For range: ISO date")
    end: str | None = Field(None, description="For range: ISO date")


class ChartFilter(Model):
    """Legacy (v1 charts): category prefixes. Converted into `filters` when a spec is read."""

    include: list[str] = []
    exclude: list[str] = []


class ChartSpec(Model):
    id: str = ""
    title: str
    kind: ChartKind
    measure: Measure = "spending"
    x: Dimension | None = Field(None, description="X axis / slices / rows. Ignored by kind=number")
    split: Dimension | None = Field(None, description="One series per value of this field "
                                                      "(bar, stacked_bar, line, area, table)")
    period: Period
    filters: list[ChartFilterRule] = []
    compare: Literal["none", "previous_period", "previous_year"] = "none"
    top: int | None = Field(None, description="Categorical X: keep the N largest, fold the rest into 'Resto'")
    sort: Literal["auto", "value_desc", "value_asc", "label"] = "auto"
    drilldown: bool = Field(False, description="Points can be opened with GET /charts/{id}/data?drill=<key>")
    home: bool = Field(True, description="Shown on the home screen")
    # legacy v1 fields, kept so older specs (and older clients) keep working
    group_by: Literal["category_group", "category", "month"] | None = None
    filter: ChartFilter = ChartFilter()

    @model_validator(mode="after")
    def _upgrade_legacy(self) -> ChartSpec:
        if self.x is None and self.group_by is not None:
            self.x = {"category_group": Dimension(field="group"), "category": Dimension(field="category"),
                      "month": Dimension(field="date", granularity="month")}[self.group_by]
        if self.filter.include or self.filter.exclude:
            if self.filter.include:
                self.filters.append(ChartFilterRule(field="category", op="prefix", values=list(self.filter.include)))
            if self.filter.exclude:
                self.filters.append(ChartFilterRule(field="category", op="not_prefix",
                                                    values=list(self.filter.exclude)))
            self.filter = ChartFilter()
        if self.x is not None and self.x.field == "date" and self.x.granularity is None:
            self.x.granularity = "month"
        if self.split is not None and self.split.field == "date" and self.split.granularity is None:
            self.split.granularity = "month"
        if self.group_by is None and self.x is not None:  # for v1 clients
            self.group_by = ("category_group" if self.x.field == "group" else "category" if self.x.field == "category"
                             else "month" if self.x.field == "date" and self.x.granularity == "month" else None)
        return self


class ChartPoint(Model):
    key: str
    label: str
    value: float
    partial: bool = Field(False, description="Period not finished yet (e.g. current month)")
    no_data: bool = Field(False, description="No movements recorded at all in this period (gap, not zero spending)")


class ChartSeries(Model):
    key: str = ""
    name: str
    points: list[ChartPoint]
    role: Literal["main", "split", "compare"] = "main"


class ChartData(Model):
    chart_id: str
    title: str
    subtitle: str | None = None
    kind: ChartKind
    measure: Measure = "spending"
    unit: str = Field("EUR", description="'EUR' or '' (counts)")
    series: list[ChartSeries]
    total: float | None = None
    previous_total: float | None = Field(None, description="Total of the compared period (compare != none)")
    delta_pct: float | None = Field(None, description="(total - previous_total) / previous_total * 100")
    average: float | None = Field(None, description="Reference line: mean of the complete periods")
    x_label: str | None = None
    drilldown: bool = False
    drill: str | None = Field(None, description="Key this data was drilled into, if any")
    computed_at: datetime
    stale: bool = Field(False, description="Served from cache because the data source is unreachable")


class ChartsResponse(Model):
    charts: list[ChartSpec]


class ChartOrder(Model):
    ids: list[str]


class ChartPreviewRequest(Model):
    spec: ChartSpec
    drill: str | None = None


# ----- builder catalog: what the client's chart builder offers (labels in Spanish without accents) -----
class FieldInfo(Model):
    id: FieldId
    label: str
    kind: Literal["time", "set", "multi", "text", "number"]
    ops: list[str]
    source: str | None = Field(None, description="Options source for its values (GET /options/{source})")
    can_group: bool = True


class CatalogItem(Model):
    id: str
    label: str
    help: str | None = None


class ChartCatalog(Model):
    fields: list[FieldInfo]
    kinds: list[CatalogItem]
    measures: list[CatalogItem]
    granularities: list[CatalogItem]
    periods: list[CatalogItem]
    compares: list[CatalogItem]


# ---------- widgets ----------
class Widget(Model):
    id: str
    chart_id: str
    size: Literal["small", "medium", "large"] = "medium"


class WidgetsResponse(Model):
    widgets: list[Widget]


class WidgetRequest(Model):
    chart_id: str
    size: Literal["small", "medium", "large"] = "medium"


# ---------- options ----------
class OptionsResponse(Model):
    source: str
    options: list[Option]


# ---------- actions ----------
class ActionRequest(Model):
    action: str
    client_id: UUID = Field(description="Generated by the client once per capture; makes retries idempotent")
    values: dict[str, Any]
    created_at: datetime | None = Field(None, description="Device time (with offset) when the user saved")


class ActionResult(Model):
    status: Literal["ok", "queued", "invalid", "error"]
    message: str | None = None
    field_errors: dict[str, str] = {}
    navigate: str | None = Field(None, description="Screen to show next, e.g. 'home'")


class ErrorBody(Model):
    code: str
    message: str


class ErrorResponse(Model):
    error: ErrorBody


class Health(Model):
    status: Literal["ok"] = "ok"
    version: str
    api_version: str
    sources: dict[str, Literal["ok", "unreachable", "not_configured"]]


# ---------- elicitation mapping ----------
def field_json_schema(f: AmountField | TextField | DateField | ChoiceField | MultiChoiceField | ToggleField,
                      options: list[Option] | None = None) -> dict[str, Any]:
    """The MCP elicitation (form mode) JSON Schema of one field. `options` resolves a `source`."""
    s: dict[str, Any] = {"title": f.label}
    if f.help:
        s["description"] = f.help
    match f:
        case AmountField():
            s |= {"type": "number"}
            if f.min is not None:
                s["minimum"] = f.min
            if f.max is not None:
                s["maximum"] = f.max
        case TextField():
            s |= {"type": "string"}
            if f.max_length:
                s["maxLength"] = f.max_length
        case DateField():
            s |= {"type": "string", "format": "date"}
        case ChoiceField():
            opts = f.options or options or []
            s |= {"type": "string", "oneOf": [{"const": o.value, "title": o.label} for o in opts]}
        case MultiChoiceField():
            opts = f.options or options or []
            s |= {"type": "array", "items": {"anyOf": [{"const": o.value, "title": o.label} for o in opts]}}
        case ToggleField():
            s |= {"type": "boolean", "default": f.default}
    return s


# ---------- schema files ----------
SCHEMA_MODELS: dict[str, type[BaseModel]] = {
    "Screen": Screen,
    "ChartsResponse": ChartsResponse,
    "ChartSpec": ChartSpec,
    "ChartCatalog": ChartCatalog,
    "ChartPreviewRequest": ChartPreviewRequest,
    "ChartOrder": ChartOrder,
    "WidgetRequest": WidgetRequest,
    "ChartData": ChartData,
    "WidgetsResponse": WidgetsResponse,
    "OptionsResponse": OptionsResponse,
    "ActionRequest": ActionRequest,
    "ActionResult": ActionResult,
    "ErrorResponse": ErrorResponse,
    "Health": Health,
}


def schema_files() -> dict[str, str]:
    return {
        f"{name}.schema.json": json.dumps(model.model_json_schema(), indent=2, sort_keys=True) + "\n"
        for name, model in SCHEMA_MODELS.items()
    }


def api_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "api"


def main(argv: list[str]) -> int:
    out = api_dir() / "schema"
    if "--write" not in argv:
        print("usage: python -m boni.contract --write   (regenerates api/schema/)")
        return 2
    out.mkdir(parents=True, exist_ok=True)
    for name, text in schema_files().items():
        (out / name).write_text(text)
        print("wrote", out / name)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
