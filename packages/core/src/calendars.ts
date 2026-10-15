import {
  type CalendarView,
  type Collection,
  type Column,
  mappedColumns,
  type Row,
} from "./collections.ts";
import type { CalendarDef, Project, PropertyDef, PropertyType } from "./model.ts";

/** The collection that holds the projects a `relation` column points to. */
export const PROJECTS_COLLECTION = "projects";

export const propertyToColumn = (p: PropertyDef): Column =>
  p.type === "project"
    ? { id: p.id, name: p.name, type: "relation", target: PROJECTS_COLLECTION }
    : { id: p.id, name: p.name, type: p.type, ...(p.options ? { options: p.options } : {}) };

const PROPERTY_TYPES = new Set<string>([
  "text",
  "number",
  "select",
  "multiselect",
  "checkbox",
  "date",
  "url",
]);

/** Column types the property editor does not know yet are shown as plain text. */
export function columnToProperty(c: Column): PropertyDef {
  const type: PropertyType =
    c.type === "relation"
      ? "project"
      : PROPERTY_TYPES.has(c.type)
        ? (c.type as PropertyType)
        : "text";
  return { id: c.id, name: c.name, type, ...(c.options ? { options: c.options } : {}) };
}

/** What the UI calls a calendar: the view plus its collection's name and unmapped columns. */
export function calendarDefs(
  collections: readonly Collection[],
  views: readonly CalendarView[],
): CalendarDef[] {
  const byId = new Map(collections.map((c) => [c.id, c]));
  const out: CalendarDef[] = [];
  for (const v of views) {
    const coll = byId.get(v.collectionId);
    if (!coll) continue;
    const mapped = mappedColumns(v.mapping);
    out.push({
      id: v.id,
      accountId: v.accountId,
      name: coll.name,
      color: v.color,
      visible: v.visible,
      ...(v.readOnly ? { readOnly: true } : {}),
      schema: coll.columns.filter((c) => !mapped.has(c.id)).map(columnToProperty),
    });
  }
  return out;
}

/** The collection with its free properties replaced; mapped columns stay where they are. */
export function withSchema(
  coll: Collection,
  view: CalendarView,
  schema: PropertyDef[],
): Collection {
  const mapped = mappedColumns(view.mapping);
  return {
    ...coll,
    columns: [...coll.columns.filter((c) => mapped.has(c.id)), ...schema.map(propertyToColumn)],
  };
}

export function projectsOf(rows: readonly Row[]): Project[] {
  const out: Project[] = [];
  for (const r of rows) {
    if (r.collectionId === PROJECTS_COLLECTION) {
      out.push({ id: r.id, name: typeof r.values.title === "string" ? r.values.title : "" });
    }
  }
  return out;
}
