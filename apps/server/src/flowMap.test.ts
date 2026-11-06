import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSystemTypes } from "@boni/agent";
import { label } from "@boni/entities";
import { openUserStore, type UserStore } from "@boni/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCollection, createRow } from "./data.ts";
import { flowMap, type MapEdge, type MapView } from "./flowMap.ts";
import { createPage } from "./pages.ts";

/**
 * Boni's map (docs/sistema.md §4.4, F8; A-16): computed from the saved flows, the runs, the proposals and the audit,
 * never declared. Data shaped like Juan's: generated collection ids, his collections' names and keys, Boni's
 * «Leer correo» with its pieces' steps around the creates, a flow of his by hand, the conversation and an assistant.
 */
let dir: string;
let store: UserStore;
const NOW = Date.UTC(2026, 10, 5, 10);
const DAY = 86_400_000;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "boni-map-"));
  store = openUserStore(join(dir, "user.db"), { now: () => NOW });
  ensureSystemTypes(store);
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const keyOf = (id: string) => store.schema().types[id]?.key as string;
const create = (id: string, type: string) => ({
  id,
  op: "call",
  tool: "entities.create",
  each: { ref: "$r.tasks" },
  args: {
    type: { lit: type },
    values: { fn: "obj", args: [{ lit: "title" }, { ref: "$item.title" }] },
  },
});

function world() {
  const correo = createCollection(store, { name: "Correo" }, "portatil").id;
  const trabajo = createCollection(store, { name: "Trabajo" }, "portatil").id;
  const tarea = createCollection(store, { name: "Tarea", parent: trabajo }, "portatil").id;
  const evento = createCollection(store, { name: "Evento", parent: trabajo }, "portatil").id;
  const persona = createCollection(store, { name: "Persona" }, "portatil").id;
  const libros = createCollection(store, { name: "Libros" }, "portatil").id;
  // Boni's «Leer correo»: its pieces, the reader, a read of Persona, and a create in each collection it may choose.
  store.journal.saveFlow({
    id: "leer-correo",
    name: "Leer correo",
    trigger: { created: keyOf(correo) },
    inputs: [],
    plan: {
      version: 1,
      steps: [
        { id: "only", op: "call", tool: "mail.rule", args: { mail: { ref: "$mail" } } },
        { id: "r", op: "read", reader: "read_message", input: { ref: "$text" } },
        { id: "c", op: "read", reader: "classify", input: { ref: "$text" } },
        {
          id: "p",
          op: "call",
          tool: "entities.query",
          args: { type: { lit: keyOf(persona) } },
        },
        create("n0", keyOf(tarea)),
        create("n1", keyOf(evento)),
        // An invitation's event goes to Tarea too: the same arrow, its proposals counted once.
        create("inv0", keyOf(tarea)),
        { id: "fold", op: "call", tool: "inbox.fold", args: { mail: { ref: "$mail" } } },
      ],
    },
    layout: null,
    by: "preset",
    enabled: true,
    created: NOW - 40 * DAY,
  });
  // One of his, by hand: it writes (a turn of his), it does not propose.
  store.journal.saveFlow({
    id: "apuntar-k2",
    name: "Apuntar tarea",
    trigger: { manual: true, inputs: [{ name: "titulo" }] },
    inputs: [],
    plan: { version: 1, steps: [create("a", keyOf(tarea))] },
    layout: null,
    by: "user",
    enabled: false,
    created: NOW - 10 * DAY,
  });
  // Runs: three mails this week, one a month ago; two turns of the conversation.
  const run = (id: string, at: number, o: { flow?: string; turn?: string } = {}) =>
    store.journal.startRun({
      id,
      turn: o.turn ?? null,
      origin: o.turn ? "turn" : "background",
      device: o.turn ? "portatil" : null,
      started: at,
      ...(o.flow ? { flow: o.flow, flowVersion: 1 } : {}),
    });
  run("m1", NOW - 1 * DAY, { flow: "leer-correo" });
  run("m2", NOW - 2 * DAY, { flow: "leer-correo" });
  run("m3", NOW - 3 * DAY, { flow: "leer-correo" });
  run("m0", NOW - 30 * DAY, { flow: "leer-correo" });
  // «Probar» on it: a dry run, which counts nowhere.
  store.journal.startRun({
    id: "dry1",
    turn: null,
    origin: "test",
    device: "portatil",
    started: NOW - DAY,
    flow: "leer-correo",
    flowVersion: 1,
  });
  run("t1", NOW - 1 * DAY, { turn: "turn-1" });
  run("t2", NOW - 2 * DAY, { turn: "turn-2" });
  const call = (r: string, kind: string, cost: number) =>
    store.journal.modelCall({
      run: r,
      role: kind === "classify" ? "decider" : "reader",
      provider: "anthropic",
      model: kind === "classify" ? "jev-1" : "claude-haiku-4-5",
      promptHash: "h",
      request: { kind },
      response: {},
      usage: { input: 100, output: 10, cost },
      at: NOW - DAY,
    });
  call("m1", "read_message", 0.01);
  call("m1", "classify", 0.002);
  call("m2", "read_message", 0.01);
  call("m0", "read_message", 0.5);
  call("t1", "summarize", 0.03);
  const propose = (id: string, r: string, type: string, at: number) =>
    store.journal.addProposal({
      id,
      run: r,
      tool: "entities.create",
      args: { type, values: { title: id } },
      view: {},
      sources: ["mail:x"],
      created: at,
    });
  propose("p1", "m1", keyOf(tarea), NOW - DAY);
  propose("p2", "m2", keyOf(tarea), NOW - 2 * DAY);
  propose("p3", "m3", keyOf(evento), NOW - 3 * DAY);
  propose("p0", "m0", keyOf(tarea), NOW - 30 * DAY);
  propose("p4", "t2", keyOf(libros), NOW - 2 * DAY);
  store.journal.setProposal("p1", "accepted", NOW - DAY + 60_000);
  store.journal.setProposal("p3", "rejected", NOW - 2 * DAY);
  // What was written: a mail by the connector, two tasks by Juan, an event by Claude through the MCP, a task by a
  // turn of the conversation he confirmed.
  const L = label("own", "personal", []);
  const title = (t: string) => ({ f_titulo: { value: t, label: L } });
  store.create(correo, title("Hola"), { actor: "connector" });
  createRow(store, tarea, { f_titulo: "Una" }, "portatil");
  createRow(store, tarea, { f_titulo: "Otra" }, "portatil");
  store.create(evento, title("Reunión"), { actor: "agent", device: "claude", by: "mcp:claude" });
  store.create(tarea, title("Llamar"), { actor: "agent", run: "t1", by: "agent" });
  // A page with a number over Tarea.
  createPage(
    store,
    {
      title: "Agenda",
      spec: {
        version: 1,
        blocks: [
          {
            id: "b1",
            type: "number",
            title: "Tareas",
            collection: tarea,
            measure: "count",
            period: "month",
            at: { row: "r1", col: 0, w: 3 },
          },
        ],
      },
    },
    "portatil",
  );
  return { correo, trabajo, tarea, evento, persona, libros };
}

const mapOf = (days: number, mailType: string | null): MapView =>
  flowMap(store, { now: NOW, days, tz: "Europe/Madrid", mailType, mailAccount: null });
const edgeOf = (m: MapView, from: string, to: string, kind: MapEdge["kind"]) =>
  m.edges.find((e) => e.from === from && e.to === to && e.kind === kind);

describe("Boni's map, computed (F8; A-16)", () => {
  it("draws what brings, starts, reads, proposes and writes, each with the week's numbers", () => {
    const w = world();
    const m = mapOf(7, w.correo);
    const ids = new Set(m.nodes.map((n) => n.id));
    for (const id of [
      "conn:mail",
      `col:${w.correo}`,
      `col:${w.tarea}`,
      `col:${w.evento}`,
      `col:${w.libros}`,
      "flow:leer-correo",
      "flow:apuntar-k2",
      "boni:chat",
      "boni:review",
      "actor:user",
      "actor:mcp:claude",
    ])
      expect(ids.has(id), id).toBe(true);
    // The mail comes in from outside, and what «Leer correo» proposes carries its words.
    expect(edgeOf(m, "conn:mail", `col:${w.correo}`, "brings")).toMatchObject({
      n: 1,
      outside: true,
    });
    expect(edgeOf(m, `col:${w.correo}`, "flow:leer-correo", "starts")).toMatchObject({
      n: 3,
      outside: true,
    });
    expect(edgeOf(m, `col:${w.persona}`, "flow:leer-correo", "reads")).toMatchObject({
      steps: ["p"],
    });
    expect(edgeOf(m, "flow:leer-correo", `col:${w.tarea}`, "proposes")).toMatchObject({
      n: 2,
      steps: ["n0", "inv0"],
      outside: true,
    });
    // The flow's proposals are its arrows' (3 = 2 in Tarea + 1 in Evento), never one per step.
    const proposes = m.edges.filter((e) => e.from === "flow:leer-correo" && e.kind === "proposes");
    expect(proposes.reduce((n, e) => n + (e.n ?? 0), 0)).toBe(
      m.nodes.find((n) => n.id === "flow:leer-correo")?.proposals,
    );
    expect(edgeOf(m, "flow:leer-correo", `col:${w.evento}`, "proposes")?.n).toBe(1);
    // His flow by hand writes (a turn of his), the conversation proposes and writes what he confirmed.
    expect(edgeOf(m, "flow:apuntar-k2", `col:${w.tarea}`, "writes")).toMatchObject({ n: null });
    expect(edgeOf(m, "boni:chat", `col:${w.libros}`, "proposes")?.n).toBe(1);
    expect(edgeOf(m, "boni:chat", `col:${w.tarea}`, "writes")?.n).toBe(1);
    // Who wrote by the audit: Juan from his apps, Claude through the MCP.
    expect(edgeOf(m, "actor:user", `col:${w.tarea}`, "writes")?.n).toBe(2);
    expect(edgeOf(m, "actor:mcp:claude", `col:${w.evento}`, "writes")?.n).toBe(1);
    // The guide's reviewer learns from his decisions and improves the reading.
    expect(edgeOf(m, "actor:user", "boni:review", "decides")?.n).toBe(2);
    expect(edgeOf(m, "boni:review", "flow:leer-correo", "improves")).toBeTruthy();
    // A page shows what its blocks count.
    const page = m.nodes.find((n) => n.kind === "page");
    expect(page?.name).toBe("Agenda");
    expect(edgeOf(m, `col:${w.tarea}`, page?.id ?? "", "shows")).toBeTruthy();
    // The flow's own numbers: its runs, its models and what they cost, its proposals, its steps as nodes.
    const mail = m.nodes.find((n) => n.id === "flow:leer-correo");
    expect(mail).toMatchObject({
      runs: 3,
      calls: 3,
      models: ["claude-haiku-4-5", "jev-1"],
      proposals: 3,
      accepted: 1,
      boni: true,
      on: true,
      pack: "correo",
    });
    expect(mail?.cost).toBeCloseTo(0.022);
    expect(mail?.roles?.sort()).toEqual(["decider", "reader"]);
    expect(mail?.steps?.map((s) => s.id)).toEqual([
      "only",
      "r",
      "c",
      "p",
      "n0",
      "n1",
      "inv0",
      "fold",
    ]);
    const chat = m.nodes.find((n) => n.id === "boni:chat");
    expect(chat).toMatchObject({ runs: 2, calls: 1, proposals: 1 });
    // A collection: its rows and the one it is inside.
    expect(m.nodes.find((n) => n.id === `col:${w.tarea}`)).toMatchObject({
      name: "Tarea",
      rows: 3,
      parent: `col:${w.trabajo}`,
    });
  });

  it("counts only the period asked for, and draws no connector without a mailbox", () => {
    const w = world();
    const month = mapOf(30, w.correo);
    expect(edgeOf(month, `col:${w.correo}`, "flow:leer-correo", "starts")?.n).toBe(4);
    expect(edgeOf(month, "flow:leer-correo", `col:${w.tarea}`, "proposes")?.n).toBe(3);
    const none = mapOf(7, null);
    expect(none.nodes.some((n) => n.id === "conn:mail")).toBe(false);
    expect(none.nodes.some((n) => n.id === "boni:review")).toBe(false);
    // Still started by its collection, by key.
    expect(edgeOf(none, `col:${w.correo}`, "flow:leer-correo", "starts")?.outside).toBe(false);
  });

  it("arrows join only nodes the map has, and every flow is in it, on or off", () => {
    world();
    const m = mapOf(7, null);
    const ids = new Set(m.nodes.map((n) => n.id));
    for (const e of m.edges)
      expect(ids.has(e.from) && ids.has(e.to), `${e.from}>${e.to}`).toBe(true);
    for (const f of store.journal.flows()) expect(ids.has(`flow:${f.id}`)).toBe(true);
  });

  it("is computed in time with a year of mail (A-15)", () => {
    const w = world();
    const type = keyOf(w.tarea);
    for (let i = 0; i < 12_000; i++) {
      const at = NOW - (i % 365) * DAY - (i % 7) * 60_000;
      store.journal.startRun({
        id: `y${i}`,
        turn: null,
        origin: "background",
        device: null,
        started: at,
        flow: "leer-correo",
        flowVersion: 1,
      });
      if (i % 3 === 0)
        store.journal.addProposal({
          id: `yp${i}`,
          run: `y${i}`,
          tool: "entities.create",
          args: { type, values: {} },
          view: {},
          sources: ["mail:x"],
          created: at,
        });
      store.journal.modelCall({
        run: `y${i}`,
        role: "reader",
        provider: "anthropic",
        model: "claude-haiku-4-5",
        promptHash: "h",
        request: { kind: "read_message" },
        response: {},
        usage: { input: 100, output: 10, cost: 0.001 },
        at,
      });
    }
    const t0 = performance.now();
    const m = mapOf(30, w.correo);
    const ms = performance.now() - t0;
    expect(m.nodes.find((n) => n.id === "flow:leer-correo")?.runs).toBeGreaterThan(900);
    expect(ms).toBeLessThan(1500);
  });
});
