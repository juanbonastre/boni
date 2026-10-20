import {
  addAccount,
  hashPassword,
  login as identityLogin,
  logout as identityLogout,
  type Listener,
  listAccounts,
  revokeAll,
  SESSION_IDLE_MS,
  sessionOf,
  tokenHash,
  verifyPassword,
} from "@boni/identity";
import type { Db } from "./db.ts";

/**
 * The calendar server's accounts, now the single Boni account (@boni/identity). Accounts are made by
 * the administrator (cli.ts), never by sign-up; a device logs in once and keeps a session token, of
 * which only the hash is stored. A calendar account is one with a vault folder.
 */
export interface User {
  id: number;
  name: string;
  /** Absolute path of the user's vault on the server ("" for an account without the calendar). */
  vault: string;
}

export { hashPassword, SESSION_IDLE_MS, tokenHash, verifyPassword };

export function addUser(db: Db, name: string, password: string, vault: string): User {
  const a = addAccount(db, name, password, { vault });
  return { id: a.id, name: a.name, vault };
}

export function listUsers(db: Db): User[] {
  return listAccounts(db).map((a) => ({ id: a.id, name: a.name, vault: a.vault ?? "" }));
}

/** A new session for a device, or null when the name or the password is wrong. */
export function login(
  db: Db,
  name: string,
  password: string,
  device: string,
  listener: Listener = "tailnet",
): { token: string; user: User } | null {
  const r = identityLogin(db, name, password, device, { listener });
  return r
    ? {
        token: r.token,
        user: { id: r.account.id, name: r.account.name, vault: r.account.vault ?? "" },
      }
    : null;
}

export function userOf(db: Db, token: string | null | undefined): User | null {
  const s = sessionOf(db, token);
  return s ? { id: s.account.id, name: s.account.name, vault: s.account.vault ?? "" } : null;
}

/** The account and the device of a session (the Boni API v1 keeps widgets and preferences per device). */
export function sessionUser(
  db: Db,
  token: string | null | undefined,
): { user: User; device: string; trust: "personal" | "shared" | "ambient" } | null {
  const s = sessionOf(db, token);
  return s
    ? {
        user: { id: s.account.id, name: s.account.name, vault: s.account.vault ?? "" },
        device: s.device.name,
        trust: s.device.trust,
      }
    : null;
}

export function logout(db: Db, token: string): void {
  identityLogout(db, token);
}

/** Ends every session of a user (a lost phone): their devices must log in again. */
export function revokeSessions(db: Db, name: string): number {
  return revokeAll(db, name);
}
