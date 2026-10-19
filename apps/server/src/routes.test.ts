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
import { ROUTES } from "./routes.ts";
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
  db = openDb(join(dir, "db.sqlite"));
  addUser(db, "juan", PASSWORD, join(dir, "vault"));
  vaults = new Vaults();
  const opts = {
    db,
    vaults,
    key: randomBytes(32),
    feeds: new Feeds(async () => ""),
    webDir: join(dir, "web"),
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
