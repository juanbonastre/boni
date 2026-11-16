/**
 * How the engine runs JavaScript (docs/automatizaciones.md §5.3, §5.4, §6 AU-160 to AU-169): never itself. It hands a
 * job to the box, a port like the policy and the collections are (`RunDeps.box`), and gets values back. The box is
 * another process with an interpreter that has nothing of Boni or of the machine in it (A-08): a job carries all the
 * code may know (the rows it cites, the run's instant, a seed, what it has read so far) and nothing else, and what
 * comes back is data, never trusted: the engine labels it with the worst label of what it sent (AU-169).
 *
 * Reading a collection from code is done by repeating (§6, risk 4): the box stops an evaluation at the first read it
 * does not have and says which; the engine makes it through the step's connection and the policy, and runs the job
 * again with it. Code has no clock or chance of its own (AU-34), so the repetition goes the same way up to that read.
 * `evaluate` hides this: if measuring says an interpreter that waits is needed, the port and what is above it stay.
 * Contracts of F14c: nothing here is built yet (pending.ts).
 */
import type { Label } from "@boni/entities";
import type { CodeFailure, CodeMode } from "./code.ts";
import type { Connection, ReadAsk } from "./connections.ts";
import type { Gate } from "./effects.ts";
import { notBuilt } from "./pending.ts";
import type { Cell, Row } from "./rows.ts";

/** A row as code sees it: its fields by key, and nothing of its labels or of where it was read from. */
export type Fields = Record<string, Cell>;

/** A read as code wrote it, before anything is checked: the collection by the name written in `$col('…')`. */
export type CodeRead = Omit<ReadAsk, "collection"> & { collection: string };

export interface BoxJob {
  /**
   * `expressions`: every `{{ }}` of the step that is not a simple citation, each a JavaScript expression, evaluated
   * once per row. `code`: one «Código», a function's body.
   */
  kind: "expressions" | "code";
  sources: readonly string[];
  /** `code` only; expressions are always `perRow`. */
  mode: CodeMode;
  /**
   * The rows of the step's input this job is about: all of them in `all`, one batch in `perRow` (at most
   * `CODE_LIMITS.batchRows`). Only the fields the code reads, when `readCode` can tell.
   */
  input: readonly Fields[];
  /** The place of `input[0]` in the step's whole input: what a failure's row and a row's seed are counted from. */
  from: number;
  /**
   * The rows of each step the code cites, by the step's name, and nothing of any other step (AU-163). `item`: for
   * each row of `input`, the place in `rows` of the row it comes from, or null when it has none (AU-13).
   */
  steps: Record<string, { rows: readonly Fields[]; item?: readonly (number | null)[] }>;
  /** The run's instant (epoch ms) and Juan's time zone: `$now`, and what `Date.now()` and `new Date()` give too. */
  now: number;
  zone: string;
  /** The language of month and day names in `.format(…)`. */
  locale: string;
  /** The step's seed in this run (`seedOf`); each row's chance is drawn from it and the row's place. */
  seed: number;
  run: { test: boolean; startedBy: "user" };
  /**
   * What the step has read so far in this run, by the key the box gave each read. A value is whatever the server
   * read: rows (their fields), one row or null, a number.
   */
  reads: Record<string, Cell>;
}

/** A line of «Consola» (AU-33): what `console.log` was given, as text, and the line of the source that wrote it. */
export interface ConsoleLine {
  level: "log" | "info" | "warn" | "error";
  text: string;
  /** 1-based, of the source Juan wrote. Absent when the interpreter cannot say. */
  line?: number;
  /** The row of the step's input it was written for, in `perRow`. */
  row?: number;
}

/** One evaluation's end: one per row of `input` in `perRow`, one in all in `all`. */
export type Evaluated =
  /** `values`: one per source for expressions; for `code`, one value: what it returned. */
  | { state: "done"; values: readonly Cell[]; clock: boolean; random: boolean }
  /** It stopped at a read it does not have. `key` is the box's, opaque, and what `BoxJob.reads` is filled by. */
  | { state: "needs"; key: string; read: CodeRead }
  /** `source`: which of the job's sources. */
  | { state: "failed"; failure: CodeFailure; source: number };

export interface BoxAnswer {
  evaluations: readonly Evaluated[];
  /** In order, cut to `CODE_LIMITS.consoleLines`; `dropped` counts the rest. */
  console: readonly ConsoleLine[];
  dropped: number;
  ms: number;
}

/**
 * The port. One call, one answer: it never keeps anything between two calls (AU-37, AU-160), and it never throws
 * for what the code does: a job that cannot run at all (no box, a limit of the whole call) rejects with `CodeFault`.
 */
export interface Box {
  run(job: BoxJob): Promise<BoxAnswer>;
}

/** What one read gave, for the step's record: «la cuenta» of AU-161. Never the rows themselves. */
export interface ReadRecord {
  collection: string;
  op: ReadAsk["op"];
  rows: number;
  bytes: number;
  ms: number;
}

/** What evaluating a step's JavaScript over its input gave. */
export interface StepEvaluation {
  /** As `BoxAnswer.evaluations` once every read is made: no `needs` is left. */
  evaluations: readonly Exclude<Evaluated, { state: "needs" }>[];
  /**
   * The label of everything each evaluation received (AU-169): the rows and steps sent, the code's own label and
   * every read it made. One per evaluation. What it gives carries it and is derived: never a destination (P14).
   */
  labels: readonly Label[];
  console: readonly ConsoleLine[];
  dropped: number;
  reads: readonly ReadRecord[];
  /** Calls to the box: batches and repetitions. */
  calls: number;
  /** Whether any evaluation read the clock or chance (see partial.ts: what a kept test says of it). */
  clock: boolean;
  random: boolean;
}

export interface EvaluateInput {
  kind: BoxJob["kind"];
  sources: readonly string[];
  mode: CodeMode;
  /** The step's whole input, with labels: the engine batches it. */
  input: readonly Row[];
  /** The rows of the steps cited, by name, with labels, and the pairing of each input row where `.item` is used. */
  steps: Record<string, { rows: readonly Row[]; item?: readonly (number | null)[] }>;
  /** The label of the code itself: what Juan wrote (`Scope.literal`); from F15, a model's when a model wrote it. */
  literal: Label;
  /** The step's connections: the only collections its code may read, each with its limits. */
  connections: readonly Connection[];
  /** A collection's key by the name written in `$col('…')`. */
  collectionNamed(name: string): string | undefined;
  now: number;
  zone: string;
  locale: string;
  seed: number;
  run: BoxJob["run"];
}

/**
 * Runs a step's JavaScript over its input: batches the rows (AU-38), sends each batch with only what the code cites
 * (AU-163), makes the reads the box asks for (through `narrow`, then the gate, so the policy is asked for each and
 * its rows come labelled: AU-161) and repeats until no evaluation needs one, within `CODE_LIMITS`. A read's values
 * are judged as calculated from everything the evaluation had received before it. It rejects with `CodeFault` only
 * for what stops the whole step (no box, `stepReads`, `stepReadBytes`); one row's failure is that row's `failed`.
 */
export function evaluate(input: EvaluateInput, box: Box, gate: Gate): Promise<StepEvaluation> {
  return notBuilt(`evaluate(${input.kind}, ${input.input.length}, ${typeof box}, ${typeof gate})`);
}

/**
 * A step's seed in a run: from the run's seed (drawn once when the run starts and kept with it, so repeating the run
 * gives the same) and the step's id. The same whatever the batch size, the order of steps or the retries.
 */
export function seedOf(runSeed: number, step: string): number {
  return notBuilt(`seedOf(${runSeed}, ${step})`);
}

/**
 * The rows a «Código» gave, from what it returned (AU-30): a list of objects is those rows, one object is one row,
 * `null` or an empty list is no rows. Throws `CodeFault` (`code.result`) for anything else; a missing `return` never
 * gets here (the box answers `code.result`, "nothing"). Keys are data: `__proto__` and its like are fields like any
 * other, and never reach an object's prototype.
 */
export function rowsOf(value: Cell): Fields[] {
  return notBuilt(`rowsOf(${typeof value})`);
}
