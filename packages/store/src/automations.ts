import type { DatabaseSync } from "node:sqlite";

/**
 * Where an automation lives (docs/automatizaciones.md §7; phase F14b): in the user's store (D-02), next to the
 * flows of before, as tables of the journal side, reached through `store.journal`. Like a flow, an automation is no
 * entity: no collection lists it but Boni's own «Automatizaciones», which is made on each read. `Journal` extends
 * `AutomationsJournal`, and `automationsJournal` is its part of `openJournal`.
 *
 * The migration (`AUTOMATIONS_MIGRATION`, entry 25 of `MIGRATIONS`; entry 26 adds `automation_drafts.trigger`; entry
 * 27, F14d, adds the versions, `automations.published` and `automations.enabled`: `automationsVersionsMigration`;
 * entry 29, F14d S3, adds a «Programada»'s hours: `automationsScheduleMigration`):
 *
 *   CREATE TABLE automations (
 *     id TEXT PRIMARY KEY, by TEXT NOT NULL, created INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
 *   );
 *   CREATE TABLE automation_drafts (
 *     id TEXT PRIMARY KEY, rev INTEGER NOT NULL, name TEXT NOT NULL, doc TEXT NOT NULL,
 *     device TEXT, updated INTEGER NOT NULL
 *   );
 *   CREATE TABLE automation_layout (
 *     id TEXT NOT NULL, step TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, PRIMARY KEY (id, step)
 *   ) WITHOUT ROWID;
 *   CREATE TABLE automation_tests (
 *     id TEXT NOT NULL, step TEXT NOT NULL, print TEXT NOT NULL, at INTEGER NOT NULL, record TEXT NOT NULL,
 *     PRIMARY KEY (id, step)
 *   ) WITHOUT ROWID;
 *   CREATE TABLE automation_test_rows (
 *     id TEXT NOT NULL, step TEXT NOT NULL, output TEXT NOT NULL, chunk INTEGER NOT NULL, rows TEXT NOT NULL,
 *     PRIMARY KEY (id, step, output, chunk)
 *   ) WITHOUT ROWID;
 *   CREATE TABLE automation_versions (
 *     id TEXT NOT NULL, n INTEGER NOT NULL, doc TEXT NOT NULL, hash TEXT NOT NULL, at INTEGER NOT NULL,
 *     device TEXT, by TEXT NOT NULL, names TEXT NOT NULL, PRIMARY KEY (id, n)
 *   ) WITHOUT ROWID;   -- with two triggers that refuse any UPDATE or DELETE of a row (AU-95)
 *   ALTER TABLE automations ADD COLUMN published INTEGER;               -- the version that runs, null unpublished
 *   ALTER TABLE automations ADD COLUMN enabled INTEGER NOT NULL DEFAULT 0;  -- the switch (AU-194)
 *
 * What is undone and how (D-02). None of these is in the operation log: nothing here is a record of a collection.
 * - The draft is undone in the editor (AU-68), change by change; each undo is one more save.
 * - «Eliminar» sets `deleted` and its notice's «Deshacer» clears it: the draft, the places and the kept tests stay.
 * - A test writes nothing in any collection (AU-90), so it has nothing to undo.
 * - A version is never undone (AU-95): another is published. «Volver a esta» publishes a new one with an old one's
 *   document (AU-98). No Undo of the store, a turn or a run reaches a draft or a version (AU-188).
 * What an automation writes in the collections when it runs for real is F14d's: one group of the operation log per
 * run (AU-18).
 */

/** An automation there is, published or not. Its name is its draft's until it has a version (F14d). */
export interface AutomationRow {
  id: string;
  /** Who made it: `user` in F14b (Boni's and a page's arrive with F16 and F17). */
  by: string;
  created: number;
  deleted: boolean;
  /** The number of the version that runs (AU-95), or null: never published, nothing runs it for real. */
  published: number | null;
  /** The switch (AU-194): the first publish turns it on, «Eliminar» turns it off. Off, no run starts for real. */
  enabled: boolean;
}

/**
 * A published version (AU-95): a row that never changes once written. «Versiones» lists them without their
 * documents (AU-98).
 */
export interface AutomationVersionInfo {
  id: string;
  /** 1, 2, 3…: one more each publish. */
  n: number;
  /** The document's print (sha256 of its JSON with `version` 0): what tells whether a draft is the one that runs. */
  hash: string;
  at: number;
  device: string | null;
  /** Whose it is: `user` (Juan's hand) today; `preset` (Boni's own) from F16. */
  by: string;
}

/** A version whole: its document as it runs (its `version` is `n`), and the names its code cited (AU-192). */
export interface AutomationVersionRow extends AutomationVersionInfo {
  doc: string;
  /** JSON of `KeptNames` (`@boni/automations`): by step, each name its code cites and the key it was. */
  names: string;
}

/**
 * An automation's draft (AU-62, AU-95): the whole document as the editor has it, kept as Juan changes it. One per
 * automation; nothing runs it for real, only «Probar». In F14b every automation has one and no version.
 */
export interface AutomationDraftRow {
  id: string;
  /** Grows by one with each save: what tells one saved draft from the next. Moving a box does not change it (AU-05). */
  rev: number;
  /** The document's `name`, kept apart so the list does not parse every draft. */
  name: string;
  /**
   * The type of its first trigger, in the order of its steps (`manual`), or null with none: kept apart at each save,
   * as the name, so the list says what starts it without parsing the draft (AU-61; migration 26).
   */
  trigger: string | null;
  /** The automation as `@boni/automations`' format writes it (JSON). Its `version` is 0 until F14d publishes. */
  doc: string;
  /** The device that wrote it last. */
  device: string | null;
  updated: number;
}

/** Where a step's box is on the canvas (AU-05): presentation only, never part of the automation. */
export interface AutomationPlace {
  step: string;
  x: number;
  y: number;
}

/**
 * The last test of one step (AU-91): its print, when, and the engine's record with each output's rows left out
 * (`out` holds each output's count instead). The rows are kept apart, 50 to a chunk, so a page of them is read
 * without the rest (AU-71, AU-72, A-15).
 */
export interface AutomationTestRow {
  id: string;
  step: string;
  print: string;
  at: number;
  /** JSON: the record with `out` as counts by output. */
  record: string;
}

export interface AutomationsJournal {
  /** The automations not deleted, the newest first, each with its draft's name, trigger, `rev` and `updated`. */
  automations(): (AutomationRow &
    Pick<AutomationDraftRow, "name" | "trigger" | "rev" | "updated">)[];
  /** One automation, deleted or not, or null. */
  automation(id: string): AutomationRow | null;
  /** A new automation with its first draft (`rev` 1), in one transaction. */
  createAutomation(
    a: Omit<AutomationRow, "deleted" | "published" | "enabled">,
    draft: Omit<AutomationDraftRow, "rev">,
  ): void;
  /** «Eliminar» and its «Deshacer» or «Recuperar» (AU-191): deleting turns it off, and bringing it back leaves it off. */
  setAutomationDeleted(id: string, deleted: boolean): void;
  /** The deleted ones, the newest first, with their draft's name and when it was saved last (AU-191). */
  deletedAutomations(): (AutomationRow & Pick<AutomationDraftRow, "name" | "updated">)[];
  /** An automation's versions, the newest first, without their documents (AU-98). */
  automationVersions(id: string): AutomationVersionInfo[];
  /** One version whole, or null. */
  automationVersion(id: string, n: number): AutomationVersionRow | null;
  /**
   * Writes the next version and makes it the one that runs, in one transaction; the first one also turns the switch
   * on (AU-194, decision 12) and a later one leaves it as it was. `doc` is written as given: its `version` must be
   * the number this gives, which is `expect` (the caller read it with `automation`): another number throws and
   * writes nothing.
   */
  publishAutomation(
    v: Omit<AutomationVersionRow, "n">,
    expect: number,
    /** The version's «Programada» hours (`ScheduledAutomation.schedule`), or null; its hours count from `v.at`. */
    schedule?: string | null,
  ): { n: number; enabled: boolean };
  /** The switch (AU-194). Turned on at `at`, no hour at or before it runs (AU-114). */
  setAutomationEnabled(id: string, enabled: boolean, at?: number): void;
  /**
   * The published, enabled automations with a «Programada» (AU-114), each with its latest due hour and whether a run
   * of it is under way: one query, by the columns and the runs' indexes, reading no document.
   */
  scheduledAutomations(): ScheduledAutomation[];
  /**
   * Whether some live row of the collection (a type id) holds a value from outside today (AU-182, AU-170: a label
   * below `imported`, as the policy reads it): one query over the collection's labels that reads no row whole.
   */
  holdsOutside(type: string): boolean;
  automationDraft(id: string): AutomationDraftRow | null;
  /** Keeps a draft over the one it had and gives its new `rev`. */
  saveAutomationDraft(d: Omit<AutomationDraftRow, "rev">): number;
  /** The places of an automation's boxes; a step with none has no entry. */
  automationLayout(id: string): AutomationPlace[];
  /** Sets the places given and leaves the rest; a place of a step the draft no longer has is dropped on a save. */
  placeAutomationSteps(id: string, places: readonly AutomationPlace[]): void;
  /** The last test of every step of an automation that has one. */
  automationTests(id: string): AutomationTestRow[];
  /**
   * Keeps the test of the steps that ran, over the one each had, with their rows by output (each row as JSON, in
   * order); the steps not named keep theirs. A step the draft no longer has loses its test on a save.
   */
  keepAutomationTests(
    id: string,
    steps: readonly (Omit<AutomationTestRow, "id"> & {
      rows: Readonly<Record<string, readonly string[]>>;
    })[],
  ): void;
  /**
   * Some rows of one output of a step's last test, in order, each parsed once from its chunk: what was kept as JSON,
   * as a value. A chunk kept before 2026-11-16 (a list of rows each as JSON text) is read too.
   */
  automationTestRows(
    id: string,
    step: string,
    output: string,
    offset: number,
    limit: number,
  ): unknown[];
}

/** Migration 25 (see the top of this file). It may run again on a database that has it (a test rewinds
 * `user_version` to before 24), so each table is made only if it is not there. */
export const AUTOMATIONS_MIGRATION = `CREATE TABLE IF NOT EXISTS automations (
     id TEXT PRIMARY KEY, by TEXT NOT NULL, created INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE IF NOT EXISTS automation_drafts (
     id TEXT PRIMARY KEY, rev INTEGER NOT NULL, name TEXT NOT NULL, doc TEXT NOT NULL,
     device TEXT, updated INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS automation_layout (
     id TEXT NOT NULL, step TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, PRIMARY KEY (id, step)
   ) WITHOUT ROWID;
   CREATE TABLE IF NOT EXISTS automation_tests (
     id TEXT NOT NULL, step TEXT NOT NULL, print TEXT NOT NULL, at INTEGER NOT NULL, record TEXT NOT NULL,
     PRIMARY KEY (id, step)
   ) WITHOUT ROWID;
   CREATE TABLE IF NOT EXISTS automation_test_rows (
     id TEXT NOT NULL, step TEXT NOT NULL, output TEXT NOT NULL, chunk INTEGER NOT NULL, rows TEXT NOT NULL,
     PRIMARY KEY (id, step, output, chunk)
   ) WITHOUT ROWID;`;

/**
 * Migration 26 (AU-61): the trigger kept beside the name. It may run again on a database that has it (as 25), so the
 * column is added only when it is not there.
 */
export function automationsTriggerMigration(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(automation_drafts)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "trigger"))
    db.exec("ALTER TABLE automation_drafts ADD COLUMN trigger TEXT");
}

/**
 * Migration 27 (F14d, AU-95, AU-194): the versions, and which one runs and whether it is on. It may run again on a
 * database that has it (as 25), so each piece is added only when it is not there. A version is a row that never
 * changes: two triggers refuse an UPDATE or a DELETE of one, whoever tries.
 */
export function automationsVersionsMigration(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS automation_versions (
     id TEXT NOT NULL, n INTEGER NOT NULL, doc TEXT NOT NULL, hash TEXT NOT NULL, at INTEGER NOT NULL,
     device TEXT, by TEXT NOT NULL, names TEXT NOT NULL, PRIMARY KEY (id, n)
   ) WITHOUT ROWID;
   CREATE TRIGGER IF NOT EXISTS automation_versions_fixed BEFORE UPDATE ON automation_versions
     BEGIN SELECT RAISE(ABORT, 'a version never changes'); END;
   CREATE TRIGGER IF NOT EXISTS automation_versions_kept BEFORE DELETE ON automation_versions
     BEGIN SELECT RAISE(ABORT, 'a version is never removed'); END;`);
  const cols = db.prepare("PRAGMA table_info(automations)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "published"))
    db.exec("ALTER TABLE automations ADD COLUMN published INTEGER");
  if (!cols.some((c) => c.name === "enabled"))
    db.exec("ALTER TABLE automations ADD COLUMN enabled INTEGER NOT NULL DEFAULT 0");
}

/**
 * Migration 29 (F14d S3, AU-114): a «Programada»'s hours, read by the scheduler's tick from a column and not from the
 * documents. `automations.schedule`: the published version's schedule triggers and their rules (JSON, written at
 * publishing; null with none); `automations.since`: no hour at or before it runs (publishing a version, turning the
 * switch on); `automation_runs.slot`: the hour a scheduled run was due, unique per automation;
 * `automation_runs.proposal`: the inbox's proposal of what the run asked (AU-193). It may run again on a
 * database that has it (as 25).
 */
export function automationsScheduleMigration(db: DatabaseSync): void {
  const has = (table: string, col: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(
      (c) => c.name === col,
    );
  if (!has("automations", "schedule")) db.exec("ALTER TABLE automations ADD COLUMN schedule TEXT");
  if (!has("automations", "since")) db.exec("ALTER TABLE automations ADD COLUMN since INTEGER");
  if (!has("automation_runs", "slot"))
    db.exec("ALTER TABLE automation_runs ADD COLUMN slot INTEGER");
  if (!has("automation_runs", "proposal"))
    db.exec("ALTER TABLE automation_runs ADD COLUMN proposal TEXT");
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS automation_runs_slot ON automation_runs (automation, slot)
     WHERE slot IS NOT NULL`);
}

/** A published, enabled automation with a «Programada», as the scheduler's tick reads it (AU-114). */
export interface ScheduledAutomation {
  id: string;
  /** JSON: `[{ step, rules: [{ every, at?, day? }] }]`, the published version's (`automationsScheduleMigration`). */
  schedule: string;
  /** No hour at or before it runs. */
  since: number;
  /** The latest hour a run of it was due (also a «No corrió»), or null. */
  last: number | null;
  /** A run of it is queued or running. */
  busy: boolean;
}

/** The label integrities below `imported` (`@boni/entities`' order): a value from outside, a model's or ambient. */
export const OUTSIDE_INTEGRITY = "('external', 'model', 'ambient')";
/**
 * Whether a collection holds a value from outside (AU-182): one `EXISTS` over its rows' labels, by `entities_type`,
 * reading no row whole. There is no index by integrity; its plan and its time at 3,000 rows are held in the server's
 * `publish.test.ts`.
 */
export const HOLDS_OUTSIDE_SQL = `SELECT EXISTS (SELECT 1 FROM entities e JOIN field_prov p ON p.entity = e.id
  WHERE e.type = ? AND e.deleted IS NULL
    AND json_extract(p.label, '$.integrity') IN ${OUTSIDE_INTEGRITY}) AS found`;

/** How many rows of a kept test one chunk holds: one page of the step view (AU-71, AU-72). */
export const TEST_ROWS_CHUNK = 50;

/** The steps of a draft's document, read by SQLite from its JSON: what a save keeps places and tests for. */
const STEPS_OF = "SELECT json_extract(value, '$.id') FROM json_each(?, '$.steps')";

/** The journal's part for automations, over the user's database (one savepoint per change of several rows). */
export function automationsJournal(db: DatabaseSync): AutomationsJournal {
  let n = 0;
  const atomic = <T>(fn: () => T): T => {
    const name = `automations_${++n}`;
    db.exec(`SAVEPOINT ${name}`);
    try {
      const out = fn();
      db.exec(`RELEASE ${name}`);
      return out;
    } catch (e) {
      db.exec(`ROLLBACK TO ${name}`);
      db.exec(`RELEASE ${name}`);
      throw e;
    }
  };
  const row = (r: Record<string, unknown>): AutomationRow => ({
    id: r.id as string,
    by: r.by as string,
    created: Number(r.created),
    deleted: Number(r.deleted) === 1,
    published: r.published === null || r.published === undefined ? null : Number(r.published),
    enabled: Number(r.enabled) === 1,
  });
  const info = (r: Record<string, unknown>): AutomationVersionInfo => ({
    id: r.id as string,
    n: Number(r.n),
    hash: r.hash as string,
    at: Number(r.at),
    device: (r.device as string | null) ?? null,
    by: r.by as string,
  });
  return {
    automations: () =>
      (
        db
          .prepare(
            `SELECT a.id, a.by, a.created, a.deleted, a.published, a.enabled, d.name, d.trigger, d.rev, d.updated
             FROM automations a JOIN automation_drafts d ON d.id = a.id
             WHERE a.deleted = 0 ORDER BY a.created DESC, a.id DESC`,
          )
          .all() as Record<string, unknown>[]
      ).map((r) => ({
        ...row(r),
        name: r.name as string,
        trigger: (r.trigger as string | null) ?? null,
        rev: Number(r.rev),
        updated: Number(r.updated),
      })),
    automation: (id) => {
      const r = db.prepare("SELECT * FROM automations WHERE id = ?").get(id) as
        | Record<string, unknown>
        | undefined;
      return r ? row(r) : null;
    },
    createAutomation: (a, d) =>
      atomic(() => {
        db.prepare("INSERT INTO automations (id, by, created) VALUES (?, ?, ?)").run(
          a.id,
          a.by,
          a.created,
        );
        db.prepare(
          "INSERT INTO automation_drafts (id, rev, name, trigger, doc, device, updated) VALUES (?, 1, ?, ?, ?, ?, ?)",
        ).run(a.id, d.name, d.trigger, d.doc, d.device, d.updated);
      }),
    setAutomationDeleted: (id, deleted) =>
      void (deleted
        ? db.prepare("UPDATE automations SET deleted = 1, enabled = 0 WHERE id = ?").run(id)
        : db.prepare("UPDATE automations SET deleted = 0 WHERE id = ?").run(id)),
    deletedAutomations: () =>
      (
        db
          .prepare(
            `SELECT a.*, d.name, d.updated FROM automations a JOIN automation_drafts d ON d.id = a.id
             WHERE a.deleted = 1 ORDER BY d.updated DESC, a.id DESC`,
          )
          .all() as Record<string, unknown>[]
      ).map((r) => ({ ...row(r), name: r.name as string, updated: Number(r.updated) })),
    automationVersions: (id) =>
      (
        db
          .prepare(
            "SELECT id, n, hash, at, device, by FROM automation_versions WHERE id = ? ORDER BY n DESC",
          )
          .all(id) as Record<string, unknown>[]
      ).map(info),
    automationVersion: (id, n) => {
      const r = db.prepare("SELECT * FROM automation_versions WHERE id = ? AND n = ?").get(id, n) as
        | Record<string, unknown>
        | undefined;
      return r ? { ...info(r), doc: r.doc as string, names: r.names as string } : null;
    },
    publishAutomation: (v, expect, schedule = null) =>
      atomic(() => {
        const last = db
          .prepare("SELECT coalesce(max(n), 0) AS n FROM automation_versions WHERE id = ?")
          .get(v.id) as { n: number };
        const n = Number(last.n) + 1;
        if (n !== expect) throw new Error(`version ${expect} of ${v.id} is not the next (${n})`);
        db.prepare(
          "INSERT INTO automation_versions (id, n, doc, hash, at, device, by, names) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(v.id, n, v.doc, v.hash, v.at, v.device, v.by, v.names);
        const r = db
          .prepare(
            `UPDATE automations SET enabled = CASE WHEN published IS NULL THEN 1 ELSE enabled END, published = ?,
               schedule = ?, since = ?
             WHERE id = ? RETURNING enabled`,
          )
          .get(n, schedule, v.at, v.id) as { enabled: number } | undefined;
        if (!r) throw new Error(`no automation ${v.id}`);
        return { n, enabled: Number(r.enabled) === 1 };
      }),
    setAutomationEnabled: (id, enabled, at) =>
      void db
        .prepare(
          `UPDATE automations SET since = CASE WHEN enabled = 0 AND ? = 1 AND ? IS NOT NULL THEN ? ELSE since END,
             enabled = ? WHERE id = ?`,
        )
        .run(enabled ? 1 : 0, at ?? null, at ?? null, enabled ? 1 : 0, id),
    scheduledAutomations: () =>
      (
        db
          .prepare(
            `SELECT a.id, a.schedule, a.since,
               (SELECT max(r.slot) FROM automation_runs r WHERE r.automation = a.id AND r.slot IS NOT NULL) AS last,
               EXISTS (SELECT 1 FROM automation_runs o WHERE o.automation = a.id
                 AND o.state IN ('queued', 'running')) AS busy
             FROM automations a
             WHERE a.schedule IS NOT NULL AND a.enabled = 1 AND a.deleted = 0 AND a.published IS NOT NULL`,
          )
          .all() as Record<string, unknown>[]
      ).map((r) => ({
        id: r.id as string,
        schedule: r.schedule as string,
        since: Number(r.since ?? 0),
        last: r.last === null || r.last === undefined ? null : Number(r.last),
        busy: Number(r.busy) === 1,
      })),
    holdsOutside: (type) =>
      Number((db.prepare(HOLDS_OUTSIDE_SQL).get(type) as { found: number }).found) === 1,
    automationDraft: (id) => {
      const r = db.prepare("SELECT * FROM automation_drafts WHERE id = ?").get(id) as
        | Record<string, unknown>
        | undefined;
      return r
        ? {
            id: r.id as string,
            rev: Number(r.rev),
            name: r.name as string,
            trigger: (r.trigger as string | null) ?? null,
            doc: r.doc as string,
            device: (r.device as string | null) ?? null,
            updated: Number(r.updated),
          }
        : null;
    },
    saveAutomationDraft: (d) =>
      atomic(() => {
        const r = db
          .prepare(
            `UPDATE automation_drafts SET rev = rev + 1, name = ?, trigger = ?, doc = ?, device = ?, updated = ?
             WHERE id = ? RETURNING rev`,
          )
          .get(d.name, d.trigger, d.doc, d.device, d.updated, d.id) as { rev: number } | undefined;
        if (!r) throw new Error(`no draft of automation ${d.id}`);
        // What the draft no longer has loses its place and its test.
        for (const table of ["automation_layout", "automation_tests", "automation_test_rows"])
          db.prepare(`DELETE FROM ${table} WHERE id = ? AND step NOT IN (${STEPS_OF})`).run(
            d.id,
            d.doc,
          );
        return Number(r.rev);
      }),
    automationLayout: (id) =>
      (
        db
          .prepare("SELECT step, x, y FROM automation_layout WHERE id = ? ORDER BY step")
          .all(id) as Record<string, unknown>[]
      ).map((r) => ({ step: r.step as string, x: Number(r.x), y: Number(r.y) })),
    placeAutomationSteps: (id, places) =>
      atomic(() => {
        const put = db.prepare(
          `INSERT INTO automation_layout (id, step, x, y) VALUES (?, ?, ?, ?)
           ON CONFLICT(id, step) DO UPDATE SET x = excluded.x, y = excluded.y`,
        );
        for (const p of places) put.run(id, p.step, p.x, p.y);
      }),
    automationTests: (id) =>
      (
        db.prepare("SELECT * FROM automation_tests WHERE id = ? ORDER BY step").all(id) as Record<
          string,
          unknown
        >[]
      ).map((r) => ({
        id: r.id as string,
        step: r.step as string,
        print: r.print as string,
        at: Number(r.at),
        record: r.record as string,
      })),
    keepAutomationTests: (id, steps) =>
      atomic(() => {
        const drop = db.prepare("DELETE FROM automation_test_rows WHERE id = ? AND step = ?");
        const put = db.prepare(
          `INSERT INTO automation_tests (id, step, print, at, record) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id, step) DO UPDATE SET print = excluded.print, at = excluded.at, record = excluded.record`,
        );
        const chunk = db.prepare(
          "INSERT INTO automation_test_rows (id, step, output, chunk, rows) VALUES (?, ?, ?, ?, ?)",
        );
        for (const s of steps) {
          drop.run(id, s.step);
          put.run(id, s.step, s.print, s.at, s.record);
          for (const [output, rows] of Object.entries(s.rows))
            for (let i = 0; i * TEST_ROWS_CHUNK < rows.length; i++)
              // One JSON list of the rows as they were given (each already JSON), so a read parses it once.
              chunk.run(
                id,
                s.step,
                output,
                i,
                `[${rows.slice(i * TEST_ROWS_CHUNK, (i + 1) * TEST_ROWS_CHUNK).join(",")}]`,
              );
        }
      }),
    automationTestRows: (id, step, output, offset, limit) => {
      if (limit <= 0 || offset < 0) return [];
      const first = Math.floor(offset / TEST_ROWS_CHUNK);
      const last = Math.floor((offset + limit - 1) / TEST_ROWS_CHUNK);
      const chunks = db
        .prepare(
          `SELECT chunk, rows FROM automation_test_rows
           WHERE id = ? AND step = ? AND output = ? AND chunk BETWEEN ? AND ? ORDER BY chunk`,
        )
        .all(id, step, output, first, last) as { chunk: number; rows: string }[];
      const rows = chunks.flatMap((c) =>
        (JSON.parse(c.rows) as unknown[]).map((r) => (typeof r === "string" ? JSON.parse(r) : r)),
      );
      const from = offset - first * TEST_ROWS_CHUNK;
      return rows.slice(from, from + limit);
    },
  };
}
