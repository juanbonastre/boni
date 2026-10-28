import { describe, expect, it } from "vitest";
import { label } from "./label.ts";
import { applySchemaOp, type SchemaOp } from "./ops.ts";
import { rng } from "./random.test-util.ts";
import type { FieldDef, FieldType, Schema, TypeDef } from "./schema.ts";
import { typeErrors } from "./schema.ts";

const L = label("user", "public", [{ kind: "turn", id: "t1" }]);
const MAIL = label("external", "personal", [{ kind: "mail", id: "m1" }]);

const libro = (): TypeDef => ({
  id: "t_libro",
  key: "libro",
  name: "Libro",
  fields: [
    { id: "f_titulo", key: "titulo", name: "Título", type: "text", label: L },
    {
      id: "f_estado",
      key: "estado",
      name: "Estado",
      type: "select",
      options: [{ id: "o_leyendo", name: "Leyendo", label: L }],
      label: L,
    },
  ],
  titleField: "f_titulo",
  sensitivity: "personal",
  schemaVersion: 1,
  label: L,
});

const empty: Schema = { types: {} };
const withLibro = (): Schema => {
  const r = applySchemaOp(empty, { op: "create_type", type: libro() });
  if (!r.ok) throw new Error(r.error);
  return r.schema;
};
/** Schemas compared without their version numbers (they only go up). */
const shape = (s: Schema) =>
  Object.fromEntries(Object.entries(s.types).map(([id, t]) => [id, { ...t, schemaVersion: 0 }]));

describe("typeErrors", () => {
  it("catches what a hand-made or a model-made definition gets wrong", () => {
    const bad = (change: (t: TypeDef) => TypeDef) => typeErrors(change(libro()), empty);
    expect(bad((t) => t)).toEqual([]);
    expect(bad((t) => ({ ...t, key: "título" })).join()).toMatch(/ASCII/); // keys are ASCII (vault rule)
    expect(
      bad((t) => ({
        ...t,
        fields: [...t.fields, { ...(t.fields[0] as FieldDef), id: "f_otro" }],
      })).join(),
    ).toMatch(/key used twice/);
    expect(bad((t) => ({ ...t, titleField: "f_estado" })).join()).toMatch(
      /title field must be text/,
    );
    expect(
      bad((t) => ({
        ...t,
        fields: [...t.fields, { id: "f_s", key: "s", name: "S", type: "select", label: L }],
      })).join(),
    ).toMatch(/needs options/);
    expect(
      bad((t) => ({
        ...t,
        fields: [
          ...t.fields,
          {
            id: "f_a",
            key: "autor",
            name: "Autor",
            type: "relation",
            relation: { target: "t_persona", many: false },
            label: L,
          },
        ],
      })).join(),
    ).toMatch(/unknown target/);
  });
});

describe("applySchemaOp", () => {
  it("every change has an inverse that brings the schema back", () => {
    const types: FieldType[] = ["text", "number", "date", "checkbox", "select", "url"];
    for (let seed = 1; seed <= 150; seed++) {
      const r = rng(seed);
      let schema = withLibro();
      const opts = [{ id: "o_a", name: "A", label: L }];
      const n = 1 + r.int(6);
      for (let i = 0; i < n; i++) {
        const def = schema.types.t_libro as TypeDef;
        const other = def.fields.filter((f) => f.id !== def.titleField);
        const target = other.length ? r.pick(other) : undefined;
        const to = r.pick(types);
        const candidates: SchemaOp[] = [
          {
            op: "add_field",
            type: "t_libro",
            field: {
              id: `f_n${seed}_${i}`,
              key: `n${seed}-${i}`,
              name: `Campo ${i}`,
              type: to,
              ...(to === "select" ? { options: opts } : {}),
              label: L,
            },
          },
          { op: "rename_type", type: "t_libro", key: `libro-${i}`, name: `Libro ${i}`, label: L },
          { op: "archive_type", type: "t_libro", archived: r.next() < 0.5 },
          {
            op: "describe_type",
            type: "t_libro",
            description: r.next() < 0.3 ? null : { text: `Los libros leídos ${i}.`, label: L },
          },
          {
            op: "rename_field",
            type: "t_libro",
            field: def.titleField,
            key: `titulo-${i}`,
            name: `Título ${i}`,
            label: L,
          },
        ];
        if (target) {
          candidates.push(
            {
              op: "change_field_type",
              type: "t_libro",
              field: target.id,
              to,
              ...(to === "select" ? { options: opts } : {}),
            },
            { op: "archive_field", type: "t_libro", field: target.id, archived: r.next() < 0.5 },
            { op: "remove_field", type: "t_libro", field: target.id },
          );
        }
        const op = r.pick(candidates);
        const before = schema;
        const done = applySchemaOp(before, op);
        if (!done.ok) continue;
        const undone = applySchemaOp(done.schema, done.inverse);
        expect(undone.ok, `seed ${seed}: ${JSON.stringify(op)}`).toBe(true);
        if (undone.ok)
          expect(shape(undone.schema), `seed ${seed}: ${op.op}`).toEqual(shape(before));
        schema = done.schema;
      }
    }
  });

  it("describe_type: a collection says what goes in it, and the change is undone like any other", () => {
    const said = applySchemaOp(withLibro(), {
      op: "describe_type",
      type: "t_libro",
      description: { text: "Los libros que leo, con su estado.", label: MAIL },
    });
    if (!said.ok) throw new Error(said.error);
    // The text keeps where it came from (a model or a mail may have written it).
    expect(said.schema.types.t_libro?.description).toEqual({
      text: "Los libros que leo, con su estado.",
      label: MAIL,
    });
    const back = applySchemaOp(said.schema, said.inverse);
    expect(back.ok && back.schema.types.t_libro?.description).toBeUndefined();
    const too = (text: string) =>
      applySchemaOp(withLibro(), {
        op: "describe_type",
        type: "t_libro",
        description: { text, label: L },
      });
    expect(too("   ").ok).toBe(false);
    expect(too("x".repeat(2001)).ok).toBe(false);
  });

  it("renaming a field keeps its id, so no value has to move", () => {
    const r = applySchemaOp(withLibro(), {
      op: "rename_field",
      type: "t_libro",
      field: "f_titulo",
      key: "nombre",
      name: "Nombre",
      label: L,
    });
    expect(r.ok && r.schema.types.t_libro?.fields[0]).toMatchObject({
      id: "f_titulo",
      key: "nombre",
    });
    expect(r.ok && r.schema.types.t_libro?.schemaVersion).toBe(2);
  });

  it("keeps the label of what came from outside, also in the names of the schema", () => {
    const r = applySchemaOp(withLibro(), {
      op: "set_options",
      type: "t_libro",
      field: "f_estado",
      options: [
        { id: "o_leyendo", name: "Leyendo", label: L },
        { id: "o_x", name: "Proyecto del correo", label: MAIL },
      ],
    });
    expect(r.ok && r.schema.types.t_libro?.fields[1]?.options?.[1]?.label.integrity).toBe(
      "external",
    );
  });

  it("protects Boni's own types and refuses what does not check", () => {
    const memory = { ...libro(), id: "memory", key: "memory", system: true };
    expect(applySchemaOp(empty, { op: "create_type", type: memory })).toMatchObject({ ok: false });
    const sys = applySchemaOp(empty, { op: "create_type", type: memory }, { system: true });
    expect(sys.ok).toBe(true);
    if (sys.ok) {
      const agent = applySchemaOp(sys.schema, {
        op: "add_field",
        type: "memory",
        field: { id: "f_x", key: "x", name: "X", type: "text", label: MAIL },
      });
      expect(agent).toMatchObject({ ok: false, error: expect.stringMatching(/Boni's own types/) });
    }
    expect(
      applySchemaOp(withLibro(), { op: "remove_field", type: "t_libro", field: "f_titulo" }),
    ).toMatchObject({ ok: false });
    expect(applySchemaOp(withLibro(), { op: "create_type", type: libro() })).toMatchObject({
      ok: false,
    });
    expect(
      applySchemaOp(withLibro(), {
        op: "change_field_type",
        type: "t_libro",
        field: "f_titulo",
        to: "number",
      }),
    ).toMatchObject({ ok: false });
  });

  it("does not remove a type that other types point to", () => {
    const s = withLibro();
    const persona: TypeDef = {
      ...libro(),
      id: "t_persona",
      key: "persona",
      name: "Persona",
      fields: [
        { id: "f_nombre", key: "nombre", name: "Nombre", type: "text", label: L },
        {
          id: "f_lee",
          key: "lee",
          name: "Lee",
          type: "relation",
          relation: { target: "t_libro", many: true },
          label: L,
        },
      ],
      titleField: "f_nombre",
    };
    const r = applySchemaOp(s, { op: "create_type", type: persona });
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(applySchemaOp(r.schema, { op: "remove_type", type: "t_libro" })).toMatchObject({
        ok: false,
      });
  });
});

describe("collections as classes (docs/clases.md; D-10)", () => {
  const field = (id: string, name: string, type: FieldType = "text"): FieldDef => ({
    id,
    key: id.slice(2),
    name,
    type,
    label: L,
  });
  const type = (id: string, fields: FieldDef[], parent?: string): TypeDef => ({
    id,
    key: id.slice(2),
    name: id.slice(2),
    fields,
    titleField: parent ? "f_titulo" : (fields[0]?.id ?? "f_titulo"),
    sensitivity: "personal",
    schemaVersion: 1,
    label: L,
    ...(parent ? { parent } : {}),
  });
  const ok = (s: Schema, op: SchemaOp) => {
    const r = applySchemaOp(s, op);
    if (!r.ok) throw new Error(r.error);
    return r;
  };
  /** Agenda (title, date) → Tarea (+ done) → Urgente; and Proyectos apart. */
  const tree = (): Schema => {
    let s = ok(empty, {
      op: "create_type",
      type: type("t_agenda", [field("f_titulo", "Título"), field("f_fecha", "Fecha", "date")]),
    }).schema;
    s = ok(s, {
      op: "create_type",
      type: type("t_tarea", [field("f_hecha", "Hecha", "checkbox")], "t_agenda"),
    }).schema;
    s = ok(s, { op: "create_type", type: type("t_urgente", [], "t_tarea") }).schema;
    s = ok(s, {
      op: "create_type",
      type: type("t_proyectos", [field("f_nombre", "Nombre"), field("f_fecha", "Fecha", "date")]),
    }).schema;
    return s;
  };
  const ids = (s: Schema, t: string) =>
    s.types[t]?.fields.map((f) => `${f.id}${f.from ? `<${f.from}` : ""}`);

  it("a daughter has her mother's fields, with the same ids, then her own; a change to the mother reaches the branch", () => {
    let s = tree();
    expect(ids(s, "t_tarea")).toEqual(["f_titulo<t_agenda", "f_fecha<t_agenda", "f_hecha"]);
    expect(ids(s, "t_urgente")).toEqual([
      "f_titulo<t_agenda",
      "f_fecha<t_agenda",
      "f_hecha<t_tarea",
    ]);
    expect(s.types.t_urgente?.titleField).toBe("f_titulo");
    s = ok(s, { op: "add_field", type: "t_agenda", field: field("f_lugar", "Lugar") }).schema;
    s = ok(s, {
      op: "rename_field",
      type: "t_agenda",
      field: "f_fecha",
      key: "dia",
      name: "Día",
      label: L,
    }).schema;
    expect(ids(s, "t_urgente")).toEqual([
      "f_titulo<t_agenda",
      "f_fecha<t_agenda",
      "f_lugar<t_agenda",
      "f_hecha<t_tarea",
    ]);
    expect(s.types.t_urgente?.fields.find((f) => f.id === "f_fecha")?.name).toBe("Día");
  });

  it("an inherited field is changed only where it is defined; a name is used once in a branch", () => {
    const s = tree();
    const r = applySchemaOp(s, {
      op: "archive_field",
      type: "t_tarea",
      field: "f_fecha",
      archived: true,
    });
    expect(r.ok ? "" : r.error).toContain("inherited");
    const twice = applySchemaOp(s, {
      op: "add_field",
      type: "t_tarea",
      field: field("f_otra", "Fecha"),
    });
    expect(twice.ok ? "" : twice.error).toContain("already has a field called");
    // Adding to the mother a name a daughter already uses is refused too.
    const below = applySchemaOp(s, {
      op: "add_field",
      type: "t_agenda",
      field: field("f_h2", "Hecha"),
    });
    expect(below.ok).toBe(false);
    const gone = applySchemaOp(s, { op: "remove_type", type: "t_tarea" });
    expect(gone.ok ? "" : gone.error).toContain("collections inside");
    const loop = applySchemaOp(s, { op: "set_parent", type: "t_agenda", parent: "t_urgente" });
    expect(loop.ok ? "" : loop.error).toContain("own branch");
  });

  it("moving a collection keeps what the new mother does not give, archived, and the move is undone exactly", () => {
    const s = tree();
    const r = ok(s, { op: "set_parent", type: "t_tarea", parent: "t_proyectos" });
    // Fecha is the same id in both mothers: inherited again. Título is kept (the title, not archived).
    expect(ids(r.schema, "t_tarea")).toEqual([
      "f_nombre<t_proyectos",
      "f_fecha<t_proyectos",
      "f_titulo",
      "f_hecha",
    ]);
    expect(
      r.schema.types.t_tarea?.fields.find((f) => f.id === "f_titulo")?.archived,
    ).toBeUndefined();
    expect(ids(r.schema, "t_urgente")).toEqual([
      "f_nombre<t_proyectos",
      "f_fecha<t_proyectos",
      "f_titulo<t_tarea",
      "f_hecha<t_tarea",
    ]);
    const back = ok(r.schema, r.inverse);
    expect(shape(back.schema)).toEqual(shape(s));
    // To the root: everything inherited stays, as its own fields.
    const root = ok(s, { op: "set_parent", type: "t_urgente", parent: null });
    expect(ids(root.schema, "t_urgente")).toEqual(["f_titulo", "f_fecha", "f_hecha"]);
    expect(root.schema.types.t_urgente?.fields.find((f) => f.id === "f_fecha")?.archived).toBe(
      true,
    );
    expect(shape(ok(root.schema, root.inverse).schema)).toEqual(shape(s));
  });
});
