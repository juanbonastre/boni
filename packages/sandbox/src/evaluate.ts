/**
 * Protocol 2 of the box: evaluating the JavaScript of an automation (docs/automatizaciones.md §7, AU-160): expressions
 * and «Código», by batches of rows, with the reads the code asks for and Boni's server makes, the console collected,
 * and the clock and chance fixed by the run. Beside protocol 1 (protocol.ts, an extension's function), over the same
 * socket and under the same door: one JSON line in, one out, a worker and an interpreter of its own per call, ended
 * from outside if it does not stop. Nothing here knows of collections, labels or policy: those stay in Boni's server.
 * Contracts of F14c (the box's half is apps/sandbox/src/evaluate.ts): not built yet.
 */
import type { Limits, RunError } from "./protocol.ts";

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

/** What is wrong with an evaluation's request, empty when it is one: as `requestErrors` for protocol 1. */
export function evalRequestErrors(v: unknown): string[] {
  throw new Error(`@boni/sandbox: evalRequestErrors(${typeof v}) is not built yet (F14c)`);
}

/** An evaluation's limits: its own where it says them, never past the most the box allows. */
export function evalLimitsOf(req: Pick<EvalRequest, "limits">): EvalLimits {
  throw new Error(`@boni/sandbox: evalLimitsOf(${typeof req.limits}) is not built yet (F14c)`);
}
