import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSystemTypes } from "@boni/agent";
import { openUserStore, type UserStore } from "@boni/store";
import { dataLevel, SYS } from "@boni/views";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCollection, createRow, DataError, notesInTree } from "./data.ts";
import { createMyData, deleteMyData, restoreMyData, updateMyData, withMyData } from "./myData.ts";
import { createPage, listPages, seedTemplates } from "./pages.ts";
import { SYS_DATA, systemCollections } from "./systemCollections.ts";

/** «Mis datos» as a collection (docs/flujos.md §4.7, F6b; D-04): its rows, and a change to a row done to what it is. */
const D = SYS.data;
let dir: string;
let store: UserStore;
const NOW = Date.UTC(2026, 10, 5, 10);
const o = { now: NOW, tz: "Europe/Madrid" };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "boni-mydata-"));
  store = openUserStore(join(dir, "user.db"), { now: () => NOW });
  ensureSystemTypes(store);
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const sys = () => withMyData(store, systemCollections(store, { ...o, usdToEur: 0.9 }), o);
const rows = () => sys().rows(SYS_DATA);
const row = (id: string) => rows().find((r) => r.id === D.row + id);
const fails = (f: () => unknown, code: string) => {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(DataError);
    expect((e as DataError).code).toBe(code);
    return;
  }
  throw new Error(`expected «${code}»`);
};

describe("«Mis datos» as a collection", () => {
  it("a row per page and collection of the user's, mothers before daughters, then Boni's; never itself", () => {
    const agenda = createCollection(store, { name: "Agenda" }, "portatil").id;
    const tarea = createCollection(store, { name: "Tarea", parent: agenda }, "portatil").id;
    const libros = createCollection(store, { name: "Libros" }, "portatil").id;
    createRow(store, tarea, { f_titulo: "Una" }, "portatil");
    createRow(store, tarea, { f_titulo: "Otra" }, "portatil");
    const inicio = createPage(store, { title: "Inicio" }, "portatil").id;
    const viajes = createPage(store, { title: "Viajes", parent: inicio }, "portatil").id;
    seedTemplates(store);
    store.setAiAccess(libros, "private", "portatil");
    store.journal.saveFlow({
      id: "lecturas",
      name: "Lecturas",
      trigger: { manual: true },
      inputs: [],
      plan: {
        version: 1,
        steps: [{ id: "q", op: "call", tool: "entities.query", args: { type: { lit: "libros" } } }],
      },
      layout: null,
      by: "user",
      enabled: true,
      created: 1,
    });
    const all = rows();
    const kinds = all.map((r) => r.values[D.kind]);
    expect(all.slice(0, 5).map((r) => r.values[D.title])).toEqual([
      "Inicio",
      "Viajes",
      "Agenda",
      "Tarea",
      "Libros",
    ]);
    expect(kinds.slice(0, 2)).toEqual([D.page, D.page]);
    expect(kinds.slice(2, 5)).toEqual([D.collection, D.collection, D.collection]);
    // Boni's own last: its template pages and its records.
    expect(kinds.slice(5).every((k) => k === D.boni)).toBe(true);
    expect(all.map((r) => r.values[D.title])).toContain("Ejecuciones");
    expect(all.some((r) => r.id === D.row + SYS_DATA)).toBe(false);
    expect(row(viajes)?.values[D.mother]).toBe(D.row + inicio);
    expect(row(tarea)?.values).toMatchObject({
      [D.mother]: D.row + agenda,
      [D.level]: dataLevel("visible"),
      [D.notes]: 2,
    });
    // A mother counts her daughters' rows, as her page does.
    expect(row(agenda)?.values[D.notes]).toBe(2);
    expect(row(libros)?.values[D.level]).toBe(dataLevel("private"));
    // Who reads it: the flow whose step names it, by its name.
    const type = sys().types[SYS_DATA];
    const reads = type?.fields.find((f) => f.id === D.reads)?.options ?? [];
    const lecturas = reads.find((x) => x.name === "Lecturas");
    expect(row(libros)?.values[D.reads]).toEqual([lecturas?.id]);
    expect(type?.fields.find((f) => f.id === D.mother)?.relation).toEqual({
      target: SYS_DATA,
      many: false,
    });
    expect(sys().count(SYS_DATA)).toBe(all.length);
  });

  it("a change to a row is done to what it is, with the rules it has anywhere else", () => {
    const agenda = createCollection(store, { name: "Agenda" }, "portatil").id;
    const libros = createCollection(store, { name: "Libros" }, "portatil").id;
    const inicio = createPage(store, { title: "Inicio" }, "portatil").id;
    const viajes = createPage(store, { title: "Viajes" }, "portatil").id;
    updateMyData(store, D.row + libros, { [D.title]: "Lecturas" }, "portatil");
    expect(store.schema().types[libros]?.name).toBe("Lecturas");
    fails(() => updateMyData(store, D.row + libros, { [D.title]: "agenda" }, "portatil"), "taken");
    updateMyData(store, D.row + viajes, { [D.title]: "Escapadas" }, "portatil");
    expect(listPages(store).find((p) => p.id === viajes)?.title).toBe("Escapadas");
    // Its mother: a collection under a collection, a page under a page; never across.
    updateMyData(store, D.row + libros, { [D.mother]: D.row + agenda }, "portatil");
    expect(store.schema().types[libros]?.parent).toBe(agenda);
    updateMyData(store, D.row + libros, { [D.mother]: null }, "portatil");
    expect(store.schema().types[libros]?.parent).toBeUndefined();
    updateMyData(store, D.row + viajes, { [D.mother]: D.row + inicio }, "portatil");
    expect(listPages(store).find((p) => p.id === viajes)?.parent).toBe(inicio);
    fails(() => updateMyData(store, D.row + libros, { [D.mother]: D.row + inicio }), "bad-body");
    // Its level: up from here; a private one comes down only from its own page.
    updateMyData(store, D.row + libros, { [D.level]: dataLevel("private") }, "portatil");
    expect(store.aiAccess()[libros]).toBe("private");
    fails(
      () => updateMyData(store, D.row + libros, { [D.level]: dataLevel("visible") }, "portatil"),
      "locked",
    );
    // Whether its notes show in the sidebar.
    updateMyData(store, D.row + agenda, { [D.bar]: false }, "portatil");
    const def = store.schema().types[agenda];
    expect(def && notesInTree(store, def)).toBe(false);
    // What is computed, a page's level and Boni's rows are not changed here.
    fails(() => updateMyData(store, D.row + agenda, { [D.notes]: 3 }), "read-only");
    fails(
      () => updateMyData(store, D.row + inicio, { [D.level]: dataLevel("private") }),
      "read-only",
    );
    fails(() => updateMyData(store, `${D.row}t_sys_runs`, { [D.title]: "Mías" }), "read-only");
    fails(() => updateMyData(store, `${D.row}t_no_existe`, { [D.title]: "X" }), "not-found");
  });

  it("deleting a row deletes what it is, and Undo brings it back; «Nuevo» makes a collection or a page", () => {
    const agenda = createCollection(store, { name: "Agenda" }, "portatil").id;
    const vacia = createCollection(store, { name: "Vacía" }, "portatil").id;
    createRow(store, agenda, { f_titulo: "Algo" }, "portatil");
    const inicio = createPage(store, { title: "Inicio" }, "portatil").id;
    deleteMyData(store, D.row + vacia, "portatil");
    expect(row(vacia)).toBeUndefined();
    restoreMyData(store, D.row + vacia, "portatil");
    expect(row(vacia)?.values[D.title]).toBe("Vacía");
    fails(() => deleteMyData(store, D.row + agenda, "portatil"), "not-empty");
    deleteMyData(store, D.row + inicio, "portatil");
    expect(row(inicio)).toBeUndefined();
    restoreMyData(store, D.row + inicio, "portatil");
    expect(row(inicio)?.values[D.title]).toBe("Inicio");
    fails(() => deleteMyData(store, `${D.row}t_sys_runs`), "read-only");

    const first = createMyData(store, {}, "portatil");
    const second = createMyData(store, {}, "portatil");
    expect(rows().find((r) => r.id === first)?.values[D.title]).toBe("Nueva colección");
    expect(rows().find((r) => r.id === second)?.values[D.title]).toBe("Nueva colección 2");
    fails(() => createMyData(store, { [D.title]: "Agenda" }, "portatil"), "taken");
    const recetas = createMyData(
      store,
      { [D.title]: "Recetas", [D.mother]: D.row + agenda, [D.level]: dataLevel("restricted") },
      "portatil",
    );
    expect(rows().find((r) => r.id === recetas)?.values).toMatchObject({
      [D.kind]: D.collection,
      [D.mother]: D.row + agenda,
      [D.level]: dataLevel("restricted"),
    });
    const page = createMyData(store, { [D.title]: "Ideas", [D.kind]: D.page }, "portatil");
    expect(rows().find((r) => r.id === page)?.values[D.kind]).toBe(D.page);
  });

  it("is made fast with a person's volume: dozens of collections, thousands of records (A-15)", () => {
    const ids: string[] = [];
    for (let i = 0; i < 22; i++)
      ids.push(
        createCollection(
          store,
          { name: `Colección ${i}`, ...(i % 3 && ids[0] ? { parent: ids[0] } : {}) },
          "portatil",
        ).id,
      );
    store.batch(() => {
      for (let i = 0; i < 2800; i++)
        createRow(store, ids[i % ids.length] as string, { f_titulo: `Nota ${i}` }, "portatil");
    });
    for (let i = 0; i < 12; i++) createPage(store, { title: `Página ${i}` }, "portatil");
    const base = systemCollections(store, { ...o, usdToEur: 0.9 });
    withMyData(store, base, o).rows(SYS_DATA);
    const t0 = performance.now();
    const made = withMyData(store, base, o);
    expect(made.rows(SYS_DATA).length).toBeGreaterThan(34);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(250);
  });
});
