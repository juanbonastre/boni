// «Ejecuciones» as data and as words (docs/automatizaciones.md AU-99, AU-100, AU-101, AU-18; F14d P2).
import { FORMAT } from "@boni/automations";
import { describe, expect, it } from "vitest";
import { translator } from "../i18n.ts";
import { type RunStep, type RunSummary, type RunView, runSummaryOf } from "./client.ts";
import { mergeRuns, runEditor, treeLines, treeOrder } from "./runs.ts";
import { didWords, howWords, runRefusedWords, whenWords, whoWords } from "./runWords.ts";

const es = translator("es");
const en = translator("en");
const ZONE = "Europe/Madrid";

const doc = {
  format: FORMAT,
  id: "a_01jx8x0t2v4x6z8b0d2f4h6k9p",
  version: 3,
  name: "Avisar de facturas",
  steps: [
    { id: "s_01jguardar", name: "Guardar", type: "create", params: {} },
    { id: "s_01jinicio", name: "Disparado por el usuario", type: "manual", params: {} },
    { id: "s_01jbuscar", name: "Buscar facturas", type: "query", params: {} },
    { id: "s_01jsuelto", name: "Sin conectar", type: "filter", params: {} },
  ],
  arrows: [
    { from: { step: "s_01jinicio", output: "main" }, to: { step: "s_01jbuscar", input: "main" } },
    { from: { step: "s_01jbuscar", output: "main" }, to: { step: "s_01jguardar", input: "main" } },
  ],
  settings: {},
};

const step = (over: Partial<RunStep> = {}): RunStep => ({
  state: "done",
  in: { main: 1 },
  out: { main: 1 },
  ms: 40,
  retries: 0,
  failed: 0,
  asked: 0,
  ...over,
});

const summary = (over: Partial<RunSummary> = {}): RunSummary => ({
  ...runSummaryOf({ id: "r_01", automation: doc.id, at: 1_000, state: "done" }),
  ...over,
});

const view = (over: Partial<RunView> = {}): RunView => ({
  run: summary({ version: 3, started: 1_500 }),
  automation: doc,
  trigger: "s_01jinicio",
  fields: { importe: 12 },
  steps: {
    s_01jinicio: step({ in: {}, out: { main: 1 } }),
    s_01jbuscar: step({
      out: { main: 2_400 },
      reads: [{ collection: "c_facturas", rows: 2_400 }],
      ms: 1_200,
    }),
    s_01jguardar: step({
      in: { main: 2_400 },
      out: { main: 2_400 },
      writes: { saved: 2_400, asked: 0, would: 0 },
    }),
  },
  undoable: true,
  wrote: true,
  published: 3,
  ...over,
});

describe("a run's canvas (AU-99)", () => {
  it("AU-99 · a run is the editor's state over the document it ran: each step with its counts, its trigger's fields, the boxes where the editor has them", () => {
    const places = { s_01jinicio: { x: 10, y: 20 }, s_01jotro: { x: 0, y: 0 } };
    const s = runEditor(view(), places);
    expect(s).not.toBeNull();
    if (!s) return;
    expect(s.id).toBe(doc.id);
    expect(s.draft).toBe(doc);
    expect(s.places).toEqual({ s_01jinicio: { x: 10, y: 20 } });
    expect(s.tests.s_01jbuscar).toMatchObject({
      state: "done",
      out: { main: 2_400 },
      at: 1_500,
      stale: false,
    });
    expect(s.tests.s_01jsuelto).toBeUndefined();
    expect(s.tested).toEqual({ s_01jinicio: { importe: 12 } });
    // Nothing of it is owed: the canvas of a run is never sent anywhere.
    expect(s.owed).toEqual({ draft: false, places: [] });
  });
  it("AU-99 · nothing is left of the document: no canvas, the bar alone", () => {
    expect(runEditor(view({ automation: null }), {})).toBeNull();
  });
});

describe("the «Registro» tree (AU-101)", () => {
  it("AU-101 · its steps go in the order they ran, from the trigger, never in the document's", () => {
    expect(treeOrder(doc, view().steps)).toEqual(["s_01jinicio", "s_01jbuscar", "s_01jguardar"]);
    // A test's answer says the order itself.
    expect(treeOrder(doc, view().steps, ["s_01jbuscar", "s_01jinicio"])).toEqual([
      "s_01jbuscar",
      "s_01jinicio",
      "s_01jguardar",
    ]);
  });
  it("AU-101 · each line has the step's rows in and out, its seconds and what it touched; counts only", () => {
    const lines = treeLines(doc, view().steps, { pins: { s_01jinicio: {} } });
    expect(lines.map((l) => [l.name, l.rowsIn, l.rowsOut, l.pinned])).toEqual([
      ["Disparado por el usuario", 0, 1, true],
      ["Buscar facturas", 1, 2_400, false],
      ["Guardar", 2_400, 2_400, false],
    ]);
    expect(lines[1]?.reads).toEqual([{ collection: "c_facturas", rows: 2_400 }]);
    expect(lines[2]?.saved).toBe(2_400);
  });
  it("AU-101 · a step still queued has no line; the editor's tests give the same lines, «would» from what a test would write", () => {
    const steps = { ...view().steps, s_01jguardar: step({ state: "queued" }) };
    expect(treeLines(doc, steps).map((l) => l.step)).toEqual(["s_01jinicio", "s_01jbuscar"]);
    const tested = {
      s_01jinicio: { state: "done" as const, in: {}, out: { main: 1 }, ms: 3, wouldWrite: 7 },
    };
    expect(treeLines(doc, tested)[0]?.would).toBe(7);
  });
});

describe("the list as its first page is asked again", () => {
  const runs = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => summary({ id: `r_${from - i}`, at: from - i }));
  it("AU-99 · the newest page replaces the runs it brings again, and the older pages loaded stay", () => {
    const loaded = runs(100, 100);
    const first = [summary({ id: "r_101", at: 101 }), ...runs(100, 49)];
    const merged = mergeRuns(first, loaded);
    expect(merged.length).toBe(101);
    expect(merged[0]?.id).toBe("r_101");
    expect(new Set(merged.map((r) => r.id)).size).toBe(merged.length);
    expect(mergeRuns([], loaded)).toEqual([]);
  });
});

describe("what «Ejecuciones» says of a run", () => {
  const now = Date.UTC(2026, 10, 17, 11, 0);
  it("AU-99 · when: today, yesterday, a date this year and one of another, at the device's zone", () => {
    expect(whenWords(es, "es", ZONE, Date.UTC(2026, 10, 17, 8, 12), now)).toBe("hoy, 09:12");
    expect(whenWords(es, "es", ZONE, Date.UTC(2026, 10, 16, 18, 44), now)).toBe("ayer, 19:44");
    expect(whenWords(es, "es", ZONE, Date.UTC(2026, 10, 9, 9, 5), now)).toMatch(/^9 nov,? 10:05$/);
    expect(whenWords(es, "es", ZONE, Date.UTC(2025, 10, 9, 9, 5), now)).toMatch(/2025/);
    expect(whenWords(en, "en", ZONE, Date.UTC(2026, 10, 17, 8, 12), now)).toBe("today, 09:12");
  });
  it("AU-99 · how it ended, by the step's name; a step the document no longer has is left unsaid, never said by its id", () => {
    const names = (s: string) => (s === "s_01jbuscar" ? "Buscar facturas" : undefined);
    expect(howWords(es, "es", summary({ ms: 4_100 }), names)).toBe("Bien · 4,1 s");
    const failed = summary({ state: "failed", error: { step: "s_01jbuscar" } as never });
    expect(howWords(es, "es", failed, names)).toBe("Falló en «Buscar facturas»");
    const gone = summary({ state: "failed", error: { step: "s_01jborrado" } as never });
    expect(howWords(es, "es", gone, names)).toBe("Falló");
    expect(howWords(es, "es", summary({ state: "interrupted", step: "s_01jbuscar" }), names)).toBe(
      "Interrumpida en «Buscar facturas»",
    );
    expect(howWords(es, "es", summary({ state: "queued" }), names)).toBe("En cola, detrás de otra");
    // A state a newer server gives is said as a failure, never as nothing.
    expect(howWords(es, "es", summary({ state: "nueva" as never }), names)).toBe("Falló");
  });
  it("AU-99 · AU-100 · who started it and which version ran, and a retry says so", () => {
    expect(whoWords(es, summary({ version: 3 }))).toBe("Iniciada por ti · versión 3");
    expect(whoWords(es, summary({ version: 3, startedBy: "schedule", retryOf: "r_00" }))).toBe(
      "Programada · versión 3 · reintento",
    );
    expect(whoWords(es, summary({ test: true }))).toBe("Prueba del borrador");
  });
  it("AU-99 · what it did in one line, with «con datos de fuera»; a proposal is counted and nothing more is promised", () => {
    const names = (k: string) => (k === "c_tareas" ? "Tareas" : undefined);
    const r = summary({
      line: {
        writes: [{ collection: "c_tareas", name: "Tareas", action: "create", n: 1 }],
        asked: [{ collection: "c_viejas", name: null, action: "update", n: 12 }],
        outside: true,
      },
    });
    expect(didWords(es, "es", r, names)).toBe(
      "Creó 1 fila en Tareas · Propuso modificar 12 filas en una colección que ya no está · con datos de fuera",
    );
    expect(
      didWords(es, "es", summary({ line: { writes: [], asked: [], outside: false } }), names),
    ).toBe("No hizo nada");
    expect(didWords(es, "es", summary({ test: true }), names)).toBeNull();
    expect(didWords(es, "es", summary({ state: "running" }), names)).toBeNull();
  });
  it("AU-18 · S2's refusals in words: a shared device in the app's own, and a later run that stands by the row's title", () => {
    expect(runRefusedWords(es, { refused: "not-personal" })).toBe(
      es("mail.error.personal-device-only"),
    );
    expect(runRefusedWords(es, { refused: "changed", title: "Comprar pan" })).toBe(
      "No se pudo deshacer: «Comprar pan» cambió después",
    );
    expect(runRefusedWords(es, { refused: "algo-nuevo" })).toBe(es("error.generic"));
  });
});
