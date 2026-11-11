import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakePlanner } from "@boni/agent";
import { label, newId } from "@boni/entities";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { addUser } from "./auth.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds } from "./feeds.ts";
import { type App, makeApp, serve } from "./http.ts";
import { LoginGuard } from "./limits.ts";

/**
 * The actions of «Datos», «Flujos» and «Corregir» of the Bandeja (docs/sistema.md §4.1, F10) as Juan asks for them in
 * the conversation and as an assistant runs them by the MCP, over HTTP with a scripted planner (no model, no
 * network), on collections shaped like his: generated ids, fields named in Spanish with accents.
 */
const PASSWORD = "una contraseña larga de ejemplo";
const lit = (v: unknown) => ({ lit: v });
let dir: string;
let db: Db;
let app: App;
let host: AgentHost;
const servers: Server[] = [];
let base: string;
const plans: unknown[] = [];
const own = label("user", "personal", [{ kind: "user-edit", id: "ejemplo" }]);
// As Juan's are: ids the app generated, never the collection's key.
const MOV = newId("t");
const F = { concepto: newId("f"), importe: newId("f"), categoria: newId("f"), fecha: newId("f") };
const TAREA = newId("t");
const TITULO = newId("f");
const NOTA = newId("t");
const NOTA_TITULO = newId("f");
const LIBRO = newId("t");
const LECTURA = newId("t");

async function listen(s: Server): Promise<string> {
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
async function login() {
  const r = await fetch(`${base}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user: "juan", password: PASSWORD, device: "portatil-ejemplo" }),
  });
  return ((await r.json()) as { token: string }).token;
}
const call = async (token: string, method: string, path: string, body?: unknown) =>
  (await (
    await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  ).json()) as Record<string, unknown>;
const post = async (token: string, path: string, body: unknown = {}) =>
  (await (
    await fetch(`${base}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  ).json()) as Record<string, unknown>;
type Turn = {
  run: string;
  status: string;
  error: string | null;
  changed?: boolean;
  pending: {
    kind: string;
    id: string;
    view: {
      title: string;
      rows: { arg: string; value: unknown; name?: string; detail?: string }[];
    };
  } | null;
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-data-actions-"));
  db = openDb(join(dir, "system.db"));
  addUser(db, "juan", PASSWORD);
  const planner = fakePlanner([]);
  planner.complete = async () => ({
    json: plans.shift(),
    usage: { input: 1, output: 1 },
    model: "fake",
  });
  host = new AgentHost({ dataDir: dir, providers: { planner, reader: planner } });
  app = makeApp({
    db,
    key: randomBytes(32),
    feeds: new Feeds(async () => ""),
    guard: new LoginGuard({ perUser: 50, perAddress: 100, windowMs: 60_000, perMinute: 100 }),
    agent: host,
  });
  base = await listen(serve(app, "tailnet"));
  const store = host.store(1);
  const opt = (name: string) => ({ id: newId("o"), name, label: own });
  store.applySchema(
    {
      op: "create_type",
      type: {
        id: MOV,
        key: "movimientos",
        name: "Movimientos",
        fields: [
          { id: F.concepto, key: "concepto", name: "Concepto", type: "text", label: own },
          { id: F.importe, key: "importe", name: "Importe", type: "number", label: own },
          {
            id: F.categoria,
            key: "categoria",
            name: "Categoría",
            type: "select",
            options: [opt("Comida"), opt("Transporte"), opt("Casa")],
            label: own,
          },
          { id: F.fecha, key: "fecha", name: "Fecha", type: "date", label: own },
        ],
        titleField: F.concepto,
        sensitivity: "personal",
        schemaVersion: 1,
        label: own,
      },
    },
    { actor: "user" },
  );
  store.applySchema(
    {
      op: "create_type",
      type: {
        id: TAREA,
        key: "tareas",
        name: "Tareas",
        fields: [{ id: TITULO, key: "titulo", name: "Título", type: "text", label: own }],
        titleField: TITULO,
        sensitivity: "personal",
        schemaVersion: 1,
        label: own,
      },
    },
    { actor: "user" },
  );
  const simple = (id: string, key: string, name: string, title = newId("f")) =>
    store.applySchema(
      {
        op: "create_type",
        type: {
          id,
          key,
          name,
          fields: [{ id: title, key: "titulo", name: "Título", type: "text", label: own }],
          titleField: title,
          sensitivity: "personal",
          schemaVersion: 1,
          label: own,
        },
      },
      { actor: "user" },
    );
  simple(NOTA, "notas", "Notas", NOTA_TITULO);
  simple(LIBRO, "libros", "Libros");
  simple(LECTURA, "lecturas", "Lecturas");
});

afterAll(async () => {
  for (const s of servers) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
  app.close();
  host.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const turnOf = async (token: string, text: string, steps: unknown[], screen?: unknown) => {
  plans.push({ version: 1, steps });
  return (await post(token, "/api/agent/turn", {
    text,
    ...(screen ? { screen } : {}),
  })) as unknown as Turn;
};
const confirm = async (token: string, turn: Turn) =>
  (await post(token, "/api/agent/confirm", {
    run: turn.run,
    confirmation: turn.pending?.id,
  })) as unknown as Turn;
const typeOf = (id: string) => host.store(1).schema().types[id];

describe("the list of actions: «Datos», «Flujos» and «Corregir» (docs/sistema.md §4.1, F10)", () => {
  it("«llama Gastos a Movimientos, mete Libros en Lecturas y pasa esta nota a Tareas»: done in his turn, and Undo of the run takes it all back", async () => {
    const token = await login();
    const store = host.store(1);
    const { entity: note } = store.create(
      NOTA,
      { [NOTA_TITULO]: { value: "Llamar al fontanero", label: own } },
      { actor: "user", device: "portatil-ejemplo" },
    );
    const turn = await turnOf(
      token,
      "llama Gastos a Movimientos, mete Libros en Lecturas…",
      [
        {
          id: "a",
          op: "call",
          tool: "schema.rename_type",
          args: { type: lit("movimientos"), name: lit("Gastos") },
        },
        {
          id: "b",
          op: "call",
          tool: "schema.move_type",
          args: { type: lit("libros"), parent: lit("lecturas") },
        },
        {
          id: "c",
          op: "call",
          tool: "schema.update_field",
          args: {
            type: lit("movimientos"),
            field: lit("categoria"),
            name: lit("Tipo"),
            options: lit("Comida, Casa, Ocio"),
          },
        },
        {
          id: "d",
          op: "call",
          tool: "entities.move",
          args: { id: { ref: "$screen.chosen[0].id" }, type: lit("tareas") },
        },
      ],
      // «esta nota»: the one chosen in the table open on his screen.
      { open: { kind: "collection", id: NOTA }, inbox: [], chosen: [note.id] },
    );
    expect(turn.error).toBeNull();
    expect(turn.status).toBe("done");
    expect(typeOf(MOV)).toMatchObject({ key: "movimientos", name: "Gastos" });
    expect(typeOf(LIBRO)?.parent).toBe(LECTURA);
    const tipo = typeOf(MOV)?.fields.find((f) => f.id === F.categoria);
    // The options it had keep their ids (and with them the records that use them); a new one is added.
    const before = ["Comida", "Casa"].map(
      (n) => tipo?.options?.find((o) => o.name === n)?.id ?? "?",
    );
    expect(tipo?.name).toBe("Tipo");
    expect(tipo?.options?.map((o) => o.name)).toEqual(["Comida", "Casa", "Ocio"]);
    expect(before.every((id) => id.startsWith("o_") || id.length > 3)).toBe(true);
    expect(store.get(note.id)?.entity.type).toBe(TAREA);

    // The whole request, undone at once.
    const undone = await post(token, `/api/agent/runs/${turn.run}/undo`);
    expect(undone.undone).toBeGreaterThanOrEqual(4);
    expect(typeOf(MOV)?.name).toBe("Movimientos");
    expect(typeOf(LIBRO)?.parent ?? null).toBeNull();
    expect(typeOf(MOV)?.fields.find((f) => f.id === F.categoria)?.name).toBe("Categoría");
    expect(store.get(note.id)?.entity.type).toBe(NOTA);

    // A name a model writes is text, never markup; a collection it names wrong is refused.
    const bad = await turnOf(token, "y llama a otra", [
      {
        id: "a",
        op: "call",
        tool: "schema.rename_type",
        args: { type: lit("presupuestos"), name: lit("Otra") },
      },
    ]);
    expect(JSON.stringify(bad)).toMatch(/unknown-type|not-found/);
  });

  it("a collection deleted and a field taken out only on Juan's touch, and back with Undo of the run", async () => {
    const token = await login();
    const del = await turnOf(token, "borra Libros y quita Fecha de Movimientos", [
      { id: "a", op: "call", tool: "schema.delete_type", args: { type: lit("libros") } },
      {
        id: "b",
        op: "call",
        tool: "schema.remove_field",
        args: { type: lit("movimientos"), field: lit("fecha") },
      },
    ]);
    // Nothing goes before his touch.
    expect(del.pending?.kind).toBe("confirm");
    expect(typeOf(LIBRO)?.archived).toBeFalsy();
    let done = await confirm(token, del);
    // A second card for the second, each painted by the code.
    if (done.pending?.kind === "confirm") done = await confirm(token, done);
    expect(done.status).toBe("done");
    expect(typeOf(LIBRO)?.archived).toBe(true);
    expect(typeOf(MOV)?.fields.find((f) => f.id === F.fecha)?.archived).toBe(true);
    expect((await post(token, `/api/agent/runs/${del.run}/undo`)).undone).toBe(2);
    expect(typeOf(LIBRO)?.archived).toBeFalsy();
    expect(typeOf(MOV)?.fields.find((f) => f.id === F.fecha)?.archived).toBeFalsy();
  });

  it("a flow switched on only on Juan's touch, never from background work, tried by an assistant, deleted on his card, and Undo of the run switches it back", async () => {
    const token = await login();
    const made = (await call(token, "POST", "/api/agent/flows", {
      name: "Cuántas tareas",
    })) as { id: string };
    const trigger = { manual: true, inputs: [{ name: "titulo" }] };
    const plan = {
      version: 1,
      steps: [
        {
          id: "n",
          op: "call",
          tool: "entities.aggregate",
          args: { type: lit("tareas"), op: lit("count") },
        },
        {
          id: "r",
          op: "reply",
          component: "text",
          data: { template: { ref: "$titulo" }, a: { ref: "$n" } },
        },
      ],
    };
    expect(
      await call(token, "PUT", `/api/agent/flows/${made.id}`, { base: 1, trigger, plan }),
    ).toMatchObject({ version: 2 });
    const store = host.store(1);
    const on = await turnOf(token, "enciende Cuántas tareas", [
      { id: "e", op: "call", tool: "flows.enable", args: { flow: lit(made.id), on: lit(true) } },
    ]);
    // His touch (P21): the card names the flow, and it is off until he confirms.
    expect(on.pending?.kind).toBe("confirm");
    expect(JSON.stringify(on.pending?.view.rows)).toContain("Cuántas tareas");
    expect(store.journal.flow(made.id)?.enabled).toBe(false);
    const done = await confirm(token, on);
    expect(done.status).toBe("done");
    // Its turn offers «Deshacer», though the store's log has nothing of it.
    expect(done.changed).toBe(true);
    expect(store.journal.flow(made.id)?.enabled).toBe(true);
    // Undo of the run switches it back off.
    expect(await post(token, `/api/agent/runs/${on.run}/undo`)).toEqual({ undone: 1 });
    expect(store.journal.flow(made.id)?.enabled).toBe(false);

    // Never from what Boni does on its own.
    const bg = await host.agent(1).background({
      version: 1,
      steps: [
        { id: "e", op: "call", tool: "flows.enable", args: { flow: lit(made.id), on: lit(true) } },
      ],
    });
    expect(JSON.stringify(bg)).toContain("P21");
    expect(store.journal.flow(made.id)?.enabled).toBe(false);

    // Tried in his turn (it changes nothing) and by an assistant by the MCP (task 63, point 13).
    const tried = await turnOf(token, "prueba Cuántas tareas", [
      {
        id: "t",
        op: "call",
        tool: "flows.test",
        args: { flow: lit(made.id), inputs: { fn: "obj", args: [lit("titulo"), lit("Hay {a}")] } },
      },
    ]);
    expect(tried.error).toBeNull();
    expect(tried.status).toBe("done");
    const mcp = (await post(token, "/api/mcp", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "flows_test", arguments: { flow: made.id, inputs: { titulo: "Hay {a}" } } },
    })) as { result: { content: { text: string }[]; isError: boolean } };
    expect(mcp.result.isError).toBe(false);
    const dry = JSON.parse(mcp.result.content[0]?.text ?? "{}") as {
      status: string;
      steps: Record<string, { decision: string }>;
    };
    expect(dry.status).toBe("done");
    expect(dry.steps.n).toMatchObject({ decision: "allow" });
    // Decisions and counts, never a text of his (the sample, what a step would write).
    expect(mcp.result.content[0]?.text).not.toContain("Hay");

    // A flow never tries one: no step of «Añadir paso», and its checklist says why.
    const inFlow = (await call(token, "POST", "/api/agent/flows/check", {
      trigger,
      plan: {
        version: 1,
        steps: [{ id: "t", op: "call", tool: "flows.test", args: { flow: lit(made.id) } }],
      },
    })) as { problems: { step: string; code: string }[] };
    expect(inFlow.problems).toContainEqual(
      expect.objectContaining({ step: "t", code: "flow-in-flow" }),
    );

    // Deleting is his card; Undo of the run brings it back.
    const del = await turnOf(token, "borra Cuántas tareas", [
      { id: "d", op: "call", tool: "flows.delete", args: { flow: lit(made.id) } },
    ]);
    expect(del.pending?.kind).toBe("confirm");
    const listed = () => store.journal.flows().some((f) => f.id === made.id);
    expect(listed()).toBe(true);
    expect((await confirm(token, del)).status).toBe("done");
    expect(listed()).toBe(false);
    expect(await post(token, `/api/agent/runs/${del.run}/undo`)).toEqual({ undone: 1 });
    expect(listed()).toBe(true);
  });

  it("«corrígela: Pedir cita en el taller el lunes, en Notas»: a proposal accepted corrected on Juan's touch", async () => {
    const token = await login();
    const store = host.store(1);
    const [id] = (
      await host.agent(1).background({
        version: 1,
        steps: [
          {
            id: "c",
            op: "call",
            tool: "entities.create",
            args: {
              type: lit("tareas"),
              values: { fn: "obj", args: [lit("titulo"), lit("Pedir cita en el taller")] },
            },
          },
        ],
      })
    ).proposals;
    if (!id) throw new Error("no proposal");
    const fix = await turnOf(token, "corrígela: el lunes, y en Notas", [
      {
        id: "f",
        op: "call",
        tool: "inbox.correct",
        args: {
          proposal: lit(id),
          title: lit("Pedir cita en el taller el lunes"),
          collection: lit("notas"),
        },
      },
    ]);
    expect(fix.pending?.kind).toBe("confirm");
    expect(store.journal.proposal(id)?.status).toBe("pending");
    expect((await confirm(token, fix)).status).toBe("done");
    expect(store.journal.proposal(id)?.status).toBe("accepted");
    expect(store.list(NOTA).map((e) => e.entity.values[NOTA_TITULO])).toContain(
      "Pedir cita en el taller el lunes",
    );
  });
  it("what Juan keeps closed stays his: an opaque note is not moved, a collection not open to the models is not renamed by an assistant, and a name a model writes is text", async () => {
    const token = await login();
    const store = host.store(1);
    const mcp = async (name: string, args: Record<string, unknown>) =>
      (
        (await post(token, "/api/mcp", {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        })) as { result: { content: { text: string }[]; isError: boolean } }
      ).result;
    const { entity: note } = store.create(
      NOTA,
      { [NOTA_TITULO]: { value: "Revisión médica de ejemplo", label: own } },
      { actor: "user", device: "portatil-ejemplo" },
    );
    store.setAiAccess(NOTA, "opaque", "portatil-ejemplo");
    try {
      // Moved to a collection open to the models, it would be read: his decision alone (A-04).
      await turnOf(
        token,
        "pasa esta nota a Tareas",
        [
          {
            id: "d",
            op: "call",
            tool: "entities.move",
            args: { id: { ref: "$screen.chosen[0].id" }, type: lit("tareas") },
          },
        ],
        { open: { kind: "collection", id: NOTA }, inbox: [], chosen: [note.id] },
      );
      expect(store.get(note.id)?.entity.type).toBe(NOTA);
      expect((await mcp("move_note", { id: note.id, type: "tareas" })).isError).toBe(true);
      expect((await mcp("rename_collection", { type: "notas", name: "Apuntes" })).isError).toBe(
        true,
      );
      expect(store.get(note.id)?.entity.type).toBe(NOTA);
      expect(typeOf(NOTA)?.name).toBe("Notas");
    } finally {
      store.setAiAccess(NOTA, "visible", "portatil-ejemplo");
    }
    // An assistant's name is its words: an image in it is painted as text, never loaded.
    const named = await mcp("rename_collection", {
      type: "lecturas",
      name: "Lecturas ![x](https://ejemplo.example/p.png)",
    });
    expect(named.isError).toBe(false);
    expect(typeOf(LECTURA)?.name).not.toContain("![");
    expect(typeOf(LECTURA)?.name).not.toContain("https://");
    expect((await mcp("rename_collection", { type: "lecturas", name: "Lecturas" })).isError).toBe(
      false,
    );
  });
});
