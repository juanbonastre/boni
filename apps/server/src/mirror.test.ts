import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakePlanner } from "@boni/agent";
import { label } from "@boni/entities";
import { readZip } from "@boni/export";
import { Mirror, type MirrorFs, openMirrorState } from "@boni/mirror";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { addUser, listUsers } from "./auth.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds } from "./feeds.ts";
import { type App, makeApp, serve } from "./http.ts";
import { LoginGuard } from "./limits.ts";
import { Mirrors, mirrorStatePath } from "./mirror.ts";
import { Vaults } from "./vaults.ts";

/**
 * The mirror on the server: a type switched to core mode gets its notes in the account's vault, an agent
 * request writes them out, and a hand edit waits in the inbox until Juan accepts it (invented data only).
 */
const PASSWORD = "una contraseña larga de ejemplo";
const require = createRequire(import.meta.url);
const { openVault } = require("../../calendar-desktop/vault-fs.cjs") as {
  openVault: (root: string) => MirrorFs;
};
let dir: string;
let vault: string;
let db: Db;
let vaults: Vaults;
let app: App;
let host: AgentHost;
let mirrors: Mirrors;
let server: Server;
let base: string;
const plans: unknown[] = [];
const lit = (v: unknown) => ({ lit: v });
const note = "Boni/Libros/Un libro de ejemplo.md";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-mirror-http-"));
  vault = join(dir, "vault");
  mkdirSync(vault);
  db = openDb(join(dir, "system.db"));
  addUser(db, "juan", PASSWORD, vault);
  vaults = new Vaults({ write: true });
  const planner = fakePlanner([]);
  planner.complete = async () => ({
    json: plans.shift(),
    usage: { input: 1, output: 1 },
    model: "fake",
  });
  host = new AgentHost({ dataDir: dir, providers: { planner, reader: planner } });
  mirrors = new Mirrors({ host, dataDir: dir, write: true, accounts: () => listUsers(db) });
  host.onChanged = (a) => void mirrors.run(a);
  app = makeApp({
    db,
    vaults,
    key: randomBytes(32),
    feeds: new Feeds(async () => ""),
    guard: new LoginGuard({ perUser: 50, perAddress: 100, windowMs: 60_000, perMinute: 100 }),
    agent: host,
  });
  server = serve(app, "tailnet");
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // A type of Boni's own, switched to core mode the way `cli.ts mirror` does it.
  const store = host.store(1);
  const own = label("user", "personal", [{ kind: "turn", id: "t" }]);
  store.applySchema(
    {
      op: "create_type",
      type: {
        id: "t_libro",
        key: "libro",
        name: "Libros",
        fields: [
          { id: "f_titulo", key: "titulo", name: "Título", type: "text", label: own },
          { id: "f_autor", key: "autor", name: "Autor", type: "text", label: own },
        ],
        titleField: "f_titulo",
        sensitivity: "personal",
        schemaVersion: 1,
        label: own,
      },
    },
    { actor: "user" },
  );
  store.create(
    "t_libro",
    { f_titulo: { value: "Un libro de ejemplo", label: own } },
    { actor: "user" },
  );
  const state = openMirrorState(mirrorStatePath(dir, 1));
  new Mirror({ store, state, fs: openVault(vault), propose: () => "" }).switchToCore("t_libro", {
    apply: true,
  });
  state.close();
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await mirrors.close();
  app.close();
  host.close();
  vaults.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function token(): Promise<string> {
  const r = await fetch(`${base}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user: "juan", password: PASSWORD, device: "movil-ejemplo" }),
  });
  return ((await r.json()) as { token: string }).token;
}
const read = (p: string) => readFileSync(join(vault, p), "utf8");

describe("the mirror on the server", () => {
  it("writes the notes of what an agent request changed", async () => {
    expect(read(note)).toContain('Título: "Un libro de ejemplo"');
    const t = await token();
    plans.push({
      version: 1,
      steps: [
        {
          id: "c",
          op: "call",
          tool: "entities.create",
          args: {
            type: lit("libro"),
            values: { fn: "obj", args: [lit("titulo"), { quote: "Otro libro" }] },
          },
        },
      ],
    });
    const r = await fetch(`${base}/api/agent/turn`, {
      method: "POST",
      headers: { authorization: `Bearer ${t}` },
      body: JSON.stringify({ text: "apunta el libro Otro libro" }),
    });
    expect(((await r.json()) as { status: string }).status).toBe("done");
    await mirrors.run(1);
    expect(read("Boni/Libros/Otro libro.md")).toContain('boni_integrity: "user"');
  });

  it("a hand edit waits in the inbox; accepted over HTTP, the core has it and the note is the mirror's", async () => {
    writeFileSync(join(vault, note), read(note).replace(/^Autor:$/m, 'Autor: "Autora Inventada"'));
    await mirrors.run(1);
    const t = await token();
    const auth = { authorization: `Bearer ${t}` };
    const list = (await (await fetch(`${base}/api/agent/proposals`, { headers: auth })).json()) as {
      proposals: { id: string; view: { title: string; rows: { arg: string; value: string }[] } }[];
    };
    expect(list.proposals).toHaveLength(1);
    const [p] = list.proposals;
    expect(p?.view.title).toBe("Cambio hecho a mano en Obsidian");
    expect(p?.view.rows[0]).toMatchObject({ arg: "note", value: note });
    const accepted = await fetch(`${base}/api/agent/proposals/${p?.id}/accept`, {
      method: "POST",
      headers: auth,
    });
    expect(((await accepted.json()) as { status: string }).status).toBe("done");
    await mirrors.run(1);
    const book = host
      .store(1)
      .list("t_libro")
      .find((s) => s.entity.values.f_titulo === "Un libro de ejemplo");
    expect(book?.entity.values.f_autor).toBe("Autora Inventada");
    expect(book?.labels.f_autor?.integrity).toBe("imported");
    // Nothing more to propose: the edited note is the mirror's again.
    await mirrors.run(1);
    expect(host.store(1).journal.proposals("pending")).toHaveLength(0);
    expect(read(note)).toContain('Autor: "Autora Inventada"');
  });

  it("exports everything of the account in one zip, from a personal device", async () => {
    expect((await fetch(`${base}/api/export`)).status).toBe(401);
    const t = await token();
    const r = await fetch(`${base}/api/export`, { headers: { authorization: `Bearer ${t}` } });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/zip");
    expect(r.headers.get("content-disposition")).toMatch(
      /^attachment; filename="boni-\d{4}-\d{2}-\d{2}\.zip"$/,
    );
    const files = readZip(Buffer.from(await r.arrayBuffer()));
    expect(files.get("json/libro.ndjson")?.toString("utf8")).toContain("Autora Inventada");
    expect(files.has("libro/Un libro de ejemplo.md")).toBe(true);
    expect(files.has("log.ndjson")).toBe(false);
    expect(JSON.parse(files.get("views.json")?.toString("utf8") ?? "{}")).toEqual({
      charts: expect.any(Array),
      shortcuts: expect.any(Array),
    });
  });
});
