import { type DatabaseFilter, FILTER_OPS } from "./page.ts";

/**
 * Notion's filter as the core reads it: a database view shows only the rows that match every rule, and a
 * protection rule (what the AI sees of a part of a collection) applies to the rows it matches. One function for
 * both, so what Juan sees filtered is exactly what a rule protects.
 */

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Problems with a list of filter rules (at most 20, closed shape); empty when it is fine. */
export function filterErrors(x: unknown): string[] {
  if (!Array.isArray(x)) return ["not a list"];
  if (x.length > 20) return ["more than 20 rules"];
  return x.flatMap((r, i) =>
    isObj(r) &&
    Object.keys(r).every((k) => k === "field" || k === "op" || k === "value") &&
    typeof r.field === "string" &&
    ID.test(r.field) &&
    (FILTER_OPS as readonly unknown[]).includes(r.op) &&
    (r.value === undefined ||
      (typeof r.value === "string" && r.value.length <= 200) ||
      (typeof r.value === "number" && Number.isFinite(r.value)))
      ? []
      : [`rule ${i}: bad shape`],
  );
}

const fold = (v: unknown) =>
  String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/**
 * Whether a row's values match every rule. `typeOf` gives a field's type; a rule on a field that is not there
 * is left out (`ignore`, a view's way), counts as a match (`match`) or as no match (`fail`): a protection rule
 * that closes must keep closing, one that opens must stop opening. `today` is "YYYY-MM-DD" (the value "today").
 */
export function matchesFilters(
  values: Record<string, unknown>,
  typeOf: (field: string) => string | undefined,
  rules: readonly DatabaseFilter[],
  today: string,
  unknownField: "ignore" | "match" | "fail" = "ignore",
): boolean {
  for (const r of rules) {
    const type = typeOf(r.field);
    if (type === undefined) {
      if (unknownField === "fail") return false;
      continue;
    }
    if (!matchesRule(values[r.field], type, r, today)) return false;
  }
  return true;
}

function matchesRule(v: unknown, type: string, r: DatabaseFilter, today: string): boolean {
  const want = r.value === "today" ? today : r.value;
  const empty = v == null || v === "" || (Array.isArray(v) && v.length === 0);
  const num =
    typeof v === "number" ? v : isObj(v) && typeof v.amount === "number" ? v.amount : Number.NaN;
  switch (r.op) {
    case "empty":
      return empty;
    case "not_empty":
      return !empty;
    case "checked":
      return v === true;
    case "unchecked":
      return v !== true;
    case "contains":
      return Array.isArray(v) ? v.includes(String(want)) : fold(v).includes(fold(want));
    case "not_contains":
      return Array.isArray(v) ? !v.includes(String(want)) : !fold(v).includes(fold(want));
    case "is":
      return typeof v === "number"
        ? v === Number(want)
        : fold(v).slice(0, type === "datetime" ? 10 : undefined) === fold(want);
    case "is_not":
      return typeof v === "number" ? v !== Number(want) : fold(v) !== fold(want);
    case "before":
      return typeof v === "string" && v.slice(0, 10) < String(want);
    case "after":
      return typeof v === "string" && v.slice(0, 10) > String(want);
    case "gt":
      return num > Number(want);
    case "lt":
      return num < Number(want);
    default:
      return false;
  }
}
