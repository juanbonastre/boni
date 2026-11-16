// «Automatizaciones» over HTTP in C1 of F14b (docs/automatizaciones.md §7, AU-168, AU-62): the six routes C1 adds,
// as the app calls them, each running its action through `runAction` (actions.ts in this folder). Without the list
// of actions each is refused by the policy (P0) before anything runs, the read too. The rest of AU-168 (what an
// origin that is not Juan's hand reads; «Probar», «Ordenar» and the rows) stays pending in automations.test.ts.
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decide, fakePlanner, type Origin, ToolRegistry } from "@boni/agent";
import { FORMAT } from "@boni/automations";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTIONS, ROUTE_ACTIONS, ROUTE_RUNS } from "../actions.ts";
import { AgentHost } from "../agent.ts";
import { addUser } from "../auth.ts";
import { type Db, openDb } from "../db.ts";
import { Feeds } from "../feeds.ts";
import { type App, makeApp, serve } from "../http.ts";
import { LoginGuard } from "../limits.ts";
import { ROUTES } from "../routes.ts";
import { AUTOMATION_ACTIONS, AUTOMATION_ROUTES } from "./routes.ts";

const SIGN_IN = "una contraseña larga de ejemplo";
/** C1's routes: the ones that are in ROUTES today. «Probar», «Ordenar» and the rows arrive with C2 and E. */
const C1 = [
  "POST /api/agent/automations",
  "GET /api/agent/automations/:id",
  "PUT /api/agent/automations/:id/draft",
  "POST /api/agent/automations/:id/duplicate",
  "DELETE /api/agent/automations/:id",
  "POST /api/agent/automations/:id/restore",
];
let dir: string;
let db: Db;
let host: AgentHost;
const apps: { app: App; server: Server }[] = [];

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
  apps.push({ app, server });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function signedIn(base: string) {
  const r = await fetch(`${base}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user: "juan", password: SIGN_IN, device: "portatil-ejemplo" }),
  });
  const token = ((await r.json()) as { token: string }).token;
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "boni-automations-routes-"));
  db = openDb(join(dir, "system.db"));
  addUser(db, "juan", SIGN_IN);
  const planner = fakePlanner([]);
  host = new AgentHost({ dataDir: dir, providers: { planner, reader: planner } });
});
afterAll(async () => {
  for (const a of apps) await new Promise((r) => a.server.close(r));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const first = {
  format: FORMAT,
  id: "",
  version: 0,
  name: "Nueva automatización",
  steps: [{ id: "s_inicio", name: "Disparado por el usuario", type: "manual", params: {} }],
  arrows: [],
  settings: {},
};

describe("C1's routes (AU-168, AU-62)", () => {
  it("AU-168 · C1's routes are in ROUTES as tailnet and in ROUTE_RUNS with their action; with a list of actions that lacks them each is refused (403, P0) before anything runs, the read too", async () => {
    for (const route of C1) {
      expect(ROUTES[route], route).toBe("tailnet");
      const { action } = AUTOMATION_ROUTES[route] as { action: string };
      expect(ACTIONS.get(action)?.name, route).toBe(action);
      if (!route.startsWith("GET ")) {
        expect(ROUTE_RUNS[route], route).toBe(action);
        expect(ROUTE_ACTIONS[route], route).toEqual([action]);
      }
    }
    const call = await signedIn(await start(new ToolRegistry()));
    const before = host.store(1).journal.automations().length;
    expect(await call("POST", "/api/agent/automations", { automation: first })).toEqual({
      status: 403,
      body: { error: "policy", rule: "P0" },
    });
    expect((await call("GET", "/api/agent/automations/a_nadie")).status).toBe(403);
    expect(host.store(1).journal.automations()).toHaveLength(before);
  });

  it("AU-168 · an action that changes an automation is Juan's touch: his hand runs it, and an assistant, a flow and work in the background are refused by the policy", () => {
    const changing = Object.entries(AUTOMATION_ACTIONS)
      .filter(([name, a]) => a.effect === "touch" && ACTIONS.get(name))
      .map(([name]) => name);
    expect(changing.length).toBeGreaterThanOrEqual(5);
    const origins: Origin[] = [
      { kind: "assistant", trust: "personal", device: "d_asistente" },
      { kind: "background", trust: "personal" },
      { kind: "miniapp", trust: "personal" },
    ];
    for (const name of changing) {
      const tool = ACTIONS.get(name);
      expect(tool?.effect, name).toBe("touch");
      const at = (origin: Origin, flow = false) =>
        decide({ tool, args: {}, control: null, flow }, origin, { writes: 0, sensitiveReads: 0 })
          .kind;
      expect(at({ kind: "hand", trust: "personal", device: "d_portatil" }), name).toBe("allow");
      for (const o of origins) expect(at(o), `${name} ${o.kind}`).toBe("deny");
      // A flow is work in the background: refused too.
      expect(at({ kind: "background", trust: "personal" }, true), name).toBe("deny");
    }
  });

  it("AU-62 · create, read, keep the draft, duplicate, delete and restore, as the editor calls them", async () => {
    const call = await signedIn(await start());
    const made = await call("POST", "/api/agent/automations", { automation: first });
    expect(made.status).toBe(200);
    const id = made.body.id as string;
    expect(id).toMatch(/^a_/);
    expect(made.body.rev).toBe(1);
    const read = await call("GET", `/api/agent/automations/${id}`);
    expect((read.body.automation as { name: string }).name).toBe("Nueva automatización");
    const renamed = { ...first, id, name: "Revisar gastos" };
    expect(
      await call("PUT", `/api/agent/automations/${id}/draft`, { automation: renamed }),
    ).toEqual({ status: 200, body: { rev: 2, stale: [] } });
    expect(
      (await call("PUT", `/api/agent/automations/${id}/draft`, { automation: { nada: 1 } })).status,
    ).toBe(400);
    const copy = await call("POST", `/api/agent/automations/${id}/duplicate`, {
      name: "Revisar gastos (copia)",
    });
    expect((copy.body.automation as { name: string }).name).toBe("Revisar gastos (copia)");
    expect(copy.body.id).not.toBe(id);
    expect(await call("DELETE", `/api/agent/automations/${id}`)).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect((await call("GET", `/api/agent/automations/${id}`)).status).toBe(404);
    expect((await call("POST", `/api/agent/automations/${id}/restore`)).status).toBe(200);
    expect((await call("GET", `/api/agent/automations/${id}`)).status).toBe(200);
    expect((await call("GET", "/api/agent/automations/a_nadie")).status).toBe(404);
  });
});
