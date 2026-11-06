/**
 * Flows (docs/flujos.md): a plan with a trigger kept as data in the account's journal, a row per version. The mail
 * reading is the flow «Leer correo»: Boni keeps its plan current with the configuration (a new version only when it
 * changes) until the user saves his own, which then runs as he left it (F2) until he goes back to Boni's. Here: the
 * flows as the apps list and draw them, the editor's catalog of nodes, its checklist and the values a step may take
 * from earlier ones (`checkFlow`), and the changes the user makes (save, turn on or off, go back to a version,
 * duplicate, delete). Each run says its flow and version (D-42).
 */
import { createHash, randomBytes } from "node:crypto";
import {
  checkPlan,
  manualInputs,
  newFlowId,
  type Origin,
  originOf,
  planVocabulary,
  readStore,
  refsOf,
  type ToolRegistry,
  toolsFor,
  triggerOk,
} from "@boni/agent";

export { manualInputs, newFlowId, originOf, triggerOk };

import { type FieldDef, rolesOf, type TypeDef } from "@boni/entities";
import type { FlowRow, RunRow, UserStore } from "@boni/store";
import { activeFunction, activeFunctions } from "./functionSteps.ts";

export const MAIL_FLOW = "leer-correo";
/** Boni's «Traer correo» (docs/sistema.md §4.2): new mail in the mailbox, brought into the mail's collection. */
export const FETCH_FLOW = "traer-correo";
/** Boni's «Revisar la guía» (docs/sistema.md §4.2): Juan's decisions on mail proposals, read by the reviewer. */
export const REVIEW_FLOW = "revisar-guia";

/** What a flow's trigger binds to its plan by name, each with what it is (for the trigger's node). */
export interface FlowInput {
  id: string;
  what:
    | "record"
    | "text"
    | "list"
    | "guide"
    | "options"
    | "modules"
    | "value"
    | "fields"
    | "relations";
}

/**
 * What the mail reading binds to «Leer correo» (mail.ts: `proposeOne` and `mailBindings`). `fill` and `prefill` are
 * per collection, by its key (`$fill.tarea`, `$prefill.tarea`): the editor renames them when a step's collection
 * changes (docs/flujos.md §4.1).
 */
export const MAIL_INPUTS: Readonly<Record<string, FlowInput["what"]>> = {
  mail: "record",
  text: "text",
  subject: "text",
  userIn: "value",
  known: "list",
  only: "value",
  options: "options",
  modules: "modules",
  guide: "guide",
  fill: "fields",
  prefill: "relations",
  adjuntos: "text",
  inv: "value",
  asked: "value",
  again: "value",
  writes: "list",
};
/** The inputs a step's collection decides, by the collection's key. */
export const PER_COLLECTION = ["fill", "prefill"];

/** The names a plan takes from outside (not its own steps nor `$item`/`$zip` of an iteration), as inputs. */
export function inputsOf(plan: unknown, trigger: unknown = null): FlowInput[] {
  const steps = stepsOf(plan);
  const own = new Set([...steps.map((s) => s.id), "item", "zip"]);
  const manual = manualInputs(trigger);
  const seen = new Set<string>();
  const out: FlowInput[] = [];
  for (const s of steps)
    for (const r of refsOf(s))
      if (!own.has(r) && !seen.has(r)) {
        seen.add(r);
        out.push({ id: r, what: manual.includes(r) ? "text" : (MAIL_INPUTS[r] ?? "value") });
      }
  return out;
}

export type Step = { id: string; [k: string]: unknown };
export const stepsOf = (plan: unknown): Step[] => {
  const steps = (plan as { steps?: unknown } | null)?.steps;
  return Array.isArray(steps)
    ? steps.filter(
        (s): s is Step =>
          !!s && typeof s === "object" && typeof (s as { id?: unknown }).id === "string",
      )
    : [];
};

/**
 * The collections a step's `type` names, by key: its literal, or the results of a `case` over literals (one of a
 * literal list, D-48: «Crear en la elegida», docs/sistema.md §4.2); none when it is worked out otherwise.
 */
export function typeKeysOf(v: unknown): string[] {
  const one = litOf(v);
  if (one) return [one];
  const e = v as { fn?: unknown; args?: unknown } | null;
  if (!e || typeof e !== "object" || e.fn !== "case" || !Array.isArray(e.args)) return [];
  const args = e.args as unknown[];
  if (args.length < 3 || args.length % 2 === 0) return [];
  const keys: string[] = [];
  for (let i = 1; i < args.length; i += 2) {
    const key = litOf(args[i + 1]);
    if (!litOf(args[i]) || !key) return [];
    keys.push(key);
  }
  return [...new Set(keys)];
}

/** The collections a plan writes in or takes per-collection inputs for (`$fill.<key>`, `type` of a record), by key. */
export function collectionKeysOf(plan: unknown): string[] {
  const keys = new Set<string>();
  for (const s of stepsOf(plan)) {
    if (s.op === "call" && typeof s.tool === "string" && s.tool.startsWith("entities."))
      for (const t of typeKeysOf((s.args as Record<string, unknown> | undefined)?.type))
        keys.add(t);
    const scan = (v: unknown): void => {
      if (Array.isArray(v)) for (const x of v) scan(x);
      else if (v && typeof v === "object") {
        const ref = (v as { ref?: unknown }).ref;
        if (typeof ref === "string") {
          const m = /^\$(fill|prefill)\.([A-Za-z_][A-Za-z0-9_]*)/.exec(ref);
          if (m) keys.add(m[2] as string);
        }
        for (const x of Object.values(v)) scan(x);
      }
    };
    scan(s);
  }
  return [...keys];
}

/**
 * The flow as its latest version. Boni's (`by: "preset"`) is saved anew only when the plan the code makes changed
 * (its hash); a version the user saved stays as he left it and is what runs, until he goes back to Boni's.
 */
export function ensureFlow(
  store: UserStore,
  f: { id: string; name: string; trigger: unknown; plan: unknown; by: string },
  now: number,
): FlowRow {
  const latest = store.journal.flow(f.id);
  if (latest && latest.by !== "preset") return latest;
  if (latest && latest.hash === hashOf(f.plan)) return latest;
  return store.journal.saveFlow({
    id: f.id,
    name: f.name,
    trigger: f.trigger,
    inputs: inputsOf(f.plan, f.trigger),
    plan: f.plan,
    // Its canvas lays itself out (docs/sistema.md §4.4): no positions are kept.
    layout: null,
    by: f.by,
    enabled: latest?.enabled ?? true,
    created: now,
  });
}

/** The hash the journal gives a plan (the same way, so an unchanged plan is found without saving). */
function hashOf(plan: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(plan ?? null))
    .digest("hex")
    .slice(0, 16);
}

export interface FlowSummary {
  id: string;
  name: string;
  version: number;
  trigger: unknown;
  by: string;
  enabled: boolean;
  steps: number;
  runs: number;
  last: number | null;
}

/** Every flow at its latest version, with its runs. */
export function flowsView(store: UserStore): FlowSummary[] {
  return store.journal.flows().map((f) => ({
    id: f.id,
    name: f.name,
    version: f.version,
    trigger: f.trigger,
    by: f.by,
    enabled: f.enabled,
    steps: stepsOf(f.plan).length,
    ...store.journal.flowRuns(f.id),
  }));
}

/** A step as the canvas draws it: what it is, what it says in a word, and how it went in the period. */
export interface FlowNode {
  id: string;
  op: string;
  /** The tool or reader, or the ask's control / the reply's component. */
  what: string;
  /** The tool's title from the registry («Crear»), or null for a reader (the app names readers). */
  title: string | null;
  /** A word more: the collection a record is made in, the reader's question… */
  detail: string | null;
  /** «Crear en la elegida»: the collections it chooses among, by name (one: `detail` names it). */
  into?: string[];
  when: boolean;
  each: boolean;
  /** The step's arguments as text lines (`type: tarea`, `input: $text`), for its panel. */
  args: string[];
  /** The steps and inputs it takes its data from: the arrows into it. */
  deps: string[];
  /** How the step went in the period: how many times it ran, by the policy's decision. */
  ran: Record<string, number>;
  /** Its model calls of the period and what they cost (US dollars), when it asks a model. */
  calls?: number;
  cost?: number;
}
export interface FlowDetail extends FlowSummary {
  inputs: FlowInput[];
  nodes: FlowNode[];
  days: number;
  versions: { version: number; by: string; created: number }[];
  /** The plan itself: what the editor changes (its canvas lays itself out, nothing of where is kept). */
  plan: unknown;
  /** Boni's own version of it, when it has one (`Volver al de Boni`). */
  preset: number | null;
}

const DAY = 24 * 60 * 60_000;

/** A flow drawn: its inputs, its steps as nodes with their arrows, and what the period's runs made of each. */
export function flowView(
  store: UserStore,
  id: string,
  now: number,
  days: number,
  titleOf: (tool: string) => string | null,
  typeName: (key: string) => string | null,
): FlowDetail | null {
  const f = store.journal.flow(id);
  if (!f) return null;
  const counts = store.journal.stepCountsOf(id, now - days * DAY, now);
  const versions = store.journal.flowVersions(f.id);
  return {
    id: f.id,
    name: f.name,
    version: f.version,
    trigger: f.trigger,
    by: f.by,
    enabled: f.enabled,
    steps: stepsOf(f.plan).length,
    ...store.journal.flowRuns(f.id),
    inputs: inputsOf(f.plan, f.trigger),
    nodes: nodesOf(
      f.plan,
      f.trigger,
      titleOf,
      typeName,
      counts,
      store.journal.callsByStep(id, now - days * DAY, now),
    ),
    days,
    versions: versions.map((v) => ({ version: v.version, by: v.by, created: v.created })),
    plan: f.plan,
    preset: versions.find((v) => v.by === "preset")?.version ?? null,
  };
}

/** A plan's steps as nodes: named from the registry, their arguments as text, their arrows, their counts. */
export function nodesOf(
  plan: unknown,
  trigger: unknown,
  titleOf: (tool: string) => string | null,
  typeName: (key: string) => string | null,
  counts: readonly { step: string; decision: string; n: number }[] = [],
  calls: readonly { step: string; calls: number; cost: number }[] = [],
): FlowNode[] {
  const steps = stepsOf(plan);
  const ids = new Set(steps.map((s) => s.id));
  const inputs = inputsOf(plan, trigger);
  return steps.map((s) => {
    const op = String(s.op ?? "");
    const what =
      op === "call"
        ? String(s.tool ?? "")
        : op === "read"
          ? String(s.reader ?? "")
          : op === "ask"
            ? String(s.control ?? "")
            : op === "reply"
              ? String(s.component ?? "")
              : op;
    const args = (
      op === "call"
        ? s.args
        : op === "read"
          ? { input: s.input, ...((s.params as object | undefined) ?? {}) }
          : op === "ask"
            ? { prompt: s.prompt, options: s.options }
            : s.data
    ) as Record<string, unknown> | undefined;
    const keys =
      op === "call" ? typeKeysOf((s.args as Record<string, unknown> | undefined)?.type) : [];
    const typeLit = keys.length === 1 ? (keys[0] as string) : null;
    const ran: Record<string, number> = {};
    for (const c of counts) if (c.step === s.id) ran[c.decision] = (ran[c.decision] ?? 0) + c.n;
    const asked = calls.find((c) => c.step === s.id);
    return {
      id: s.id,
      op,
      what,
      title: op === "call" ? titleOf(what) : null,
      detail: typeLit ? (typeName(typeLit) ?? typeLit) : null,
      ...(keys.length > 1 ? { into: keys.map((k) => typeName(k) ?? k) } : {}),
      when: s.when !== undefined,
      each: s.each !== undefined,
      args: Object.entries(args ?? {})
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}: ${exprText(v)}`),
      deps: refsOf(s).filter((r) => r !== s.id && (ids.has(r) || inputs.some((i) => i.id === r))),
      ran,
      ...(asked ? { calls: asked.calls, cost: Math.round(asked.cost * 10000) / 10000 } : {}),
    };
  });
}

const litOf = (v: unknown): string | null =>
  v && typeof v === "object" && typeof (v as { lit?: unknown }).lit === "string"
    ? ((v as { lit: string }).lit as string)
    : null;

/** A plan expression as a short text: `$m.asunto`, `"Docencia"`, `concat($text, "…")`, `[a, b]`. */
export function exprText(v: unknown, depth = 0): string {
  if (v === null || v === undefined) return "";
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => exprText(x, depth + 1)).join(", ")}]`;
  const o = v as Record<string, unknown>;
  if ("lit" in o) return typeof o.lit === "string" ? JSON.stringify(cut(o.lit)) : String(o.lit);
  if ("ref" in o) return String(o.ref);
  if ("quote" in o) return `«${cut(String(o.quote))}»`;
  if ("fn" in o && Array.isArray(o.args)) {
    if (depth > 2) return `${String(o.fn)}(…)`;
    return `${String(o.fn)}(${o.args.map((x) => exprText(x, depth + 1)).join(", ")})`;
  }
  return `{${Object.keys(o).join(", ")}}`;
}
const cut = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}…` : s);

// ------------------------------------------------------------------ triggers

/** What starts a flow (docs/flujos.md §4.3): a new mail, by hand with a form, on a schedule, or new mail in the
 * mailbox (Boni's «Traer correo»: it binds nothing; its piece brings what the connector found). */
export type Trigger =
  | { created: string }
  | { manual: true; inputs?: { name: string }[] }
  | { schedule: { every: "day" | "week" | "hour"; at?: string; day?: number } }
  | { connector: "mail" }
  | { learning: "mail" };

/** The names a trigger binds to the plan. */
export function triggerNames(trigger: unknown): string[] {
  const t = trigger as { created?: unknown; schedule?: unknown } | null;
  if (typeof t?.created === "string") return Object.keys(MAIL_INPUTS);
  if (t?.schedule) return ["today"];
  return manualInputs(trigger);
}

// ------------------------------------------------------------------ the editor: catalog, checklist, values

/** A field as the editor offers it: its key, name, kind and the roles it plays. */
interface CatalogField {
  key: string;
  name: string;
  type: string;
  roles: string[];
  relation: string | null;
}
export interface FlowCatalog {
  tools: {
    name: string;
    title: string;
    effect: string;
    args: { name: string; role: string; required: boolean }[];
    /** A piece of Boni that works on the record that started the flow: only where a record starts it. */
    record?: boolean;
    /** A piece that changes the inbox: «Probar» says what it would do. */
    changes?: boolean;
  }[];
  readers: Record<string, { params: string[]; required: string[]; out: string[] }>;
  asks: string[];
  replies: Record<string, string[]>;
  fns: Record<string, [number, number]>;
  limits: { steps: number; each: number; nesting: number };
  /** The active extensions' functions («extension/name»), their names, their code and their tests (task 93). */
  functions: { id: string; name: string; code: string; tests: string[] }[];
  /** The collections a model may see (the ones a flow may name), with their fields and roles. */
  collections: {
    /** Its id, for the app only: what a rule of the reading guide names it by (the decider's panel, task 83). */
    id?: string;
    key: string;
    name: string;
    parent: string | null;
    fields: CatalogField[];
  }[];
  /** The mail extension's modules (what read_message gives, per module). */
  modules: string[];
}

/** What each reader answers, as the paths a later step may take (the planner's guide says the same). */
const ITEM_FIELDS = ["title", "due", "start", "end", "quote"];
const READER_OUT: Record<string, Shape> = {
  extract_tasks: rec({ tasks: list(rec(fieldsOf(["title", "due", "sender", "message_id"]))) }),
  classify: rec({ choice: TEXT() }),
  summarize: rec({ text: TEXT() }),
  rewrite: rec({ text: TEXT() }),
  answer_about: rec({ text: TEXT() }),
  review_reading: VALUE(),
  fill: rec({ values: rec({}), note: TEXT() }),
  summarize_each: rec({
    items: list(rec(fieldsOf(["line", "kind", "id", "type"]))),
    counts: list(rec({ option: TEXT(), n: NUM() })),
  }),
  label_each: rec({ choices: list(TEXT()), counts: list(rec({ option: TEXT(), n: NUM() })) }),
};

/**
 * The editor's catalog: what a node may be (the registry's tools, the readers, the rest of the plan language). Each
 * collection's id only for the app (`ids`: a rule of the reading guide names a collection by it); a model is told
 * collections by key, the only way a flow names one.
 */
export function flowCatalog(
  registry: ToolRegistry,
  store: UserStore,
  modules: readonly string[],
  o: { ids?: boolean } = {},
): FlowCatalog {
  const v = planVocabulary();
  const readers: FlowCatalog["readers"] = {};
  for (const [kind, spec] of Object.entries(v.readers))
    readers[kind] = {
      ...spec,
      out: paths(readerShape(kind, modules), 2).map((p) => p.path),
    };
  return {
    tools: registry.all().map((t) => ({
      name: t.name,
      title: t.title,
      effect: t.effect,
      args: Object.entries(t.args).map(([name, a]) => ({
        name,
        role: a.role,
        required: !!a.required,
      })),
      ...(t.record ? { record: true } : {}),
      ...(t.changes ? { changes: true } : {}),
    })),
    readers,
    asks: v.asks,
    replies: v.replies,
    fns: v.fns,
    limits: v.limits,
    // The active extensions' functions a «Función» step may name, with their code to read (task 93).
    functions: activeFunctions(store),
    collections: visibleTypes(store).map((def) => ({
      ...(o.ids ? { id: def.id } : {}),
      key: def.key,
      name: def.name,
      parent: def.parent ? (store.schema().types[def.parent]?.key ?? null) : null,
      fields: fieldsForEditor(store, def),
    })),
    modules: [...modules],
  };
}

/** The collections a model may see and write in: the user's own, not closed to the AI, not Boni's. */
function visibleTypes(store: UserStore): TypeDef[] {
  return Object.values(readStore(store).schema().types).filter((t) => !t.system);
}

function fieldsForEditor(store: UserStore, def: TypeDef): CatalogField[] {
  const roles = rolesOf(store.schema(), def.id) as Record<string, string | undefined>;
  const types = store.schema().types;
  return def.fields
    .filter((f) => !f.hidden && !f.archived)
    .map((f) => ({
      key: f.key,
      name: f.name,
      type: f.type,
      roles: Object.entries(roles)
        .filter(([, id]) => id === f.id)
        .map(([r]) => r)
        .concat(f.id === def.titleField ? ["title"] : []),
      relation: f.relation ? (types[f.relation.target]?.key ?? null) : null,
    }));
}

/** Something the checklist says (docs/flujos.md §4.5): a step (or the flow) and what is wrong, as a code. */
export interface Problem {
  step: string | null;
  /** Where in the step: `args.type`, `input`, `when`… */
  at: string | null;
  code: string;
}
/** A value a step may take, from the trigger or an earlier step: its reference and what it is. */
export interface RefOption {
  ref: string;
  t: Shape["t"];
}
export interface FlowCheck {
  problems: Problem[];
  /** For each step, the values it may take (the editor's picker), in order: inputs, earlier steps, the item. */
  refs: Record<string, RefOption[]>;
  /** For each step, what it gives (its panel's «Sale»; task 70): itself and its fields, as the next steps take them. */
  outs: Record<string, RefOption[]>;
}

/**
 * The checklist of a flow as the editor has it (docs/flujos.md §4.5): what the interpreter would refuse for its
 * trigger's origin and names (`checkPlan`, the run's own check), a collection the models may not see, a tool its
 * origin may not use; and, for each step, the values it may take from the trigger and the steps before it.
 */
export function checkFlow(
  store: UserStore,
  registry: ToolRegistry,
  flow: { trigger: unknown; plan: unknown },
  o: { modules: readonly string[]; mailType: string | null },
): FlowCheck {
  const problems: Problem[] = [];
  const steps = stepsOf(flow.plan);
  if (!triggerOk(flow.trigger)) problems.push({ step: null, at: "trigger", code: "bad-trigger" });
  if (!steps.length) problems.push({ step: null, at: null, code: "no-steps" });
  else {
    const origin = originOf(flow.trigger);
    // A name a step of the plan has is the step's, never the trigger's (Boni's pieces are steps named as the values
    // the code bound before F7: `only`, `known`, `inv`, `prefill`).
    const own = new Set(steps.map((s) => s.id));
    const bound = triggerNames(flow.trigger).filter((n) => !own.has(n));
    const v = checkPlan(flow.plan, registry, origin, bound, true);
    if (!v.ok) {
      const allowed = new Set(toolsFor(registry, origin, true).map((t) => t.name));
      for (const e of v.errors) {
        const m = /^step (\d+)((?:\.[^:]+)?): (.+)$/.exec(e);
        if (!m) {
          const p = /^plan: (.+)$/.exec(e);
          problems.push({ step: null, at: null, code: p ? (p[1] as string) : "bad-plan" });
          continue;
        }
        const s = steps[Number(m[1]) - 1];
        let code = m[3] as string;
        if (
          code === "unknown-tool" &&
          s &&
          typeof s.tool === "string" &&
          registry.get(s.tool) &&
          !allowed.has(s.tool)
        )
          code = registry.get(s.tool)?.effect === "flow" ? "flow-in-flow" : "tool-not-here";
        problems.push({
          step: s?.id ?? null,
          at: (m[2] as string).replace(/^\./, "") || null,
          code,
        });
      }
    }
    // A record in a collection the models may not see (or that does not exist): the run could not make it.
    const visible = new Set(visibleTypes(store).map((t) => t.key));
    const all = new Set(Object.values(store.schema().types).map((t) => t.key));
    for (const s of steps) {
      if (s.op !== "call" || typeof s.tool !== "string" || !s.tool.startsWith("entities."))
        continue;
      const given = (s.args as Record<string, unknown> | undefined)?.type;
      const keys = typeKeysOf(given);
      const hidden = keys.find((t) => !visible.has(t));
      if (hidden)
        problems.push({
          step: s.id,
          at: "args.type",
          code: all.has(hidden) ? "closed-collection" : "unknown-collection",
        });
      // The collection a step reads or writes is written in it, or chosen among some written in it (`case`), never
      // worked out as it runs: so the map says where a flow writes before it runs (docs/sistema.md §4.4, D-48; Home
      // Assistant's «Related» misses what a variable picks).
      else if (given !== undefined && !keys.length)
        problems.push({ step: s.id, at: "args.type", code: "collection-not-literal" });
    }
  }
  // A piece of Boni that works on the record that started the flow (a mail) is only in a flow a record starts
  // (docs/sistema.md §4.2).
  const byRecord = typeof (flow.trigger as { created?: unknown } | null)?.created === "string";
  for (const s of steps)
    if (s.op === "call" && typeof s.tool === "string" && registry.get(s.tool)?.record && !byRecord)
      problems.push({ step: s.id, at: null, code: "piece-needs-record" });
  // «Función» names an active extension's function, literally (D-48: what a step does is written in it); «Aplicar
  // cambios» takes a «Función» step's result whole (task 93).
  for (const s of steps) {
    if (s.op !== "call") continue;
    const a = (s.args ?? {}) as Record<string, unknown>;
    if (s.tool === "function.run") {
      const id = (a.funcion as { lit?: unknown } | undefined)?.lit;
      if (typeof id !== "string" || !activeFunction(store, id))
        problems.push({ step: s.id, at: "args.funcion", code: "function-unknown" });
    }
    if (s.tool === "function.apply") {
      const ref = (a.cambios as { ref?: unknown } | undefined)?.ref;
      const head =
        typeof ref === "string" ? /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(ref)?.[1] : undefined;
      const from = head ? steps.find((x) => x.id === head) : undefined;
      if (!from || from.op !== "call" || from.tool !== "function.run")
        problems.push({ step: s.id, at: "args.cambios", code: "apply-needs-function" });
    }
  }
  // «Guardar en Correos» only in «Traer correo»; the review's pieces only in «Revisar la guía» (D-50, D-51): elsewhere
  // nothing would give them what they work on, and a scheduled run could meddle with a review under way.
  const startedBy = (flow.trigger ?? {}) as { connector?: unknown; learning?: unknown };
  for (const s of steps) {
    if (s.op !== "call" || typeof s.tool !== "string") continue;
    if (s.tool === "mail.save" && startedBy.connector !== "mail")
      problems.push({ step: s.id, at: null, code: "piece-needs-mailbox" });
    if (s.tool.startsWith("guide.") && startedBy.learning !== "mail")
      problems.push({ step: s.id, at: null, code: "piece-needs-decisions" });
  }
  // «Revisar la guía» measures and suggests, always: without them a review would spend the reviewer's call and its
  // rereading for nothing.
  if (startedBy.learning === "mail") {
    const always = (tool: string) =>
      steps.some(
        (s) => s.op === "call" && s.tool === tool && s.when === undefined && s.each === undefined,
      );
    if (!always("guide.measure") || !always("guide.suggest"))
      problems.push({ step: null, at: "trigger", code: "review-needs-steps" });
  }
  // «Traer correo» (D-50) brings the mail with its «Guardar en Correos», always: without it (or with it only on a
  // condition, or once per item), what the connector found would never be brought, and every look would be a run.
  if ((flow.trigger as { connector?: unknown } | null)?.connector === "mail") {
    const saves = steps.some(
      (s) =>
        s.op === "call" && s.tool === "mail.save" && s.when === undefined && s.each === undefined,
    );
    if (!saves) problems.push({ step: null, at: "trigger", code: "fetch-needs-save" });
  }
  // A flow never starts another (docs/flujos.md §4.3): `flows.run` is the planner's, in the user's turn.
  for (const s of steps)
    if (
      s.op === "call" &&
      typeof s.tool === "string" &&
      registry.get(s.tool)?.effect === "flow" &&
      !problems.some((p) => p.step === s.id && p.code === "flow-in-flow")
    )
      problems.push({ step: s.id, at: null, code: "flow-in-flow" });
  return { problems: problems.slice(0, 40), ...refsFor(store, flow, o) };
}

// ------------------------------------------------------------------ the values a step may take

export type Shape =
  | { t: "text" }
  | { t: "number" }
  | { t: "bool" }
  | { t: "value" }
  | { t: "record"; fields: Record<string, Shape> }
  | { t: "list"; of: Shape };
function TEXT(): Shape {
  return { t: "text" };
}
function NUM(): Shape {
  return { t: "number" };
}
function VALUE(): Shape {
  return { t: "value" };
}
function rec(fields: Record<string, Shape>): Shape {
  return { t: "record", fields };
}
function list(of: Shape): Shape {
  return { t: "list", of };
}
function fieldsOf(names: readonly string[]): Record<string, Shape> {
  return Object.fromEntries(names.map((n) => [n, TEXT()]));
}

function readerShape(kind: string, modules: readonly string[]): Shape {
  if (kind === "read_message") {
    const item = rec(fieldsOf(ITEM_FIELDS));
    return rec({
      all: list(rec({ ...fieldsOf(ITEM_FIELDS), module: TEXT() })),
      ...Object.fromEntries(modules.map((m) => [m, list(item)])),
    });
  }
  return READER_OUT[kind] ?? VALUE();
}

function fieldShape(f: FieldDef): Shape {
  if (f.type === "number") return NUM();
  if (f.type === "checkbox") return { t: "bool" };
  if (f.type === "multiselect") return list(TEXT());
  if (f.type === "relation") return f.relation?.many ? list(VALUE()) : VALUE();
  return TEXT();
}
function recordShape(def: TypeDef | undefined): Shape {
  if (!def) return rec({});
  return rec({
    id: TEXT(),
    ...Object.fromEntries(
      def.fields.filter((f) => !f.hidden && !f.archived).map((f) => [f.key, fieldShape(f)]),
    ),
  });
}

/** The shape of what a trigger binds. */
function inputShapes(trigger: unknown, types: TypeDef[]): Record<string, Shape> {
  const t = trigger as { created?: unknown; schedule?: unknown } | null;
  if (typeof t?.created === "string") {
    const relations = (def: TypeDef) =>
      rec(
        Object.fromEntries(
          def.fields
            .filter((f) => f.type === "relation" && !f.archived)
            .map((f) => [f.key, VALUE()]),
        ),
      );
    return {
      mail: TEXT(),
      text: TEXT(),
      subject: TEXT(),
      userIn: TEXT(),
      known: list(TEXT()),
      only: TEXT(),
      options: list(TEXT()),
      modules: VALUE(),
      guide: VALUE(),
      fill: rec(Object.fromEntries(types.map((d) => [d.key, VALUE()]))),
      prefill: rec(Object.fromEntries(types.map((d) => [d.key, relations(d)]))),
      adjuntos: TEXT(),
      inv: rec(fieldsOf(["uid", "titulo", "dia", "inicio", "fin", "nota", "linea"])),
      asked: { t: "bool" },
      again: { t: "bool" },
      writes: list(TEXT()),
    };
  }
  if (t?.schedule) return { today: TEXT() };
  return Object.fromEntries(manualInputs(trigger).map((n) => [n, TEXT()]));
}

/** What a step gives the steps after it. */
function stepShape(
  s: Step,
  byKey: Map<string, TypeDef>,
  mailType: TypeDef | undefined,
  modules: readonly string[],
): Shape {
  const args = (s.args ?? {}) as Record<string, unknown>;
  const typeOf = () => byKey.get(litOf(args.type) ?? "");
  let one: Shape = VALUE();
  if (s.op === "call") {
    switch (s.tool) {
      case "entities.get": {
        const id = args.id as { ref?: unknown } | undefined;
        one = recordShape(id?.ref === "$mail" ? mailType : undefined);
        break;
      }
      case "entities.query":
      case "entities.search":
        one = rec({ items: list(recordShape(typeOf())) });
        break;
      case "entities.create":
        one = recordShape(typeOf());
        break;
      case "entities.update":
        one = recordShape(undefined);
        break;
      case "entities.aggregate":
        one = NUM();
        break;
      // Whether the notice was sent.
      case "notify":
        one = { t: "bool" };
        break;
      // Boni's pieces (docs/sistema.md §4.2).
      case "mail.rule":
        one = TEXT();
        break;
      case "mail.known":
        one = list(TEXT());
        break;
      case "mail.invitation":
        one = rec(fieldsOf(["uid", "titulo", "dia", "inicio", "fin", "nota", "linea"]));
        break;
      // For each collection the flow writes in (by key), its relations.
      case "mail.relations":
        one = rec(
          Object.fromEntries(
            [...byKey.values()].map((def) => [
              def.key,
              rec(
                Object.fromEntries(
                  def.fields
                    .filter((f) => f.type === "relation" && !f.archived)
                    .map((f) => [f.key, VALUE()]),
                ),
              ),
            ]),
          ),
        );
        break;
      case "inbox.fold":
      case "inbox.accept_alone":
        one = NUM();
        break;
    }
  } else if (s.op === "read") one = readerShape(String(s.reader ?? ""), modules);
  else if (s.op === "ask") one = TEXT();
  return s.each !== undefined ? list(one) : one;
}

/** The shape at a reference's path (a key after a list takes it from every item, as the interpreter does). */
function shapeAt(env: Map<string, Shape>, ref: string): Shape | null {
  const m = /^\$([A-Za-z_][A-Za-z0-9_]*)((?:\.[A-Za-z_$][A-Za-z0-9_$]*|\[\d{1,4}\])*)$/.exec(ref);
  if (!m) return null;
  let cur = env.get(m[1] as string) ?? null;
  const parts = (m[2] as string).match(/\.[A-Za-z_$][A-Za-z0-9_$]*|\[\d{1,4}\]/g) ?? [];
  for (const p of parts) {
    if (!cur) return null;
    if (p.startsWith("[")) cur = cur.t === "list" ? cur.of : null;
    else {
      const k = p.slice(1);
      if (cur.t === "record") cur = cur.fields[k] ?? null;
      else if (cur.t === "list" && cur.of.t === "record") {
        const f = cur.of.fields[k];
        cur = f ? list(f) : null;
      } else cur = null;
    }
  }
  return cur;
}

/** A shape as the references it offers, down to `depth` keys. */
function paths(shape: Shape, depth: number, base = ""): { path: string; t: Shape["t"] }[] {
  const out: { path: string; t: Shape["t"] }[] = [];
  const walk = (s: Shape, at: string, d: number) => {
    if (at) out.push({ path: at, t: s.t });
    if (d >= depth) return;
    const fields =
      s.t === "record" ? s.fields : s.t === "list" && s.of.t === "record" ? s.of.fields : null;
    if (!fields) return;
    for (const [k, f] of Object.entries(fields))
      walk(s.t === "list" ? list(f) : f, at ? `${at}.${k}` : k, d + 1);
  };
  walk(shape, base, 0);
  return out;
}

const REFS_PER_STEP = 300;

/** What a step gives, as its panel says it: itself and its fields, at most this many. */
const OUTS_PER_STEP = 40;

/**
 * For each step, the values it may take (the trigger's, the earlier steps', and `$item`/`$zip` in a loop) and what it
 * gives (itself and its fields).
 */
function refsFor(
  store: UserStore,
  flow: { trigger: unknown; plan: unknown },
  o: { modules: readonly string[]; mailType: string | null },
): { refs: Record<string, RefOption[]>; outs: Record<string, RefOption[]> } {
  const types = visibleTypes(store);
  const byKey = new Map(types.map((t) => [t.key, t]));
  const mailType = o.mailType ? store.schema().types[o.mailType] : undefined;
  const env = new Map<string, Shape>(Object.entries(inputShapes(flow.trigger, types)));
  const out: Record<string, RefOption[]> = {};
  const outs: Record<string, RefOption[]> = {};
  for (const s of stepsOf(flow.plan)) {
    const local = new Map(env);
    const each = (s.each as { ref?: unknown } | undefined)?.ref;
    const zip = (s.zip as { ref?: unknown } | undefined)?.ref;
    if (typeof each === "string") {
      const l = shapeAt(env, each);
      local.set("item", l?.t === "list" ? l.of : VALUE());
    }
    if (typeof zip === "string") {
      const l = shapeAt(env, zip);
      local.set("zip", l?.t === "list" ? l.of : VALUE());
    }
    const opts: RefOption[] = [];
    for (const [name, shape] of local)
      for (const p of paths(shape, name === "fill" || name === "prefill" ? 1 : 3, name))
        if (opts.length < REFS_PER_STEP) opts.push({ ref: `$${p.path}`, t: p.t });
    out[s.id] = opts;
    const gives = stepShape(s, byKey, mailType, o.modules);
    env.set(s.id, gives);
    // A reply gives the steps after it nothing (the interpreter's value is null).
    outs[s.id] =
      s.op === "reply"
        ? []
        : paths(gives, 1, s.id)
            .slice(0, OUTS_PER_STEP)
            .map((p) => ({ ref: `$${p.path}`, t: p.t }));
  }
  return { refs: out, outs };
}

// ------------------------------------------------------------------ the user's changes

/** A new flow, off: an empty one by hand, or a copy of another's latest version. */
export function createFlow(
  store: UserStore,
  o: { name: string; from?: string },
  now: number,
): FlowRow | null {
  const from = o.from ? store.journal.flow(o.from) : null;
  if (o.from && !from) return null;
  // A copy of «Traer correo» or «Revisar la guía» starts by hand: their triggers are only theirs (D-50, D-51).
  const on = (from?.trigger ?? {}) as { connector?: unknown; learning?: unknown };
  const boniOnly = on.connector !== undefined || on.learning !== undefined;
  return store.journal.saveFlow({
    id: newFlowId(o.name),
    name: o.name,
    trigger: from && !boniOnly ? from.trigger : { manual: true },
    inputs: from ? from.inputs : [],
    plan: from ? from.plan : { version: 1, steps: [] },
    layout: null,
    by: "user",
    enabled: false,
    created: now,
  });
}

export type SaveResult =
  | { flow: FlowRow }
  | { error: "not-found" | "conflict" | "invalid" | "trigger" };

/**
 * The user's version of a flow (the editor's «Guardar»): only over the version he started from (`base`), only
 * with an empty checklist; it stays on or off as it was. The mail flow keeps its trigger.
 */
export function saveUserFlow(
  store: UserStore,
  id: string,
  edit: { base: number; name?: string; trigger?: unknown; plan: unknown },
  problems: readonly Problem[],
  now: number,
): SaveResult {
  const latest = store.journal.flow(id);
  if (!latest) return { error: "not-found" };
  if (latest.version !== edit.base) return { error: "conflict" };
  if (problems.length) return { error: "invalid" };
  const trigger = edit.trigger ?? latest.trigger;
  // Boni's «Leer correo», «Traer correo» and «Revisar la guía» keep what starts them; only «Traer correo» is started by
  // the connector, only «Revisar la guía» by Juan's decisions.
  if (
    (id === MAIL_FLOW || id === FETCH_FLOW || id === REVIEW_FLOW) &&
    JSON.stringify(trigger) !== JSON.stringify(latest.trigger)
  )
    return { error: "trigger" };
  const on = (trigger ?? {}) as { connector?: unknown; learning?: unknown };
  if (
    (id !== FETCH_FLOW && on.connector !== undefined) ||
    (id !== REVIEW_FLOW && on.learning !== undefined)
  )
    return { error: "trigger" };
  return {
    flow: store.journal.saveFlow({
      id,
      name: (edit.name ?? latest.name).slice(0, 80),
      trigger,
      inputs: inputsOf(edit.plan, trigger),
      plan: edit.plan,
      layout: null,
      by: "user",
      enabled: latest.enabled,
      created: now,
    }),
  };
}

/**
 * Back to a version (the editor's «Volver a esta»), as a new version: what it was, the user's. `preset`: back to
 * Boni's own (the last version Boni saved), which Boni keeps current again from then on.
 */
export function revertFlow(
  store: UserStore,
  id: string,
  to: { version: number } | { preset: true },
  now: number,
): FlowRow | null {
  const latest = store.journal.flow(id);
  if (!latest) return null;
  const versions = store.journal.flowVersions(id);
  const v =
    "preset" in to
      ? versions.find((x) => x.by === "preset")
      : versions.find((x) => x.version === to.version);
  if (!v) return null;
  return store.journal.saveFlow({
    id,
    name: v.name,
    trigger: v.trigger,
    inputs: v.inputs,
    plan: v.plan,
    layout: null,
    by: "preset" in to ? "preset" : "user",
    enabled: latest.enabled,
    created: now,
  });
}

// ------------------------------------------------------------------ «Probar» (F3)

/** A value as a step's line shows it: how many, a text, a number, a record's choice. */
export type Out =
  | { t: "list"; n: number }
  | { t: "text"; text: string }
  | { t: "number"; value: number }
  | { t: "record"; text: string | null; n: number | null }
  | { t: "none" };
/**
 * What one of Boni's pieces found in a test (docs/sistema.md §4.2), for its line on the canvas: the collection the
 * sender's rule sends the mail to (null: no rule, it goes on), what that sender already has proposed, the
 * invitation's event (or none; `held`: an external calendar has it), the records the mail names, and how many
 * proposals it would fold or accept alone (none in a test: they are made only when the mail is read).
 */
export type PieceSaid =
  | { piece: "mail.rule"; to: string | null }
  | { piece: "mail.known"; n: number }
  | {
      piece: "mail.invitation";
      title: string | null;
      day: string | null;
      start: string | null;
      held: boolean;
    }
  | { piece: "mail.relations"; found: { field: string; title: string }[] }
  | { piece: "inbox.fold"; n: number }
  | { piece: "inbox.accept_alone"; n: number }
  | { piece: "mail.save"; n: number }
  | { piece: "guide.decisions"; n: number; found: number }
  | {
      piece: "guide.measure";
      rules: number;
      examples: number;
      /** In «Probar»: how much mail it would read again; the measure itself otherwise. */
      would: number | null;
      before: number | null;
      after: number | null;
      total: number | null;
    }
  | { piece: "guide.suggest"; n: number };

/** What a step of a test did: the policy's decision, what it gave, and what it would have done. */
export interface TestStep {
  decision: string | null;
  rule: string | null;
  error: string | null;
  out: Out;
  /** One of Boni's pieces: what it found, in its own terms. */
  piece?: PieceSaid;
  would: {
    decision: string;
    rule: string | null;
    tool: string | null;
    title: string | null;
    type: string | null;
    text: string | null;
  }[];
}
export interface TestView {
  run: string;
  status: string;
  error: string | null;
  sample: { mail: string; subject: string } | null;
  steps: Record<string, TestStep>;
}

type PaintedLike = {
  t: string;
  value?: unknown;
  items?: unknown[];
  fields?: Record<string, unknown>;
};
const short = (s: string) => (s.length > 160 ? `${s.slice(0, 157)}…` : s);
/** The words of a painted value, as plain text (a record's title or choice or text first). */
function textOfPainted(p: unknown): string | null {
  const v = p as PaintedLike | null;
  if (!v) return null;
  if (v.t === "v")
    return typeof v.value === "string" ? short(v.value) : v.value == null ? null : String(v.value);
  if (v.t === "rec" && v.fields) {
    // A function's step says its summary (task 93).
    for (const k of ["choice", "title", "text", "titulo", "line", "resumen"])
      if (k in v.fields) return textOfPainted(v.fields[k]);
    return null;
  }
  return null;
}
function outOf(p: unknown): Out {
  const v = p as PaintedLike | null;
  if (!v) return { t: "none" };
  if (v.t === "list") return { t: "list", n: v.items?.length ?? 0 };
  if (v.t === "v") {
    if (typeof v.value === "number") return { t: "number", value: v.value };
    if (v.value === null || v.value === undefined) return { t: "none" };
    return { t: "text", text: short(String(v.value)) };
  }
  if (v.t === "rec" && v.fields) {
    // A reading gives lists by module: how many items it found in all.
    const all = v.fields.all as PaintedLike | undefined;
    return {
      t: "record",
      text: textOfPainted(v),
      n: all?.t === "list" ? (all.items?.length ?? 0) : null,
    };
  }
  return { t: "none" };
}

const paintedField = (p: unknown, k: string): unknown =>
  (p as PaintedLike | null)?.t === "rec" ? (p as PaintedLike).fields?.[k] : undefined;
const paintedText = (p: unknown): string | null => {
  const v = p as PaintedLike | null;
  return v?.t === "v" && typeof v.value === "string" && v.value ? short(v.value) : null;
};
const paintedNumber = (p: unknown): number => {
  const v = p as PaintedLike | null;
  return v?.t === "v" && typeof v.value === "number" ? v.value : 0;
};

/** What a piece's output says, read with the store (a relation's record by its title, a field by its name). */
function pieceSaid(store: UserStore, tool: string, out: unknown): PieceSaid | undefined {
  const v = out as PaintedLike | null;
  switch (tool) {
    case "mail.rule":
      return { piece: tool, to: paintedText(out) };
    case "mail.known":
      return { piece: tool, n: v?.t === "list" ? (v.items?.length ?? 0) : 0 };
    case "mail.invitation": {
      const title = paintedText(paintedField(out, "titulo"));
      const uid = paintedText(paintedField(out, "uid"));
      return {
        piece: tool,
        title,
        day: paintedText(paintedField(out, "dia")),
        start: paintedText(paintedField(out, "inicio")),
        held: !!title && !uid,
      };
    }
    case "mail.relations": {
      const types = Object.values(store.schema().types);
      const found: { field: string; title: string }[] = [];
      for (const [key, rec] of Object.entries(v?.t === "rec" ? (v.fields ?? {}) : {})) {
        const def = types.find((t) => t.key === key);
        for (const [fk, id] of Object.entries((rec as PaintedLike | null)?.fields ?? {})) {
          const rid = paintedText(id);
          const e = rid ? store.get(rid) : null;
          if (!e) continue;
          const title =
            e.entity.values[types.find((t) => t.id === e.entity.type)?.titleField ?? ""];
          const field = def?.fields.find((f) => f.key === fk || f.id === fk)?.name ?? fk;
          if (
            typeof title === "string" &&
            !found.some((x) => x.field === field && x.title === title)
          )
            found.push({ field, title: short(title) });
        }
      }
      return { piece: tool, found: found.slice(0, 6) };
    }
    case "inbox.fold":
    case "inbox.accept_alone":
    case "mail.save":
      return { piece: tool, n: paintedNumber(out) };
    // «Revisar la guía» (D-51): how many decisions and rules found; what it would read again; never a suggestion.
    case "guide.decisions":
      return {
        piece: tool,
        n: paintedNumber(paintedField(out, "decisions")),
        found: paintedNumber(paintedField(out, "found")),
      };
    case "guide.measure": {
      const num = (k: string) => {
        const x = paintedField(out, k);
        return x === undefined ? null : paintedNumber(x);
      };
      return {
        piece: tool,
        rules: num("rules") ?? 0,
        examples: num("examples") ?? 0,
        would: num("would"),
        before: num("before"),
        after: num("after"),
        total: num("total"),
      };
    }
    case "guide.suggest":
      return { piece: tool, n: 0 };
    default:
      return undefined;
  }
}

/** A dry run as the editor overlays it on the canvas: each step's decision, value and what it would have done. */
export function testView(
  store: UserStore,
  r: {
    run: string;
    status: string;
    error: string | null;
    outputs: Record<string, unknown>;
    would: Record<
      string,
      {
        decision: string;
        rule: string | null;
        tool: string | null;
        args: Record<string, unknown>;
      }[]
    >;
  },
  sample: { mail: string; subject: string } | null,
  titleOf: (tool: string) => string | null,
  plan: unknown = null,
): TestView {
  const types = Object.values(store.schema().types);
  const tools = new Map(
    stepsOf(plan).flatMap((x) =>
      x.op === "call" && typeof x.tool === "string" ? [[x.id, x.tool]] : [],
    ),
  );
  const steps: Record<string, TestStep> = {};
  for (const s of store.journal.steps(r.run)) {
    const d = (s.detail ?? {}) as { code?: unknown };
    // A piece that ended the run is logged twice (its call, then «end»): the call's line says what it found.
    if (s.decision === "end" && steps[s.step]) {
      steps[s.step] = { ...(steps[s.step] as TestStep), decision: "end", rule: s.rule };
      continue;
    }
    const tool = tools.get(s.step);
    const said = tool ? pieceSaid(store, tool, r.outputs[s.step]) : undefined;
    steps[s.step] = {
      decision: s.decision,
      rule: s.rule,
      error: s.decision === "stopped" && typeof d.code === "string" ? d.code : null,
      ...(said ? { piece: said } : {}),
      out: outOf(r.outputs[s.step]),
      would: (r.would[s.step] ?? []).map((w) => {
        const type = textOfPainted(w.args.type);
        const values = w.args.values as PaintedLike | undefined;
        const title =
          values?.t === "rec" && values.fields
            ? textOfPainted(values.fields.title ?? values.fields.titulo ?? null)
            : textOfPainted(w.args.text ?? w.args.prompt ?? null);
        return {
          decision: w.decision,
          rule: w.rule,
          tool: w.tool,
          title: w.tool ? titleOf(w.tool) : null,
          type: type ? (types.find((t) => t.key === type)?.name ?? type) : null,
          text: title,
        };
      }),
    };
  }
  return { run: r.run, status: r.status, error: r.error, sample, steps };
}

// ------------------------------------------------------------------ a flow a model proposes (F5)

/** A step of a proposed flow as the inbox draws it, and what it is against the flow it changes. */
export type ProposedNode = FlowNode & { change: "new" | "changed" | "same" | "removed" };

/**
 * A flow a model proposed (`flows.save`, docs/flujos.md F5) as the inbox draws it: its name, what starts it, its
 * steps as nodes; and, when it changes a flow, against that flow's version now, the steps it adds, changes and takes
 * away (those drawn too). Made by code from the proposal's arguments; the model's words are only its name and texts.
 */
export interface FlowProposal {
  name: string;
  changes: { id: string; name: string; version: number } | null;
  trigger: unknown;
  inputs: FlowInput[];
  nodes: ProposedNode[];
}

export function flowProposalView(
  store: UserStore,
  p: { tool: string; args: unknown },
  titleOf: (tool: string) => string | null,
  typeName: (key: string) => string | null,
): FlowProposal | null {
  if (p.tool !== "flows.save") return null;
  const values = ((p.args as { values?: Record<string, unknown> } | null)?.values ?? {}) as Record<
    string,
    { t?: unknown; value?: unknown } | undefined
  >;
  const val = (k: string) => (values[k]?.t === "v" ? values[k]?.value : undefined);
  const name = val("name");
  const flow = val("flow");
  const trigger = val("trigger") ?? null;
  const plan = val("plan") ?? null;
  if (typeof name !== "string") return null;
  const current = typeof flow === "string" ? store.journal.flow(flow) : null;
  const before = new Map(stepsOf(current?.plan).map((s) => [s.id, JSON.stringify(s)]));
  const mine = new Map(stepsOf(plan).map((s) => [s.id, JSON.stringify(s)]));
  const change = (id: string): ProposedNode["change"] =>
    !current
      ? "same"
      : !before.has(id)
        ? "new"
        : before.get(id) === mine.get(id)
          ? "same"
          : "changed";
  return {
    name: name.slice(0, 80),
    changes: current ? { id: current.id, name: current.name, version: current.version } : null,
    trigger,
    inputs: inputsOf(plan, trigger),
    nodes: [
      ...nodesOf(plan, trigger, titleOf, typeName).map((n) => ({ ...n, change: change(n.id) })),
      ...(current
        ? nodesOf(current.plan, current.trigger, titleOf, typeName)
            .filter((n) => !mine.has(n.id))
            .map((n) => ({ ...n, change: "removed" as const }))
        : []),
    ],
  };
}

/**
 * A run of a flow drawn as it ran (the review of task 90): when the version it ran is not the flow's latest (a reading
 * from before «Crear en la elegida» renamed its steps, or one from before flows), its plan and its steps as the editor
 * names them, so the map draws the run over its own boxes; null when the map's flow is the one it ran.
 */
export function drawnRun(
  store: UserStore,
  run: RunRow,
  owner: string | null,
  titleOf: (tool: string) => string | null,
  typeName: (key: string) => string | null,
): { version: number | null; plan: unknown; steps: FlowNode[] } | null {
  if (!owner?.startsWith("flow:")) return null;
  const id = owner.slice("flow:".length);
  const latest = store.journal.flow(id);
  if (!latest || (run.flow === id && run.flowVersion === latest.version)) return null;
  const v =
    run.flow === id && run.flowVersion !== null ? store.journal.flow(id, run.flowVersion) : null;
  const plan = v?.plan ?? run.plan;
  if (!stepsOf(plan).length) return null;
  return {
    version: v?.version ?? null,
    plan,
    steps: nodesOf(plan, v?.trigger ?? latest.trigger, titleOf, typeName),
  };
}
