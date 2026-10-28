import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { label } from "@boni/entities";
import { wrappedKeysIn } from "@boni/identity";
import { openUserStore, restoreBackup, wrappedKeyProvider } from "@boni/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { addUser, SESSION_IDLE_MS } from "./auth.ts";
import { backupNow, backupStoresNow } from "./backups.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds } from "./feeds.ts";
import { makeServer } from "./http.ts";
import { clientAddress, LoginGuard } from "./limits.ts";
import { calendarDef, seed } from "./seed.test-util.ts";

/** Phase 6: what the server needs before it is reachable from the internet. */
const PASSWORD = "una contraseña larga de ejemplo";
let dir: string;
let db: Db;
let host: AgentHost;
let base: string;
let server: ReturnType<typeof makeServer>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-server-hardening-"));
  mkdirSync(join(dir, "web"));
  mkdirSync(join(dir, "web2"));
  writeFileSync(join(dir, "web", "index.html"), "<!doctype html><title>Boni Calendar</title>");
  writeFileSync(join(dir, "web2", "secreto.txt"), "no");
  db = openDb(join(dir, "db.sqlite"));
  addUser(db, "juan", PASSWORD);
  addUser(db, "otra", PASSWORD);
  // Each account with a calendar of its own (its data apart from the backups' test below).
  host = new AgentHost({ dataDir: join(dir, "data"), providers: null });
  for (const account of [1, 2])
    seed(
      host.store(account),
      [
        {
          key: "docencia",
          name: "Docencia",
          folder: "agenda/docencia/",
          calendar: calendarDef("docencia", "Docencia", "agenda/docencia"),
        },
      ],
      {},
    );
  server = makeServer({
    db,
    agent: host,
    key: randomBytes(32),
    feeds: new Feeds(async () => ""),
    webDir: join(dir, "web"),
    guard: new LoginGuard({ perUser: 3, perAddress: 6, windowMs: 60_000, perMinute: 100 }),
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  host.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const login = (user: string, password: string, from = "203.0.113.7") =>
  fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "x-forwarded-for": from },
    body: JSON.stringify({ user, password, device: "prueba" }),
  });

describe("logging in from the internet", () => {
  it("a user locked after failed attempts keeps the sessions it has; other users are not affected", async () => {
    const token = ((await (await login("juan", PASSWORD)).json()) as { token: string }).token;
    for (let i = 0; i < 3; i++)
      expect((await login("juan", "mal", `198.51.100.${i}`)).status).toBe(401);
    const locked = await login("juan", PASSWORD, "198.51.100.9");
    expect(locked.status).toBe(429);
    expect(locked.headers.get("retry-after")).toBe("900");
    // The phone already logged in goes on working; another account can log in.
    expect(
      (await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${token}` } })).status,
    ).toBe(200);
    expect((await login("otra", PASSWORD, "198.51.100.10")).status).toBe(200);
  });

  it("one address guessing several names is stopped too", async () => {
    for (let i = 0; i < 6; i++) await login(`nadie${i}`, "mal", "192.0.2.50");
    expect((await login("otra", PASSWORD, "192.0.2.50")).status).toBe(429);
    expect((await login("otra", PASSWORD, "192.0.2.51")).status).toBe(200);
  });

  it("trusts X-Forwarded-For only from the local proxy (Tailscale serve)", () => {
    expect(clientAddress("127.0.0.1", "203.0.113.7, 10.0.0.1")).toBe("203.0.113.7");
    expect(clientAddress("100.64.1.2", "203.0.113.7")).toBe("100.64.1.2");
    // The public node's sidecar over an internal network, when it is named as a proxy.
    const proxies = new Set(["172.31.250.2"]);
    expect(clientAddress("::ffff:172.31.250.2", "203.0.113.7", proxies)).toBe("203.0.113.7");
    expect(clientAddress("172.31.250.3", "203.0.113.7", proxies)).toBe("172.31.250.3");
    expect(clientAddress("::1", undefined)).toBe("::1");
  });

  it("forgets failures after the window, and counts attempts overall", () => {
    let now = 0;
    const g = new LoginGuard(
      { perUser: 2, perAddress: 99, windowMs: 1000, perMinute: 3 },
      () => now,
    );
    g.failed("juan", "a");
    g.failed("juan", "a");
    expect(g.allow("juan", "a")).toBe(false);
    now = 1500;
    expect(g.allow("juan", "a")).toBe(true);
    expect(g.allow("otra", "b")).toBe(true);
    expect(g.allow("otra", "b")).toBe(false); // the 4th attempt in a minute (3 allowed)
  });

  it("a session not used for months ends", async () => {
    const token = (
      (await (await login("otra", PASSWORD, "192.0.2.60")).json()) as { token: string }
    ).token;
    db.prepare("UPDATE sessions SET last_seen = ?").run(Date.now() - SESSION_IDLE_MS - 1000);
    expect(
      (await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${token}` } })).status,
    ).toBe(401);
  });
});

describe("answers", () => {
  it("the web app comes with security headers and nothing outside its folder is served", async () => {
    const page = await fetch(`${base}/`);
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
    expect(page.headers.get("strict-transport-security")).toContain("max-age=");
    expect((await fetch(`${base}/api/me`)).headers.get("x-content-type-options")).toBe("nosniff");
    // A sibling folder whose name starts like the web app's.
    expect((await fetch(`${base}/..%2Fweb2%2Fsecreto.txt`)).status).toBe(404);
    expect((await fetch(`${base}/%2e%2e/web2/secreto.txt`)).status).toBe(404);
  });
});

describe("backups", () => {
  it("one consistent copy a day, keeping the last ones", () => {
    const out = join(dir, "backups");
    for (let d = 1; d <= 5; d++) backupNow(db, out, 3, new Date(Date.UTC(2026, 9, d)));
    expect(readdirSync(out).sort()).toEqual([
      "boni-calendar-2026-10-03.db",
      "boni-calendar-2026-10-04.db",
      "boni-calendar-2026-10-05.db",
    ]);
    expect(backupNow(db, out, 3, new Date(Date.UTC(2026, 9, 5)))).toBeNull(); // already made today
    const copy = openDb(join(out, "boni-calendar-2026-10-05.db"));
    expect((copy.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n).toBe(2);
    copy.close();
    expect(existsSync(join(out, "secret.key"))).toBe(false);
  });

  it("each account's store, encrypted with the account's key", () => {
    const users = join(dir, "users");
    mkdirSync(users, { recursive: true });
    const store = openUserStore(join(users, "1.db"));
    const own = label("user", "personal", []);
    store.applySchema(
      {
        op: "create_type",
        type: {
          id: "t_libro",
          key: "libro",
          name: "Libros",
          fields: [{ id: "f_titulo", key: "titulo", name: "Título", type: "text", label: own }],
          titleField: "f_titulo",
          sensitivity: "personal",
          schemaVersion: 1,
          label: own,
        },
      },
      { actor: "user" },
    );
    store.create("t_libro", { f_titulo: { value: "MARCA-LIBRO", label: own } }, { actor: "user" });
    const out = join(dir, "backups-stores");
    const master = randomBytes(32);
    const o = { usersDir: users, accounts: () => [1, 2], store: () => store, master };
    for (let d = 1; d <= 4; d++) backupStoresNow(db, out, 2, o, new Date(Date.UTC(2026, 9, d)));
    expect(readdirSync(out).sort()).toEqual([
      "user-1-2026-10-03.db.sealed",
      "user-1-2026-10-04.db.sealed",
    ]);
    const sealed = readFileSync(join(out, "user-1-2026-10-04.db.sealed"));
    expect(sealed.includes(Buffer.from("MARCA-LIBRO"))).toBe(false);
    // Opened with the account's own key (kept wrapped in system.db), and only with it.
    const key = wrappedKeyProvider(master, wrappedKeysIn(db)).dataKey("1");
    restoreBackup(join(out, "user-1-2026-10-04.db" + ".sealed"), key, join(dir, "back.db"));
    const back = openUserStore(join(dir, "back.db"));
    expect(back.list("t_libro").map((s) => s.entity.values.f_titulo)).toEqual(["MARCA-LIBRO"]);
    back.close();
    const other = wrappedKeyProvider(master, wrappedKeysIn(db)).dataKey("2");
    expect(() =>
      restoreBackup(join(out, "user-1-2026-10-04.db.sealed"), other, join(dir, "x.db")),
    ).toThrow();
    store.close();
  });
});
