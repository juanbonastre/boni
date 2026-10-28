/**
 * The audit as the server gives it (`/api/data/audit/*`, apps/server/src/audit.ts): who did and saw what, a row's
 * history, storage, and the notes by path. Parsed defensively like every answer: ids and numbers only, names in
 * their own maps, text only as text.
 */

export interface AuditSeen {
  entity: string;
  type: string;
  version: number;
  fields: string[];
  shapes: string[];
  body: "text" | "shape" | null;
  files: string[];
}
export interface AuditAction {
  seq: number;
  at: number;
  by: string;
  run: string | null;
  tool: string;
  target: Record<string, string> | null;
  decision: "allow" | "deny";
  rule: string | null;
  call: number | null;
  result: Record<string, unknown> | null;
  seen: AuditSeen[];
  wrote: { kind: string; target: string }[];
}
export interface AuditNames {
  types: Record<string, string>;
  fields: Record<string, string>;
  titles: Record<string, string>;
}
export interface AuditTotals {
  reads: number;
  writes: number;
  kinds: Record<string, number>;
  undone: number;
  proposals: number;
  accepted: number;
  requests: number;
  readings: number;
}
export interface AuditSummary {
  from: number;
  to: number;
  activity: { day: string; by: string; reads: number; writes: number }[];
  byType: { type: string; name: string; by: string; reads: number; writes: number }[];
  totals: AuditTotals;
}
export interface AuditDetail {
  action: AuditAction;
  names: AuditNames;
  /** For a model call: what was sent and what the model answered (its own text). */
  call: { role: string; model: string; request: unknown; response: unknown } | null;
  ops: { seq: number; at: number; kind: string; target: string; by: string }[];
}
export interface SystemColumns {
  created: number;
  updated: number;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  editors: string[];
  viewers: string[];
  seenAt: number | null;
  origin: string | null;
  size: number;
}
export interface RowHistory {
  columns: SystemColumns | null;
  seenBy: (AuditSeen & { action: number; at: number; by: string; tool: string })[];
  changes: { seq: number; at: number; kind: string; by: string; fields: string[]; body: boolean }[];
  blame: { text: string; by: string; at: number; seq: number }[];
  names: AuditNames;
}
export interface Storage {
  types: { type: string; name: string; rows: number; bytes: number; history: number }[];
  modelCalls: { rows: number; bytes: number };
  audit: { actions: number; access: number; bytes: number };
  total: number;
  advice: { code: string; bytes: number; type?: string }[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : "");
const strs = (v: unknown, n = 200) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, n) : [];
const arr = (v: unknown) => (Array.isArray(v) ? v.filter(isObj) : []);
const map = (v: unknown): Record<string, string> =>
  isObj(v)
    ? Object.fromEntries(
        Object.entries(v).flatMap(([k, x]) =>
          typeof x === "string" ? [[k, x.slice(0, 300)]] : [],
        ),
      )
    : {};

export const parseSeen = (s: Record<string, unknown>): AuditSeen => ({
  entity: str(s.entity, 80),
  type: str(s.type, 80),
  version: num(s.version),
  fields: strs(s.fields),
  shapes: strs(s.shapes),
  body: s.body === "text" || s.body === "shape" ? s.body : null,
  files: strs(s.files),
});
export const parseNames = (v: unknown): AuditNames => ({
  types: map(isObj(v) ? v.types : null),
  fields: map(isObj(v) ? v.fields : null),
  titles: map(isObj(v) ? v.titles : null),
});
export const parseAction = (a: Record<string, unknown>): AuditAction => ({
  seq: num(a.seq),
  at: num(a.at),
  by: str(a.by, 200),
  run: typeof a.run === "string" ? a.run.slice(0, 80) : null,
  tool: str(a.tool, 80),
  target: isObj(a.target) ? map(a.target) : null,
  decision: a.decision === "deny" ? "deny" : "allow",
  rule: typeof a.rule === "string" ? a.rule.slice(0, 80) : null,
  call: typeof a.call === "number" ? a.call : null,
  result: isObj(a.result) ? a.result : null,
  seen: arr(a.seen).slice(0, 500).map(parseSeen),
  wrote: arr(a.wrote)
    .slice(0, 200)
    .map((w) => ({ kind: str(w.kind, 20), target: str(w.target, 80) })),
});
export function parseSummary(b: unknown): AuditSummary {
  const o = isObj(b) ? b : {};
  const t = isObj(o.totals) ? o.totals : {};
  return {
    from: num(o.from),
    to: num(o.to),
    activity: arr(o.activity).map((r) => ({
      day: str(r.day, 10),
      by: str(r.by, 200),
      reads: num(r.reads),
      writes: num(r.writes),
    })),
    byType: arr(o.byType).map((r) => ({
      type: str(r.type, 80),
      name: str(r.name, 200),
      by: str(r.by, 200),
      reads: num(r.reads),
      writes: num(r.writes),
    })),
    totals: {
      reads: num(t.reads),
      writes: num(t.writes),
      kinds: Object.fromEntries(
        Object.entries(isObj(t.kinds) ? t.kinds : {}).map(([k, v]) => [k, num(v)]),
      ),
      undone: num(t.undone),
      proposals: num(t.proposals),
      accepted: num(t.accepted),
      requests: num(t.requests),
      readings: num(t.readings),
    },
  };
}
export function parseActions(b: unknown): { actions: AuditAction[]; names: AuditNames } {
  const o = isObj(b) ? b : {};
  return { actions: arr(o.actions).slice(0, 500).map(parseAction), names: parseNames(o.names) };
}
export function parseDetail(b: unknown): AuditDetail | null {
  if (!isObj(b) || !isObj(b.action)) return null;
  const c = isObj(b.call) ? b.call : null;
  return {
    action: parseAction(b.action),
    names: parseNames(b.names),
    call: c
      ? {
          role: str(c.role, 40),
          model: str(c.model, 200),
          request: c.request,
          response: c.response,
        }
      : null,
    ops: arr(b.ops)
      .slice(0, 500)
      .map((o) => ({
        seq: num(o.seq),
        at: num(o.at),
        kind: str(o.kind, 20),
        target: str(o.target, 80),
        by: str(o.by, 200),
      })),
  };
}
export const parseColumns = (c: unknown): SystemColumns | null =>
  isObj(c)
    ? {
        created: num(c.created),
        updated: num(c.updated),
        version: num(c.version),
        createdBy: typeof c.createdBy === "string" ? c.createdBy : null,
        updatedBy: typeof c.updatedBy === "string" ? c.updatedBy : null,
        editors: strs(c.editors, 50),
        viewers: strs(c.viewers, 50),
        seenAt: typeof c.seenAt === "number" ? c.seenAt : null,
        origin: typeof c.origin === "string" ? c.origin : null,
        size: num(c.size),
      }
    : null;
export function parseHistory(b: unknown): RowHistory | null {
  if (!isObj(b)) return null;
  return {
    columns: parseColumns(b.columns),
    seenBy: arr(b.seenBy)
      .slice(0, 200)
      .map((s) => ({
        ...parseSeen(s),
        action: num(s.action),
        at: num(s.at),
        by: str(s.by, 200),
        tool: str(s.tool, 80),
      })),
    changes: arr(b.changes)
      .slice(0, 500)
      .map((c) => ({
        seq: num(c.seq),
        at: num(c.at),
        kind: str(c.kind, 20),
        by: str(c.by, 200),
        fields: strs(c.fields),
        body: c.body === true,
      })),
    blame: arr(b.blame)
      .slice(0, 5000)
      .map((l) => ({
        text: str(l.text, 20000),
        by: str(l.by, 200),
        at: num(l.at),
        seq: num(l.seq),
      })),
    names: parseNames(b.names),
  };
}
export function parseStorage(b: unknown): Storage {
  const o = isObj(b) ? b : {};
  const mc = isObj(o.modelCalls) ? o.modelCalls : {};
  const au = isObj(o.audit) ? o.audit : {};
  return {
    types: arr(o.types).map((t) => ({
      type: str(t.type, 80),
      name: str(t.name, 200),
      rows: num(t.rows),
      bytes: num(t.bytes),
      history: num(t.history),
    })),
    modelCalls: { rows: num(mc.rows), bytes: num(mc.bytes) },
    audit: { actions: num(au.actions), access: num(au.access), bytes: num(au.bytes) },
    total: num(o.total),
    advice: arr(o.advice).map((a) => ({
      code: str(a.code, 40),
      bytes: num(a.bytes),
      ...(typeof a.type === "string" ? { type: a.type } : {}),
    })),
  };
}

/** What kind of actor a `by` is (for its colour and the filters). */
export function actorKind(by: string): "model" | "mcp" | "user" | "boni" {
  if (by.startsWith("model:")) return "model";
  if (by.startsWith("mcp:")) return "mcp";
  if (by.startsWith("user:")) return "user";
  return "boni";
}
/** A model id as a person reads it: its last part ("deepseek/deepseek-v4.1-flash" -> "deepseek-v4.1-flash"). */
export const shortModel = (id: string) => id.split("/").pop() || id;
