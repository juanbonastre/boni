import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSystemTypes } from "@boni/agent";
import { openUserStore, type UserStore } from "@boni/store";
import { SYS } from "@boni/views";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCollection, DataError, flowRowOf, listRows } from "./data.ts";
import {
  createFlowRow,
  deleteFlowRow,
  restoreFlowRow,
  SYS_FLOWS,
  triggerWords,
  updateFlowRow,
  withFlows,
} from "./flowsCollection.ts";
import { withMyData } from "./myData.ts";
import { SYS_DATA, systemCollections } from "./systemCollections.ts";

/** «Flujos» as a collection (docs/sistema.md §4.4, F8): a row per flow, and a change to a row done to its flow. */
const F = SYS.flows;
let dir: string;
let store: UserStore;
const NOW = Date.UTC(2026, 10, 5, 10);
const o = { now: NOW, tz: "Europe/Madrid" };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "boni-flowsrows-"));
  store = openUserStore(join(dir, "user.db"), { now: () => NOW });
  ensureSystemTypes(store);
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const sys = () => withFlows(store, systemCollections(store, { ...o, usdToEur: 0.9 }));
const rows = () => sys().rows(SYS_FLOWS);
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
const plan = (type: string) => ({
  version: 1,
  steps: [
    {
      id: "a",
      op: "call",
      tool: "entities.create",
      args: {
        type: { lit: type },
        values: { fn: "obj", args: [{ lit: "title" }, { ref: "$titulo" }] },
      },
    },
  ],
});
/** Boni's «Leer correo», as the mail reading saves it, and one of the user's. */
function flows() {
  const tarea = createCollection(store, { name: "Tarea" }, "portatil").id;
  const key = store.schema().types[tarea]?.key as string;
  store.journal.saveFlow({
    id: "leer-correo",
    name: "Leer correo",
    trigger: { created: "correo" },
    inputs: [],
    plan: plan(key),
    layout: null,
    by: "preset",
    enabled: true,
    created: NOW - 9_000,
  });
  store.journal.saveFlow({
    id: "apuntar-x1",
    name: "Apuntar tarea",
    trigger: { manual: true, inputs: [{ name: "titulo" }] },
    inputs: [],
    plan: plan(key),
    layout: null,
    by: "user",
    enabled: false,
    created: NOW - 5_000,
  });
  return { tarea, key };
}

describe("«Flujos» as a collection", () => {
  it("a row per flow, those on first: what starts it, its state, whose version runs, its steps and runs", () => {
    flows();
    store.journal.startRun({
      id: "r1",
      turn: null,
      origin: "background",
      device: null,
      started: NOW - 3_600_000,
      flow: "leer-correo",
      flowVersion: 1,
    });
    const r = rows();
    expect(r.map((x) => x.values[F.title])).toEqual(["Leer correo", "Apuntar tarea"]);
    const [mail, mine] = r;
    expect(mail?.id).toBe(`${F.row}leer-correo`);
    expect(mail?.values[F.state]).toBe(F.on);
    expect(mail?.values[F.by]).toBe(F.boni);
    expect(mail?.values[F.runs]).toBe(1);
    expect(mail?.values[F.steps]).toBe(1);
    expect(mine?.values[F.state]).toBe(F.off);
    expect(mine?.values[F.by]).toBe(F.user);
    // «Disparador» as a person says it, an option the same for the same words on every read.
    const type = sys().types[SYS_FLOWS];
    const trigger = type?.fields.find((f) => f.id === F.trigger);
    expect(trigger?.options?.map((x) => x.name)).toEqual([
      "Llega a correo",
      "Disparado por el usuario",
    ]);
    expect(rows()[0]?.values[F.trigger]).toBe(mail?.values[F.trigger]);
    // As the app lists it: Boni's flow keeps the name Boni gives it.
    const listed = listRows(store, SYS_FLOWS, sys());
    expect(listed.rows[0]?.fixed).toEqual([F.title]);
    expect(listed.rows[1]?.fixed).toBeUndefined();
  });

  it("says a schedule and a collection's name as a person does", () => {
    const words = (t: unknown) => triggerWords(t, (k) => (k === "tarea" ? "Tarea" : null));
    expect(words({ created: "tarea" })).toBe("Llega a Tarea");
    expect(words({ schedule: { every: "day", at: "08:00" } })).toBe("Cada día a las 08:00");
    expect(words({ schedule: { every: "week", day: 1, at: "09:30" } })).toBe(
      "Cada lunes a las 09:30",
    );
    expect(words({ schedule: { every: "hour", at: "00:15" } })).toBe("Cada hora a y 15");
    expect(words({ schedule: { every: "hour", at: "00:00" } })).toBe("Cada hora");
    expect(words({ manual: true })).toBe("Disparado por el usuario");
  });

  it("a row's name and state change its flow; Boni's keep their name and are never deleted", () => {
    flows();
    const none = () => [];
    updateFlowRow(store, `${F.row}apuntar-x1`, { [F.title]: "Apuntar una tarea" }, none, NOW);
    const renamed = store.journal.flow("apuntar-x1");
    expect(renamed?.name).toBe("Apuntar una tarea");
    expect(renamed?.version).toBe(2);
    expect(renamed?.plan).toEqual(store.journal.flow("apuntar-x1", 1)?.plan);
    fails(
      () => updateFlowRow(store, `${F.row}leer-correo`, { [F.title]: "Otro" }, none, NOW),
      "flow-boni-name",
    );
    // On only with an empty checklist, as from its editor.
    fails(
      () =>
        updateFlowRow(
          store,
          `${F.row}apuntar-x1`,
          { [F.state]: F.on },
          () => [{ step: null, at: "trigger", code: "bad" }],
          NOW,
        ),
      "flow-problems",
    );
    updateFlowRow(store, `${F.row}apuntar-x1`, { [F.state]: F.on }, none, NOW);
    expect(store.journal.flow("apuntar-x1")?.enabled).toBe(true);
    updateFlowRow(store, `${F.row}leer-correo`, { [F.state]: F.off }, none, NOW);
    expect(store.journal.flow("leer-correo")?.enabled).toBe(false);
    // What is computed stays as it is.
    fails(
      () => updateFlowRow(store, `${F.row}apuntar-x1`, { [F.runs]: 3 }, none, NOW),
      "read-only",
    );
    fails(() => deleteFlowRow(store, `${F.row}leer-correo`), "flow-boni-delete");
    deleteFlowRow(store, `${F.row}apuntar-x1`);
    expect(rows().map((x) => x.values[F.title])).toEqual(["Leer correo"]);
    restoreFlowRow(store, `${F.row}apuntar-x1`);
    expect(rows().map((x) => x.values[F.title])).toContain("Apuntar una tarea");
    fails(() => updateFlowRow(store, `${F.row}nada`, { [F.title]: "x" }, none, NOW), "not-found");
  });

  it("«Nuevo» makes a flow by hand, off, and its row comes back", () => {
    const id = createFlowRow(store, {}, NOW);
    const f = store.journal.flow(id.slice(F.row.length));
    expect(f?.name).toBe("Nuevo flujo");
    expect(f?.enabled).toBe(false);
    expect(f?.trigger).toEqual({ manual: true });
    expect(flowRowOf(sys(), id)?.values[F.title]).toBe("Nuevo flujo");
    const named = createFlowRow(store, { [F.title]: "Resumen del lunes" }, NOW);
    expect(flowRowOf(sys(), named)?.values[F.title]).toBe("Resumen del lunes");
  });

  it("is one of Boni's collections in «Mis datos»", () => {
    const base = sys();
    const my = withMyData(store, base, o).rows(SYS_DATA);
    expect(
      my.some(
        (r) => r.id === `${SYS.data.row}${SYS_FLOWS}` && r.values[SYS.data.title] === "Flujos",
      ),
    ).toBe(true);
  });
});
