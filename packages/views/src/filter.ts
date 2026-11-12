import { type DatabaseFilter, FILTER_OPS, type FilterItem, isFilterGroup } from "./page.ts";

/**
 * Notion's filter as the core reads it: a database view shows only the rows that match every item (a rule, or a
 * group of rules joined by «y» or «o», Notion's advanced filter), and a protection rule (what the AI sees of a part
 * of a collection) applies to the rows it matches. One function for both, so what Juan sees filtered is exactly
 * what a rule protects.
 */

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
/** At most this many rules in a filter, its groups' counted. */
const MAX_RULES = 20;

const ruleOk = (r: unknown): boolean =>
  isObj(r) &&
  Object.keys(r).every((k) => k === "field" || k === "op" || k === "value") &&
  typeof r.field === "string" &&
  ID.test(r.field) &&
  (FILTER_OPS as readonly unknown[]).includes(r.op) &&
  (r.value === undefined ||
    (typeof r.value === "string" && r.value.length <= 200) ||
    (typeof r.value === "number" && Number.isFinite(r.value)));

/** A group: «y» or «o» and one or more rules, one level deep (no group inside a group), closed shape. */
const groupOk = (g: unknown): boolean =>
  isObj(g) &&
  Object.keys(g).every((k) => k === "join" || k === "rules") &&
  (g.join === "and" || g.join === "or") &&
  Array.isArray(g.rules) &&
  g.rules.length > 0 &&
  g.rules.every(ruleOk);

/** Problems with a filter: a list of rules and groups (at most 20 rules in all, closed shape); empty when fine. */
export function filterErrors(x: unknown): string[] {
  if (!Array.isArray(x)) return ["not a list"];
  const n = x.reduce<number>(
    (sum, r) => sum + (isObj(r) && Array.isArray(r.rules) ? r.rules.length : 1),
    0,
  );
  if (n > MAX_RULES) return [`more than ${MAX_RULES} rules`];
  return x.flatMap((r, i) =>
    isObj(r) && "rules" in r
      ? groupOk(r)
        ? []
        : [`group ${i}: bad shape`]
      : ruleOk(r)
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
 * Whether a row's values match every item: each rule, and each group (all its rules with «y», one with «o»).
 * `typeOf` gives a field's type; a rule on a field that is not there is left out (`ignore`, a view's way; a group
 * whose rules are all left out is left out), counts as a match (`match`) or as no match (`fail`): a protection rule
 * that closes must keep closing, one that opens must stop opening. `today` is "YYYY-MM-DD" (the value "today").
 */
export function matchesFilters(
  values: Record<string, unknown>,
  typeOf: (field: string) => string | undefined,
  items: readonly FilterItem[],
  today: string,
  unknownField: "ignore" | "match" | "fail" = "ignore",
): boolean {
  // true, false, or undefined when the rule is left out.
  const one = (r: DatabaseFilter): boolean | undefined => {
    const type = typeOf(r.field);
    if (type === undefined)
      return unknownField === "fail" ? false : unknownField === "match" ? true : undefined;
    return matchesRule(values[r.field], type, r, today);
  };
  for (const x of items) {
    if (!isFilterGroup(x)) {
      if (one(x) === false) return false;
      continue;
    }
    let any = false;
    let counted = false;
    for (const r of x.rules) {
      const m = one(r);
      if (m === undefined) continue;
      counted = true;
      if (x.join === "and" && !m) return false;
      if (m) any = true;
    }
    if (x.join === "or" && counted && !any) return false;
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
