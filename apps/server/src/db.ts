import { DatabaseSync } from "node:sqlite";

/**
 * The server's own data (never the calendar's: events and tasks are notes of the vault). Accounts,
 * device sessions and, later, per-account settings and secrets.
 */
export type Db = DatabaseSync;

const MIGRATIONS = [
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL UNIQUE,
     pass TEXT NOT NULL,
     vault TEXT NOT NULL,
     created INTEGER NOT NULL
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     device TEXT NOT NULL,
     created INTEGER NOT NULL,
     last_seen INTEGER NOT NULL
   );`,
];

/** Opens (and if needed creates or upgrades) the database at `path` (":memory:" for tests). */
export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
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
