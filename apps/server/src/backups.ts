import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "./db.ts";

/**
 * Copies of the server's database (phase 6): accounts, sessions, the accounts' settings and their
 * encrypted calendars. One a day into `dir` (a consistent copy even while the server writes: SQLite's
 * `VACUUM INTO`), keeping the last `keep`. The calendar itself is the vault, backed up on its own.
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

/** A copy now (if today's is missing) and then every few hours; returns the function that stops it. */
export function startBackups(db: Db, dir: string, keep: number): () => void {
  const run = () => {
    try {
      const made = backupNow(db, dir, keep);
      if (made) console.log(`backup ${made}`);
    } catch (e) {
      console.warn("backup failed", e instanceof Error ? e.message : e);
    }
  };
  run();
  const timer = setInterval(run, 6 * 3_600_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
