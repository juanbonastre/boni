import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakePlanner, ToolRegistry } from "@boni/agent";
import { label, newId } from "@boni/entities";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { addUser } from "./auth.ts";
import { addCalendar, calendarDefs } from "./calendarStore.ts";
import { notesInTree } from "./data.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds } from "./feeds.ts";
import { type App, makeApp, serve } from "./http.ts";
import { LoginGuard } from "./limits.ts";

/**
 * The routes that run their action itself (`ROUTE_RUNS`, docs/sistema.md §4.1, task 95): Boni Calendar's «Añadir
 * calendario», «Separar por», its colour and «Quitar», and a collection's notes in the tree, over HTTP as the apps
 * call them (by ids), on a collection shaped like Juan's. Each answers what it always did, and without the list of
 * actions the policy refuses each one (P0).
 */
const SIGN_IN = "una contraseña larga de ejemplo";
const own = label("user", "personal", [{ kind: "user-edit", id: "ejemplo" }]);
const VIAJE = newId("t");
const AGENDA = newId("t");
const F = { titulo: newId("f"), salida: newId("f"), tipo: newId("f") };
let dir: string;
let db: Db;
let host: AgentHost;
const apps: { app: App; server: Server; base: string }[] = [];

async function start(actions?: ToolRegistry): Promise<string> {
  const app = makeApp({
    db,
    key: randomBytes(32),
    feeds: new Feeds(async () => ""),
    guard: new LoginGuard({ perUser: 50, perAddress: 100, windowMs: 60_000, perMinute: 100 }),
    agent: host,
    write: true,
    ...(actions ? { actions } : {}),
  });
  const server = serve(app, "tailnet");
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  apps.push({ app, server, base });
  return base;
}
async function signedIn(base: string) {
  const r = await fetch(`${base}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user: "juan", password: SIGN_IN, device: "portatil-ejemplo" }),
  });
  const token = ((await r.json()) as { token: string }).token;
  return async (method: string, path: string, body: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
}
const mine = () => calendarDefs(host.store(1)).filter((p) => p.type === VIAJE);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "boni-calendar-routes-"));
  db = openDb(join(dir, "system.db"));
  addUser(db, "juan", SIGN_IN);
  const planner = fakePlanner([]);
  host = new AgentHost({ dataDir: dir, providers: { planner, reader: planner } });
  const store = host.store(1);
  const opt = (name: string) => ({ id: newId("o"), name, label: own });
  store.applySchema(
    {
      op: "create_type",
      type: {
        id: VIAJE,
        key: "viajes",
        name: "Viajes",
        fields: [
          { id: F.titulo, key: "titulo", name: "Título", type: "text", label: own },
          { id: F.salida, key: "salida", name: "Salida", type: "date", label: own },
          {
            id: F.tipo,
            key: "tipo",
            name: "Tipo",
            type: "select",
            options: [opt("Trabajo"), opt("Familia")],
            label: own,
          },
        ],
        titleField: F.titulo,
        sensitivity: "personal",
        schemaVersion: 1,
        label: own,
      },
    },
    { actor: "user" },
  );
  store.applySchema(
    { op: "set_roles", type: VIAJE, roles: { date: F.salida } },
    { actor: "import" },
  );
  // An account keeps a calendar already (one with none has no calendar's routes): his «Agenda».
  const dia = newId("f");
  const nombre = newId("f");
  store.applySchema(
    {
      op: "create_type",
      type: {
        id: AGENDA,
        key: "agenda",
        name: "Agenda",
        fields: [
          { id: nombre, key: "nombre", name: "Nombre", type: "text", label: own },
          { id: dia, key: "dia", name: "Día", type: "date", label: own },
        ],
        titleField: nombre,
        sensitivity: "personal",
        schemaVersion: 1,
        label: own,
      },
    },
    { actor: "user" },
  );
  store.applySchema({ op: "set_roles", type: AGENDA, roles: { date: dia } }, { actor: "import" });
  expect(addCalendar(store, AGENDA)).not.toBeNull();
});
afterAll(async () => {
  for (const { app, server } of apps) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    app.close();
  }
  host.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the routes that run their action itself (ROUTE_RUNS, task 95)", () => {
  it("Boni Calendar adds, splits, colours and takes away a calendar by its ids, with the answers it always had", async () => {
    const call = await signedIn(await start());
    expect(await call("POST", "/api/collections/add", { type: newId("t") })).toEqual({
      status: 409,
      body: { error: "not-a-candidate" },
    });
    const added = await call("POST", "/api/collections/add", { type: VIAJE });
    expect(added.status).toBe(200);
    const id = added.body.id as string;
    expect(added.body).toEqual({ id });
    expect(mine()[0]?.def.id).toBe(id);
    expect((await call("POST", "/api/collections/add", { type: VIAJE })).status).toBe(409);

    // By the field's id, as the calendar sends it: one calendar per «Tipo».
    expect(await call("POST", "/api/collections/split", { id, field: newId("f") })).toEqual({
      status: 400,
      body: { error: "bad-field" },
    });
    expect(await call("POST", "/api/collections/split", { id: "otro", field: F.tipo })).toEqual({
      status: 404,
      body: { error: "no-such-calendar" },
    });
    expect(await call("POST", "/api/collections/split", { id, field: F.tipo })).toEqual({
      status: 200,
      body: {},
    });
    expect(mine().length).toBe(2);
    const first = mine()[0]?.def.id as string;
    expect(await call("POST", "/api/collections/color", { id: first, color: "#22aa55" })).toEqual({
      status: 200,
      body: {},
    });
    expect(mine()[0]?.def.color).toBe("#22aa55");
    expect(await call("POST", "/api/collections/color", { id: first, color: "verde" })).toEqual({
      status: 404,
      body: { error: "no-such-calendar" },
    });

    // Taken away by the definition's id (what «Quitar» sends for a split one): all of it goes.
    expect(await call("POST", "/api/collections/remove", { id })).toEqual({
      status: 200,
      body: {},
    });
    expect(mine()).toEqual([]);
    expect(await call("POST", "/api/collections/remove", { id })).toEqual({
      status: 404,
      body: { error: "no-such-calendar" },
    });
  });

  it("a collection's notes in the tree, by its id", async () => {
    const call = await signedIn(await start());
    expect(await call("PUT", `/api/data/types/${VIAJE}/tree`, { notes: true })).toEqual({
      status: 200,
      body: {},
    });
    expect(notesInTree(host.store(1), host.store(1).schema().types[VIAJE] as never)).toBe(true);
    expect(await call("PUT", `/api/data/types/${VIAJE}/tree`, { notes: false })).toEqual({
      status: 200,
      body: {},
    });
    expect(notesInTree(host.store(1), host.store(1).schema().types[VIAJE] as never)).toBe(false);
    expect(await call("PUT", `/api/data/types/${newId("t")}/tree`, { notes: true })).toEqual({
      status: 404,
      body: { error: "not-found" },
    });
  });

  it("without the list of actions, the policy refuses each one there, once, and nothing changes (P0)", async () => {
    const call = await signedIn(await start(new ToolRegistry().freeze()));
    const refused = { status: 403, body: { error: "policy", rule: "P0" } };
    expect(await call("POST", "/api/collections/add", { type: VIAJE })).toEqual(refused);
    expect(await call("POST", "/api/collections/split", { id: "x", field: null })).toEqual(refused);
    expect(await call("POST", "/api/collections/color", { id: "x", color: "#22aa55" })).toEqual(
      refused,
    );
    expect(await call("POST", "/api/collections/remove", { id: "x" })).toEqual(refused);
    expect(await call("PUT", `/api/data/types/${VIAJE}/tree`, { notes: true })).toEqual(refused);
    expect(mine()).toEqual([]);
  });
});
