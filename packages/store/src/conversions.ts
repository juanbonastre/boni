import type { DatabaseSync } from "node:sqlite";

/**
 * Flows of before made automations (docs/automatizaciones.md AU-150, AU-225 to AU-228; phase F16 S1). What is kept of
 * each conversion, beside the automation it made: one row per flow the conversion reached, with its state, which
 * automation version came from which flow version, how many versions could not be converted, «Lo que cambia» and,
 * for a flow left on the engine of before, why. Nothing of the flow is deleted or changed: `flows`, its drafts,
 * `runs` and `run_steps` stay as they are, an archive that `flows()` no longer lists once its flow is converted, so
 * nothing runs it there (AU-228: one engine per id).
 *
 * The migration (`conversionsMigration`, entry 35 of `MIGRATIONS`; it may run again over itself):
 *
 *   CREATE TABLE flow_conversions (
 *     id TEXT PRIMARY KEY,                -- the flow's id, which is also its automation's (AU-225)
 *     at INTEGER NOT NULL,                -- when it was converted (or last found not convertible)
 *     state TEXT NOT NULL CHECK (state IN ('converted', 'reverted', 'kept')),
 *     changed INTEGER NOT NULL,           -- when the state last changed («Volver al flujo de antes», «Convertir otra vez»)
 *     versions TEXT NOT NULL,             -- JSON [{ n, flow }]: each automation version and its flow version
 *     skipped INTEGER NOT NULL,           -- versions of before that could not be converted
 *     changes TEXT NOT NULL,              -- JSON: the keys of «Lo que cambia» (`CHANGES` of @boni/agent)
 *     reasons TEXT NOT NULL,              -- JSON: why the version that runs was not converted (state `kept`)
 *     copied INTEGER                      -- when every finished run of before was copied, or null while not yet
 *   ) WITHOUT ROWID;
 *   ALTER TABLE automation_versions ADD COLUMN flow INTEGER;   -- «Convertida»: the flow version it came from
 *   ALTER TABLE automation_runs ADD COLUMN before INTEGER;     -- «De antes»: a run of the flow, as a summary row
 *
 * States: `converted`, the automation runs and the flow does not; `reverted` («Volver al flujo de antes»), the flow
 * runs again as it was and its automation is off, not deleted; `kept`, the flow's running version could not be
 * converted (its `reasons`), so it goes on in the engine of before and the conversion tries again at the next
 * opening, with a translator that may know more.
 */

export type FlowConversionState = "converted" | "reverted" | "kept";

/** Why a step of a flow's running version has no step yet (`untranslated` of `planToAutomation`). */
export interface ConversionReason {
  step: string;
  what: string;
  reason: string;
}

export interface FlowConversionRow {
  id: string;
  at: number;
  state: FlowConversionState;
  changed: number;
  versions: { n: number; flow: number }[];
  skipped: number;
  changes: string[];
  reasons: ConversionReason[];
  copied: number | null;
}

/** One version of the flow converted: its document as it runs (its `version` is its number), and whose it was. */
export interface AdoptedVersion {
  /** The flow version it came from. */
  flow: number;
  doc: string;
  hash: string;
  /** The flow version's date and author: «Versiones» shows them as they were (AU-225). */
  at: number;
  by: string;
  names: string;
}

/** What `adoptFlow` writes in one transaction: the automation, its draft, its versions and the conversion's row. */
export interface FlowAdoption {
  id: string;
  /** The flow's author (`user`), and when it was first saved. */
  by: string;
  created: number;
  /** Now. */
  at: number;
  draft: {
    name: string;
    trigger: string | null;
    doc: string;
    device: string | null;
    updated: number;
  };
  /** The versions that could be converted, oldest first; the last is the one that runs. */
  versions: AdoptedVersion[];
  /** On or off, as the flow was. */
  enabled: boolean;
  /** The published version's «Programada» hours (`scheduleColumn`), or null. */
  schedule: string | null;
  /**
   * Where its hours count from (AU-226): when the flow last ran, or when it was saved if it never ran, so the
   * scheduler neither repeats the hour the flow already ran nor skips the next one.
   */
  since: number;
  skipped: number;
  changes: string[];
}

export interface ConversionsJournal {
  /** Every flow the conversion reached, the newest first. */
  flowConversions(): FlowConversionRow[];
  flowConversion(id: string): FlowConversionRow | null;
  /**
   * The flow made an automation, in one transaction (AU-225, AU-228): from the next read `flows()` leaves it out and
   * its automation runs. False, and nothing written, when it was converted before (repeatable: a second opening
   * adds nothing) or when an automation already has its id.
   */
  adoptFlow(a: FlowAdoption): boolean;
  /** The flow's running version could not be converted: it stays in the engine of before, and says why. */
  keepFlow(
    id: string,
    at: number,
    k: { reasons: ConversionReason[]; skipped: number; changes: string[] },
  ): void;
  /** «Volver al flujo de antes» (AU-225): the flow runs again, its automation is off. False when not converted. */
  revertFlow(id: string, at: number): boolean;
  /**
   * «Convertir otra vez»: back to the automation, on from now. Refused (`changed`) when the flow has a version the
   * automation does not have (it was changed while it ran as before), and `no` when it was not reverted.
   */
  reconvertFlow(id: string, at: number): "ok" | "changed" | "no";
  /**
   * Up to `limit` finished runs of the flow not copied yet, copied as «De antes» rows of its automation (AU-227), with
   * their ids (so «Deshacer lo que hizo» still undoes them); the count copied. At 0 the copy is marked done, unless a
   * run of before has not ended yet (it waits on a question): that one is copied when it has.
   */
  copyBeforeRuns(id: string, limit: number, at: number): number;
}

const j = JSON.stringify;

/** Migration 35 (see the top of this file). */
export function conversionsMigration(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS flow_conversions (
     id TEXT PRIMARY KEY, at INTEGER NOT NULL,
     state TEXT NOT NULL CHECK (state IN ('converted', 'reverted', 'kept')), changed INTEGER NOT NULL,
     versions TEXT NOT NULL, skipped INTEGER NOT NULL, changes TEXT NOT NULL, reasons TEXT NOT NULL, copied INTEGER
   ) WITHOUT ROWID`);
  const has = (table: string, col: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(
      (c) => c.name === col,
    );
  if (!has("automation_versions", "flow"))
    db.exec("ALTER TABLE automation_versions ADD COLUMN flow INTEGER");
  if (!has("automation_runs", "before"))
    db.exec("ALTER TABLE automation_runs ADD COLUMN before INTEGER");
}

/** Whether a flow id is not converted: `flows()` leaves the converted ones out (journal.ts). */
export const NOT_CONVERTED_SQL =
  "NOT EXISTS (SELECT 1 FROM flow_conversions c WHERE c.id = f.id AND c.state = 'converted')";

/**
 * A finished run of before as a summary row of its automation (AU-227): when, how it ended, how long, which version
 * (the automation version converted from the flow version it ran; null for one that could not be converted), and
 * marked `before`. No steps: those stay in «Registro». `pruned` is set, as a run let go (AU-103): it takes no place
 * among the 100 kept whole. A turn's or a page button's run was started by hand (`user`), one of the scheduler
 * (`background`) at its hour (`schedule`). How it ended is the old engine's fixed code, never data.
 */
const COPY_SQL = `INSERT OR IGNORE INTO automation_runs (id, automation, version, test, state, trigger, fields,
     started_by, device, retry_of, at, started, ended, ms, step, error, line, doc, undone, notice, pruned, slot,
     proposal, before)
   SELECT r.id, r.flow,
     (SELECT v.n FROM automation_versions v WHERE v.id = r.flow AND v.flow = r.flow_version),
     0,
     CASE WHEN r.status = 'done' OR r.status LIKE 'done:%' OR r.status = 'proposed' THEN 'done' ELSE 'failed' END,
     'trigger', '{}',
     CASE WHEN r.origin = 'background' THEN 'schedule' ELSE 'user' END,
     r.device, NULL, r.started, r.started, r.finished, max(0, r.finished - r.started), NULL,
     CASE WHEN r.status = 'done' OR r.status LIKE 'done:%' OR r.status = 'proposed' THEN NULL
       WHEN instr(r.status, ':') > 0 THEN json_object('message', substr(r.status, instr(r.status, ':') + 1))
       ELSE json_object('message', r.status) END,
     NULL, NULL, NULL, NULL, r.finished, NULL, NULL, 1
   FROM runs r
   WHERE r.flow = ? AND r.origin != 'test' AND r.finished IS NOT NULL AND r.status != 'running'
     AND NOT EXISTS (SELECT 1 FROM automation_runs a WHERE a.id = r.id)
   ORDER BY r.started
   LIMIT ?`;

/** A run of before of the flow that has not ended yet (one waiting on a question, AU-226). */
const UNFINISHED_SQL = `SELECT 1 FROM runs
   WHERE flow = ? AND origin != 'test' AND (finished IS NULL OR status = 'running') LIMIT 1`;

export function conversionsJournal(db: DatabaseSync): ConversionsJournal {
  let n = 0;
  const atomic = <T>(fn: () => T): T => {
    const name = `conversions_${++n}`;
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
  const rowOf = (r: Record<string, unknown>): FlowConversionRow => ({
    id: r.id as string,
    at: Number(r.at),
    state: r.state as FlowConversionState,
    changed: Number(r.changed),
    versions: JSON.parse(r.versions as string),
    skipped: Number(r.skipped),
    changes: JSON.parse(r.changes as string),
    reasons: JSON.parse(r.reasons as string),
    copied: r.copied === null || r.copied === undefined ? null : Number(r.copied),
  });
  const get = (id: string) => {
    const r = db.prepare("SELECT * FROM flow_conversions WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return r ? rowOf(r) : null;
  };
  const latestFlowVersion = (id: string) =>
    Number(
      (
        db.prepare("SELECT coalesce(max(version), 0) AS v FROM flows WHERE id = ?").get(id) as {
          v: number;
        }
      ).v,
    );
  return {
    flowConversions: () =>
      (
        db.prepare("SELECT * FROM flow_conversions ORDER BY at DESC, id").all() as Record<
          string,
          unknown
        >[]
      ).map(rowOf),
    flowConversion: get,
    adoptFlow: (a) =>
      atomic(() => {
        const was = get(a.id);
        if (was && was.state !== "kept") return false;
        if (db.prepare("SELECT 1 FROM automations WHERE id = ?").get(a.id)) return false;
        if (!a.versions.length) throw new Error(`no version of ${a.id} to adopt`);
        db.prepare(
          `INSERT INTO automations (id, by, created, deleted, published, enabled, schedule, since)
           VALUES (?, ?, ?, 0, ?, ?, ?, ?)`,
        ).run(a.id, a.by, a.created, a.versions.length, a.enabled ? 1 : 0, a.schedule, a.since);
        db.prepare(
          "INSERT INTO automation_drafts (id, rev, name, trigger, doc, device, updated) VALUES (?, 1, ?, ?, ?, ?, ?)",
        ).run(a.id, a.draft.name, a.draft.trigger, a.draft.doc, a.draft.device, a.draft.updated);
        const put = db.prepare(
          `INSERT INTO automation_versions (id, n, doc, hash, at, device, by, names, flow)
           VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        );
        a.versions.forEach((v, i) => {
          put.run(a.id, i + 1, v.doc, v.hash, v.at, v.by, v.names, v.flow);
        });
        db.prepare(
          `INSERT INTO flow_conversions (id, at, state, changed, versions, skipped, changes, reasons, copied)
           VALUES (?, ?, 'converted', ?, ?, ?, ?, '[]', NULL)
           ON CONFLICT (id) DO UPDATE SET at = excluded.at, state = 'converted', changed = excluded.changed,
             versions = excluded.versions, skipped = excluded.skipped, changes = excluded.changes, reasons = '[]',
             copied = NULL`,
        ).run(
          a.id,
          a.at,
          a.at,
          j(a.versions.map((v, i) => ({ n: i + 1, flow: v.flow }))),
          a.skipped,
          j(a.changes),
        );
        return true;
      }),
    keepFlow: (id, at, k) =>
      void db
        .prepare(
          `INSERT INTO flow_conversions (id, at, state, changed, versions, skipped, changes, reasons, copied)
           VALUES (?, ?, 'kept', ?, '[]', ?, ?, ?, NULL)
           ON CONFLICT (id) DO UPDATE SET at = excluded.at, skipped = excluded.skipped, changes = excluded.changes,
             reasons = excluded.reasons
           WHERE flow_conversions.state = 'kept'`,
        )
        .run(id, at, at, k.skipped, j(k.changes), j(k.reasons)),
    revertFlow: (id, at) =>
      atomic(() => {
        const r = db
          .prepare(
            "UPDATE flow_conversions SET state = 'reverted', changed = ? WHERE id = ? AND state = 'converted'",
          )
          .run(at, id);
        if (Number(r.changes) === 0) return false;
        db.prepare("UPDATE automations SET enabled = 0 WHERE id = ?").run(id);
        return true;
      }),
    reconvertFlow: (id, at) =>
      atomic(() => {
        const c = get(id);
        if (!c || c.state !== "reverted") return "no";
        const mapped = Math.max(0, ...c.versions.map((v) => v.flow));
        if (latestFlowVersion(id) !== mapped) return "changed";
        db.prepare(
          "UPDATE flow_conversions SET state = 'converted', changed = ?, copied = NULL WHERE id = ?",
        ).run(at, id);
        // On from now: what the flow ran while it was back is its own, so its hours count from here.
        db.prepare("UPDATE automations SET enabled = 1, since = ? WHERE id = ?").run(at, id);
        return "ok";
      }),
    copyBeforeRuns: (id, limit, at) =>
      atomic(() => {
        const copied = Number(db.prepare(COPY_SQL).run(id, limit).changes);
        // Done only when no run of before is still going: one that waited on a question at the conversion ends on
        // the engine that started it (AU-226) and is copied at a later opening.
        if (copied === 0 && !db.prepare(UNFINISHED_SQL).get(id))
          db.prepare("UPDATE flow_conversions SET copied = ? WHERE id = ?").run(at, id);
        return copied;
      }),
  };
}
