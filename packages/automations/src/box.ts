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
 * Built in F14c's E3; the box itself is apps/sandbox (E1), and the server's port to it is S1's.
 */
import { join, type Label } from "@boni/entities";
import { type FilterItem, filterErrors, isFilterGroup, matchesFilters } from "@boni/views";
import { CODE_LIMITS, type CodeFailure, CodeFault, type CodeMode } from "./code.ts";
import {
  asRead,
  type Connection,
  cutRead,
  type NarrowedAsk,
  narrow,
  type ReadAsk,
} from "./connections.ts";
import { Denied, type Gate, type Labelled, type StoredRow } from "./effects.ts";
import { type FieldsRead, readCode } from "./javascript.ts";
import type { Cell, Row } from "./rows.ts";
import type { WriteAction, WriteRequest } from "./writes.ts";

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
  run: { test: boolean; startedBy: "user" | "schedule" };
  /**
   * What the step has read so far in this run, by the key the box gave each read. A value is whatever the server
   * read: rows (their fields), one row or null, a number.
   */
  reads: Record<string, Cell>;
  /**
   * `code` only: the methods of saving its `$col('…')` has, by the name written there (AU-183): what the analysis of
   * the code as saved found and its connection allows, and nothing else. Absent or empty: `$col` only reads.
   */
  writes?: Record<string, readonly WriteAction[]>;
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
  /**
   * `values`: one per source for expressions; for `code`, one value: what it returned. `writes`: what it asked to
   * save, in the order asked, of its last pass only (AU-173); never trusted, and none from expressions (AU-184).
   */
  | {
      state: "done";
      values: readonly Cell[];
      clock: boolean;
      random: boolean;
      writes?: readonly WriteRequest[];
    }
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

/**
 * One evaluation's end once every read is made: as the box's, or `denied` when the policy refused a read it asked
 * for, or would have asked Juan about it (AU-161). `denied` is the gate's no, which the engine gives the unit as
 * `policy.denied` or `policy.waits`: the code never learns it.
 */
export type Settled = Exclude<Evaluated, { state: "needs" }> | { state: "denied"; denied: Denied };

/** What evaluating a step's JavaScript over its input gave. */
export interface StepEvaluation {
  /** One per evaluation: no `needs` is left. */
  evaluations: readonly Settled[];
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
  /** The civil day `now` falls on in `zone` («hoy» of a connection's filter, as in the views). */
  today: string;
  seed: number;
  run: BoxJob["run"];
  /**
   * The place of `input[0]` in the step's whole input, when `input` is part of it (a preview of one row: preview.ts):
   * what each row's chance and a console line's row are counted from, so a row gives what it gave in the run. 0 by
   * default.
   */
  offset?: number;
}

/**
 * Runs a step's JavaScript over its input: batches the rows (AU-38), sends each batch with only what the code cites
 * (AU-163), makes the reads the box asks for (through `narrow`, then the gate, so the policy is asked for each and
 * its rows come labelled: AU-161) and repeats until no evaluation needs one, within `CODE_LIMITS`. A read's values
 * are judged as calculated from everything the evaluation had received before it. It rejects with `CodeFault` only
 * for what stops the whole step (no box, `stepReads`, `stepReadBytes`); one row's failure is that row's `failed`,
 * and a read the policy refuses is `denied` for the rows that asked for it.
 *
 * How, where the contract leaves it open:
 * - «Una vez con todas las filas» is one evaluation with every row; every other case is one per row, in batches of
 *   `batchRows`, except code that asks for `$input.all()` row by row, which needs every row in each call: then the
 *   batch is the whole input. Expressions with no row at all (a step that works with all the rows, or one run with
 *   an empty list) are one evaluation of one empty row.
 * - The rows sent are copies (AU-37): what the box or code does to them never reaches the step's input.
 * - Every `needs` of a call is served together, then the call is sent again with all of them in `reads`, for the
 *   rows from the first to the last that still need one; a row already answered keeps its first answer and its
 *   console lines (a row that answered `needs` wrote none). A batch's `reads` hold only what that batch asked for.
 * - The label of an evaluation is the worst of its own rows (the fields sent and the row's), every row sent of every
 *   step it cites, the code's own and every read in the call that answered it: never finer, sometimes coarser.
 * - A read the policy refuses, or would ask Juan about, fails the rows that asked for it (`denied`), as a read that
 *   is not one or of a collection not connected does: each follows the step's «Si falla» (AU-16), and with
 *   «Una vez con todas las filas» that is the whole step. The code never learns why and is not called again for
 *   those rows (Juan, 2026-11-16, replacing E3's choice that a refused read rejected the whole step).
 */
export async function evaluate(
  input: EvaluateInput,
  box: Box,
  gate: Gate,
): Promise<StepEvaluation> {
  const readings = input.sources.map((s) =>
    readCode(s, input.kind === "code" ? "code" : "expression"),
  );
  const ownFields = unionFields(readings.flatMap((r) => (r.input ? [r.input.fields] : [])));
  const wholeInput = readings.some((r) => r.input?.all);
  const cited = new Map<string, FieldsRead>();
  for (const r of readings)
    for (const s of r.steps)
      cited.set(
        s.name,
        unionFields([...(cited.has(s.name) ? [cited.get(s.name) as FieldsRead] : []), s.fields]),
      );

  // What every call of the step carries: the code's label and the rows of the steps it cites (AU-163).
  const shared: Label[] = [input.literal];
  const steps: Record<string, { rows: Fields[]; item?: readonly (number | null)[] }> = {};
  for (const [name, fields] of cited) {
    const s = input.steps[name];
    if (!s) continue;
    const rows: Fields[] = [];
    const labels = new Set<Label>();
    for (const r of s.rows) {
      const sent = fieldsOf(r, fields);
      rows.push(sent.fields);
      for (const l of sent.labels) labels.add(l);
    }
    shared.push(...labels);
    steps[name] = { rows, ...(s.item ? { item: s.item } : {}) };
  }

  // The evaluations: their rows as sent, and the label of each before any read.
  const noRow = input.kind === "expressions" && input.input.length === 0;
  const sent: Fields[] = [];
  const own: Label[] = [];
  for (const r of input.input) {
    const f = fieldsOf(r, ownFields);
    sent.push(f.fields);
    own.push(join(...(f.labels as [Label, ...Label[]])));
  }
  if (noRow) sent.push({});
  const all = input.kind === "code" && input.mode === "all";
  const count = all ? 1 : sent.length;
  const writes = input.kind === "code" ? grantedOf(readings[0], input) : {};
  const base: Label[] = [];
  const sharedLabel = join(...(shared as [Label, ...Label[]]));
  if (all) base.push(join(sharedLabel, ...own));
  else
    for (let i = 0; i < count; i++)
      base.push(own[i] ? join(sharedLabel, own[i] as Label) : sharedLabel);

  const out: StepEvaluation = {
    evaluations: [],
    labels: [],
    console: [],
    dropped: 0,
    reads: [],
    calls: 0,
    clock: false,
    random: false,
  };
  const final: (Settled | undefined)[] = new Array(count);
  const labels: Label[] = new Array(count);
  const lines: ConsoleLine[][] = Array.from({ length: count }, () => []);
  const asked: Set<string>[] = Array.from({ length: count }, () => new Set());
  const reader = new Reader(input, gate);

  const whole = all || wholeInput;
  const offset = input.offset ?? 0;
  const size = whole ? Math.max(count, 1) : CODE_LIMITS.batchRows;
  for (let lo = 0; lo < count; lo += size) {
    const batch = { lo, hi: Math.min(count, lo + size) };
    // What this batch has read so far: its key, and the label the rows that read it take on.
    const reads: Record<string, Cell> = {};
    const readLabels: Label[] = [];
    let first = batch.lo;
    let last = batch.hi;
    while (first < last) {
      // With every row in each call, the call is always the whole input; else the rows still to answer.
      const from = whole ? 0 : first;
      const to = whole ? sent.length : last;
      const job: BoxJob = {
        kind: input.kind,
        sources: input.sources,
        mode: input.kind === "code" ? input.mode : "perRow",
        input: whole ? sent : sent.slice(from, to),
        from: offset + from,
        steps: whole ? steps : sliceItems(steps, from, to),
        now: input.now,
        zone: input.zone,
        locale: input.locale,
        seed: input.seed,
        run: input.run,
        reads,
        ...(Object.keys(writes).length ? { writes } : {}),
      };
      const bytes = jsonBytes(job);
      if (bytes > CODE_LIMITS.inputBytes)
        throw limitFault("inputBytes", CODE_LIMITS.inputBytes, bytes);
      const answer = await box.run(job);
      out.calls++;
      if (answer.evaluations.length !== (all ? 1 : to - from))
        throw new CodeFault("the box gave another number of evaluations than it was sent", {
          code: "code.unavailable",
          detail: { why: "unavailable" },
        });
      out.dropped += answer.dropped;
      const answered = new Set<number>();
      const needed = new Map<string, { read: CodeRead; by: number[] }>();
      answer.evaluations.forEach((e, j) => {
        const at = all ? 0 : from + j;
        if (final[at]) return;
        if (e.state === "needs") {
          // A read it was handed and asks for again: the box is not doing what it says, and it would never end.
          if (Object.hasOwn(reads, e.key))
            throw new CodeFault("the box asked again for a read it was handed", {
              code: "code.limit",
              detail: { limit: "reads", max: CODE_LIMITS.reads },
            });
          const mine = asked[at] as Set<string>;
          mine.add(e.key);
          if (mine.size > CODE_LIMITS.reads) {
            final[at] = failedBy(limitFailure("reads", CODE_LIMITS.reads, mine.size));
            labels[at] = joinWith(base[at] as Label, readLabels);
            answered.add(at);
            return;
          }
          const n = needed.get(e.key);
          if (n) n.by.push(at);
          else needed.set(e.key, { read: e.read, by: [at] });
          return;
        }
        final[at] = e;
        labels[at] = joinWith(base[at] as Label, readLabels);
        answered.add(at);
      });
      for (const line of answer.console) {
        const at = all ? 0 : (line.row ?? offset + from) - offset;
        if (answered.has(at)) (lines[at] as ConsoleLine[]).push(line);
      }
      for (const [key, { read, by }] of needed) {
        // The filter's values are judged with the worst of what the rows asking had received until now (AU-161).
        const before = join(
          ...(by.map((at) => joinWith(base[at] as Label, readLabels)) as [Label, ...Label[]]),
        );
        const made = await reader.read(key, read, before);
        if ("failure" in made || "denied" in made)
          for (const at of by) {
            final[at] =
              "failure" in made ? failedBy(made.failure) : { state: "denied", denied: made.denied };
            labels[at] = joinWith(base[at] as Label, readLabels);
          }
        else {
          reads[key] = made.value;
          if (made.label) readLabels.push(made.label);
        }
      }
      while (first < last && final[first]) first++;
      while (last > first && final[last - 1]) last--;
    }
  }

  out.reads = reader.records;
  out.evaluations = final as Settled[];
  out.labels = labels;
  const kept: ConsoleLine[] = [];
  for (const l of lines.flat())
    if (kept.length < CODE_LIMITS.consoleLines)
      kept.push(
        l.text.length > CODE_LIMITS.consoleLineChars
          ? { ...l, text: l.text.slice(0, CODE_LIMITS.consoleLineChars) }
          : l,
      );
    else out.dropped++;
  out.console = kept;
  for (const e of out.evaluations)
    if (e.state === "done") {
      out.clock ||= e.clock;
      out.random ||= e.random;
    }
  return out;
}

/**
 * The methods of saving a «Código»'s `$col` gets (AU-183), by the name as written: each call the analysis found whose
 * collection is connected and whose action the connection gives. Anything else the box does not have.
 */
function grantedOf(
  reading: ReturnType<typeof readCode> | undefined,
  input: Pick<EvaluateInput, "connections" | "collectionNamed">,
): Record<string, WriteAction[]> {
  const out = new Map<string, WriteAction[]>();
  for (const site of reading?.writes ?? []) {
    const key = input.collectionNamed(site.name);
    const connection = input.connections.find((c) => c.collection === key);
    if (!connection || connection[site.action] === false) continue;
    const given = out.get(site.name) ?? [];
    if (!given.includes(site.action)) out.set(site.name, [...given, site.action]);
  }
  // `fromEntries` defines each name as data: `__proto__` would be a name like any other.
  return Object.fromEntries(out);
}

const failedBy = (failure: CodeFailure): Exclude<Evaluated, { state: "needs" }> => ({
  state: "failed",
  failure,
  source: 0,
});

const limitFailure = (limit: string, max: number, got?: number): CodeFailure => ({
  code: "code.limit",
  detail: { limit, max, ...(got === undefined ? {} : { got }) },
});

/** A limit of the whole step passed: what stops all of it (`code.limit`, with which limit and how far). */
export const limitFault = (limit: string, max: number, got?: number): CodeFault =>
  new CodeFault(`over the limit ${limit} (${max})`, limitFailure(limit, max, got));

const joinWith = (label: Label, more: readonly Label[]): Label =>
  more.length ? join(label, ...more) : label;

/** Which fields of some rows are read by every piece of code together. */
function unionFields(all: readonly FieldsRead[]): FieldsRead {
  if (all.some((f) => f === "all")) return "all";
  return [...new Set((all as readonly (readonly string[])[]).flat())];
}

/** The `item` of each step cited, for the input rows from `lo` to `hi`. */
function sliceItems(
  steps: Record<string, { rows: Fields[]; item?: readonly (number | null)[] }>,
  lo: number,
  hi: number,
): BoxJob["steps"] {
  const out: BoxJob["steps"] = {};
  for (const [name, s] of Object.entries(steps))
    out[name] = s.item ? { rows: s.rows, item: s.item.slice(lo, hi) } : { rows: s.rows };
  return out;
}

/** A row as it is sent: a copy of the fields the code reads, and the labels of what was sent (the row's own first). */
function fieldsOf(row: Row, read: FieldsRead): { fields: Fields; labels: Label[] } {
  const keys =
    read === "all" ? Object.keys(row.json) : read.filter((k) => Object.hasOwn(row.json, k));
  const labels = new Set<Label>([row.label]);
  const fields: Fields = {};
  for (const k of keys) {
    define(fields, k, copyCell(row.json[k] as Cell));
    // Only the row's own entry: a field named `toString` or `__proto__` is not the map's inherited member (AU-25).
    const own = row.fields && Object.hasOwn(row.fields, k) ? row.fields[k] : undefined;
    if (own) labels.add(own.label);
  }
  return { fields, labels: [...labels] };
}

/** A key that is data: defined, never assigned, so `__proto__` is a field like any other (AU-25). */
function define(o: Record<string, Cell>, k: string, v: Cell): void {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
}

/** A copy of a value, its keys defined as data. */
function copyCell(v: Cell): Cell {
  if (Array.isArray(v)) return v.map(copyCell);
  if (typeof v === "object" && v !== null) {
    const o: Record<string, Cell> = {};
    for (const k of Object.keys(v)) define(o, k, copyCell(v[k] as Cell));
    return o;
  }
  return v;
}

/** Bytes of a value as JSON in UTF-8: what a limit of bytes counts. */
export function jsonBytes(v: unknown): number {
  const s = JSON.stringify(v) ?? "";
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

const READ_OPS: readonly string[] = ["find", "get", "count", "sum"];

/** The labels of one row a read gave: the row's, and those of the fields it gives that have their own. */
export interface RowLabels {
  label: Label;
  fields?: Record<string, { label: Label }>;
}

/**
 * What one read gave the rows that asked for it: its value, why it is not one, or the policy's no. `each`: for a
 * `find` or a `get` that found a row, the labels of each row given, in order (an «Agente» shows each row by its own,
 * F15 E3); the box gets the whole read's `label` only.
 */
export type Made =
  | { value: Cell; label?: Label; each?: RowLabels[] }
  | { failure: CodeFailure }
  | { denied: Denied };

/** What a reader of a step needs: its connections, its collections by name, and its day. */
export type ReaderInput = Pick<EvaluateInput, "connections" | "collectionNamed" | "today">;

/**
 * The reads of one step in one run: each made once, counted against the step's limits. A «Código»'s evaluation
 * reads through it, and so does an «Agente»'s rounds (F15 E3): the same `narrow`, the same gate, the same limits.
 */
export class Reader {
  readonly input: ReaderInput;
  readonly gate: Gate;
  readonly records: ReadRecord[] = [];
  readonly made = new Map<string, Made>();
  bytes = 0;

  constructor(input: ReaderInput, gate: Gate) {
    this.input = input;
    this.gate = gate;
  }

  /** A read by the box's key: made once for the step, through the connection and the gate. */
  async read(key: string, asked: CodeRead, label: Label): Promise<Made> {
    const done = this.made.get(key);
    if (done) return done;
    if (this.records.length >= CODE_LIMITS.stepReads)
      throw limitFault("stepReads", CODE_LIMITS.stepReads, this.records.length + 1);
    let made: Made;
    const start = Date.now();
    let record: ReadRecord | undefined;
    try {
      const ask = this.ask(asked);
      const narrowed = narrow(ask, this.input.connections);
      const r = await this.make(narrowed, asked, label);
      record = { collection: ask.collection, op: ask.op, rows: r.rows, bytes: r.bytes, ms: 0 };
      made = {
        value: r.value,
        ...(r.label ? { label: r.label } : {}),
        ...(r.each ? { each: r.each } : {}),
      };
    } catch (e) {
      // The policy's no fails the rows that asked, never the step: «Si falla» decides (Juan, 2026-11-16).
      if (e instanceof Denied) made = { denied: e };
      else if (!(e instanceof CodeFault) || this.stops(e)) throw e;
      else made = { failure: e.why };
    }
    if (record) {
      record.ms = Date.now() - start;
      this.records.push(record);
      this.bytes += record.bytes;
      if (this.bytes > CODE_LIMITS.stepReadBytes)
        throw limitFault("stepReadBytes", CODE_LIMITS.stepReadBytes, this.bytes);
    }
    this.made.set(key, made);
    return made;
  }

  /** What stops the whole step rather than the rows that asked. */
  stops(e: CodeFault): boolean {
    const limit = e.why.detail?.limit;
    return e.why.code === "code.limit" && (limit === "stepReads" || limit === "stepReadBytes");
  }

  /** The read as code wrote it, checked: a collection the step is connected to, by its key, and a query that is one. */
  ask(r: CodeRead): ReadAsk {
    const query = (why: string, more: Record<string, string> = {}) =>
      new CodeFault(`a read of ${r.collection} that is not one (${why})`, {
        code: "code.read.query",
        detail: { collection: r.collection, why, ...more },
      });
    const collection = this.input.collectionNamed(r.collection);
    if (
      collection === undefined ||
      !this.input.connections.some((c) => c.collection === collection)
    )
      throw new CodeFault(`no connection reads ${r.collection}`, {
        code: "code.read.notConnected",
        detail: { collection: r.collection },
      });
    if (!READ_OPS.includes(r.op)) throw query("op");
    if (r.where !== undefined && filterErrors(r.where).length) throw query("where");
    if (
      r.sort !== undefined &&
      (!Array.isArray(r.sort) ||
        !r.sort.every(
          (s) =>
            typeof s === "object" &&
            s !== null &&
            typeof s.field === "string" &&
            (s.direction === "asc" || s.direction === "desc"),
        ))
    )
      throw query("sort");
    if (r.limit !== undefined && !(Number.isInteger(r.limit) && r.limit >= 1)) throw query("limit");
    if (r.op === "get" && typeof r.id !== "string") throw query("id");
    if (r.op === "sum" && typeof r.field !== "string") throw query("field");
    const shape = this.gate.shape(collection);
    const types = new Map((shape?.fields ?? []).map((f) => [f.key, f.type]));
    const named = [
      ...(r.where ?? []).flatMap((i) => (isFilterGroup(i) ? i.rules : [i]).map((x) => x.field)),
      ...(r.sort ?? []).map((s) => s.field),
      ...(r.field === undefined ? [] : [r.field]),
    ];
    for (const field of named)
      if (field !== "id" && !types.has(field)) throw query("field", { field });
    if (r.op === "sum" && types.get(r.field as string) !== "number")
      throw query("notNumber", { field: r.field as string });
    const ask: ReadAsk = { collection, op: r.op };
    if (r.where !== undefined) ask.where = r.where;
    if (r.sort !== undefined) ask.sort = r.sort;
    if (r.limit !== undefined) ask.limit = r.limit;
    if (r.id !== undefined) ask.id = r.id;
    if (r.field !== undefined) ask.field = r.field;
    return ask;
  }

  /** Makes one narrowed read through the gate: the policy is asked with the code's values, judged as calculated. */
  async make(
    ask: NarrowedAsk,
    asked: CodeRead,
    label: Label,
  ): Promise<{ value: Cell; label?: Label; each?: RowLabels[]; rows: number; bytes: number }> {
    const values: Labelled = {};
    const judged = (value: Cell) => ({ value, label, derived: true });
    (asked.where ?? []).forEach((item, i) => {
      if (isFilterGroup(item))
        item.rules.forEach((rule, j) => {
          values[`where.${i}.rules.${j}.value`] = judged(rule.value ?? null);
        });
      else values[`where.${i}.value`] = judged(item.value ?? null);
    });
    if (asked.limit !== undefined) values.limit = judged(asked.limit);
    const where: FilterItem[] = [...(ask.where ?? [])];
    if (ask.op === "find") {
      const found = await this.gate.find(
        {
          collection: ask.collection,
          where,
          sort: ask.sort ?? [],
          limit: ask.limit,
          related: false,
        },
        values,
      );
      const rows = cutRead(found, ask);
      const value: Cell[] = [];
      let bytes = 2;
      const labels: Label[] = [];
      const each: RowLabels[] = [];
      for (const r of rows) {
        const one = asRead(r.origin.id, r.json, ask) as Fields;
        bytes += jsonBytes(one) + 1;
        if (bytes > CODE_LIMITS.readBytes)
          throw limitFault("readBytes", CODE_LIMITS.readBytes, bytes);
        value.push(one);
        labels.push(...rowLabels(r, ask.fields));
        each.push(labelsOf(r, ask.fields));
      }
      return {
        value,
        ...(labels.length ? { label: joinAllOf(labels) } : {}),
        each,
        rows: rows.length,
        bytes,
      };
    }
    if (ask.op === "get") {
      const id = judged(ask.id ?? null);
      const found = await this.gate.get(ask.collection, id);
      // A row outside the connection's «Solo estas filas» is not there for the code.
      const connection = this.input.connections.find((c) => c.collection === ask.collection)?.read;
      const filter = connection ? (connection.where ?? []) : [];
      const shape = this.gate.shape(ask.collection);
      const typeOf = (f: string) => shape?.fields.find((x) => x.key === f)?.type;
      const row =
        found &&
        (!filter.length || matchesFilters(found.json, typeOf, filter, this.input.today, "fail"))
          ? found
          : undefined;
      if (!row) return { value: null, rows: 0, bytes: 4 };
      const one = asRead(row.origin.id, row.json, ask) as Fields;
      const bytes = jsonBytes(one);
      if (bytes > CODE_LIMITS.readBytes)
        throw limitFault("readBytes", CODE_LIMITS.readBytes, bytes);
      return {
        value: one,
        label: joinAllOf(rowLabels(row, ask.fields)),
        each: [labelsOf(row, ask.fields)],
        rows: 1,
        bytes,
      };
    }
    const [result] = await this.gate.aggregate(
      {
        collection: ask.collection,
        where,
        measure: ask.op === "count" ? "count" : "sum",
        ...(ask.field === undefined ? {} : { field: ask.field }),
      },
      values,
    );
    const value = result?.value ?? (ask.op === "count" ? 0 : null);
    return {
      value,
      ...(result ? { label: result.label } : {}),
      rows: 1,
      bytes: jsonBytes(value),
    };
  }
}

/** The labels of what a read gives of a row: the row's and those of the fields it gives that have their own. */
function rowLabels(row: StoredRow, fields: readonly string[] | undefined): Label[] {
  const out = [row.label];
  for (const [k, f] of Object.entries(row.fields ?? {}))
    if (!fields || fields.includes(k)) out.push(f.label);
  return out;
}

/** A row's labels as a read gives it: its own, and those of the fields given that have their own. */
function labelsOf(row: StoredRow, fields: readonly string[] | undefined): RowLabels {
  const own = Object.entries(row.fields ?? {}).filter(([k]) => !fields || fields.includes(k));
  return own.length
    ? { label: row.label, fields: Object.fromEntries(own.map(([k, f]) => [k, { label: f.label }])) }
    : { label: row.label };
}

function joinAllOf(labels: readonly Label[]): Label {
  const unique = [...new Set(labels)];
  return join(...(unique as [Label, ...Label[]]));
}

/**
 * A step's seed in a run: from the run's seed (drawn once when the run starts and kept with it, so repeating the run
 * gives the same) and the step's id. The same whatever the batch size, the order of steps or the retries.
 */
export function seedOf(runSeed: number, step: string): number {
  // FNV-1a over the run's seed and the step's id: a whole number from 0 to 2³² - 1.
  let h = 0x811c9dc5;
  const text = `${runSeed}\u0000${step}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The rows a «Código» gave, from what it returned (AU-30): a list of objects is those rows, one object is one row,
 * `null` or an empty list is no rows. Throws `CodeFault` (`code.result`) for anything else; a missing `return` never
 * gets here (the box answers `code.result`, "nothing"). Keys are data: `__proto__` and its like are fields like any
 * other, and never reach an object's prototype.
 */
export function rowsOf(value: Cell): Fields[] {
  const isRow = (v: Cell): v is Record<string, Cell> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  const notRows = () =>
    new CodeFault("the code gave something that is not rows", {
      code: "code.result",
      detail: { why: "notRows" },
    });
  if (value === null) return [];
  if (isRow(value)) return [copyCell(value) as Fields];
  if (!Array.isArray(value) || !value.every(isRow)) throw notRows();
  return value.map((v) => copyCell(v) as Fields);
}
