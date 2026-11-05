import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openUserStore, type UserStore } from "@boni/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addColumn, createCollection, createRow, DataError } from "./data.ts";
import { usageOf } from "./usage.ts";

/** Who reads and writes each collection (docs/flujos.md §4.7, F6), and a relation drawn from the diagram. */
let dir: string;
let store: UserStore;
const NOW = Date.UTC(2026, 10, 5, 10);
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "boni-usage-"));
  store = openUserStore(join(dir, "user.db"), { now: () => NOW });
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});
const lit = (v: unknown) => ({ lit: v });

describe("who reads and writes a collection", () => {
  it("the flows whose steps name it, and who did in the last days, flows first", () => {
    const agenda = createCollection(store, { name: "Agenda" }, "portatil").id;
    const tarea = createCollection(store, { name: "Tarea", parent: agenda }, "portatil").id;
    const evento = createCollection(store, { name: "Evento", parent: agenda }, "portatil").id;
    const keyOf = (id: string) => store.schema().types[id]?.key as string;
    store.journal.saveFlow({
      id: "leer-correo",
      name: "Leer correo",
      trigger: { created: "correo" },
      inputs: [],
      plan: {
        version: 1,
        steps: [
          {
            id: "c",
            op: "call",
            tool: "entities.create",
            args: { type: lit(keyOf(tarea)), values: lit("x") },
          },
        ],
      },
      layout: null,
      by: "preset",
      enabled: true,
      created: 1,
    });
    store.journal.saveFlow({
      id: "resumen",
      name: "Resumen diario",
      trigger: { schedule: { every: "day", at: "08:00" } },
      inputs: [],
      plan: {
        version: 1,
        steps: [
          { id: "q", op: "call", tool: "entities.query", args: { type: lit(keyOf(evento)) } },
          { id: "n", op: "call", tool: "notify", args: { text: lit("x") } },
        ],
      },
      layout: null,
      by: "user",
      enabled: false,
      created: 1,
    });
    // Juan wrote two tasks from his laptop and his phone: «Tú», twice.
    createRow(store, tarea, { f_titulo: "Una" }, "portatil");
    createRow(store, tarea, { f_titulo: "Otra" }, "movil");
    const u = usageOf(store, { now: NOW + 1000, tz: "Europe/Madrid" });
    expect(u.types[tarea]?.writes).toEqual([
      { id: "leer-correo", name: "Leer correo", kind: "flow", n: 0, on: true },
      { id: "user", name: "Tú", kind: "user", n: 2 },
    ]);
    expect(u.types[evento]?.reads).toEqual([
      { id: "resumen", name: "Resumen diario", kind: "flow", n: 0, on: false },
    ]);
    expect(u.types[agenda]).toBeUndefined();
    // Thirty days later, what Juan did then is out; the flows stay.
    const later = usageOf(store, { now: NOW + 31 * 86_400_000, tz: "Europe/Madrid" });
    expect(later.types[tarea]?.writes.map((w) => w.id)).toEqual(["leer-correo"]);
  });
});

describe("a relation drawn from the diagram", () => {
  it("is a column of the collection it starts at, pointing to the other; only to a collection of the user's", () => {
    const tarea = createCollection(store, { name: "Tarea" }, "portatil").id;
    const proyecto = createCollection(store, { name: "Proyecto" }, "portatil").id;
    const { id } = addColumn(
      store,
      tarea,
      { name: "Proyecto", type: "relation", target: proyecto },
      "portatil",
    );
    const f = store.schema().types[tarea]?.fields.find((x) => x.id === id);
    expect(f).toMatchObject({ type: "relation", relation: { target: proyecto, many: false } });
    expect(() =>
      addColumn(
        store,
        tarea,
        { name: "Nada", type: "relation", target: "t_no_existe" },
        "portatil",
      ),
    ).toThrow(DataError);
    expect(() =>
      addColumn(store, tarea, { name: "Sin destino", type: "relation" }, "portatil"),
    ).toThrow(DataError);
  });
});
