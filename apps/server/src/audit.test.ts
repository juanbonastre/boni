import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { label } from "@boni/entities";
import { BODY } from "@boni/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { addUser } from "./auth.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds } from "./feeds.ts";
import { type App, makeApp, serve } from "./http.ts";
import { LoginGuard } from "./limits.ts";
import { mcpAnswer } from "./mcp.ts";
import { Vaults } from "./vaults.ts";

/** The audit over HTTP (audit.ts), with invented data only. */
const PASSWORD = "una contraseña larga de ejemplo";
const L = label("user", "personal", [{ kind: "user-edit", id: "test" }]);
let dir: string;
let db: Db;
let host: AgentHost;
let app: App;
let http: HttpServer;
let base = "";
let t = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-audit-"));
  db = openDb(join(dir, "system.db"));
  addUser(db, "ana", PASSWORD, "");
  host = new AgentHost({ dataDir: dir, providers: null });
  app = makeApp({
    db,
    vaults: new Vaults(),
    key: randomBytes(32),
    feeds: new Feeds(async () => ""),
    guard: new LoginGuard({ perUser: 50, perAddress: 100, windowMs: 60_000, perMinute: 100 }),
    agent: host,
  });
  http = serve(app, "tailnet");
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const store = host.store(1);
  for (const [id, name] of [
    ["t_nota", "Notas"],
    ["t_salud", "Salud"],
  ] as const)
    store.applySchema(
      {
        op: "create_type",
        type: {
          id,
          key: id.slice(2),
          name,
          titleField: `${id}_t`,
          sensitivity: "personal",
          schemaVersion: 1,
          label: L,
          fields: [{ id: `${id}_t`, key: "titulo", name: "Título", type: "text", label: L }],
        },
      },
      { actor: "user" },
    );
  store.setAiAccess("t_salud", "private", "portatil-ejemplo");
  const r = await fetch(`${base}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user: "ana", password: PASSWORD, device: "portatil-ejemplo" }),
  });
  t = ((await r.json()) as { token: string }).token;
});

afterAll(async () => {
  http.closeAllConnections();
  await new Promise((r) => http.close(r));
  app.close();
  host.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${t}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

describe("the audit, over HTTP", () => {
  it("records Juan's reads only where he asked (private by default), and the setting can change", async () => {
    const store = host.store(1);
    const nota = store.create(
      "t_nota",
      { t_nota_t: { value: "Una nota inventada", label: L } },
      { actor: "user", device: "portatil-ejemplo" },
    );
    const cita = store.create(
      "t_salud",
      { t_salud_t: { value: "Cita inventada", label: L } },
      { actor: "user", device: "portatil-ejemplo" },
    );
    const before = store.audit.actions({ limit: 1 })[0]?.seq ?? 0;
    await call("GET", `/api/data/rows/${nota.entity.id}`);
    await call("GET", `/api/data/rows/${cita.entity.id}`);
    let mine = store.audit.actions().filter((a) => a.seq > before);
    expect(mine.map((a) => [a.by, a.tool])).toEqual([["user:portatil-ejemplo", "data.row"]]);
    expect(store.audit.seenBy(cita.entity.id)[0]).toMatchObject({ fields: ["t_salud_t"] });
    expect(
      (await call("PUT", "/api/data/audit/settings", { userReads: ["visible"] })).body,
    ).toEqual({
      userReads: ["visible"],
    });
    expect((await call("PUT", "/api/data/audit/settings", { userReads: ["todo"] })).status).toBe(
      400,
    );
    await call("GET", "/api/data/types/t_nota/rows");
    mine = store.audit.actions().filter((a) => a.seq > before);
    expect(mine[0]).toMatchObject({ tool: "data.rows", result: { rows: 1 } });
    await call("PUT", "/api/data/audit/settings", { userReads: ["restricted", "private"] });
    // An attachment of a private row, opened: recorded on that row.
    store.applySchema(
      {
        op: "add_field",
        type: "t_salud",
        field: { id: "t_salud_f", key: "archivo", name: "Archivo", type: "file", label: L },
      },
      { actor: "user" },
    );
    const sha = store.putFile(new TextEncoder().encode("informe inventado"), "text/plain");
    store.update(
      cita.entity.id,
      { t_salud_f: { value: sha, label: L } },
      { actor: "user", device: "portatil-ejemplo" },
    );
    const r = await fetch(`${base}/api/data/files/${sha}`, {
      headers: { authorization: `Bearer ${t}` },
    });
    expect(r.status).toBe(200);
    expect(store.audit.actions({ limit: 1 })[0]).toMatchObject({
      tool: "data.file",
      by: "user:portatil-ejemplo",
    });
    expect(store.audit.seenBy(cita.entity.id)[0]?.files).toEqual([sha]);
  });

  it("gives each row its system columns, and a row's history: who saw it, each change, who wrote each line", async () => {
    const store = host.store(1);
    const e = store.create(
      "t_nota",
      {
        t_nota_t: { value: "Plan inventado", label: L },
        [BODY]: { value: "# Plan\nuno", label: L },
      },
      { actor: "user", device: "portatil-ejemplo" },
    );
    // Claude through the MCP reads it and adds a line.
    mcpAnswer(store, "claude-ejemplo", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "append", arguments: { id: e.entity.id, text: "dos, del MCP" } },
    });
    mcpAnswer(store, "claude-ejemplo", {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "read", arguments: { id: e.entity.id } },
    });
    const list = (await call("GET", "/api/data/types/t_nota/rows")).body as {
      columns: Record<string, Record<string, unknown>>;
    };
    expect(list.columns[e.entity.id]).toMatchObject({
      createdBy: "user:portatil-ejemplo",
      updatedBy: "mcp:claude-ejemplo",
      editors: ["user:portatil-ejemplo", "mcp:claude-ejemplo"],
      viewers: ["mcp:claude-ejemplo"],
      version: 2,
    });
    const row = (await call("GET", `/api/data/audit/rows/${e.entity.id}`)).body as {
      blame: { text: string; by: string }[];
      changes: { kind: string; by: string }[];
      seenBy: { by: string; body: string | null }[];
      names: { types: Record<string, string> };
    };
    expect(row.blame.map((l) => [l.text, l.by])).toEqual([
      ["# Plan", "user:portatil-ejemplo"],
      ["uno", "user:portatil-ejemplo"],
      ["dos, del MCP", "mcp:claude-ejemplo"],
    ]);
    expect(row.changes.map((c) => [c.kind, c.by])).toEqual([
      ["create", "user:portatil-ejemplo"],
      ["update", "mcp:claude-ejemplo"],
    ]);
    expect(row.seenBy[0]).toMatchObject({ by: "mcp:claude-ejemplo", body: "text" });
    expect(row.names.types.t_nota).toBe("Notas");
  });

  it("summarises activity, lists actions with names, verifies, and says what the store takes", async () => {
    const sum = (await call("GET", "/api/data/audit/summary")).body as {
      byType: { type: string; name: string; by: string; reads: number; writes: number }[];
    };
    expect(sum.byType).toContainEqual(
      expect.objectContaining({ type: "t_nota", name: "Notas", by: "mcp:claude-ejemplo" }),
    );
    const acts = (await call("GET", "/api/data/audit/actions?limit=5")).body as {
      actions: { seq: number; tool: string }[];
    };
    expect(acts.actions.length).toBeGreaterThan(0);
    const one = await call("GET", `/api/data/audit/actions/${acts.actions[0]?.seq}`);
    expect(one.status).toBe(200);
    expect((await call("GET", "/api/data/audit/actions/999999")).status).toBe(404);
    expect((await call("GET", "/api/data/audit/verify")).body).toMatchObject({
      ok: true,
      broken: null,
    });
    const st = (await call("GET", "/api/data/audit/storage")).body as {
      types: { name: string }[];
      advice: unknown[];
    };
    expect(st.types.map((x) => x.name)).toEqual(expect.arrayContaining(["Notas", "Salud"]));
    expect(st.advice).toEqual([]);
  });
});
