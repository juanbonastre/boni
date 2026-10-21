import type { DatabaseSync } from "node:sqlite";

/**
 * The per-user database's tables (docs/nucleo.md, 5.1). Numbered migrations, as in the calendar
 * server's db.ts: `PRAGMA user_version` says how many ran. Types of the user are data in `types`,
 * never tables: nothing here is generated from a schema, and the agent never writes DDL.
 */
export const MIGRATIONS = [
  `CREATE TABLE types (
     id TEXT PRIMARY KEY,
     def TEXT NOT NULL
   );
   CREATE TABLE entities (
     id TEXT PRIMARY KEY,
     type TEXT NOT NULL,
     vals TEXT NOT NULL,
     body TEXT,
     created INTEGER NOT NULL,
     updated INTEGER NOT NULL,
     version INTEGER NOT NULL,
     deleted INTEGER
   );
   CREATE INDEX entities_type ON entities(type);
   CREATE TABLE links (
     src TEXT NOT NULL,
     field TEXT NOT NULL,
     dst TEXT NOT NULL,
     pos INTEGER NOT NULL,
     PRIMARY KEY (src, field, pos)
   );
   CREATE INDEX links_dst ON links(dst);
   CREATE TABLE field_prov (
     entity TEXT NOT NULL,
     field TEXT NOT NULL,
     label TEXT NOT NULL,
     op INTEGER NOT NULL,
     PRIMARY KEY (entity, field)
   );
   CREATE TABLE ops (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     at INTEGER NOT NULL,
     actor TEXT NOT NULL,
     device TEXT,
     run TEXT,
     kind TEXT NOT NULL,
     target TEXT NOT NULL,
     before TEXT,
     after TEXT,
     label TEXT,
     undoes INTEGER
   );
   CREATE INDEX ops_run ON ops(run);
   CREATE INDEX ops_target ON ops(target);
   CREATE UNIQUE INDEX ops_undoes ON ops(undoes) WHERE undoes IS NOT NULL;
   CREATE VIRTUAL TABLE entities_fts USING fts5(entity UNINDEXED, title, text);`,
  // 2: the agent's journal (journal.ts): runs, their steps and model calls, proposals,
  // confirmations and daily budgets.
  `CREATE TABLE runs (
     id TEXT PRIMARY KEY,
     turn TEXT,
     origin TEXT NOT NULL,
     device TEXT,
     status TEXT NOT NULL,
     plan TEXT,
     started INTEGER NOT NULL,
     finished INTEGER
   );
   CREATE TABLE run_steps (
     run TEXT NOT NULL,
     seq INTEGER NOT NULL,
     step TEXT NOT NULL,
     kind TEXT NOT NULL,
     decision TEXT NOT NULL,
     rule TEXT,
     detail TEXT,
     at INTEGER NOT NULL,
     PRIMARY KEY (run, seq)
   );
   CREATE TABLE model_calls (
     run TEXT NOT NULL,
     role TEXT NOT NULL,
     provider TEXT NOT NULL,
     model TEXT NOT NULL,
     prompt_hash TEXT NOT NULL,
     request TEXT,
     response TEXT,
     usage TEXT,
     at INTEGER NOT NULL
   );
   CREATE INDEX model_calls_run ON model_calls(run);
   CREATE TABLE proposals (
     id TEXT PRIMARY KEY,
     run TEXT NOT NULL,
     tool TEXT NOT NULL,
     args TEXT NOT NULL,
     view TEXT,
     sources TEXT,
     status TEXT NOT NULL,
     created INTEGER NOT NULL,
     decided INTEGER
   );
   CREATE TABLE confirmations (
     id TEXT PRIMARY KEY,
     run TEXT NOT NULL,
     tool TEXT NOT NULL,
     hash TEXT NOT NULL,
     view TEXT,
     expires INTEGER NOT NULL,
     used INTEGER
   );
   CREATE TABLE budgets (
     day TEXT NOT NULL,
     key TEXT NOT NULL,
     n REAL NOT NULL,
     PRIMARY KEY (day, key)
   );`,
  // 3: what the models may see of each type (Juan's choice, never the agent's; docs/nucleo.md 7.3).
  `CREATE TABLE ai_access (
     type TEXT PRIMARY KEY,
     level TEXT NOT NULL CHECK (level IN ('visible', 'opaque', 'hidden')),
     at INTEGER NOT NULL,
     by TEXT
   );`,
  // 4: settings of the user's extensions and their working state (docs/extensiones.md 4): kept here, in the
  // user's own store, but outside the operation log (a mailbox cursor moving every few minutes is not a
  // change to undo); not readable by readQuery. Secrets are stored sealed with the user's data key.
  `CREATE TABLE settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     updated INTEGER NOT NULL
   );`,
];

export function migrate(db: DatabaseSync): void {
  const version = (db.prepare("PRAGMA user_version").get() as { user_version: number })
    .user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v] as string);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}
