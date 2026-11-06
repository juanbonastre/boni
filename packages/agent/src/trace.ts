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
  /** The flow and version it ran (docs/flujos.md), so the app draws it on that flow's canvas; null for a planner's. */
  flow: string | null;
  flowVersion: number | null;
  /** What the plan took from outside its own steps (what the trigger or the code bound): the trigger's node. */
  inputs: string[];
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
    /** The inputs it takes (bound by the trigger or the code): an edge from the trigger's node. */
    uses: string[];
    /** A tool's title from the registry («Crear»), filled by the agent; null for the rest. */
    title: string | null;
    /** What the models answered in it (a reader's, the decider's), as text: the user's own content. */
    answers: string[];
    /** Its model calls in this run and what they cost (task 91: «todo lo que sea de un recorrido concreto»). */
    calls: number;
    cost: number;
    /** What it gave the next step, as the model answered it (one answer, or one per item): shown as text. */
    output: unknown;
  }[];
  /** What it read, per collection (its name, and its id as `type`): some titles and how many entities. */
  read: { collection: string; type: string; titles: string[]; n: number }[];
  /** What it changed, each entity by its title and collection, and whether that was undone. */
  changes: { action: string; title: string; collection: string; type: string; undone: boolean }[];
  /**
   * The proposals it made, by title, state and the collection each would write in (its id; null: none); each with its
   * rows as the Bandeja showed them, the step that made it, and the record it became once accepted (task 91).
   */
  proposals: {
    id: string;
    title: string;
    status: string;
    type: string | null;
    created: number;
    decided: number | null;
    rows: { name: string; value: string }[];
    step: string | null;
    record: RecordView | null;
  }[];
  /** The record that started it (a mail), by its title and collection, with its first fields: the way starts there. */
  input: {
    id: string;
    title: string;
    collection: string;
    type: string;
    fields: { name: string; value: string }[];
  } | null;
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
/** What a step gave the next one is kept at most this big (lists cut to 20 items, texts to 300 characters). */
const OUTPUT = 12_000;

/** A value cut to what a panel shows: lists of 20 items, texts of 300 characters, four levels deep. */
export function smallJson(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return v.length > 300 ? `${v.slice(0, 300)}…` : v;
  if (v === null || typeof v !== "object") return v;
  if (depth > 3) return null;
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => smallJson(x, depth + 1));
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>)
      .slice(0, 30)
      .map(([k, x]) => [k, smallJson(x, depth + 1)]),
  );
}

/**
 * What a reader gave the next step, worked out from its model's answer, for a run from before steps kept it
 * (2026-11-06): the reading's items for Juan as tasks and events, the decider's choice, the fields by their names.
 */
function fromAnswers(
  reader: string,
  its: readonly { response: unknown; request: unknown }[],
): unknown {
  const said = its.map((c) => c.response).filter((x) => x !== null && x !== undefined);
  if (!said.length) return null;
  const one = (r: unknown, request: unknown): unknown => {
    if (!isObj(r)) return r;
    // The decider answers twice ({c, r}): its choice is the first's.
    if (isObj(r.c) && "choice" in r.c) return { choice: r.c.choice };
    if (reader === "read_message" && Array.isArray(r.items)) {
      const mine = r.items.filter(
        (x) => isObj(x) && (x.actor === undefined || x.actor === "recipient"),
      );
      const pick = (kind: string) =>
        mine
          .filter((x) => isObj(x) && (x.kind ?? "task") === kind)
          .map((x) => {
            const o = x as Record<string, unknown>;
            return Object.fromEntries(
              ["title", "due", "start", "end"].filter((k) => o[k] != null).map((k) => [k, o[k]]),
            );
          });
      return { tasks: pick("task"), events: pick("event") };
    }
    if (reader === "fill" && isObj(r.values)) {
      // The fields by the names the reader was given (f0, f1… in their order).
      const asked = isObj(request) && isObj(request.input) ? request.input.fields : null;
      const names = Array.isArray(asked)
        ? asked.map((f) => (isObj(f) && typeof f.name === "string" ? f.name : null))
        : [];
      const values = Object.fromEntries(
        Object.entries(r.values)
          .filter(([, x]) => x !== null)
          .map(([k, x]) => [names[Number(k.slice(1))] ?? k, x]),
      );
      return { values, note: r.note ?? null };
    }
    return r;
  };
  const out = its.map((c) => one(c.response, c.request)).filter((x) => x !== null);
  return out.length === 1 ? out[0] : out;
}
const FIELDS = 12;

/** A record as the panel of a box shows it: its title, collection and fields by their names, as text. */
export interface RecordView {
  id: string;
  title: string;
  collection: string;
  fields: { name: string; value: string }[];
}

/** A record's fields as text, by their names: an option by its name, a related record by its title. */
export function recordView(store: UserStore, id: string, max = FIELDS): RecordView | null {
  const s = store.get(id);
  const types = store.schema().types;
  const t = s ? types[s.entity.type] : undefined;
  if (!s || !t || s.entity.deleted !== undefined) return null;
  const shown = (f: (typeof t.fields)[number], v: unknown): string => {
    const one = (x: unknown): string => {
      if (f.type === "select" || f.type === "multiselect")
        return f.options?.find((o) => o.id === x)?.name ?? String(x);
      if (f.type === "relation" && typeof x === "string") {
        const r = store.get(x);
        const rt = r ? types[r.entity.type] : undefined;
        return r && rt ? String(r.entity.values[rt.titleField] ?? "") : "";
      }
      if (typeof x === "boolean") return x ? "✓" : "✗";
      return typeof x === "string" || typeof x === "number" ? String(x) : JSON.stringify(x);
    };
    return (Array.isArray(v) ? v.map(one).filter(Boolean).join(", ") : one(v)).slice(0, 200);
  };
  const fields: { name: string; value: string }[] = [];
  for (const f of t.fields) {
    if (fields.length >= max) break;
    if (f.hidden || f.archived || f.id === t.titleField || f.type === "file") continue;
    const v = s.entity.values[f.id];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
    const value = shown(f, v);
    if (value) fields.push({ name: f.name, value });
  }
  return { id, title: text(s.entity.values[t.titleField], 120), collection: t.name, fields };
}

/** The names a plan's step refers to (`$name`, `$name.field`), in its arguments, condition and iteration. */
export function refsOf(step: unknown): string[] {
  const out = new Set<string>();
  refsIn(step, out);
  return [...out];
}

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

/** The record a plan reads first (`entities.get` of a literal id): what a mail's reading from before flows read. */
function firstRead(plan: unknown): string | null {
  const first = isObj(plan) && Array.isArray(plan.steps) ? plan.steps[0] : null;
  if (!isObj(first) || first.tool !== "entities.get" || !isObj(first.args)) return null;
  const id = first.args.id;
  return isObj(id) && typeof id.lit === "string" ? id.lit : null;
}

/** A run's trace, or null when the journal has no such run. */
export function traceOf(store: UserStore, id: string): RunDetail | null {
  const j = store.journal;
  const r = j.run(id);
  if (!r) return null;
  const types = store.schema().types;
  const titleOf = (entity: string): { title: string; collection: string; type: string } | null => {
    const s = store.get(entity);
    const t = s ? types[s.entity.type] : undefined;
    if (!s || !t) return null;
    return { title: text(s.entity.values[t.titleField], 80), collection: t.name, type: t.id };
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
  // A model's answer belongs to the step it answered in: kept with the call since 2026-11-06 (migration 19); before,
  // the step logged right after it (the step ran it), between the steps before it and its own last log line.
  let before = 0;
  const costOf = (c: (typeof calls)[number]) => {
    const u = isObj(c.usage) ? c.usage : {};
    return typeof u.cost === "number" && Number.isFinite(u.cost) ? u.cost : 0;
  };
  const steps = planSteps.map((s) => {
    const sid = String(s.id);
    const mine = logged.filter((x) => x.step === sid);
    const last = mine.at(-1);
    const error = mine.find((x) => x.kind === "error")?.detail as { code?: string } | undefined;
    const endAt = mine.reduce((m, x) => Math.max(m, x.at), 0);
    const its = calls.filter((c) =>
      c.step
        ? c.step === sid
        : mine.length > 0 && c.role !== "planner" && c.at > before && c.at <= endAt,
    );
    const answers = its.map((c) => text(JSON.stringify(c.response), ANSWER)).filter(Boolean);
    // What it gave the next step: kept with its last line since 2026-11-06; before, worked out from the answers.
    const kept = mine
      .map((x) => (isObj(x.detail) ? x.detail.out : undefined))
      .find((x) => x !== undefined);
    const raw =
      kept !== undefined ? kept : s.op === "read" ? fromAnswers(String(s.reader), its) : null;
    const output =
      raw !== null && raw !== undefined && JSON.stringify(raw).length <= OUTPUT ? raw : null;
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
      uses: [...refs].filter((h) => h !== sid && !stepIds.has(h) && h !== "item" && h !== "zip"),
      title: null,
      answers,
      calls: its.length,
      cost: its.reduce((n, c) => n + costOf(c), 0),
      output,
    };
  });
  // What it read: the audit's accesses of the run, by collection.
  const acts = store.audit.actions({ run: id, limit: 1000 });
  const read = new Map<string, { collection: string; type: string; titles: string[]; n: number }>();
  for (const seen of store.audit.accessOf(acts.map((a) => a.seq)).values())
    for (const s of seen) {
      const t = types[s.type];
      const g = read.get(s.type) ?? {
        collection: t?.name ?? s.type,
        type: s.type,
        titles: [],
        n: 0,
      };
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
      ...(titleOf(op.target) ?? { title: "", collection: "", type: "" }),
      undone: op.undone,
    }));
  const byKey = new Map(Object.values(types).map((t) => [t.key, t.id]));
  // The steps that proposed: a proposal made before its step was kept with it belongs to the one there was.
  const proposing = steps.filter((s) => s.decision === "propose").map((s) => s.id);
  // Who accepted each: the run of its «Aceptar» (it keeps the proposal since 2026-11-06; before, the one at that time).
  const used = new Set<string>();
  const acceptRun = (pid: string, decided: number | null) => {
    if (decided === null) return null;
    const near = j.runsIn(decided - 5000, decided + 5000).filter((x) => x.origin === "accepted");
    const own = near.find((x) => x.proposal === pid);
    if (own) return own;
    // Before runs kept their proposal: the one that started closest to its decision, each run for one proposal only
    // (several accepted at once by «Solo» are each their own).
    const was = near
      .filter((x) => !x.proposal && !used.has(x.id) && Math.abs(x.started - decided) <= 2000)
      .sort((a, b) => Math.abs(a.started - decided) - Math.abs(b.started - decided))[0];
    if (was) used.add(was.id);
    return was ?? null;
  };
  const proposals = j.proposalsOf(id).map((p) => {
    const rows =
      (p.view as {
        rows?: { arg: string; value?: unknown; name?: unknown; detail?: unknown }[];
        title?: unknown;
      }) ?? {};
    // The collection's key: where it was accepted when the user moved it, else where it was proposed (the agent
    // stores a labelled value in `values.type`).
    const v = isObj(p.args) && isObj(p.args.values) ? p.args.values.type : null;
    const raw = isObj(v) ? v.value : v;
    const moved = p.status === "accepted" ? p.edits?.type?.to : undefined;
    const key = typeof moved === "string" ? moved : typeof raw === "string" ? raw : null;
    const step = isObj(p.args) && typeof p.args.step === "string" ? p.args.step : null;
    const accepted = p.status === "accepted" ? acceptRun(p.id, p.decided) : null;
    // The record it became, or the one it changed («Es el mismo»).
    const ops = accepted ? store.runOps(accepted.id) : [];
    const made = ops.find((op) => op.kind === "create") ?? ops.find((op) => op.kind === "update");
    return {
      id: p.id,
      title: text(rows.rows?.find((x) => x.arg === "values.title")?.value ?? rows.title, 120),
      status: p.status,
      type: key ? (byKey.get(key) ?? (types[key] ? key : null)) : null,
      created: p.created,
      decided: p.decided,
      // As the Bandeja showed it: each field by its name (or its key), an option or a record by its name.
      rows: (rows.rows ?? [])
        .filter(
          (x) => x.arg !== "type" && x.value !== undefined && x.value !== null && x.value !== "",
        )
        .slice(0, FIELDS)
        .map((x) => ({
          name: text(x.name ?? x.arg.replace(/^values\./, ""), 60),
          value: text(x.detail ?? x.value, 200),
        })),
      step: step ?? (proposing.length === 1 ? (proposing[0] as string) : null),
      record: made ? recordView(store, made.target) : null,
    };
  });
  // What started it: the record its trigger bound; a mail's reading from before flows, the mail its plan read first.
  const inputId = r.input ?? (r.origin === "background" && !r.flow ? firstRead(r.plan) : null);
  const started = inputId ? titleOf(inputId) : null;
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
    flow: r.flow,
    flowVersion: r.flowVersion,
    inputs: [...new Set(steps.flatMap((s) => s.uses))],
    steps,
    read: [...read.values()],
    changes,
    proposals,
    input:
      inputId && started
        ? { id: inputId, ...started, fields: recordView(store, inputId, 4)?.fields ?? [] }
        : null,
    decisions,
    models,
  };
}
