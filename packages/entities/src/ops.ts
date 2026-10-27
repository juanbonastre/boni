import type { Label } from "./label.ts";
import {
  type FieldDef,
  type FieldType,
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
  | { op: "remove_field"; type: TypeId; field: string } // the inverse of add_field
  | { op: "rename_field"; type: TypeId; field: string; key: string; name: string; label: Label }
  | {
      op: "change_field_type";
      type: TypeId;
      field: string;
      to: FieldType;
      options?: SelectOption[];
    }
  | { op: "set_options"; type: TypeId; field: string; options: SelectOption[] }
  | { op: "archive_field"; type: TypeId; field: string; archived: boolean };

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

/** `def` changed by `change`, with its schemaVersion one up, checked against `schema`. */
function update(
  schema: Schema,
  def: TypeDef,
  change: (d: TypeDef) => TypeDef,
  inverse: SchemaOp,
): OpResult {
  const next = { ...change(def), schemaVersion: def.schemaVersion + 1 };
  const errors = typeErrors(next, schema);
  return errors.length
    ? fail(errors.join("; "))
    : { ok: true, schema: withType(schema, next), inverse };
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
    const def = { ...op.type, schemaVersion: 1 };
    const errors = typeErrors(def, schema);
    return errors.length
      ? fail(errors.join("; "))
      : { ok: true, schema: withType(schema, def), inverse: { op: "remove_type", type: def.id } };
  }

  const def = schema.types[op.type];
  if (!def) return fail(`unknown type "${op.type}"`);

  switch (op.op) {
    case "remove_type": {
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
    case "add_field":
      if (def.fields.some((f) => f.id === op.field.id))
        return fail(`field "${op.field.id}" already exists`);
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
        },
      );
  }

  const field = def.fields.find((f) => f.id === op.field);
  if (!field) return fail(`unknown field "${op.field}" in "${def.id}"`);
  switch (op.op) {
    case "remove_field":
      if (def.titleField === field.id) return fail("the title field cannot be removed");
      return update(
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
