import { fieldName, neutralize } from "@boni/agent";
import type { PropValue } from "@boni/calendar";
import {
  checkValue,
  type FieldDef,
  type Integrity,
  type Label,
  type TypeDef,
  type Value,
} from "@boni/entities";
import type { StoredEntity } from "@boni/store";
import { HASH_FIELD, PATH_FIELD } from "@boni/vault-import";
import type { MirroredType } from "./state.ts";

/**
 * An entity as the properties and body of its note, and back (docs/nucleo.md 9.2). What Markdown cannot
 * hold is left out and named in `boni_omitted`; Boni is never trimmed to fit the mirror (9.4). Text whose
 * integrity is `model` or `external` is written with its remote resources neutralized (P17): Obsidian
 * loads `![](https://…)` by itself, and other agents read the vault. `boni_integrity` tells them how far
 * to trust the note.
 */
export const ID_KEY = "boni_id";
export const INTEGRITY_KEY = "boni_integrity";
export const OMITTED_KEY = "boni_omitted";
const OWN_KEYS = [ID_KEY, INTEGRITY_KEY, OMITTED_KEY];
/** What the note never shows: where the import kept the note's path and hash. */
const EDGE_FIELDS = new Set([PATH_FIELD, HASH_FIELD]);

const ORDER: Integrity[] = ["external", "model", "ambient", "imported", "own", "user"];
const lower = (a: Integrity, b: Integrity) => (ORDER.indexOf(b) < ORDER.indexOf(a) ? b : a);
const low = (l: Label | undefined) => l?.integrity === "model" || l?.integrity === "external";

export interface Links {
  /** The note name a related entity is linked by (`[[name]]`). */
  nameOf(entity: string): string | null;
  /** The entity of type `target` that `[[name]]` points to. */
  resolve(name: string, target: string): string | null;
}

export interface Rendered {
  props: Record<string, PropValue>;
  body: string;
  /** Field ids of the entity left out of the note (files, for now). */
  omitted: string[];
  title: string;
}

/** The fields a note shows, each with the property it is written as ("" = the file name). */
export function noteFields(type: TypeDef, m: MirroredType): { field: FieldDef; prop: string }[] {
  const used = new Set<string>(OWN_KEYS);
  const out: { field: FieldDef; prop: string }[] = [];
  for (const f of type.fields) {
    if (f.archived || EDGE_FIELDS.has(f.id) || f.type === "file") continue;
    let prop = m.props[f.id] ?? f.name;
    if (prop !== "" && used.has(prop)) prop = `${f.name} (${f.key})`;
    used.add(prop);
    out.push({ field: f, prop });
  }
  return out;
}

const optionName = (f: FieldDef, id: string) => f.options?.find((o) => o.id === id)?.name ?? id;
const optionId = (f: FieldDef, name: string) =>
  f.options?.find((o) => o.name === name || o.id === name)?.id ?? null;

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

export function render(
  s: StoredEntity,
  type: TypeDef,
  m: MirroredType,
  links: Links,
): Rendered & { integrity: Integrity } {
  const e = s.entity;
  const props: Record<string, PropValue> = {};
  let integrity: Integrity = "user";
  const omitted: string[] = [];
  for (const f of type.fields)
    if (f.type === "file" && !f.archived && e.values[f.id] != null) omitted.push(f.key);
  let title = "";
  for (const { field: f, prop } of noteFields(type, m)) {
    const v = e.values[f.id] ?? null;
    const l = s.labels[f.id];
    if (v !== null && l) integrity = lower(integrity, l.integrity);
    let p = propOf(f, v, links);
    if (low(l)) p = clean(p);
    if (f.id === type.titleField) title = typeof p === "string" ? p : String(p ?? "");
    if (prop !== "") props[prop] = p;
  }
  const bodyLabel = s.labels.$body;
  let body = e.body ?? "";
  if (body && bodyLabel) integrity = lower(integrity, bodyLabel.integrity);
  if (low(bodyLabel)) body = neutralize(body);
  props[ID_KEY] = e.id;
  props[INTEGRITY_KEY] = integrity;
  if (omitted.length) props[OMITTED_KEY] = omitted;
  return { props, body, omitted, title, integrity };
}

const clean = (p: PropValue): PropValue =>
  typeof p === "string" ? neutralize(p) : Array.isArray(p) ? p.map((x) => neutralize(x)) : p;

/** Empty in any of the ways a property can be empty. */
const empty = (v: unknown) =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
/** A link by what it points to: `[[areas/salud|Salud]]` and `[[salud]]` are the same note. */
const LINK = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/;
const scalar = (x: unknown): string => {
  const t = String(x).trim();
  const m = LINK.exec(t);
  return m ? `[[${((m[1] as string).trim().split("/").pop() ?? "").toLowerCase()}]]` : t;
};
const asSet = (v: unknown) => (Array.isArray(v) ? v : [v]).map(scalar).sort();

/**
 * Whether two property values say the same, the way the core reads them: empty is empty, lists are sets
 * (the core keeps options sorted), a one-item list is that item, a list read as text is its items joined,
 * spaces around text do not count, a link is the note it points to.
 */
export function sameProp(a: unknown, b: unknown): boolean {
  if (empty(a) || empty(b)) return empty(a) && empty(b);
  if (JSON.stringify(asSet(a)) === JSON.stringify(asSet(b))) return true;
  const joined = (v: unknown) => (Array.isArray(v) ? v.map(scalar).join(", ") : scalar(v));
  return joined(a) === joined(b);
}

/**
 * The changes that make a note's properties say what `r` says: only keys that differ, an empty value
 * stays empty (`completed:`), keys the mirror does not know (Juan's own) are kept.
 */
export function changesFor(
  current: Record<string, PropValue>,
  r: Rendered,
): Record<string, PropValue | undefined> {
  const out: Record<string, PropValue | undefined> = {};
  for (const [k, v] of Object.entries(r.props)) {
    if (sameProp(current[k], v)) continue;
    out[k] = empty(v) ? (k in current ? null : undefined) : v;
  }
  if (!(OMITTED_KEY in r.props) && OMITTED_KEY in current) out[OMITTED_KEY] = undefined;
  return out;
}

export interface Parsed {
  /** Field name (as the agent's tools take it) -> new value, for the properties that differ. */
  values: Record<string, Value>;
  /** The note's body when it differs. */
  body?: string;
  /** Properties that changed but do not fit their field (shown in the proposal, in Spanish, never applied). */
  problems: { prop: string; error: string }[];
}

function fieldValue(
  f: FieldDef,
  raw: PropValue,
  links: Links,
): { value: Value } | { error: string } {
  if (empty(raw)) return { value: null };
  const one = Array.isArray(raw) ? raw : [String(raw)];
  let v: unknown = raw;
  switch (f.type) {
    case "text":
    case "longtext":
      v = Array.isArray(raw) ? raw.join(", ") : String(raw);
      break;
    case "number":
    case "duration":
      v = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
      break;
    case "checkbox":
      v = raw === true || raw === "true" ? true : raw === false || raw === "false" ? false : raw;
      break;
    case "dates":
      v = one;
      break;
    case "select":
      v = optionId(f, String(raw));
      if (v === null) return { error: "no es una de las opciones" };
      break;
    case "multiselect": {
      const ids = one.map((n) => optionId(f, n));
      if (ids.some((x) => x === null)) return { error: "no es una de las opciones" };
      v = ids;
      break;
    }
    case "relation": {
      const target = f.relation?.target ?? "";
      const ids = one.map((s) => {
        const m = LINK.exec(s.trim());
        return m ? links.resolve((m[1] as string).trim(), target) : null;
      });
      if (ids.some((x) => x === null)) return { error: "un enlace a ninguna nota de su tipo" };
      v = f.relation?.many ? ids : ids[0];
      break;
    }
    case "money": {
      const m = /^(-?\d+(?:[.,]\d+)?)\s*([A-Z]{3})$/.exec(String(raw).trim());
      if (!m) return { error: "se espera una cantidad y una moneda (12.50 EUR)" };
      v = { amount: Number((m[1] as string).replace(",", ".")), currency: m[2] };
      break;
    }
  }
  const r = checkValue(f, v);
  return r.ok ? { value: r.value } : { error: `no encaja en el campo (${f.type})` };
}

/** What a hand edit changed: the note read against what the mirror would write (`r`). */
export function parseEdit(
  values: Record<string, PropValue>,
  body: string,
  fileName: string,
  type: TypeDef,
  m: MirroredType,
  r: Rendered,
  links: Links,
): Parsed {
  const out: Parsed = { values: {}, problems: [] };
  for (const { field: f, prop } of noteFields(type, m)) {
    const now = prop === "" ? fileName : (values[prop] ?? null);
    const was = prop === "" ? r.title : (r.props[prop] ?? null);
    if (sameProp(now, was)) continue;
    const where = prop || "(nombre)";
    if (f.hidden) {
      out.problems.push({ prop: where, error: "un campo oculto: no se cambia desde una nota" });
      continue;
    }
    const v = fieldValue(f, now, links);
    if ("error" in v) out.problems.push({ prop: where, error: v.error });
    else out.values[fieldName(f)] = v.value;
  }
  if (body !== r.body) out.body = body;
  return out;
}
