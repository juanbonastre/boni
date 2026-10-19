import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { wrappedKeyProvider } from "@boni/store";
import { afterEach, describe, expect, it } from "vitest";
import {
  addAccount,
  devicesOf,
  hashPassword,
  login,
  openSystemDb,
  revokeDevice,
  SESSION_IDLE_MS,
  type SystemDb,
  sessionOf,
  setPassword,
  setTrust,
  tokenHash,
  verifyPassword,
  wrappedKeysIn,
} from "./identity.ts";
import { importAccounts } from "./import.ts";

const PASS = "contrasena-de-prueba-12";
/** Made by the old Boni server's Python code (boni.auth.hash_password) for PASS. */
const PYTHON_HASH = "scrypt$Ba/8yWgg5U4C5oONNVXsqw==$XY4TLU0BCOuQ1MILSVG/UyN63JXOjMcEFfFXGgpQcOs=";

const dirs: string[] = [];
const dbs: { close(): void }[] = [];
afterEach(() => {
  for (const d of dbs.splice(0)) d.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "boni-identity-"));
  dirs.push(d);
  return d;
}
function system(): SystemDb {
  const db = openSystemDb(":memory:");
  dbs.push(db);
  return db;
}

describe("accounts and sessions", () => {
  it("reads both old servers' password hashes", () => {
    expect(verifyPassword(PASS, PYTHON_HASH)).toBe(true);
    expect(verifyPassword("otra-contrasena-123", PYTHON_HASH)).toBe(false);
    expect(verifyPassword(PASS, hashPassword(PASS))).toBe(true);
  });

  it("logs a device in, finds it by its token, and lets it go after 90 idle days", () => {
    const db = system();
    addAccount(db, "ana", PASS, { vault: "/vault" });
    expect(login(db, "ana", "mala-contrasena-1", "portatil", { listener: "tailnet" })).toBeNull();
    expect(login(db, "nadie", PASS, "portatil", { listener: "tailnet" })).toBeNull();
    const s = login(db, "ana", PASS, "portatil", { kind: "desktop", listener: "tailnet" });
    expect(s?.account).toEqual({ id: 1, name: "ana", vault: "/vault" });
    const found = sessionOf(db, s?.token);
    expect(found?.device).toMatchObject({ name: "portatil", trust: "personal" });
    // Only the token's hash is stored.
    expect(
      db
        .prepare("SELECT count(*) AS n FROM sessions WHERE token_hash = ?")
        .get(tokenHash(s?.token as string)),
    ).toEqual({ n: 1 });
    expect(JSON.stringify(db.prepare("SELECT * FROM sessions").all())).not.toContain(
      s?.token as string,
    );
    expect(sessionOf(db, s?.token, Date.now() + SESSION_IDLE_MS + 1000)).toBeNull();
    expect(sessionOf(db, s?.token)).toBeNull(); // and it is gone
  });

  it("one device per name, its own sessions revoked alone, a new password ends them all", () => {
    const db = system();
    addAccount(db, "ana", PASS);
    const a = login(db, "ana", PASS, "movil", { kind: "phone", listener: "public" });
    const b = login(db, "ana", PASS, "movil", { kind: "phone", listener: "tailnet" });
    const c = login(db, "ana", PASS, "portatil", { kind: "desktop", listener: "tailnet" });
    expect(devicesOf(db, "ana").map((d) => [d.name, d.sessions])).toEqual([
      ["movil", 2],
      ["portatil", 1],
    ]);
    expect(revokeDevice(db, "ana", "movil")).toBe(2);
    expect(sessionOf(db, a?.token)).toBeNull();
    expect(sessionOf(db, b?.token)).toBeNull();
    expect(sessionOf(db, c?.token)?.device.name).toBe("portatil");
    expect(setPassword(db, "ana", "nueva-contrasena-12")).toBe(1);
    expect(sessionOf(db, c?.token)).toBeNull();
  });

  it("a shared screen cannot make itself personal", () => {
    const db = system();
    addAccount(db, "ana", PASS);
    const tv = login(db, "ana", PASS, "tele", { kind: "tv", listener: "tailnet" });
    const web = login(db, "ana", PASS, "navegador", { kind: "browser", listener: "public" });
    const phone = login(db, "ana", PASS, "movil", { kind: "phone", listener: "public" });
    expect([tv?.device.trust, web?.device.trust, phone?.device.trust]).toEqual([
      "shared",
      "shared",
      "personal",
    ]);
    const tvId = tv?.device.id as string;
    expect(() => setTrust(db, tvId, "personal", { device: tvId })).toThrow(
      /another personal device/,
    );
    expect(() => setTrust(db, tvId, "personal", { device: web?.device.id as string })).toThrow();
    setTrust(db, tvId, "personal", { device: phone?.device.id as string });
    expect(sessionOf(db, tv?.token)?.device.trust).toBe("personal");
    setTrust(db, tvId, "ambient", { device: tvId }); // lowering is always allowed
  });

  it("keeps each account's data key only wrapped, for the user's store", () => {
    const db = system();
    addAccount(db, "ana", PASS);
    const keys = wrappedKeyProvider(Buffer.alloc(32, 9), wrappedKeysIn(db));
    const k = keys.dataKey("1");
    expect(keys.dataKey("1").equals(k)).toBe(true);
    const row = db.prepare("SELECT wrapped FROM data_keys WHERE account_id = 1").get() as {
      wrapped: Uint8Array;
    };
    expect(Buffer.from(row.wrapped).includes(k)).toBe(false);
  });
});

/** The two old servers' databases, with their real schemas (calendar db.ts, Boni store.py) and invented rows. */
function oldCalendar(dir: string, lastSeen: number): string {
  const path = join(dir, "boni-calendar.db");
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, pass TEXT NOT NULL, vault TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, device TEXT NOT NULL, created INTEGER NOT NULL, last_seen INTEGER NOT NULL);
    CREATE TABLE account_data (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, value TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (user_id, key));
    CREATE TABLE push (token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, endpoint TEXT NOT NULL, updated INTEGER NOT NULL);`);
  db.prepare("INSERT INTO users VALUES (1, 'ana', ?, '/vault', 1700000000000)").run(
    hashPassword(PASS),
  );
  db.prepare("INSERT INTO sessions VALUES (?, 1, 'portatil', 1700000000000, ?)").run(
    tokenHash("token-calendario-portatil"),
    lastSeen,
  );
  db.prepare("INSERT INTO sessions VALUES (?, 1, 'movil', 1700000000000, ?)").run(
    tokenHash("token-calendario-movil"),
    lastSeen,
  );
  db.prepare("INSERT INTO sessions VALUES (?, 1, 'viejo', 1600000000000, 1600000000000)").run(
    tokenHash("token-caducado"),
  );
  db.prepare(
    "INSERT INTO account_data VALUES (1, 'prefs', '{\"locale\":\"es\"}', 1700000000001)",
  ).run();
  db.prepare(
    "INSERT INTO account_data VALUES (1, 'externals', 'cifrado-con-secret-key', 1700000000002)",
  ).run();
  db.prepare("INSERT INTO push VALUES (?, 1, 'https://ntfy.example/upABC', 1700000000003)").run(
    tokenHash("token-calendario-movil"),
  );
  db.close();
  return path;
}
function oldBoni(dir: string, lastSeenSeconds: number): string {
  const path = join(dir, "boni.sqlite3");
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE devices (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, token_hash TEXT NOT NULL UNIQUE, created TEXT NOT NULL, last_seen TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, pass TEXT NOT NULL, created TEXT NOT NULL);
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, device TEXT NOT NULL, created TEXT NOT NULL, last_seen REAL NOT NULL);`);
  db.prepare("INSERT INTO users VALUES (7, 'ana', ?, '2026-10-17T10:00:00+00:00')").run(
    PYTHON_HASH,
  );
  db.prepare("INSERT INTO users VALUES (8, 'luis', ?, '2026-10-17T10:00:00+00:00')").run(
    PYTHON_HASH,
  );
  db.prepare("INSERT INTO sessions VALUES (?, 7, 'portatil', '2026-10-17T10:00:00+00:00', ?)").run(
    tokenHash("token-boni-portatil"),
    lastSeenSeconds,
  );
  db.prepare("INSERT INTO sessions VALUES (?, 8, 'tablet', '2026-10-17T10:00:00+00:00', ?)").run(
    tokenHash("token-boni-luis"),
    lastSeenSeconds,
  );
  db.prepare(
    "INSERT INTO devices VALUES (1, 'viejo', 'x', '2026-10-13T10:00:00+00:00', NULL)",
  ).run();
  db.close();
  return path;
}

describe("importing the two old servers", () => {
  it("a dry run reports and writes nothing; applying keeps every device logged in", () => {
    const dir = tmp();
    const now = Date.now();
    const calendar = oldCalendar(dir, now - 3_600_000);
    const boni = oldBoni(dir, (now - 3_600_000) / 1000);
    const db = system();

    const dry = importAccounts(db, { calendar, boni, now });
    expect(dry.applied).toBe(false);
    expect(dry.accounts).toEqual([
      {
        name: "ana",
        from: ["calendar", "boni"],
        password: "calendar",
        sessions: 3,
        existing: false,
      },
      { name: "luis", from: ["boni"], password: "boni", sessions: 1, existing: false },
    ]);
    expect(dry.sessions).toEqual({ imported: 4, already: 0, expired: 1 });
    expect(dry.devices).toBe(3); // ana's "portatil" is one device on both servers
    expect(dry.oldDeviceTokens).toBe(1);
    expect(db.prepare("SELECT count(*) AS n FROM accounts").get()).toEqual({ n: 0 });

    const done = importAccounts(db, { calendar, boni, now, apply: true });
    expect(done.sessions.imported).toBe(4);
    // The same tokens the devices already have keep working, from either old server.
    for (const t of ["token-calendario-portatil", "token-calendario-movil", "token-boni-portatil"])
      expect(sessionOf(db, t)?.account.name, t).toBe("ana");
    expect(sessionOf(db, "token-boni-luis")?.account.name).toBe("luis");
    expect(sessionOf(db, "token-caducado")).toBeNull();
    expect(devicesOf(db, "ana").map((d) => [d.name, d.sessions])).toEqual([
      ["movil", 1],
      ["portatil", 2],
    ]);
    // The calendar's password and vault; Boni's password still works for its only user.
    expect(login(db, "ana", PASS, "x", { listener: "tailnet" })?.account.vault).toBe("/vault");
    expect(login(db, "luis", PASS, "x", { listener: "tailnet" })).not.toBeNull();
    expect(db.prepare("SELECT key, value FROM account_data ORDER BY key").all()).toEqual([
      { key: "externals", value: "cifrado-con-secret-key" },
      { key: "prefs", value: '{"locale":"es"}' },
    ]);
    expect(db.prepare("SELECT endpoint FROM push").all()).toEqual([
      { endpoint: "https://ntfy.example/upABC" },
    ]);

    // Again: nothing new.
    const again = importAccounts(db, { calendar, boni, now, apply: true });
    expect(again.sessions).toEqual({ imported: 0, already: 4, expired: 1 });
    expect(again.accounts.every((a) => a.existing && a.password === "kept")).toBe(true);
    expect(again.accountData + again.push + again.devices).toBe(0);
  });

  it("can keep Boni's password instead, and never touches the old databases", () => {
    const dir = tmp();
    const now = Date.now();
    const calendar = oldCalendar(dir, now);
    const boni = oldBoni(dir, now / 1000);
    const db = system();
    importAccounts(db, { calendar, boni, now, passwordFrom: "boni", apply: true });
    const pass = (
      db.prepare("SELECT pass FROM accounts WHERE name = 'ana'").get() as { pass: string }
    ).pass;
    expect(pass).toBe(PYTHON_HASH);
    const old = new DatabaseSync(calendar, { readOnly: true });
    expect(old.prepare("SELECT count(*) AS n FROM sessions").get()).toEqual({ n: 3 });
    old.close();
  });
});
