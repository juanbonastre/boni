/**
 * What one run did, step by step, from the journal and the audit (task 52, «Recorrido»; Juan, 2026-11-03: «ver bien
 * cómo se están moviendo sus datos en un diagrama como el de n8n»): each step of its plan with the policy's decision
 * and rule, the steps it took its data from (the diagram's edges) and what the models said in it; what the run read
 * (the audit's accesses, by collection), what it changed, what it proposed, its decisions and the models it called.
 * Nothing new is recorded: a view of what the journal and the audit already keep. Everything is text; what came from
 * outside is shown as it is, never followed.
 */
import type { UserStore } from "@boni/store";

export interface RunDetail {
  id: string;
  status: string;
  origin: string;
  started: number;
  finished: number | null;
  request: string | null;
  steps: {
    id: string;
    op: string;
    what: string;
    args: Record<string, unknown>;
    /** allow, confirm, propose, deny, skip, stopped (the last one logged), or null: it never ran. */
    decision: string | null;
    rule: string | null;
    error: string | null;
    /** The steps it takes its data from (`$x` references in it): the diagram's edges. */
    deps: string[];
    /** What the models answered in it (a reader's, the decider's), as text: the user's own content. */
    answers: string[];
  }[];
  /** What it read, per collection: some titles and how many entities. */
  read: { collection: string; titles: string[]; n: number }[];
  /** What it changed, each entity by its title and collection, and whether that was undone. */
  changes: { action: string; title: string; collection: string; undone: boolean }[];
  /** The proposals it made, by title and state. */
  proposals: { title: string; status: string }[];
  /** Its decisions (docs/fiabilidad.md): the area, the confidence, what came of it and whether it was right. */
  decisions: { area: string; p: number; outcome: string; result: string | null }[];
  /** The models it called: role, model, tokens and cost (null when unknown). */
  models: {
    role: string;
    provider: string;
    model: string;
    input: number;
    output: number;
    cost: number | null;
    at: number;
  }[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
const TITLES = 8;
const CHANGES = 50;
const ANSWER = 4000;

/** The names a plan expression refers to (`$name`, `$name.field`, `$name[0]`), anywhere inside `v`. */
function refsIn(v: unknown, out: Set<string>): void {
  if (Array.isArray(v)) for (const x of v) refsIn(x, out);
  else if (isObj(v)) {
    if (typeof v.ref === "string") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(v.ref);
      if (m) out.add(m[1] as string);
    }
    for (const x of Object.values(v)) refsIn(x, out);
  }
}

/** A run's trace, or null when the journal has no such run. */
export function traceOf(store: UserStore, id: string): RunDetail | null {
  const j = store.journal;
  const r = j.run(id);
  if (!r) return null;
  const types = store.schema().types;
  const titleOf = (entity: string): { title: string; collection: string } | null => {
    const s = store.get(entity);
    const t = s ? types[s.entity.type] : undefined;
    if (!s || !t) return null;
    return { title: text(s.entity.values[t.titleField], 80), collection: t.name };
  };
  const calls = j
    .modelCalls(id)
    .slice()
    .sort((a, b) => a.at - b.at);
  const planner = calls.find((m) => m.role === "planner");
  const request = (planner?.request as { input?: { request?: unknown } } | undefined)?.input
    ?.request;
  const logged = j.steps(id);
  const plan = r.plan as { steps?: Record<string, unknown>[] } | null;
  const planSteps = plan?.steps ?? [];
  const stepIds = new Set(planSteps.map((s) => String(s.id)));
  // A model's answer belongs to the step logged right after it (the step ran it): between the steps before it and
  // its own last log line.
  let before = 0;
  const steps = planSteps.map((s) => {
    const sid = String(s.id);
    const mine = logged.filter((x) => x.step === sid);
    const last = mine.at(-1);
    const error = mine.find((x) => x.kind === "error")?.detail as { code?: string } | undefined;
    const endAt = mine.reduce((m, x) => Math.max(m, x.at), 0);
    const answers = mine.length
      ? calls
          .filter((c) => c.role !== "planner" && c.at > before && c.at <= endAt)
          .map((c) => text(JSON.stringify(c.response), ANSWER))
          .filter(Boolean)
      : [];
    if (endAt) before = Math.max(before, endAt);
    const refs = new Set<string>();
    for (const [k, v] of Object.entries(s)) if (k !== "id") refsIn(v, refs);
    return {
      id: sid,
      op: String(s.op ?? ""),
      what: String(
        s.op === "call"
          ? s.tool
          : s.op === "read"
            ? s.reader
            : s.op === "reply"
              ? s.component
              : (s.control ?? ""),
      ),
      args: (s.op === "call"
        ? (s.args as Record<string, unknown>)
        : s.op === "read"
          ? { input: s.input }
          : {}) as Record<string, unknown>,
      decision: last?.decision ?? null,
      rule: last?.rule ?? null,
      error: error?.code ?? null,
      deps: [...refs].filter((h) => h !== sid && stepIds.has(h)),
      answers,
    };
  });
  // What it read: the audit's accesses of the run, by collection.
  const acts = store.audit.actions({ run: id, limit: 1000 });
  const read = new Map<string, { collection: string; titles: string[]; n: number }>();
  for (const seen of store.audit.accessOf(acts.map((a) => a.seq)).values())
    for (const s of seen) {
      const t = types[s.type];
      const g = read.get(s.type) ?? { collection: t?.name ?? s.type, titles: [], n: 0 };
      g.n++;
      const title = titleOf(s.entity)?.title;
      if (title && g.titles.length < TITLES && !g.titles.includes(title)) g.titles.push(title);
      read.set(s.type, g);
    }
  const changes = store
    .runOps(id)
    .slice(0, CHANGES)
    .map((op) => ({
      action: op.kind,
      ...(titleOf(op.target) ?? { title: "", collection: "" }),
      undone: op.undone,
    }));
  const proposals = j.proposalsOf(id).map((p) => {
    const rows = (p.view as { rows?: { arg: string; value?: unknown }[]; title?: unknown }) ?? {};
    return {
      title: text(rows.rows?.find((x) => x.arg === "values.title")?.value ?? rows.title, 120),
      status: p.status,
    };
  });
  const decisions = j.decisionsOf(id).map((d) => ({
    area: d.area,
    p: d.p,
    outcome: d.outcome,
    result: d.result,
  }));
  const models = calls.map((c) => {
    const u = isObj(c.usage) ? c.usage : {};
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    return {
      role: c.role,
      provider: c.provider,
      model: c.model,
      input: n(u.input),
      output: n(u.output),
      cost: typeof u.cost === "number" && Number.isFinite(u.cost) ? u.cost : null,
      at: c.at,
    };
  });
  return {
    id,
    status: r.status,
    origin: r.origin,
    started: r.started,
    finished: r.finished,
    request: typeof request === "string" ? request : null,
    steps,
    read: [...read.values()],
    changes,
    proposals,
    decisions,
    models,
  };
}
