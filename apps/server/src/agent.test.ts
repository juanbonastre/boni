import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
import { type App, makeApp, serve } from "./http.ts";
import { LoginGuard } from "./limits.ts";
import { Vaults } from "./vaults.ts";

/** The conversation API over HTTP with a scripted planner (no model, no network). */
const PASSWORD = "una contraseña larga de ejemplo";
const lit = (v: unknown) => ({ lit: v });
let dir: string;
let db: Db;
let vaults: Vaults;
let app: App;
let host: AgentHost;
let off: App;
const servers: Server[] = [];
let base: string;
let pub: string;
let offBase: string;
const plans: unknown[] = [];

async function listen(s: Server): Promise<string> {
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
async function login(at: string, user: string) {
  const r = await fetch(`${at}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user, password: PASSWORD, device: "movil-ejemplo" }),
  });
  return ((await r.json()) as { token: string }).token;
}
const post = (at: string, token: string, path: string, body: unknown = {}) =>
  fetch(`${at}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-agent-http-"));
  mkdirSync(join(dir, "vault"));
  db = openDb(join(dir, "system.db"));
  addUser(db, "juan", PASSWORD, join(dir, "vault"));
  addUser(db, "otra", PASSWORD, "");
  vaults = new Vaults();
  const planner = fakePlanner([]);
  planner.complete = async () => ({
    json: plans.shift(),
    usage: { input: 1, output: 1 },
    model: "fake",
  });
  host = new AgentHost({ dataDir: dir, providers: { planner, reader: planner } });
  const opts = {
    db,
    vaults,
    key: randomBytes(32),
    feeds: new Feeds(async () => ""),
    guard: new LoginGuard({ perUser: 50, perAddress: 100, windowMs: 60_000, perMinute: 100 }),
  };
  app = makeApp({ ...opts, agent: host });
  base = await listen(serve(app, "tailnet"));
  pub = await listen(serve(app, "public"));
  off = makeApp({ ...opts, agent: new AgentHost({ dataDir: dir, providers: null }) });
  offBase = await listen(serve(off, "tailnet"));
  // A type in Juan's own store for the tests (account 1).
  const store = host.store(1);
  const own = label("user", "personal", [{ kind: "user-edit", id: "ejemplo" }]);
  store.applySchema(
    {
      op: "create_type",
      type: {
        id: "t_tarea",
        key: "tarea",
        name: "Tareas",
        fields: [{ id: "f_titulo", key: "titulo", name: "Título", type: "text", label: own }],
        titleField: "f_titulo",
        sensitivity: "personal",
        schemaVersion: 1,
        label: own,
      },
    },
    { actor: "user" },
  );
  store.create(
    "t_tarea",
    { f_titulo: { value: "Comprar pan", label: own } },
    { actor: "user" },
    "e_pan",
  );
});

afterAll(async () => {
  for (const s of servers) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
  app.close();
  off.close();
  host.close();
  vaults.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the conversation API", () => {
  it("runs a turn, lists it and undoes it", async () => {
    const token = await login(base, "juan");
    plans.push({
      version: 1,
      steps: [
        {
          id: "c",
          op: "call",
          tool: "entities.create",
          args: {
            type: lit("tarea"),
            values: { fn: "obj", args: [lit("titulo"), { quote: "llamar al dentista" }] },
          },
        },
      ],
    });
    const r = await post(base, token, "/api/agent/turn", { text: "apunta llamar al dentista" });
    const turn = (await r.json()) as { run: string; status: string };
    expect(turn.status).toBe("done");
    expect(host.store(1).list("t_tarea").length).toBe(2);
    const runs = (await (
      await fetch(`${base}/api/agent/runs`, { headers: { authorization: `Bearer ${token}` } })
    ).json()) as { runs: { id: string }[] };
    expect(runs.runs[0]?.id).toBe(turn.run);
    expect(await (await post(base, token, `/api/agent/runs/${turn.run}/undo`)).json()).toEqual({
      undone: 1,
    });
    expect(host.store(1).list("t_tarea").length).toBe(1);
  });

  it("confirms from the device that asked, and not from another account", async () => {
    const token = await login(base, "juan");
    plans.push({
      version: 1,
      steps: [{ id: "d", op: "call", tool: "entities.delete", args: { id: lit("e_pan") } }],
    });
    const turn = (await (
      await post(base, token, "/api/agent/turn", { text: "borra la tarea del pan" })
    ).json()) as {
      run: string;
      pending: { kind: string; id: string; view: { rows: { value: string }[] } };
    };
    expect(turn.pending.kind).toBe("confirm");
    expect(turn.pending.view.rows[0]?.value).toBe("e_pan");
    // Another account cannot see or confirm Juan's run (it has its own agent and store).
    const other = await login(base, "otra");
    const foreign = (await (
      await post(base, other, "/api/agent/confirm", {
        run: turn.run,
        confirmation: turn.pending.id,
      })
    ).json()) as { error: string };
    expect(foreign.error).toBe("nothing-pending");
    expect(host.store(1).get("e_pan")?.entity.deleted).toBeUndefined();
    const done = (await (
      await post(base, token, "/api/agent/confirm", {
        run: turn.run,
        confirmation: turn.pending.id,
      })
    ).json()) as { status: string };
    expect(done.status).toBe("done");
    expect(host.store(1).get("e_pan")?.entity.deleted).toBeDefined();
  });

  it("is only on the tailnet, needs a session, and says when it is off", async () => {
    const token = await login(base, "juan");
    expect((await post(pub, token, "/api/agent/turn", { text: "hola" })).status).toBe(404);
    expect((await fetch(`${pub}/api/agent/events`)).status).toBe(404);
    expect((await post(base, "token-inventado", "/api/agent/turn", { text: "hola" })).status).toBe(
      401,
    );
    expect((await post(base, token, "/api/agent/turn", {})).status).toBe(400);
    const r = await post(offBase, token, "/api/agent/turn", { text: "hola" });
    expect([r.status, await r.json()]).toEqual([503, { error: "agent-off" }]);
  });

  it("tells the account's devices what the agent notifies", async () => {
    const token = await login(base, "juan");
    const events = await fetch(`${base}/api/agent/events`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const reader = (events.body as ReadableStream<Uint8Array>).getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(": connected\n\n");
    plans.push({
      version: 1,
      steps: [
        { id: "n", op: "call", tool: "notify", args: { text: { quote: "sacar la basura" } } },
      ],
    });
    await post(base, token, "/api/agent/turn", { text: "avísame: sacar la basura" });
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      'event: notify\ndata: {"text":"sacar la basura","integrity":"user"}\n\n',
    );
    await reader.cancel();
  });
});
