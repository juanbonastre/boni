import type { Entity, TypeDef } from "@boni/entities";
import { type ChartSpec, type FilterRule, matches } from "./chart.ts";
import { entityProfile } from "./entities.ts";

/**
 * Declarative views (docs/nucleo.md, 8): what the agent makes and Juan edits by hand or by talking.
 * Plain data from a closed catalogue of components; never HTML or code. Opening a view or sending a
 * form never calls a model. A client that does not know a component shows "update the app".
 */
export type ViewComponent =
  | { kind: "table" | "list"; columns: string[] }
  | { kind: "kanban"; groupBy: string }
  | { kind: "calendar"; dateField: string; endField?: string }
  | { kind: "gallery"; cover?: string }
  | { kind: "chart"; dateField: string; chart: ChartSpec }
  | { kind: "number"; dateField: string; chart: ChartSpec }
  | { kind: "timeline"; start: string; end?: string }
  | { kind: "form"; fields: string[] };

export interface ViewSpec {
  id: string;
  name: string;
  version: 1;
  source: {
    type: string;
    filters?: FilterRule[];
    sort?: { field: string; desc?: boolean }[];
    limit?: number;
  };
  component: ViewComponent;
}

const KINDS = [
  "table",
  "list",
  "kanban",
  "calendar",
  "gallery",
  "chart",
  "number",
  "timeline",
  "form",
];

/** Problems of a view against the schema (empty when it is fine): every field it names must exist. */
export function viewErrors(v: ViewSpec, types: Readonly<Record<string, TypeDef>>): string[] {
  const errors: string[] = [];
  const def = types[v.source.type];
  if (!def) return [`unknown type "${v.source.type}"`];
  const has = (id: string | undefined) =>
    !id || id === "date" || def.fields.some((f) => f.id === id && !f.archived);
  const need = (id: string | undefined, what: string) => {
    if (!has(id)) errors.push(`${what}: no field "${id}" in "${def.id}"`);
  };
  if (!v.name.trim()) errors.push("a view needs a name");
  if (!KINDS.includes(v.component.kind))
    errors.push(`unknown component "${String(v.component.kind)}"`);
  for (const f of v.source.filters ?? []) need(f.field, "filter");
  for (const s of v.source.sort ?? []) need(s.field, "sort");
  if (
    v.source.limit !== undefined &&
    !(Number.isInteger(v.source.limit) && v.source.limit > 0 && v.source.limit <= 10_000)
  )
    errors.push("limit: 1 to 10000");
  const c = v.component;
  if (c.kind === "table" || c.kind === "list") for (const col of c.columns) need(col, "column");
  if (c.kind === "form") for (const col of c.fields) need(col, "form field");
  if (c.kind === "kanban") {
    need(c.groupBy, "kanban");
    const t = def.fields.find((f) => f.id === c.groupBy)?.type;
    if (t && t !== "select" && t !== "checkbox")
      errors.push("kanban: group by a select or a checkbox");
  }
  if (c.kind === "calendar") {
    need(c.dateField, "calendar");
    need(c.endField, "calendar end");
  }
  if (c.kind === "timeline") {
    need(c.start, "timeline");
    need(c.end, "timeline end");
  }
  if (c.kind === "gallery") need(c.cover, "gallery cover");
  if (c.kind === "chart" || c.kind === "number") {
    need(c.dateField, "chart date");
    need(c.chart.x?.field, "chart axis");
    need(c.chart.split?.field, "chart series");
  }
  return errors;
}

/** The entities a (non-chart) view shows: its filters (the chart engine's), its order, its limit. */
export function viewRows(v: ViewSpec, def: TypeDef, entities: Entity[]): Entity[] {
  const dateField = def.fields.find((f) => f.type === "date" || f.type === "datetime")?.id ?? "";
  const p = entityProfile(def, { dateField });
  let rows = entities.filter(
    (e) =>
      e.type === def.id &&
      e.deleted === undefined &&
      (v.source.filters ?? []).every((f) => matches(p, e, f)),
  );
  const sort = v.source.sort ?? [];
  if (sort.length) {
    const key = (e: Entity, id: string) => {
      const x = e.values[id];
      return typeof x === "number" ? x : x === null || x === undefined ? null : String(x);
    };
    rows = [...rows].sort((a, b) => {
      for (const s of sort) {
        const [x, y] = [key(a, s.field), key(b, s.field)];
        if (x === y) continue;
        if (x === null) return 1; // empty last, whatever the direction
        if (y === null) return -1;
        const c = x < y ? -1 : 1;
        return s.desc ? -c : c;
      }
      return 0;
    });
  }
  return v.source.limit ? rows.slice(0, v.source.limit) : rows;
}
