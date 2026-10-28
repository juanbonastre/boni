import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { wrappedKeysIn } from "@boni/identity";
import { type UserStore, wrappedKeyProvider } from "@boni/store";
import type { Db } from "./db.ts";

/**
 * Copies of the server's database (phase 6; system.db since the single account): accounts, devices,
 * sessions, the accounts' settings and their encrypted calendars. The file names stay as they were. One a day
 * into `dir` (a consistent copy even while the server writes: SQLite's `VACUUM INTO`), keeping the last `keep`.
 * Each account's data is in its own store, copied by `backupStoresNow`.
 * The key that decrypts the secrets (secret.key) is not copied: keep it apart from these copies.
 */
export function backupNow(db: Db, dir: string, keep: number, now = new Date()): string | null {
  mkdirSync(dir, { recursive: true });
  const day = now.toISOString().slice(0, 10);
  const file = join(dir, `boni-calendar-${day}.db`);
  if (existsSync(file)) return null;
  db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  const copies = readdirSync(dir)
    .filter((n) => /^boni-calendar-\d{4}-\d{2}-\d{2}\.db$/.test(n))
    .sort();
  for (const old of copies.slice(0, Math.max(0, copies.length - keep))) rmSync(join(dir, old));
  return file;
}

const prune = (dir: string, prefix: string, keep: number) => {
  const pattern = new RegExp(`^${prefix}-\\d{4}-\\d{2}-\\d{2}\\.db\\.sealed$`);
  const copies = readdirSync(dir)
    .filter((n) => pattern.test(n))
    .sort();
  for (const old of copies.slice(0, Math.max(0, copies.length - keep))) rmSync(join(dir, old));
};

export interface StoreBackups {
  /** Where the accounts' stores live (`users/<id>.db`). */
  usersDir: string;
  accounts: () => number[];
  /** The account's open store (the server's own connection). */
  store: (account: number) => UserStore;
  /** secret.key: it opens each account's data key, kept wrapped in system.db. */
  master: Buffer;
}

/**
 * Copies of each account's store (its entities, labels, log and the agent's journal), one a day, encrypted with
 * the account's own data key (AES-256-GCM, `restoreBackup` / `cli.ts restore` open them). Names:
 * user-<id>-<day>.db.sealed (the mirror-<id>-… copies of the retired Markdown mirror are no longer made).
 */
export function backupStoresNow(
  db: Db,
  dir: string,
  keep: number,
  o: StoreBackups,
  now = new Date(),
): string[] {
  mkdirSync(dir, { recursive: true });
  const day = now.toISOString().slice(0, 10);
  const keys = wrappedKeyProvider(o.master, wrappedKeysIn(db));
  const made: string[] = [];
  for (const a of o.accounts()) {
    if (!existsSync(join(o.usersDir, `${a}.db`))) continue;
    const key = keys.dataKey(String(a));
    const file = join(dir, `user-${a}-${day}.db.sealed`);
    if (!existsSync(file)) {
      o.store(a).backupTo(file, key);
      made.push(file);
    }
    prune(dir, `user-${a}`, keep);
  }
  return made;
}

/** A copy now (if today's is missing) and then every few hours; returns the function that stops it. */
export function startBackups(db: Db, dir: string, keep: number, stores?: StoreBackups): () => void {
  const run = () => {
    try {
      const made = backupNow(db, dir, keep);
      if (made) console.log(`backup ${made}`);
      if (stores)
        for (const f of backupStoresNow(db, dir, keep, stores)) console.log(`backup ${f}`);
    } catch (e) {
      console.warn("backup failed", e instanceof Error ? e.message : e);
    }
  };
  run();
  const timer = setInterval(run, 6 * 3_600_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
