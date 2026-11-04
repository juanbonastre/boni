import type { FieldDef, TypeDef } from "@boni/entities";
import { label } from "@boni/entities";
import { describe, expect, it } from "vitest";
import { ownText, prefillOf } from "./prefill.ts";

const own = label("user", "personal", []);
const type = (id: string, key: string, name: string, fields: FieldDef[], extra = {}): TypeDef => ({
  id,
  key,
  name,
  fields: [{ id: `${id}_t`, key: "titulo", name: "Título", type: "text", label: own }, ...fields],
  titleField: `${id}_t`,
  sensitivity: "personal",
  schemaVersion: 1,
  label: own,
  ...extra,
});
const rel = (id: string, key: string, name: string, target: string, extra = {}): FieldDef => ({
  id,
  key,
  name,
  type: "relation",
  relation: { target, many: false },
  label: own,
  ...extra,
});
const TYPES: Record<string, TypeDef> = {
  t_pers: type("t_pers", "personas", "Personas", []),
  t_proy: type("t_proy", "proyectos", "Proyectos", []),
  t_old: type("t_old", "viejos", "Viejos", [], { archived: true }),
  t_tarea: type("t_tarea", "tareas", "Tareas", [
    rel("f_p", "persona", "Persona", "t_pers"),
    rel("f_pr", "proyecto", "Proyecto", "t_proy"),
    rel("f_many", "gente", "Gente", "t_pers", { relation: { target: "t_pers", many: true } }),
    rel("f_old", "viejo", "Viejo", "t_old"),
    rel("f_hidden", "oculta", "Oculta", "t_pers", { hidden: true }),
  ]),
};
const RECORDS: Record<string, { id: string; title: string }[]> = {
  t_pers: [
    { id: "p1", title: "Lucía Ejemplo" },
    { id: "p2", title: "Pedro Ejemplo" },
  ],
  t_proy: [
    { id: "y1", title: "IPM 25-26" },
    { id: "y2", title: "IPM 24-25" },
    { id: "y3", title: "FUP" },
    { id: "y4", title: "Casa" },
    { id: "y5", title: "FUP 1" },
  ],
  t_old: [{ id: "o1", title: "Lucía Ejemplo" }],
};
const records = (t: string) => RECORDS[t] ?? [];
const of = (sender: string, text: string) =>
  prefillOf(TYPES.t_tarea as TypeDef, TYPES, records, { sender, text });

describe("relations a mail's proposal gets by code (task 51, phases B and C)", () => {
  it("the sender by name, a project by its title in the text; one match or none", () => {
    expect(of("Lucía Ejemplo", "Actas de IPM 25-26\nHola, las actas del curso.")).toEqual([
      { key: "persona", name: "Persona", id: "p1", title: "Lucía Ejemplo", by: "sender" },
      { key: "proyecto", name: "Proyecto", id: "y1", title: "IPM 25-26", by: "text" },
    ]);
    // Accents and case aside. A record named in the sender's own words counts, whoever it is.
    expect(of("lucia ejemplo", "nada").map((p) => p.id)).toEqual(["p1"]);
    expect(of("Alguien", "Pedro Ejemplo dijo que sí").map((p) => p.id)).toEqual(["p2"]);
    // Two projects named: none. A short title («FUP», «Casa») is never looked for inside the text; one with a
    // number is specific enough («FUP 1»). Whole words only.
    expect(of("", "IPM 25-26 y IPM 24-25")).toEqual([]);
    expect(of("", "Las actas de FUP, en casa")).toEqual([]);
    expect(of("", "Las actas de FUP 1").map((p) => p.id)).toEqual(["y5"]);
    expect(of("", "IPM 25-267")).toEqual([]);
  });

  it("looks only at the sender's own words: not at what a reply quotes", () => {
    const body =
      "Vale, lo miro.\n\nEl lun, 3 nov 2026, Pedro Ejemplo escribió:\n> Sobre IPM 25-26, ¿lo ves?";
    expect(ownText("Re: IPM", body)).toBe("Re: IPM\nVale, lo miro.\n\n");
    expect(of("Alguien", ownText("Re: actas", body))).toEqual([]);
    expect(ownText("x", "Hola\n> citado").endsWith("Hola\n")).toBe(true);
    expect(ownText("x", "De: Pedro\nHola")).toBe("x\n");
    expect(ownText("x", "sin cita")).toBe("x\nsin cita");
  });

  it("two records with the sender's name: none; the most specific title wins over one it contains", () => {
    const twice = (t: string) =>
      t === "t_pers" ? [...records(t), { id: "p3", title: "Lucía Ejemplo" }] : records(t);
    expect(
      prefillOf(TYPES.t_tarea as TypeDef, TYPES, twice, { sender: "Lucía Ejemplo", text: "" }),
    ).toEqual([]);
    const nested = (t: string) =>
      t === "t_proy"
        ? [
            { id: "a", title: "Docencia IPM" },
            { id: "b", title: "Docencia IPM 25-26" },
          ]
        : [];
    expect(
      prefillOf(TYPES.t_tarea as TypeDef, TYPES, nested, {
        sender: "",
        text: "Sobre Docencia IPM 25-26",
      }).map((p) => p.id),
    ).toEqual(["b"]);
  });
});
