/**
 * What the flow editor does to a plan (docs/flujos.md, F2), as pure functions: add, remove and move a step, set an
 * argument, use one step's value in another (an arrow), and change the collection a step writes in, so that its
 * fields follow their roles and the inputs of that collection (`$fill.<key>`, `$prefill.<key>`) follow its key. The
 * server checks the result (`checkFlow`); nothing here decides what is allowed.
 */
import type { FlowCatalog, FlowPlan, FlowStep, MailGuide, MailRule } from "./agent.ts";

export type Expr =
  | { lit: string | number | boolean | null }
  | { quote: string }
  | { ref: string }
  | { fn: string; args: Expr[] };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export const isExpr = (v: unknown): v is Expr =>
  isObj(v) && ("lit" in v || "ref" in v || "quote" in v || ("fn" in v && Array.isArray(v.args)));

/** The inputs whose name is followed by a collection's key (docs/flujos.md §4.1). */
export const PER_COLLECTION = ["fill", "prefill"];

/**
 * The collections a step's `type` names, by key (apps/server flows.ts `typeKeysOf`): its literal, or the results of
 * a `case` over literals («Crear en la elegida», docs/sistema.md §4.2: one of a literal list, D-48).
 */
export function typeKeysOf(v: unknown): string[] {
  const lit = (x: unknown) =>
    isExpr(x) && "lit" in x && typeof x.lit === "string" ? (x.lit as string) : null;
  const one = lit(v);
  if (one) return [one];
  if (!isExpr(v) || !("fn" in v) || v.fn !== "case" || !Array.isArray(v.args)) return [];
  const args = v.args as unknown[];
  if (args.length < 3 || args.length % 2 === 0) return [];
  const keys: string[] = [];
  for (let i = 1; i < args.length; i += 2) {
    const key = lit(args[i + 1]);
    if (!lit(args[i]) || !key) return [];
    keys.push(key);
  }
  return [...new Set(keys)];
}

/**
 * The collections a decider's choice sends things to (docs/sistema.md §4.2, «Crear en la elegida»; D-48): the
 * collection of each other step (a record's `type`, a reader's `collection`) that is a `case` over its `choice` (never
 * a `case` that gives a field's key), and, in a plan of a lane per choice (before «Crear en la elegida»), the collection
 * of each step that runs only when its choice is one option; in the order they come, none when no step goes by it.
 */
export function decidesAmong(plan: FlowPlan, stepId: string): string[] {
  const choice = `$${stepId}.choice`;
  const byChoice = (x: unknown) => (x as { ref?: unknown } | undefined)?.ref === choice;
  const overChoice = (v: unknown) =>
    isObj(v) && v.fn === "case" && Array.isArray(v.args) && byChoice(v.args[0]);
  /** A step's condition is «its choice is this option» (alone or among others joined by `and`). */
  const inLane = (when: unknown): boolean => {
    if (!isObj(when) || !Array.isArray(when.args)) return false;
    if (when.fn === "and") return when.args.some(inLane);
    return when.fn === "eq" && when.args.some(byChoice);
  };
  const keys: string[] = [];
  for (const s of plan.steps) {
    if (s.id === stepId) continue;
    const type = isObj(s.args) ? s.args.type : undefined;
    const collection = isObj(s.params) ? s.params.collection : undefined;
    for (const c of [type, collection]) if (overChoice(c)) keys.push(...typeKeysOf(c));
    if (inLane(s.when) && isExpr(type) && "lit" in type) keys.push(...typeKeysOf(type));
  }
  return [...new Set(keys)];
}

/**
 * The rules of the reading guide that choose one of a decider's collections (`keys`) without a model, in the guide's
 * order: those that send a sender to one of them, and that no earlier rule takes first (the server's `ruleFor`: the
 * first that matches wins; «@dominio» matches every address that ends so).
 */
export function guideRulesFor(
  guide: MailGuide,
  keys: readonly string[],
  keyOfId: (id: string) => string | null | undefined,
): MailRule[] {
  const low = (s: string) => s.trim().toLowerCase();
  const shadowed = (i: number) => {
    const from = low(guide.rules[i]?.from ?? "");
    return guide.rules.slice(0, i).some((r) => {
      const earlier = low(r.from);
      return earlier.startsWith("@") ? from.endsWith(earlier) : from === earlier;
    });
  };
  return guide.rules.filter(
    (r, i) =>
      r.action === "collection" &&
      !!r.collection &&
      keys.includes(keyOfId(r.collection) ?? "") &&
      !shadowed(i),
  );
}

/** Names said as a person lists them: «Tarea, Evento o Persona» (`or` is the language's word, with its spaces). */
export function listText(names: readonly string[], or: string): string {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")}${or}${names[names.length - 1]}`;
}

/** A step id not used yet: the base, or the base and a number. */
export function newStepId(plan: FlowPlan, base: string): string {
  const clean =
    base
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^[^a-z]+/, "")
      .replace(/_+$/, "")
      .slice(0, 24) || "paso";
  const used = new Set(plan.steps.map((s) => s.id));
  if (!used.has(clean) && clean !== "item" && clean !== "zip") return clean;
  for (let i = 2; ; i++) if (!used.has(`${clean}_${i}`)) return `${clean}_${i}`;
}

/** What a new node is: a tool, a reader, a question or a reply. */
export type NodeKind =
  | { op: "call"; tool: string }
  | { op: "read"; reader: string }
  | { op: "ask"; control: string }
  | { op: "reply"; component: string };

/** A new step of that kind, with what it needs empty (the checklist says what is missing). */
export function newStep(plan: FlowPlan, kind: NodeKind): FlowStep {
  const base =
    kind.op === "call"
      ? (kind.tool.split(".").pop() ?? "paso")
      : kind.op === "read"
        ? kind.reader
        : kind.op;
  const id = newStepId(plan, base);
  switch (kind.op) {
    case "call":
      return { id, op: "call", tool: kind.tool, args: {} };
    case "read":
      return { id, op: "read", reader: kind.reader, input: { lit: "" }, params: {} };
    case "ask":
      return { id, op: "ask", control: kind.control, prompt: { lit: "" } };
    case "reply":
      return { id, op: "reply", component: kind.component, data: {} };
  }
}

/** The plan with `step` after `after` (at the end without it). */
export function addStep(plan: FlowPlan, step: FlowStep, after?: string | null): FlowPlan {
  const steps = [...plan.steps];
  const i = after ? steps.findIndex((s) => s.id === after) : -1;
  steps.splice(i >= 0 ? i + 1 : steps.length, 0, step);
  return { ...plan, steps };
}

/** The plan with `step` right before `before` (where the canvas's «+» between two steps was pressed). */
export function insertStep(plan: FlowPlan, step: FlowStep, before: string): FlowPlan {
  const steps = [...plan.steps];
  const i = steps.findIndex((s) => s.id === before);
  steps.splice(i >= 0 ? i : steps.length, 0, step);
  return { ...plan, steps };
}

/**
 * The plan with a copy of that step right after it, under an id of its own, and that id (what took the original's
 * value keeps it; task 70, the node's menu).
 */
export function duplicateStep(plan: FlowPlan, id: string): { plan: FlowPlan; id: string | null } {
  const step = plan.steps.find((s) => s.id === id);
  if (!step) return { plan, id: null };
  const copy = { ...(JSON.parse(JSON.stringify(step)) as FlowStep), id: newStepId(plan, step.id) };
  return { plan: addStep(plan, copy, id), id: copy.id };
}

/** The plan as far as that step, it included («Probar hasta aquí»: what comes after it is not run). */
export function planUpTo(plan: FlowPlan, id: string): FlowPlan {
  const i = plan.steps.findIndex((s) => s.id === id);
  return i < 0 ? plan : { ...plan, steps: plan.steps.slice(0, i + 1) };
}

/** The references a step reads (`$m.asunto`, `$r.tasks`), each once, as they appear (its panel's «Entra»). */
export function refsUsed(step: FlowStep): string[] {
  const out: string[] = [];
  const scan = (v: unknown): void => {
    if (Array.isArray(v)) for (const x of v) scan(x);
    else if (isObj(v)) {
      if (typeof v.ref === "string" && !out.includes(v.ref)) out.push(v.ref);
      for (const x of Object.values(v)) scan(x);
    }
  };
  scan(step);
  return out;
}

/** The plan without that step (what took its value is said by the checklist). */
export function removeStep(plan: FlowPlan, id: string): FlowPlan {
  return { ...plan, steps: plan.steps.filter((s) => s.id !== id) };
}

/** The plan with that step right after another (steps run in order: a value is taken from an earlier one). */
export function moveAfter(plan: FlowPlan, id: string, after: string): FlowPlan {
  const step = plan.steps.find((s) => s.id === id);
  if (!step || id === after) return plan;
  const rest = plan.steps.filter((s) => s.id !== id);
  const i = rest.findIndex((s) => s.id === after);
  if (i < 0) return plan;
  rest.splice(i + 1, 0, step);
  return { ...plan, steps: rest };
}

/** The step with `path` set to `value` (or taken out when it is undefined): `["args", "type"]`, `["when"]`. */
export function setAt(
  plan: FlowPlan,
  id: string,
  path: readonly string[],
  value: unknown,
): FlowPlan {
  return {
    ...plan,
    steps: plan.steps.map((s) => (s.id === id ? (setIn(s, path, value) as FlowStep) : s)),
  };
}
function setIn(
  o: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
): Record<string, unknown> {
  const [head, ...rest] = path;
  if (head === undefined) return o;
  const out = { ...o };
  if (!rest.length) {
    if (value === undefined) delete out[head];
    else out[head] = value;
    return out;
  }
  const inner = isObj(out[head]) ? (out[head] as Record<string, unknown>) : {};
  out[head] = setIn(inner, rest, value);
  return out;
}

/** The steps and inputs a step takes values from (`$name` at the head of its references). */
export function depsOf(step: FlowStep): string[] {
  const out = new Set<string>();
  const scan = (v: unknown): void => {
    if (Array.isArray(v)) for (const x of v) scan(x);
    else if (isObj(v)) {
      if (typeof v.ref === "string") {
        const m = /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(v.ref);
        if (m && m[1] !== "item" && m[1] !== "zip") out.add(m[1] as string);
      }
      for (const x of Object.values(v)) scan(x);
    }
  };
  scan(step);
  out.delete(step.id);
  return [...out];
}

/**
 * Where a step may take another's value (an arrow drawn from one to the other): its arguments, its reader's input
 * and parameters, its question, its reply's data, by path.
 */
export function slotsOf(step: FlowStep, catalog: FlowCatalog): string[][] {
  switch (step.op) {
    case "call": {
      const tool = catalog.tools.find((t) => t.name === step.tool);
      return (tool?.args ?? []).map((a) => ["args", a.name]);
    }
    case "read":
      return [
        ["input"],
        ...(catalog.readers[String(step.reader)]?.params ?? []).map((p) => ["params", p]),
      ];
    case "ask":
      return [["prompt"], ...(step.control === "choice" ? [["options"]] : [])];
    case "reply":
      return (catalog.replies[String(step.component)] ?? []).map((d) => ["data", d]);
    default:
      return [];
  }
}

/** Uses `from`'s value at a slot of `to`; `to` moves after `from` when it ran before it. */
export function takeValue(
  plan: FlowPlan,
  from: string,
  to: string,
  slot: readonly string[],
): FlowPlan {
  const set = setAt(plan, to, slot, { ref: `$${from}` });
  const order = set.steps.map((s) => s.id);
  return order.indexOf(to) < order.indexOf(from) ? moveAfter(set, to, from) : set;
}

/** Every expression in a value, rewritten by `f` (atoms and functions alike, innermost first). */
function mapExpr(v: unknown, f: (e: Expr) => Expr): unknown {
  if (Array.isArray(v)) return v.map((x) => mapExpr(x, f));
  if (!isObj(v)) return v;
  if (isExpr(v)) {
    if ("fn" in v) return f({ fn: v.fn, args: v.args.map((a) => mapExpr(a, f) as Expr) });
    return f(v);
  }
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapExpr(x, f)]));
}

/** The key of the field playing `role` in a collection (`title` for its title). */
function keyFor(c: FlowCatalog["collections"][number] | undefined, role: string): string | null {
  return c?.fields.find((f) => f.roles.includes(role))?.key ?? null;
}

/**
 * The step writing in another collection (docs/flujos.md §4.5): its `type`, the values its record is made of (a field
 * goes to the new collection's field playing the same role, or of the same key; one with no place goes), and the
 * per-collection inputs it and the step it walks along with take (`$fill.<old>` becomes `$fill.<new>`).
 */
export function changeCollection(
  plan: FlowPlan,
  id: string,
  to: string,
  catalog: FlowCatalog,
): FlowPlan {
  const step = plan.steps.find((s) => s.id === id);
  if (!step || step.op !== "call") return plan;
  const args = isObj(step.args) ? step.args : {};
  const from = isObj(args.type) && typeof args.type.lit === "string" ? args.type.lit : null;
  const old = catalog.collections.find((c) => c.key === from);
  const next = catalog.collections.find((c) => c.key === to);
  // A key of the old collection, as it goes in the new one (null: it has no place there).
  const rekey = (k: string): string | null => {
    if (k === "title" || k === "body") return k;
    const f = old?.fields.find((x) => x.key === k);
    for (const r of f?.roles ?? []) {
      const n = keyFor(next, r);
      if (n) return r === "title" ? "title" : n;
    }
    return next?.fields.some((x) => x.key === k) ? k : null;
  };
  const rewriteObj = (e: Expr): Expr => {
    if (!("fn" in e) || e.fn !== "obj") return e;
    const args2: Expr[] = [];
    for (let i = 0; i + 1 < e.args.length; i += 2) {
      const k = e.args[i];
      const v = e.args[i + 1] as Expr;
      if (!k || !("lit" in k) || typeof k.lit !== "string") {
        args2.push(k as Expr, v);
        continue;
      }
      const nk = rekey(k.lit);
      if (nk && !args2.some((a, j) => j % 2 === 0 && "lit" in a && a.lit === nk))
        args2.push({ lit: nk }, v);
    }
    return { fn: "obj", args: args2 };
  };
  const rename = (e: Expr): Expr => {
    if (!from || !("ref" in e)) return e;
    for (const p of PER_COLLECTION) {
      const head = `$${p}.${from}`;
      if (e.ref === head || e.ref.startsWith(`${head}.`) || e.ref.startsWith(`${head}[`))
        return { ref: `$${p}.${to}${e.ref.slice(head.length)}` };
    }
    return e;
  };
  // The step it walks along with (`zip`): the reader that fills this record's fields reads this collection's.
  const zipped =
    isObj(step.zip) && typeof step.zip.ref === "string" ? step.zip.ref.replace(/^\$/, "") : null;
  return {
    ...plan,
    steps: plan.steps.map((s) => {
      if (s.id === id) {
        const a = isObj(s.args) ? s.args : {};
        return {
          ...(mapExpr(s, rename) as FlowStep),
          args: {
            ...(mapExpr(a, rename) as Record<string, unknown>),
            type: { lit: to },
            ...(a.values !== undefined
              ? { values: mapExpr(mapExpr(a.values, rename), rewriteObj) }
              : {}),
          },
        };
      }
      if (zipped && s.id === zipped) return mapExpr(s, rename) as FlowStep;
      return s;
    }),
  };
}

/** An expression as a short text (as the server's `exprText`): `$m.asunto`, `"Docencia"`, `concat($text, …)`. */
export function exprText(v: unknown, depth = 0): string {
  if (v === null || v === undefined) return "";
  if (!isObj(v)) return JSON.stringify(v);
  if ("lit" in v) return typeof v.lit === "string" ? JSON.stringify(v.lit) : String(v.lit);
  if ("ref" in v) return String(v.ref);
  if ("quote" in v) return `«${String(v.quote)}»`;
  if ("fn" in v && Array.isArray(v.args)) {
    if (depth > 2) return `${String(v.fn)}(…)`;
    return `${String(v.fn)}(${v.args.map((x) => exprText(x, depth + 1)).join(", ")})`;
  }
  return "";
}
