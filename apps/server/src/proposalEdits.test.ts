// Juan's corrections to a proposal before accepting it: the title, the collection, «Ya lo hice», and any other property by its key, checked against the field.
import { leaf, rec } from "@boni/agent";
import { label } from "@boni/entities";
import { openUserStore, type ProposalRow, type UserStore } from "@boni/store";
import { afterEach, describe, expect, it } from "vitest";
import { acceptEdits } from "./proposalEdits.ts";
import { seed } from "./seed.test-util.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

/** Invented: books with a reading state, pages, a box, a day and an author (a person), and one proposal to add one. */
function env(): { store: UserStore; p: ProposalRow; author: string } {
  const store = openUserStore(":memory:");
  cleanups.push(() => store.close());
  const ids = seed(
    store,
    [
      { key: "persona", name: "Personas", folder: "personas/" },
      {
        key: "libro",
        name: "Libros",
        folder: "libros/",
        fields: {
          estado: { type: "select", options: ["pendiente", "leído"] },
          paginas: "number",
          favorito: "checkbox",
          fin: "date",
          autor: { type: "relation", to: "persona" },
        },
      },
    ],
    { "personas/Autora inventada.md": "---\ntype: persona\n---\n# Autora inventada\n" },
  );
  const l = label("external", "personal", [{ kind: "mail", id: "x" }]);
  store.journal.startRun({ id: "r1", turn: null, origin: "background", device: null, started: 1 });
  store.journal.addProposal({
    id: "p1",
    run: "r1",
    tool: "entities.create",
    args: {
      values: { type: leaf("libro", l), values: rec({ title: leaf("Libro inventado", l) }, l) },
      origins: [],
    },
    view: { tool: "entities.create", title: "Crear", rows: [] },
    sources: ["mail:boletin@example.edu"],
    created: 1,
  });
  return {
    store,
    p: store.journal.proposal("p1") as ProposalRow,
    author: ids.get("personas/Autora inventada.md") as string,
  };
}

describe("a proposal corrected to another collection keeps its day and hours by their roles (task 47)", () => {
  it("moves the day to the date field and the hours to the fields playing time and end time", () => {
    const store = openUserStore(":memory:");
    cleanups.push(() => store.close());
    const own = label("user", "personal", [{ kind: "user-edit", id: "ejemplo" }]);
    const type = (id: string, key: string, name: string, keys: [string, string, string]) => ({
      op: "create_type" as const,
      type: {
        id,
        key,
        name,
        fields: [
          { id: `${id}_t`, key: "title", name: "Título", type: "text" as const, label: own },
          { id: `${id}_d`, key: keys[0], name: "Día", type: "date" as const, label: own },
          { id: `${id}_s`, key: keys[1], name: "Inicio", type: "time" as const, label: own },
          { id: `${id}_e`, key: keys[2], name: "Fin", type: "time" as const, label: own },
        ],
        titleField: `${id}_t`,
        roles: { date: `${id}_d`, time: `${id}_s`, endTime: `${id}_e` },
        sensitivity: "personal" as const,
        schemaVersion: 1,
        label: own,
      },
    });
    store.applySchema(type("t_eventos", "eventos", "Eventos", ["fecha", "hora", "hora_fin"]), {
      actor: "user",
    });
    store.applySchema(type("t_tareas", "tareas", "Tareas", ["dia", "inicio", "fin"]), {
      actor: "user",
    });
    const l = label("external", "personal", [{ kind: "mail", id: "x" }]);
    store.journal.startRun({
      id: "r2",
      turn: null,
      origin: "background",
      device: null,
      started: 1,
    });
    store.journal.addProposal({
      id: "p2",
      run: "r2",
      tool: "entities.create",
      args: {
        values: {
          type: leaf("eventos", l),
          values: rec(
            {
              title: leaf("Reunión", l),
              fecha: leaf("2026-11-11", l),
              hora: leaf("17:00", l),
              hora_fin: leaf("18:00", l),
            },
            l,
          ),
        },
        origins: [],
      },
      view: { tool: "entities.create", title: "Crear", rows: [] },
      sources: ["mail:secretaria@example.edu"],
      created: 1,
    });
    const p = store.journal.proposal("p2") as ProposalRow;
    expect(acceptEdits(store, p, { collection: "t_tareas" })).toEqual({
      type: "tareas",
      values: {
        fecha: null,
        hora: null,
        hora_fin: null,
        dia: "2026-11-11",
        inicio: "17:00",
        fin: "18:00",
      },
    });
  });
});

describe("a proposal's other properties, corrected by their key (Juan, 2026-11-02)", () => {
  it("takes each kind of value as its field keeps it, and null to clear", () => {
    const { store, p, author } = env();
    expect(
      acceptEdits(store, p, {
        values: {
          estado: "o_leido",
          paginas: 320,
          favorito: true,
          fin: "2026-11-03",
          autor: author,
        },
      }),
    ).toEqual({
      values: { estado: "o_leido", paginas: 320, favorito: true, fin: "2026-11-03", autor: author },
    });
    expect(acceptEdits(store, p, { values: { paginas: null } })).toEqual({
      values: { paginas: null },
    });
    // With the title too, and together with another collection's choice: the values are the new collection's.
    expect(acceptEdits(store, p, { title: "Otro título", values: { favorito: false } })).toEqual({
      values: { title: "Otro título", favorito: false },
    });
  });

  it("refuses what does not fit: an unknown key, the title's key, a wrong kind, an option or a record that is not there", () => {
    const { store, p } = env();
    const bad = (values: Record<string, unknown>) =>
      expect(acceptEdits(store, p, { values })).toEqual({ error: "bad-values" });
    bad({ inventado: 1 });
    bad({ title: "x" });
    bad({ paginas: "muchas" });
    bad({ favorito: "sí" });
    bad({ fin: "3 de noviembre" });
    bad({ estado: "o_quemado" });
    bad({ autor: "e_nadie" });
    bad({ autor: ["a", "b"] });
    expect(acceptEdits(store, p, { values: "no" })).toEqual({ error: "bad-values" });
  });
});
