import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addUser } from "./auth.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds } from "./feeds.ts";
import { makeApp, serve } from "./http.ts";
import { LoginGuard } from "./limits.ts";
import { allowed, ROUTES, routeOf } from "./routes.ts";
import { Vaults } from "./vaults.ts";

/** The two entries of the server (routes.ts): the whole API on the tailnet, the allow-list in public. */
const PASSWORD = "una contraseña larga de ejemplo";
let dir: string;
let db: Db;
let vaults: Vaults;
const servers: Server[] = [];
let tailnet: string;
let pub: string;
let pubWithPrivateMe: string;

async function listen(s: Server): Promise<string> {
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-server-routes-"));
  mkdirSync(join(dir, "vault", "_system/colecciones"), { recursive: true });
  mkdirSync(join(dir, "web"));
  writeFileSync(join(dir, "web", "index.html"), "<!doctype html><title>Boni Calendar</title>");
  mkdirSync(join(dir, "boni-web", "assets"), { recursive: true });
  writeFileSync(join(dir, "boni-web", "index.html"), "<!doctype html><title>Boni</title>");
  writeFileSync(join(dir, "boni-web", "assets", "app.js"), "console.log(1)");
  db = openDb(join(dir, "db.sqlite"));
  addUser(db, "juan", PASSWORD, join(dir, "vault"));
  vaults = new Vaults();
  const opts = {
    db,
    vaults,
    key: randomBytes(32),
    feeds: new Feeds(async () => ""),
    webDir: join(dir, "web"),
    boniWebDir: join(dir, "boni-web"),
    guard: new LoginGuard({ perUser: 3, perAddress: 100, windowMs: 60_000, perMinute: 100 }),
  };
  const app = makeApp(opts);
  tailnet = await listen(serve(app, "tailnet"));
  pub = await listen(serve(app, "public"));
  // A second app whose allow-list leaves one route out, to see what the public entry does with it.
  const strict = makeApp({
    ...opts,
    guard: new LoginGuard(),
    routes: { ...ROUTES, "GET /api/me": "tailnet" },
  });
  pubWithPrivateMe = await listen(serve(strict, "public"));
});

afterAll(async () => {
  for (const s of servers) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
  vaults.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const login = (base: string, password = PASSWORD) =>
  fetch(`${base}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user: "juan", password, device: "prueba" }),
  });

describe("the server's two entries", () => {
  it("lists every route of http.ts, so none becomes public by accident", () => {
    const src = readFileSync(new URL("./http.ts", import.meta.url), "utf8");
    const routes = [
      ...src.matchAll(/(?:case |route === )"((?:GET|POST|PUT|DELETE) \/api\/[^"]*)"/g),
    ].map((m) => m[1]);
    expect(routes.length).toBeGreaterThan(10);
    for (const r of routes) expect(ROUTES[r as string], `${r} is not in routes.ts`).toBeDefined();
    // The Boni API v1, and none of it public.
    const v1 = readFileSync(new URL("./v1/http.ts", import.meta.url), "utf8");
    const v1Routes = [
      ...v1.matchAll(
        /(?:case |route === )"((?:GET|POST|PUT|DELETE) \/(?:api\/v1\/|healthz)[^"]*)"/g,
      ),
    ].map((m) => m[1] as string);
    expect(v1Routes.length).toBeGreaterThan(25);
    for (const r of v1Routes) expect(ROUTES[r], `${r} is not in routes.ts`).toBe("tailnet");
    for (const r of Object.keys(ROUTES).filter(
      (k) => k.includes("/api/v1/") || k.includes("/healthz"),
    ))
      expect(v1Routes, `${r} is listed but not served`).toContain(r);
    // The agent's, none of them public either.
    const ag = readFileSync(new URL("./agent.ts", import.meta.url), "utf8");
    const agRoutes = [...ag.matchAll(/case "((?:GET|POST|PUT|DELETE) \/api\/agent\/[^"]*)"/g)].map(
      (m) => m[1] as string,
    );
    expect(agRoutes.length).toBeGreaterThanOrEqual(10);
    for (const r of agRoutes) expect(ROUTES[r], `${r} is not in routes.ts`).toBe("tailnet");
    for (const r of Object.keys(ROUTES).filter((k) => k.includes("/api/agent/")))
      expect(agRoutes, `${r} is listed but not served`).toContain(r);
  });

  it("finds the route of a path with parameters, fixed routes first", () => {
    expect(routeOf("GET", "/api/v1/charts/catalog")).toEqual({
      route: "GET /api/v1/charts/catalog",
      params: {},
    });
    expect(routeOf("GET", "/api/v1/charts/gasto%20mes")).toEqual({
      route: "GET /api/v1/charts/:id",
      params: { id: "gasto mes" },
    });
    expect(routeOf("GET", "/api/v1/charts/a/data").route).toBe("GET /api/v1/charts/:id/data");
    expect(routeOf("PUT", "/api/v1/charts/order").route).toBe("PUT /api/v1/charts/order");
    expect(routeOf("GET", "/api/v1/charts/%E0%A4%A")).toEqual({
      route: "GET /api/v1/charts/%E0%A4%A",
      params: {},
    });
    expect(routeOf("GET", "/api/v1/charts//data").route).toBe("GET /api/v1/charts//data");
    expect(routeOf("GET", "/api/v1/charts/a/b/data").route).toBe("GET /api/v1/charts/a/b/data");
    expect(allowed("GET /api/v1/charts/:id", "public")).toBe(false);
    expect(allowed("GET constructor", "public")).toBe(false);
  });

  it("serves the calendar's routes and the web app on both, as today", async () => {
    for (const base of [tailnet, pub]) {
      const r = await login(base);
      expect(r.status, base).toBe(200);
      const { token } = (await r.json()) as { token: string };
      const me = await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${token}` } });
      expect(me.status).toBe(200);
      expect((await fetch(`${base}/`)).status).toBe(200);
    }
  });

  it("serves Boni's web app at /boni/ on the tailnet only, like its APIs", async () => {
    const page = await fetch(`${tailnet}/boni/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<title>Boni</title>");
    expect((await fetch(`${tailnet}/boni/assets/app.js`)).status).toBe(200);
    expect((await fetch(`${tailnet}/boni`, { redirect: "manual" })).headers.get("location")).toBe(
      "/boni/",
    );
    expect((await fetch(`${tailnet}/boni/..%2f..%2fdb.sqlite`)).status).toBe(404);
    expect((await fetch(`${pub}/boni/`)).status).toBe(404);
    expect((await fetch(`${pub}/boni/assets/app.js`)).status).toBe(404);
    // The calendar's app is at the public entry's root; the tailnet's (Boni's address) opens Boni.
    expect(await (await fetch(`${pub}/`)).text()).toContain("Boni Calendar");
    const root = await fetch(`${tailnet}/`, { redirect: "manual" });
    expect([root.status, root.headers.get("location")]).toEqual([302, "/boni/"]);
    expect(await (await fetch(`${tailnet}/`)).text()).toContain("<title>Boni</title>");
  });

  it("answers 404 on the public entry for a route off the list, before asking who you are", async () => {
    const { token } = (await (await login(tailnet)).json()) as { token: string };
    const me = await fetch(`${pubWithPrivateMe}/api/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.status).toBe(404);
    expect((await fetch(`${pubWithPrivateMe}/api/me`)).status).toBe(404); // not 401: it does not exist there
    expect((await fetch(`${pub}/api/no-existe`)).status).toBe(404);
    expect((await fetch(`${pub}/api/agent/plan`, { method: "POST" })).status).toBe(404);
  });

  it("shares one app: failed logins on the public entry count on the tailnet's", async () => {
    for (let i = 0; i < 3; i++) expect((await login(pub, "contraseña mala")).status).toBe(401);
    expect((await login(tailnet)).status).toBe(429);
  });
});
