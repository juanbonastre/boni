// A table's calculation under a column and its rows grouped by a column (task 76; Notion's «Calcular» and «Agrupar»): what each kind of column can calculate, the result over the rows the view shows, and the groups in their order.
import type { Calc } from "@boni/views";
import type { DataField, DataRow, DataValue } from "./agent.ts";

const NUMBERS = new Set(["number", "money", "duration"]);
const DATES = new Set(["date", "datetime"]);
const BY_COUNT: readonly Calc[] = [
  "count",
  "filled",
  "empty",
  "unique",
  "percentFilled",
  "percentEmpty",
];

/** The calculations a column offers, in Notion's order: every column counts; numbers, dates and boxes have theirs. */
export function calcsFor(field: DataField): readonly Calc[] {
  if (field.type === "checkbox") return ["count", "checked", "unchecked", "percentChecked"];
  if (NUMBERS.has(field.type))
    return [...BY_COUNT, "sum", "average", "median", "min", "max", "range"];
  if (DATES.has(field.type)) return [...BY_COUNT, "earliest", "latest", "range"];
  return BY_COUNT;
}

/** What a calculation gives: a count, a percentage, a number of the column's kind, a date, or a span of days. */
export type CalcResult =
  | { kind: "count"; n: number }
  | { kind: "percent"; n: number }
  | { kind: "number"; n: number; currency?: string }
  | { kind: "date"; value: string }
  | { kind: "days"; n: number }
  | null;

const isEmpty = (v: DataValue | undefined) =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
const amountOf = (v: DataValue | undefined): number | null =>
  typeof v === "number"
    ? v
    : v && typeof v === "object" && !Array.isArray(v) && typeof v.amount === "number"
      ? v.amount
      : null;
const DAY = 86_400_000;
// Loops, not Math.max(...xs): spreading a very long list overflows the stack.
const most = (xs: number[]) => xs.reduce((a, b) => (b > a ? b : a), Number.NEGATIVE_INFINITY);
const least = (xs: number[]) => xs.reduce((a, b) => (b < a ? b : a), Number.POSITIVE_INFINITY);
const timeOf = (field: DataField, v: string) =>
  Date.parse(field.type === "date" ? `${v.slice(0, 10)}T12:00:00Z` : v);

/** A column's calculation over the rows (in one pass for counts; numbers and dates sorted once). Null: nothing. */
export function calcValue(calc: Calc, field: DataField, rows: readonly DataRow[]): CalcResult {
  const total = rows.length;
  const values = rows.map((r) => r.values[field.id]);
  const pct = (n: number) => ({ kind: "percent" as const, n: total ? (n / total) * 100 : 0 });
  switch (calc) {
    case "count":
      return { kind: "count", n: total };
    case "filled":
    case "empty":
    case "percentFilled":
    case "percentEmpty": {
      const empty = values.filter(isEmpty).length;
      if (calc === "filled") return { kind: "count", n: total - empty };
      if (calc === "empty") return { kind: "count", n: empty };
      return pct(calc === "percentEmpty" ? empty : total - empty);
    }
    case "unique": {
      const seen = new Set<string>();
      for (const v of values) {
        if (isEmpty(v)) continue;
        for (const x of Array.isArray(v) ? v : [v]) seen.add(JSON.stringify(x));
      }
      return { kind: "count", n: seen.size };
    }
    case "checked":
    case "unchecked":
    case "percentChecked": {
      const on = values.filter((v) => v === true).length;
      if (calc === "checked") return { kind: "count", n: on };
      if (calc === "unchecked") return { kind: "count", n: total - on };
      return pct(on);
    }
    case "earliest":
    case "latest": {
      let best: string | null = null;
      let at = 0;
      for (const v of values) {
        if (typeof v !== "string" || !v) continue;
        const t = timeOf(field, v);
        if (Number.isNaN(t)) continue;
        if (best === null || (calc === "earliest" ? t < at : t > at)) {
          best = v;
          at = t;
        }
      }
      return best === null ? null : { kind: "date", value: best };
    }
    default:
      break;
  }
  if (DATES.has(field.type) && calc === "range") {
    const times = values
      .filter((v): v is string => typeof v === "string" && !!v)
      .map((v) => timeOf(field, v))
      .filter((t) => !Number.isNaN(t));
    if (!times.length) return null;
    return { kind: "days", n: Math.round((most(times) - least(times)) / DAY) };
  }
  const nums: number[] = [];
  let currency: string | undefined;
  for (const v of values) {
    const n = amountOf(v);
    if (n === null) continue;
    nums.push(n);
    if (v && typeof v === "object" && !Array.isArray(v)) currency ??= v.currency;
  }
  if (!nums.length) return null;
  const num = (n: number) => ({ kind: "number" as const, n, ...(currency ? { currency } : {}) });
  const sum = nums.reduce((a, b) => a + b, 0);
  switch (calc) {
    case "sum":
      return num(sum);
    case "average":
      return num(sum / nums.length);
    case "median": {
      const s = [...nums].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return num(s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2);
    }
    case "min":
      return num(least(nums));
    case "max":
      return num(most(nums));
    case "range":
      return num(most(nums) - least(nums));
    default:
      return null;
  }
}

/** Whether a table can be grouped by a column (anything but a long text). */
export const groupable = (field: DataField) => field.type !== "longtext";

/**
 * A table's rows grouped by a column (Notion's «Agrupar»), each group in the rows' order: a list's by its options'
 * order, a box ticked first, a relation's by the titles it points to, anything else by its value; the rows without
 * one last. A row with several values (a multiple list, a relation to many) is in each of their groups, as Notion's.
 * `key` is the value (an option's id, a related row's id, the text), "" for the rows without one.
 */
export function groupRows(
  rows: readonly DataRow[],
  field: DataField,
  titles: Record<string, string> = {},
): { key: string; rows: DataRow[] }[] {
  const groups = new Map<string, DataRow[]>();
  const put = (key: string, r: DataRow) => {
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  };
  for (const r of rows) {
    const v = r.values[field.id];
    if (field.type === "checkbox") put(v === true ? "true" : "false", r);
    else if (isEmpty(v)) put("", r);
    else if (Array.isArray(v)) for (const x of new Set(v)) put(x, r);
    else if (v && typeof v === "object") put(String(v.amount), r);
    else put(String(v), r);
  }
  const options = field.options?.map((o) => o.id) ?? [];
  const rank = (k: string) => {
    if (field.type === "checkbox") return k === "true" ? 0 : 1;
    const i = options.indexOf(k);
    return i < 0 ? options.length : i;
  };
  const numeric = NUMBERS.has(field.type);
  const text = (k: string) => (field.relation ? (titles[k] ?? k) : k).toLocaleLowerCase();
  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (field.type !== "checkbox" && (a === "" || b === "")) return a === "" ? 1 : -1;
      const r = rank(a) - rank(b);
      if (r) return r;
      if (numeric) return Number(a) - Number(b);
      return text(a) < text(b) ? -1 : text(a) > text(b) ? 1 : 0;
    })
    .map(([key, rows]) => ({ key, rows }));
}
