import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { type ImportReport, importAccounts, listAccounts } from "@boni/identity";
import { type Db, openDb } from "./db.ts";

/**
 * Where the server's databases are and the one-time move to the single account (docs/nucleo.md, 11, T2).
 * BONI_DB keeps naming the old calendar database (the NAS's compose says /data/boni-calendar.db);
 * system.db lives next to it unless BONI_SYSTEM_DB says otherwise, so secret.key (next to the database)
 * is found where it always was. The first time system.db has no accounts and the old database exists,
 * its accounts and sessions are imported (devices stay logged in) and the old file is left untouched.
 */
export function databasePaths(env: NodeJS.ProcessEnv = process.env): {
  legacy: string;
  system: string;
} {
  const legacy = env.BONI_DB ?? "./data/boni-calendar.db";
  const system =
    env.BONI_SYSTEM_DB ?? (legacy === ":memory:" ? ":memory:" : join(dirname(legacy), "system.db"));
  return { legacy, system };
}

export function openServerDb(
  paths: { legacy: string; system: string },
  log: (line: string) => void = console.log,
): { db: Db; imported: ImportReport | null } {
  const db = openDb(paths.system);
  let imported: ImportReport | null = null;
  if (
    paths.legacy !== ":memory:" &&
    paths.legacy !== paths.system &&
    listAccounts(db).length === 0 &&
    existsSync(paths.legacy)
  ) {
    imported = importAccounts(db, { calendar: paths.legacy, apply: true });
    log(
      `accounts moved to ${paths.system} from ${paths.legacy} (left as it was): ${imported.accounts.map((a) => a.name).join(", ") || "none"}; ${imported.sessions.imported} sessions, ${imported.accountData} account data, ${imported.push} push addresses`,
    );
  }
  return { db, imported };
}
