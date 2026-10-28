import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { label } from "@boni/entities";
import {
  DATA_BLOCKS,
  PAGE_TEMPLATES,
  type PageSpec,
  resolveTemplateLinks,
  templateChanges,
  templatePage,
} from "@boni/views";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { addUser } from "./auth.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds } from "./feeds.ts";
import { type App, makeApp, serve } from "./http.ts";
import { LoginGuard } from "./limits.ts";
import { createPage } from "./pages.ts";
import { V1Store } from "./v1/store.ts";

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
  addUser(db, "juan", PASSWORD);
  addUser(db, "ana", PASSWORD);
  addUser(db, "old", PASSWORD);
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
  it("a new account has Boni's templates; what the first Boni's home showed becomes one page, once", async () => {
    const ana = await token("ana");
    const titles = async (t: string) =>
      ((await call(t, "GET", "/api/pages")).body.pages as { title: string }[]).map((p) => p.title);
    expect(await titles(ana)).toEqual(["Uso de la IA", "Actividad", "Registro"]);
    const seeded = (await call(ana, "GET", "/api/pages")).body.pages as {
      id: string;
      template?: (typeof PAGE_TEMPLATES)[number];
    }[];
    const activity = (await call(ana, "GET", `/api/pages/${seeded[1]?.id}`)).body.page as {
      spec: PageSpec;
    };
    expect(activity.spec.blocks.find((b) => b.id === "a7")).toEqual(
      expect.objectContaining({ to: seeded.find((p) => p.template === "registro")?.id }),
    );
    const juan = await token("juan");
    const first = (await call(juan, "GET", "/api/pages")).body.pages as {
      id: string;
      title: string;
    }[];
    expect(first.map((p) => p.title)).toEqual(["Gastos", "Uso de la IA", "Actividad", "Registro"]);
    const page = (await call(juan, "GET", `/api/pages/${first[0]?.id}`)).body.page as {
      spec: { blocks: { type: string; label?: string; chart?: string }[] };
    };
    const types = page.spec.blocks.map((b) => b.type);
    expect(types[0]).toBe("action");
    expect(page.spec.blocks[0]?.label).toBe("Apuntar gasto");
    expect(types).toContain("chart");
    // Deleted, it does not come back by itself; Undo restores it.
    expect((await call(juan, "DELETE", `/api/pages/${first[0]?.id}`)).status).toBe(200);
    expect(await titles(juan)).toEqual(["Uso de la IA", "Actividad", "Registro"]);
    expect((await call(juan, "POST", `/api/pages/${first[0]?.id}/restore`)).status).toBe(200);
    expect((await titles(juan)).length).toBe(4);
    expect((await call(juan, "DELETE", `/api/pages/${first[0]?.id}`)).status).toBe(200);
  });

  it("adds Registro to an existing account once and migrates only the retired template links", async () => {
    const store = host.store(3);
    const uso = createPage(store, { title: "Uso de la IA", spec: templatePage("uso-ia").spec });
    const actividad = createPage(store, {
      title: "Actividad",
      spec: templatePage("actividad").spec,
    });
    store.setSetting("pages/templates", "1");
    const t = await token("old");
    const pages = (await call(t, "GET", "/api/pages")).body.pages as {
      id: string;
      title: string;
      template?: (typeof PAGE_TEMPLATES)[number];
    }[];
    expect(pages.map((p) => p.title)).toEqual(["Uso de la IA", "Actividad", "Registro"]);
    const registro = pages.find((p) => p.template === "registro")?.id ?? "";
    const activity = (await call(t, "GET", `/api/pages/${actividad.id}`)).body.page as {
      spec: PageSpec;
    };
    expect(activity.spec.blocks.filter((b) => b.type === "link")).toEqual([
      expect.objectContaining({ id: "a7", to: registro }),
    ]);
    const ai = (await call(t, "GET", `/api/pages/${uso.id}`)).body.page as { spec: PageSpec };
    expect(ai.spec.blocks.some((b) => b.id === "u8")).toBe(false);
    await call(t, "DELETE", `/api/pages/${registro}`);
    const again = (await call(t, "GET", "/api/pages")).body.pages as { title: string }[];
    expect(again.some((p) => p.title === "Registro")).toBe(false);
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
    expect(left).toContainEqual(expect.objectContaining({ id: sub.id, parent: null }));
    expect(left.some((p) => p.id === made.id)).toBe(false);
    // The removed page waits in the trash.
    const trash = (await call(t, "GET", "/api/pages-trash")).body.pages as { id: string }[];
    expect(trash.map((p) => p.id)).toContain(made.id);
  });

  it("Boni's templates: blocks over Boni's own records that compute, changed and restored like any page", async () => {
    const t = await token("ana");
    const pages = (await call(t, "GET", "/api/pages")).body.pages as {
      id: string;
      title: string;
      template?: (typeof PAGE_TEMPLATES)[number];
    }[];
    for (const name of PAGE_TEMPLATES) {
      const made = templatePage(name);
      const expected = resolveTemplateLinks(made.spec, pages);
      const id = pages.find((p) => p.title === made.title)?.id ?? "";
      const page = (await call(t, "GET", `/api/pages/${id}`)).body.page as {
        icon: string;
        spec: PageSpec;
      };
      expect(page.icon).toBe(made.icon);
      expect(page.spec).toEqual(expected);
      // Every number and chart computes from Boni's collections (none comes back with problems).
      const blocks = page.spec.blocks.filter((b) =>
        (DATA_BLOCKS as readonly string[]).includes(b.type),
      );
      expect(blocks.length).toBeGreaterThan(3);
      const out = (await call(t, "POST", "/api/data/blocks", { blocks })).body.results as Record<
        string,
        { problems?: unknown }
      >;
      for (const b of blocks) expect(out[b.id]?.problems, `${name} ${b.id}`).toBeUndefined();
      // The database block lists one of them.
      const db = page.spec.blocks.find((b) => b.type === "database") as
        | { source: string }
        | undefined;
      if (db) expect((await call(t, "GET", `/api/data/types/${db.source}/rows`)).status).toBe(200);
      // Changed like any page; restored by putting Boni's version back.
      const mine = { ...page.spec, blocks: page.spec.blocks.slice(1) };
      expect((await call(t, "PUT", `/api/pages/${id}`, { spec: mine })).status).toBe(200);
      expect(templateChanges(name, mine).length).toBeGreaterThan(0);
      await call(t, "PUT", `/api/pages/${id}`, { spec: expected });
      const back = (await call(t, "GET", `/api/pages/${id}`)).body.page as { spec: PageSpec };
      expect(templateChanges(name, back.spec, pages)).toEqual([]);
    }
    // Removed, a template is not made again.
    const uso = pages.find((p) => p.title === "Uso de la IA")?.id ?? "";
    await call(t, "DELETE", `/api/pages/${uso}`);
    const now = (await call(t, "GET", "/api/pages")).body.pages as { title: string }[];
    expect(now.some((p) => p.title === "Uso de la IA")).toBe(false);
  });

  it("a page stored with a retired block keeps the rest (design audit, 2026-10-25)", async () => {
    const t = await token("ana");
    const made = (await call(t, "POST", "/api/pages", { title: "Antigua" })).body.page as {
      id: string;
    };
    host.store(2).update(
      made.id,
      {
        f_spec: {
          value: JSON.stringify({
            version: 1,
            blocks: [
              { id: "m", type: "models" },
              { id: "s", type: "number", from: "boni", source: "spend" },
              { id: "t", type: "text", text: "Lo que escribí" },
            ],
          }),
          label: label("own", "personal", [{ kind: "code", id: "pages" }]),
        },
      },
      { actor: "system" },
    );
    const page = (await call(t, "GET", `/api/pages/${made.id}`)).body.page as { spec: PageSpec };
    expect(page.spec.blocks).toEqual([{ id: "t", type: "text", text: "Lo que escribí" }]);
  });
});
