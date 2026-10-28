import { openSystemDb, type SystemDb } from "@boni/identity";

/**
 * The server's own database is the single Boni account's system.db (@boni/identity): accounts,
 * devices, sessions (token hashes), each account's data and push addresses. Never the calendar's
 * data: events and tasks live in each account's own store. The old boni-calendar.db is only read once,
 * to import its accounts and sessions (main.ts).
 */
export type Db = SystemDb;

/** Opens (and if needed creates or upgrades) system.db at `path` (":memory:" for tests). */
export function openDb(path: string): Db {
  return openSystemDb(path);
}
