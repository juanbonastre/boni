import {
  type ChartStyle,
  chartStyle,
  type ChartSpec as EngineSpec,
  type Granularity,
} from "@boni/views";

/**
 * The Boni API v1 contract (the first Boni's server/boni/contract.py and legacy/boni/api/), as the Boni apps
 * read it. Answers carry every field, defaults written out, as the Pydantic models sent them.
 */
export const PALETTE = [
  "#a78bfa",
  "#fb923c",
  "#f87171",
  "#fbbf24",
  "#4ade80",
  "#2dd4bf",
  "#38bdf8",
  "#60a5fa",
  "#f472b6",
  "#ef4444",
  "#94a3b8",
];
export const VERSION = "0.5.0"; // the first Boni's server was 0.4.0; this one answers its v1 API
export const API_VERSION = "1";

export class Invalid extends Error {}

const KINDS = ["bar", "stacked_bar", "hbar", "line", "area", "donut", "number", "table"];
const MEASURES = ["spending", "income", "count", "average"];
const FIELDS = [
  "date",
  "group",
  "category",
  "account",
  "merchant",
  "concept",
  "people",
  "invited",
  "related",
  "status",
  "source",
  "amount",
];
const GRANS = ["day", "week", "month", "quarter", "year", "weekday"];
const PERIODS = [
  "this_month",
  "last_month",
  "last_months",
  "this_year",
  "last_year",
  "last_days",
  "range",
  "all",
];
const OPS = [
  "in",
  "not_in",
  "prefix",
  "not_prefix",
  "contains",
  "not_contains",
  "gte",
  "lte",
  "empty",
  "not_empty",
];

/** A chart definition exactly as the v1 API sends it (ChartSpec.model_dump). */
export interface V1ChartSpec extends EngineSpec {
  id: string;
  measure: string;
  x: { field: string; granularity: Granularity | null } | null;
  split: { field: string; granularity: Granularity | null } | null;
  period: {
    kind: EngineSpec["period"]["kind"];
    months: number | null;
    days: number | null;
    start: string | null;
    end: string | null;
  };
  filters: {
    field: string;
    op: NonNullable<EngineSpec["filters"]>[number]["op"];
    values: (string | number)[];
  }[];
  compare: "none" | "previous_period" | "previous_year";
  top: number | null;
  sort: "auto" | "value_desc" | "value_asc" | "label";
  drilldown: boolean;
  home: boolean;
  color: string | null;
  /** How it looks (Notion's style settings); only when it differs from the defaults. */
  style?: ChartStyle;
  group_by: "category_group" | "category" | "month" | null;
  filter: { include: string[]; exclude: string[] };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const oneOf = (v: unknown, list: string[], what: string): string => {
  if (typeof v !== "string" || !list.includes(v)) throw new Invalid(`${what}: valor no valido`);
  return v;
};
const optInt = (v: unknown, what: string): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isInteger(v))
    throw new Invalid(`${what}: no es un numero entero`);
  return v;
};
const optStr = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const dim = (v: unknown, what: string) => {
  if (v === null || v === undefined) return null;
  if (!isObj(v)) throw new Invalid(`${what}: no valido`);
  const g =
    v.granularity === null || v.granularity === undefined
      ? null
      : (oneOf(v.granularity, GRANS, `${what}.granularity`) as Granularity);
  return { field: oneOf(v.field, FIELDS, `${what}.field`), granularity: g };
};

/**
 * A chart definition read like the Pydantic model did: unknown keys dropped, defaults filled, and the
 * v1-era keys upgraded (`group_by` becomes `x`, `filter.include/exclude` becomes category filters, a date
 * axis without granularity is monthly). Throws Invalid for what the model would have refused.
 */
export function normalizeSpec(raw: unknown): V1ChartSpec {
  if (!isObj(raw)) throw new Invalid("La grafica no es un objeto");
  if (typeof raw.title !== "string") throw new Invalid("title: falta");
  const p = isObj(raw.period) ? raw.period : null;
  if (!p) throw new Invalid("period: falta");
  const filters = (Array.isArray(raw.filters) ? raw.filters : []).map((f, i) => {
    if (!isObj(f)) throw new Invalid(`filters[${i}]: no valido`);
    const values = Array.isArray(f.values)
      ? f.values.map((x) => (typeof x === "number" ? x : String(x)))
      : [];
    return {
      field: oneOf(f.field, FIELDS, `filters[${i}].field`),
      op: oneOf(f.op, OPS, `filters[${i}].op`) as V1ChartSpec["filters"][number]["op"],
      values,
    };
  });
  const legacy = isObj(raw.filter) ? raw.filter : {};
  const include = Array.isArray(legacy.include) ? legacy.include.map(String) : [];
  const exclude = Array.isArray(legacy.exclude) ? legacy.exclude.map(String) : [];
  const color = raw.color === null || raw.color === undefined ? null : String(raw.color);
  if (color !== null && !/^#[0-9a-f]{6}$/.test(color)) throw new Invalid("color: no valido");
  const groupBy =
    raw.group_by === null || raw.group_by === undefined
      ? null
      : (oneOf(
          raw.group_by,
          ["category_group", "category", "month"],
          "group_by",
        ) as V1ChartSpec["group_by"]);
  const spec: V1ChartSpec = {
    id: typeof raw.id === "string" ? raw.id : "",
    title: raw.title,
    kind: oneOf(raw.kind, KINDS, "kind") as V1ChartSpec["kind"],
    measure: raw.measure === undefined ? "spending" : oneOf(raw.measure, MEASURES, "measure"),
    x: dim(raw.x, "x"),
    split: dim(raw.split, "split"),
    period: {
      kind: oneOf(p.kind, PERIODS, "period.kind") as V1ChartSpec["period"]["kind"],
      months: optInt(p.months, "period.months"),
      days: optInt(p.days, "period.days"),
      start: optStr(p.start),
      end: optStr(p.end),
    },
    filters,
    compare:
      raw.compare === undefined
        ? "none"
        : (oneOf(
            raw.compare,
            ["none", "previous_period", "previous_year"],
            "compare",
          ) as V1ChartSpec["compare"]),
    top: optInt(raw.top, "top"),
    sort:
      raw.sort === undefined
        ? "auto"
        : (oneOf(
            raw.sort,
            ["auto", "value_desc", "value_asc", "label"],
            "sort",
          ) as V1ChartSpec["sort"]),
    drilldown: raw.drilldown === undefined ? false : !!raw.drilldown,
    home: raw.home === undefined ? true : !!raw.home,
    color,
    group_by: groupBy,
    filter: { include, exclude },
  };
  const style = chartStyle(raw.style);
  if (style) spec.style = style;
  // The model's after-validator (_upgrade_legacy), in its order.
  if (spec.x === null && spec.group_by !== null)
    spec.x = {
      category_group: { field: "group", granularity: null },
      category: { field: "category", granularity: null },
      month: { field: "date", granularity: "month" as Granularity },
    }[spec.group_by];
  if (include.length || exclude.length) {
    if (include.length)
      spec.filters.push({ field: "category", op: "prefix", values: [...include] });
    if (exclude.length)
      spec.filters.push({ field: "category", op: "not_prefix", values: [...exclude] });
    spec.filter = { include: [], exclude: [] };
  }
  if (spec.x && spec.x.field === "date" && spec.x.granularity === null)
    spec.x.granularity = "month";
  if (spec.split && spec.split.field === "date" && spec.split.granularity === null)
    spec.split.granularity = "month";
  if (spec.group_by === null && spec.x !== null)
    spec.group_by =
      spec.x.field === "group"
        ? "category_group"
        : spec.x.field === "category"
          ? "category"
          : spec.x.field === "date" && spec.x.granularity === "month"
            ? "month"
            : null;
  return spec;
}

const EATING_OUT = [
  { field: "category", op: "prefix", values: ["comida/", "bebida/cafe", "bebida/alcohol"] },
  { field: "category", op: "not_prefix", values: ["comida/supermercado"] },
];
/** The charts a new account starts with (stats/charts.py). */
export const DEFAULT_CHARTS = (): V1ChartSpec[] =>
  [
    {
      id: "spending-by-category",
      title: "Gasto del mes",
      kind: "hbar",
      x: { field: "group" },
      period: { kind: "this_month" },
      drilldown: true,
      color: "#60a5fa",
    },
    {
      id: "monthly-spending",
      title: "Gasto por mes",
      kind: "bar",
      x: { field: "date", granularity: "month" },
      period: { kind: "last_months", months: 12 },
      drilldown: true,
      color: "#a78bfa",
    },
    {
      id: "eating-out",
      title: "Comida fuera",
      kind: "line",
      x: { field: "date", granularity: "month" },
      period: { kind: "last_months", months: 12 },
      filters: EATING_OUT,
      color: "#fb923c",
    },
  ].map(normalizeSpec);

const item = (id: string, label: string, help: string | null = null) => ({ id, label, help });
const SET_OPS = ["in", "not_in"];
const TEXT_OPS = ["in", "not_in", "contains", "not_contains", "empty", "not_empty"];
const MULTI_OPS = ["in", "not_in", "contains", "empty", "not_empty"];
const field = (
  id: string,
  label: string,
  kind: string,
  ops: string[],
  source: string | null = null,
  can_group = true,
) => ({ id, label, kind, ops, source, can_group });

/** What the clients' chart builder offers (engine.catalog()). */
export const CATALOG = {
  fields: [
    field("date", "Fecha", "time", ["gte", "lte"]),
    field("group", "Grupo de categoría", "set", SET_OPS, "groups"),
    field("category", "Categoría", "set", ["in", "not_in", "prefix", "not_prefix"], "categories"),
    field("account", "Cuenta", "set", SET_OPS, "accounts"),
    field("merchant", "Comercio", "text", TEXT_OPS, "merchants"),
    field("concept", "Concepto", "text", ["contains", "not_contains", "empty", "not_empty"]),
    field("people", "Con quién", "multi", MULTI_OPS, "people"),
    field("invited", "Invitados", "multi", MULTI_OPS, "people"),
    field("related", "Proyecto o evento", "multi", MULTI_OPS, "related"),
    field("status", "Estado", "set", SET_OPS, "statuses"),
    field("source", "Origen", "set", SET_OPS, "sources"),
    field("amount", "Importe", "number", ["gte", "lte"], null, false),
  ],
  kinds: [
    item("bar", "Barras", "Comparar valores; con fechas, la evolución"),
    item("stacked_bar", "Barras apiladas", "Cada barra repartida entre las series"),
    item("hbar", "Barras horizontales", "Rankings: categorías, comercios, personas"),
    item("line", "Línea", "Evolución en el tiempo"),
    item("area", "Área", "Evolución en el tiempo, con relleno"),
    item("donut", "Anillo", "Reparto de un total entre pocas partes"),
    item("number", "Cifra", "Un número grande, con la diferencia frente a otro periodo"),
    item("table", "Tabla", "Los valores exactos"),
  ],
  measures: [
    item("spending", "Gasto", "Tu parte, sin reembolsos ni traspasos"),
    item("income", "Ingresos"),
    item("count", "Número de gastos"),
    item("average", "Gasto medio", "Gasto dividido entre número de gastos"),
  ],
  granularities: [
    item("day", "Día"),
    item("week", "Semana"),
    item("month", "Mes"),
    item("quarter", "Trimestre"),
    item("year", "Año"),
    item("weekday", "Día de la semana"),
  ],
  periods: [
    item("this_month", "Este mes"),
    item("last_month", "Mes pasado"),
    item("last_months", "Últimos meses"),
    item("this_year", "Este año"),
    item("last_year", "Año pasado"),
    item("last_days", "Últimos días"),
    item("range", "Entre fechas"),
    item("all", "Todo"),
  ],
  compares: [
    item("none", "Sin comparar"),
    item("previous_period", "Periodo anterior"),
    item("previous_year", "Mismo periodo del año anterior"),
  ],
};
