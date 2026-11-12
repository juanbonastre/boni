import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakePlanner } from "@boni/agent";
import { label } from "@boni/entities";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { addUser } from "./auth.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds } from "./feeds.ts";
import { ensureFlow } from "./flows.ts";
import { type App, makeApp, serve } from "./http.ts";
import { LoginGuard } from "./limits.ts";
import { createPage, updatePage } from "./pages.ts";

/**
 * A page's buttons pressed (docs/sistema.md §4.6 points 4 and 5, D-60), over HTTP with no planner: a flow started with
 * the page's values, an action with a value of the page, its Undo and its confirmation. Collections shaped like a
 * user's (e2e/server-data.ts): movements whose category is a relation to a collection of categories, generated ids.
 * Invented data.
 */
const PASSWORD = "una contraseña larga de ejemplo";
const CAT = "t_01kcat0000000000000000000a";
const MOV = "t_01kmov0000000000000000000b";
const CAFE = "e_01kcafe00000000000000000000";
const own = label("user", "personal", [{ kind: "user-edit", id: "ejemplo" }]);
let dir: string;
let db: Db;
let app: App;
let host: AgentHost;
let base: string;
let token: string;
const servers: Server[] = [];
/** The planner is never asked: a press runs what the button names. */
let planned = 0;

const post = (path: string, body: unknown = {}) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
type Turn = {
  run: string;
  status: string;
  changed?: boolean;
  pending: { kind: string; id: string } | null;
  replies: { data: Record<string, { value: unknown; integrity: string }> }[];
};
const press = async (page: string, block: string) => {
  const r = await post("/api/agent/press", { page, block });
  return { status: r.status, body: (await r.json()) as Turn & { error?: string } };
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-buttons-"));
  db = openDb(join(dir, "system.db"));
  addUser(db, "juan", PASSWORD);
  const planner = fakePlanner([]);
  planner.complete = async () => {
    planned++;
    return { json: { version: 1, steps: [] }, usage: { input: 1, output: 1 }, model: "fake" };
  };
  host = new AgentHost({ dataDir: dir, providers: { planner, reader: planner } });
  app = makeApp({
    db,
    key: randomBytes(32),
    feeds: new Feeds(async () => ""),
    guard: new LoginGuard({ perUser: 50, perAddress: 100, windowMs: 60_000, perMinute: 100 }),
    agent: host,
  });
  const s = serve(app, "tailnet");
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  const r = await fetch(`${base}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user: "juan", password: PASSWORD, device: "movil-ejemplo" }),
  });
  token = ((await r.json()) as { token: string }).token;
  const store = host.store(1);
  const type = (id: string, key: string, name: string, fields: unknown[]) =>
    store.applySchema(
      {
        op: "create_type",
        type: {
          id,
          key,
          name,
          fields,
          titleField: fields.length ? (fields[0] as { id: string }).id : "",
          sensitivity: "personal",
          schemaVersion: 1,
          label: own,
        } as never,
      },
      { actor: "user" },
    );
  type(CAT, "categoria", "Categorías", [
    { id: "f_cat_nombre", key: "title", name: "Nombre", type: "text", label: own },
    { id: "f_cat_tope", key: "budget", name: "Tope", type: "money", label: own },
  ]);
  type(MOV, "movimiento", "Movimientos", [
    { id: "f_mov_concepto", key: "title", name: "Concepto", type: "text", label: own },
    { id: "f_mov_importe", key: "amount", name: "Importe", type: "money", label: own },
    {
      id: "f_mov_categoria",
      key: "category",
      name: "Categoría",
      type: "relation",
      relation: { target: CAT, many: false },
      label: own,
    },
  ]);
  store.create(CAT, { f_cat_nombre: { value: "Cafés", label: own } }, { actor: "user" }, CAFE);
  ensureFlow(
    store,
    {
      id: "resumen-del-mes-3fa9c1",
      name: "Resumen del mes",
      trigger: { manual: true, inputs: [{ name: "mes" }, { name: "categoria" }, { name: "nota" }] },
      plan: {
        version: 1,
        steps: [
          {
            id: "r",
            op: "reply",
            component: "text",
            data: {
              template: { lit: "{a} · {b} · {c}" },
              a: { ref: "$mes" },
              b: { ref: "$categoria" },
              c: { ref: "$nota" },
            },
          },
        ],
      },
      by: "user",
    },
    Date.now(),
  );
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

const controls = (cat?: string, month?: string) => [
  {
    id: "b_cat",
    type: "control",
    name: "Categoría",
    kind: "option",
    collection: MOV,
    field: "f_mov_categoria",
    ...(cat ? { value: cat } : {}),
  },
  { id: "b_mes", type: "control", name: "Mes", kind: "month", ...(month ? { value: month } : {}) },
];
const buttons = [
  {
    id: "b_resumen",
    type: "action",
    label: "Resumir",
    does: "flow",
    flow: "resumen-del-mes-3fa9c1",
    inputs: { mes: "$b_mes", categoria: "$b_cat", nota: "desde la página" },
  },
  {
    id: "b_cafe",
    type: "action",
    label: "Café",
    does: "action",
    action: "entities.create",
    collection: MOV,
    set: { f_mov_concepto: "Café", f_mov_importe: 1.6, f_mov_categoria: "$b_cat" },
  },
  {
    id: "b_tope",
    type: "action",
    label: "Tope 120",
    does: "action",
    action: "entities.update",
    collection: CAT,
    record: "$b_cat",
    set: { f_cat_tope: 120 },
  },
  {
    id: "b_borrar",
    type: "action",
    label: "Borrar categoría",
    does: "action",
    action: "entities.delete",
    collection: CAT,
    record: "$b_cat",
  },
  { id: "b_ir", type: "action", label: "Ver", does: "page", to: "p_x", pass: { b_cat: "$b_cat" } },
];
const spec = (cat?: string, month?: string) => ({
  version: 1,
  blocks: [...controls(cat, month), ...buttons],
});

describe("a page's buttons (D-60)", () => {
  it("a flow's button runs it by hand with the page's values, the run Juan's and in the list", async () => {
    const page = createPage(
      host.store(1),
      { title: "Gastos", spec: spec(CAFE, "2026-11") },
      "movil-ejemplo",
    );
    const r = await press(page.id, "b_resumen");
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("done");
    // What a control holds reaches the flow's form as a person would type it: the month, the record's title.
    expect(r.body.replies[0]?.data).toMatchObject({
      a: { value: "2026-11", integrity: "user" },
      b: { value: "Cafés", integrity: "user" },
      c: { value: "desde la página", integrity: "user" },
    });
    expect(planned).toBe(0);
    const run = host.store(1).journal.run(r.body.run);
    expect(run).toMatchObject({ flow: "resumen-del-mes-3fa9c1", origin: "turn" });
  });

  it("an action's button makes a record with a value of the page, and Undo takes it back", async () => {
    const store = host.store(1);
    const page = createPage(store, { title: "Café", spec: spec(CAFE) }, "movil-ejemplo");
    const r = await press(page.id, "b_cafe");
    expect(r.body).toMatchObject({ status: "done", changed: true });
    const made = store.list(MOV).find((x) => x.entity.values.f_mov_concepto === "Café");
    expect(made?.entity.values).toMatchObject({
      f_mov_importe: { amount: 1.6, currency: "EUR" },
      f_mov_categoria: CAFE,
    });
    expect(made?.labels.f_mov_categoria?.integrity).toBe("user");
    expect((await post(`/api/agent/runs/${r.body.run}/undo`)).status).toBe(200);
    expect(store.list(MOV).find((x) => x.entity.values.f_mov_concepto === "Café")).toBeUndefined();
    // Changing the record the control holds, then its Undo.
    const up = await press(page.id, "b_tope");
    expect(up.body.status).toBe("done");
    expect(store.get(CAFE)?.entity.values.f_cat_tope).toEqual({ amount: 120, currency: "EUR" });
    await post(`/api/agent/runs/${up.body.run}/undo`);
    expect(store.get(CAFE)?.entity.values.f_cat_tope).toBeUndefined();
    expect(planned).toBe(0);
  });

  it("deleting is confirmed first, as the action always is", async () => {
    const store = host.store(1);
    const page = createPage(store, { title: "Borrar", spec: spec(CAFE) }, "movil-ejemplo");
    const r = await press(page.id, "b_borrar");
    expect(r.body.status).toBe("waiting");
    expect(r.body.pending?.kind).toBe("confirm");
    expect(store.get(CAFE)?.entity.deleted).toBeUndefined();
    const done = (await (
      await post("/api/agent/confirm", { run: r.body.run, confirmation: r.body.pending?.id })
    ).json()) as Turn;
    expect(done.status).toBe("done");
    expect(store.get(CAFE)?.entity.deleted).toBeDefined();
    await post(`/api/agent/runs/${r.body.run}/undo`);
    expect(store.get(CAFE)?.entity.deleted).toBeUndefined();
  });

  it("what the button runs and passes is the saved page's, never the app's; an empty control runs nothing", async () => {
    const store = host.store(1);
    const page = createPage(store, { title: "Vacía", spec: spec() }, "movil-ejemplo");
    expect(await press(page.id, "b_tope")).toMatchObject({
      status: 409,
      body: { error: "empty-value" },
    });
    // A control holding a record of another collection names nothing the action may change.
    const other = createPage(store, { title: "Otra", spec: spec("e_01knoesta000000000000000000") });
    expect(await press(other.id, "b_tope")).toMatchObject({
      status: 409,
      body: { error: "no-record" },
    });
    // A record of another collection is not one the action may change, even when it is there.
    const mov = store.create(
      MOV,
      { f_mov_concepto: { value: "Pan", label: own } },
      { actor: "user" },
    );
    const wrong = createPage(store, { title: "Mal", spec: spec(mov.entity.id) });
    expect(await press(wrong.id, "b_tope")).toMatchObject({
      status: 409,
      body: { error: "no-record" },
    });
    // What the saved button names has to be there and fit: a flow by hand, fields of the collection, their kinds.
    // Written straight into the store, as an older server or another writer might have left it (a page's own
    // checks would refuse some of these when saved).
    const odd = (b: Record<string, unknown>) => {
      const p = createPage(store, { title: "Rara", spec: spec(CAFE) });
      const blocks = [...controls(CAFE), { id: "b_x", type: "action", label: "X", ...b }];
      store.update(
        p.id,
        { f_spec: { value: JSON.stringify({ version: 1, blocks }), label: own } },
        { actor: "system" },
      );
      return p;
    };
    const errorOf = async (b: Record<string, unknown>) =>
      ((await press(odd(b).id, "b_x")).body as { error?: string }).error;
    expect(await errorOf({ does: "flow", flow: "no-esta-0000" })).toBe("no-flow");
    expect(
      await errorOf({
        does: "action",
        action: "entities.create",
        collection: MOV,
        set: { f_no: 1 },
      }),
    ).toBe("no-field");
    expect(
      await errorOf({
        does: "action",
        action: "entities.create",
        collection: MOV,
        set: { f_mov_importe: "mucho" },
      }),
    ).toBe("bad-value");
    // An action a button may not run makes the saved page unreadable (`toPage`): there is no button to press.
    expect(await errorOf({ does: "action", action: "schema.delete_type", collection: MOV })).toBe(
      "not-found",
    );
    expect(
      await errorOf({ does: "action", action: "entities.create", collection: "t_no_esta" }),
    ).toBe("no-collection");
    // A button that opens a page is the app's; a block that is not a button, or one not there, runs nothing.
    expect((await press(page.id, "b_ir")).status).toBe(409);
    expect((await press(page.id, "b_cat")).status).toBe(409);
    expect((await press(page.id, "b_nada")).status).toBe(404);
    expect((await post("/api/agent/press", { page: page.id })).status).toBe(400);
  });

  it("a page a model's run wrote last passes its values with the model's label", async () => {
    const store = host.store(1);
    const page = createPage(
      store,
      { title: "De un modelo", spec: spec(CAFE, "2026-10") },
      "movil-ejemplo",
    );
    const model = label("model", "personal", [{ kind: "model", id: "ejemplo" }]);
    updatePage(
      store,
      page.id,
      { spec: spec(CAFE, "2026-10") },
      {
        meta: { actor: "agent", run: "r-ejemplo" },
        label: model,
      },
    );
    const r = await press(page.id, "b_resumen");
    expect(r.body.replies[0]?.data.a).toMatchObject({ value: "2026-10", integrity: "model" });
    expect(r.body.replies[0]?.data.c).toMatchObject({ integrity: "model" });
    // An action's button on that page writes with the model's label too: what it passes is never Juan's word.
    const made = await press(page.id, "b_cafe");
    expect(made.body.status).toBe("done");
    const row = store
      .list(MOV)
      .find((x) => x.entity.values.f_mov_concepto === "Café" && !x.entity.deleted);
    expect(row?.labels.f_mov_categoria?.integrity).toBe("model");
  });
});
