// The rounds of an automation's «Agente» (docs/automatizaciones.md §5.6, AU-56, AU-197, AU-198, F15 E3): in each round
// the model writes a plan in the plan language of today, the code validates it and runs it call by call through the
// engine's tools (each one decided by the policy there), and what the labels let a planner see goes back for the next
// round, cut to `AGENT_VIEW`, until an answer or «Rondas máximas».
//
// It is pure: the model is a `Planner` the server's port gives (S1) or a test scripts, and every call to a collection
// is the engine's (`AgentCall.tool`), which narrows it by the step's connection as saved and asks the policy. Nothing
// a model writes chooses what is allowed (A-01): a plan is only a list of requests.
import { join, type Label } from "@boni/entities";
import { callFn, FnError } from "./fns.ts";
import {
  type Expr,
  MAX_EACH,
  type Plan,
  type PlanCatalog,
  type Step,
  validatePlan,
} from "./plan.ts";
import {
  atOrNull,
  codeLabel,
  deepLabel,
  type Json,
  leaf,
  list,
  parseRef,
  plain,
  rec,
  truthy,
  type Val,
} from "./values.ts";
import { toPlannerView } from "./view.ts";

/**
 * What a round gives back to the next one, at most (AU-198): rows and characters of the planner's view. Measured with
 * 3,000 rows (automation-ai.test.ts): cutting them to these takes a few milliseconds, far below a model's answer.
 * `count` and `sum` give one number and are never cut: an agent that needs a total asks for it so.
 */
export const AGENT_VIEW = { rows: 200, chars: 20_000 } as const;

/** A value as the engine holds it: plain JSON, its label, and the labels of its fields where they have their own. */
export interface Labelled {
  json: Json;
  label: Label;
  fields?: Readonly<Record<string, { label: Label }>>;
}

/** A field of «Respuesta» as «Campos» (AU-53): its key, its type, and the line that says what goes in it. */
export interface AnswerField {
  key: string;
  type: "text" | "number" | "date" | "boolean" | "options";
  line: string;
  options?: string[];
}

/** The tools a round may call: the reads only with «Las decide la IA» (AU-51), the writes, and the answer. */
export const READ_TOOLS = ["find", "get", "count", "sum"] as const;
export const WRITE_TOOLS = ["create", "update", "trash"] as const;
export type AgentTool = (typeof READ_TOOLS)[number] | (typeof WRITE_TOOLS)[number];

/**
 * A «Herramienta de código» (AU-58) as the model knows it: its name and its inputs, each a name and a type. Its code
 * stays with the engine, which runs it in the box when a plan calls it by name.
 */
export interface CodeTool {
  name: string;
  inputs: { name: string; type: string }[];
}

/** What a tool gives back: rows read, one value, what a write will do («Creará 1 fila en …»), or a refusal. */
export type ToolReply =
  | { rows: Labelled[]; of?: number }
  | { value: Labelled }
  | { planned: string }
  | { refused: string };

/**
 * One unit of work of an «Agente», as the engine sends it to the port (§7): the closed list of AU-197 and the engine's
 * tools. `instructions`: «Instrucciones» resolved, each part with its label (a part from outside goes as a handle).
 * `connections`: what the model may know of each connected collection, built by the engine from the version as
 * saved. `written`: the label of what the model writes in this step.
 */
export interface AgentCall {
  use: "agent";
  model: string | null;
  instructions: Labelled[];
  rows: Labelled[];
  connections: Json;
  answer: { kind: "text" } | { kind: "fields"; fields: AnswerField[] };
  reads: boolean;
  /** «Herramientas de código» (AU-58): tools of the plan by name, besides the reads and writes. */
  codeTools?: CodeTool[];
  maxRounds: number;
  today: string;
  zone: string;
  language: string;
  written: Label;
  /** Before every call to the model, retries included (AU-206): throws to stop the run. */
  modelCall(): void;
  /**
   * «Reintentar si el modelo falla» (packages/automations `AI_RETRY`): how many times a call is asked again after the
   * planner says it timed out or the provider failed on its side (`transient`); absent or 0, never.
   */
  retries?: number;
  /** Before retry `n`: waits, then counts the call and checks the run's time; throws to stop the run. */
  retry?(n: number): Promise<void>;
  /** After every answer of the model: which one answered and how long it took (AU-54). */
  called(model: string | undefined, ms: number): void;
  now(): number;
  /** A call of the plan, for the engine to narrow, decide and make, or to gather (writes). Throwing fails the unit. */
  tool(name: AgentTool | string, args: Readonly<Record<string, Labelled>>): Promise<ToolReply>;
}

/** What the model receives in one call (AU-197): nothing else, and a test breaks if anything else enters. */
export interface AgentRequest {
  use: "agent";
  model: string | null;
  instructions: Json;
  connections: Json;
  rows: Json;
  /** What each earlier round returned, by the planner's view: `$round1.s1`, … */
  rounds: Json[];
  /** What the view left out («Vio 200 de 3.000 filas»). */
  seen: Seen[];
  answer: Json;
  tools: string[];
  /** The «Herramientas de código», when the step has any: each one's name and inputs, never its code. */
  codeTools?: Json;
  today: string;
  zone: string;
  language: string;
  /** A plan or an answer that did not fit, asked again once in the same round (AU-198). */
  again?: { fault: "plan" | "reply"; errors: string[] };
}

/**
 * How the server's port (S1) or a test's script answers: a plan, as the model wrote it, or why there is none.
 * `transient`: the call timed out or the provider failed on its side (a 5xx), the only refusal a retry follows.
 */
export type Planner = (
  request: AgentRequest,
) => Promise<
  { plan: unknown; model: string } | { refused: string; model?: string; transient?: true }
>;

/** What the view of a round left out: at a path, how many of how many. */
export interface Seen {
  at: string;
  saw: number;
  of: number;
}

export type AgentFault = "agent.plan" | "agent.rounds" | "agent.reply";
export type AgentReply =
  | { answer: Record<string, Labelled>; rounds: number; seen: Seen[] }
  | { fault: AgentFault; errors: string[]; rounds: number; seen: Seen[] }
  | { refused: string; rounds: number; seen: Seen[] };

const ANSWER = "answer";
/** What a reply of the code to the model is labelled: the code's words, never a model's. */
const SAID = codeLabel("agent");
const LINK_OR_HTML = /(https?:\/\/|www\.|<\s*\/?\s*[a-z!]|\]\(|javascript:|data:)/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TEXT_MAX = 4000;

/** The answer's keys: «Texto» is `texto` (AU-53). */
export const answerKeys = (answer: AgentCall["answer"]): string[] =>
  answer.kind === "text" ? ["texto"] : answer.fields.map((f) => f.key);

/** The catalogue a round's plan is validated with: only these tools, with these arguments. */
export function roundCatalog(call: Pick<AgentCall, "answer" | "codeTools">): PlanCatalog {
  const tools: Record<string, { names: string[]; required: string[]; objects?: string[] }> = {
    create: { names: ["collection", "fields"], required: ["collection", "fields"] },
    update: { names: ["collection", "id", "fields"], required: ["collection", "id", "fields"] },
    trash: { names: ["collection", "id"], required: ["collection", "id"] },
    [ANSWER]: { names: answerKeys(call.answer), required: [] },
  };
  // The reads stay valid when the round may not read («Las hace este código»): the request does not offer them, and
  // one asked anyway is refused and told (`read-off`, AU-51), not taken for a plan that is not one.
  Object.assign(tools, {
    find: { names: ["collection", "query"], required: ["collection"], objects: ["query"] },
    get: { names: ["collection", "id"], required: ["collection", "id"] },
    count: { names: ["collection", "query"], required: ["collection"], objects: ["query"] },
    sum: {
      names: ["collection", "field", "query"],
      required: ["collection", "field"],
      objects: ["query"],
    },
  });
  // A code tool never takes a built-in's name: validation refuses one (packages/automations).
  for (const t of call.codeTools ?? [])
    if (!Object.hasOwn(tools, t.name)) {
      const names = t.inputs.map((i) => i.name);
      tools[t.name] = { names, required: names };
    }
  return { args: (tool) => (Object.hasOwn(tools, tool) ? (tools[tool] ?? null) : null) };
}

/** A labelled value of the engine as a value of a plan: a row's fields keep their own labels. */
export function valOf(v: Labelled): Val {
  const j = v.json;
  if (j !== null && typeof j === "object" && !Array.isArray(j))
    return rec(
      Object.fromEntries(
        Object.entries(j).map(([k, x]) => [k, leaf(x, v.fields?.[k]?.label ?? v.label)]),
      ),
      v.label,
    );
  return leaf(j, v.label);
}

/** A value of a plan as the engine takes it: its JSON, the label of all of it, and each field's when it is a record. */
export function labelledOf(v: Val): Labelled {
  const out: Labelled = { json: plain(v), label: deepLabel(v) };
  if (v.t === "rec")
    out.fields = Object.fromEntries(
      Object.entries(v.fields).map(([k, f]) => [k, { label: deepLabel(f) }]),
    );
  return out;
}

/**
 * The planner's view of `v`, cut to what is left of the round's budget (AU-198): the items of a list one by one while
 * rows and characters last, and what was left out in `seen`. A value that is not a list is whole or not at all.
 */
function cutView(
  v: Val,
  path: string,
  budget: { rows: number; chars: number },
  seen: Seen[],
): Json {
  if (v.t === "list") {
    const out: Json[] = [];
    for (const [i, item] of v.items.entries()) {
      if (budget.rows <= 0) break;
      const view = toPlannerView(item, `${path}[${i}]`);
      const chars = JSON.stringify(view).length + 1;
      if (chars > budget.chars) break;
      budget.rows--;
      budget.chars -= chars;
      out.push(view);
    }
    if (out.length < v.items.length) seen.push({ at: path, saw: out.length, of: v.items.length });
    return out;
  }
  const view = toPlannerView(v, path);
  const chars = JSON.stringify(view).length;
  if (chars > budget.chars) {
    seen.push({ at: path, saw: 0, of: 1 });
    return { $cut: path } as Json;
  }
  budget.chars -= chars;
  return view;
}

/** Whether `v` fits an answer field: its type or null; a text the model wrote is plain (no link, no HTML). */
function fits(f: AnswerField, v: Val): boolean {
  if (v.t !== "v") return false;
  const x = v.value;
  if (x === null) return true;
  if (f.type === "text")
    return (
      typeof x === "string" &&
      [...x].length <= TEXT_MAX &&
      // A text cited by its handle is put by the code as it is, and painted as plain text anyway (I-02).
      (v.label.integrity !== "model" || !LINK_OR_HTML.test(x))
    );
  if (f.type === "number") return typeof x === "number" && Number.isFinite(x);
  if (f.type === "date")
    return typeof x === "string" && DAY.test(x) && !Number.isNaN(Date.parse(x));
  if (f.type === "boolean") return typeof x === "boolean";
  return typeof x === "string" && (f.options ?? []).includes(x);
}

/** The answer checked against its shape (AU-53): each key its type or null, nothing else; or what is wrong. */
function answerOf(
  call: AgentCall,
  given: Record<string, Val>,
): { answer: Record<string, Labelled> } | { errors: string[] } {
  const fields: AnswerField[] =
    call.answer.kind === "text" ? [{ key: "texto", type: "text", line: "" }] : call.answer.fields;
  const errors: string[] = [];
  const answer: Record<string, Labelled> = {};
  for (const f of fields) {
    const v = given[f.key] ?? leaf(null, call.written);
    if (!fits(f, v)) {
      errors.push(`answer.${f.key}: not-${f.type}`);
      continue;
    }
    // The answer is the model's, and also of whatever it cites (AU-53): a text from outside stays from outside.
    answer[f.key] = { json: plain(v), label: join(call.written, deepLabel(v)) };
  }
  return errors.length ? { errors } : { answer };
}

class Rounds {
  readonly call: AgentCall;
  readonly planner: Planner;
  readonly env = new Map<string, Val>();
  readonly views: Json[] = [];
  readonly seen: Seen[] = [];
  rows: Json = [];
  rounds = 0;

  constructor(call: AgentCall, planner: Planner) {
    this.call = call;
    this.planner = planner;
    this.env.set(
      "rows",
      list(
        call.rows.map((r) => valOf(r)),
        join(SAID, ...call.rows.map((r) => r.label)),
      ),
    );
    this.env.set("instructions", list(call.instructions.map(valOf), SAID));
  }

  request(again?: AgentRequest["again"]): AgentRequest {
    const c = this.call;
    return {
      use: "agent",
      model: c.model,
      instructions: (this.env.get("instructions") as Extract<Val, { t: "list" }>).items.map(
        (v, i) => toPlannerView(v, `$instructions[${i}]`),
      ),
      connections: c.connections,
      rows: this.rows,
      rounds: [...this.views],
      seen: [...this.seen],
      answer:
        c.answer.kind === "text"
          ? { kind: "text", key: "texto" }
          : ({ kind: "fields", fields: c.answer.fields } as unknown as Json),
      tools: [
        ...(c.reads ? READ_TOOLS : []),
        ...WRITE_TOOLS,
        ...(c.codeTools ?? []).map((t) => t.name),
        ANSWER,
      ],
      ...(c.codeTools?.length
        ? {
            codeTools: c.codeTools.map((t) => ({
              name: t.name,
              inputs: t.inputs.map((i) => ({ name: i.name, type: i.type })),
            })),
          }
        : {}),
      today: c.today,
      zone: c.zone,
      language: c.language,
      ...(again ? { again } : {}),
    };
  }

  /**
   * One call to the model, counted first (AU-206), and asked again up to `retries` times after a `transient` refusal,
   * each retry waited, counted and timed by the engine first (`retry`).
   */
  async ask(again?: AgentRequest["again"]) {
    this.call.modelCall();
    const request = this.request(again);
    const once = async () => {
      const start = this.call.now();
      const got = await this.planner(request);
      this.call.called(got.model, this.call.now() - start);
      return got;
    };
    let got = await once();
    const retries = this.call.retries ?? 0;
    for (let n = 1; "refused" in got && got.transient && this.call.retry && n <= retries; n++) {
      await this.call.retry(n);
      got = await once();
    }
    return got;
  }

  /** A plan as the model wrote it, validated: the plan language with this round's tools, and only calls in it. */
  check(given: unknown): { plan: Plan } | { errors: string[] } {
    const bound = ["rows", "instructions", ...this.views.map((_, i) => `round${i + 1}`)];
    const valid = validatePlan(given, roundCatalog(this.call), "", bound);
    if (!valid.ok) return { errors: valid.errors };
    // No asking, no reader, no reply (AU-198): a round's plan only calls its tools.
    const errors = valid.plan.steps
      .map((s, i) => (s.op === "call" ? null : `step ${i + 1}: not-in-a-round`))
      .filter((e): e is string => e !== null);
    return errors.length ? { errors } : { plan: valid.plan };
  }

  /** A plan that is valid, asked again once in the round when it is not (AU-198), or the fault. */
  async plan(): Promise<{ plan: Plan } | { refused: string } | { fault: string[] }> {
    let again: AgentRequest["again"];
    for (let attempt = 0; attempt < 2; attempt++) {
      const got = await this.ask(again);
      if ("refused" in got) return { refused: got.refused };
      const checked = this.check(got.plan);
      if ("plan" in checked) return checked;
      again = { fault: "plan", errors: checked.errors.slice(0, 20) };
    }
    return { fault: again?.errors ?? [] };
  }

  evalExpr(e: Expr, scope: Map<string, Val>): Val {
    if ("lit" in e) return leaf(e.lit, this.call.written);
    if ("quote" in e) return leaf(null, this.call.written);
    if ("ref" in e) {
      const path = parseRef(e.ref) ?? [];
      const head = scope.get(String(path[0]));
      return head ? atOrNull(head, path.slice(1)) : leaf(null, this.call.written, true);
    }
    return callFn(
      e.fn,
      e.args.map((a) => this.evalExpr(a, scope)),
      this.call.today,
    );
  }

  /** Runs one call step for one scope: the tool's reply as a value, or the function's error as one. */
  async one(
    s: Extract<Step, { op: "call" }>,
    scope: Map<string, Val>,
    answer: { given?: Record<string, Val> },
  ): Promise<Val> {
    let args: Record<string, Val>;
    try {
      args = Object.fromEntries(
        Object.entries(s.args).map(([k, e]) => [k, this.evalExpr(e, scope)]),
      );
    } catch (e) {
      if (e instanceof FnError) return leaf({ error: e.message }, SAID);
      throw e;
    }
    if (s.tool === ANSWER) {
      answer.given = args;
      return leaf(null, SAID);
    }
    const reply = await this.call.tool(
      s.tool,
      Object.fromEntries(Object.entries(args).map(([k, v]) => [k, labelledOf(v)])),
    );
    if ("refused" in reply) return leaf({ refused: reply.refused }, SAID);
    if ("planned" in reply) return leaf({ planned: reply.planned }, SAID);
    if ("value" in reply) return valOf(reply.value);
    return list(reply.rows.map(valOf), SAID);
  }

  /** Runs a plan: each step in order, with `when` and `each`; the answer, when it calls one. */
  async run(plan: Plan): Promise<{ results: Record<string, Val>; given?: Record<string, Val> }> {
    const results: Record<string, Val> = {};
    const answer: { given?: Record<string, Val> } = {};
    const scope = new Map(this.env);
    for (const s of plan.steps) {
      if (s.op !== "call") continue;
      if (s.when && !truthy(this.evalExpr(s.when, scope))) {
        results[s.id] = leaf(null, SAID);
        scope.set(s.id, results[s.id] as Val);
        continue;
      }
      let out: Val;
      if (s.each) {
        const over = this.evalExpr(s.each, scope);
        const items = over.t === "list" ? over.items.slice(0, MAX_EACH) : [];
        const zip = s.zip ? this.evalExpr(s.zip, scope) : undefined;
        const got: Val[] = [];
        for (const [i, item] of items.entries()) {
          const inner = new Map(scope);
          inner.set("item", item);
          if (zip?.t === "list" && zip.items[i]) inner.set("zip", zip.items[i] as Val);
          got.push(await this.one(s, inner, answer));
        }
        out = list(got, over.label);
      } else out = await this.one(s, scope, answer);
      results[s.id] = out;
      scope.set(s.id, out);
    }
    return { results, ...(answer.given ? { given: answer.given } : {}) };
  }

  /** What a round gave, bound for the next as `$roundN` and shown by its view, cut to `AGENT_VIEW`. */
  keep(results: Record<string, Val>): void {
    const n = this.views.length + 1;
    const value = rec(results, SAID);
    this.env.set(`round${n}`, value);
    const budget = { rows: AGENT_VIEW.rows, chars: AGENT_VIEW.chars };
    this.views.push(
      Object.fromEntries(
        Object.entries(results).map(([k, v]) => [
          k,
          cutView(v, `$round${n}.${k}`, budget, this.seen),
        ]),
      ),
    );
  }

  async go(): Promise<AgentReply> {
    const done = <T extends object>(x: T) => ({ ...x, rounds: this.rounds, seen: [...this.seen] });
    // The input rows by the planner's view, cut like a round's (AU-55).
    this.rows = cutView(this.env.get("rows") as Val, "$rows", { ...AGENT_VIEW }, this.seen);
    const max = Math.max(1, this.call.maxRounds);
    while (this.rounds < max) {
      this.rounds++;
      const planned = await this.plan();
      if ("refused" in planned) return done({ refused: planned.refused });
      if ("fault" in planned) return done({ fault: "agent.plan" as const, errors: planned.fault });
      let ran = await this.run(planned.plan);
      if (ran.given) {
        let checked = answerOf(this.call, ran.given);
        if ("errors" in checked) {
          // Not its shape: asked again once in the round, with what the plan gave (AU-53).
          this.keep(ran.results);
          const again = await this.plan2({ fault: "reply", errors: checked.errors });
          if ("refused" in again) return done({ refused: again.refused });
          if ("fault" in again) return done({ fault: "agent.plan" as const, errors: again.fault });
          ran = await this.run(again.plan);
          checked = ran.given ? answerOf(this.call, ran.given) : { errors: ["answer: missing"] };
          if ("errors" in checked)
            return done({ fault: "agent.reply" as const, errors: checked.errors });
        }
        return done({ answer: checked.answer });
      }
      this.keep(ran.results);
    }
    return done({ fault: "agent.rounds" as const, errors: [] });
  }

  /** The plan asked again after an answer that did not fit: one call, and a plan that is not one is the fault. */
  async plan2(
    again: NonNullable<AgentRequest["again"]>,
  ): Promise<{ plan: Plan } | { refused: string } | { fault: string[] }> {
    const got = await this.ask(again);
    if ("refused" in got) return { refused: got.refused };
    const checked = this.check(got.plan);
    return "plan" in checked ? checked : { fault: checked.errors };
  }
}

/**
 * The rounds of one unit of work (AU-198): a plan per round, run by the code; an answer checked against its shape ends
 * them. What stops them is said as a fault (`agent.plan`, `agent.rounds`, `agent.reply`) or the port's refusal; a
 * throw of `modelCall` or of a tool passes through untouched (the run's limit, a unit that fails).
 */
export function runRounds(call: AgentCall, planner: Planner): Promise<AgentReply> {
  return new Rounds(call, planner).go();
}

/**
 * What the model of an «Agente» is told in every round (AU-197, S1): the step's own words come in the request
 * (`instructions`), never here. It speaks only of «the connected collections» (D-14) and receives nothing of what
 * Boni knows of the person and none of their instructions for assistants (PR 490, choice 3). The code checks every
 * plan and decides every call; this text only helps the model write one that passes.
 */
export const AGENT_PROMPT = `You are one step of an automation the user built. You never act and you have no tools of
your own: each round you answer with one plan, which the code checks and runs call by call. The code decides what is
allowed; a call it refuses comes back as {"refused": "<reason>"} and the rest of the plan goes on.

Input (JSON): "instructions" (what the user wants this step to do: each item is {json, ...}), "rows" (the rows that
came into the step, or what its code gave), "connections" (the only collections you may use: each one's key, name,
description, its fields with their types and, for an option field, the values it takes, and what you may do with it:
"read", "create", "update", "trash", each false or with its limits), "rounds" (what each earlier round's plan gave,
as "$round1", "$round2"…), "seen" (what a view left out: at a path, how many of how many), "answer" (the shape of the
answer you must give), "tools" (the tools you may call this round), "codeTools" (more tools, by name and inputs),
"today", "zone" and "language" (the language of any text you write). "again": your last plan or answer did not fit,
with the reasons; write it again.

The plan: {"version": 1, "steps": [...]}, at most 40 steps, each {"id", "op": "call", "tool", "args": {name: expr}}
with a unique id (lowercase letters, digits, _), and optionally "when": expr and "each": {"ref": "$step"} (once per
item, the item is "$item"). Only "call": no other op runs here.
Tools: find {collection, query} (query: {"lit": {...}} with "where", "sort" and "limit"), get {collection, id},
count {collection, query}, sum {collection, field, query}; create {collection, fields}, update {collection, id,
fields}, trash {collection, id}; answer {<the answer's fields>}, which ends the rounds. Collections by their key.
Expressions: {"lit": x} (one string, number, boolean or null; a JSON object only for "query"), {"ref":
"$rows[0].field"}, {"ref": "$round1.s1"}, {"ref": "$instructions"}, or {"fn": name, "args": [...]} (count, sum, min,
max, pick, item, field, filter_eq, concat, obj, merge, list, length, eq, ne, gt, lt, and, or, not, today, add_days,
case; obj(key, value, ...) builds the "fields" of create and update).

Read what you need first and write in a later round: a round sees only what earlier rounds gave. Some values come as
handles ({"handle": "..."}) instead of their text: you may pass them on, never read them. Write only what the
instructions ask, only in the connected collections, only with values that fit each field. When you are done, call
answer.`;

/** The JSON schema of a round's plan (AU-198): the plan language's, with the argument names this round's tools take. */
export function roundArgNames(call: Pick<AgentCall, "answer" | "codeTools">): string[] {
  const names = new Set([
    "collection",
    "fields",
    "id",
    "query",
    "field",
    ...answerKeys(call.answer),
  ]);
  for (const t of call.codeTools ?? []) for (const i of t.inputs) names.add(i.name);
  return [...names];
}
