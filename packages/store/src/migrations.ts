import type { DatabaseSync } from "node:sqlite";
import { chainExisting } from "./audit.ts";

/**
 * The per-user database's tables (docs/nucleo.md, 5.1). Numbered migrations, as in the calendar
 * server's db.ts: `PRAGMA user_version` says how many ran. Types of the user are data in `types`,
 * never tables: nothing here is generated from a schema, and the agent never writes DDL.
 */
export const MIGRATIONS: (string | ((db: DatabaseSync) => void))[] = [
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
  // 5: the vault's zones moved into Boni (types no model may ever see, set by the import Juan runs and never
  // lowered) and attachments by content (a `file` value is the sha256 of a row here; immutable, outside the log
  // and out of readQuery's reach).
  `CREATE TABLE zones (
     type TEXT PRIMARY KEY,
     zone TEXT NOT NULL CHECK (zone IN ('restricted', 'private')),
     at INTEGER NOT NULL,
     by TEXT
   );
   CREATE TABLE files (
     sha256 TEXT PRIMARY KEY,
     mime TEXT NOT NULL,
     size INTEGER NOT NULL,
     data BLOB NOT NULL,
     at INTEGER NOT NULL
   );`,
  // 6: four levels of protection (Juan, 2026-10-22): "hidden" becomes "restricted" (closed to the models; one
  // conversation may open it), "private" is closed and locked. A zone's collections take its level; the zone
  // table stays as where each came from.
  `CREATE TABLE ai_access_new (
     type TEXT PRIMARY KEY,
     level TEXT NOT NULL CHECK (level IN ('visible', 'opaque', 'restricted', 'private')),
     at INTEGER NOT NULL,
     by TEXT
   );
   INSERT INTO ai_access_new (type, level, at, by)
     SELECT type, CASE level WHEN 'hidden' THEN 'restricted' ELSE level END, at, by FROM ai_access;
   INSERT INTO ai_access_new (type, level, at, by)
     SELECT type, zone, at, by FROM zones WHERE true
     ON CONFLICT (type) DO UPDATE SET level = excluded.level, at = excluded.at, by = excluded.by;
   DROP TABLE ai_access;
   ALTER TABLE ai_access_new RENAME TO ai_access;`,
  // 7: a part of a collection with its own level (Juan, 2026-10-22): the rows that match a filter (Notion's
  // rules, as JSON) are seen by the models at that level instead of the collection's.
  `CREATE TABLE ai_rules (
     id TEXT PRIMARY KEY,
     type TEXT NOT NULL,
     filter TEXT NOT NULL,
     level TEXT NOT NULL CHECK (level IN ('visible', 'opaque', 'restricted', 'private')),
     at INTEGER NOT NULL,
     by TEXT
   );`,
  // 8: what Juan changed when accepting a proposal (Juan, 2026-10-23: a corrected title or collection is a
  // prediction error the reviewer learns from).
  `ALTER TABLE proposals ADD COLUMN edits TEXT;`,
  // 9: questions Boni asks Juan with no turn of his (Juan, 2026-10-24: the panel of requests). A background run that
  // reaches an `ask` waits here, its state saved, and goes on when he answers, also after a restart; unanswered, it
  // expires (7 days) and ends having done nothing more.
  `CREATE TABLE requests (
     id TEXT PRIMARY KEY,
     run TEXT NOT NULL,
     view TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('pending', 'answered', 'expired', 'dismissed')),
     created INTEGER NOT NULL,
     expires INTEGER NOT NULL,
     decided INTEGER,
     answer TEXT
   );
   CREATE INDEX requests_status ON requests(status);
   CREATE TABLE waiting_runs (
     run TEXT PRIMARY KEY,
     state TEXT NOT NULL,
     saved INTEGER NOT NULL
   );`,
  // 10: the audit (Juan, 2026-10-24; audit.ts): who did what and saw what, models above all. Every operation says
  // who made it (`by`) and in which action, and is chained by hash; actions and what each saw (ids, never values),
  // chained too; each entity's system columns. Existing operations are chained and their entities' columns filled
  // from the history, in code.
  (db) => {
    db.exec(`ALTER TABLE ops ADD COLUMN by TEXT;
     ALTER TABLE ops ADD COLUMN action INTEGER;
     ALTER TABLE ops ADD COLUMN hash TEXT;
     CREATE INDEX ops_at ON ops(at);
     CREATE TABLE actions (
       seq INTEGER PRIMARY KEY AUTOINCREMENT,
       at INTEGER NOT NULL,
       by TEXT NOT NULL,
       run TEXT,
       tool TEXT NOT NULL,
       target TEXT,
       decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
       rule TEXT,
       call INTEGER,
       result TEXT,
       hash TEXT NOT NULL
     );
     CREATE INDEX actions_at ON actions(at);
     CREATE INDEX actions_run ON actions(run);
     CREATE INDEX actions_by ON actions(by, at);
     CREATE TABLE access (
       action INTEGER NOT NULL,
       entity TEXT NOT NULL,
       type TEXT NOT NULL,
       version INTEGER NOT NULL,
       fields TEXT NOT NULL,
       shapes TEXT NOT NULL,
       body TEXT CHECK (body IN ('text', 'shape')),
       files TEXT NOT NULL,
       PRIMARY KEY (action, entity)
     );
     CREATE INDEX access_entity ON access(entity, action);
     CREATE INDEX access_type ON access(type, action);
     CREATE TABLE entity_meta (
       entity TEXT PRIMARY KEY,
       created_by TEXT,
       updated_by TEXT,
       editors TEXT NOT NULL DEFAULT '[]',
       viewers TEXT NOT NULL DEFAULT '[]',
       seen_at INTEGER,
       seen_by TEXT
     );`);
    chainExisting(db);
  },
];

export function migrate(db: DatabaseSync): void {
  const version = (db.prepare("PRAGMA user_version").get() as { user_version: number })
    .user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      const m = MIGRATIONS[v] as string | ((db: DatabaseSync) => void);
      if (typeof m === "string") db.exec(m);
      else m(db);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}
