import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, coreTools, ensureSystemTypes, fakePlanner } from "@boni/agent";
import { label } from "@boni/entities";
import { openUserStore, type UserStore } from "@boni/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUTO_AREA } from "./autoAccept.ts";
import { createCollection, createRow } from "./data.ts";
import { flowMap, type MapEdge, type MapView, mapOwnerOf } from "./flowMap.ts";
import { BUDGET_FLOW, ensureFlow, FETCH_FLOW, REVIEW_FLOW } from "./flows.ts";
import { BUDGET_PLAN, BUDGET_TRIGGER } from "./models.ts";
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
/** A proposal's arguments as the agent stores them: each a labelled value (packages/agent values.ts). */
const proposalArgs = (type: string, title: string) => ({
  values: {
    type: { t: "v", value: type, label: { integrity: "own", secrecy: "personal", sources: [] } },
    values: {
      t: "rec",
      fields: { title: { t: "v", value: title, label: { integrity: "own", sources: [] } } },
    },
  },
  origins: [],
});
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
      args: proposalArgs(type, id),
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
      "boni:inbox",
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
    // What it proposes waits in the Bandeja: one arrow with every step that proposes and where they go, its number
    // the flow's proposals (3: two in Tarea, one in Evento), counted once.
    expect(edgeOf(m, "flow:leer-correo", "boni:inbox", "proposes")).toMatchObject({
      n: 3,
      steps: ["n0", "n1", "inv0"],
      outside: true,
      into: [`col:${w.evento}`, `col:${w.tarea}`].sort(),
      // With a collection in the centre, what went to that one.
      per: { [`col:${w.tarea}`]: 2, [`col:${w.evento}`]: 1 },
    });
    expect(m.nodes.find((n) => n.id === "flow:leer-correo")?.proposals).toBe(3);
    // Out of the Bandeja, what was accepted into each collection: the mail's words go on with it.
    expect(edgeOf(m, "boni:inbox", `col:${w.tarea}`, "accepts")).toMatchObject({
      n: 1,
      outside: true,
    });
    expect(edgeOf(m, "boni:inbox", `col:${w.evento}`, "accepts")?.n).toBe(0);
    expect(m.nodes.find((n) => n.id === "boni:inbox")).toMatchObject({
      proposals: 4,
      accepted: 1,
      rejected: 1,
      // Waiting now, whenever proposed.
      pending: 3,
      through: true,
    });
    // His flow by hand writes (a turn of his), the conversation proposes and writes what he confirmed.
    expect(edgeOf(m, "flow:apuntar-k2", `col:${w.tarea}`, "writes")).toMatchObject({ n: null });
    expect(edgeOf(m, "boni:chat", "boni:inbox", "proposes")).toMatchObject({
      n: 1,
      into: [`col:${w.libros}`],
    });
    expect(edgeOf(m, "boni:inbox", `col:${w.libros}`, "accepts")).toMatchObject({
      n: 0,
      outside: false,
    });
    expect(edgeOf(m, "boni:chat", `col:${w.tarea}`, "writes")?.n).toBe(1);
    // Who wrote by the audit: Juan from his apps, Claude through the MCP.
    expect(edgeOf(m, "actor:user", `col:${w.tarea}`, "writes")?.n).toBe(2);
    expect(edgeOf(m, "actor:mcp:claude", `col:${w.evento}`, "writes")?.n).toBe(1);
    // His decisions in the Bandeja teach the guide's reviewer, which improves the reading.
    expect(edgeOf(m, "actor:user", "boni:inbox", "decides")?.n).toBe(2);
    expect(edgeOf(m, "boni:inbox", "boni:review", "learns")).toMatchObject({
      n: 2,
      via: ["flow:leer-correo"],
    });
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
    expect(edgeOf(month, "flow:leer-correo", "boni:inbox", "proposes")?.n).toBe(4);
    expect(edgeOf(month, "boni:inbox", `col:${w.tarea}`, "accepts")?.n).toBe(1);
    const none = mapOf(7, null);
    expect(none.nodes.some((n) => n.id === "conn:mail")).toBe(false);
    expect(none.nodes.some((n) => n.id === "boni:review")).toBe(false);
    // Still started by its collection, by key.
    expect(edgeOf(none, `col:${w.correo}`, "flow:leer-correo", "starts")?.outside).toBe(false);
  });

  it("decisions are the user's (not Boni's «Solo»); the reviewer learns from the mail's; an edited one counts where it went", () => {
    const w = world();
    // Boni accepted p2 alone; Juan rejected the conversation's p4, and moved p5 from Tarea to Evento as he accepted it.
    store.journal.setProposal("p2", "accepted", NOW - DAY);
    store.journal.addDecision({
      id: "d_solo_1",
      run: "m2",
      area: AUTO_AREA,
      cost: "B",
      p: 0.97,
      outcome: "do",
      detail: { proposal: "p2", run: "acc_p2" },
      at: NOW - DAY,
    });
    store.journal.setProposal("p4", "rejected", NOW - DAY);
    store.journal.addProposal({
      id: "p5",
      run: "m1",
      tool: "entities.create",
      args: proposalArgs(keyOf(w.tarea), "Cena"),
      view: {},
      sources: ["mail:x"],
      created: NOW - DAY,
    });
    store.journal.setProposal("p5", "accepted", NOW - DAY + 1000, {
      type: { from: keyOf(w.tarea), to: keyOf(w.evento) },
    });
    const m = mapOf(7, w.correo);
    // p1, p2, p3, p4 and p5 decided, less Boni's p2: four are his.
    expect(edgeOf(m, "actor:user", "boni:inbox", "decides")?.n).toBe(4);
    // Of the mail's (p1, p2, p3, p5), less Boni's: three teach the reviewer; the conversation's p4 does not.
    expect(edgeOf(m, "boni:inbox", "boni:review", "learns")?.n).toBe(3);
    // p5 went to Evento: accepted there, not in Tarea (p1 and Boni's p2 are Tarea's).
    expect(edgeOf(m, "boni:inbox", `col:${w.evento}`, "accepts")?.n).toBe(1);
    expect(edgeOf(m, "boni:inbox", `col:${w.tarea}`, "accepts")?.n).toBe(2);
  });

  it("says where each run is drawn: its flow, the conversation, the Bandeja for an «Aceptar»", () => {
    world();
    store.journal.startRun({
      id: "acc1",
      turn: null,
      origin: "accepted",
      device: null,
      started: NOW,
      proposal: "p1",
    });
    const owner = (id: string) =>
      mapOwnerOf(
        store,
        store.journal.run(id) as NonNullable<ReturnType<typeof store.journal.run>>,
        null,
      );
    expect(owner("m1")).toBe("flow:leer-correo");
    expect(owner("t1")).toBe("boni:chat");
    expect(owner("acc1")).toBe("boni:inbox");
    expect(owner("dry1")).toBeNull();
  });

  it("a step that creates in the chosen collection («Crear en la elegida», D-48): one «propone» into the Bandeja, each step once, into every collection it may choose", () => {
    const w = world();
    const choose = (tasks: string, events: string) => ({
      fn: "case",
      args: [
        { ref: "$c.choice" },
        { lit: "Tarea" },
        { lit: tasks },
        { lit: "Evento" },
        { lit: events },
      ],
    });
    store.journal.saveFlow({
      id: "leer-elegida",
      name: "Leer y elegir",
      trigger: { created: keyOf(w.correo) },
      inputs: [],
      plan: {
        version: 1,
        steps: [
          { id: "r", op: "read", reader: "read_message", input: { ref: "$text" } },
          { id: "c", op: "read", reader: "classify", input: { ref: "$text" } },
          {
            id: "n_tasks",
            op: "call",
            tool: "entities.create",
            each: { ref: "$r.tasks" },
            args: {
              type: choose(keyOf(w.tarea), keyOf(w.evento)),
              values: { fn: "obj", args: [{ lit: "title" }, { ref: "$item.title" }] },
            },
          },
        ],
      },
      layout: null,
      by: "preset",
      enabled: true,
      created: NOW - 40 * DAY,
    });
    const m = mapOf(7, w.correo);
    const out = m.edges.filter((e) => e.from === "flow:leer-elegida" && e.kind === "proposes");
    expect(out).toHaveLength(1);
    expect(out[0]?.to).toBe("boni:inbox");
    expect(out[0]?.steps).toEqual(["n_tasks"]);
    expect(out[0]?.into).toEqual([`col:${w.evento}`, `col:${w.tarea}`].sort());
  });

  it("with Boni's «Traer correo», the mail goes connector → «Traer correo» → Correos, never straight in (D-50)", () => {
    const w = world();
    ensureFlow(
      store,
      {
        id: FETCH_FLOW,
        name: "Traer correo",
        trigger: { connector: "mail" },
        plan: { version: 1, steps: [{ id: "save", op: "call", tool: "mail.save", args: {} }] },
        by: "preset",
      },
      NOW,
    );
    const m = mapOf(7, w.correo);
    expect(m.nodes.find((n) => n.id === `flow:${FETCH_FLOW}`)).toMatchObject({
      kind: "flow",
      name: "Traer correo",
      pack: "correo",
    });
    expect(edgeOf(m, "conn:mail", `flow:${FETCH_FLOW}`, "brings")).toMatchObject({
      n: 1,
      outside: true,
    });
    expect(edgeOf(m, `flow:${FETCH_FLOW}`, `col:${w.correo}`, "writes")).toMatchObject({
      n: 1,
      steps: ["save"],
      outside: true,
    });
    expect(edgeOf(m, "conn:mail", `col:${w.correo}`, "brings")).toBeUndefined();
    // What «Leer correo» starts on is still the mail's collection.
    expect(edgeOf(m, `col:${w.correo}`, "flow:leer-correo", "starts")).toBeDefined();
  });

  it("with Boni's «Revisar la guía», the reviewer is that flow: it learns from the Bandeja and improves «Leer correo» (D-51)", () => {
    const w = world();
    ensureFlow(
      store,
      {
        id: REVIEW_FLOW,
        name: "Revisar la guía",
        trigger: { learning: "mail" },
        plan: { version: 1, steps: [{ id: "d", op: "call", tool: "guide.decisions", args: {} }] },
        by: "preset",
      },
      NOW,
    );
    const m = mapOf(7, w.correo);
    expect(m.nodes.some((n) => n.id === "boni:review")).toBe(false);
    expect(m.nodes.find((n) => n.id === `flow:${REVIEW_FLOW}`)).toMatchObject({
      kind: "flow",
      name: "Revisar la guía",
      pack: "correo",
    });
    expect(edgeOf(m, "boni:inbox", `flow:${REVIEW_FLOW}`, "learns")).toBeDefined();
    expect(edgeOf(m, `flow:${REVIEW_FLOW}`, "flow:leer-correo", "improves")).toBeDefined();
  });

  it("with Boni's «Aviso del presupuesto», the notice is that flow: its run of the month counts at it and a «Probar» does not; what a step of it would write is proposed (D-53)", () => {
    const w = world();
    const id = `flow:${BUDGET_FLOW}`;
    const flow = ensureFlow(
      store,
      {
        id: BUDGET_FLOW,
        name: "Aviso del presupuesto",
        trigger: BUDGET_TRIGGER,
        plan: BUDGET_PLAN,
        by: "preset",
      },
      NOW - 20 * DAY,
    );
    // The month's run as the agent starts it (models.ts `warn`: background, its flow and version), and a «Probar».
    const run = (rid: string, origin: string, at: number) =>
      store.journal.startRun({
        id: rid,
        turn: null,
        origin,
        device: origin === "test" ? "portatil" : null,
        started: at,
        flow: BUDGET_FLOW,
        flowVersion: flow.version,
      });
    run("b1", "background", NOW - 2 * DAY);
    run("b0", "test", NOW - DAY);
    // Its «Avisar», as the agent logs it (a «Probar» logs its own too: it says what it would tell).
    for (const [rid, at] of [
      ["b1", NOW - 2 * DAY],
      ["b0", NOW - DAY],
    ] as const)
      store.journal.step({
        run: rid,
        step: "notify",
        kind: "call",
        decision: "allow",
        rule: "P1",
        detail: { tool: "notify", effect: "notify", integrity: "model", control: null },
        at,
      });
    const m = mapOf(7, w.correo);
    expect(m.nodes.find((n) => n.id === id)).toMatchObject({
      kind: "flow",
      name: "Aviso del presupuesto",
      trigger: { spending: "warn" },
      boni: true,
      on: true,
      by: "preset",
      runs: 1,
      last: NOW - 2 * DAY,
      calls: 0,
      roles: [],
      // It did not come with the mail.
      pack: null,
      steps: [expect.objectContaining({ id: "notify", what: "notify", deps: ["spent", "budget"] })],
    });
    // It reads and writes no collection: its one arrow is what it tells the devices, the month's notice (the test's
    // «Avisar» told nothing and counts nowhere).
    expect(m.edges.filter((e) => e.from === id || e.to === id)).toEqual([
      { from: id, to: "dev:all", kind: "tells", n: 1, steps: ["notify"], outside: false },
    ]);
    expect(m.nodes.find((n) => n.id === "dev:all")).toEqual({
      id: "dev:all",
      kind: "device",
      name: null,
      code: "devices",
      notices: 1,
    });
    const owner = (rid: string) => {
      const r = store.journal.run(rid);
      if (!r) throw new Error("no run");
      return mapOwnerOf(store, r, null);
    };
    expect([owner("b1"), owner("b0")]).toEqual([id, null]);
    // A version of Juan's with a «Crear»: it is work of Boni's own (the background), so what it writes is proposed.
    store.journal.saveFlow({
      id: BUDGET_FLOW,
      name: "Aviso del presupuesto",
      trigger: BUDGET_TRIGGER,
      inputs: [],
      plan: { version: 1, steps: [...BUDGET_PLAN.steps, create("n", keyOf(w.tarea))] },
      layout: null,
      by: "user",
      enabled: true,
      created: NOW - DAY,
    });
    const mine = mapOf(7, w.correo);
    expect(edgeOf(mine, id, "boni:inbox", "proposes")).toMatchObject({
      steps: ["n"],
      into: [`col:${w.tarea}`],
    });
    expect(edgeOf(mine, id, `col:${w.tarea}`, "writes")).toBeUndefined();
    expect(mine.nodes.find((n) => n.id === id)).toMatchObject({ boni: true, by: "user" });
  });

  it("what a flow's «Avisar» or a turn of the conversation told goes to the devices («avisa»): the arrow from the plan, its number from the journal (§4.4)", () => {
    const w = world();
    // Nothing tells yet: no devices on the map.
    expect(mapOf(7, w.correo).nodes.some((n) => n.kind === "device")).toBe(false);
    const tell = (id: string, more: Record<string, unknown> = {}) => ({
      id,
      op: "call",
      tool: "notify",
      args: { text: { lit: "Aviso de ejemplo" } },
      ...more,
    });
    const flow = (id: string, name: string, trigger: unknown, steps: unknown[], enabled = true) =>
      store.journal.saveFlow({
        id,
        name,
        trigger,
        inputs: [],
        plan: { version: 1, steps },
        layout: null,
        by: "user",
        enabled,
        created: NOW - 60 * DAY,
      });
    // One of his on a schedule: a count, then two «Avisar» (one of them once per item).
    flow("resumen-a1", "Resumen diario", { schedule: { every: "day", at: "08:00" } }, [
      { id: "q", op: "call", tool: "entities.query", args: { type: { lit: keyOf(w.tarea) } } },
      tell("a"),
      tell("b", { each: { ref: "$q.items" } }),
    ]);
    // One a mail starts: what it tells may carry the mail's words.
    flow("avisar-correo-b2", "Avisar del correo", { created: keyOf(w.correo) }, [tell("a")]);
    // One that never ran, off: its arrow is drawn all the same, with no number.
    flow("sin-uso-c3", "Sin uso", { manual: true }, [tell("a")], false);
    const run = (
      id: string,
      at: number,
      o: { flow?: string; version?: number; turn?: string; plan?: unknown },
    ) => {
      store.journal.startRun({
        id,
        turn: o.turn ?? null,
        origin: o.turn ? "turn" : "background",
        device: o.turn ? "portatil" : null,
        started: at,
        ...(o.flow ? { flow: o.flow, flowVersion: o.version ?? 1 } : {}),
      });
      if (o.plan) store.journal.setPlan(id, o.plan);
    };
    // A step's line as the agent logs it: the tool it called and that tool's effect are in the line itself.
    const step = (r: string, id: string, decision: string, at: number, tool = "notify") =>
      store.journal.step({
        run: r,
        step: id,
        kind: decision === "skip" ? "skip" : "call",
        decision,
        rule: decision === "allow" ? "P1" : null,
        detail:
          decision === "skip"
            ? null
            : {
                tool,
                effect: tool === "notify" ? "notify" : "read",
                integrity: "user",
                control: null,
              },
        at,
      });
    /** The tool refused what it was given: the run stops at that step, as the agent logs it. */
    const refused = (r: string, id: string, at: number) =>
      store.journal.step({
        run: r,
        step: id,
        kind: "error",
        decision: "stopped",
        rule: null,
        detail: { code: "tool-bad-argument" },
        at,
      });
    const QUERY = "entities.query";
    // The summary ran this week: 3 and 2 notices (one, and one per task), then a run whose «Avisar» was skipped and
    // one whose text the tool refused (allowed, and nothing left). Its other step ran too, and tells nothing. A month
    // ago it told once.
    run("s1", NOW - DAY, { flow: "resumen-a1" });
    step("s1", "q", "allow", NOW - DAY, QUERY);
    for (const id of ["a", "b", "b"]) step("s1", id, "allow", NOW - DAY);
    run("s2", NOW - 2 * DAY, { flow: "resumen-a1" });
    step("s2", "q", "allow", NOW - 2 * DAY, QUERY);
    for (const id of ["a", "b"]) step("s2", id, "allow", NOW - 2 * DAY);
    run("s3", NOW - 3 * DAY, { flow: "resumen-a1" });
    step("s3", "q", "allow", NOW - 3 * DAY, QUERY);
    step("s3", "a", "skip", NOW - 3 * DAY);
    step("s3", "b", "allow", NOW - 3 * DAY);
    refused("s3", "b", NOW - 3 * DAY);
    run("s0", NOW - 30 * DAY, { flow: "resumen-a1" });
    step("s0", "a", "allow", NOW - 30 * DAY);
    run("c1", NOW - DAY, { flow: "avisar-correo-b2" });
    step("c1", "a", "allow", NOW - DAY);
    // Versions. What a run told is in its own lines, whatever its steps were called and whichever version it ran:
    // - renamed: each version's «Avisar» has its own name, and both runs told;
    // - one that tells no more: what it told this week still shows, with no step to leave from;
    // - the old «Avisar»'s name is another kind of step today: the old version's notice counts, today's reads do not;
    // - numbered steps, moved: `s1` was a read and is the «Avisar» today (one notice, the old `s2`'s);
    // - three versions: only the middle one, which told nothing, ran (its read, three times).
    const query = (id: string) => ({
      id,
      op: "call",
      tool: QUERY,
      args: { type: { lit: keyOf(w.tarea) } },
    });
    flow("renombrado-f6", "Renombrado", { manual: true }, [tell("uno")]);
    flow("renombrado-f6", "Renombrado", { manual: true }, [tell("dos")]);
    run("n1", NOW - 2 * DAY, { flow: "renombrado-f6", version: 1 });
    step("n1", "uno", "allow", NOW - 2 * DAY);
    run("n2", NOW - DAY, { flow: "renombrado-f6", version: 2 });
    step("n2", "dos", "allow", NOW - DAY);
    flow("avisaba-g7", "Avisaba", { manual: true }, [tell("viejo")]);
    flow("avisaba-g7", "Avisaba", { manual: true }, [query("q")]);
    run("v1", NOW - 3 * DAY, { flow: "avisaba-g7", version: 1 });
    step("v1", "viejo", "allow", NOW - 3 * DAY);
    flow("reusado-h8", "Reusado", { manual: true }, [tell("x")]);
    flow("reusado-h8", "Reusado", { manual: true }, [query("x"), tell("y")]);
    run("u0", NOW - 2 * DAY, { flow: "reusado-h8", version: 1 });
    step("u0", "x", "allow", NOW - 2 * DAY);
    run("u1", NOW - DAY, { flow: "reusado-h8", version: 2 });
    for (const id of ["x", "x", "x"]) step("u1", id, "allow", NOW - DAY, QUERY);
    step("u1", "y", "allow", NOW - DAY);
    flow("numerados-j9", "Numerados", { manual: true }, [query("s1"), tell("s2")]);
    flow("numerados-j9", "Numerados", { manual: true }, [tell("s1")]);
    run("k1", NOW - DAY, { flow: "numerados-j9", version: 1 });
    step("k1", "s1", "allow", NOW - DAY, QUERY);
    step("k1", "s2", "allow", NOW - DAY);
    flow("tres-k1", "Tres versiones", { manual: true }, [tell("viejo")]);
    flow("tres-k1", "Tres versiones", { manual: true }, [query("viejo")]);
    flow("tres-k1", "Tres versiones", { manual: true }, [tell("nuevo")]);
    run("z1", NOW - DAY, { flow: "tres-k1", version: 2 });
    for (const id of ["viejo", "viejo", "viejo"]) step("z1", id, "allow", NOW - DAY, QUERY);
    // One he deleted since: it leaves the map with what it told, as with its runs.
    flow("borrado-m2", "Borrado", { manual: true }, [tell("a")]);
    run("d1", NOW - DAY, { flow: "borrado-m2" });
    for (const id of ["a", "a"]) step("d1", id, "allow", NOW - DAY);
    store.journal.setFlowDeleted("borrado-m2", true);
    // The conversation: a turn that told, one whose «Avisar» the tool refused, one that stopped before it.
    const plan = { version: 1, steps: [tell("n")] };
    run("t5", NOW - DAY, { turn: "turn-5", plan });
    step("t5", "n", "allow", NOW - DAY);
    run("t6", NOW - DAY, { turn: "turn-6", plan });
    step("t6", "n", "allow", NOW - DAY);
    refused("t6", "n", NOW - DAY);
    run("t7", NOW - DAY, { turn: "turn-7", plan });
    step("t7", "n", "deny", NOW - DAY);
    const m = mapOf(7, w.correo);
    const told = (from: string) => edgeOf(m, from, "dev:all", "tells");
    expect(told("flow:resumen-a1")).toEqual({
      from: "flow:resumen-a1",
      to: "dev:all",
      kind: "tells",
      n: 5,
      steps: ["a", "b"],
      outside: false,
    });
    expect(told("flow:avisar-correo-b2")).toMatchObject({ n: 1, steps: ["a"], outside: true });
    expect(told("flow:sin-uso-c3")).toMatchObject({ n: 0, steps: ["a"] });
    // The conversation told once: what the tool refused or the policy stopped is not a notice. No step of its own to
    // leave from.
    expect(told("boni:chat")).toEqual({
      from: "boni:chat",
      to: "dev:all",
      kind: "tells",
      n: 1,
      outside: false,
    });
    expect(told("flow:renombrado-f6")).toMatchObject({ n: 2, steps: ["dos"] });
    expect(told("flow:avisaba-g7")).toEqual({
      from: "flow:avisaba-g7",
      to: "dev:all",
      kind: "tells",
      n: 1,
      outside: false,
    });
    expect(told("flow:reusado-h8")).toMatchObject({ n: 2, steps: ["y"] });
    expect(told("flow:numerados-j9")).toMatchObject({ n: 1, steps: ["s1"] });
    expect(told("flow:tres-k1")).toMatchObject({ n: 0, steps: ["nuevo"] });
    expect(told("flow:borrado-m2")).toBeUndefined();
    expect(m.nodes.some((n) => n.id === "flow:borrado-m2")).toBe(false);
    // «Leer correo» and his flow by hand tell nothing.
    expect(told("flow:leer-correo")).toBeUndefined();
    expect(told("flow:apuntar-k2")).toBeUndefined();
    expect(m.nodes.find((n) => n.id === "dev:all")).toEqual({
      id: "dev:all",
      kind: "device",
      name: null,
      code: "devices",
      // 5 + 1 + 0 + 1 (the conversation) + 2 + 1 + 2 + 1 + 0: the arrows drawn, without the deleted flow's two.
      notices: 13,
    });
    // Nothing comes out of the devices.
    expect(m.edges.filter((e) => e.from === "dev:all")).toEqual([]);
    // A month back: the summary's older run counts too.
    expect(edgeOf(mapOf(40, w.correo), "flow:resumen-a1", "dev:all", "tells")?.n).toBe(6);
  });

  it("the devices' arrows from what the agent really leaves: a flow's «Avisar» run in the background and a turn of the conversation that tells; not what the tool refused nor what a «Probar» would tell", async () => {
    const w = world();
    const told: string[] = [];
    const telling = (text: string) => ({
      version: 1,
      steps: [{ id: "a", op: "call", tool: "notify", args: { text: { lit: text } } }],
    });
    const plan = telling("Aviso de ejemplo");
    // An «Avisar» with no text: the policy allows it and the tool refuses it.
    const empty = telling("");
    for (const [id, p] of [
      ["aviso-d4", plan],
      ["aviso-vacio-e5", empty],
    ] as const)
      store.journal.saveFlow({
        id,
        name: "Aviso de ejemplo",
        trigger: { schedule: { every: "day", at: "08:00" } },
        inputs: [],
        plan: p,
        layout: null,
        by: "user",
        enabled: true,
        created: NOW - 5 * DAY,
      });
    const agent = new Agent({
      store,
      registry: coreTools().freeze(),
      // The conversation's planner writes a plan that tells and then answers.
      planner: fakePlanner([
        {
          version: 1,
          steps: [
            { id: "n", op: "call", tool: "notify", args: { text: { lit: "Hecho" } } },
            { id: "r", op: "reply", component: "text", data: { template: { lit: "Avisado" } } },
          ],
        },
      ]),
      reader: fakePlanner([]),
      now: () => NOW - 60_000,
      notify: (text) => told.push(text),
    });
    const ran = await agent.background(plan, {}, [], undefined, {
      id: "aviso-d4",
      version: 1,
      by: "user",
    });
    const turn = await agent.turn({
      text: "avísame cuando acabes",
      origin: { kind: "turn", trust: "personal", device: "portatil" },
    });
    const refused = await agent.background(empty, {}, [], undefined, {
      id: "aviso-vacio-e5",
      version: 1,
      by: "user",
    });
    const tried = await agent.dryRun(
      plan,
      {},
      {
        origin: { kind: "background", trust: "personal", device: "portatil" },
        flow: { id: "aviso-d4", version: 1, by: "user" },
      },
    );
    expect([ran.status, turn.status, refused.error, tried.status, told]).toEqual([
      "done",
      "done",
      "tool-bad-argument",
      "done",
      ["Aviso de ejemplo", "Hecho"],
    ]);
    // Both logged their «Avisar» as allowed: the journal's lines alone do not say a notice left.
    for (const r of [refused.run, tried.run])
      expect(store.journal.steps(r)[0]).toMatchObject({ step: "a", decision: "allow" });
    const m = mapOf(7, w.correo);
    expect(edgeOf(m, "flow:aviso-d4", "dev:all", "tells")).toMatchObject({ n: 1, steps: ["a"] });
    expect(edgeOf(m, "flow:aviso-vacio-e5", "dev:all", "tells")).toMatchObject({
      n: 0,
      steps: ["a"],
    });
    expect(edgeOf(m, "boni:chat", "dev:all", "tells")).toMatchObject({ n: 1 });
    expect(m.nodes.find((n) => n.id === "dev:all")?.notices).toBe(2);
  });

  it("a page's blocks: each that paints a collection, with the values that control it (§4.6 point 7)", () => {
    const w = world();
    const blocks = [
      { id: "c_mes", type: "control", name: "Mes", kind: "month" },
      { id: "c_txt", type: "control", name: "Texto", kind: "text" },
      { id: "c_otro", type: "control", name: "Nadie", kind: "month" },
      { id: "h", type: "heading", text: "Tareas" },
      {
        id: "b_n",
        type: "number",
        title: "Este mes",
        collection: w.tarea,
        measure: "count",
        period: "$c_mes",
      },
      {
        id: "b_t",
        type: "database",
        source: w.tarea,
        view: { layout: "table", filter: [{ field: "f_titulo", op: "contains", from: "c_txt" }] },
      },
    ];
    const p = createPage(
      store,
      { title: "Gastos", spec: { version: 1, blocks } as never },
      "portatil",
    );
    const m = mapOf(7, null);
    const id = (b: string) => `block:${p.id}:${b}`;
    const n = m.nodes.find((x) => x.id === id("b_n"));
    expect(n).toMatchObject({
      kind: "block",
      code: "number",
      name: "Este mes",
      page: `page:${p.id}`,
    });
    expect(m.nodes.find((x) => x.id === id("b_t"))).toMatchObject({ code: "database", name: null });
    expect(m.nodes.find((x) => x.id === id("c_mes"))).toMatchObject({
      code: "control",
      name: "Mes",
    });
    // What it paints, and the values that control it; a value no block reads, and a heading, are not drawn.
    expect(edgeOf(m, `col:${w.tarea}`, id("b_n"), "shows")).toBeTruthy();
    expect(edgeOf(m, `col:${w.tarea}`, id("b_t"), "shows")).toBeTruthy();
    expect(edgeOf(m, id("c_mes"), id("b_n"), "controls")).toBeTruthy();
    expect(edgeOf(m, id("c_txt"), id("b_t"), "controls")).toBeTruthy();
    expect(m.nodes.some((x) => x.id === id("c_otro") || x.id === id("h"))).toBe(false);
    // The flows that write in what it paints are those that write in its collection: one arrow away from it.
    expect(edgeOf(m, "flow:apuntar-k2", `col:${w.tarea}`, "writes")).toBeTruthy();
    // Only those two: one arrow from each value a block reads.
    expect(m.edges.filter((e) => e.kind === "controls").length).toBe(2);
  });

  it("the blocks of twenty pages over a year of movements are drawn in time (A-15)", () => {
    const w = world();
    const L = label("own", "personal", []);
    for (let i = 0; i < 4000; i++)
      store.create(
        w.tarea,
        { f_titulo: { value: `Movimiento ${i}`, label: L } },
        { actor: "user" },
      );
    for (let p = 0; p < 20; p++)
      createPage(
        store,
        {
          title: `Página ${p}`,
          spec: {
            version: 1,
            blocks: [
              { id: "c_mes", type: "control", name: "Mes", kind: "month" },
              ...Array.from({ length: 10 }, (_, i) => ({
                id: `b${i}`,
                type: "number",
                collection: w.tarea,
                measure: "count",
                period: "$c_mes",
              })),
            ],
          } as never,
        },
        "portatil",
      );
    const t0 = performance.now();
    const m = mapOf(30, null);
    const ms = performance.now() - t0;
    expect(m.nodes.filter((n) => n.kind === "block").length).toBe(1 + 20 * 11);
    expect(ms).toBeLessThan(1500);
  }, 30_000);

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
    let inPeriod = 0;
    for (let i = 0; i < 12_000; i++) {
      const at = NOW - (i % 365) * DAY - (i % 7) * 60_000;
      if (at >= NOW - 30 * DAY && at < NOW) inPeriod++;
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
          args: proposalArgs(type, `yp${i}`),
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
        // As big as a mail's reading: counting a step's calls never reads these texts (task 90).
        request: { kind: "read_message", text: "x".repeat(6000) },
        response: {},
        usage: { input: 100, output: 10, cost: 0.001 },
        at,
        step: "r",
      });
      // Its lines in the journal, as the agent logs them: a read, and a notice the run told.
      for (const [step, tool, effect] of [
        ["m", "entities.query", "read"],
        ["n", "notify", "notify"],
      ] as const)
        store.journal.step({
          run: `y${i}`,
          step,
          kind: "call",
          decision: "allow",
          rule: "P1",
          detail: { tool, effect, integrity: "user", control: null },
          at,
        });
    }
    const t0 = performance.now();
    const m = mapOf(30, w.correo);
    const ms = performance.now() - t0;
    const leer = m.nodes.find((n) => n.id === "flow:leer-correo");
    expect(leer?.runs).toBeGreaterThan(900);
    // Its reading's calls of the period, on its step.
    expect(leer?.steps?.find((s) => s.id === "r")?.calls).toBe(inPeriod);
    // What the period's runs told, counted from the journal's lines in the same time.
    expect(edgeOf(m, "flow:leer-correo", "dev:all", "tells")?.n).toBe(inPeriod);
    expect(ms).toBeLessThan(1500);
    // What is measured is the map (above); writing a year of runs first takes longer than vitest's 5 s on CI's machine.
  }, 30_000);
});
