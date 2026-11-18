/** «Versiones» as data (versions.ts, AU-98): the list's order and words, a version's canvas and two compared. */
import { type Automation, FORMAT, type Step } from "@boni/automations";
import { cpu, under } from "@boni/pace";
import { describe, expect, it } from "vitest";
import { translator } from "../i18n.ts";
import { compared, newestFirst, versionEditor, whoseKey } from "./versions.ts";

const t = translator("es");
const step = (id: string, name: string, params: Step["params"] = {}): Step => ({
  id,
  name,
  type: id === "s_01jinicio" ? "manual" : "collection",
  params,
});
const doc = (steps: Step[]): Automation => ({
  format: FORMAT,
  id: "a_01jejemplo0001",
  version: 0,
  name: "Revisar pendientes",
  steps,
  arrows: [],
  settings: {},
});
const inicio = step("s_01jinicio", "Disparado por el usuario");
const buscar = step("s_01jbuscar", "Buscar pendientes", { collection: "c_libros", action: "find" });
const crear = step("s_01jcrear", "Crear tarea", { collection: "c_tareas", action: "create" });

describe("«Versiones» (AU-98)", () => {
  it("AU-98 · the list is newest first whatever order it came in, and says «Tú» or «De Boni» of each", () => {
    const list = [1, 3, 2].map((n) => ({
      n,
      at: n,
      device: null,
      by: n === 3 ? "preset" : "user",
    }));
    expect(newestFirst(list).map((v) => v.n)).toEqual([3, 2, 1]);
    expect(newestFirst(list).map((v) => t(whoseKey(v)))).toEqual(["De Boni", "Tú", "Tú"]);
    // Never in place: the server's list stays as it came.
    expect(list.map((v) => v.n)).toEqual([1, 3, 2]);
  });

  it("AU-98 · a version's canvas is its document with the editor's boxes of the steps it still has, and nothing tested", () => {
    const v = versionEditor("a_01jejemplo0001", doc([inicio, buscar]), {
      s_01jinicio: { x: 10, y: 20 },
      s_01jcrear: { x: 300, y: 20 },
    });
    expect(v.draft.steps.map((s) => s.id)).toEqual(["s_01jinicio", "s_01jbuscar"]);
    expect(v.places).toEqual({ s_01jinicio: { x: 10, y: 20 } });
    expect(v.tests).toEqual({});
    expect(v.id).toBe("a_01jejemplo0001");
  });

  it("AU-98 · two compared: the older on the left marks what was removed, the newer what was added, both what changed; the order they were chosen in does not matter", () => {
    const two = { n: 2, doc: doc([inicio, buscar]) };
    const five = {
      n: 5,
      doc: doc([inicio, { ...buscar, params: { ...buscar.params, limit: 10 } }, crear]),
    };
    for (const [a, b] of [
      [two, five],
      [five, two],
    ] as const) {
      const c = compared(a, b);
      expect(c.older.n).toBe(2);
      expect(c.newer.n).toBe(5);
      expect(c.older.marks).toEqual({ s_01jbuscar: "changed" });
      expect(c.newer.marks).toEqual({ s_01jbuscar: "changed", s_01jcrear: "added" });
      expect(c.diff.added).toEqual(["s_01jcrear"]);
    }
    const gone = compared(five, { n: 6, doc: doc([inicio]) });
    expect(gone.older.marks).toEqual({ s_01jbuscar: "removed", s_01jcrear: "removed" });
    expect(gone.newer.marks).toEqual({});
  });

  it("AU-98 · 200 versions are ordered and two of 200 steps compared within their time (A-15)", () => {
    const list = Array.from({ length: 200 }, (_, i) => ({
      n: ((i * 37) % 200) + 1,
      at: i,
      device: null,
      by: "user",
    }));
    const many = (k: number) =>
      doc([
        inicio,
        ...Array.from({ length: 200 }, (_, i) =>
          step(`s_01jpaso${String(i).padStart(4, "0")}`, `Paso ${i}`, {
            collection: "c_libros",
            action: "find",
            limit: i % k === 0 ? 1 : 2,
          }),
        ),
      ]);
    const a = { n: 1, doc: many(3) };
    const b = { n: 2, doc: many(5) };
    compared(a, b);
    const started = cpu();
    const ordered = newestFirst(list);
    const c = compared(a, b);
    const ms = cpu() - started;
    expect(ordered[0]?.n).toBe(200);
    expect(Object.keys(c.newer.marks).length).toBeGreaterThan(0);
    under(ms, 50, "cpu", "«Versiones»: 200 ordered and two of 200 steps compared");
  });
});
