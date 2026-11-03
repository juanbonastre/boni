import { type Json, plain, readStore, type Val } from "@boni/agent";
import { type FieldDef, rolesOf } from "@boni/entities";
import type { ProposalRow, UserStore } from "@boni/store";
import { taskDoneField } from "./calendarStore.ts";
import { dueField } from "./mail.ts";

/**
 * Juan's corrections to a proposal before accepting it (Juan, 2026-10-23: from the inbox's card he may rename the
 * row and change the collection it goes to; the system takes it as a prediction error and learns from it, see
 * mailReview.ts). Turned into the agent's edits by code: the title replaced; in another collection the title,
 * the note and the day move (the day to that collection's date field), and what was chosen among the first
 * collection's options does not. Null fields: nothing to change. `done` ("Ya lo hice", Juan 2026-10-23): the task
 * is made already marked done (its calendar's task column), and the reading counts as right. `values` (Juan,
 * 2026-11-02): any other property of the collection it goes to, by its field's key, checked against the field (an
 * option by its id, a relation by the id of a record of its target; null clears it).
 */
export function acceptEdits(
  store: UserStore,
  p: ProposalRow,
  req: { title?: unknown; collection?: unknown; done?: unknown; values?: unknown },
): { type?: string; values?: Record<string, Json | null> } | { error: string } {
  if (
    req.title === undefined &&
    req.collection === undefined &&
    req.done !== true &&
    req.values === undefined
  )
    return {};
  if (p.tool !== "entities.create") return { error: "edit-not-allowed" };
  const stored = (p.args as { values?: { type?: Val; values?: Val } }).values ?? {};
  const ro = readStore(store);
  const types = Object.values(ro.schema().types);
  const oldKey = stored.type ? plain(stored.type) : null;
  const old = types.find((t) => t.key === oldKey);
  const vals = (stored.values ? plain(stored.values) : {}) as Record<string, Json>;
  const titleKey =
    "title" in vals ? "title" : (old?.fields.find((f) => f.id === old.titleField)?.key ?? "title");
  const out: { type?: string; values: Record<string, Json | null> } = { values: {} };
  if (req.title !== undefined) {
    const title = typeof req.title === "string" ? req.title.replace(/\s+/g, " ").trim() : "";
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
    if (!title || [...title].length > 300 || /[\u0000-\u001f\u007f]/.test(title))
      return { error: "bad-title" };
    out.values[titleKey] = title;
  }
  if (req.collection !== undefined && req.collection !== old?.id) {
    const t = types.find((x) => x.id === req.collection);
    if (!t || t.system || t.archived) return { error: "bad-collection" };
    out.type = t.key;
    const dayKey = old?.fields.find(
      (f) => f.type === "date" && typeof vals[f.key] === "string",
    )?.key;
    for (const k of Object.keys(vals))
      if (k !== titleKey && k !== "body" && k !== "$body") out.values[k] = null;
    if (titleKey !== "title") {
      // The title goes under the name every collection has for its title field.
      out.values.title = out.values[titleKey] ?? vals[titleKey] ?? null;
      out.values[titleKey] = null;
    }
    const date = dueField(
      t,
      ro.list(t.id).map((e) => e.entity),
    );
    if (dayKey && date) out.values[date.key] = vals[dayKey] ?? null;
    // The hours go with the day, each to the field that plays its role there (task 47: a meeting corrected from
    // the events to the tasks keeps its 17:00–18:00).
    const schema = ro.schema();
    const fromRoles = old ? rolesOf(schema, old.id) : {};
    const toRoles = rolesOf(schema, t.id);
    const keyOf = (def: typeof t, fid: string | undefined) =>
      fid ? def.fields.find((f) => f.id === fid)?.key : undefined;
    for (const role of ["time", "endTime"] as const) {
      const fromKey = old ? keyOf(old, fromRoles[role]) : undefined;
      const toKey = keyOf(t, toRoles[role]);
      if (fromKey && toKey && typeof vals[fromKey] === "string") out.values[toKey] = vals[fromKey];
    }
  }
  if (req.values !== undefined) {
    if (!req.values || typeof req.values !== "object" || Array.isArray(req.values))
      return { error: "bad-values" };
    const t = types.find((x) => x.key === (out.type ?? oldKey));
    if (!t) return { error: "bad-collection" };
    for (const [k, v] of Object.entries(req.values as Record<string, unknown>)) {
      const f = t.fields.find((x) => x.key === k && !x.archived && !x.hidden);
      if (!f || f.id === t.titleField) return { error: "bad-values" };
      const value = valueFor(f, v, (type, id) => ro.list(type).some((e) => e.entity.id === id));
      if (value === undefined) return { error: "bad-values" };
      out.values[k] = value;
    }
  }
  if (req.done === true) {
    const key = out.type ?? oldKey;
    const t = types.find((x) => x.key === key);
    const done = t ? taskDoneField(store, t.id) : null;
    if (!done) return { error: "cannot-mark-done" };
    out.values[done.key] = true;
  }
  return out;
}

const TEXT = 2000;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const text = (v: unknown, max = TEXT) =>
  typeof v === "string" && [...v].length <= max && !CONTROL.test(v) ? v : undefined;

/**
 * A value Juan typed for a field, as the field keeps it, or undefined when it does not fit: text within bounds,
 * a finite number, a day or a time in their forms, an option by its id, a record of the relation's target by its
 * id (one, or a list when it takes many). Null clears the field. A file never comes this way.
 */
export function valueFor(
  f: FieldDef,
  v: unknown,
  exists: (type: string, id: string) => boolean,
): Json | null | undefined {
  if (v === null) return null;
  switch (f.type) {
    case "text":
    case "longtext":
    case "url":
    case "email":
    case "phone":
      return text(v);
    case "number":
    case "duration":
      return typeof v === "number" && Number.isFinite(v) ? v : undefined;
    case "checkbox":
      return typeof v === "boolean" ? v : undefined;
    case "date":
      return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
    case "time":
      return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : undefined;
    case "datetime":
      return typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v))
        ? v
        : undefined;
    case "select":
      return typeof v === "string" && f.options?.some((o) => o.id === v) ? v : undefined;
    case "multiselect":
      return Array.isArray(v) &&
        v.length <= 100 &&
        v.every((x) => typeof x === "string" && f.options?.some((o) => o.id === x))
        ? (v as string[])
        : undefined;
    case "money":
      return v &&
        typeof v === "object" &&
        typeof (v as { amount?: unknown }).amount === "number" &&
        Number.isFinite((v as { amount: number }).amount) &&
        typeof (v as { currency?: unknown }).currency === "string" &&
        (v as { currency: string }).currency.length <= 3
        ? {
            amount: (v as { amount: number }).amount,
            currency: (v as { currency: string }).currency,
          }
        : undefined;
    case "relation": {
      const target = f.relation?.target;
      if (!target) return undefined;
      const ids = Array.isArray(v) ? v : [v];
      if (ids.length > 100 || !ids.every((x) => typeof x === "string" && exists(target, x)))
        return undefined;
      if (f.relation?.many) return ids as string[];
      return ids.length === 1 ? (ids[0] as string) : undefined;
    }
    default:
      return undefined;
  }
}
