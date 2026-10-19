import { formatReminderDefaults, parseReminderDefaults } from "@boni/calendar";
import type { Db } from "./db.ts";
import { decrypt, encrypt, type SecretKey } from "./secret.ts";

/**
 * What an account keeps on the server, shared by all its devices (phase 4): its preferences (language,
 * first day of the week, 24-hour clock... the app chooses which) and its external calendars. The
 * address of a private calendar is a secret, so the list of external calendars is stored encrypted.
 */
export interface External {
  id: string;
  name: string;
  url: string;
  color: string;
  /** Its reminders (phase 5), as text: `{ timed: "10m", allDay: "none" }`. */
  reminders?: { timed: string; allDay: string };
}

export type Prefs = Record<string, string | number | boolean | null>;

export interface Account {
  prefs: Prefs;
  externals: External[];
  /** When either last changed (ms); 0 if never. */
  updated: number;
}

const MAX_EXTERNALS = 50;
const MAX_PREFS = 16_000;

function row(db: Db, userId: number, key: string): { value: string; updated: number } | undefined {
  return db
    .prepare("SELECT value, updated FROM account_data WHERE account_id = ? AND key = ?")
    .get(userId, key) as { value: string; updated: number } | undefined;
}

function put(db: Db, userId: number, key: string, value: string): number {
  // Strictly increasing, so two changes in the same millisecond still tell apart.
  const last = Math.max(
    row(db, userId, "prefs")?.updated ?? 0,
    row(db, userId, "externals")?.updated ?? 0,
  );
  const updated = Math.max(Date.now(), last + 1);
  db.prepare(
    `INSERT INTO account_data (account_id, key, value, updated) VALUES (?, ?, ?, ?)
     ON CONFLICT (account_id, key) DO UPDATE SET value = excluded.value, updated = excluded.updated`,
  ).run(userId, key, value, updated);
  return updated;
}

export function readAccount(db: Db, key: SecretKey, userId: number): Account {
  const p = row(db, userId, "prefs");
  const e = row(db, userId, "externals");
  return {
    prefs: p ? (JSON.parse(p.value) as Prefs) : {},
    externals: e ? (JSON.parse(decrypt(key, e.value)) as External[]) : [],
    updated: Math.max(p?.updated ?? 0, e?.updated ?? 0),
  };
}

/** Preferences as sent by a device, or null when they are not a small object of plain values. */
export function validPrefs(v: unknown): Prefs | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  if (JSON.stringify(v).length > MAX_PREFS) return null;
  for (const x of Object.values(v)) {
    if (x !== null && !["string", "number", "boolean"].includes(typeof x)) return null;
  }
  return v as Prefs;
}

/** A list of external calendars as sent by a device, or null when it is not one. */
export function validExternals(v: unknown): External[] | null {
  if (!Array.isArray(v) || v.length > MAX_EXTERNALS) return null;
  const out: External[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") return null;
    const { id, name, url, color, reminders } = x as Record<string, unknown>;
    if (typeof id !== "string" || !/^ext-[a-z0-9]{1,32}$/.test(id)) return null;
    if (typeof name !== "string" || name.length > 200) return null;
    if (typeof color !== "string" || color.length > 40) return null;
    if (typeof url !== "string" || url.length > 2000 || !/^https?:\/\//i.test(url)) return null;
    out.push({
      id,
      name,
      url,
      color,
      ...(reminders !== undefined
        ? { reminders: formatReminderDefaults(parseReminderDefaults(reminders)) }
        : {}),
    });
  }
  return out;
}

export const savePrefs = (db: Db, userId: number, prefs: Prefs): number =>
  put(db, userId, "prefs", JSON.stringify(prefs));

export const saveExternals = (db: Db, key: SecretKey, userId: number, list: External[]): number =>
  put(db, userId, "externals", encrypt(key, JSON.stringify(list)));
