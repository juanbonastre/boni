/**
 * What a turn's screen replies (F9, docs/sistema.md §4.7) ask of the app, read as the code gave them: Boni's filter of
 * a collection and the keys it lights. Nothing from outside chooses either; text from a model stays text.
 */
import { type DatabaseFilter, FILTER_OPS } from "@boni/views";
import type { DataType, Painted, Reply } from "./agent.ts";

export const typeOfKey = (key: string | null, types: readonly DataType[] | null) =>
  key ? types?.find((x) => x.key === key || `type_${x.id}` === key) : undefined;

/**
 * A «filter» reply (F9, `screen.filter`): the collection and its rules as the server made them from the store (by
 * ids), each checked against the collection; null when anything in it came from outside or is not a rule of it.
 */
export function filterOf(
  r: Reply,
  types: readonly DataType[] | null,
): { type: DataType; rules: DatabaseFilter[]; caption: string | null } | null {
  const d = r.data;
  const outside = (p: Painted | undefined) =>
    !p || p.integrity === "external" || p.integrity === "ambient";
  const key =
    d.collection?.t === "v" && typeof d.collection.value === "string" ? d.collection.value : null;
  const type = typeOfKey(key, types);
  if (!type || outside(d.collection) || outside(d.rules) || d.rules?.t !== "v") return null;
  const raw = d.rules.value;
  if (!Array.isArray(raw) || !raw.length || raw.length > 10) return null;
  const rules: DatabaseFilter[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") return null;
    const rule = x as { field?: unknown; op?: unknown; value?: unknown };
    if (typeof rule.field !== "string" || !type.fields.some((f) => f.id === rule.field))
      return null;
    if (typeof rule.op !== "string" || !(FILTER_OPS as readonly string[]).includes(rule.op))
      return null;
    const v = rule.value;
    if (v !== undefined && typeof v !== "string" && typeof v !== "number") return null;
    rules.push({
      field: rule.field,
      op: rule.op as DatabaseFilter["op"],
      ...(v === undefined ? {} : { value: v }),
    });
  }
  const caption =
    d.caption?.t === "v" && typeof d.caption.value === "string" ? d.caption.value : null;
  return { type, rules, caption };
}

/** The keys a «highlight» or «scroll» reply lights (`pointKey`'s): only the code's own, as the server gave them. */
export function litKeys(r: Reply): string[] {
  const at = r.data.at;
  if (at?.t !== "list") return [];
  return at.items
    .map((x) =>
      x.t === "v" && x.integrity === "own" && typeof x.value === "string" ? x.value : null,
    )
    .filter((x): x is string => !!x && x.length <= 200)
    .slice(0, 20);
}
/** The names a «highlight» or «scroll» reply says, as painted (plain text). */
export function litNames(r: Reply): string[] {
  const names = r.data.names;
  if (names?.t !== "list") return [];
  return names.items
    .map((x) => (x.t === "v" && typeof x.value === "string" ? x.value : null))
    .filter((x): x is string => !!x);
}
