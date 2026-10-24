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
  /** What each action saw, for some actions. */
  accessOf(actions: number[]): Map<number, Seen[]>;
  /** Who saw an entity, newest first. */
  seenBy(entity: string, limit?: number): AccessRow[];
  meta(ids: string[]): Map<string, EntityMeta>;
  /** Counts per UTC day and actor: what was read and what was changed (the «Actividad» charts). */
  activity(from: number, to: number): { day: string; by: By; reads: number; writes: number }[];
  /** Per type and actor: how many entities were read and how many changed. */
  byType(from: number, to: number): { type: string; by: By; reads: number; writes: number }[];
  /** Changes in a period by kind (create, update, delete, restore) and how many undid another. */
  changes(from: number, to: number): { kinds: Record<string, number>; undone: number };
  verify(): Verification;
  storage(): Storage;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
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
    "INSERT OR REPLACE INTO access (action, entity, type, version, fields, shapes, body, files) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const setHash = db.prepare("UPDATE actions SET hash = ? WHERE seq = ?");
  const seenMeta = db.prepare(
    `INSERT INTO entity_meta (entity, viewers, seen_at, seen_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(entity) DO UPDATE SET viewers = excluded.viewers, seen_at = excluded.seen_at, seen_by = excluded.seen_by`,
  );
  const viewersOf = db.prepare("SELECT viewers FROM entity_meta WHERE entity = ?");
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
    storage: () => {
      const types = db
        .prepare(
          `SELECT e.type, count(*) AS rows, sum(length(e.vals) + coalesce(length(e.body), 0)) AS bytes,
             (SELECT coalesce(sum(coalesce(length(o.before), 0) + coalesce(length(o.after), 0)), 0)
                FROM ops o JOIN entities x ON x.id = o.target WHERE x.type = e.type) AS history
           FROM entities e WHERE e.deleted IS NULL GROUP BY e.type`,
        )
        .all()
        .map((r) => ({
          type: r.type as string,
          rows: Number(r.rows),
          bytes: Number(r.bytes),
          history: Number(r.history),
          files: 0,
          filesBytes: 0,
        }));
      const mc = db
        .prepare(
          "SELECT count(*) AS n, coalesce(sum(coalesce(length(request), 0) + coalesce(length(response), 0)), 0) AS b FROM model_calls",
        )
        .get() as { n: number; b: number };
      const au = db
        .prepare(
          `SELECT (SELECT count(*) FROM actions) AS a, (SELECT count(*) FROM access) AS x,
             (SELECT coalesce(sum(length(by) + length(tool) + coalesce(length(target), 0) + 64), 0) FROM actions)
             + (SELECT coalesce(sum(length(entity) + length(fields) + length(shapes) + 48), 0) FROM access) AS b`,
        )
        .get() as { a: number; x: number; b: number };
      const files = Number(
        (db.prepare("SELECT coalesce(sum(size), 0) AS s FROM files").get() as { s: number }).s,
      );
      const total =
        types.reduce((s, t) => s + t.bytes + t.history, 0) + Number(mc.b) + Number(au.b) + files;
      return {
        types,
        modelCalls: { rows: Number(mc.n), bytes: Number(mc.b) },
        audit: { actions: Number(au.a), access: Number(au.x), bytes: Number(au.b) },
        total,
      };
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
