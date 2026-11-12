import { spanOf } from "./dates.ts";
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

/** A rule; with `refs` (a page's table), its value may come `from` a control of the page instead. */
const ruleOk = (r: unknown, refs = false): boolean =>
  isObj(r) &&
  Object.keys(r).every(
    (k) => k === "field" || k === "op" || k === "value" || (refs && k === "from"),
  ) &&
  (r.from === undefined ||
    (typeof r.from === "string" && ID.test(r.from) && r.value === undefined)) &&
  typeof r.field === "string" &&
  ID.test(r.field) &&
  (FILTER_OPS as readonly unknown[]).includes(r.op) &&
  (r.value === undefined ||
    (typeof r.value === "string" && r.value.length <= 200) ||
    (typeof r.value === "number" && Number.isFinite(r.value)));

/** A group: «y» or «o» and one or more rules, one level deep (no group inside a group), closed shape. */
const groupOk = (g: unknown, refs = false): boolean =>
  isObj(g) &&
  Object.keys(g).every((k) => k === "join" || k === "rules") &&
  (g.join === "and" || g.join === "or") &&
  Array.isArray(g.rules) &&
  g.rules.length > 0 &&
  g.rules.every((r) => ruleOk(r, refs));

/**
 * Problems with a filter: a list of rules and groups (at most 20 rules in all, closed shape); empty when fine. Only a
 * page's table (`refs`) may take a rule's value `from` a control of its page; a saved view or a protection rule never.
 */
export function filterErrors(x: unknown, refs = false): string[] {
  if (!Array.isArray(x)) return ["not a list"];
  const n = x.reduce<number>(
    (sum, r) => sum + (isObj(r) && Array.isArray(r.rules) ? r.rules.length : 1),
    0,
  );
  if (n > MAX_RULES) return [`more than ${MAX_RULES} rules`];
  return x.flatMap((r, i) =>
    isObj(r) && "rules" in r
      ? groupOk(r, refs)
        ? []
        : [`group ${i}: bad shape`]
      : ruleOk(r, refs)
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
    // A rule whose value comes from a page's control is read with it (`rulesWithValues`); alone, it filters nothing.
    if (r.from !== undefined) return undefined;
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

/** The operators that need no value: a rule with one of them never waits for its value. */
const NO_VALUE: ReadonlySet<string> = new Set(["empty", "not_empty", "checked", "unchecked"]);

/**
 * The rules that filter now: a rule still waiting for its value filters nothing, as in Notion (one just added from
 * the bar), in a group too; a group left with none is left out. The app and the server read a table's rules with it.
 */
export function liveRules(items: readonly FilterItem[] | undefined): FilterItem[] {
  const waiting = (r: DatabaseFilter) =>
    !NO_VALUE.has(r.op) && r.from === undefined && (r.value === undefined || r.value === "");
  return (items ?? []).flatMap((r): FilterItem[] => {
    if (!isFilterGroup(r)) return waiting(r) ? [] : [r];
    const kept = r.rules.filter((x) => !waiting(x));
    return kept.length ? [{ ...r, rules: kept }] : [];
  });
}

/** The records a relation points to (one or many), by id. */
const pointed = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : v == null || v === "" ? [] : [String(v)];

function matchesRule(v: unknown, type: string, r: DatabaseFilter, today: string): boolean {
  const want = r.value === "today" ? today : r.value;
  const empty = v == null || v === "" || (Array.isArray(v) && v.length === 0);
  // A relation is or is not a record (the value a page's control holds: docs/sistema.md §4.6): one of those it points
  // to, folded as any «is» (the MCP compares the titles it shows, an id folds to itself).
  if (type === "relation" && (r.op === "is" || r.op === "is_not"))
    return pointed(v).map(fold).includes(fold(want)) === (r.op === "is");
  // A date against a month or a period (a page's value): in its days, before its first, after its last.
  const span = type === "date" || type === "datetime" ? spanOf(want) : null;
  if (span && (r.op === "is" || r.op === "before" || r.op === "after")) {
    if (typeof v !== "string") return false;
    const d = v.slice(0, 10);
    return r.op === "is"
      ? d >= span.start && d <= span.end
      : r.op === "before"
        ? d < span.start
        : d > span.end;
  }
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
