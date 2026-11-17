import type { DatabaseSync } from "node:sqlite";
import { OUTSIDE_INTEGRITY, TEST_ROWS_CHUNK } from "./automations.ts";

/**
 * An automation's runs and what is pinned on its draft (docs/automatizaciones.md §5.8, phase F14d S2: AU-93, AU-99,
 * AU-18, AU-100, AU-190), in the user's store (D-02) beside the automations' other tables, through `store.journal`.
 * Migration 28 (`automationRunsMigration`):
 *
 *   CREATE TABLE automation_runs (
 *     id TEXT PRIMARY KEY, automation TEXT NOT NULL, version INTEGER, test INTEGER NOT NULL, state TEXT NOT NULL,
 *     trigger TEXT NOT NULL, fields TEXT NOT NULL, started_by TEXT NOT NULL, device TEXT, retry_of TEXT,
 *     at INTEGER NOT NULL, started INTEGER, ended INTEGER, ms INTEGER, step TEXT, error TEXT, line TEXT,
 *     doc TEXT, undone INTEGER
 *   );
 *   CREATE INDEX automation_runs_list ON automation_runs (automation, at DESC, id DESC);
 *   CREATE INDEX automation_runs_open ON automation_runs (automation) WHERE state IN ('queued', 'running');
 *   CREATE TABLE automation_run_steps (
 *     run TEXT NOT NULL, step TEXT NOT NULL, n INTEGER NOT NULL, record TEXT NOT NULL, PRIMARY KEY (run, step)
 *   ) WITHOUT ROWID;
 *   CREATE TABLE automation_run_rows (
 *     run TEXT NOT NULL, step TEXT NOT NULL, output TEXT NOT NULL, chunk INTEGER NOT NULL, rows TEXT NOT NULL,
 *     PRIMARY KEY (run, step, output, chunk)
 *   ) WITHOUT ROWID;
 *   CREATE TABLE automation_pins (
 *     id TEXT NOT NULL, step TEXT NOT NULL, print TEXT NOT NULL, at INTEGER NOT NULL, record TEXT NOT NULL,
 *     PRIMARY KEY (id, step)
 *   ) WITHOUT ROWID;
 *   CREATE TABLE automation_pin_rows (… as automation_test_rows …) WITHOUT ROWID;
 *
 * A run's record is written as it goes: its row when it is asked, each step's record and rows as the step ends, and
 * its end. So a run in progress is read up to its last finished step, and one a restart cut is found still
 * `running` and closed as `interrupted` (AU-190). What the run wrote in the collections is not here: it is in the
 * operation log, each operation with the run's id (`ops.run`), and «Deshacer lo que hizo» is the store's `undoRun`
 * (AU-18). None of these tables is in the operation log: no Undo of the store touches a run's record or a pin.
 */

/** How a run ends (AU-99, AU-190): it is `queued` and `running` before. */
export type AutomationRunState = "queued" | "running" | "done" | "failed" | "interrupted";

/** One run, real or a whole «Probar» (AU-99), without its steps and rows. */
export interface AutomationRunRow {
  id: string;
  automation: string;
  /** The version it ran; null for a test, which ran the draft (kept in `doc`). */
  version: number | null;
  test: boolean;
  state: AutomationRunState;
  /** The trigger it started in, and the fields it was started with (JSON): what «Reintentar» starts again with. */
  trigger: string;
  fields: string;
  /** What started it: `user` (by hand) in S2; the schedule arrives with S3. */
  startedBy: string;
  device: string | null;
  /** The run «Reintentar» repeated. */
  retryOf: string | null;
  /** When it was asked, started and ended (epoch ms), and how long it ran. */
  at: number;
  started: number | null;
  ended: number | null;
  ms: number | null;
  /** Running: the step it is in. Failed or interrupted: the step it stopped at. */
  step: string | null;
  /** JSON of the engine's `StepError` with its `step`, when it failed. */
  error: string | null;
  /** JSON of what it did in one line (AU-99), once it ended. */
  line: string | null;
  /** A test's document (the draft as it ran); null for a real run, whose document is its version's. */
  doc: string | null;
  /** When «Deshacer lo que hizo» undid it (AU-18). */
  undone: number | null;
}

/** Which runs a page of the list holds (AU-99): all, the failed (and interrupted) real ones, or the tests. */
export type AutomationRunFilter = "all" | "failed" | "tests";

/** What a run saved in the collections, by the log (AU-99, AU-182): by type and kind, and whether any is from outside. */
export interface AutomationRunWrites {
  counts: { type: string; kind: "create" | "update" | "delete"; n: number }[];
  /** A field it wrote holds a value from outside (a label below `imported`). */
  outside: boolean;
}

/** A pinned output of a step (AU-93): the test it was pinned from, by its print, and its record without rows. */
export interface AutomationPinRow {
  id: string;
  step: string;
  print: string;
  at: number;
  record: string;
}

type Rows = Readonly<Record<string, readonly string[]>>;

export interface AutomationRunsJournal {
  /** A new run, `queued` (or `running` with `started`). */
  createAutomationRun(
    r: Omit<AutomationRunRow, "ended" | "ms" | "step" | "error" | "line" | "undone">,
  ): void;
  /** It starts: `running`, from `started`. */
  startAutomationRun(id: string, started: number): void;
  /** The step it is in now. */
  setAutomationRunStep(id: string, step: string): void;
  /** One step decided: its record (JSON, without rows) and its rows by output (each as JSON), in order. */
  keepAutomationRunStep(
    run: string,
    step: { step: string; n: number; record: string; rows: Rows },
  ): void;
  /** It ended. */
  endAutomationRun(
    id: string,
    end: Pick<AutomationRunRow, "state" | "ended" | "ms" | "step" | "error" | "line">,
  ): void;
  automationRun(id: string): AutomationRunRow | null;
  /** The run of an automation that is queued or running, if there is one: one at a time (AU-97). */
  openAutomationRun(automation: string): AutomationRunRow | null;
  /**
   * A page of an automation's runs, the newest first, by the index (A-29): `before` is the id of the last one of the
   * page before. Reads no step and no row.
   */
  automationRuns(
    automation: string,
    q: { filter: AutomationRunFilter; before?: string; limit: number },
  ): AutomationRunRow[];
  /** The records of a run's steps (JSON), in the order they were decided. */
  automationRunSteps(run: string): { step: string; n: number; record: string }[];
  /** Some rows of one output of a run's step, in order, each parsed once from its chunk. */
  automationRunRows(
    run: string,
    step: string,
    output: string,
    offset: number,
    limit: number,
  ): unknown[];
  /**
   * At start-up (AU-190): every run still queued or running is closed as `interrupted`, at `now`, keeping the step
   * it was in. Gives their ids. Nothing is run again.
   */
  interruptAutomationRuns(now: number): string[];
  setAutomationRunUndone(id: string, at: number): void;
  /** Removes a run that never started, with what it kept: the route refused it before its first step. */
  dropAutomationRun(id: string): void;
  /** What a run saved in the collections, from the operation log (its operations not undone). */
  automationRunWrites(run: string): AutomationRunWrites;
  /** The pinned outputs of an automation's steps (AU-93). */
  automationPins(id: string): AutomationPinRow[];
  /** Pins a step's output over the one it had, with its rows by output (each as JSON). */
  pinAutomationStep(p: AutomationPinRow & { rows: Rows }): void;
  unpinAutomationStep(id: string, step: string): void;
  automationPinRows(
    id: string,
    step: string,
    output: string,
    offset: number,
    limit: number,
  ): unknown[];
}

/** Migration 28 (see the top of this file). It may run again on a database that has it, as 25. */
export const AUTOMATION_RUNS_MIGRATION = `CREATE TABLE IF NOT EXISTS automation_runs (
     id TEXT PRIMARY KEY, automation TEXT NOT NULL, version INTEGER, test INTEGER NOT NULL, state TEXT NOT NULL,
     trigger TEXT NOT NULL, fields TEXT NOT NULL, started_by TEXT NOT NULL, device TEXT, retry_of TEXT,
     at INTEGER NOT NULL, started INTEGER, ended INTEGER, ms INTEGER, step TEXT, error TEXT, line TEXT,
     doc TEXT, undone INTEGER
   );
   CREATE INDEX IF NOT EXISTS automation_runs_list ON automation_runs (automation, at DESC, id DESC);
   CREATE INDEX IF NOT EXISTS automation_runs_open ON automation_runs (automation)
     WHERE state IN ('queued', 'running');
   CREATE TABLE IF NOT EXISTS automation_run_steps (
     run TEXT NOT NULL, step TEXT NOT NULL, n INTEGER NOT NULL, record TEXT NOT NULL, PRIMARY KEY (run, step)
   ) WITHOUT ROWID;
   CREATE TABLE IF NOT EXISTS automation_run_rows (
     run TEXT NOT NULL, step TEXT NOT NULL, output TEXT NOT NULL, chunk INTEGER NOT NULL, rows TEXT NOT NULL,
     PRIMARY KEY (run, step, output, chunk)
   ) WITHOUT ROWID;
   CREATE TABLE IF NOT EXISTS automation_pins (
     id TEXT NOT NULL, step TEXT NOT NULL, print TEXT NOT NULL, at INTEGER NOT NULL, record TEXT NOT NULL,
     PRIMARY KEY (id, step)
   ) WITHOUT ROWID;
   CREATE TABLE IF NOT EXISTS automation_pin_rows (
     id TEXT NOT NULL, step TEXT NOT NULL, output TEXT NOT NULL, chunk INTEGER NOT NULL, rows TEXT NOT NULL,
     PRIMARY KEY (id, step, output, chunk)
   ) WITHOUT ROWID;`;

/** Rows by output, 50 to a chunk, each chunk one JSON list: as a kept test's (automations.ts). */
function putChunks(
  put: ReturnType<DatabaseSync["prepare"]>,
  owner: string,
  step: string,
  rows: Rows,
): void {
  for (const [output, list] of Object.entries(rows))
    for (let i = 0; i * TEST_ROWS_CHUNK < list.length; i++)
      put.run(
        owner,
        step,
        output,
        i,
        `[${list.slice(i * TEST_ROWS_CHUNK, (i + 1) * TEST_ROWS_CHUNK).join(",")}]`,
      );
}

function readChunks(
  db: DatabaseSync,
  table: string,
  ownerColumn: string,
  q: { owner: string; step: string; output: string; offset: number; limit: number },
): unknown[] {
  if (q.limit <= 0 || q.offset < 0) return [];
  const first = Math.floor(q.offset / TEST_ROWS_CHUNK);
  const last = Math.floor((q.offset + q.limit - 1) / TEST_ROWS_CHUNK);
  const chunks = db
    .prepare(
      `SELECT rows FROM ${table} WHERE ${ownerColumn} = ? AND step = ? AND output = ?
       AND chunk BETWEEN ? AND ? ORDER BY chunk`,
    )
    .all(q.owner, q.step, q.output, first, last) as { rows: string }[];
  const rows = chunks.flatMap((c) => JSON.parse(c.rows) as unknown[]);
  const from = q.offset - first * TEST_ROWS_CHUNK;
  return rows.slice(from, from + q.limit);
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

const runOf = (r: Record<string, unknown>): AutomationRunRow => ({
  id: r.id as string,
  automation: r.automation as string,
  version: num(r.version),
  test: Number(r.test) === 1,
  state: r.state as AutomationRunState,
  trigger: r.trigger as string,
  fields: r.fields as string,
  startedBy: r.started_by as string,
  device: text(r.device),
  retryOf: text(r.retry_of),
  at: Number(r.at),
  started: num(r.started),
  ended: num(r.ended),
  ms: num(r.ms),
  step: text(r.step),
  error: text(r.error),
  line: text(r.line),
  doc: text(r.doc),
  undone: num(r.undone),
});

/** The journal's part for runs and pins, over the user's database. */
export function automationRunsJournal(db: DatabaseSync): AutomationRunsJournal {
  let n = 0;
  const atomic = <T>(fn: () => T): T => {
    const name = `automation_runs_${++n}`;
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
  const FILTERS: Record<AutomationRunFilter, string> = {
    all: "",
    failed: "AND test = 0 AND state IN ('failed', 'interrupted')",
    tests: "AND test = 1",
  };
  return {
    createAutomationRun: (r) =>
      void db
        .prepare(
          `INSERT INTO automation_runs (id, automation, version, test, state, trigger, fields, started_by, device,
             retry_of, at, started, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          r.id,
          r.automation,
          r.version,
          r.test ? 1 : 0,
          r.state,
          r.trigger,
          r.fields,
          r.startedBy,
          r.device,
          r.retryOf,
          r.at,
          r.started,
          r.doc,
        ),
    startAutomationRun: (id, started) =>
      void db
        .prepare("UPDATE automation_runs SET state = 'running', started = ? WHERE id = ?")
        .run(started, id),
    setAutomationRunStep: (id, step) =>
      void db.prepare("UPDATE automation_runs SET step = ? WHERE id = ?").run(step, id),
    keepAutomationRunStep: (run, s) =>
      atomic(() => {
        db.prepare(
          `INSERT INTO automation_run_steps (run, step, n, record) VALUES (?, ?, ?, ?)
           ON CONFLICT(run, step) DO UPDATE SET n = excluded.n, record = excluded.record`,
        ).run(run, s.step, s.n, s.record);
        db.prepare("DELETE FROM automation_run_rows WHERE run = ? AND step = ?").run(run, s.step);
        putChunks(
          db.prepare(
            "INSERT INTO automation_run_rows (run, step, output, chunk, rows) VALUES (?, ?, ?, ?, ?)",
          ),
          run,
          s.step,
          s.rows,
        );
      }),
    endAutomationRun: (id, e) =>
      void db
        .prepare(
          "UPDATE automation_runs SET state = ?, ended = ?, ms = ?, step = ?, error = ?, line = ? WHERE id = ?",
        )
        .run(e.state, e.ended, e.ms, e.step, e.error, e.line, id),
    automationRun: (id) => {
      const r = db.prepare("SELECT * FROM automation_runs WHERE id = ?").get(id) as
        | Record<string, unknown>
        | undefined;
      return r ? runOf(r) : null;
    },
    openAutomationRun: (automation) => {
      const r = db
        .prepare(
          `SELECT * FROM automation_runs WHERE automation = ? AND state IN ('queued', 'running')
           ORDER BY at, id LIMIT 1`,
        )
        .get(automation) as Record<string, unknown> | undefined;
      return r ? runOf(r) : null;
    },
    automationRuns: (automation, q) => {
      const before = q.before
        ? (db
            .prepare("SELECT at, id FROM automation_runs WHERE id = ? AND automation = ?")
            .get(q.before, automation) as { at: number; id: string } | undefined)
        : undefined;
      if (q.before && !before) return [];
      const rows = db
        .prepare(
          `SELECT * FROM automation_runs WHERE automation = ? ${FILTERS[q.filter]}
           ${before ? "AND (at < ? OR (at = ? AND id < ?))" : ""}
           ORDER BY at DESC, id DESC LIMIT ?`,
        )
        .all(
          ...((before
            ? [automation, before.at, before.at, before.id, q.limit]
            : [automation, q.limit]) as (string | number)[]),
        ) as Record<string, unknown>[];
      return rows.map(runOf);
    },
    automationRunSteps: (run) =>
      (
        db
          .prepare("SELECT step, n, record FROM automation_run_steps WHERE run = ? ORDER BY n")
          .all(run) as Record<string, unknown>[]
      ).map((r) => ({ step: r.step as string, n: Number(r.n), record: r.record as string })),
    automationRunRows: (run, step, output, offset, limit) =>
      readChunks(db, "automation_run_rows", "run", { owner: run, step, output, offset, limit }),
    interruptAutomationRuns: (now) =>
      atomic(() =>
        (
          db
            .prepare(
              `UPDATE automation_runs SET state = 'interrupted', ended = ?,
                 ms = CASE WHEN started IS NULL THEN NULL ELSE ? - started END
               WHERE state IN ('queued', 'running') RETURNING id`,
            )
            .all(now, now) as { id: string }[]
        ).map((r) => r.id),
      ),
    setAutomationRunUndone: (id, at) =>
      void db.prepare("UPDATE automation_runs SET undone = ? WHERE id = ?").run(at, id),
    dropAutomationRun: (id) =>
      atomic(() => {
        db.prepare("DELETE FROM automation_run_rows WHERE run = ?").run(id);
        db.prepare("DELETE FROM automation_run_steps WHERE run = ?").run(id);
        db.prepare("DELETE FROM automation_runs WHERE id = ?").run(id);
      }),
    automationRunWrites: (run) => {
      const counts = (
        db
          .prepare(
            `SELECT e.type AS type, o.kind AS kind, count(DISTINCT o.target) AS n
             FROM ops o JOIN entities e ON e.id = o.target
             WHERE o.run = ? AND o.undoes IS NULL AND o.kind IN ('create', 'update', 'delete')
               AND NOT EXISTS (SELECT 1 FROM ops u WHERE u.undoes = o.seq)
             GROUP BY e.type, o.kind ORDER BY min(o.seq)`,
          )
          .all(run) as { type: string; kind: "create" | "update" | "delete"; n: number }[]
      ).map((r) => ({ type: r.type, kind: r.kind, n: Number(r.n) }));
      // The labels the run's own operations left on the fields they wrote (`field_prov.op`), not the row's others.
      const outside =
        Number(
          (
            db
              .prepare(
                `SELECT EXISTS (SELECT 1 FROM ops o JOIN field_prov p ON p.entity = o.target AND p.op = o.seq
                   WHERE o.run = ? AND o.undoes IS NULL
                     AND json_extract(p.label, '$.integrity') IN ${OUTSIDE_INTEGRITY}) AS found`,
              )
              .get(run) as { found: number }
          ).found,
        ) === 1;
      return { counts, outside };
    },
    automationPins: (id) =>
      (
        db.prepare("SELECT * FROM automation_pins WHERE id = ? ORDER BY step").all(id) as Record<
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
    pinAutomationStep: (p) =>
      atomic(() => {
        db.prepare("DELETE FROM automation_pin_rows WHERE id = ? AND step = ?").run(p.id, p.step);
        db.prepare(
          `INSERT INTO automation_pins (id, step, print, at, record) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id, step) DO UPDATE SET print = excluded.print, at = excluded.at, record = excluded.record`,
        ).run(p.id, p.step, p.print, p.at, p.record);
        putChunks(
          db.prepare(
            "INSERT INTO automation_pin_rows (id, step, output, chunk, rows) VALUES (?, ?, ?, ?, ?)",
          ),
          p.id,
          p.step,
          p.rows,
        );
      }),
    unpinAutomationStep: (id, step) =>
      atomic(() => {
        db.prepare("DELETE FROM automation_pins WHERE id = ? AND step = ?").run(id, step);
        db.prepare("DELETE FROM automation_pin_rows WHERE id = ? AND step = ?").run(id, step);
      }),
    automationPinRows: (id, step, output, offset, limit) =>
      readChunks(db, "automation_pin_rows", "id", { owner: id, step, output, offset, limit }),
  };
}
