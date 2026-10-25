import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { addUser } from "./auth.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds } from "./feeds.ts";
import { type App, makeApp, serve } from "./http.ts";
import { LoginGuard } from "./limits.ts";
import { V1Store } from "./v1/store.ts";
import { Vaults } from "./vaults.ts";

const PASSWORD = "una contraseña larga de ejemplo";
let dir: string;
let db: Db;
let host: AgentHost;
let app: App;
let http: HttpServer;
let base = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-pages-"));
  db = openDb(join(dir, "system.db"));
  addUser(db, "juan", PASSWORD, "");
  addUser(db, "ana", PASSWORD, "");
  // Juan used the first Boni: a chart on its home and a shortcut. Ana only had its default charts made
  // (the app asked for them), which is not using it.
  const v1 = new V1Store(db);
  v1.charts(1);
  v1.charts(2);
  v1.createShortcut(1, {
    id: "cafe",
    label: "Café",
    screen: "capture-expense",
    values: { concept: "Café" },
    mode: "save",
    color: null,
  });
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
});

afterAll(async () => {
  http.closeAllConnections();
  await new Promise((r) => http.close(r));
  app.close();
  host.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function token(user: string, device = "portatil-ejemplo") {
  const r = await fetch(`${base}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user, password: PASSWORD, device }),
  });
  return ((await r.json()) as { token: string }).token;
}
const call = async (t: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${t}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

describe("the user's pages (docs/extensiones.md 6)", () => {
  it("a new account has none; what the first Boni's home showed becomes one page, once", async () => {
    const ana = await token("ana");
    expect((await call(ana, "GET", "/api/pages")).body).toEqual({ pages: [] });
    const juan = await token("juan");
    const first = (await call(juan, "GET", "/api/pages")).body.pages as {
      id: string;
      title: string;
    }[];
    expect(first.map((p) => p.title)).toEqual(["Gastos"]);
    const page = (await call(juan, "GET", `/api/pages/${first[0]?.id}`)).body.page as {
      spec: { blocks: { type: string; label?: string; chart?: string }[] };
    };
    const types = page.spec.blocks.map((b) => b.type);
    expect(types[0]).toBe("action");
    expect(page.spec.blocks[0]?.label).toBe("Apuntar gasto");
    expect(types).toContain("chart");
    // Deleted, it does not come back by itself; Undo restores it.
    expect((await call(juan, "DELETE", `/api/pages/${first[0]?.id}`)).status).toBe(200);
    expect((await call(juan, "GET", "/api/pages")).body).toEqual({ pages: [] });
    expect((await call(juan, "POST", `/api/pages/${first[0]?.id}/restore`)).status).toBe(200);
    expect(((await call(juan, "GET", "/api/pages")).body.pages as unknown[]).length).toBe(1);
    expect((await call(juan, "DELETE", `/api/pages/${first[0]?.id}`)).status).toBe(200);
  });

  it("are made, renamed, nested and changed only with blocks of the catalogue, from a personal device", async () => {
    const t = await token("ana");
    const made = (await call(t, "POST", "/api/pages", { title: "Docencia" })).body.page as {
      id: string;
    };
    const sub = (await call(t, "POST", "/api/pages", { title: "Exámenes", parent: made.id })).body
      .page as {
      id: string;
      parent: string;
    };
    expect(sub.parent).toBe(made.id);
    const spec = {
      version: 1,
      blocks: [
        { id: "h", type: "heading", text: "Exámenes de noviembre" },
        { id: "t", type: "text", text: "Fechas y aulas." },
      ],
    };
    const changed = await call(t, "PUT", `/api/pages/${sub.id}`, { title: "Exámenes 2026", spec });
    expect(changed.body.page).toMatchObject({ title: "Exámenes 2026", spec });
    // Anything off the catalogue is refused, and nothing changes.
    for (const bad of [
      {
        spec: {
          version: 1,
          blocks: [{ id: "x", type: "html", html: "<script>alert(1)</script>" }],
        },
      },
      { title: "x".repeat(121) },
      { parent: sub.id },
    ])
      expect((await call(t, "PUT", `/api/pages/${sub.id}`, bad)).status).toBe(400);
    // Nor under its own subpage (no loops in the tree).
    expect((await call(t, "PUT", `/api/pages/${made.id}`, { parent: sub.id })).status).toBe(400);
    expect(
      ((await call(t, "GET", `/api/pages/${sub.id}`)).body.page as { title: string }).title,
    ).toBe("Exámenes 2026");
    // A shared device reads them but changes nothing; another account never sees them.
    db.prepare("UPDATE devices SET trust = 'shared' WHERE name = 'tele-ejemplo'").run();
    const tv = await token("ana", "tele-ejemplo");
    db.prepare("UPDATE devices SET trust = 'shared' WHERE name = 'tele-ejemplo'").run();
    expect((await call(tv, "GET", "/api/pages")).status).toBe(200);
    expect((await call(tv, "POST", "/api/pages", { title: "x" })).status).toBe(403);
    const juan = await token("juan");
    expect((await call(juan, "GET", `/api/pages/${sub.id}`)).status).toBe(404);
    // Removing a page moves its subpages up.
    expect((await call(t, "DELETE", `/api/pages/${made.id}`)).status).toBe(200);
    const left = (await call(t, "GET", "/api/pages")).body.pages as {
      id: string;
      parent: string | null;
    }[];
    expect(left).toEqual([expect.objectContaining({ id: sub.id, parent: null })]);
    // The removed page waits in the trash.
    const trash = (await call(t, "GET", "/api/pages-trash")).body.pages as { id: string }[];
    expect(trash.map((p) => p.id)).toContain(made.id);
  });

  it("Boni's own screens as pages: Boni's until changed, kept for the account, restored", async () => {
    const t = await token("ana");
    const get = async () =>
      (await call(t, "GET", "/api/pages/system/models")).body.page as {
        spec: { blocks: { id: string }[] };
        modified: boolean;
      };
    const boni = await get();
    expect(boni.modified).toBe(false);
    expect(boni.spec.blocks.map((b) => b.id)).toContain("uses");
    const mine = { ...boni.spec, blocks: boni.spec.blocks.filter((b) => b.id !== "keys") };
    expect((await call(t, "PUT", "/api/pages/system/models", { spec: mine })).status).toBe(200);
    expect((await get()).modified).toBe(true);
    // Another device of the account sees the same page.
    const other = await token("ana", "movil-ejemplo");
    const seen = (await call(other, "GET", "/api/pages/system/models")).body.page as {
      modified: boolean;
    };
    expect(seen.modified).toBe(true);
    // Only blocks of the catalogue; only Boni's screens.
    const bad = { ...mine, blocks: [{ id: "x", type: "html" }] };
    expect((await call(t, "PUT", "/api/pages/system/models", { spec: bad })).status).toBe(400);
    expect((await call(t, "GET", "/api/pages/system/nada")).status).toBe(404);
    // Restored: Boni's again; putting back Boni's own blocks is no change either.
    expect((await call(t, "DELETE", "/api/pages/system/models")).status).toBe(200);
    expect((await get()).modified).toBe(false);
    await call(t, "PUT", "/api/pages/system/models", { spec: boni.spec });
    expect((await get()).modified).toBe(false);
  });
});
