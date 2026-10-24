import { type AiLevel, BODY, blame, entityLabel, type Seen, type UserStore } from "@boni/store";

/**
 * The audit as the app shows it (Juan, 2026-10-24; the store's audit.ts keeps it): who did and saw what, each
 * row's system columns, who wrote each line of a note, how much the store takes and what could go. Only from a
 * personal device (the data block of http.ts). Names are resolved here (types, fields, titles) so the app paints
 * words; the audit itself keeps ids only.
 */

/** Which of Juan's own reads are recorded: by default only of collections closed to the AI (configurable, for a
 * Boni shared with other people). */
const USER_READS = "audit/userReads";
const DEFAULT_USER_READS: AiLevel[] = ["restricted", "private"];
const LEVELS: AiLevel[] = ["visible", "opaque", "restricted", "private"];

export function auditSettings(store: UserStore): { userReads: AiLevel[] } {
  try {
    const v = JSON.parse(store.setting(USER_READS) ?? "null") as unknown;
    if (Array.isArray(v) && v.every((x) => LEVELS.includes(x as AiLevel)))
      return { userReads: v as AiLevel[] };
  } catch {}
  return { userReads: DEFAULT_USER_READS };
}

export function setAuditSettings(store: UserStore, body: unknown): { userReads: AiLevel[] } | null {
  const v = (body as { userReads?: unknown } | null)?.userReads;
  if (!Array.isArray(v) || !v.every((x) => LEVELS.includes(x as AiLevel))) return null;
  store.setSetting(USER_READS, JSON.stringify([...new Set(v)]));
  return auditSettings(store);
}

/** Records a read of Juan's own (a row opened, a table listed) when its collection's level asks for it. */
export function recordUserRead(
  store: UserStore,
  device: string,
  tool: "data.row" | "data.rows",
  type: string,
  ids: string[],
  withBody: boolean,
  now: number,
): void {
  const level = store.aiAccess()[type] ?? "visible";
  if (!auditSettings(store).userReads.includes(level)) return;
  const def = store.schema().types[type];
  const seen: Seen[] = ids.flatMap((id) => {
    const e = store.get(id);
    if (!e || !def) return [];
    return [
      {
        entity: id,
        type,
        version: e.entity.version,
        fields: Object.keys(e.entity.values).filter((f) => def.fields.some((x) => x.id === f)),
        shapes: [],
        body: withBody && e.entity.body ? "text" : null,
        files: [],
      },
    ];
  });
  store.audit.record({
    at: now,
    by: `user:${device}`,
    tool,
    target: { collection: type },
    decision: "allow",
    result: { rows: ids.length },
    seen,
  });
}

/** Each row's system columns (Juan, 2026-10-24): no one may change them; the app may show or hide them. */
export interface SystemColumns {
  created: number;
  updated: number;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  editors: string[];
  viewers: string[];
  seenAt: number | null;
  /** Where its data came from, its lowest integrity (user, own, imported, model, external…). */
  origin: string | null;
  /** Bytes of its values and text. */
  size: number;
}

export function systemColumns(store: UserStore, ids: string[]): Record<string, SystemColumns> {
  const meta = store.audit.meta(ids);
  const out: Record<string, SystemColumns> = {};
  for (const id of ids) {
    const s = store.get(id);
    if (!s) continue;
    const m = meta.get(id);
    out[id] = {
      created: s.entity.created,
      updated: s.entity.updated,
      version: s.entity.version,
      createdBy: m?.createdBy ?? null,
      updatedBy: m?.updatedBy ?? null,
      editors: m?.editors ?? [],
      viewers: m?.viewers ?? [],
      seenAt: m?.seenAt ?? null,
      origin: entityLabel(s)?.integrity ?? null,
      size: JSON.stringify(s.entity.values).length + (s.entity.body?.length ?? 0),
    };
  }
  return out;
}

const DAY = 86_400_000;
const range = (url: URL, now: number) => {
  const to = Number(url.searchParams.get("to")) || now;
  const from = Number(url.searchParams.get("from")) || to - 30 * DAY;
  return { from, to };
};

/** Names for the ids an answer mentions: collections, fields, and the titles of rows. */
function names(store: UserStore, seen: Seen[]) {
  const types = store.schema().types;
  const out = {
    types: {} as Record<string, string>,
    fields: {} as Record<string, string>,
    titles: {} as Record<string, string>,
  };
  for (const s of seen) {
    const t = types[s.type];
    if (!t) continue;
    out.types[t.id] = t.name;
    for (const f of [...s.fields, ...s.shapes]) {
      const d = t.fields.find((x) => x.id === f);
      if (d) out.fields[f] = d.name;
    }
    if (out.titles[s.entity] === undefined) {
      const e = store.get(s.entity);
      out.titles[s.entity] = e ? String(e.entity.values[t.titleField] ?? "") : "";
    }
  }
  return out;
}

/** The «Actividad» numbers: per day and actor, per collection and actor, and the totals of the period. */
export function auditSummary(store: UserStore, url: URL, now: number) {
  const { from, to } = range(url, now);
  const byType = store.audit.byType(from, to);
  const types = store.schema().types;
  return {
    from,
    to,
    activity: store.audit.activity(from, to),
    byType: byType.map((r) => ({ ...r, name: types[r.type]?.name ?? r.type })),
  };
}

/** The latest actions (newest first, before `before`), each with what it saw, in words. */
export function auditActions(store: UserStore, url: URL) {
  const before = Number(url.searchParams.get("before")) || undefined;
  const by = url.searchParams.get("by") ?? undefined;
  const run = url.searchParams.get("run") ?? undefined;
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
  const actions = store.audit.actions({
    ...(before ? { before } : {}),
    ...(by ? { by } : {}),
    ...(run ? { run } : {}),
    limit,
  });
  const seen = store.audit.accessOf(actions.map((a) => a.seq));
  const all = [...seen.values()].flat();
  return {
    actions: actions.map((a) => ({ ...a, seen: seen.get(a.seq) ?? [] })),
    names: names(store, all),
  };
}

/** One action in full: for a model call, what was sent and what the model answered (its own text). */
export function auditAction(store: UserStore, seq: number) {
  const a = store.audit.actions({ before: seq + 1, limit: 1 })[0];
  if (!a || a.seq !== seq) return null;
  const seen = store.audit.accessOf([seq]).get(seq) ?? [];
  const call = a.call !== null ? store.journal.modelCallById(a.call) : null;
  const ops = a.run
    ? store
        .log({ run: a.run })
        .filter((o) => o.kind !== "schema")
        .map((o) => ({
          seq: o.seq,
          at: o.at,
          kind: o.kind,
          target: o.target,
          by: o.by,
          after: o.after,
        }))
    : [];
  return {
    action: { ...a, seen },
    names: names(store, seen),
    ...(call
      ? {
          call: {
            role: call.role,
            model: call.model,
            request: call.request,
            response: call.response,
          },
        }
      : {}),
    ops,
  };
}

/** One row's history: its system columns, who saw it, every change, and who wrote each line of its text. */
export function auditRow(store: UserStore, id: string) {
  const s = store.get(id);
  if (!s) return null;
  const seenBy = store.audit.seenBy(id, 200);
  const def = store.schema().types[s.entity.type];
  const changes = store.log({ target: id }).map((o) => {
    const after = (o.after ?? {}) as {
      values?: Record<string, unknown>;
      entity?: { values?: Record<string, unknown> };
      body?: unknown;
    };
    const fields = Object.keys(after.values ?? after.entity?.values ?? {});
    const body =
      "body" in after || (after.entity !== undefined && "body" in (after.entity as object));
    return { seq: o.seq, at: o.at, kind: o.kind, by: o.by, run: o.run, fields, body };
  });
  return {
    columns: systemColumns(store, [id])[id],
    seenBy,
    changes,
    blame: blame(store.bodyVersions(id)),
    names: names(store, [
      ...seenBy,
      {
        entity: id,
        type: s.entity.type,
        version: 0,
        fields: def?.fields.map((f) => f.id) ?? [],
        shapes: [],
        body: null,
        files: [],
      },
    ]),
    body: BODY,
  };
}

/**
 * How much each part takes, and what could go when it grows (nothing is deleted by default: Juan, 2026-10-24).
 * Advice is codes and numbers; the app says it in words.
 */
export function auditStorage(store: UserStore) {
  const st = store.audit.storage();
  const types = store.schema().types;
  const advice: { code: string; bytes: number; type?: string }[] = [];
  const MB = 1024 * 1024;
  if (st.modelCalls.bytes > 100 * MB || st.modelCalls.bytes > st.total * 0.3)
    advice.push({ code: "model-texts", bytes: st.modelCalls.bytes });
  for (const t of st.types)
    if (t.history > 50 * MB && t.history > t.bytes * 5)
      advice.push({ code: "history", bytes: t.history, type: t.type });
  return {
    ...st,
    types: st.types.map((t) => ({ ...t, name: types[t.type]?.name ?? t.type })),
    advice,
  };
}
