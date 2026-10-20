import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { WrappedKeys } from "@boni/store";

/**
 * The single Boni account (docs/nucleo.md, 6): one system.db for every app, with accounts (made by the
 * administrator, never by sign-up), devices with a trust level, device sessions (only the hash of a
 * token is stored) and each account's data key, wrapped. Nothing here holds a user's data: that lives
 * in the user's own store. The scrypt format and the session token hashing are the same as both old
 * servers', so their accounts and sessions move over as they are (import.ts).
 */

export type SystemDb = DatabaseSync;

export type DeviceKind = "desktop" | "phone" | "browser" | "tv" | "watch" | "speaker" | "unknown";
/** personal: confirms sensitive actions; shared: reads and proposes; ambient: speaks, never confirms. */
export type Trust = "personal" | "shared" | "ambient";
/** Where a session was opened: the full tailnet entry, the public allow-list, or moved from an old server. */
export type Listener = "tailnet" | "public" | "migrated";

export interface Account {
  id: number;
  name: string;
  /** The vault folder on the server, while collections still live there (the calendar's accounts). */
  vault: string | null;
}

export interface Device {
  id: string;
  name: string;
  kind: DeviceKind;
  trust: Trust;
  created: number;
  lastSeen: number;
}

const MIGRATIONS = [
  `CREATE TABLE accounts (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL UNIQUE,
     pass TEXT NOT NULL,
     vault TEXT,
     created INTEGER NOT NULL,
     disabled INTEGER
   );
   CREATE TABLE devices (
     id TEXT PRIMARY KEY,
     account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     kind TEXT NOT NULL,
     trust TEXT NOT NULL,
     created INTEGER NOT NULL,
     last_seen INTEGER NOT NULL,
     UNIQUE (account_id, name)
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
     listener TEXT NOT NULL,
     created INTEGER NOT NULL,
     last_seen INTEGER NOT NULL
   );
   CREATE TABLE account_data (
     account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     key TEXT NOT NULL,
     value TEXT NOT NULL,
     updated INTEGER NOT NULL,
     PRIMARY KEY (account_id, key)
   );
   CREATE TABLE push (
     token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
     account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     endpoint TEXT NOT NULL,
     updated INTEGER NOT NULL
   );
   CREATE TABLE data_keys (
     account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
     wrapped BLOB NOT NULL
   );`,
];

export function openSystemDb(path: string): SystemDb {
  const db = new DatabaseSync(path);
  // The server and the admin's commands share this file: a writer waits for the other.
  db.exec(
    "PRAGMA busy_timeout = 15000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;",
  );
  const version = (db.prepare("PRAGMA user_version").get() as { user_version: number })
    .user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    db.exec(MIGRATIONS[v] as string);
    db.exec(`PRAGMA user_version = ${v + 1}`);
    db.exec("COMMIT");
  }
  return db;
}

// ---------------------------------------------------------------- passwords and tokens

const SCRYPT = { N: 16384, r: 8, p: 1 };

/** `scrypt$salt$hash` (base64), exactly as both old servers write it. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, SCRYPT);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [kind, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = scryptSync(password, Buffer.from(salt, "base64"), want.length, SCRYPT);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** How a session token is stored: its sha256 in hex (as both old servers). */
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

// Hashed once: a login for a name that does not exist does the same work as a real one.
const DUMMY = hashPassword("not a real password, only for timing");

const NAME = /^[a-z0-9._-]{2,32}$/i;
export const MIN_PASSWORD = 12;
/** A session not used for this long ends (a lost or forgotten device stops being a way in). */
export const SESSION_IDLE_MS = 90 * 86_400_000;

// ---------------------------------------------------------------- accounts

export function addAccount(
  db: SystemDb,
  name: string,
  password: string,
  opts: { vault?: string } = {},
): Account {
  if (!NAME.test(name)) throw new Error("A name is 2-32 letters, digits, . _ -");
  if (password.length < MIN_PASSWORD)
    throw new Error(`The password needs at least ${MIN_PASSWORD} characters`);
  const r = db
    .prepare("INSERT INTO accounts (name, pass, vault, created) VALUES (?, ?, ?, ?)")
    .run(name, hashPassword(password), opts.vault ?? null, Date.now());
  return { id: Number(r.lastInsertRowid), name, vault: opts.vault ?? null };
}

export function listAccounts(db: SystemDb): (Account & { sessions: number; disabled: boolean })[] {
  return (
    db
      .prepare(
        "SELECT a.id, a.name, a.vault, a.disabled, (SELECT count(*) FROM sessions s WHERE s.account_id = a.id) AS sessions FROM accounts a ORDER BY a.name",
      )
      .all() as {
      id: number;
      name: string;
      vault: string | null;
      disabled: number | null;
      sessions: number;
    }[]
  ).map((r) => ({
    id: r.id,
    name: r.name,
    vault: r.vault,
    sessions: r.sessions,
    disabled: !!r.disabled,
  }));
}

const accountByName = (db: SystemDb, name: string) =>
  db.prepare("SELECT id, name, vault, pass, disabled FROM accounts WHERE name = ?").get(name) as
    | (Account & { pass: string; disabled: number | null })
    | undefined;

/** A new password ends every session of the account. */
export function setPassword(db: SystemDb, name: string, password: string): number {
  if (password.length < MIN_PASSWORD)
    throw new Error(`The password needs at least ${MIN_PASSWORD} characters`);
  const a = accountByName(db, name);
  if (!a) throw new Error(`No account "${name}"`);
  db.prepare("UPDATE accounts SET pass = ? WHERE id = ?").run(hashPassword(password), a.id);
  return revokeAll(db, name);
}

// ---------------------------------------------------------------- devices and sessions

/** The trust a new device gets. Raising it later needs a personal device to confirm (setTrust). */
export function defaultTrust(kind: DeviceKind, listener: Listener): Trust {
  if (kind === "speaker") return "ambient";
  if (kind === "tv") return "shared";
  if (kind === "browser" && listener === "public") return "shared";
  return "personal";
}

function deviceRow(
  db: SystemDb,
  accountId: number,
  name: string,
  kind: DeviceKind,
  listener: Listener,
  now: number,
): Device {
  const found = db
    .prepare("SELECT * FROM devices WHERE account_id = ? AND name = ?")
    .get(accountId, name) as
    | {
        id: string;
        name: string;
        kind: DeviceKind;
        trust: Trust;
        created: number;
        last_seen: number;
      }
    | undefined;
  if (found)
    return {
      id: found.id,
      name: found.name,
      kind: found.kind,
      trust: found.trust,
      created: found.created,
      lastSeen: found.last_seen,
    };
  const d: Device = {
    id: randomUUID(),
    name,
    kind,
    trust: defaultTrust(kind, listener),
    created: now,
    lastSeen: now,
  };
  db.prepare(
    "INSERT INTO devices (id, account_id, name, kind, trust, created, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(d.id, accountId, d.name, d.kind, d.trust, d.created, d.lastSeen);
  return d;
}

/** A new session for a device, or null when the name or the password is wrong (same work either way). */
export function login(
  db: SystemDb,
  name: string,
  password: string,
  deviceName: string,
  opts: { kind?: DeviceKind; listener: Listener },
): { token: string; account: Account; device: Device } | null {
  const a = accountByName(db, name);
  const ok = verifyPassword(password, a?.pass ?? DUMMY);
  if (!a || !ok || a.disabled) return null;
  const now = Date.now();
  const device = deviceRow(
    db,
    a.id,
    deviceName.slice(0, 80) || "device",
    opts.kind ?? "unknown",
    opts.listener,
    now,
  );
  const token = randomBytes(32).toString("base64url");
  db.prepare(
    "INSERT INTO sessions (token_hash, account_id, device_id, listener, created, last_seen) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(tokenHash(token), a.id, device.id, opts.listener, now, now);
  return { token, account: { id: a.id, name: a.name, vault: a.vault }, device };
}

/** The account and device of a token, or null (unknown, idle too long, or the account is disabled). */
export function sessionOf(
  db: SystemDb,
  token: string | null | undefined,
  now = Date.now(),
): { account: Account; device: Device } | null {
  if (!token) return null;
  const h = tokenHash(token);
  const r = db
    .prepare(
      `SELECT a.id, a.name, a.vault, a.disabled, s.last_seen, d.id AS did, d.name AS dname, d.kind, d.trust, d.created AS dcreated
       FROM sessions s JOIN accounts a ON a.id = s.account_id JOIN devices d ON d.id = s.device_id WHERE s.token_hash = ?`,
    )
    .get(h) as
    | {
        id: number;
        name: string;
        vault: string | null;
        disabled: number | null;
        last_seen: number;
        did: string;
        dname: string;
        kind: DeviceKind;
        trust: Trust;
        dcreated: number;
      }
    | undefined;
  if (!r || r.disabled) return null;
  if (now - r.last_seen > SESSION_IDLE_MS) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(h);
    return null;
  }
  db.prepare("UPDATE sessions SET last_seen = ? WHERE token_hash = ?").run(now, h);
  db.prepare("UPDATE devices SET last_seen = ? WHERE id = ?").run(now, r.did);
  return {
    account: { id: r.id, name: r.name, vault: r.vault },
    device: {
      id: r.did,
      name: r.dname,
      kind: r.kind,
      trust: r.trust,
      created: r.dcreated,
      lastSeen: now,
    },
  };
}

export function logout(db: SystemDb, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
}

/** Ends every session of an account (a lost phone with no name to tell, a new password). */
export function revokeAll(db: SystemDb, name: string): number {
  const r = db
    .prepare("DELETE FROM sessions WHERE account_id = (SELECT id FROM accounts WHERE name = ?)")
    .run(name);
  return Number(r.changes);
}

/** Ends the sessions of one device (new: the old servers could only end all of them). */
export function revokeDevice(db: SystemDb, name: string, device: string): number {
  const r = db
    .prepare(
      "DELETE FROM sessions WHERE device_id IN (SELECT d.id FROM devices d JOIN accounts a ON a.id = d.account_id WHERE a.name = ? AND (d.id = ? OR d.name = ?))",
    )
    .run(name, device, device);
  return Number(r.changes);
}

export function devicesOf(db: SystemDb, name: string): (Device & { sessions: number })[] {
  return (
    db
      .prepare(
        `SELECT d.*, (SELECT count(*) FROM sessions s WHERE s.device_id = d.id) AS sessions
         FROM devices d JOIN accounts a ON a.id = d.account_id WHERE a.name = ? ORDER BY d.name`,
      )
      .all(name) as {
      id: string;
      name: string;
      kind: DeviceKind;
      trust: Trust;
      created: number;
      last_seen: number;
      sessions: number;
    }[]
  ).map((d) => ({
    id: d.id,
    name: d.name,
    kind: d.kind,
    trust: d.trust,
    created: d.created,
    lastSeen: d.last_seen,
    sessions: d.sessions,
  }));
}

/**
 * Changes a device's trust. Lowering it is always allowed; raising it needs another device of the
 * same account that is personal (`by`), so a shared screen cannot make itself personal.
 */
export function setTrust(
  db: SystemDb,
  deviceId: string,
  trust: Trust,
  by: { device: string } | { admin: true },
): void {
  const order: Trust[] = ["ambient", "shared", "personal"];
  const d = db.prepare("SELECT account_id, trust FROM devices WHERE id = ?").get(deviceId) as
    | { account_id: number; trust: Trust }
    | undefined;
  if (!d) throw new Error("No such device");
  if (order.indexOf(trust) > order.indexOf(d.trust) && !("admin" in by)) {
    const who = db.prepare("SELECT account_id, trust FROM devices WHERE id = ?").get(by.device) as
      | { account_id: number; trust: Trust }
      | undefined;
    if (
      !who ||
      who.account_id !== d.account_id ||
      who.trust !== "personal" ||
      by.device === deviceId
    )
      throw new Error("Only another personal device of the account can raise a device's trust");
  }
  db.prepare("UPDATE devices SET trust = ? WHERE id = ?").run(trust, deviceId);
}

// ---------------------------------------------------------------- data keys and account data

/** Where each account's data key is kept, wrapped (for @boni/store's wrappedKeyProvider; the user id is the account id). */
export function wrappedKeysIn(db: SystemDb): WrappedKeys {
  return {
    get: (id) => {
      const r = db.prepare("SELECT wrapped FROM data_keys WHERE account_id = ?").get(Number(id)) as
        | { wrapped: Uint8Array }
        | undefined;
      return r ? Buffer.from(r.wrapped) : null;
    },
    put: (id, wrapped) => {
      db.prepare("INSERT INTO data_keys (account_id, wrapped) VALUES (?, ?)").run(
        Number(id),
        wrapped,
      );
    },
  };
}
