/**
 * Protocol 2 of the box: evaluating the JavaScript of an automation (docs/automatizaciones.md §7, AU-160): expressions
 * and «Código», by batches of rows, with the reads the code asks for and Boni's server makes, the console collected,
 * and the clock and chance fixed by the run. Beside protocol 1 (protocol.ts, an extension's function), over the same
 * socket and under the same door: one JSON line in, one out, a worker and an interpreter of its own per call, ended
 * from outside if it does not stop. Nothing here knows of collections, labels or policy: those stay in Boni's server.
 * Contracts of F14c; the box's half is apps/sandbox/src/evaluate.ts.
 */
import { DEFAULT_LIMITS, type Limits, MAX_LIMITS, type RunError } from "./protocol.ts";

/** What tells a line of this protocol from one of protocol 1, which has no `v`. */
export const EVALUATE = 2;

/** JSON, as it travels. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** A time zone as the box needs it, having no `Intl`: every change of its offset, oldest first. */
export interface ZoneTable {
  zone: string;
  /** `[from, minutes]`: from that instant (epoch ms) on, local time is UTC plus those minutes. */
  offsets: readonly (readonly [number, number])[];
}
/** The years a `ZoneTable` covers; a date outside them takes the nearest end's offset. */
export const ZONE_YEARS = [1970, 2100] as const;

/** The names `.format(…)` writes, in the run's language: twelve months and seven days from Monday, long and short. */
export interface DateNames {
  months: readonly string[];
  monthsShort: readonly string[];
  days: readonly string[];
  daysShort: readonly string[];
}

/** A read the code asked for and does not have, as it wrote it. The box checks nothing of it but its size. */
export interface WireRead {
  collection: string;
  op: "find" | "get" | "count" | "sum";
  where?: Json;
  sort?: Json;
  limit?: Json;
  id?: Json;
  field?: Json;
}

export interface EvalLimits extends Limits {
  /** Lines of console kept, and characters of each. */
  consoleLines: number;
  consoleLineChars: number;
  /** Different reads one evaluation may ask for. */
  reads: number;
}

export interface EvalRequest {
  id: string;
  v: typeof EVALUATE;
  kind: "expressions" | "code";
  /** `code`: once with all the rows, or once per row. Expressions: always `perRow`. */
  mode: "all" | "perRow";
  sources: readonly string[];
  /** sha256 in hex of the sources joined by a line feed, checked by the box. */
  hash: string;
  input: readonly { [key: string]: Json }[];
  from: number;
  steps: {
    [name: string]: { rows: readonly { [key: string]: Json }[]; item?: readonly (number | null)[] };
  };
  /** All it may know of the world: the run's instant, its zone, the names of months and days, a seed. */
  now: number;
  zone: ZoneTable;
  names: DateNames;
  seed: number;
  run: { test: boolean; startedBy: string };
  /** What was read before, by the key the box gave each read. */
  reads: { [key: string]: Json };
  limits?: Partial<EvalLimits>;
}

/** What one evaluation says went wrong; Boni's server turns each into a failure code of its own. */
export type EvalFault =
  /** The code threw: `message` is its own. */
  | "threw"
  /** It returned nothing, a promise, or something that is not JSON: `message` says which ("nothing", "promise", "notJson"). */
  | "result"
  /** It tried to change what it was given or something of the interpreter. */
  | "frozen"
  /** It asked for more different reads than `limits.reads`. */
  | "reads";

export type WireEvaluated =
  | { state: "done"; values: readonly Json[]; clock: boolean; random: boolean }
  | { state: "needs"; key: string; read: WireRead }
  | {
      state: "failed";
      fault: EvalFault;
      message: string;
      source: number;
      line?: number;
      column?: number;
    };

export interface WireConsoleLine {
  level: "log" | "info" | "warn" | "error";
  text: string;
  line?: number;
  row?: number;
}

export type EvalResponse =
  | {
      id: string;
      ok: true;
      evaluations: readonly WireEvaluated[];
      console: readonly WireConsoleLine[];
      dropped: number;
      steps: number;
      ms: number;
    }
  /** The whole call: `row`, the row of the input it was on, when the box knows. */
  | {
      id: string;
      ok: false;
      error: RunError;
      message: string;
      row?: number;
      steps?: number;
      ms?: number;
    };

/** The most characters of a read's key (the box makes it from the read; Boni's server only hands it back). */
export const MAX_READ_KEY = 128;

/** Whether a parsed line asks for an evaluation (`v` is `EVALUATE`) and not for a function call. */
export const isEvalRequest = (v: unknown): boolean =>
  typeof v === "object" && v !== null && (v as { v?: unknown }).v === EVALUATE;

/** An evaluation's limits when the request says none (Boni's server sends its own, `CODE_LIMITS`). */
export const EVAL_DEFAULT_LIMITS: EvalLimits = {
  ...DEFAULT_LIMITS,
  // About 1,500 calls deep: QuickJS's stack must end before the thread's (in a test's own thread too), so that a
  // recursion without end is the code's error (`threw`) and not the call's.
  stackBytes: 256 * 1024,
  consoleLines: 200,
  consoleLineChars: 2_000,
  reads: 20,
};
/** The most an evaluation may ask for. */
export const EVAL_MAX_LIMITS: EvalLimits = {
  ...MAX_LIMITS,
  // The most the box's worker (a 4 MB stack, server.ts) follows with room to spare.
  stackBytes: 512 * 1024,
  consoleLines: 1_000,
  consoleLineChars: 10_000,
  reads: 100,
};
/** A read as the code wrote it, at most, as JSON: what it asks travels to Boni's server, which checks the rest. */
export const MAX_READ_BYTES = 64 * 1024;

const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const HASH = /^[0-9a-f]{64}$/;
/** What a request may hold: anything else is refused, so it can name nothing of the server (a path, a callback). */
const MEMBERS = new Set([
  "id",
  "v",
  "kind",
  "mode",
  "sources",
  "hash",
  "input",
  "from",
  "steps",
  "now",
  "zone",
  "names",
  "seed",
  "run",
  "reads",
  "limits",
]);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isRows = (v: unknown): v is unknown[] => Array.isArray(v) && v.every(isObject);
const isTexts = (v: unknown, n: number) =>
  Array.isArray(v) && v.length === n && v.every((x) => typeof x === "string");
const isWhole = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);

/** What is wrong with an evaluation's request, empty when it is one: as `requestErrors` for protocol 1. */
export function evalRequestErrors(v: unknown): string[] {
  if (!isObject(v)) return ["no es un objeto"];
  const out: string[] = [];
  for (const k of Object.keys(v)) if (!MEMBERS.has(k)) out.push(k);
  if (typeof v.id !== "string" || !ID.test(v.id)) out.push("id");
  if (v.v !== EVALUATE) out.push("v");
  if (v.kind !== "expressions" && v.kind !== "code") out.push("kind");
  // Expressions are always evaluated row by row; «Código» is once with all the rows or once per row, one source.
  if (v.mode !== "perRow" && (v.mode !== "all" || v.kind !== "code")) out.push("mode");
  const sources = v.sources;
  if (
    !Array.isArray(sources) ||
    !sources.length ||
    (v.kind === "code" && sources.length !== 1) ||
    !sources.every((s) => typeof s === "string" && s.length > 0)
  )
    out.push("sources");
  if (typeof v.hash !== "string" || !HASH.test(v.hash)) out.push("hash");
  const rows = isRows(v.input) ? v.input.length : -1;
  if (rows < 0) out.push("input");
  if (!isWhole(v.from) || v.from < 0) out.push("from");
  if (!isObject(v.steps)) out.push("steps");
  else
    for (const [name, step] of Object.entries(v.steps)) {
      if (!isObject(step) || !isRows(step.rows)) {
        out.push(`steps.${name}`);
        continue;
      }
      for (const k of Object.keys(step))
        if (k !== "rows" && k !== "item") out.push(`steps.${name}.${k}`);
      const n = step.rows.length;
      // `item[i]`: which of the step's rows the input's row `i` comes from (AU-13), or none.
      if (
        step.item !== undefined &&
        (!Array.isArray(step.item) ||
          step.item.length !== rows ||
          !step.item.every((x) => x === null || (isWhole(x) && x >= 0 && x < n)))
      )
        out.push(`steps.${name}.item`);
    }
  if (!isWhole(v.now)) out.push("now");
  const zone = v.zone;
  if (
    !isObject(zone) ||
    typeof zone.zone !== "string" ||
    !zone.zone ||
    !Array.isArray(zone.offsets) ||
    !zone.offsets.length ||
    !zone.offsets.every(
      (o, i, all) =>
        Array.isArray(o) &&
        o.length === 2 &&
        Number.isFinite(o[0]) &&
        Number.isFinite(o[1]) &&
        Math.abs(o[1]) <= 24 * 60 &&
        (i === 0 || o[0] > (all[i - 1] as number[])[0]!),
    )
  )
    out.push("zone");
  const names = v.names;
  if (
    !isObject(names) ||
    !isTexts(names.months, 12) ||
    !isTexts(names.monthsShort, 12) ||
    !isTexts(names.days, 7) ||
    !isTexts(names.daysShort, 7)
  )
    out.push("names");
  if (!isWhole(v.seed)) out.push("seed");
  const run = v.run;
  if (
    !isObject(run) ||
    typeof run.test !== "boolean" ||
    typeof run.startedBy !== "string" ||
    Object.keys(run).length !== 2
  )
    out.push("run");
  if (!isObject(v.reads)) out.push("reads");
  else
    for (const k of Object.keys(v.reads))
      if (!k.length || k.length > MAX_READ_KEY) out.push(`reads.${k.slice(0, 16)}`);
  if (v.limits !== undefined) {
    if (!isObject(v.limits)) out.push("limits");
    else
      for (const [k, x] of Object.entries(v.limits))
        if (!(k in EVAL_DEFAULT_LIMITS) || typeof x !== "number" || !(x > 0))
          out.push(`limits.${k}`);
  }
  return out;
}

/** An evaluation's limits: its own where it says them, never past the most the box allows. */
export function evalLimitsOf(req: Pick<EvalRequest, "limits">): EvalLimits {
  const out = { ...EVAL_DEFAULT_LIMITS };
  for (const k of Object.keys(out) as (keyof EvalLimits)[]) {
    const want = req.limits?.[k];
    if (typeof want === "number" && want > 0)
      out[k] = Math.min(Math.max(1, Math.floor(want)), EVAL_MAX_LIMITS[k]);
  }
  return out;
}
