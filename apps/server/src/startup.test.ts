import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { hashPassword, tokenHash, userOf } from "./auth.ts";
import { databasePaths, openServerDb } from "./startup.ts";

/** The old calendar database, with the schema the server had before the single account (invented rows). */
function oldDatabase(path: string): void {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, pass TEXT NOT NULL, vault TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, device TEXT NOT NULL, created INTEGER NOT NULL, last_seen INTEGER NOT NULL);
    CREATE TABLE account_data (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, value TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (user_id, key));
    CREATE TABLE push (token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, endpoint TEXT NOT NULL, updated INTEGER NOT NULL);
    PRAGMA user_version = 4;`);
  db.prepare("INSERT INTO users VALUES (1, 'juan', ?, '/vault', 1700000000000)").run(
    hashPassword("una contraseña larga de ejemplo"),
  );
  db.prepare("INSERT INTO sessions VALUES (?, 1, 'movil', ?, ?)").run(
    tokenHash("token-del-movil"),
    Date.now(),
    Date.now(),
  );
  db.prepare("INSERT INTO account_data VALUES (1, 'prefs', '{\"locale\":\"es\"}', 1)").run();
  db.prepare("INSERT INTO push VALUES (?, 1, 'https://ntfy.example/upX', 1)").run(
    tokenHash("token-del-movil"),
  );
  db.close();
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("moving to the single account at start", () => {
  it("puts system.db next to the old database, so secret.key stays where it was", () => {
    expect(databasePaths({ BONI_DB: "/data/boni-calendar.db" })).toEqual({
      legacy: "/data/boni-calendar.db",
      system: "/data/system.db",
    });
    expect(databasePaths({ BONI_DB: "/data/x.db", BONI_SYSTEM_DB: "/elsewhere/s.db" }).system).toBe(
      "/elsewhere/s.db",
    );
    expect(databasePaths({ BONI_DB: ":memory:" }).system).toBe(":memory:");
  });

  it("imports the old accounts once; the phone's session keeps working and the old file is untouched", () => {
    const dir = mkdtempSync(join(tmpdir(), "boni-startup-"));
    dirs.push(dir);
    const legacy = join(dir, "boni-calendar.db");
    oldDatabase(legacy);
    const lines: string[] = [];
    const first = openServerDb({ legacy, system: join(dir, "system.db") }, (l) => lines.push(l));
    expect(first.imported?.accounts.map((a) => a.name)).toEqual(["juan"]);
    expect(lines[0]).toMatch(
      /accounts moved to .*system\.db .*juan; 1 sessions, 1 account data, 1 push/,
    );
    expect(userOf(first.db, "token-del-movil")).toEqual({ id: 1, name: "juan" });
    expect(first.db.prepare("SELECT endpoint FROM push").get()).toEqual({
      endpoint: "https://ntfy.example/upX",
    });
    first.db.close();
    const second = openServerDb({ legacy, system: join(dir, "system.db") }, (l) => lines.push(l));
    expect(second.imported).toBeNull();
    expect(lines).toHaveLength(1);
    second.db.close();
    const old = new DatabaseSync(legacy, { readOnly: true });
    expect(old.prepare("SELECT count(*) AS n FROM sessions").get()).toEqual({ n: 1 });
    old.close();
  });
});
