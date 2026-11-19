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
 *
 * Migration 30 (`automationRunsKeepMigration`, F14d S4) adds what a run told (`notice`, AU-102, AU-167), when its
 * steps and rows were let go (`pruned`, AU-103: its row stays, with its line), and the list's counts (AU-61, AU-47):
 *
 *   ALTER TABLE automation_runs ADD COLUMN notice TEXT;
 *   ALTER TABLE automation_runs ADD COLUMN pruned INTEGER;
 *   CREATE INDEX automation_runs_whole ON automation_runs (automation, at) WHERE pruned IS NULL;
 *   CREATE INDEX automation_runs_count ON automation_runs (automation, test, at, state);
 *   CREATE TABLE automation_run_counts (automation TEXT PRIMARY KEY, runs INTEGER NOT NULL, last INTEGER)
 *     WITHOUT ROWID;  -- kept by two triggers on automation_runs: every real run that did not miss its hour
 *
 * Migration 32 (`automationRunWaitsMigration`, F15 S2, AU-203) keeps what a run that waits for Juan's answer needs to
 * go on: the engine's execution as it left it (2 MB at most, `ASK_LIMITS.keptBytes`), the earliest instant one of its
 * questions stops waiting, and the answers given so far, by the «Preguntar»'s step. A row per waiting run, dropped
 * when it goes on for the last time, is cancelled, or is interrupted by a restart in the middle of going on:
 *
 *   CREATE TABLE automation_run_waits (
 *     run TEXT PRIMARY KEY, automation TEXT NOT NULL, until INTEGER NOT NULL, execution TEXT NOT NULL,
 *     answers TEXT NOT NULL
 *   );
 *   CREATE INDEX automation_run_waits_until ON automation_run_waits (until);
 *   CREATE INDEX automation_run_waits_of ON automation_run_waits (automation);
 */

/**
 * The map's count of an automation's runs in a period (AU-47): real ones that ran, by the covering index, never a run
 * read (A-29). Exported so its test reads the plan of the statement the store runs.
 */
export const AUTOMATION_RUNS_IN_SQL = `SELECT count(*) AS n FROM automation_runs INDEXED BY automation_runs_count
  WHERE automation = ? AND test = 0 AND at >= ? AND at < ? AND state <> 'missed'`;

/** The same count for the runs that failed (AU-225: «ninguna falló»), by the same covering index. */
export const AUTOMATION_FAILED_IN_SQL = `SELECT count(*) AS n FROM automation_runs INDEXED BY automation_runs_count
  WHERE automation = ? AND test = 0 AND at >= ? AND at < ? AND state = 'failed'`;

/** How a run ends (AU-99, AU-190): it is `queued` and `running` before. */
export type AutomationRunState =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "interrupted"
  /** «No corrió» (AU-114): a «Programada»'s hour passed its margin while the server was off; no step ran. */
  | "missed"
  /**
   * «Esperando» (AU-203): a «Preguntar» waits for Juan's answer. Its turn is let go, a restart keeps it (it is not
   * `interrupted`), and it goes on when answered or when its limit passes.
   */
  | "waiting"
  /** It waited and was cancelled (AU-203): its automation was turned off or deleted, or the run undone, meanwhile. */
  | "cancelled";

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
  /** What started it (AU-195): `user` (by hand) or `schedule` (a «Programada» at its hour). */
  startedBy: string;
  /**
   * A scheduled run's hour, the one that was due (AU-114), also of a «No corrió»; null for every other run. No two
   * runs of one automation have the same (a unique index): an hour never runs twice.
   */
  slot: number | null;
  /** The inbox's proposal of what it asked and waits for Juan (AU-193), or null when it asked nothing. */
  proposal: string | null;
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
  /** «De antes» (AU-227): a run of the flow it was converted from, copied as a summary, with its id. */
  before: boolean;
  /** JSON of what it told, once it ended (AU-102, AU-167): `{ kind, text }`; null when it told nothing. */
  notice: string | null;
  /** When its steps and rows were let go (AU-103); its row stays. Null while it is whole. */
  pruned: number | null;
}

/** How a run counts for the streak of failures (AU-102): how it ended and the version it ran. */
export interface AutomationRunMark {
  state: AutomationRunState;
  version: number | null;
}

/** What is kept whole of an automation's runs (AU-103): `keep` real ones younger than `since`, and `tests` tests. */
export interface AutomationRunsKeep {
  keep: number;
  since: number;
  tests: number;
  now: number;
  /** How many runs one call lets go at most: each call is one short write (task 137). */
  batch: number;
}

/** What a waiting run keeps to go on (AU-203, migration 32): JSON of the engine's execution and of the answers so far. */
export interface AutomationWaitRow {
  run: string;
  automation: string;
  /** The earliest instant one of its questions stops waiting (epoch ms): the scheduler goes on with it then. */
  until: number;
  execution: string;
  /** By the «Preguntar»'s step id, one entry per question: an answer, null for none, or absent while it waits. */
  answers: string;
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
    r: Omit<
      AutomationRunRow,
      | "ended"
      | "ms"
      | "step"
      | "error"
      | "line"
      | "undone"
      | "before"
      | "slot"
      | "proposal"
      | "notice"
      | "pruned"
    > & {
      slot?: number | null;
    },
  ): void;
  /**
   * An hour of a «Programada» that did not run (AU-114): a real run kept as `missed`, ended at `at`, with no step.
   * False when the store already has a run of that hour.
   */
  missAutomationRun(r: {
    id: string;
    automation: string;
    version: number | null;
    trigger: string;
    fields: string;
    slot: number;
    at: number;
  }): boolean;
  /** The proposal made of what it asked (AU-193). */
  setAutomationRunProposal(id: string, proposal: string): void;
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
  /** What a run told when it ended (AU-102, AU-167), as JSON. */
  setAutomationRunNotice(id: string, notice: string): void;
  /**
   * The run before this one (by `at` and id) that marks the streak of failures (AU-102): a real one that ended `done`,
   * or one that started alone (`schedule`, not a retry) and ended failed, interrupted or missed. A failure by hand or
   * a retry's is seen on its screen and marks nothing. Null when there is none.
   */
  streakMark(run: string): AutomationRunMark | null;
  /**
   * Lets go of the steps and rows of an automation's real runs no longer kept whole (AU-103), and drops whole its
   * tests past the last `tests`. A run queued or running, and one whose proposal waits in the inbox (accepting reads
   * what it asked from it), stay whole. One transaction; gives how many runs it touched (less than `batch` when nothing is left).
   */
  pruneAutomationRuns(automation: string, k: AutomationRunsKeep): number;
  /** The list's «Ejecuciones» and «Última ejecución» (AU-61): every real run that did not miss its hour, by a table. */
  automationRunCounts(): Map<string, { runs: number; last: number | null }>;
  /** How many real runs of an automation were asked in `[from, to)`, missed hours left out, by the index (AU-47). */
  automationRunsIn(automation: string, from: number, to: number): number;
  /** How many of those failed (AU-225, the conversion's band), by the same index. */
  automationFailedIn(automation: string, from: number, to: number): number;
  /**
   * A run starts to wait (AU-203): `waiting`, with how long it ran so far, its line and what it needs to go on. One
   * transaction.
   */
  waitAutomationRun(
    id: string,
    w: Pick<AutomationRunRow, "ms" | "line"> & Omit<AutomationWaitRow, "run" | "answers">,
  ): void;
  /** A waiting run goes on: `running` again, its wait kept until it ends or waits again. */
  resumeAutomationRun(id: string): void;
  automationWait(run: string): AutomationWaitRow | null;
  /** The answers given so far to a waiting run's questions (JSON, `AutomationWaitRow.answers`). */
  setAutomationWaitAnswers(run: string, answers: string): void;
  dropAutomationWait(run: string): void;
  /** The waiting runs whose earliest limit is at or before `now`, oldest limit first: what the scheduler goes on with. */
  automationWaitsDue(now: number, limit: number): string[];
  /** How many runs of an automation wait for an answer now (AU-203: 20 at most), by the index. */
  automationWaiting(automation: string): number;
  /** The run of an automation that is queued or running, if there is one: one at a time (AU-97). */
  openAutomationRun(automation: string): AutomationRunRow | null;
  /** The runs of an automation that wait for an answer (AU-203), by the index: what turning it off cancels. */
  waitingAutomationRuns(automation: string): AutomationRunRow[];
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

/** Migration 32 (see the top of this file). It may run again on a database that has it, as 25. */
export const AUTOMATION_RUN_WAITS_MIGRATION = `CREATE TABLE IF NOT EXISTS automation_run_waits (
     run TEXT PRIMARY KEY, automation TEXT NOT NULL, until INTEGER NOT NULL, execution TEXT NOT NULL,
     answers TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS automation_run_waits_until ON automation_run_waits (until);
   CREATE INDEX IF NOT EXISTS automation_run_waits_of ON automation_run_waits (automation);`;

/**
 * Migration 30 (see the top of this file): what a run told, when it was pruned, and the counts, filled from the runs
 * there are. It may run again on a database that has it, as 25.
 */
export function automationRunsKeepMigration(db: DatabaseSync): void {
  const has = (col: string) =>
    (db.prepare("PRAGMA table_info(automation_runs)").all() as { name: string }[]).some(
      (c) => c.name === col,
    );
  if (!has("notice")) db.exec("ALTER TABLE automation_runs ADD COLUMN notice TEXT");
  if (!has("pruned")) db.exec("ALTER TABLE automation_runs ADD COLUMN pruned INTEGER");
  db.exec(`CREATE INDEX IF NOT EXISTS automation_runs_whole ON automation_runs (automation, at)
       WHERE pruned IS NULL;
     CREATE INDEX IF NOT EXISTS automation_runs_count ON automation_runs (automation, test, at, state);
     CREATE TABLE IF NOT EXISTS automation_run_counts (
       automation TEXT PRIMARY KEY, runs INTEGER NOT NULL, last INTEGER
     ) WITHOUT ROWID;
     CREATE TRIGGER IF NOT EXISTS automation_runs_counted AFTER INSERT ON automation_runs
       WHEN NEW.test = 0 AND NEW.state <> 'missed'
     BEGIN
       INSERT INTO automation_run_counts (automation, runs, last) VALUES (NEW.automation, 1, NEW.at)
         ON CONFLICT (automation) DO UPDATE
         SET runs = runs + 1, last = max(coalesce(automation_run_counts.last, excluded.last), excluded.last);
     END;
     CREATE TRIGGER IF NOT EXISTS automation_runs_uncounted AFTER DELETE ON automation_runs
       WHEN OLD.test = 0 AND OLD.state <> 'missed'
     BEGIN
       UPDATE automation_run_counts SET runs = runs - 1,
         last = (SELECT max(at) FROM automation_runs
                 WHERE automation = OLD.automation AND test = 0 AND state <> 'missed')
       WHERE automation = OLD.automation;
     END;
     DELETE FROM automation_run_counts;
     INSERT INTO automation_run_counts (automation, runs, last)
       SELECT automation, count(*), max(at) FROM automation_runs WHERE test = 0 AND state <> 'missed'
       GROUP BY automation;`);
}

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
  slot: num(r.slot),
  proposal: text(r.proposal),
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
  notice: text(r.notice),
  pruned: num(r.pruned),
  before: Number(r.before) === 1,
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
    failed: "AND test = 0 AND state IN ('failed', 'interrupted', 'missed')",
    tests: "AND test = 1",
  };
  return {
    createAutomationRun: (r) =>
      void db
        .prepare(
          `INSERT INTO automation_runs (id, automation, version, test, state, trigger, fields, started_by, device,
             retry_of, at, started, doc, slot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          r.slot ?? null,
        ),
    setAutomationRunProposal: (id, proposal) =>
      void db.prepare("UPDATE automation_runs SET proposal = ? WHERE id = ?").run(proposal, id),
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
    missAutomationRun: (r) => {
      const done = db
        .prepare(
          `INSERT OR IGNORE INTO automation_runs (id, automation, version, test, state, trigger, fields, started_by,
             device, retry_of, at, started, doc, slot, ended, ms)
           VALUES (?, ?, ?, 0, 'missed', ?, ?, 'schedule', NULL, NULL, ?, NULL, NULL, ?, ?, 0)`,
        )
        .run(r.id, r.automation, r.version, r.trigger, r.fields, r.at, r.slot, r.at);
      return Number(done.changes) > 0;
    },
    endAutomationRun: (id, e) =>
      void db
        .prepare(
          "UPDATE automation_runs SET state = ?, ended = ?, ms = ?, step = ?, error = ?, line = ? WHERE id = ?",
        )
        .run(e.state, e.ended, e.ms, e.step, e.error, e.line, id),
    setAutomationRunNotice: (id, notice) =>
      void db.prepare("UPDATE automation_runs SET notice = ? WHERE id = ?").run(notice, id),
    streakMark: (run) => {
      const me = db
        .prepare("SELECT automation, at, rowid AS n FROM automation_runs WHERE id = ?")
        .get(run) as { automation: string; at: number; n: number } | undefined;
      if (!me) return null;
      // Before it: asked earlier, or in the same millisecond and kept before it (ids are random within one).
      const r = db
        .prepare(
          `SELECT state, version FROM automation_runs
           WHERE automation = ? AND (at < ? OR (at = ? AND rowid < ?)) AND test = 0
             AND (state = 'done' OR (started_by = 'schedule' AND retry_of IS NULL
                                      AND state IN ('failed', 'interrupted', 'missed')))
           ORDER BY at DESC, id DESC LIMIT 1`,
        )
        .get(me.automation, me.at, me.at, me.n) as Record<string, unknown> | undefined;
      return r ? { state: r.state as AutomationRunState, version: num(r.version) } : null;
    },
    pruneAutomationRuns: (automation, k) =>
      atomic(() => {
        // The newest `n` of a kind, by the list's index: the edge of what stays whole. An hour that did not run is
        // not one of the last 100 runs (it ran nothing), so it takes no place among them.
        const edge = (test: 0 | 1, n: number) =>
          db
            .prepare(
              `SELECT at, id FROM automation_runs WHERE automation = ? AND test = ?
                 ${test === 0 ? "AND state <> 'missed'" : ""}
               ORDER BY at DESC, id DESC LIMIT 1 OFFSET ?`,
            )
            .get(automation, test, n - 1) as { at: number; id: string } | undefined;
        let left = k.batch;
        const tests = edge(1, k.tests);
        if (tests) {
          const old = db
            .prepare(
              `SELECT id FROM automation_runs WHERE automation = ? AND test = 1
                 AND (at < ? OR (at = ? AND id < ?)) AND state NOT IN ('queued', 'running') LIMIT ?`,
            )
            .all(automation, tests.at, tests.at, tests.id, left) as { id: string }[];
          const rows = db.prepare("DELETE FROM automation_run_rows WHERE run = ?");
          const steps = db.prepare("DELETE FROM automation_run_steps WHERE run = ?");
          const runs = db.prepare("DELETE FROM automation_runs WHERE id = ?");
          // What Boni learned of a run goes with it (AU-207); a test has none, this keeps it so.
          const decisions = db.prepare("DELETE FROM decisions WHERE run = ?");
          for (const { id } of old) {
            rows.run(id);
            steps.run(id);
            runs.run(id);
            decisions.run(id);
          }
          left -= old.length;
        }
        if (left <= 0) return k.batch;
        const real = edge(0, k.keep);
        // Whole real runs past the last `keep`, or older than `since`, by the index of the whole ones.
        const old = db
          .prepare(
            `SELECT id FROM automation_runs INDEXED BY automation_runs_whole
             WHERE automation = ? AND pruned IS NULL AND test = 0 AND state NOT IN ('queued', 'running', 'waiting')
               AND (at < ? ${real ? "OR at < ? OR (at = ? AND id < ?)" : ""})
               -- What it asked is read from it when its proposal is accepted (proposal.ts): it waits whole.
               AND (automation_runs.proposal IS NULL OR NOT EXISTS (SELECT 1 FROM proposals p
                                                    WHERE p.id = automation_runs.proposal AND p.status = 'pending'))
             LIMIT ?`,
          )
          .all(
            ...((real
              ? [automation, k.since, real.at, real.at, real.id, left]
              : [automation, k.since, left]) as (string | number)[]),
          ) as { id: string }[];
        const rows = db.prepare("DELETE FROM automation_run_rows WHERE run = ?");
        const steps = db.prepare("DELETE FROM automation_run_steps WHERE run = ?");
        const mark = db.prepare("UPDATE automation_runs SET pruned = ? WHERE id = ?");
        for (const { id } of old) {
          rows.run(id);
          steps.run(id);
          mark.run(k.now, id);
        }
        return k.batch - left + old.length;
      }),
    automationRunCounts: () =>
      new Map(
        (
          db.prepare("SELECT automation, runs, last FROM automation_run_counts").all() as {
            automation: string;
            runs: number;
            last: number | null;
          }[]
        ).map((r) => [r.automation, { runs: Number(r.runs), last: num(r.last) }]),
      ),
    automationRunsIn: (automation, from, to) =>
      Number((db.prepare(AUTOMATION_RUNS_IN_SQL).get(automation, from, to) as { n: number }).n),
    automationFailedIn: (automation, from, to) =>
      Number((db.prepare(AUTOMATION_FAILED_IN_SQL).get(automation, from, to) as { n: number }).n),
    automationRun: (id) => {
      const r = db.prepare("SELECT * FROM automation_runs WHERE id = ?").get(id) as
        | Record<string, unknown>
        | undefined;
      return r ? runOf(r) : null;
    },
    waitAutomationRun: (id, w) =>
      atomic(() => {
        db.prepare(
          "UPDATE automation_runs SET state = 'waiting', ms = ?, line = ?, step = NULL WHERE id = ?",
        ).run(w.ms, w.line, id);
        db.prepare(
          `INSERT INTO automation_run_waits (run, automation, until, execution, answers) VALUES (?, ?, ?, ?, '{}')
           ON CONFLICT(run) DO UPDATE SET until = excluded.until, execution = excluded.execution`,
        ).run(id, w.automation, w.until, w.execution);
      }),
    resumeAutomationRun: (id) =>
      void db
        .prepare("UPDATE automation_runs SET state = 'running' WHERE id = ? AND state = 'waiting'")
        .run(id),
    automationWait: (run) => {
      const r = db.prepare("SELECT * FROM automation_run_waits WHERE run = ?").get(run) as
        | Record<string, unknown>
        | undefined;
      return r
        ? {
            run: r.run as string,
            automation: r.automation as string,
            until: Number(r.until),
            execution: r.execution as string,
            answers: r.answers as string,
          }
        : null;
    },
    setAutomationWaitAnswers: (run, answers) =>
      void db
        .prepare("UPDATE automation_run_waits SET answers = ? WHERE run = ?")
        .run(answers, run),
    dropAutomationWait: (run) =>
      void db.prepare("DELETE FROM automation_run_waits WHERE run = ?").run(run),
    automationWaitsDue: (now, limit) =>
      (
        db
          .prepare(
            `SELECT w.run AS run FROM automation_run_waits w JOIN automation_runs r ON r.id = w.run
             WHERE w.until <= ? AND r.state = 'waiting' ORDER BY w.until LIMIT ?`,
          )
          .all(now, limit) as { run: string }[]
      ).map((r) => r.run),
    automationWaiting: (automation) =>
      Number(
        (
          db
            .prepare("SELECT count(*) AS n FROM automation_run_waits WHERE automation = ?")
            .get(automation) as { n: number }
        ).n,
      ),
    waitingAutomationRuns: (automation) =>
      (
        db
          .prepare(
            `SELECT r.* FROM automation_run_waits w JOIN automation_runs r ON r.id = w.run
             WHERE w.automation = ? AND r.state = 'waiting' ORDER BY r.at, r.id`,
          )
          .all(automation) as Record<string, unknown>[]
      ).map(runOf),
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
        ).map((r) => {
          // One cut while it went on after a wait: what it kept to go on goes with it (nothing runs again).
          db.prepare("DELETE FROM automation_run_waits WHERE run = ?").run(r.id);
          return r.id;
        }),
      ),
    setAutomationRunUndone: (id, at) =>
      void db.prepare("UPDATE automation_runs SET undone = ? WHERE id = ?").run(at, id),
    dropAutomationRun: (id) =>
      atomic(() => {
        db.prepare("DELETE FROM automation_run_waits WHERE run = ?").run(id);
        db.prepare("DELETE FROM automation_run_rows WHERE run = ?").run(id);
        db.prepare("DELETE FROM automation_run_steps WHERE run = ?").run(id);
        db.prepare("DELETE FROM automation_runs WHERE id = ?").run(id);
        db.prepare("DELETE FROM decisions WHERE run = ?").run(id);
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
