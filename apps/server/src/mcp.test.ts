import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { issueSession } from "@boni/identity";
import { importVault } from "@boni/vault-import";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { addUser } from "./auth.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds } from "./feeds.ts";
import { type App, makeApp, serve } from "./http.ts";
import { LoginGuard } from "./limits.ts";
import { Vaults } from "./vaults.ts";

/** An invented vault (never real notes): the instructions, two projects, a journal entry kept from the AI. */
const VAULT: Record<string, string> = {
  "AGENTS.md": "# AGENTS.md\n\nInstrucciones inventadas: habla en español.\n",
  "proyectos/boni-plan.md":
    "---\ntype: project\nstatus: activo\nsummary: Plan inventado.\n---\n# Plan\n\n## Registro\n- 2026-10-01 - Empezado.\n",
  "proyectos/otro.md": "---\ntype: project\nstatus: pausado\n---\nOtro proyecto inventado.\n",
  "diario/2026-10-20.md": "---\ntype: journal\n---\nUn día inventado y privado.\n",
};

let dir: string;
let db: Db;
let host: AgentHost;
let app: App;
let http: HttpServer;
let base = "";
let token = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-mcp-"));
  const vault = join(dir, "vault");
  for (const [p, t] of Object.entries(VAULT)) {
    mkdirSync(dirname(join(vault, p)), { recursive: true });
    writeFileSync(join(vault, p), t);
  }
  db = openDb(join(dir, "system.db"));
  addUser(db, "ana", "una contraseña larga de ejemplo", "");
  host = new AgentHost({ dataDir: dir, providers: null });
  importVault(vault, host.store(1), { apply: true });
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
  token = issueSession(db, "ana", "claude-code", { listener: "tailnet" })?.token as string;
});

afterAll(async () => {
  http.closeAllConnections();
  await new Promise((r) => http.close(r));
  app.close();
  host.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
async function rpc(method: string, params?: unknown, t = token) {
  const r = await fetch(`${base}/api/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, ...(params ? { params } : {}) }),
  });
  return {
    status: r.status,
    body: r.status === 202 ? null : ((await r.json()) as Record<string, unknown>),
  };
}
async function tool(name: string, args: Record<string, unknown> = {}) {
  const r = await rpc("tools/call", { name, arguments: args });
  const res = r.body?.result as { content: { text: string }[]; isError: boolean };
  const text = res.content[0]?.text ?? "";
  return { error: res.isError, text, json: res.isError ? null : JSON.parse(text) };
}

describe("Boni's MCP (what vault-mcp did, over Boni's collections)", () => {
  it("speaks MCP: initialize, the tool list, notifications, only for a session", async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
    expect(init.body?.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "boni" },
    });
    const note = await fetch(`${base}/api/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(note.status).toBe(202);
    const listed = (await rpc("tools/list")).body as { result: { tools: { name: string }[] } };
    const names = listed.result.tools.map((t) => t.name);
    expect(names).toEqual([
      "guide",
      "collections",
      "search",
      "query",
      "read",
      "create",
      "edit",
      "append",
      "set_properties",
      "recent_changes",
      "trash",
      "finanzas_import",
      "finanzas_close",
      "undo",
    ]);
    expect((await rpc("tools/list", undefined, "nada")).status).toBe(401);
    expect(
      (await fetch(`${base}/api/mcp`, { headers: { authorization: `Bearer ${token}` } })).status,
    ).toBe(405);
  });

  it("reads as a model may: the guide, collections without what is kept from the AI, search, query, read", async () => {
    expect((await tool("guide")).json.instructions).toContain("habla en español");
    const cols = (await tool("collections")).json as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("Proyecto");
    expect(cols.map((c) => c.name)).not.toContain("Diario"); // kept from the AI by the import
    const found = (await tool("search", { query: "plan inventado" })).json as { path: string }[];
    expect(found.map((f) => f.path)).toContain("proyectos/boni-plan.md");
    expect((await tool("search", { query: "privado" })).json).toEqual([]);
    const active = (
      await tool("query", {
        collection: "Proyecto",
        filter: [{ property: "status", op: "is", value: "activo" }],
      })
    ).json as { path: string }[];
    expect(active.map((n) => n.path)).toEqual(["proyectos/boni-plan.md"]);
    const plan = (await tool("read", { path: "proyectos/boni-plan.md" })).json;
    expect(plan).toMatchObject({ collection: "Proyecto", properties: { status: "activo" } });
    expect(plan.body).toContain("## Registro");
    expect((await tool("read", { path: "diario/2026-10-20.md" })).error).toBe(true);
  });

  it("writes as a model, each call one run that can be undone", async () => {
    const appended = await tool("append", {
      path: "proyectos/boni-plan.md",
      text: "- 2026-10-22 - Entrada escrita por el MCP.",
    });
    expect(appended.error).toBe(false);
    const plan = (await tool("read", { path: "proyectos/boni-plan.md" })).json;
    expect(plan.body).toMatch(/Empezado\.\n- 2026-10-22 - Entrada escrita por el MCP\.$/);
    const e = host.store(1).get(plan.id);
    expect(e?.labels.$body).toMatchObject({ integrity: "model" });

    expect(
      (await tool("edit", { id: plan.id, old_text: "Empezado.", new_text: "Empezado de nuevo." }))
        .error,
    ).toBe(false);
    expect((await tool("edit", { id: plan.id, old_text: "no está", new_text: "x" })).text).toBe(
      "old_text not found",
    );
    expect((await tool("edit", { id: plan.id, body: "todo nuevo", version: 1 })).text).toContain(
      "read again",
    );

    const set = await tool("set_properties", { id: plan.id, properties: { status: "terminado" } });
    expect(set.error).toBe(false);
    expect((await tool("read", { id: plan.id })).json.properties.status).toBe("terminado");
    expect((await tool("set_properties", { id: plan.id, properties: { nada: 1 } })).text).toContain(
      'no property "nada"',
    );

    const made = await tool("create", {
      collection: "Proyecto",
      title: "Nuevo inventado",
      properties: { status: "activo" },
      body: "Hecho por el MCP.",
      path: "proyectos/nuevo-inventado.md",
    });
    expect((await tool("read", { path: "proyectos/nuevo-inventado.md" })).json.title).toBe(
      "Nuevo inventado",
    );
    expect((await tool("create", { collection: "Diario", title: "x" })).error).toBe(true);

    const changes = (await tool("recent_changes", { limit: 5 })).json as {
      run: string;
      by: string;
    }[];
    expect(changes[0]).toMatchObject({ run: made.json.run, by: "claude-code" });
    expect((await tool("undo", { run: made.json.run })).json.undone).toBe(1);
    expect((await tool("read", { path: "proyectos/nuevo-inventado.md" })).error).toBe(true);
    expect((await tool("undo", { run: "import-1" })).error).toBe(true);
  });
});
