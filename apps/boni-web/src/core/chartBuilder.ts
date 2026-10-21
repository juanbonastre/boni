import type { T } from "../i18n.ts";
import type { ChartCatalog, ChartFilterRule, ChartSpec, Dimension, Period } from "./contract.ts";

/**
 * Pure logic of the chart editor: defaults, keeping a definition coherent while the user changes one option at a
 * time, and the texts of the chart list. The server validates again on save and preview.
 */

/** Kinds that can split the data into several series. */
export const SPLIT_KINDS = new Set(["bar", "stacked_bar", "line", "area", "table"]);
/** Kinds that rank categories rather than show time. */
const CATEGORY_KINDS = new Set(["hbar", "donut", "table"]);
export const isCategoryKind = (kind: string) => CATEGORY_KINDS.has(kind);

export const newSpec = (title: string): ChartSpec => ({
  id: "",
  title,
  kind: "bar",
  measure: "spending",
  x: { field: "date", granularity: "month" },
  split: null,
  period: { kind: "last_months", months: 12 },
  filters: [],
  compare: "none",
  top: null,
  sort: "auto",
  drilldown: false,
  home: true,
  color: null,
  style: {},
});

export const duplicate = (spec: ChartSpec, copyLabel: string): ChartSpec => ({
  ...spec,
  id: "",
  title: `${spec.title} (${copyLabel})`,
});

export const defaultX = (kind: string): Dimension =>
  CATEGORY_KINDS.has(kind) ? { field: "group" } : { field: "date", granularity: "month" };

function withGranularity(d: Dimension | null): Dimension | null {
  if (!d) return null;
  if (d.field === "date" && !d.granularity) return { ...d, granularity: "month" };
  if (d.field !== "date" && d.granularity) return { field: d.field };
  return d;
}

/** Keeps a definition coherent after one change (the kind, the axis, the split...). */
export function normalize(spec: ChartSpec): ChartSpec {
  let s: ChartSpec =
    spec.kind === "number"
      ? { ...spec, x: null, split: null, top: null, drilldown: false, sort: "auto" }
      : { ...spec, x: withGranularity(spec.x ?? defaultX(spec.kind)) };
  if (!SPLIT_KINDS.has(s.kind) && s.split) s = { ...s, split: null };
  if (s.kind === "stacked_bar" && !s.split) {
    s = { ...s, split: { field: s.x?.field === "group" ? "category" : "group" } };
  }
  const split = withGranularity(s.split);
  if (split) {
    const x = s.x;
    const clash =
      x != null &&
      x.field === split.field &&
      (x.granularity ?? null) === (split.granularity ?? null);
    s = {
      ...s,
      split: clash ? { field: split.field === "group" ? "category" : "group" } : split,
      compare: "none",
    };
  }
  if (s.kind === "donut" && s.compare !== "none") s = { ...s, compare: "none" };
  if (s.x?.field === "date" && s.top != null) s = { ...s, top: null };
  const p = s.period;
  const period: Period =
    p.kind === "last_months"
      ? { kind: p.kind, months: p.months ?? 12 }
      : p.kind === "last_days"
        ? { kind: p.kind, days: p.days ?? 30 }
        : p.kind === "range"
          ? { kind: p.kind, start: p.start ?? null, end: p.end ?? null }
          : { kind: p.kind };
  return { ...s, period };
}

export const OPS = [
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
] as const;

/** Ops whose values are a list of options ("es", "empieza por"); the others take a text, a number or nothing. */
export const LIST_OPS = new Set(["in", "not_in", "prefix", "not_prefix"]);

export function opLabel(t: T, field: string, op: string): string {
  if (field === "amount" && (op === "gte" || op === "lte")) return t(`op.amount.${op}`);
  if (field === "category" && (op === "prefix" || op === "not_prefix"))
    return t(`op.category.${op}`);
  return (OPS as readonly string[]).includes(op) ? t(`op.${op}`) : op;
}

export const needsValues = (op: string) => op !== "empty" && op !== "not_empty";

/** A new filter on `field` with its first operation. */
export const newRule = (field: string, catalog: ChartCatalog): ChartFilterRule => ({
  field,
  op: catalog.fields.find((f) => f.id === field)?.ops[0] ?? "in",
  values: [],
});

export function periodLabel(t: T, p: Period): string {
  switch (p.kind) {
    case "last_months":
      return t("period.last_months", { n: p.months ?? 12 });
    case "last_days":
      return t("period.last_days", { n: p.days ?? 30 });
    case "range":
      return t("period.range", { start: p.start ?? "?", end: p.end ?? "?" });
    case "this_month":
    case "last_month":
    case "this_year":
    case "last_year":
    case "all":
      return t(`period.${p.kind}`);
    default:
      return p.kind;
  }
}

/** One line for the chart list: "Barras · Gasto · por mes · Últimos 12 meses · 2 filtros". */
export function describe(t: T, spec: ChartSpec, catalog: ChartCatalog | null): string {
  const label = (items: { id: string; label: string }[] | undefined, id: string) =>
    items?.find((i) => i.id === id)?.label ?? id;
  const parts = [label(catalog?.kinds, spec.kind), label(catalog?.measures, spec.measure)];
  if (spec.x) {
    const field = catalog?.fields.find((f) => f.id === spec.x?.field)?.label ?? spec.x.field;
    const by =
      spec.x.field === "date"
        ? label(catalog?.granularities, spec.x.granularity ?? "month")
        : field;
    parts.push(t("describe.by", { what: by.toLowerCase() }));
  }
  if (spec.split) {
    const field =
      catalog?.fields.find((f) => f.id === spec.split?.field)?.label ?? spec.split.field;
    parts.push(t("describe.series", { what: field.toLowerCase() }));
  }
  parts.push(periodLabel(t, spec.period));
  if (spec.compare !== "none") parts.push(label(catalog?.compares, spec.compare).toLowerCase());
  if (spec.filters.length) parts.push(t("describe.filters", { n: spec.filters.length }));
  return parts.join(" · ");
}
