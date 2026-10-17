import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Db } from "./db.ts";

/**
 * Accounts are made by the administrator (cli.ts), never by sign-up. A device logs in once and keeps
 * a session token; the server stores only the token's hash, so a copy of the database does not let
 * anyone in.
 */
export interface User {
  id: number;
  name: string;
  /** Absolute path of the user's vault on the server. */
  vault: string;
}

const KEYLEN = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [kind, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = scryptSync(password, Buffer.from(salt, "base64"), want.length, {
    N: 16384,
    r: 8,
    p: 1,
  });
  return got.length === want.length && timingSafeEqual(got, want);
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
/** How a session token is stored (never the token itself). */
export const tokenHash = sha;

export function addUser(db: Db, name: string, password: string, vault: string): User {
  if (!/^[a-z0-9._-]{2,32}$/i.test(name))
    throw new Error("A user name is 2-32 letters, digits, . _ -");
  if (password.length < 12) throw new Error("The password needs at least 12 characters");
  const r = db
    .prepare("INSERT INTO users (name, pass, vault, created) VALUES (?, ?, ?, ?)")
    .run(name, hashPassword(password), vault, Date.now());
  return { id: Number(r.lastInsertRowid), name, vault };
}

export function listUsers(db: Db): User[] {
  return db.prepare("SELECT id, name, vault FROM users ORDER BY name").all() as unknown as User[];
}

/** A new session for a device, or null when the name or the password is wrong. */
export function login(
  db: Db,
  name: string,
  password: string,
  device: string,
): { token: string; user: User } | null {
  const row = db.prepare("SELECT id, name, pass, vault FROM users WHERE name = ?").get(name) as
    | (User & { pass: string })
    | undefined;
  // Same work whether the user exists or not, so timing does not tell.
  const ok = verifyPassword(password, row?.pass ?? hashPassword("not a real password"));
  if (!row || !ok) return null;
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, device, created, last_seen) VALUES (?, ?, ?, ?, ?)",
  ).run(sha(token), row.id, device.slice(0, 80) || "device", now, now);
  return { token, user: { id: row.id, name: row.name, vault: row.vault } };
}

/** A session not used for this long ends (a lost or forgotten device stops being a way in). */
export const SESSION_IDLE_MS = 90 * 86_400_000;

export function userOf(db: Db, token: string | null | undefined): User | null {
  if (!token) return null;
  const row = db
    .prepare(
      "SELECT u.id, u.name, u.vault, s.last_seen FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?",
    )
    .get(sha(token)) as (User & { last_seen: number }) | undefined;
  if (!row) return null;
  if (Date.now() - row.last_seen > SESSION_IDLE_MS) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha(token));
    return null;
  }
  db.prepare("UPDATE sessions SET last_seen = ? WHERE token_hash = ?").run(Date.now(), sha(token));
  return { id: row.id, name: row.name, vault: row.vault };
}

export function logout(db: Db, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha(token));
}

/** Ends every session of a user (a lost phone): their devices must log in again. */
export function revokeSessions(db: Db, name: string): number {
  const r = db
    .prepare("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE name = ?)")
    .run(name);
  return Number(r.changes);
}
