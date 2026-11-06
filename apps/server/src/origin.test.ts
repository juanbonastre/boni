import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSystemTypes } from "@boni/agent";
import { label } from "@boni/entities";
import { openUserStore, type UserStore } from "@boni/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCollection, createRow } from "./data.ts";
import { mcpAnswer } from "./mcp.ts";
import { originFacts, pendingFacts, recordOrigin } from "./origin.ts";

/**
 * «¿De dónde viene?» (docs/sistema.md §4.4, F8): from a record to who made it, and, when a flow proposed it, to the
 * run that did, the mail that started it and the «Aceptar». Data shaped like Juan's: generated ids, his collections'
 * names, a mail read by «Leer correo», a proposal accepted as the agent accepts one (a run of its own that keeps it).
 */
let dir: string;
let store: UserStore;
const NOW = Date.UTC(2026, 10, 5, 10);
const MIN = 60_000;
const L = label("own", "personal", []);
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "boni-origin-"));
  store = openUserStore(join(dir, "user.db"), { now: () => NOW });
  ensureSystemTypes(store);
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function world() {
  const correo = createCollection(store, { name: "Correo" }, "portatil").id;
  const tarea = createCollection(store, { name: "Tarea" }, "portatil").id;
  const key = store.schema().types[tarea]?.key as string;
  const mail = store.create(
    correo,
    { f_titulo: { value: "Reunión el jueves", label: L } },
    { actor: "connector" },
  ).entity.id;
  // «Leer correo» read it and proposed a task; Juan accepted it: a run of its own, which keeps the proposal.
  store.journal.startRun({
    id: "r_lectura_01",
    turn: null,
    origin: "background",
    device: null,
    started: NOW - 30 * MIN,
    flow: "leer-correo",
    flowVersion: 3,
    input: mail,
  });
  store.journal.addProposal({
    id: "p_01",
    run: "r_lectura_01",
    tool: "entities.create",
    args: { values: { type: { t: "v", value: key } }, origins: [] },
    view: { title: "Crear", rows: [{ arg: "values.title", value: "Preparar la reunión" }] },
    sources: [`entity:${mail}`],
    created: NOW - 29 * MIN,
  });
  const accept = (id: string, proposal: string | null, at: number) => {
    store.journal.startRun({
      id,
      turn: null,
      origin: "accepted",
      device: null,
      started: at,
      ...(proposal ? { proposal } : {}),
    });
    store.journal.setProposal(proposal ?? "p_02", "accepted", at);
    return store.create(
      tarea,
      { f_titulo: { value: "Preparar la reunión", label: L } },
      { actor: "agent", run: id, by: "agent" },
    ).entity.id;
  };
  const accepted = accept("r_acepta_01", "p_01", NOW - 10 * MIN);
  // One accepted before runs kept their proposal: found as the proposal accepted when its run started.
  store.journal.addProposal({
    id: "p_02",
    run: "r_lectura_01",
    tool: "entities.create",
    args: { values: { type: { t: "v", value: key } }, origins: [] },
    view: {},
    sources: [],
    created: NOW - 28 * MIN,
  });
  const older = accept("r_acepta_02", null, NOW - 5 * MIN);
  const mine = createRow(store, tarea, { f_titulo: "Llamar al taller" }, "portatil").id;
  const claude = store.create(
    tarea,
    { f_titulo: { value: "Revisar el contrato", label: L } },
    { actor: "agent", device: "claude-ejemplo", by: "mcp:claude-ejemplo" },
  ).entity.id;
  return { mail, accepted, older, mine, claude };
}

describe("«¿De dónde viene?» (F8)", () => {
  it("a record accepted from the Bandeja leads to the reading that proposed it and its mail", () => {
    const w = world();
    expect(recordOrigin(store, w.accepted, { mailAccount: null })).toEqual({
      by: "flow",
      at: NOW,
      device: null,
      run: {
        id: "r_lectura_01",
        flow: "leer-correo",
        flowVersion: 3,
        started: NOW - 30 * MIN,
        owner: "flow:leer-correo",
      },
      input: { id: w.mail, title: "Reunión el jueves", collection: "Correo" },
      proposal: {
        title: "Preparar la reunión",
        created: NOW - 29 * MIN,
        decided: NOW - 10 * MIN,
        alone: false,
      },
    });
    // Accepted before the run kept its proposal: the one accepted as it started.
    expect(recordOrigin(store, w.older, { mailAccount: null })?.run?.id).toBe("r_lectura_01");
    expect(recordOrigin(store, w.older, { mailAccount: null })?.proposal?.created).toBe(
      NOW - 28 * MIN,
    );
  });

  it("the same for a model: the planner's facts and the MCP's «origin», the mail only as a model may see it (task 86)", async () => {
    const w = world();
    store.journal.saveFlow({
      id: "leer-correo",
      name: "Leer correo",
      trigger: { created: "correo" },
      inputs: [],
      plan: { version: 1, steps: [] },
      layout: null,
      by: "preset",
      enabled: true,
      created: NOW - 40 * 24 * 60 * MIN,
    });
    expect(originFacts(store, w.accepted, { mailAccount: null })).toEqual({
      by: "flow",
      at: NOW,
      device: null,
      flow: { id: "leer-correo", name: "Leer correo", version: 3 },
      input: w.mail,
      proposal: { created: NOW - 29 * MIN, decided: NOW - 10 * MIN, alone: false },
    });
    expect(originFacts(store, w.claude, { mailAccount: null })).toMatchObject({
      by: "assistant",
      device: "claude-ejemplo",
      flow: null,
      input: null,
      proposal: null,
    });
    const origin = async (id: string) => {
      const r = (await mcpAnswer(store, "claude-ejemplo", {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "origin", arguments: { id } },
      })) as { result: { content: { text: string }[]; isError: boolean } };
      const text = r.result.content[0]?.text ?? "null";
      return { error: r.result.isError, out: r.result.isError ? text : JSON.parse(text) };
    };
    const got = await origin(w.accepted);
    expect(got.error).toBe(false);
    expect(got.out).toMatchObject({
      id: w.accepted,
      by: "flow",
      flow: { name: "Leer correo", version: 3 },
      input: { id: w.mail, collection: "Correo", title: "Reunión el jueves" },
      proposed: new Date(NOW - 29 * MIN).toISOString(),
      accepted: new Date(NOW - 10 * MIN).toISOString(),
      alone: false,
    });
    // Closed to the models, the mail is not named; a record closed to them has no origin to give.
    const types = Object.values(store.schema().types);
    const correo = types.find((t) => t.name === "Correo")?.id as string;
    const tarea = types.find((t) => t.name === "Tarea")?.id as string;
    store.setAiAccess(correo, "restricted", "portatil");
    expect((await origin(w.accepted)).out.input).toBeNull();
    store.setAiAccess(tarea, "restricted", "portatil");
    expect(await origin(w.accepted)).toEqual({
      error: true,
      out: "not found (or not for a model)",
    });
  });

  it("what waits in the Bandeja, for a model: who proposed each and from what mail, by its title's words; none into a collection closed to them (task 86)", async () => {
    const w = world();
    const tarea = Object.values(store.schema().types).find((t) => t.name === "Tarea");
    const correo = Object.values(store.schema().types).find((t) => t.name === "Correo");
    if (!tarea || !correo) throw new Error("the world has Tarea and Correo");
    store.journal.addProposal({
      id: "p_03",
      run: "r_lectura_01",
      tool: "entities.create",
      args: { values: { type: { t: "v", value: tarea.key } }, origins: [] },
      view: { title: "Crear", rows: [{ arg: "values.title", value: "Reservar la sala" }] },
      sources: [`entity:${w.mail}`],
      created: NOW - 27 * MIN,
    });
    expect(pendingFacts(store, { mailAccount: null })).toEqual([
      {
        id: "p_03",
        title: "Reservar la sala",
        type: tarea.id,
        created: NOW - 27 * MIN,
        by: "flow",
        flow: { id: "leer-correo", name: "leer-correo", version: 3 },
        input: w.mail,
      },
    ]);
    // The MCP's «inbox», for a session that may only read.
    const inbox = async (args: Record<string, unknown>) => {
      const r = (await mcpAnswer(
        store,
        "claude-ejemplo",
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "inbox", arguments: args } },
        () => NOW,
        ["read"],
      )) as { result: { content: { text: string }[]; isError: boolean } };
      expect(r.result.isError).toBe(false);
      return JSON.parse(r.result.content[0]?.text ?? "null");
    };
    expect(await inbox({ text: "sala" })).toMatchObject([
      {
        id: "p_03",
        title: "Reservar la sala",
        collection: "Tarea",
        proposed: new Date(NOW - 27 * MIN).toISOString(),
        by: "flow",
        flow: { id: "leer-correo", version: 3 },
        input: { id: w.mail, collection: "Correo", title: "Reunión el jueves" },
      },
    ]);
    expect(await inbox({ text: "taller" })).toEqual([]);
    // Its mail closed to the models is not named; a collection closed to them has nothing in the Bandeja for them.
    store.setAiAccess(correo.id, "restricted", "portatil");
    expect((await inbox({}))[0]?.input).toBeNull();
    store.setAiAccess(tarea.id, "restricted", "portatil");
    expect(await inbox({})).toEqual([]);
  });

  it("a reading from before flows: «Leer correo»'s, with the mail its plan read first", () => {
    const w = world();
    const correo = store.get(w.mail)?.entity.type as string;
    const old = store.create(
      correo,
      { f_titulo: { value: "Cambio de horario", label: L } },
      { actor: "connector" },
    ).entity.id;
    // As a reading's plan was then: the mail read first, then what it may create.
    const plan = {
      version: 1,
      steps: [
        { id: "m", op: "call", tool: "entities.get", args: { id: { lit: old } } },
        { id: "n0", op: "call", tool: "entities.create", args: { type: { lit: "x" } } },
      ],
    };
    store.journal.startRun({
      id: "r_vieja",
      turn: null,
      origin: "background",
      device: null,
      started: NOW - 60 * MIN,
    });
    store.journal.finishRun("r_vieja", "done", plan, NOW - 59 * MIN);
    store.journal.addProposal({
      id: "p_vieja",
      run: "r_vieja",
      tool: "entities.create",
      args: { values: { type: { t: "v", value: "x" } }, origins: [] },
      view: { title: "Avisar del horario" },
      sources: [],
      created: NOW - 59 * MIN,
    });
    store.journal.startRun({
      id: "r_acepta_v",
      turn: null,
      origin: "accepted",
      device: null,
      started: NOW - 2 * MIN,
      proposal: "p_vieja",
    });
    store.journal.setProposal("p_vieja", "accepted", NOW - 2 * MIN);
    const tarea = Object.values(store.schema().types).find((t) => t.name === "Tarea")?.id as string;
    const made = store.create(
      tarea,
      { f_titulo: { value: "Avisar del horario", label: L } },
      { actor: "agent", run: "r_acepta_v", by: "agent" },
    ).entity.id;
    expect(recordOrigin(store, made, { mailAccount: null })).toMatchObject({
      by: "flow",
      run: { id: "r_vieja", flow: "leer-correo", owner: "flow:leer-correo" },
      input: { id: old, title: "Cambio de horario", collection: "Correo" },
      proposal: { title: "Avisar del horario" },
    });
  });

  it("one written by hand, by an assistant or by the mail's connector says who and where", () => {
    const w = world();
    expect(recordOrigin(store, w.mine, { mailAccount: null })).toMatchObject({
      by: "user",
      device: "portatil",
      run: null,
      proposal: null,
    });
    expect(recordOrigin(store, w.claude, { mailAccount: null })).toMatchObject({
      by: "assistant",
      device: "claude-ejemplo",
      run: null,
    });
    expect(recordOrigin(store, w.mail, { mailAccount: null })).toMatchObject({
      by: "connector",
      run: null,
    });
    expect(recordOrigin(store, "e_no_existe", { mailAccount: null })).toBeNull();
  });
});
