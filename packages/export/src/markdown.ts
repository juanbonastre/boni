import { neutralize } from "@boni/agent";
import type { PropValue } from "@boni/calendar";
import type { FieldDef, Integrity, Label, TypeDef, Value } from "@boni/entities";
import type { StoredEntity } from "@boni/store";

/**
 * An entity as the properties and text of a Markdown note, for the export's `<type>/<title>.md` (Obsidian and any
 * editor open them). What Markdown cannot hold is left out and named in `boni_omitted` (attachments travel apart,
 * in files/). Text whose integrity is `model` or `external` is written with its remote resources neutralized (P17):
 * an editor loads `![](https://…)` by itself, and other programs read these notes. `boni_integrity` tells them how
 * far to trust the note. Hidden fields (where a note came from) are not written.
 */
export const ID_KEY = "boni_id";
export const INTEGRITY_KEY = "boni_integrity";
export const OMITTED_KEY = "boni_omitted";

const ORDER: Integrity[] = ["external", "model", "ambient", "imported", "own", "user"];
const lower = (a: Integrity, b: Integrity) => (ORDER.indexOf(b) < ORDER.indexOf(a) ? b : a);
const low = (l: Label | undefined) => l?.integrity === "model" || l?.integrity === "external";

export interface Links {
  /** The note name a related entity is linked by (`[[name]]`). */
  nameOf(entity: string): string | null;
}

/** A title as a file name: no characters a file system or a link refuses, at most 100 long. */
export const safeName = (title: string) =>
  title
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) || "Sin título";

/** The fields a note shows, each with the property it is written as (its name; its key too when two share it). */
function noteFields(type: TypeDef): { field: FieldDef; prop: string }[] {
  const used = new Set<string>([ID_KEY, INTEGRITY_KEY, OMITTED_KEY]);
  const out: { field: FieldDef; prop: string }[] = [];
  for (const f of type.fields) {
    if (f.archived || f.hidden || f.type === "file") continue;
    const prop = used.has(f.name) ? `${f.name} (${f.key})` : f.name;
    used.add(prop);
    out.push({ field: f, prop });
  }
  return out;
}

const optionName = (f: FieldDef, id: string) => f.options?.find((o) => o.id === id)?.name ?? id;

function propOf(f: FieldDef, v: Value, links: Links): PropValue {
  if (v === null) return null;
  switch (f.type) {
    case "select":
      return optionName(f, v as string);
    case "multiselect":
      return (v as string[]).map((id) => optionName(f, id));
    case "relation": {
      const link = (id: string) => `[[${links.nameOf(id) ?? id}]]`;
      return Array.isArray(v) ? v.map(link) : link(v as string);
    }
    case "money": {
      const m = v as { amount: number; currency: string };
      return `${m.amount} ${m.currency}`;
    }
    default:
      return v as PropValue;
  }
}

const clean = (p: PropValue): PropValue =>
  typeof p === "string" ? neutralize(p) : Array.isArray(p) ? p.map((x) => neutralize(x)) : p;

/** The note of an entity: its properties (Boni's own keys included) and its text. */
export function render(
  s: StoredEntity,
  type: TypeDef,
  links: Links,
): { props: Record<string, PropValue>; body: string } {
  const e = s.entity;
  const props: Record<string, PropValue> = {};
  let integrity: Integrity = "user";
  const omitted: string[] = [];
  for (const f of type.fields)
    if (f.type === "file" && !f.archived && e.values[f.id] != null) omitted.push(f.key);
  for (const { field: f, prop } of noteFields(type)) {
    const v = e.values[f.id] ?? null;
    const l = s.labels[f.id];
    if (v !== null && l) integrity = lower(integrity, l.integrity);
    const p = propOf(f, v, links);
    props[prop] = low(l) ? clean(p) : p;
  }
  const bodyLabel = s.labels.$body;
  let body = e.body ?? "";
  if (body && bodyLabel) integrity = lower(integrity, bodyLabel.integrity);
  if (low(bodyLabel)) body = neutralize(body);
  props[ID_KEY] = e.id;
  props[INTEGRITY_KEY] = integrity;
  if (omitted.length) props[OMITTED_KEY] = omitted;
  return { props, body };
}
