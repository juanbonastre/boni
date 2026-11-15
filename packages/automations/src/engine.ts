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
import type { Asked, Clock, Collections, Dates, Gate, Policy } from "./effects.ts";
import type { Scope } from "./expression.ts";
import type { Automation, ParamValue, Step } from "./format.ts";
import { notBuilt } from "./pending.ts";
import type { Cell, Row } from "./rows.ts";

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
 * Runs an automation from a trigger to the end. It validates first and throws, before any effect, when `validate`
 * gives an error or the trigger is not a trigger step of the automation; after that it never throws: what goes wrong
 * is in the `Execution`. The limits of a run (AU-17) and saving it (AU-15 in tables) are F14d's.
 */
export function run(_input: RunInput, _deps: RunDeps): Promise<Execution> {
  return notBuilt("run");
}

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
   * A parameter's value for the row in hand, with its label (`resolve` with the scope the engine built). The engine
   * notes what was read through here for the label of the path.
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
export const EXECUTORS: Readonly<Record<string, Executor>> = {};

/** The key of an action's executor in `EXECUTORS`. */
export const executorKey = (type: string, action: string): string => `${type}.${action}`;
