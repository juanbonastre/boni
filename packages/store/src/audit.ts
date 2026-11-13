import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/**
 * The audit (Juan, 2026-10-24): what everyone did and saw, models above all, structured and verifiable. Three
 * tables of the user's store, written only by code, never readable by `readQuery` nor by any tool of a model:
 *
 * - `actions`: every action of anyone (a model call, a tool of the agent, an MCP request, a file read, a page
 *   downloaded, a query, a user's read where the account asks for it), with who did it (`by`), what it touched and
 *   whether it was allowed. Chained: each row's hash covers the previous one's and its own `access` rows.
 * - `access`: per action and entity, what reached the actor: the fields in clear, the fields seen only as their
 *   shape (the planner's handles), the note's text (in clear or as its shape) and attachments. Ids only, never
 *   values: the audit makes no new copy of the data.
 * - `entity_meta`: each entity's system columns kept up to date in the same transaction as the operation or the
 *   access (who made it, who changed it last, every editor, which models saw it and when), so a table of
 *   thousands of rows reads them in one query.
 *
 * The operation log (`ops`) is chained the same way (its own chain): together they say who changed what, who saw
 * what, and that nothing was removed or edited afterwards (`verify`). Nothing is deleted by default.
 */

/** Who did something: `user:<device>`, `model:<role>:<provider>/<model>`, `mcp:<device>`, `agent`, `import`,
 * `connector:<name>`, `extension:<id>`, `system`. Set by code (the server, the agent), never by a model. */
export type By = string;

export interface Seen {
  entity: string;
  type: string;
  version: number;
  /** Field ids that reached the actor in clear. */
  fields: string[];
  /** Field ids it saw only as their shape ("text, 120 characters"). */
  shapes: string[];
  /** The note's text: in clear, only its shape, or not at all. */
  body: "text" | "shape" | null;
  /** Attachments (sha256) it got. */
  files: string[];
}

export interface ActionInput {
  at: number;
  by: By;
  run?: string | null;
  /** What was done: "model.reader", "entities.search", "mcp.read", "file.get", "net.fetch", "sql.read"… */
  tool: string;
  /** What it was done on, without data values: a type, a filter's shape, a host and path, a file's sha256. */
  target?: unknown;
  decision: "allow" | "deny";
  rule?: string | null;
  /** The model call (`model_calls` rowid) this action is, when it is one. */
  call?: number | null;
  /** Counts and the like ("rows": 12), never values. */
  result?: unknown;
  seen?: Seen[];
}

export interface ActionRow extends Required<Omit<ActionInput, "seen">> {
  seq: number;
  hash: string;
}

export interface EntityMeta {
  createdBy: By | null;
  updatedBy: By | null;
  editors: By[];
  viewers: By[];
  seenAt: number | null;
  seenBy: By | null;
}

export interface AccessRow extends Seen {
  action: number;
  at: number;
  by: By;
  tool: string;
  run: string | null;
}

export interface Verification {
  ok: boolean;
  ops: number;
  actions: number;
  /** The first row that does not match its chain (`ops:<seq>` or `actions:<seq>`). */
  broken: string | null;
}

/** How much each part of the store takes, in bytes (Boni advises what could go when it grows). */
export interface Storage {
  types: {
    type: string;
    rows: number;
    bytes: number;
    history: number;
    files: number;
    filesBytes: number;
  }[];
  modelCalls: { rows: number; bytes: number };
  audit: { actions: number; access: number; bytes: number };
  total: number;
}

export interface Audit {
  record(a: ActionInput): number;
  actions(q?: {
    from?: number;
    to?: number;
    by?: string;
    /** Actors whose `by` starts with it ("model:", "mcp:", "user:"). */
    byPrefix?: string;
    run?: string;
    /** Only actions that saw an entity of this type. */
    type?: string;
    before?: number;
    limit?: number;
  }): ActionRow[];
  /** How many actions in [from, to) by actors whose `by` starts with `byPrefix`, of one tool: counted, never read. */
  countActions(q: { from: number; to: number; byPrefix: string; tool: string }): number;
  /** What each action saw, for some actions. */
  accessOf(actions: number[]): Map<number, Seen[]>;
  /** Who saw an entity, newest first. */
  seenBy(entity: string, limit?: number): AccessRow[];
  meta(ids: string[]): Map<string, EntityMeta>;
  /** Counts per UTC day and actor: what was read and what was changed (the «Actividad» charts). */
  activity(from: number, to: number): { day: string; by: By; reads: number; writes: number }[];
  /** The last action's number (0 with none): it changes whenever one is recorded. */
  lastAction(): number;
  /**
   * Per day, actor and type: how many entities were read and how many changed (Boni's «Actividad de Boni»). `dayOf`
   * says which day an instant is in (the account's zone); a UTC day without it.
   */
  activityByType(
    from: number,
    to: number,
    dayOf?: (ms: number) => string,
  ): { day: string; by: By; type: string; reads: number; writes: number }[];
  /**
   * The same counts per quarter of an hour (`q` × 15 minutes, an instant), by actor and type, of the actions after
   * `action` and the operations after `op` only, from `from` on; and the last action's and operation's numbers, to
   * ask from next time. A caller keeps a running sum by adding what came since (task 43: counting thirty days of
   * reads each time held the NAS for seconds).
   */
  activitySince(
    action: number,
    op: number,
    from: number,
  ): {
    action: number;
    op: number;
    rows: { q: number; by: By; type: string; reads: number; writes: number }[];
  };
  /**
   * The same counts per quarter, actor and type, of the instants in [from, to) only: whole quarters from the kept sums
   * (brought up to date with only what came since), a whole UTC day as one row at its first quarter, the parts at
   * either end from the audit (task 108: counting thirty days of reads on every open of «Todas las páginas» held the
   * server).
   */
  activityIn(
    from: number,
    to: number,
  ): { q: number; by: By; type: string; reads: number; writes: number }[];
  /** Per type and actor: how many entities were read and how many changed. */
  byType(from: number, to: number): { type: string; by: By; reads: number; writes: number }[];
  /** Changes in a period by kind (create, update, delete, restore) and how many undid another. */
  changes(from: number, to: number): { kinds: Record<string, number>; undone: number };
  verify(): Verification;
  /**
   * Brings the kept storage sums up to date (migration 23) a slice at a time, for about `ms` of work at most;
   * true once nothing is left to count. A server calls it between turns of its event loop (task 107).
   */
  storageCatchUp(ms?: number): boolean;
  /** The storage figures: the kept sums brought up to date (all at once: a server catches up first), plus the rest. */
  storage(): Storage;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
/** A quarter of an hour, in ms: the step of every time zone's offset. */
const QUARTER = 15 * 60_000;
/** Quarters in a UTC day. */
const PER_DAY = 96;
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Counts per quarter folded into days by `dayOf`, asked once per quarter (task 43: asked per row, a zone's day for
 * each of 222,000 rows took half the time), sorted by day, actor and type.
 */
export function foldDays(
  rows: { q: number; by: By; type: string; reads: number; writes: number }[],
  dayOf: (ms: number) => string,
): { day: string; by: By; type: string; reads: number; writes: number }[] {
  const days = new Map<number, string>();
  const out = new Map<
    string,
    { day: string; by: By; type: string; reads: number; writes: number }
  >();
  for (const r of rows) {
    let day = days.get(r.q);
    if (day === undefined) {
      day = dayOf(r.q * QUARTER);
      days.set(r.q, day);
    }
    const key = `${day}|${r.by}|${r.type}`;
    const o = out.get(key) ?? { day, by: r.by, type: r.type, reads: 0, writes: 0 };
    o.reads += r.reads;
    o.writes += r.writes;
    out.set(key, o);
  }
  return [...out.values()].sort(
    (a, b) =>
      a.day.localeCompare(b.day) || a.by.localeCompare(b.by) || a.type.localeCompare(b.type),
  );
}
const j = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));
const p = (s: unknown) => (typeof s === "string" ? JSON.parse(s) : null);

/** The default `by` of an operation from its actor and device. */
export const byOf = (actor: string, device?: string | null): By =>
  actor === "user" ? `user:${device ?? "?"}` : actor;

/** The text an operation's hash covers, from its row as stored. */
export function opHashInput(prev: string, r: Record<string, unknown>): string {
  return `${prev}\n${JSON.stringify([
    r.seq,
    r.at,
    r.actor,
    r.device ?? null,
    r.run ?? null,
    r.by ?? null,
    r.action ?? null,
    r.kind,
    r.target,
    r.before ?? null,
    r.after ?? null,
    r.label ?? null,
    r.undoes ?? null,
  ])}`;
}
const actionHashInput = (
  prev: string,
  r: Record<string, unknown>,
  access: Record<string, unknown>[],
) =>
  `${prev}\n${JSON.stringify([
    r.seq,
    r.at,
    r.by,
    r.run ?? null,
    r.tool,
    r.target ?? null,
    r.decision,
    r.rule ?? null,
    r.call ?? null,
    r.result ?? null,
    access.map((a) => [a.entity, a.type, a.version, a.fields, a.shapes, a.body, a.files]),
  ])}`;

const addTo = (list: string, who: By): string => {
  const a = (p(list) as By[] | null) ?? [];
  if (a.includes(who)) return list;
  a.push(who);
  return JSON.stringify(a);
};

/**
 * The parts of the audit the store's writes use: chaining an operation and keeping its entity's system columns.
 * Called inside the store's transaction.
 */
export function auditWriter(db: DatabaseSync) {
  const lastOpHash = db.prepare(
    "SELECT hash FROM ops WHERE hash IS NOT NULL ORDER BY seq DESC LIMIT 1",
  );
  const opRow = db.prepare("SELECT * FROM ops WHERE seq = ?");
  const setOpHash = db.prepare("UPDATE ops SET hash = ? WHERE seq = ?");
  const metaRow = db.prepare("SELECT editors, created_by FROM entity_meta WHERE entity = ?");
  const putMeta = db.prepare(
    `INSERT INTO entity_meta (entity, created_by, updated_by, editors) VALUES (?, ?, ?, ?)
     ON CONFLICT(entity) DO UPDATE SET updated_by = excluded.updated_by, editors = excluded.editors,
       created_by = coalesce(entity_meta.created_by, excluded.created_by)`,
  );
  return {
    /** Chains operation `seq` (already inserted) and, for an entity's operation, updates its system columns. */
    op(seq: number, kind: string, target: string, by: By): void {
      const prev = (lastOpHash.get() as { hash: string } | undefined)?.hash ?? "";
      const r = opRow.get(seq) as Record<string, unknown>;
      setOpHash.run(sha(opHashInput(prev, r)), seq);
      if (kind === "schema") return;
      const m = metaRow.get(target) as { editors: string; created_by: string | null } | undefined;
      putMeta.run(
        target,
        kind === "create" ? by : (m?.created_by ?? null),
        by,
        addTo(m?.editors ?? "[]", by),
      );
    },
  };
}

export function openAudit(db: DatabaseSync, tx: <T>(fn: () => T) => T): Audit {
  const lastHash = db.prepare("SELECT hash FROM actions ORDER BY seq DESC LIMIT 1");
  const insertAction = db.prepare(
    "INSERT INTO actions (at, by, run, tool, target, decision, rule, call, result, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '')",
  );
  const insertAccess = db.prepare(
    "INSERT INTO access (action, entity, type, version, fields, shapes, body, files) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const setHash = db.prepare("UPDATE actions SET hash = ? WHERE seq = ?");
  const seenMeta = db.prepare(
    `INSERT INTO entity_meta (entity, viewers, seen_at, seen_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(entity) DO UPDATE SET viewers = excluded.viewers, seen_at = excluded.seen_at, seen_by = excluded.seen_by`,
  );
  const viewersOf = db.prepare("SELECT viewers FROM entity_meta WHERE entity = ?");
  // The activity per quarter as kept (migration 14), and up to which action and operation it was counted.
  const addQuarter = db.prepare(
    `INSERT INTO activity_q (q, by, type, reads, writes) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(q, by, type) DO UPDATE SET reads = reads + excluded.reads, writes = writes + excluded.writes`,
  );
  const quartersFrom = db.prepare(
    "SELECT q, by, type, reads, writes FROM activity_q WHERE q >= ? ORDER BY q, by, type",
  );
  const cursorOf = db.prepare("SELECT action, op FROM activity_cursor WHERE id = 1");
  const setCursor = db.prepare(
    `INSERT INTO activity_cursor (id, action, op) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET action = excluded.action, op = excluded.op`,
  );
  const accessRows = (seq: number) =>
    db.prepare("SELECT * FROM access WHERE action = ? ORDER BY entity").all(seq) as Record<
      string,
      unknown
    >[];
  const seenOf = (a: Record<string, unknown>): Seen => ({
    entity: a.entity as string,
    type: a.type as string,
    version: a.version as number,
    fields: p(a.fields) ?? [],
    shapes: p(a.shapes) ?? [],
    body: (a.body as Seen["body"]) ?? null,
    files: p(a.files) ?? [],
  });
  const actionOf = (r: Record<string, unknown>): ActionRow => ({
    seq: r.seq as number,
    at: r.at as number,
    by: r.by as string,
    run: (r.run as string | null) ?? null,
    tool: r.tool as string,
    target: p(r.target),
    decision: r.decision as ActionRow["decision"],
    rule: (r.rule as string | null) ?? null,
    call: (r.call as number | null) ?? null,
    result: p(r.result),
    hash: r.hash as string,
  });

  // The storage figures as kept (migration 23): each part's sum up to the last row it counted, and the history per
  // record. A slice is a range of the part's own key, so it reads only its rows (task 107: summing the tables whole
  // read the history, the audit and every model call, 40 s with the NAS's server held).
  const sumOf = db.prepare("SELECT upto, rows, bytes FROM storage_sums WHERE part = ?");
  const addSum = db.prepare(
    `INSERT INTO storage_sums (part, upto, rows, bytes) VALUES (?, ?, ?, ?)
     ON CONFLICT(part) DO UPDATE SET upto = excluded.upto, rows = rows + excluded.rows, bytes = bytes + excluded.bytes`,
  );
  const addHistory = db.prepare(
    `INSERT INTO storage_history (target, bytes) VALUES (?, ?)
     ON CONFLICT(target) DO UPDATE SET bytes = bytes + excluded.bytes`,
  );
  const opsSlice = db.prepare(
    `SELECT target, count(*) AS n,
       coalesce(sum(coalesce(octet_length(before), 0) + coalesce(octet_length(after), 0)), 0) AS b
     FROM ops WHERE seq > ? AND seq <= ? GROUP BY target`,
  );
  const lastAction = db.prepare("SELECT coalesce(max(seq), 0) AS n FROM actions");
  const summed = (sql: string) => {
    const q = db.prepare(sql);
    return (lo: number, hi: number) => {
      const r = q.get(lo, hi) as { n: number; b: number };
      return { rows: Number(r.n), bytes: Number(r.b) };
    };
  };
  // Sizes in bytes by `octet_length`, which SQLite answers from each row's header without reading the text (task 43).
  // The steps are sized so one slice stays in milliseconds with the disk cold: a call is tens of KB, an action's
  // reads may be thousands of rows.
  const parts: {
    part: string;
    step: number;
    last: () => number;
    count: (lo: number, hi: number) => { rows: number; bytes: number };
  }[] = [
    {
      part: "ops",
      step: 1000,
      last: () =>
        Number((db.prepare("SELECT coalesce(max(seq), 0) AS n FROM ops").get() as { n: number }).n),
      count: (lo, hi) => {
        let rows = 0;
        for (const r of opsSlice.all(lo, hi) as { target: string; n: number; b: number }[]) {
          rows += Number(r.n);
          addHistory.run(r.target, Number(r.b));
        }
        return { rows, bytes: 0 };
      },
    },
    {
      part: "actions",
      step: 2000,
      last: () => Number((lastAction.get() as { n: number }).n),
      count: summed(
        `SELECT count(*) AS n, coalesce(sum(octet_length(by) + octet_length(tool) + coalesce(octet_length(target), 0) + 64), 0) AS b
         FROM actions WHERE seq > ? AND seq <= ?`,
      ),
    },
    {
      // By action: an action's reads are written with it, in its transaction.
      part: "access",
      step: 100,
      last: () => Number((lastAction.get() as { n: number }).n),
      count: summed(
        `SELECT count(*) AS n, coalesce(sum(octet_length(entity) + octet_length(fields) + octet_length(shapes) + 48), 0) AS b
         FROM access WHERE action > ? AND action <= ?`,
      ),
    },
    {
      // By rowid: the table has no key of its own, and with nothing ever deleted its rowids only grow.
      part: "model_calls",
      step: 100,
      last: () =>
        Number(
          (
            db.prepare("SELECT coalesce(max(rowid), 0) AS n FROM model_calls").get() as {
              n: number;
            }
          ).n,
        ),
      count: summed(
        `SELECT count(*) AS n, coalesce(sum(coalesce(octet_length(request), 0) + coalesce(octet_length(response), 0)), 0) AS b
         FROM model_calls WHERE rowid > ? AND rowid <= ?`,
      ),
    },
  ];
  const kept = (part: string) =>
    (sumOf.get(part) as { upto: number; rows: number; bytes: number } | undefined) ?? {
      upto: 0,
      rows: 0,
      bytes: 0,
    };
  const storageCatchUp = (ms = 25): boolean => {
    const t0 = performance.now();
    for (const p of parts) {
      const last = p.last();
      for (;;) {
        // The cursor is read inside the transaction: another connection catching up too never counts a row twice.
        const done = tx(() => {
          const upto = Number(kept(p.part).upto);
          if (upto >= last) return true;
          const hi = Math.min(last, upto + p.step);
          const c = p.count(upto, hi);
          addSum.run(p.part, hi, c.rows, c.bytes);
          return hi >= last;
        });
        if (done) break;
        if (performance.now() - t0 >= ms) return false;
      }
    }
    return true;
  };

  /** Reads and writes per quarter, actor and type in [from, to), of the actions and operations after the numbers given. */
  const activityRows = (
    from: number,
    to: number,
    afterAction: number,
    afterOp: number,
    upToAction = Number.MAX_SAFE_INTEGER,
    upToOp = Number.MAX_SAFE_INTEGER,
  ) => {
    const quarter = (col: string) => `(${col} / ${QUARTER})`;
    // With no numbers to bound, only the instants: so a short period is read by its index on `at` (task 108).
    const all =
      afterAction === 0 &&
      afterOp === 0 &&
      upToAction === Number.MAX_SAFE_INTEGER &&
      upToOp === Number.MAX_SAFE_INTEGER;
    const after = (col: string) => (all ? "" : `${col} > ? AND ${col} <= ? AND `);
    const rows: { q: number; by: By; type: string; reads: number; writes: number }[] = [];
    for (const r of db
      .prepare(
        `SELECT ${quarter("x.at")} AS q, x.by, a.type, count(*) AS n FROM access a JOIN actions x ON x.seq = a.action
         WHERE ${after("x.seq")}x.at >= ? AND x.at < ? AND x.decision = 'allow' GROUP BY q, x.by, a.type`,
      )
      .all(...(all ? [] : [afterAction, upToAction]), from, to))
      rows.push({
        q: Number(r.q),
        by: r.by as string,
        type: r.type as string,
        reads: Number(r.n),
        writes: 0,
      });
    for (const r of db
      .prepare(
        `SELECT ${quarter("o.at")} AS q, e.type,
           coalesce(o.by, CASE o.actor WHEN 'user' THEN 'user:' || coalesce(o.device, '?') ELSE o.actor END) AS who,
           count(*) AS n FROM ops o JOIN entities e ON e.id = o.target
         WHERE ${after("o.seq")}o.at >= ? AND o.at < ? AND o.kind != 'schema' GROUP BY q, e.type, who`,
      )
      .all(...(all ? [] : [afterOp, upToOp]), from, to))
      rows.push({
        q: Number(r.q),
        by: r.who as string,
        type: r.type as string,
        reads: 0,
        writes: Number(r.n),
      });
    return rows;
  };

  /**
   * The kept activity (migration 14) brought up to the last action and operation: what came after its cursor goes in
   * (everything, once, when it is new: the old first pass for the last time), so nothing counts the whole audit again.
   */
  const activityCaughtUp = () => {
    const lastAction = Number(
      (db.prepare("SELECT coalesce(max(seq), 0) AS n FROM actions").get() as { n: number }).n,
    );
    const lastOp = Number(
      (db.prepare("SELECT coalesce(max(seq), 0) AS n FROM ops").get() as { n: number }).n,
    );
    const kept = (cursorOf.get() as { action: number; op: number } | undefined) ?? {
      action: 0,
      op: 0,
    };
    const fresh =
      kept.action < lastAction || kept.op < lastOp
        ? activityRows(0, Number.MAX_SAFE_INTEGER, kept.action, kept.op, lastAction, lastOp)
        : [];
    for (const r of fresh) {
      addQuarter.run(r.q, r.by, r.type, r.reads, r.writes);
      addDay.run(Math.floor(r.q / PER_DAY), r.by, r.type, r.reads, r.writes);
    }
    if (fresh.length) setCursor.run(lastAction, lastOp);
    return { lastAction, lastOp, kept, fresh };
  };
  const addDay = db.prepare(
    `INSERT INTO activity_d (day, by, type, reads, writes) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(day, by, type) DO UPDATE SET reads = reads + excluded.reads, writes = writes + excluded.writes`,
  );
  type Kept = { q: number; by: By; type: string; reads: number; writes: number };
  const keptOf = (r: Record<string, unknown>, q: number): Kept => ({
    q,
    by: r.by as string,
    type: r.type as string,
    reads: Number(r.reads),
    writes: Number(r.writes),
  });
  const quartersIn = db.prepare(
    "SELECT q, by, type, reads, writes FROM activity_q WHERE q >= ? AND q < ?",
  );
  const daysIn = db.prepare(
    "SELECT day, by, type, reads, writes FROM activity_d WHERE day >= ? AND day < ?",
  );
  /** The kept quarters in [a, b), the whole UTC days among them from their day's sum (as their first quarter). */
  const keptIn = (a: number, b: number): Kept[] => {
    const quarters = (x: number, y: number) =>
      x < y
        ? (quartersIn.all(x, y) as Record<string, unknown>[]).map((r) => keptOf(r, Number(r.q)))
        : [];
    const da = Math.ceil(a / PER_DAY);
    const dz = Math.floor(b / PER_DAY);
    if (da >= dz) return quarters(a, b);
    return [
      ...quarters(a, da * PER_DAY),
      ...(daysIn.all(da, dz) as Record<string, unknown>[]).map((r) =>
        keptOf(r, Number(r.day) * PER_DAY),
      ),
      ...quarters(dz * PER_DAY, b),
    ];
  };

  return {
    record: (a) =>
      tx(() => {
        const prev = (lastHash.get() as { hash: string } | undefined)?.hash ?? "";
        const seq = Number(
          insertAction.run(
            a.at,
            a.by,
            a.run ?? null,
            a.tool,
            j(a.target),
            a.decision,
            a.rule ?? null,
            a.call ?? null,
            j(a.result),
          ).lastInsertRowid,
        );
        // One row per entity: what reached the actor of it, merged if a step saw it twice.
        const merged = new Map<string, Seen>();
        for (const s of a.seen ?? []) {
          const m = merged.get(s.entity);
          if (!m)
            merged.set(s.entity, {
              ...s,
              fields: [...new Set(s.fields)],
              shapes: [...new Set(s.shapes)],
            });
          else {
            m.fields = [...new Set([...m.fields, ...s.fields])];
            m.shapes = [...new Set([...m.shapes, ...s.shapes])].filter(
              (f) => !m.fields.includes(f),
            );
            m.body = m.body === "text" || s.body === "text" ? "text" : (m.body ?? s.body);
            m.files = [...new Set([...m.files, ...s.files])];
            m.version = Math.max(m.version, s.version);
          }
        }
        for (const s of merged.values()) {
          insertAccess.run(
            seq,
            s.entity,
            s.type,
            s.version,
            JSON.stringify(s.fields.sort()),
            JSON.stringify(s.shapes.sort()),
            s.body,
            JSON.stringify(s.files.sort()),
          );
          if (a.decision === "allow") {
            const v = (viewersOf.get(s.entity) as { viewers: string } | undefined)?.viewers ?? "[]";
            seenMeta.run(s.entity, addTo(v, a.by), a.at, a.by);
          }
        }
        const row = db.prepare("SELECT * FROM actions WHERE seq = ?").get(seq) as Record<
          string,
          unknown
        >;
        setHash.run(sha(actionHashInput(prev, row, accessRows(seq))), seq);
        return seq;
      }),
    actions: (q = {}) => {
      const where: string[] = [];
      const args: (string | number)[] = [];
      const add = (sql: string, ...v: (string | number)[]) => {
        where.push(sql);
        args.push(...v);
      };
      if (q.from !== undefined) add("at >= ?", q.from);
      if (q.to !== undefined) add("at < ?", q.to);
      if (q.by) add("by = ?", q.by);
      if (q.byPrefix) add("substr(by, 1, ?) = ?", q.byPrefix.length, q.byPrefix);
      if (q.run) add("run = ?", q.run);
      if (q.type)
        add("EXISTS (SELECT 1 FROM access x WHERE x.action = actions.seq AND x.type = ?)", q.type);
      if (q.before !== undefined) add("seq < ?", q.before);
      return db
        .prepare(
          `SELECT * FROM actions${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY seq DESC LIMIT ?`,
        )
        .all(...args, Math.min(q.limit ?? 100, 1000))
        .map(actionOf);
    },
    accessOf: (seqs) => {
      const out = new Map<number, Seen[]>();
      for (const s of seqs) out.set(s, accessRows(s).map(seenOf));
      return out;
    },
    seenBy: (entity, limit = 100) =>
      db
        .prepare(
          `SELECT a.*, x.at, x.by, x.tool, x.run FROM access a JOIN actions x ON x.seq = a.action
           WHERE a.entity = ? AND x.decision = 'allow' ORDER BY a.action DESC LIMIT ?`,
        )
        .all(entity, limit)
        .map((r) => ({
          ...seenOf(r),
          action: r.action as number,
          at: r.at as number,
          by: r.by as string,
          tool: r.tool as string,
          run: (r.run as string | null) ?? null,
        })),
    meta: (ids) => {
      const out = new Map<string, EntityMeta>();
      const q = db.prepare("SELECT * FROM entity_meta WHERE entity = ?");
      for (const id of ids) {
        const r = q.get(id) as Record<string, unknown> | undefined;
        out.set(id, {
          createdBy: (r?.created_by as string | null) ?? null,
          updatedBy: (r?.updated_by as string | null) ?? null,
          editors: p(r?.editors) ?? [],
          viewers: p(r?.viewers) ?? [],
          seenAt: (r?.seen_at as number | null) ?? null,
          seenBy: (r?.seen_by as string | null) ?? null,
        });
      }
      return out;
    },
    activity: (from, to) => {
      const day = (col: string) => `strftime('%Y-%m-%d', ${col} / 1000, 'unixepoch')`;
      const rows = new Map<string, { day: string; by: By; reads: number; writes: number }>();
      const add = (d: string, by: By, k: "reads" | "writes", n: number) => {
        const key = `${d}|${by}`;
        const r = rows.get(key) ?? { day: d, by, reads: 0, writes: 0 };
        r[k] += n;
        rows.set(key, r);
      };
      for (const r of db
        .prepare(
          `SELECT ${day("x.at")} AS day, x.by, count(*) AS n FROM access a JOIN actions x ON x.seq = a.action
           WHERE x.at >= ? AND x.at < ? AND x.decision = 'allow' GROUP BY day, x.by`,
        )
        .all(from, to))
        add(r.day as string, r.by as string, "reads", Number(r.n));
      for (const r of db
        .prepare(
          `SELECT ${day("at")} AS day, coalesce(by, CASE actor WHEN 'user' THEN 'user:' || coalesce(device, '?') ELSE actor END) AS who,
             count(*) AS n FROM ops WHERE at >= ? AND at < ? AND kind != 'schema' GROUP BY day, who`,
        )
        .all(from, to))
        add(r.day as string, r.who as string, "writes", Number(r.n));
      return [...rows.values()].sort(
        (a, b) => a.day.localeCompare(b.day) || a.by.localeCompare(b.by),
      );
    },
    lastAction: () =>
      (db.prepare("SELECT coalesce(max(seq), 0) AS n FROM actions").get() as { n: number }).n,
    activityByType: (from, to, dayOf = utcDay) => {
      // Counted per quarter of an hour (every zone's offset is a whole number of them), then each quarter to its day
      // in the account's zone: an action at 00:30 in Madrid on the 1st is the 1st's, not the 31st's (UTC).
      return foldDays(activityRows(from, to, 0, 0), dayOf);
    },
    activitySince: (action, op, from) =>
      tx(() => {
        const { lastAction, lastOp, kept, fresh } = activityCaughtUp();
        const first = Math.floor(from / QUARTER);
        // The caller: from the start, the sum as kept; from where it was, only what came since.
        const rows =
          action === 0 && op === 0
            ? (
                quartersFrom.all(first) as {
                  q: number;
                  by: By;
                  type: string;
                  reads: number;
                  writes: number;
                }[]
              ).map((r) => ({
                q: Number(r.q),
                by: r.by,
                type: r.type,
                reads: Number(r.reads),
                writes: Number(r.writes),
              }))
            : action === kept.action && op === kept.op
              ? fresh.filter((r) => r.q >= first)
              : activityRows(from, Number.MAX_SAFE_INTEGER, action, op, lastAction, lastOp);
        return { action: lastAction, op: lastOp, rows };
      }),
    countActions: (q) =>
      Number(
        (
          db
            .prepare(
              "SELECT count(*) AS n FROM actions WHERE at >= ? AND at < ? AND substr(by, 1, ?) = ? AND tool = ?",
            )
            .get(q.from, q.to, q.byPrefix.length, q.byPrefix, q.tool) as { n: number }
        ).n,
      ),
    activityIn: (from, to) =>
      tx(() => {
        activityCaughtUp();
        // Whole quarters (and whole days) from the kept sums; the parts of a quarter at either end counted from the
        // audit, by its index on the instant (fifteen minutes at most each).
        const a = Math.ceil(from / QUARTER);
        const b = Math.floor(to / QUARTER);
        if (a >= b) return activityRows(from, to, 0, 0);
        return [
          ...activityRows(from, a * QUARTER, 0, 0),
          ...keptIn(a, b),
          ...activityRows(b * QUARTER, to, 0, 0),
        ];
      }),
    byType: (from, to) => {
      const rows = new Map<string, { type: string; by: By; reads: number; writes: number }>();
      const add = (type: string, by: By, k: "reads" | "writes", n: number) => {
        const key = `${type}|${by}`;
        const r = rows.get(key) ?? { type, by, reads: 0, writes: 0 };
        r[k] += n;
        rows.set(key, r);
      };
      for (const r of db
        .prepare(
          `SELECT a.type, x.by, count(*) AS n FROM access a JOIN actions x ON x.seq = a.action
           WHERE x.at >= ? AND x.at < ? AND x.decision = 'allow' GROUP BY a.type, x.by`,
        )
        .all(from, to))
        add(r.type as string, r.by as string, "reads", Number(r.n));
      for (const r of db
        .prepare(
          `SELECT e.type, coalesce(o.by, CASE o.actor WHEN 'user' THEN 'user:' || coalesce(o.device, '?') ELSE o.actor END) AS who,
             count(*) AS n FROM ops o JOIN entities e ON e.id = o.target
           WHERE o.at >= ? AND o.at < ? AND o.kind != 'schema' GROUP BY e.type, who`,
        )
        .all(from, to))
        add(r.type as string, r.who as string, "writes", Number(r.n));
      return [...rows.values()];
    },
    changes: (from, to) => {
      const kinds: Record<string, number> = {};
      let undone = 0;
      for (const r of db
        .prepare(
          "SELECT kind, count(*) AS n, sum(undoes IS NOT NULL) AS u FROM ops WHERE at >= ? AND at < ? AND kind != 'schema' GROUP BY kind",
        )
        .all(from, to)) {
        kinds[r.kind as string] = Number(r.n);
        undone += Number(r.u);
      }
      return { kinds, undone };
    },
    verify: () => {
      let prev = "";
      let ops = 0;
      // Operations from before the chain (migration 10 chained them all, so none is left without a hash).
      for (const r of db.prepare("SELECT * FROM ops ORDER BY seq").iterate() as Iterable<
        Record<string, unknown>
      >) {
        const h = sha(opHashInput(prev, r));
        if (r.hash !== h) return { ok: false, ops, actions: 0, broken: `ops:${r.seq}` };
        prev = h;
        ops++;
      }
      prev = "";
      let actions = 0;
      for (const r of db.prepare("SELECT * FROM actions ORDER BY seq").iterate() as Iterable<
        Record<string, unknown>
      >) {
        const h = sha(actionHashInput(prev, r, accessRows(r.seq as number)));
        if (r.hash !== h) return { ok: false, ops, actions, broken: `actions:${r.seq}` };
        prev = h;
        actions++;
      }
      return { ok: true, ops, actions, broken: null };
    },
    storageCatchUp,
    storage: () => {
      storageCatchUp(Number.POSITIVE_INFINITY);
      // The history of each collection: its records' kept sums, by the collection each record is in now.
      const history = new Map(
        (
          db
            .prepare(
              `SELECT x.type AS type, coalesce(sum(h.bytes), 0) AS b
               FROM storage_history h JOIN entities x ON x.id = h.target GROUP BY x.type`,
            )
            .all() as { type: string; b: number }[]
        ).map((r) => [r.type, Number(r.b)]),
      );
      const types = db
        .prepare(
          `SELECT type, count(*) AS rows, sum(octet_length(vals) + coalesce(octet_length(body), 0)) AS bytes
           FROM entities WHERE deleted IS NULL GROUP BY type`,
        )
        .all()
        .map((r) => ({
          type: r.type as string,
          rows: Number(r.rows),
          bytes: Number(r.bytes),
          history: history.get(r.type as string) ?? 0,
          files: 0,
          filesBytes: 0,
        }));
      const mc = kept("model_calls");
      const actions = kept("actions");
      const access = kept("access");
      const audit = {
        actions: Number(actions.rows),
        access: Number(access.rows),
        bytes: Number(actions.bytes) + Number(access.bytes),
      };
      const modelCalls = { rows: Number(mc.rows), bytes: Number(mc.bytes) };
      const files = Number(
        (db.prepare("SELECT coalesce(sum(size), 0) AS s FROM files").get() as { s: number }).s,
      );
      const total =
        types.reduce((s, t) => s + t.bytes + t.history, 0) + modelCalls.bytes + audit.bytes + files;
      return { types, modelCalls, audit, total };
    },
  };
}

/**
 * Migration 10's work in code: chains every existing operation (in order, one row in memory at a time) and fills
 * each entity's system columns from its history.
 */
export function chainExisting(db: DatabaseSync): void {
  const set = db.prepare("UPDATE ops SET hash = ? WHERE seq = ?");
  const meta = new Map<string, { created: By | null; updated: By; editors: By[] }>();
  let prev = "";
  for (const r of db.prepare("SELECT * FROM ops ORDER BY seq").iterate() as Iterable<
    Record<string, unknown>
  >) {
    const h = sha(opHashInput(prev, r));
    set.run(h, r.seq as number);
    prev = h;
    if (r.kind === "schema") continue;
    const by = byOf(r.actor as string, r.device as string | null);
    const m = meta.get(r.target as string) ?? { created: null, updated: by, editors: [] };
    if (r.kind === "create" && !m.created) m.created = by;
    m.updated = by;
    if (!m.editors.includes(by)) m.editors.push(by);
    meta.set(r.target as string, m);
  }
  const put = db.prepare(
    "INSERT INTO entity_meta (entity, created_by, updated_by, editors) VALUES (?, ?, ?, ?)",
  );
  for (const [id, m] of meta) put.run(id, m.created, m.updated, JSON.stringify(m.editors));
}
