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
