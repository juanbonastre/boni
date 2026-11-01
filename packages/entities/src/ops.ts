import type { Label } from "./label.ts";
import { ROLE_TYPES, ROLES, type Role, type Roles, rolesOf, rolesProblem } from "./roles.ts";
import {
  branch,
  type FieldDef,
  type FieldId,
  type FieldType,
  ownFields,
  type Schema,
  type SelectOption,
  SYSTEM_TYPES,
  type TypeDef,
  type TypeId,
  typeErrors,
} from "./schema.ts";

/**
 * Schema operations (docs/nucleo.md, 4.3): the only way a schema changes, for Juan and for the agent
 * alike. Each one checks the result and returns its inverse, so every schema change can be undone by
 * applying the inverse as a new operation. Values are not touched here: the store converts or keeps
 * them (convertValue) in the same transaction and logs the before and after.
 *
 * Collections are classes (docs/clases.md): a daughter has her mother's fields as copies marked `from`, kept in step
 * here. A change to a collection reaches its whole branch; an inherited field is changed only in the collection that
 * defines it; moving a collection (`set_parent`) keeps what its new mother does not give as its own archived fields.
 */

export type SchemaOp =
  | { op: "create_type"; type: TypeDef }
  | { op: "remove_type"; type: TypeId } // the inverse of create_type; the store only allows it on an empty type
  | { op: "rename_type"; type: TypeId; key: string; name: string; label: Label }
  | { op: "archive_type"; type: TypeId; archived: boolean }
  /** What goes in the collection (`null` takes the description away). */
  | { op: "describe_type"; type: TypeId; description: { text: string; label: Label } | null }
  | {
      op: "add_field";
      type: TypeId;
      field: FieldDef /** Position (default last): undoing a removal puts it back. */;
      at?: number;
    }
  /**
   * The inverse of add_field. `restore`: the fields of the same id her daughters had of their own before her (they
   * took hers), given back to them (given only by the inverse).
   */
  | { op: "remove_field"; type: TypeId; field: string; restore?: Record<TypeId, FieldDef> }
  | { op: "rename_field"; type: TypeId; field: string; key: string; name: string; label: Label }
  | {
      op: "change_field_type";
      type: TypeId;
      field: string;
      to: FieldType;
      options?: SelectOption[];
    }
  | { op: "set_options"; type: TypeId; field: string; options: SelectOption[] }
  | { op: "archive_field"; type: TypeId; field: string; archived: boolean }
  /**
   * Moves a collection (and its branch) under another mother (`null`: the root). `own` (its own fields after the
   * move) is given only by the inverse, to put back exactly what was there.
   */
  | { op: "set_parent"; type: TypeId; parent: TypeId | null; own?: FieldDef[] }
  /**
   * The fields that play roles in the collection (roles.ts; `null` takes a role away). Its whole branch must still make
   * sense with them: a daughter plays her mother's roles.
   */
  | { op: "set_roles"; type: TypeId; roles: Partial<Record<Role, FieldId | null>> };

export type OpResult =
  | { ok: true; schema: Schema; inverse: SchemaOp }
  | { ok: false; error: string };

const fail = (error: string): OpResult => ({ ok: false, error });

export interface OpContext {
  /** Boni's own code (never the agent, never a plan): the only one that may change system types. */
  system?: boolean;
}

const isSystem = (id: string) => (SYSTEM_TYPES as readonly string[]).includes(id);

function withType(schema: Schema, def: TypeDef): Schema {
  return { types: { ...schema.types, [def.id]: def } };
}

/**
 * A daughter's fields: her mother's (as inherited copies) and then her own. The title is each record's own
 * (docs/clases.md §1): a daughter with a title field of her own keeps it and does not take her mother's. A field of
 * her own with the id of one her mother gives becomes that one (its values stay where they are: values go by id).
 */
function inherit(schema: Schema, def: TypeDef): TypeDef {
  const mother = def.parent ? schema.types[def.parent] : undefined;
  const ownTitle = ownFields(def).some((f) => f.id === def.titleField);
  const inherited = (mother?.fields ?? [])
    .filter((f) => !(ownTitle && f.id === mother?.titleField && f.id !== def.titleField))
    .map((f) => ({ ...f, from: f.from ?? mother?.id }));
  const given = new Set(inherited.map((f) => f.id));
  return {
    ...def,
    fields: [...inherited, ...ownFields(def).filter((f) => !given.has(f.id))],
  } as TypeDef;
}

/**
 * Every collection under `id` with its inherited fields made again from the new schema (a schema version up where
 * they changed), each checked.
 */
function resync(schema: Schema, id: TypeId, inverse: SchemaOp): OpResult {
  let out = schema;
  for (const t of branch(schema, id).slice(1)) {
    const def = out.types[t] as TypeDef;
    const next = inherit(out, def);
    if (JSON.stringify(next.fields) === JSON.stringify(def.fields)) continue;
    const bumped = { ...next, schemaVersion: def.schemaVersion + 1 };
    const errors = typeErrors(bumped, out);
    if (errors.length) return fail(`${t}: ${errors.join("; ")}`);
    out = withType(out, bumped);
  }
  return { ok: true, schema: out, inverse };
}

/** `def` changed by `change`, with its schemaVersion one up, checked against `schema`; its branch follows. */
function update(
  schema: Schema,
  def: TypeDef,
  change: (d: TypeDef) => TypeDef,
  inverse: SchemaOp,
): OpResult {
  const next = { ...change(def), schemaVersion: def.schemaVersion + 1 };
  const errors = typeErrors(next, schema);
  return errors.length ? fail(errors.join("; ")) : resync(withType(schema, next), def.id, inverse);
}

/** `archived: false` is written as no key at all, so archiving and restoring gives back the same data. */
function withArchived<T extends { archived?: boolean }>(x: T, archived: boolean): T {
  const { archived: _a, ...rest } = x;
  return (archived ? { ...rest, archived: true } : rest) as T;
}

const mapField = (def: TypeDef, id: string, f: (field: FieldDef) => FieldDef): TypeDef => ({
  ...def,
  fields: def.fields.map((x) => (x.id === id ? f(x) : x)),
});

export function applySchemaOp(schema: Schema, op: SchemaOp, ctx: OpContext = {}): OpResult {
  const typeId = op.op === "create_type" ? op.type.id : op.type;
  if (isSystem(typeId) && !ctx.system) return fail(`"${typeId}" is one of Boni's own types`);

  if (op.op === "create_type") {
    if (schema.types[op.type.id]) return fail(`type "${op.type.id}" already exists`);
    if (op.type.system && !ctx.system) return fail("only Boni's code makes system types");
    if (op.type.fields.some((f) => f.from)) return fail("a new collection's fields are its own");
    const def = inherit(schema, { ...op.type, schemaVersion: 1 });
    const errors = typeErrors(def, schema);
    return errors.length
      ? fail(errors.join("; "))
      : { ok: true, schema: withType(schema, def), inverse: { op: "remove_type", type: def.id } };
  }

  const def = schema.types[op.type];
  if (!def) return fail(`unknown type "${op.type}"`);

  switch (op.op) {
    case "remove_type": {
      const daughters = Object.values(schema.types).filter((t) => t.parent === def.id);
      if (daughters.length)
        return fail(`"${def.id}" has collections inside: ${daughters.map((t) => t.id).join(", ")}`);
      const users = Object.values(schema.types).filter(
        (t) => t.id !== def.id && t.fields.some((f) => f.relation?.target === def.id),
      );
      if (users.length)
        return fail(
          `"${def.id}" is the target of relations in ${users.map((t) => t.id).join(", ")}`,
        );
      const { [def.id]: _gone, ...rest } = schema.types;
      return { ok: true, schema: { types: rest }, inverse: { op: "create_type", type: def } };
    }
    case "rename_type":
      return update(schema, def, (d) => ({ ...d, key: op.key, name: op.name, label: op.label }), {
        op: "rename_type",
        type: def.id,
        key: def.key,
        name: def.name,
        label: def.label,
      });
    case "archive_type":
      return update(schema, def, (d) => withArchived(d, op.archived), {
        op: "archive_type",
        type: def.id,
        archived: !!def.archived,
      });
    case "describe_type":
      return update(
        schema,
        def,
        (d) => {
          const { description: _d, ...rest } = d;
          return op.description ? { ...rest, description: op.description } : rest;
        },
        { op: "describe_type", type: def.id, description: def.description ?? null },
      );
    case "set_roles": {
      const own: Roles = { ...(def.roles ?? {}) };
      const back: Partial<Record<Role, FieldId | null>> = {};
      for (const [r, f] of Object.entries(op.roles) as [Role, FieldId | null][]) {
        if (!ROLES.includes(r)) return fail(`unknown role "${r}"`);
        back[r] = def.roles?.[r] ?? null;
        if (f === null) {
          delete own[r];
          continue;
        }
        const field = def.fields.find((x) => x.id === f && !x.archived);
        if (!field) return fail(`role "${r}": no field "${f}"`);
        if (!ROLE_TYPES[r].includes(field.type))
          return fail(`role "${r}" takes ${ROLE_TYPES[r].join(" or ")}, not ${field.type}`);
        own[r] = f;
      }
      const next = update(
        schema,
        def,
        (d) => {
          const { roles: _r, ...rest } = d;
          return Object.keys(own).length ? { ...rest, roles: own } : rest;
        },
        { op: "set_roles", type: def.id, roles: back },
      );
      if (!next.ok) return next;
      // Every collection of the branch, with what it plays now, still makes sense.
      for (const t of branch(next.schema, def.id)) {
        const problem = rolesProblem(rolesOf(next.schema, t));
        if (problem) return fail(t === def.id ? problem : `${t}: ${problem}`);
      }
      return next;
    }
    case "set_parent": {
      const parent = op.parent ?? undefined;
      if (parent && !schema.types[parent]) return fail(`unknown mother "${parent}"`);
      if (parent && branch(schema, def.id).includes(parent))
        return fail("a collection cannot go inside its own branch");
      // A field she has with the id of one the new mother gives becomes that one: only when it holds the same kind.
      for (const f of parent ? (schema.types[parent]?.fields ?? []) : []) {
        const mine = ownFields(def).find((x) => x.id === f.id);
        if (mine && mine.type !== f.type)
          return fail(`"${mine.name}" is a ${mine.type} here and a ${f.type} in "${parent}"`);
      }
      // What the new mother does not give stays as the collection's own field, archived (its values are kept).
      const coming = new Set((parent ? schema.types[parent]?.fields : [])?.map((f) => f.id));
      const kept = def.fields
        .filter((f) => f.from && !coming.has(f.id))
        .map((f) => {
          const { from: _f, ...own } = f;
          return f.id === def.titleField ? own : withArchived(own, true);
        });
      const { parent: _p, ...rest } = def;
      const moved: TypeDef = {
        ...rest,
        ...(parent ? { parent } : {}),
        fields: op.own ?? [...kept, ...ownFields(def)],
      };
      return update(schema, def, () => inherit(schema, moved), {
        op: "set_parent",
        type: def.id,
        parent: def.parent ?? null,
        own: ownFields(def),
      });
    }
    case "add_field": {
      if (op.field.from) return fail("a new field is the collection's own");
      if (def.fields.some((f) => f.id === op.field.id))
        return fail(`field "${op.field.id}" already exists`);
      // A daughter with a field of that id of her own takes the mother's: undone, she gets hers back.
      const restore: Record<TypeId, FieldDef> = {};
      for (const t of branch(schema, def.id).slice(1)) {
        const own = ownFields(schema.types[t] as TypeDef).find((f) => f.id === op.field.id);
        if (own) restore[t] = own;
      }
      return update(
        schema,
        def,
        (d) => {
          const fields = [...d.fields];
          fields.splice(op.at ?? fields.length, 0, op.field);
          return { ...d, fields };
        },
        {
          op: "remove_field",
          type: def.id,
          field: op.field.id,
          ...(Object.keys(restore).length ? { restore } : {}),
        },
      );
    }
  }

  const field = def.fields.find((f) => f.id === op.field);
  if (!field) return fail(`unknown field "${op.field}" in "${def.id}"`);
  if (field.from)
    return fail(`"${field.name}" is inherited from "${field.from}": it is changed there`);
  switch (op.op) {
    case "remove_field": {
      if (def.titleField === field.id) return fail("the title field cannot be removed");
      const r = update(
        schema,
        def,
        (d) => ({ ...d, fields: d.fields.filter((f) => f.id !== field.id) }),
        {
          op: "add_field",
          type: def.id,
          field,
          at: def.fields.indexOf(field),
        },
      );
      if (!r.ok || !op.restore) return r;
      let out = r.schema;
      for (const [t, own] of Object.entries(op.restore)) {
        const d = out.types[t];
        if (!d || d.fields.some((f) => f.id === own.id)) continue;
        out = withType(out, {
          ...d,
          fields: [...d.fields, own],
          schemaVersion: d.schemaVersion + 1,
        });
      }
      return { ...r, schema: out };
    }
    case "rename_field":
      return update(
        schema,
        def,
        (d) =>
          mapField(d, field.id, (f) => ({ ...f, key: op.key, name: op.name, label: op.label })),
        {
          op: "rename_field",
          type: def.id,
          field: field.id,
          key: field.key,
          name: field.name,
          label: field.label,
        },
      );
    case "change_field_type": {
      const options =
        op.to === "select" || op.to === "multiselect" ? (op.options ?? field.options) : undefined;
      return update(
        schema,
        def,
        (d) =>
          mapField(d, field.id, (f) => {
            const { options: _o, ...rest } = f;
            return options ? { ...rest, type: op.to, options } : { ...rest, type: op.to };
          }),
        {
          op: "change_field_type",
          type: def.id,
          field: field.id,
          to: field.type,
          ...(field.options ? { options: field.options } : {}),
        },
      );
    }
    case "set_options":
      if (field.type !== "select" && field.type !== "multiselect")
        return fail("only select fields have options");
      return update(
        schema,
        def,
        (d) => mapField(d, field.id, (f) => ({ ...f, options: op.options })),
        {
          op: "set_options",
          type: def.id,
          field: field.id,
          options: field.options ?? [],
        },
      );
    case "archive_field":
      return update(
        schema,
        def,
        (d) => mapField(d, field.id, (f) => withArchived(f, op.archived)),
        {
          op: "archive_field",
          type: def.id,
          field: field.id,
          archived: !!field.archived,
        },
      );
  }
}
