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
  actionOf,
  inputsOf,
  isTrigger,
  outputsOf,
  type ParamSpec,
  paramsOf,
  paramValue,
} from "./catalogue.ts";
import {
  type Asked,
  type Clock,
  type Collections,
  type Dates,
  Denied,
  type Gate,
  guard,
  type Policy,
} from "./effects.ts";
import { type Citation, CiteError, resolve, type Scope } from "./expression.ts";
import {
  type Automation,
  isExpr,
  OUT,
  type ParamValue,
  SETTINGS_DEFAULTS,
  type Step,
} from "./format.ts";
import { arrowsInto, executionOrder } from "./graph.ts";
import type { Cell, Row } from "./rows.ts";
import { fieldLabel, joinAll, StopRun, TRANSFORM_AND_LOGIC } from "./steps.ts";
import { canRun, type Problem, validate } from "./validate.ts";

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
}

/**
 * Runs an automation from a trigger to the end. It validates first and rejects with `CannotRun`, before any effect, when
 * `validate` gives an error, the trigger is not a trigger step of the automation, or the trigger's row has a field it
 * does not ask for or one of another type; after that it never throws: what goes wrong is in the `Execution`. The
 * limits of a run (AU-17) and saving it (AU-15 in tables) are F14d's.
 */
export async function run(input: RunInput, deps: RunDeps): Promise<Execution> {
  const problems = validate(input.automation, { collection: (key) => deps.collections.shape(key) });
  if (!canRun(problems)) throw new CannotRun("the automation has errors", problems);
  const trigger = input.automation.steps.find((s) => s.id === input.trigger);
  if (!trigger || !isTrigger(trigger))
    throw new CannotRun(`${input.trigger} is not a trigger of the automation`);
  return new Run(input, deps, triggerRow(trigger, input.fields)).go();
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
const CLOSED: Gate = {
  shape: closed,
  find: closed,
  get: closed,
  aggregate: closed,
  write: closed,
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

const messageOf = (e: unknown): StepError => ({
  message: e instanceof Error ? e.message : String(e),
  ...(e instanceof Denied ? { rule: e.rule } : {}),
});

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
  order: string[] = [];

  constructor(input: RunInput, deps: RunDeps, first: Row) {
    this.input = input;
    this.deps = deps;
    this.first = first;
    this.byId = new Map(input.automation.steps.map((s) => [s.id, s]));
    this.byName = new Map(input.automation.steps.map((s) => [s.name, s]));
  }

  async go(): Promise<Execution> {
    const { automation, trigger, test } = this.input;
    const started = this.deps.clock.now();
    this.order = executionOrder(automation, trigger);
    let error: Execution["error"];
    for (const id of this.order) {
      const step = this.byId.get(id) as Step;
      if (error) {
        this.records[id] = { ...blank(), state: "stopped" };
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
    const executor = action ? EXECUTORS[executorKey(step.type, action.key)] : undefined;
    const tries = 1 + Math.max(0, settings.retry.times);
    let stop: StepError | undefined;

    /** One unit: one row, or all of them. Tries it, and on a last failure does what «Si falla» says. */
    const unit = async (row: Row | null, index: number, units: readonly Row[], scope: Scope) => {
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
          return;
        } catch (e) {
          // «Parar con error» ends the run there, with no retry and no «Si falla» (AU-16).
          if (e instanceof StopRun) {
            stop = { message: e.message };
            return;
          }
          lastError = e;
        }
      }
      const failure: StepError = { ...messageOf(lastError), ...(row ? { row: index } : {}) };
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

    if (action?.mode === "all") await unit(null, 0, all, this.scope(null));
    else if (all.length)
      for (const [i, row] of all.entries()) {
        await unit(row, i, all, this.scope(row));
        if (stop) break;
      }
    // Row by row with an empty list: an action that reads or writes runs once with no row (AU-14).
    else if (action && action.effect !== "none") await unit(null, 0, all, this.scope(null));

    if (stop) {
      record.error = stop;
      finish("failed");
      return stop;
    }
    finish("done");
    return;
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
    });
    return {
      shape: (c) => g.shape(c),
      find: (q, v) => g.find(q, v),
      get: (c, id) => g.get(c, id),
      aggregate: (q, v) => g.aggregate(q, v),
      async write(change, values) {
        const r = await g.write(change, values);
        if (r.kind === "asked") asked.push(r.asked);
        return r;
      },
    };
  }

  /** What expressions are resolved against for one unit (AU-13). */
  scope(current: Row | null): Scope {
    return {
      current,
      literal: this.deps.own,
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
 * One executor per action of the catalogue, by `executorKey`. The builder fills it; its mode is the catalogue's.
 * A trigger has none: the engine gives its row.
 */
export const EXECUTORS: Readonly<Record<string, Executor>> = { ...TRANSFORM_AND_LOGIC };

/** The key of an action's executor in `EXECUTORS`. */
export const executorKey = (type: string, action: string): string => `${type}.${action}`;
