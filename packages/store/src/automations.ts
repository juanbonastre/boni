import type { DatabaseSync } from "node:sqlite";

/**
 * Where an automation lives (docs/automatizaciones.md §7; phase F14b): in the user's store (D-02), next to the
 * flows of before, as tables of the journal side, reached through `store.journal`. Like a flow, an automation is no
 * entity: no collection lists it but Boni's own «Automatizaciones», which is made on each read. `Journal` extends
 * `AutomationsJournal`, and `automationsJournal` is its part of `openJournal`.
 *
 * The migration (`AUTOMATIONS_MIGRATION`, entry 25 of `MIGRATIONS`; entry 26 adds `automation_drafts.trigger`):
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
 *
 * What is undone and how (D-02). None of these is in the operation log: nothing here is a record of a collection.
 * - The draft is undone in the editor (AU-68), change by change; each undo is one more save.
 * - «Eliminar» sets `deleted` and its notice's «Deshacer» clears it: the draft, the places and the kept tests stay.
 * - A test writes nothing in any collection (AU-90), so it has nothing to undo.
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
  createAutomation(a: Omit<AutomationRow, "deleted">, draft: Omit<AutomationDraftRow, "rev">): void;
  /** «Eliminar» and its «Deshacer». */
  setAutomationDeleted(id: string, deleted: boolean): void;
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
  });
  return {
    automations: () =>
      (
        db
          .prepare(
            `SELECT a.id, a.by, a.created, a.deleted, d.name, d.trigger, d.rev, d.updated
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
      void db.prepare("UPDATE automations SET deleted = ? WHERE id = ?").run(deleted ? 1 : 0, id),
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
