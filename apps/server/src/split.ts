// The first restructurings made one calendar per value by hand (a definition each, `type` + `where`): «split» turns
// each such set into one definition split by the field (D-24), its colours kept, with a dry run first and an undo.
import type { UserStore } from "@boni/store";
import {
  CALENDAR_DEFS,
  type Stored,
  saveCalendarDefs,
  splitChoices,
  storedCalendarDefs,
} from "./calendarStore.ts";

/** Where the definitions as they were before «split --apply» are kept, for «--undo». */
export const BEFORE_SPLIT = "calendar/defs.before-split";

export interface SplitPlan {
  type: string;
  /** The collection's name: the definition's. */
  name: string;
  /** The new definition's id. */
  id: string;
  field: string;
  fieldName: string;
  members: { id: string; name: string; value: string; color: string }[];
}

const keyOf = (name: string) => {
  const k = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return /^[a-z]/.test(k) ? k : `p-${k || "x"}`;
};

/** The sets of calendars picked by hand over one field of one collection (two or more), as one split each. */
export function splitPlan(store: UserStore): SplitPlan[] {
  const schema = store.schema();
  const kept = storedCalendarDefs(store);
  const used = new Set(kept.map((s) => String(s.raw.id ?? "")));
  const sets = new Map<string, Stored[]>();
  for (const s of kept) {
    if (!s.where || s.split) continue;
    const k = `${s.type}|${s.where.field}`;
    sets.set(k, [...(sets.get(k) ?? []), s]);
  }
  const out: SplitPlan[] = [];
  for (const members of sets.values()) {
    const first = members[0];
    if (!first?.where || members.length < 2) continue;
    const t = schema.types[first.type];
    const field = t?.fields.find((f) => f.id === first.where?.field);
    if (!t || !field || !splitChoices(schema, t.id).some((c) => c.id === field.id)) continue;
    if (kept.some((s) => s.type === t.id && s.split)) continue;
    const base = keyOf(t.name);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    out.push({
      type: t.id,
      name: t.name,
      id,
      field: field.id,
      fieldName: field.name,
      members: members.map((m) => ({
        id: String(m.raw.id ?? ""),
        name: String(m.raw.name ?? ""),
        value: m.where?.orEmpty ? "" : (m.where?.value ?? ""),
        color: String(m.raw.color ?? ""),
      })),
    });
  }
  return out;
}

/** What a dry run prints: one line per set. */
export const splitLines = (plan: SplitPlan[]): string[] =>
  plan.map(
    (p) =>
      `${p.name}: ${p.members.map((m) => m.name).join(", ")} → «${p.name}», separada por «${p.fieldName}» (colores conservados; se deshace con --undo)`,
  );

/**
 * Applies a plan: each set becomes one definition (the first member's, named as the collection, with the colours by
 * value) split by the field; the definitions as they were are kept for «--undo». Returns how many sets changed.
 */
export function applySplit(store: UserStore, plan: SplitPlan[]): number {
  if (!plan.length) return 0;
  const kept = storedCalendarDefs(store);
  store.setSetting(BEFORE_SPLIT, store.setting(CALENDAR_DEFS) ?? "[]");
  let next: Stored[] = kept;
  for (const p of plan) {
    const members = kept.filter((s) => p.members.some((m) => m.id === s.raw.id));
    const first = members[0];
    if (!first) continue;
    const columns = new Map<string, unknown>();
    for (const m of members)
      for (const c of Array.isArray(m.raw.columns) ? m.raw.columns : [])
        if (c && typeof c === "object" && "id" in c && !columns.has(String(c.id)))
          columns.set(String(c.id), c);
    const { where: _w, split: _s, ...restEntry } = first;
    const {
      newNote,
      colors: _c,
      ...restRaw
    } = first.raw as Record<string, unknown> & {
      newNote?: { name?: string; body?: string; properties?: unknown };
    };
    const note =
      newNote && typeof newNote === "object"
        ? {
            ...(newNote.name ? { name: newNote.name } : {}),
            ...(newNote.body ? { body: newNote.body } : {}),
          }
        : null;
    const def: Stored = {
      ...restEntry,
      raw: {
        ...restRaw,
        id: p.id,
        name: p.name,
        columns: [...columns.values()],
        colors: Object.fromEntries(p.members.map((m) => [m.value, m.color])),
        ...(note && Object.keys(note).length ? { newNote: note } : {}),
      },
      split: { field: p.field },
    };
    next = [...next.filter((s) => !members.includes(s)), def];
  }
  saveCalendarDefs(store, next);
  return plan.length;
}

/** Puts the definitions back as they were before «--apply»; null when there is nothing to undo. */
export function undoSplit(store: UserStore): number | null {
  const before = store.setting(BEFORE_SPLIT);
  if (!before) return null;
  store.setSetting(CALENDAR_DEFS, before);
  store.setSetting(BEFORE_SPLIT, "");
  return storedCalendarDefs(store).length;
}
