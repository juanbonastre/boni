import type { Label, Sensitivity } from "./label.ts";

/**
 * Types, fields and entities (docs/nucleo.md, 4.1). Plain serialisable data: the store keeps it,
 * exports write it out, and the agent changes it only through schema operations (ops.ts).
 * Values are kept by field id, never by key or name, so renaming a field touches no value.
 */

export type FieldType =
  | "text"
  | "longtext" // Markdown
  | "number"
  | "money" // { amount, currency }
  | "select"
  | "multiselect"
  | "checkbox"
  | "date" // "YYYY-MM-DD"
  | "time" // "HH:MM"
  | "datetime" // ISO 8601 instant with Z or an offset
  | "dates" // list of "YYYY-MM-DD"
  | "duration" // whole minutes
  | "url"
  | "email"
  | "phone"
  | "relation" // id of an entity of `relation.target` (a list when `many`)
  | "file"; // sha256 of an attachment, never a URL

export const FIELD_TYPES: readonly FieldType[] = [
  "text",
  "longtext",
  "number",
  "money",
  "select",
  "multiselect",
  "checkbox",
  "date",
  "time",
  "datetime",
  "dates",
  "duration",
  "url",
  "email",
  "phone",
  "relation",
  "file",
];

export type TypeId = string;
export type FieldId = string;
export type EntityId = string;

export interface SelectOption {
  id: string;
  name: string;
  color?: string;
  /** Where the option's name came from (an option made from an e-mail is external text). */
  label: Label;
}

export interface FieldDef {
  id: FieldId;
  /** ASCII, for exports and for the agent ("autor"); can be renamed. */
  key: string;
  /** What Juan reads ("Autor"). */
  name: string;
  type: FieldType;
  options?: SelectOption[];
  relation?: { target: TypeId; many: boolean; inverse?: FieldId };
  /** The least sensitivity of its values (an amount of money is sensitive). */
  sensitivity?: Sensitivity;
  /** Imported keys that are kept but not shown. */
  hidden?: boolean;
  archived?: boolean;
  /** Where the field's key and name came from. */
  label: Label;
}

export interface TypeDef {
  id: TypeId;
  key: string;
  name: string;
  icon?: string;
  fields: FieldDef[];
  titleField: FieldId;
  /** Default sensitivity of its entities (movements: sensitive; people: personal). */
  sensitivity: Sensitivity;
  /** Describes other people: never in a report that leaves. */
  thirdParty?: boolean;
  /** Goes up with every schema change. */
  schemaVersion: number;
  /**
   * What goes in it, in a few words (docs/clases.md §2.9): it replaces a folder's README. The user reads it on the
   * collection's page and Boni's MCP gives it to assistants; the planner does not see it (its text may come from a
   * model).
   */
  description?: { text: string; label: Label };
  /** Boni's own types (memory, proposal, job, miniapp, view): the agent cannot change them. */
  system?: boolean;
  archived?: boolean;
  /** Where the type's key and name came from. */
  label: Label;
}

export interface Money {
  amount: number;
  currency: string;
}

export type Value = string | number | boolean | string[] | Money | null;

export interface Entity {
  id: EntityId;
  type: TypeId;
  values: Record<FieldId, Value>;
  /** Free text (Markdown), as the body of a note. */
  body?: string;
  created: number;
  updated: number;
  /** Goes up with every change (optimistic concurrency). */
  version: number;
  /** In the trash since then (Undo restores it). */
  deleted?: number;
}

export interface Schema {
  types: Readonly<Record<TypeId, TypeDef>>;
}

/** Ids of Boni's own types. */
export const SYSTEM_TYPES = [
  "memory",
  "proposal",
  "job",
  "miniapp",
  "view",
  "extension",
  "page",
] as const;

/** A collection's description is a few lines, never a document. */
export const MAX_DESCRIPTION = 2000;

const ID = /^[a-z][a-z0-9_]{1,63}$/;
/** ASCII only: keys are matched literally by other tools (vault conventions). */
const KEY = /^[a-z][a-z0-9_-]{0,39}$/;

/** Problems of a type definition within `schema` (empty when it is fine). */
export function typeErrors(def: TypeDef, schema: Schema): string[] {
  const errors: string[] = [];
  if (!ID.test(def.id)) errors.push(`type id "${def.id}": lowercase letters, digits and _`);
  if (!KEY.test(def.key))
    errors.push(`type key "${def.key}": lowercase ASCII letters, digits, - and _`);
  if (!def.name.trim() || def.name.length > 80) errors.push("type name: 1 to 80 characters");
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const f of def.fields) {
    const where = `field "${f.key}"`;
    if (!ID.test(f.id)) errors.push(`${where}: bad id "${f.id}"`);
    if (!KEY.test(f.key))
      errors.push(`${where}: key must be lowercase ASCII letters, digits, - and _`);
    if (!f.name.trim() || f.name.length > 80) errors.push(`${where}: name of 1 to 80 characters`);
    if (ids.has(f.id)) errors.push(`${where}: id "${f.id}" used twice`);
    if (keys.has(f.key)) errors.push(`${where}: key used twice`);
    ids.add(f.id);
    keys.add(f.key);
    if (!FIELD_TYPES.includes(f.type)) errors.push(`${where}: unknown type "${String(f.type)}"`);
    if (f.type === "select" || f.type === "multiselect") {
      const opts = f.options ?? [];
      if (opts.length === 0) errors.push(`${where}: a ${f.type} needs options`);
      if (new Set(opts.map((o) => o.id)).size !== opts.length)
        errors.push(`${where}: option ids repeat`);
    } else if (f.options) errors.push(`${where}: only select fields have options`);
    if (f.type === "relation") {
      const target = f.relation?.target;
      if (!target) errors.push(`${where}: a relation needs a target type`);
      else if (target !== def.id && !schema.types[target])
        errors.push(`${where}: unknown target "${target}"`);
    } else if (f.relation) errors.push(`${where}: only relation fields have a target`);
  }
  if (def.description) {
    const n = def.description.text.trim().length;
    if (!n || def.description.text.length > MAX_DESCRIPTION)
      errors.push(`description: 1 to ${MAX_DESCRIPTION} characters`);
  }
  const title = def.fields.find((f) => f.id === def.titleField);
  if (!title) errors.push(`titleField "${def.titleField}" is not a field`);
  else if (title.type !== "text") errors.push("the title field must be text");
  else if (title.archived) errors.push("the title field cannot be archived");
  return errors;
}

export const fieldOf = (def: TypeDef, id: FieldId) => def.fields.find((f) => f.id === id);
