/**
 * The engine: one run of an automation from one trigger (docs/automatizaciones.md §5.2). A pure core: it knows the
 * graph, the rows and the catalogue, and everything else arrives in `RunDeps` (effects.ts). It walks the steps in
 * `executionOrder`, one at a time; gives each step the rows its arrows bring; does the looping for the steps that
 * work row by row; and leaves a record of every step. The same automation with the same data gives the same
 * `Execution` twice, but for the times it took.
 *
 * How a step is decided (AU-10, AU-14), once every step an arrow reaches it from has finished:
 * - it runs when some arrow brings rows, or when an arrow comes from an output of a step whose «Seguir sin filas»
 *   is on and that step ran (then it may run with an empty list; no empty row is invented);
 * - if not, it is `skipped`, and so is what hangs only from it.
 * A step that runs with an empty list: an action that works with all the rows is called with none; one that works
 * row by row and reads or writes (the catalogue's `effect`) is called once with no row, so «Crear una fila» can say
 * «no hay nada» with fixed values, and a citation of `$json` fails with `noCurrentRow`; one that works row by row
 * and only changes or sorts out the rows it receives is not called and gives none.
 * The rows that reach one input by several arrows are put together in the order of `arrowsInto` (AU-11), and the
 * step runs once. «Seguir sin filas» does not count for the output «error».
 *
 * The label of the path (AU-164): the engine sets `Row.path` on every row a step gives. It is the join of the path
 * of the row it comes from (for a step that works with all the rows, of every row it received), and of the labels
 * of what decided that it exists or came this way: the fields a condition of the step tested, the values its
 * conditions and its `changesRows` parameters resolved to, and for a row read from a collection, the label of the
 * conditions it was searched with. A write is judged with it (`PolicyCall.control`).
 *
 * When a step fails (AU-16): the unit that failed (one row in a step that works row by row, the whole step if not)
 * is tried again up to `retry.times` more times, waiting `retry.waitMs` before each (`Clock.sleep`). If it still
 * fails: «Parar» ends the run as `failed`, and every step not yet decided is `stopped`; «Seguir» drops the rows
 * that failed and goes on; «Salir por error» sends them out by `OUT.error`, each with the field `ERROR_FIELD`.
 */
import type { Label, Labeled } from "@boni/entities";
import {
  type Box,
  type ConsoleLine,
  type EvaluateInput,
  evaluate,
  limitFault,
  type ReadRecord,
  rowsOf,
  type StepEvaluation,
  seedOf,
} from "./box.ts";
import {
  actionOf,
  inputsOf,
  isTrigger,
  outputsOf,
  type ParamSpec,
  paramsOf,
  paramValue,
} from "./catalogue.ts";
import {
  CODE_LIMITS,
  CODE_PARAMS,
  CODE_TYPE,
  type CodeFailure,
  CodeFault,
  type CodeMode,
} from "./code.ts";
import { COLLECTION } from "./collection.ts";
import {
  type Asked,
  type Clock,
  type Collections,
  type Dates,
  Denied,
  type Gate,
  guard,
  type Policy,
  type WriteResult,
} from "./effects.ts";
import {
  type Citation,
  CiteError,
  citationsIn,
  codeParts,
  resolve,
  type Scope,
} from "./expression.ts";
import { type StepFailure, StepFault } from "./failures.ts";
import {
  type Automation,
  isExpr,
  OUT,
  type ParamValue,
  SETTINGS_DEFAULTS,
  type Step,
} from "./format.ts";
import { arrowsInto, executionOrder } from "./graph.ts";
import { type CodeContext, readCode } from "./javascript.ts";
import type { Cell, Row } from "./rows.ts";
import { fieldLabel, joinAll, StopRun, TRANSFORM_AND_LOGIC } from "./steps.ts";
import { canRun, type Problem, type ValidationContext, validate } from "./validate.ts";
import {
  applyWrites,
  CONNECTION_ASKS,
  grantsOf,
  permissionOf,
  readWrites,
  type StepWrites,
  type WriteGate,
  type WriteRequest,
} from "./writes.ts";

export { StopRun } from "./steps.ts";

/** A step's state in a run (AU-15). `waiting` is for the steps that wait for Juan or for a time (F18). */
export const STEP_STATES = [
  "queued",
  "running",
  "done",
  "failed",
  "skipped",
  "stopped",
  "waiting",
] as const;
export type StepState = (typeof STEP_STATES)[number];

/** The field a row that leaves by «error» gains: `{ message, rule? }`, the reason it failed (AU-16). */
export const ERROR_FIELD = "error";

export interface StepError {
  message: string;
  /** The policy's rule, when the policy said no. */
  rule?: string;
  /** The index, in the step's input, of the row it failed on; absent when the whole step failed. */
  row?: number;
  /** Why, as a key the screen can say, with the parameter at fault (failures.ts; set from F14b on). */
  failure?: StepFailure;
  /**
   * F14c: why its JavaScript failed (code.ts), while `failure.code` is `other`: the screen says this one, with the
   * words of `CODE_FAILURES` (boni-web's `words.ts`). The code's own message (`code.threw`) is here, in
   * `detail.message`, and never in `message`.
   */
  why?: CodeFailure;
}

/** What is kept of a step in a run (AU-15). What an AI step cost arrives with those steps (F15). */
export interface StepRecord {
  state: StepState;
  /** How many rows came in by each input. */
  in: Record<string, number>;
  /** What came out by each output, in order: the rows themselves (their count is its length). */
  out: Record<string, Row[]>;
  /** How long it took, waits between tries included. */
  ms: number;
  /** How many tries beyond the first, over all its rows. */
  retries: number;
  /** Rows that failed and were dropped («Seguir») or sent out by «error». */
  failed: number;
  /** Writes that were not done because they wait for Juan (they are in `Execution.asked`). */
  asked: number;
  /** Why it failed, when `state` is `failed`; with «Seguir», the first failure of a row. */
  error?: StepError;
  /** «Consola» (AU-33, F14c): what its JavaScript wrote, cut to `CODE_LIMITS.consoleLines`; `dropped` counts the rest. */
  console?: { lines: ConsoleLine[]; dropped: number };
  /** The reads its JavaScript made through the step's connections (AU-161, F14c): what, how much, never the rows. */
  reads?: ReadRecord[];
  /** Whether its JavaScript read the clock or chance (AU-34, F14c): what the screen says of a kept step that did. */
  uses?: { clock: boolean; random: boolean };
  /**
   * What its «Código» asked to save, as one change (AU-174, AU-181): saved, what a test would do and whether a run
   * would ask, or what waits for Juan. Absent when it asked for nothing, or when the step failed and saved nothing.
   */
  writes?: StepWrites;
}

export interface Execution {
  automation: { id: string; version: number };
  /** The id of the trigger step it started in (AU-06). */
  trigger: string;
  test: boolean;
  /** `done`: every step was decided. `failed`: a step stopped it. */
  state: "done" | "failed";
  /** Epoch ms, from the clock. */
  started: number;
  /**
   * The seed of its chance (AU-34, F14c): with `started`, which is also the instant its JavaScript sees, all a run
   * knows of the clock and of chance. `RunInput.seed`, or one made from `started` when it has none. Only in a run
   * where some JavaScript went to the box.
   */
  seed?: number;
  ms: number;
  /** `executionOrder`: the steps that hang from the trigger, in the order they were decided. */
  order: string[];
  /** By step id: every step of `order`. A step the trigger does not reach has no record. */
  steps: Record<string, StepRecord>;
  /** What the run wants to write and waits for Juan, in order: one proposal for the whole run (decision 4 of §10). */
  asked: Asked[];
  /** The step that stopped the run and why, when `state` is `failed`. */
  error?: StepError & { step: string };
}

export interface RunInput {
  automation: Automation;
  /** The id of the trigger step this run starts in. */
  trigger: string;
  /**
   * The row the trigger gives: for «Disparado por el usuario», the «Campos que pide» with what it was started with
   * and the label of who gave them (AU-110). A field the trigger declares and this lacks is null; one it does not
   * declare is refused before anything runs. The engine sets its `parent` and `path`.
   */
  fields: Pick<Row, "json" | "label" | "fields">;
  /** Runs everything and writes nothing (`PolicyCall.test`). */
  test: boolean;
  /**
   * The seed of the run's chance (AU-34): drawn once by whoever starts the run and kept with it, so repeating the run
   * with it and with the same instant gives the same. Absent: made from the run's instant.
   */
  seed?: number;
}

export interface RunDeps {
  policy: Policy;
  collections: Collections;
  clock: Clock;
  dates: Dates;
  /** The label of what Juan wrote in the automation itself: its fixed values (`Scope.literal`). */
  own: Label;
  /** The language «Dar formato» writes in. */
  locale: string;
  /**
   * Where JavaScript runs (box.ts, F14c). Without one, an automation with JavaScript does not run: validation refuses
   * it (`expr.code`) as before F14c. With one, validation reads the code (`CodeContext`).
   */
  box?: Box;
  /** A collection's key by its name as Juan sees it now: what `$col('…')` cites (javascript.ts). */
  collectionNamed?(name: string): string | undefined;
}

/**
 * What a run validates with: the collections' shapes and, with a box, what reading code needs (`CodeContext`), so
 * JavaScript is checked instead of refused.
 */
export function validationOf(deps: RunDeps): ValidationContext | CodeContext {
  const collection = (key: string) => deps.collections.shape(key);
  if (!deps.box) return { collection };
  return { collection, collectionNamed: (name) => deps.collectionNamed?.(name) };
}

/**
 * Runs an automation from a trigger to the end. It validates first and rejects with `CannotRun`, before any effect, when
 * `validate` gives an error, the trigger is not a trigger step of the automation, or the trigger's row has a field it
 * does not ask for or one of another type; after that it never throws: what goes wrong is in the `Execution`. The
 * limits of a run (AU-17) and saving it (AU-15 in tables) are F14d's.
 */
export async function run(input: RunInput, deps: RunDeps): Promise<Execution> {
  const problems = validate(input.automation, validationOf(deps) as ValidationContext);
  if (!canRun(problems)) throw new CannotRun("the automation has errors", problems);
  const trigger = input.automation.steps.find((s) => s.id === input.trigger);
  if (!trigger || !isTrigger(trigger))
    throw new CannotRun(`${input.trigger} is not a trigger of the automation`);
  return new Run(input, deps, triggerRow(trigger, input.fields)).go();
}

/**
 * What a test of part of a draft decides (partial.ts): the steps in the order they are decided, and the records
 * taken as they were kept instead of running their steps. Each reused step comes before what hangs from it, and
 * everything it hangs from is reused too, so its rows keep their lineage.
 */
export interface Plan {
  order: string[];
  reuse: ReadonlyMap<string, StepRecord>;
}

/** `run` for a test: the same run, from a trigger checked by the caller, with the order and the reuse of `plan`. */
export function runPlanned(
  input: RunInput,
  deps: RunDeps,
  trigger: Step,
  plan: Plan,
): Promise<Execution> {
  return new Run(input, deps, triggerRow(trigger, input.fields), plan).go();
}

/** The trigger's row a run would start with, or `CannotRun` (AU-110): what `run` checks before any effect. */
export function checkTriggerRow(step: Step, given: RunInput["fields"]): void {
  triggerRow(step, given);
}

/** Why a run did not start: the automation's errors, or a trigger or a row it cannot start with. Nothing was done. */
export class CannotRun extends Error {
  readonly problems: readonly Problem[];
  constructor(message: string, problems: readonly Problem[] = []) {
    super(message);
    this.name = "CannotRun";
    this.problems = problems;
  }
}

/** What a value of each type a trigger asks for may be (catalogue: «Disparado por el usuario»). Null is no value. */
const TRIGGER_TYPES: Record<string, (v: Cell) => boolean> = {
  text: (v) => typeof v === "string",
  number: (v) => typeof v === "number" && Number.isFinite(v),
  checkbox: (v) => typeof v === "boolean",
  date: (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v),
  datetime: (v) => typeof v === "number" && Number.isFinite(v),
};

/** The trigger's row (AU-110): every field it asks for, null where none was given; another field is refused. */
function triggerRow(step: Step, given: RunInput["fields"]): Row {
  const types = new Map<string, string>();
  for (const f of Array.isArray(step.params.fields) ? step.params.fields : []) {
    const o = f as Record<string, ParamValue>;
    if (typeof o.key === "string") types.set(o.key, typeof o.type === "string" ? o.type : "text");
  }
  for (const k of Object.keys(given.json))
    if (!types.has(k)) throw new CannotRun(`the trigger does not ask for the field ${k}`);
  const json: Record<string, Cell> = {};
  for (const [k, type] of types) {
    const v = given.json[k] ?? null;
    if (v !== null && !TRIGGER_TYPES[type]?.(v))
      throw new CannotRun(`the field ${k} is not of type ${type}`);
    json[k] = v;
  }
  const fields = Object.fromEntries(
    Object.entries(given.fields ?? {}).filter(([k]) => types.has(k)),
  );
  return {
    json,
    label: given.label,
    ...(Object.keys(fields).length ? { fields } : {}),
    path: null,
    parent: null,
  };
}

/** A step that neither reads nor writes gets a gate that refuses everything: it has no way to the collections. */
export const CLOSED: Gate = {
  shape: closed,
  find: closed,
  get: closed,
  aggregate: closed,
  write: closed,
  decideAll: closed,
  writeAll: closed,
};
function closed(): never {
  throw new Error("this step does not read or write collections");
}

/** The fields a parameter that changes the rows names, by input: what they hold decided the path (AU-164). */
function namedFields(p: ParamSpec, v: ParamValue | undefined): { input: string; field: string }[] {
  if (v === undefined || v === null) return [];
  if (
    p.control === "choice" &&
    !Array.isArray(p.options) &&
    "of" in p.options &&
    p.options.of === "input"
  )
    return typeof v === "string" ? [{ input: p.options.input, field: v }] : [];
  if (p.control === "conditions" && p.over.of === "input") {
    const input = p.over.input;
    const fields: { input: string; field: string }[] = [];
    const walk = (x: ParamValue) => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (typeof x === "object" && x !== null && !isExpr(x)) {
        if (typeof x.field === "string" && typeof x.op === "string")
          fields.push({ input, field: x.field });
        if (Array.isArray(x.rules)) walk(x.rules);
      }
    };
    walk(v);
    return fields;
  }
  if (p.control === "list" && Array.isArray(v))
    return v.flatMap((item) =>
      typeof item === "object" && item !== null && !Array.isArray(item) && !isExpr(item)
        ? p.columns.flatMap((c) => namedFields(c, item[c.key]))
        : [],
    );
  return [];
}

const hasExpr = (v: ParamValue | undefined): boolean =>
  isExpr(v) ||
  (Array.isArray(v)
    ? v.some(hasExpr)
    : typeof v === "object" && v !== null && Object.values(v).some(hasExpr));

/** A step's failure for the log and for the screen: the English message, the policy's rule and its code (AU-84). */
function stepErrorOf(e: unknown, step: Step): StepError {
  return {
    message: e instanceof Error ? e.message : String(e),
    ...(e instanceof Denied ? { rule: e.rule } : {}),
    failure: failureOf(e, step),
    ...(e instanceof CodeFault ? { why: e.why } : {}),
  };
}

function failureOf(e: unknown, step: Step): StepFailure {
  if (e instanceof StepFault) return e.failure;
  if (e instanceof StopRun) return { code: "stopped", detail: { message: e.message } };
  if (e instanceof Denied) return { code: e.waits ? "policy.waits" : "policy.denied" };
  if (e instanceof CiteError) {
    const param = citedIn(step, e.cite);
    return {
      code: `cite.${e.failure}`,
      ...(param ? { param } : {}),
      ...(e.cite.step === null ? {} : { detail: { step: e.cite.step } }),
    };
  }
  return { code: "other" };
}

/** The parameter a citation is written in, as `Problem.param` writes one («where.0.value»); the first that has it. */
function citedIn(step: Step, cite: Citation): string | undefined {
  const same = (c: Citation) =>
    c.step === cite.step &&
    c.pick === cite.pick &&
    c.path.length === cite.path.length &&
    c.path.every((k, i) => k === cite.path[i]);
  const walk = (v: ParamValue, at: string): string | undefined => {
    if (isExpr(v)) return citationsIn(v).some(same) ? at : undefined;
    if (Array.isArray(v)) {
      for (const [i, x] of v.entries()) {
        const found = walk(x, `${at}.${i}`);
        if (found) return found;
      }
      return undefined;
    }
    if (typeof v === "object" && v !== null)
      for (const [k, x] of Object.entries(v)) {
        const found = walk(x, `${at}.${k}`);
        if (found) return found;
      }
    return undefined;
  };
  for (const p of paramsOf(step)) {
    const v = step.params[p.key];
    const found = v === undefined ? undefined : walk(v, p.key);
    if (found) return found;
  }
  for (const [k, v] of Object.entries(step.params)) {
    const found = walk(v, k);
    if (found) return found;
  }
  return undefined;
}

/** A step's JavaScript (F14c): what is sent to the box, and the parameter each source is written in. */
export interface Javascript {
  kind: "expressions" | "code";
  sources: string[];
  /** For each source, the parameter it is written in (the first that has it), as `Problem.param` writes one. */
  params: string[];
}

/**
 * The JavaScript of a step: a «Código»'s source, or every `{{ }}` of its parameters that is not a simple citation,
 * each source once. None: the step has no JavaScript and never reaches the box.
 */
export function javascriptOf(step: Step): Javascript | undefined {
  if (step.type === CODE_TYPE) {
    const source = step.params[CODE_PARAMS.source];
    return {
      kind: "code",
      sources: [typeof source === "string" ? source : ""],
      params: [CODE_PARAMS.source],
    };
  }
  const sources: string[] = [];
  const params: string[] = [];
  const walk = (v: ParamValue, at: string) => {
    if (isExpr(v)) {
      for (const p of codeParts(v.expr).parts)
        if (!sources.includes(p.source)) {
          sources.push(p.source);
          params.push(at);
        }
    } else if (Array.isArray(v)) for (const [i, x] of v.entries()) walk(x, `${at}.${i}`);
    else if (typeof v === "object" && v !== null)
      for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`);
  };
  for (const [k, v] of Object.entries(step.params)) walk(v, k);
  return sources.length ? { kind: "expressions", sources, params } : undefined;
}

/** A step's JavaScript once evaluated: the record's part, and what each unit reads of it. */
interface Prepared {
  run: StepEvaluation;
  /** The failures of single evaluations: a unit that meets one does not try again. */
  decided: WeakSet<object>;
  /** The scope's `code` for evaluation `i` (expressions); undefined for a «Código». */
  at(i: number): Scope["code"] | undefined;
  /** The rows evaluation `i` of a «Código» gave; throws its failure. */
  rows(i: number): readonly RowOut[];
  /**
   * What evaluation `i` of a «Código» asked to save, in the order asked, each with the label of what it received
   * (AU-169); in «Una vez por fila», each with its row. None for one that failed.
   */
  writes(i: number): { request: WriteRequest; label: Label }[];
}

/** One run: its records, and which step and input rows made each row (for `$('Step').item`, AU-13). */
class Run {
  readonly input: RunInput;
  readonly deps: RunDeps;
  readonly first: Row;
  readonly records: Record<string, StepRecord> = {};
  readonly asked: Asked[] = [];
  readonly made = new WeakMap<Row, { step: string; inputs: readonly Row[] }>();
  readonly byId: Map<string, Step>;
  readonly byName: Map<string, Step>;
  readonly plan: Plan | undefined;
  order: string[] = [];
  /** The run's instant and seed (AU-34): what every job to the box carries. */
  started = 0;
  seed = 0;
  /** Whether any step's JavaScript went to the box: only then is the seed part of what the run was. */
  boxed = false;

  constructor(input: RunInput, deps: RunDeps, first: Row, plan?: Plan) {
    this.input = input;
    this.deps = deps;
    this.first = first;
    this.plan = plan;
    this.byId = new Map(input.automation.steps.map((s) => [s.id, s]));
    this.byName = new Map(input.automation.steps.map((s) => [s.name, s]));
  }

  async go(): Promise<Execution> {
    const { automation, trigger, test } = this.input;
    const started = this.deps.clock.now();
    this.started = started;
    this.seed = this.input.seed ?? seedOf(started, "");
    this.order = this.plan?.order ?? executionOrder(automation, trigger);
    let error: Execution["error"];
    for (const id of this.order) {
      const step = this.byId.get(id) as Step;
      if (error) {
        this.records[id] = { ...blank(), state: "stopped" };
        continue;
      }
      const kept = this.plan?.reuse.get(id);
      if (kept) {
        // Taken as it was kept: its rows are remembered as this step's, made from what its arrows bring now.
        this.records[id] = kept;
        const inputs = id === trigger ? [] : this.arriving(step);
        for (const rows of Object.values(kept.out))
          for (const r of rows) this.made.set(r, { step: id, inputs });
        continue;
      }
      if (id === trigger) {
        this.made.set(this.first, { step: id, inputs: [] });
        this.records[id] = {
          ...blank(),
          state: "done",
          out: { [outputsOf(step)[0] ?? OUT.main]: [this.first] },
        };
        continue;
      }
      const failure = await this.step(step);
      if (failure) error = { ...failure, step: id };
    }
    return {
      automation: { id: automation.id, version: automation.version },
      trigger,
      test,
      state: error ? "failed" : "done",
      started,
      ...(this.boxed ? { seed: this.seed } : {}),
      ms: this.deps.clock.now() - started,
      order: this.order,
      steps: this.records,
      asked: this.asked,
      ...(error ? { error } : {}),
    };
  }

  /** Decides and runs one step, and leaves its record. Gives the error that stops the run, if it does. */
  async step(step: Step): Promise<StepError | undefined> {
    const { clock } = this.deps;
    const start = clock.now();
    const settings = { ...SETTINGS_DEFAULTS, ...(step.settings ?? {}) };
    const record: StepRecord = { ...blank(), state: "running" };
    this.records[step.id] = record;
    const names = outputsOf(step);
    for (const o of names) record.out[o] = [];

    // What arrives, input by input, in the order of `arrowsInto` (AU-11); and whether the step runs (AU-10, AU-14).
    const inputs: Record<string, Row[]> = {};
    let brings = false;
    let empty = false;
    for (const name of inputsOf(step)) {
      inputs[name] = [];
      for (const a of arrowsInto(this.input.automation, this.order, step.id, name)) {
        const from = this.records[a.from.step];
        const rows = from?.out[a.from.output] ?? [];
        inputs[name].push(...rows);
        if (rows.length) brings = true;
        else if (
          from?.state === "done" &&
          a.from.output !== OUT.error &&
          this.byId.get(a.from.step)?.settings?.continueEmpty
        )
          empty = true;
      }
      record.in[name] = inputs[name].length;
      if (settings.firstRowOnly) inputs[name] = inputs[name].slice(0, 1);
    }
    const finish = (state: StepState) => {
      record.state = state;
      record.ms = clock.now() - start;
    };
    if (!brings && !empty) {
      finish("skipped");
      return;
    }
    const all = inputsOf(step).flatMap((n) => inputs[n] ?? []);

    // «Apagado»: the rows pass as they are, by the first way out.
    if (settings.off) {
      const out = names.find((n) => n !== OUT.error);
      if (out)
        record.out[out] = all.map((r, i) =>
          this.row(
            step.id,
            { json: r.json, label: r.label, fields: r.fields, origin: r.origin },
            i,
            r.path,
            all,
          ),
        );
      finish("done");
      return;
    }

    const action = actionOf(step);
    const executor = action
      ? step.type === CODE_TYPE
        ? CODE_EXECUTORS[action.mode]
        : EXECUTORS[executorKey(step.type, action.key)]
      : undefined;
    const tries = 1 + Math.max(0, settings.retry.times);
    let stop: StepError | undefined;

    /** What «Si falla» does with a unit that failed its last try. */
    const give = (
      lastError: unknown,
      row: Row | null,
      index: number,
      units: readonly Row[],
      path: Label | null,
    ) => {
      const failure: StepError = {
        ...stepErrorOf(lastError, step),
        ...(row ? { row: index } : {}),
      };
      if (settings.onError === "stop") {
        stop = failure;
        return;
      }
      const failed = row ? [row] : units;
      record.failed += failed.length;
      record.error ??= failure;
      if (settings.onError === "errorOutput")
        for (const [k, r] of failed.entries()) {
          const at = row ? index : k;
          (record.out[OUT.error] as Row[]).push(
            this.row(
              step.id,
              {
                json: {
                  ...r.json,
                  [ERROR_FIELD]: {
                    message: failure.message,
                    ...(failure.rule ? { rule: failure.rule } : {}),
                  },
                },
                label: r.label,
                fields: {
                  ...(r.fields ?? {}),
                  [ERROR_FIELD]: { label: this.deps.own, derived: true },
                },
                origin: r.origin,
              },
              at,
              path,
              units,
            ),
          );
        }
    };

    // Its JavaScript, for every row, before any row is worked on (AU-38): in the box, never here (AU-160). What
    // stops all of it (no box, a limit of the step) fails the step as one unit; a read refused fails its rows.
    const js = javascriptOf(step);
    let evaluated: Prepared | undefined;
    // Only when some unit will run (AU-14): row by row with no row and no effect, nothing runs.
    const works = action?.mode === "all" || all.length > 0 || action?.effect !== "none";
    if (js && action && works) {
      let lastError: unknown;
      for (let t = 0; t < tries && !evaluated; t++) {
        if (t > 0) {
          record.retries++;
          await clock.sleep(settings.retry.waitMs);
        }
        try {
          evaluated = await this.prepare(step, js, action.mode, all, inputs);
        } catch (e) {
          lastError = e;
        }
      }
      if (!evaluated) {
        give(lastError, null, 0, all, this.path(step, this.scope(null), inputs));
        if (stop) {
          record.error = stop;
          finish("failed");
          return stop;
        }
        finish("done");
        return;
      }
      record.console = { lines: [...evaluated.run.console], dropped: evaluated.run.dropped };
      record.reads = [...evaluated.run.reads];
      record.uses = { clock: evaluated.run.clock, random: evaluated.run.random };
    }

    /**
     * One unit: one row, or all of them. Tries it, and on a last failure does what «Si falla» says. True when it
     * worked: what its «Código» asked to save is part of the step's change.
     */
    const unit = async (
      row: Row | null,
      index: number,
      units: readonly Row[],
      scope: Scope,
    ): Promise<boolean> => {
      const path = this.path(step, scope, row ? { [inputsOf(step)[0] as string]: [row] } : inputs);
      let lastError: unknown;
      for (let t = 0; t < tries; t++) {
        if (t > 0) {
          record.retries++;
          await clock.sleep(settings.retry.waitMs);
        }
        const asked: Asked[] = [];
        try {
          if (!action || !executor) throw new Error(`no executor for ${step.type}`);
          const ctx = this.context(step, action.key, scope, this.gate(step, path, asked));
          if (evaluated) ctx.code = evaluated.rows;
          const out =
            executor.mode === "perRow"
              ? await executor.run(ctx, row, index)
              : await executor.run(ctx, inputs);
          for (const name of Object.keys(out))
            if (!names.includes(name) || name === OUT.error)
              throw new Error(`no output named ${name}`);
          for (const [name, rows] of Object.entries(out))
            for (const r of rows) {
              const parent = row
                ? index
                : action.pairs && action.mode === "all"
                  ? (r.from ?? null)
                  : null;
              (record.out[name] as Row[]).push(this.row(step.id, r, parent, path, units));
            }
          record.asked += asked.length;
          this.asked.push(...asked);
          return true;
        } catch (e) {
          // «Parar con error» ends the run there, with no retry and no «Si falla» (AU-16).
          if (e instanceof StopRun) {
            stop = stepErrorOf(e, step);
            return false;
          }
          lastError = e;
          // What its JavaScript gave for this row is decided once for the step: trying it again gives the same.
          if (evaluated?.decided.has(e as object)) break;
        }
      }
      give(lastError, row, index, units, path);
      return false;
    };

    // The units that worked: what their «Código» asked to save is the step's change (AU-174).
    const worked: number[] = [];
    if (action?.mode === "all") {
      if (await unit(null, 0, all, this.scope(null, evaluated?.at(0)))) worked.push(0);
    } else if (all.length)
      for (const [i, row] of all.entries()) {
        if (await unit(row, i, all, this.scope(row, evaluated?.at(i)))) worked.push(i);
        if (stop) break;
      }
    // Row by row with an empty list: an action that reads or writes runs once with no row (AU-14).
    else if (action && action.effect !== "none")
      await unit(null, 0, all, this.scope(null, evaluated?.at(0)));

    // What its «Código» asked to save, decided for the whole step at once, when the step has not stopped (AU-174).
    if (!stop && evaluated && js?.kind === "code") {
      const asked = worked.flatMap((i) => evaluated.writes(i));
      if (asked.length) {
        const whole = action?.mode === "all";
        const units = whole ? all : worked.map((i) => all[i] as Row);
        const path = this.path(
          step,
          this.scope(null),
          whole ? inputs : { [inputsOf(step)[0] as string]: units },
        );
        let lastError: unknown;
        let saved: StepWrites | undefined;
        for (let t = 0; t < tries && !saved; t++) {
          if (t > 0) {
            record.retries++;
            await clock.sleep(settings.retry.waitMs);
          }
          try {
            saved = await this.save(step, js.sources[0] ?? "", asked, path);
          } catch (e) {
            lastError = e;
            // What the code asked and what the policy said are the same on every try: only the store's may change.
            if (e instanceof CodeFault || e instanceof Denied) break;
          }
        }
        if (saved) {
          record.writes = saved;
          if (saved.kind === "asked") {
            record.asked += saved.asked.length;
            this.asked.push(...saved.asked);
          }
        } else {
          // Nothing of the step was saved: the rows that worked fail with it, and «Si falla» decides (AU-16).
          for (const name of Object.keys(record.out)) if (name !== OUT.error) record.out[name] = [];
          give(lastError, null, 0, units, path);
        }
      }
    }

    if (stop) {
      record.error = stop;
      finish("failed");
      return stop;
    }
    finish("done");
    return;
  }

  /**
   * Saves what a «Código» asked (writes.ts): held to the analysis of the code as saved and to its connections, as
   * saved, never to what the box said; every change judged by the policy before any is written, as the «Colección»
   * action that makes it; and all of them in one transaction, or none (AU-173 to AU-177).
   */
  async save(
    step: Step,
    source: string,
    asked: readonly { request: WriteRequest; label: Label }[],
    control: Label | null,
  ): Promise<StepWrites> {
    const { collections, policy, clock, dates } = this.deps;
    const collectionNamed = (name: string) => this.deps.collectionNamed?.(name);
    const gate = guard(policy, collections, {
      automation: { id: this.input.automation.id, version: this.input.automation.version },
      step: step.id,
      type: step.type,
      action: actionOf(step)?.key ?? "",
      effect: "write",
      destroys: false,
      control,
      test: this.input.test,
      own: this.deps.own,
    });
    // The saved row, read with no other question to the policy: part of the write it is asked about (AU-173).
    const writer: WriteGate = {
      shape: (c) => collections.shape(c),
      get: (c, id) => collections.get(c, id),
      decideAll: (changes) => gate.decideAll(changes),
      writeAll: (changes) => gate.writeAll(changes),
    };
    return applyWrites(
      {
        step: step.id,
        requests: asked.map((a) => a.request),
        labels: asked.map((a) => a.label),
        grants: grantsOf(readWrites(source, "code"), collectionNamed),
        connections: step.connections ?? [],
        collectionNamed,
        today: dates.day(this.started, clock.zone),
        test: this.input.test,
      },
      writer,
    );
  }

  /**
   * A step's JavaScript, evaluated in the box for all its rows before any of them is worked on (AU-38), with the run's
   * instant and the step's seed (AU-34) and only what the code cites (AU-163). Its reads go through a gate of the
   * policy that judges them as reads of this step (AU-161). It rejects for what stops the whole step: no box, a cited
   * step that has not run, a limit of the step. A read the policy refuses fails only the units that asked for it.
   */
  async prepare(
    step: Step,
    js: Javascript,
    mode: CodeMode,
    all: readonly Row[],
    inputs: Record<string, Row[]>,
  ): Promise<Prepared> {
    const { box, clock, dates, locale } = this.deps;
    if (!box)
      throw new CodeFault("JavaScript runs only in the box, and there is none", {
        code: "code.unavailable",
      });
    this.boxed = true;
    const code = js.kind === "code";
    // Expressions of a step that works with all the rows have no row of their own: one evaluation, of no row.
    const input = code || mode === "perRow" ? all : [];
    const perRow = !code || mode === "perRow";

    // The steps its code cites, with the row each input row comes from where it asks for `.item` (AU-13).
    const cited = new Map<string, boolean>();
    for (const source of js.sources)
      for (const c of readCode(source, code ? "code" : "expression").steps)
        cited.set(c.name, (cited.get(c.name) ?? false) || c.item);
    const steps: EvaluateInput["steps"] = {};
    for (const [name, item] of cited) {
      const cite: Citation = { step: name, pick: "first", path: [] };
      const other = this.byName.get(name);
      if (!other) throw new CiteError("unknownStep", cite);
      const record = this.records[other.id];
      if (record?.state !== "done") throw new CiteError("notRun", cite);
      const rows = outputsOf(other)
        .filter((o) => o !== OUT.error)
        .flatMap((o) => record.out[o] ?? []);
      const at = new Map(rows.map((r, i) => [r, i]));
      steps[name] = {
        rows,
        ...(item && perRow ? { item: input.map((r) => this.pairIn(r, other.id, at)) } : {}),
      };
    }

    const action = actionOf(step);
    const gate = guard(this.deps.policy, this.deps.collections, {
      automation: { id: this.input.automation.id, version: this.input.automation.version },
      step: step.id,
      type: step.type,
      action: action?.key ?? "",
      effect: "read",
      destroys: false,
      control: this.path(step, this.scope(null), inputs),
      test: this.input.test,
      own: this.deps.own,
    });
    const run = await evaluate(
      {
        kind: js.kind,
        sources: js.sources,
        mode: code ? mode : "perRow",
        input,
        steps,
        literal: this.deps.own,
        connections: code ? (step.connections ?? []) : [],
        collectionNamed: (name) => this.deps.collectionNamed?.(name),
        now: this.started,
        zone: clock.zone,
        locale,
        today: dates.day(this.started, clock.zone),
        seed: seedOf(this.seed, step.id),
        run: { test: this.input.test, startedBy: "user" },
      },
      box,
      gate,
    );

    // Expressions never save (AU-184): an answer that asks to is not the box's to give, and fails the whole step.
    if (!code)
      for (const e of run.evaluations)
        if (e.state === "done" && e.writes?.length) {
          const w = e.writes[0] as WriteRequest;
          throw new CodeFault("an expression asked to save", {
            code: "code.write.unseen",
            detail: {
              collection: String(w.collection),
              action: String(w.action),
              where: "expression",
            },
          });
        }

    // One evaluation's failure, as the failure of the unit that reads it; the code's message only in `why`.
    const decided = new WeakSet<object>();
    const faultOf = (failure: CodeFailure, param: string | undefined) => {
      const f = new CodeFault(`the step's JavaScript failed (${failure.code})`, {
        ...failure,
        ...(param ? { param } : {}),
      });
      decided.add(f);
      return f;
    };
    // A read the policy refused: the unit fails with `policy.denied` or `policy.waits` and the policy's rule, never
    // with its reason, which may say what the code could not read (Juan, 2026-11-16).
    const deniedOf = (d: Denied) => {
      const code = d.waits ? "policy.waits" : "policy.denied";
      const f = new Denied(
        d.rule,
        `a read of the step's JavaScript was refused (${code})`,
        d.waits,
      );
      decided.add(f);
      return f;
    };
    const failures = run.evaluations.map((e) =>
      e.state === "failed"
        ? faultOf(e.failure, js.params[e.source])
        : e.state === "denied"
          ? deniedOf(e.denied)
          : undefined,
    );

    // What a «Código» gave, as rows (AU-30): each carries the label of everything its evaluation received (AU-169).
    const made: (readonly RowOut[] | CodeFault | Denied)[] = [];
    if (code) {
      let total = 0;
      for (const [i, e] of run.evaluations.entries()) {
        if (e.state !== "done") {
          made.push(failures[i] as CodeFault | Denied);
          continue;
        }
        const label = run.labels[i] as Label;
        try {
          const rows = rowsOf(e.values[0] ?? null).map((json) => ({
            json,
            label,
            fields: Object.fromEntries(Object.keys(json).map((k) => [k, { label, derived: true }])),
          }));
          total += rows.length;
          made.push(rows);
        } catch (f) {
          made.push(faultOf((f as CodeFault).why, CODE_PARAMS.source));
        }
      }
      if (total > CODE_LIMITS.outputRows) {
        const f = limitFault("outputRows", CODE_LIMITS.outputRows, total);
        throw new CodeFault(f.message, { ...f.why, param: CODE_PARAMS.source });
      }
    }

    return {
      run,
      decided,
      at: (i) =>
        code
          ? undefined
          : (source) => {
              const k = js.sources.indexOf(source);
              const e = run.evaluations[i];
              if (k < 0 || !e)
                throw new CodeFault("this JavaScript was not evaluated", {
                  code: "code.unavailable",
                });
              if (e.state !== "done") throw failures[i] as CodeFault | Denied;
              return { value: e.values[k] ?? null, label: run.labels[i] as Label, derived: true };
            },
      rows: (i) => {
        const m = made[i];
        if (!m)
          throw new CodeFault("this «Código» was not evaluated", { code: "code.unavailable" });
        if (m instanceof CodeFault || m instanceof Denied) throw m;
        return m;
      },
      writes: (i) => {
        const e = run.evaluations[i];
        if (!code || e?.state !== "done") return [];
        const label = run.labels[i] as Label;
        return (e.writes ?? []).map((request) => ({
          request: perRow ? { ...request, row: i } : request,
          label,
        }));
      },
    };
  }

  /** The place in `at` of the row of step `id` that `row` comes from, or null when it comes from none (AU-13). */
  pairIn(row: Row, id: string, at: ReadonlyMap<Row, number>): number | null {
    let r: Row | undefined = row;
    while (r) {
      const made = this.made.get(r);
      if (!made) return null;
      if (made.step === id) return at.get(r) ?? null;
      r = r.parent === null ? undefined : made.inputs[r.parent];
    }
    return null;
  }

  /** Every row that reaches a step, input by input in the order of `arrowsInto`, as `step` puts them together. */
  arriving(step: Step): Row[] {
    const firstOnly = step.settings?.firstRowOnly ?? SETTINGS_DEFAULTS.firstRowOnly;
    return inputsOf(step).flatMap((name) => {
      const rows = arrowsInto(this.input.automation, this.order, step.id, name).flatMap(
        (a) => this.records[a.from.step]?.out[a.from.output] ?? [],
      );
      return firstOnly ? rows.slice(0, 1) : rows;
    });
  }

  /** A row out, with its parent and path, remembered as this step's. */
  row(
    step: string,
    r: RowOut,
    parent: number | null,
    path: Label | null,
    inputs: readonly Row[],
  ): Row {
    const row: Row = {
      json: r.json,
      label: r.label,
      ...(r.fields && Object.keys(r.fields).length ? { fields: r.fields } : {}),
      ...(r.origin ? { origin: r.origin } : {}),
      path,
      parent,
    };
    this.made.set(row, { step, inputs });
    return row;
  }

  /**
   * The label of the path of what a unit gives (AU-164): the paths of the rows it works with, the labels of what
   * the parameters that change the rows resolved to (fixed values add nothing), and the labels of the fields they
   * name in those rows (what a condition tested, what decided an order or a duplicate). Null when nothing applies.
   */
  path(step: Step, scope: Scope, by: Record<string, readonly Row[]>): Label | null {
    const labels: Label[] = [];
    for (const rows of Object.values(by)) for (const r of rows) if (r.path) labels.push(r.path);
    for (const p of paramsOf(step)) {
      if (!p.changesRows) continue;
      const v = paramValue(step, p);
      if (hasExpr(v))
        try {
          labels.push(resolve(v as ParamValue, scope).label);
        } catch {
          // A citation that fails fails the step itself, when the executor resolves it.
        }
      for (const f of namedFields(p, v))
        for (const r of by[f.input] ?? []) labels.push(fieldLabel(r, f.field));
    }
    return labels.length ? joinAll(labels, this.deps.own) : null;
  }

  context(step: Step, action: string, scope: Scope, gate: Gate): StepContext {
    const { dates, clock, locale } = this.deps;
    return {
      step,
      action,
      gate,
      dates,
      zone: clock.zone,
      locale,
      now: clock.now(),
      value: (p) => resolve(p, scope),
      scope,
    };
  }

  /** The gate of one unit: closed for a step with no effect; else the policy's, noting what waits for Juan. */
  gate(step: Step, control: Label | null, asked: Asked[]): Gate {
    const action = actionOf(step);
    if (!action || action.effect === "none") return CLOSED;
    const g = guard(this.deps.policy, this.deps.collections, {
      automation: { id: this.input.automation.id, version: this.input.automation.version },
      step: step.id,
      type: step.type,
      action: action.key,
      effect: action.effect,
      destroys: action.destroys,
      control,
      test: this.input.test,
      own: this.deps.own,
    });
    // The first door of a «Colección» write (AU-186, AU-187): its «Permiso». «Preguntar» asks for its change in any
    // run, a test or one started by hand too, after the policy (the second door) was asked and did not refuse it.
    const cellAsks =
      step.type === "collection" && action.effect === "write" && permissionOf(step) === "ask";
    return {
      shape: (c) => g.shape(c),
      find: (q, v) => g.find(q, v),
      get: (c, id) => g.get(c, id),
      aggregate: (q, v) => g.aggregate(q, v),
      async write(change, values) {
        if (cellAsks) {
          const byPolicy = await g.decideAll([{ change, values }]);
          const r: WriteResult = {
            kind: "asked",
            asked:
              byPolicy === "allow" || !byPolicy[0]
                ? {
                    step: step.id,
                    kind: change.kind === "trash" ? "confirm" : "propose",
                    rule: CONNECTION_ASKS,
                    change,
                    values,
                  }
                : byPolicy[0],
          };
          asked.push(r.asked);
          return r;
        }
        const r = await g.write(change, values);
        if (r.kind === "asked") asked.push(r.asked);
        return r;
      },
      // A step's changes together are the «Código»'s (writes.ts), through a gate of their own: never an executor's.
      decideAll: closed,
      writeAll: closed,
    };
  }

  /** What expressions are resolved against for one unit (AU-13), with what its JavaScript gave, if it has any. */
  scope(current: Row | null, code?: Scope["code"]): Scope {
    return {
      current,
      literal: this.deps.own,
      ...(code ? { code } : {}),
      row: (name, pick) => {
        const cite: Citation = { step: name, pick, path: [] };
        const step = this.byName.get(name);
        if (!step) throw new CiteError("unknownStep", cite);
        const record = this.records[step.id];
        if (record?.state !== "done") throw new CiteError("notRun", cite);
        if (pick !== "item") {
          const rows = outputsOf(step)
            .filter((o) => o !== OUT.error)
            .flatMap((o) => record.out[o] ?? []);
          const row = pick === "first" ? rows[0] : rows[rows.length - 1];
          if (!row) throw new CiteError("noRows", cite);
          return row;
        }
        if (!current) throw new CiteError("noCurrentRow", cite);
        // Back through the rows each one comes from, until one of that step's.
        let row: Row | undefined = current;
        while (row) {
          const made = this.made.get(row);
          if (!made) break;
          if (made.step === step.id) return row;
          row = row.parent === null ? undefined : made.inputs[row.parent];
        }
        throw new CiteError("noPair", cite);
      },
    };
  }
}

const blank = (): StepRecord => ({
  state: "queued",
  in: {},
  out: {},
  ms: 0,
  retries: 0,
  failed: 0,
  asked: 0,
});

// ---------------------------------------------------------------- the steps

/** What a step's executor works with. It has no other way out: no store, no clock but this one, no policy. */
export interface StepContext {
  step: Step;
  /** The action's key (`actionOf`). */
  action: string;
  /** The collections behind the policy, for this step and this row (AU-168). */
  gate: Gate;
  dates: Dates;
  zone: string;
  locale: string;
  /** Epoch ms: the same instant for every row of the step. */
  now: number;
  /**
   * A parameter's value for the row in hand, with its label (`resolve` with the scope the engine built). The label
   * of the path does not depend on it: the engine reads the parameters that change the rows before the executor runs,
   * so the gate can judge with it (`GateUnit.control`).
   */
  value(param: ParamValue): Labeled<Cell>;
  /** The scope itself, for an executor that resolves a structure piece by piece (conditions, the fields of a row). */
  scope: Scope;
  /** A «Código» only (F14c): the rows its evaluation `at` gave, evaluated before the units (AU-38); throws its failure. */
  code?(at: number): readonly RowOut[];
}

/** A row an executor gives: its fields and their labels. The engine sets `parent` and `path`, never the executor. */
export type RowOut = Pick<Row, "json" | "label" | "fields" | "origin">;

/**
 * What an executor answers: rows by output. For a step that works with all the rows and whose action `pairs`, each
 * row out says which row of the input it is (`from`), so the engine keeps `parent`.
 */
export type StepOutput = Record<string, readonly (RowOut & { from?: number })[]>;

export type Executor =
  /**
   * Once per row that arrives: `index` is the row's place in the step's input. `row` is null only for an action
   * with an effect that runs with an empty list (AU-14): once, with `index` 0 and no current row in its scope.
   */
  | { mode: "perRow"; run(ctx: StepContext, row: Row | null, index: number): Promise<StepOutput> }
  /** Once, with every row: `input` by input name. */
  | {
      mode: "all";
      run(ctx: StepContext, input: Record<string, readonly Row[]>): Promise<StepOutput>;
    };

/**
 * One executor per action of the catalogue, by `executorKey`, in the catalogue's mode. A trigger has none: the
 * engine gives its row.
 */
export const EXECUTORS: Readonly<Record<string, Executor>> = {
  ...TRANSFORM_AND_LOGIC,
  ...COLLECTION,
};

/** The key of an action's executor in `EXECUTORS`. */
export const executorKey = (type: string, action: string): string => `${type}.${action}`;

/** What a «Código» gave for its unit: the rows the engine evaluated before (AU-30, AU-38). */
const codeRows = (ctx: StepContext, at: number): readonly RowOut[] => {
  if (!ctx.code)
    throw new CodeFault("this «Código» was not evaluated", { code: "code.unavailable" });
  return ctx.code(at);
};

/**
 * The executors of «Código», by «Se ejecuta»: reachable by its type, outside `EXECUTORS` as it is outside
 * `CATALOGUE`. They only hand out what the box gave: the code never runs here.
 */
const CODE_EXECUTORS: Readonly<Record<CodeMode, Executor>> = {
  all: { mode: "all", run: async (ctx) => ({ [OUT.main]: codeRows(ctx, 0) }) },
  perRow: {
    mode: "perRow",
    run: async (ctx, _row, index) => ({ [OUT.main]: codeRows(ctx, index) }),
  },
};
