/**
 * What points to a record: for every collection with a relation whose target's branch holds the record's collection
 * (D-18), the records whose value names it, grouped by collection and field, and the titles of what the record itself
 * points to. Computed from the relations alone, for any collection (D-14): a person's projects, movements and debts; a
 * project's tasks and events. It takes the place of the lists Obsidian's views drew (`![[person.base]]`).
 */
import { branch } from "@boni/entities";
import type { UserStore } from "@boni/store";
import { asShown, DataError, userTypes } from "./data.ts";

export interface RelatedRow {
  id: string;
  title: string;
  /** Its first date, when its collection has one (the newest first). */
  date?: string;
}
export interface RelatedGroup {
  type: string;
  collection: string;
  icon?: string;
  field: string;
  fieldName: string;
  count: number;
  rows: RelatedRow[];
}

const MAX_ROWS = 50;

export function relatedTo(
  store: UserStore,
  id: string,
): { groups: RelatedGroup[]; titles: Record<string, string> } {
  const e = store.get(id);
  const types = userTypes(store);
  const own = e && types.find((t) => t.id === e.entity.type);
  if (!e || e.entity.deleted !== undefined || !own) throw new DataError("not-found");
  const schema = store.schema();
  const groups: RelatedGroup[] = [];
  for (const t of types) {
    const fields = t.fields.filter(
      (f) =>
        f.type === "relation" &&
        !f.archived &&
        !f.hidden &&
        branch(schema, f.relation?.target ?? "").includes(own.id),
    );
    if (!fields.length) continue;
    const date = t.fields.find((f) => f.type === "date" && !f.archived && !f.hidden);
    const entities = store.entities(t.id);
    for (const f of fields) {
      const rows: RelatedRow[] = [];
      for (const x of entities) {
        const v = x.values[f.id];
        if (v !== id && !(Array.isArray(v) && v.includes(id))) continue;
        const d = date ? x.values[date.id] : undefined;
        rows.push({
          id: x.id,
          title: String(x.values[t.titleField] ?? ""),
          ...(typeof d === "string" && d ? { date: d } : {}),
        });
      }
      if (!rows.length) continue;
      rows.sort(
        (a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.title.localeCompare(b.title),
      );
      groups.push({
        type: t.id,
        collection: t.name,
        ...(t.icon ? { icon: t.icon } : {}),
        field: f.id,
        fieldName: f.name,
        count: rows.length,
        rows: rows.slice(0, MAX_ROWS),
      });
    }
  }
  groups.sort(
    (a, b) => a.collection.localeCompare(b.collection) || a.fieldName.localeCompare(b.fieldName),
  );
  return { groups, titles: asShown(store, own, [e.entity]).titles };
}
