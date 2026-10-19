import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { defaultTrust, type SystemDb } from "./identity.ts";

/**
 * Moves the accounts and sessions of the two old servers into system.db (docs/nucleo.md, 6): the
 * calendar's `boni-calendar.db` (milliseconds everywhere) and Boni's `boni.sqlite3` (ISO text for
 * `created`, seconds for `last_seen`). Both use the same scrypt format and store sha256 hex of the
 * session tokens, so devices stay logged in. Accounts with the same name become one, keeping the
 * password of `passwordFrom`. Sessions keep their device name; a device name seen on both servers is
 * one device. The calendar's account data (prefs, its encrypted external calendars) and push
 * addresses move as they are: they are still encrypted with the server's secret.key.
 *
 * Dry run unless `apply`: the old databases are opened read-only, and nothing is written. Running it
 * again changes nothing that is already there.
 */

export interface ImportReport {
  accounts: {
    name: string;
    from: ("calendar" | "boni")[];
    password: "calendar" | "boni" | "kept";
    sessions: number;
    existing: boolean;
  }[];
  devices: number;
  sessions: { imported: number; already: number; expired: number };
  accountData: number;
  push: number;
  /** Boni's old per-device tokens (before accounts): not moved, they were being retired. */
  oldDeviceTokens: number;
  applied: boolean;
}

interface OldUser {
  id: number;
  name: string;
  pass: string;
  vault?: string | null;
  created: number;
}
interface OldSession {
  token_hash: string;
  user_id: number;
  device: string;
  created: number;
  last_seen: number;
}

const IDLE_MS = 90 * 86_400_000;

function readOld(path: string, kind: "calendar" | "boni") {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const has = (t: string) =>
      !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
    const iso = (v: unknown) => (typeof v === "number" ? v : Date.parse(String(v)) || 0);
    const users = (
      db
        .prepare(
          `SELECT id, name, pass, ${kind === "calendar" ? "vault" : "NULL AS vault"}, created FROM users`,
        )
        .all() as unknown as OldUser[]
    ).map((u) => ({ ...u, created: iso(u.created) }));
    const sessions = (
      db
        .prepare("SELECT token_hash, user_id, device, created, last_seen FROM sessions")
        .all() as unknown as OldSession[]
    ).map((s) => ({
      ...s,
      created: iso(s.created),
      // Boni keeps last_seen in seconds (time.time()), the calendar in milliseconds.
      last_seen: kind === "boni" ? Math.round(Number(s.last_seen) * 1000) : Number(s.last_seen),
    }));
    const accountData =
      kind === "calendar" && has("account_data")
        ? (db.prepare("SELECT user_id, key, value, updated FROM account_data").all() as {
            user_id: number;
            key: string;
            value: string;
            updated: number;
          }[])
        : [];
    const push =
      kind === "calendar" && has("push")
        ? (db.prepare("SELECT token_hash, user_id, endpoint, updated FROM push").all() as {
            token_hash: string;
            user_id: number;
            endpoint: string;
            updated: number;
          }[])
        : [];
    const oldDeviceTokens =
      kind === "boni" && has("devices")
        ? (db.prepare("SELECT count(*) AS n FROM devices").get() as { n: number }).n
        : 0;
    return { users, sessions, accountData, push, oldDeviceTokens };
  } finally {
    db.close();
  }
}

export function importAccounts(
  system: SystemDb,
  opts: {
    calendar?: string;
    boni?: string;
    passwordFrom?: "calendar" | "boni";
    apply?: boolean;
    now?: number;
  },
): ImportReport {
  const now = opts.now ?? Date.now();
  const preferred = opts.passwordFrom ?? "calendar";
  const sources = (["calendar", "boni"] as const).flatMap((kind) => {
    const path = opts[kind];
    return path ? [{ kind, ...readOld(path, kind) }] : [];
  });
  const report: ImportReport = {
    accounts: [],
    devices: 0,
    sessions: { imported: 0, already: 0, expired: 0 },
    accountData: 0,
    push: 0,
    oldDeviceTokens: sources.reduce((n, s) => n + s.oldDeviceTokens, 0),
    applied: !!opts.apply,
  };

  const run = () => {
    const devicesSeen = new Set<string>();
    const names = [...new Set(sources.flatMap((s) => s.users.map((u) => u.name)))].sort();
    for (const name of names) {
      const from = sources.filter((s) => s.users.some((u) => u.name === name));
      const pick = from.find((s) => s.kind === preferred) ?? (from[0] as (typeof from)[number]);
      const user = pick.users.find((u) => u.name === name) as OldUser;
      const vault =
        from.map((s) => s.users.find((u) => u.name === name)?.vault).find((v) => !!v) ?? null;
      const existing = system.prepare("SELECT id FROM accounts WHERE name = ?").get(name) as
        | { id: number }
        | undefined;
      let accountId = existing?.id ?? -1;
      if (!existing && opts.apply)
        accountId = Number(
          system
            .prepare("INSERT INTO accounts (name, pass, vault, created) VALUES (?, ?, ?, ?)")
            .run(name, user.pass, vault, user.created || now).lastInsertRowid,
        );
      let sessions = 0;
      for (const src of from) {
        const oldId = src.users.find((u) => u.name === name)?.id;
        for (const s of src.sessions.filter((x) => x.user_id === oldId)) {
          if (now - s.last_seen > IDLE_MS) {
            report.sessions.expired++;
            continue;
          }
          if (system.prepare("SELECT 1 FROM sessions WHERE token_hash = ?").get(s.token_hash)) {
            report.sessions.already++;
            continue;
          }
          sessions++;
          report.sessions.imported++;
          const dev = system
            .prepare("SELECT id FROM devices WHERE account_id = ? AND name = ?")
            .get(accountId, s.device) as { id: string } | undefined;
          if (!dev && !devicesSeen.has(`${name}|${s.device}`)) report.devices++;
          devicesSeen.add(`${name}|${s.device}`);
          if (!opts.apply) continue;
          let deviceId = dev?.id;
          if (!deviceId) {
            deviceId = randomUUID();
            system
              .prepare(
                "INSERT INTO devices (id, account_id, name, kind, trust, created, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)",
              )
              .run(
                deviceId,
                accountId,
                s.device,
                "unknown",
                defaultTrust("unknown", "migrated"),
                s.created || now,
                s.last_seen,
              );
          }
          system
            .prepare(
              "INSERT INTO sessions (token_hash, account_id, device_id, listener, created, last_seen) VALUES (?, ?, ?, 'migrated', ?, ?)",
            )
            .run(s.token_hash, accountId, deviceId, s.created || now, s.last_seen);
        }
        for (const d of src.accountData.filter((x) => x.user_id === oldId)) {
          const there =
            opts.apply &&
            system
              .prepare("SELECT 1 FROM account_data WHERE account_id = ? AND key = ?")
              .get(accountId, d.key);
          if (there) continue;
          report.accountData++;
          if (opts.apply)
            system
              .prepare(
                "INSERT INTO account_data (account_id, key, value, updated) VALUES (?, ?, ?, ?)",
              )
              .run(accountId, d.key, d.value, d.updated);
        }
        for (const p of src.push.filter((x) => x.user_id === oldId)) {
          if (
            opts.apply &&
            !system.prepare("SELECT 1 FROM sessions WHERE token_hash = ?").get(p.token_hash)
          )
            continue; // its session expired
          if (
            opts.apply &&
            system.prepare("SELECT 1 FROM push WHERE token_hash = ?").get(p.token_hash)
          )
            continue;
          report.push++;
          if (opts.apply)
            system
              .prepare(
                "INSERT INTO push (token_hash, account_id, endpoint, updated) VALUES (?, ?, ?, ?)",
              )
              .run(p.token_hash, accountId, p.endpoint, p.updated);
        }
      }
      report.accounts.push({
        name,
        from: from.map((s) => s.kind),
        password: existing ? "kept" : pick.kind,
        sessions,
        existing: !!existing,
      });
    }
  };

  if (opts.apply) {
    system.exec("BEGIN IMMEDIATE");
    try {
      run();
      system.exec("COMMIT");
    } catch (e) {
      system.exec("ROLLBACK");
      throw e;
    }
  } else run();
  return report;
}
