import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { label, newId } from "@boni/entities";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { addUser } from "./auth.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds } from "./feeds.ts";
import { type App, makeApp, serve } from "./http.ts";
import { LoginGuard } from "./limits.ts";
import { listPages } from "./pages.ts";

/**
 * A new page sent again after its answer was lost (task 109, D-70): the app gives the page its id as it shows it, and
 * a second create with that id, even after the server restarted, is the same page, never a second one. Over HTTP, as
 * the apps send it, on a store of Juan's size (thousands of records, generated ids).
 */
const PASSWORD = "una contraseña larga de ejemplo";
let dir: string;
let db: Db;
let host: AgentHost;
let app: App;
let server: Server;
let base = "";
let token = "";
/** One of his notes: its id is not a page's to take. */
let noteId = "";

async function start() {
  host = new AgentHost({ dataDir: dir, providers: null });
  app = makeApp({
    db,
    key: randomBytes(32),
    feeds: new Feeds(async () => ""),
    guard: new LoginGuard({ perUser: 50, perAddress: 100, windowMs: 60_000, perMinute: 100 }),
    agent: host,
  });
  server = serve(app, "tailnet");
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function stop() {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  app.close();
  host.close();
}
const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
const pageOf = (r: { body: Record<string, unknown> }) =>
  r.body.page as { id: string; title: string; spec: { blocks: unknown[] } };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-page-create-"));
  db = openDb(join(dir, "system.db"));
  addUser(db, "juan", PASSWORD);
  await start();
  const r = await fetch(`${base}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user: "juan", password: PASSWORD, device: "portatil-ejemplo" }),
  });
  token = ((await r.json()) as { token: string }).token;
  // His volume: a collection of thousands of notes and some hundred pages, all with generated ids.
  const store = host.store(1);
  const own = label("user", "personal", [{ kind: "user-edit", id: "ejemplo" }]);
  const type = newId("t");
  const field = newId("f");
  store.applySchema(
    {
      op: "create_type",
      type: {
        id: type,
        key: "tarea",
        name: "Tarea",
        fields: [{ id: field, key: "titulo", name: "Título", type: "text", label: own }],
        titleField: field,
        sensitivity: "personal",
        schemaVersion: 1,
        label: own,
      },
    },
    { actor: "user" },
  );
  store.batch(() => {
    for (let i = 0; i < 3000; i++)
      noteId = store.create(
        type,
        { [field]: { value: `Tarea de ejemplo ${i}`, label: own } },
        { actor: "user" },
      ).entity.id;
  });
  for (let i = 0; i < 150; i++) await call("POST", "/api/pages", { title: `Página ${i}` });
});

afterAll(async () => {
  await stop();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("a new page created twice is one page (task 109, D-70)", () => {
  it("the same create sent again answers the same page, and makes none", async () => {
    const id = newId("e");
    const before = listPages(host.store(1)).length;
    const first = await call("POST", "/api/pages", { id, title: "", parent: null });
    expect(first.status).toBe(200);
    expect(pageOf(first).id).toBe(id);
    // What was typed reached it, then the create went again (its answer had been lost).
    await call("PUT", `/api/pages/${id}`, { title: "Plan de ejemplo" });
    const again = await call("POST", "/api/pages", { id, title: "", parent: null });
    expect(again.status).toBe(200);
    expect(pageOf(again)).toMatchObject({ id, title: "Plan de ejemplo" });
    expect(listPages(host.store(1)).length).toBe(before + 1);
  });

  it("with the server restarted between the two creates", async () => {
    const id = newId("e");
    const before = listPages(host.store(1)).length;
    expect((await call("POST", "/api/pages", { id, title: "" })).status).toBe(200);
    await stop();
    await start();
    const again = await call("POST", "/api/pages", { id, title: "" });
    expect(again.status).toBe(200);
    expect(pageOf(again).id).toBe(id);
    const pages = listPages(host.store(1));
    expect(pages.length).toBe(before + 1);
    expect(pages.filter((p) => p.id === id)).toHaveLength(1);
  });

  it("an older app's create (no id) still makes one with the store's id; a bad or taken id is refused", async () => {
    const old = await call("POST", "/api/pages", { title: "" });
    expect(old.status).toBe(200);
    expect(pageOf(old).id).toMatch(/^e_/);
    expect((await call("POST", "/api/pages", { id: "e_corto" })).status).toBe(400);
    expect((await call("POST", "/api/pages", { id: 7 })).status).toBe(400);
    // A note's id is not a page's: refused, and the note stays as it was.
    expect((await call("POST", "/api/pages", { id: noteId })).status).toBe(409);
    expect(host.store(1).get(noteId)?.entity.type).not.toBe("page");
  });

  it("is quick with his volume: the repeat is one read by id, never a list (A-15)", async () => {
    const ids = Array.from({ length: 20 }, () => newId("e"));
    const t0 = performance.now();
    for (const id of ids) await call("POST", "/api/pages", { id, title: "" });
    const t1 = performance.now();
    for (const id of ids) await call("POST", "/api/pages", { id, title: "" });
    const t2 = performance.now();
    const create = (t1 - t0) / ids.length;
    const repeat = (t2 - t1) / ids.length;
    console.log(
      `page create: ${create.toFixed(1)} ms, repeated: ${repeat.toFixed(1)} ms (3000 notes, ~190 pages)`,
    );
    // Generous bounds for a slow CI machine; on the laptop both are a few ms.
    expect(create).toBeLessThan(250);
    expect(repeat).toBeLessThan(100);
  });
});
