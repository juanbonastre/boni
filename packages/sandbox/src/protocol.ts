/**
 * What Boni's server asks the box that runs an extension's functions, and what it answers (docs/extensiones.md §11.6,
 * E1): one JSON object per line over a Unix socket, nothing else. A function is pure: it gets its input, the day and a
 * seed, and gives back JSON; everything that touches something stays in Boni's code.
 */
import { type Schema, schemaShapeErrors } from "./schema.ts";

export interface Limits {
  /**
   * How many times the interpreter may stop to ask whether to go on (QuickJS asks about every ten thousand
   * operations): the same count on the laptop and on the NAS, so a function that fits here fits there.
   */
  steps: number;
  /** Milliseconds it may run: the safety net, for what does not count steps. */
  ms: number;
  memoryBytes: number;
  stackBytes: number;
  outputBytes: number;
}

const MB = 1024 * 1024;
export const DEFAULT_LIMITS: Limits = {
  steps: 1_000,
  ms: 1_000,
  memoryBytes: 64 * MB,
  stackBytes: 512 * 1024,
  outputBytes: 1 * MB,
};
/** The most a request may ask for. */
export const MAX_LIMITS: Limits = {
  steps: 20_000,
  ms: 10_000,
  memoryBytes: 96 * MB,
  stackBytes: 1 * MB,
  outputBytes: 8 * MB,
};
/** A request's line, at most (its input included). */
export const MAX_REQUEST_BYTES = 16 * MB;
/** Where the box listens when nothing says otherwise (a folder the server's container shares with it). */
export const DEFAULT_SOCKET = "/run/boni-sandbox/sandbox.sock";

export interface RunRequest {
  id: string;
  /** The code: a script whose top level defines its functions (no modules, no imports). */
  code: string;
  /** The code's sha256 in hex, checked by the box. */
  hash: string;
  /** The function to call: `fn(input, { day, random })`. */
  fn: string;
  input: unknown;
  /** All it may know of the world: today (YYYY-MM-DD) and a seed for `random()`. */
  day: string;
  seed: number;
  limits?: Partial<Limits>;
  /** Its output's schema, when it has one: an output that does not fit is an error. */
  output?: Schema;
}

export type RunError =
  /** The request is not one (it says why). */
  | "invalid"
  /** Too many waiting; ask again later. */
  | "busy"
  /** It used its steps. */
  | "steps"
  /** It ran out of time. */
  | "timeout"
  /** It wanted more memory than it may have. */
  | "memory"
  /** Its output is too big, not JSON or not what its schema says. */
  | "output"
  /** It threw (its message is said). */
  | "exception"
  /** There is no box (Boni's side: it is not running). */
  | "unavailable";

export type RunResponse =
  | { id: string; ok: true; output: unknown; steps: number; ms: number }
  | { id: string; ok: false; error: RunError; message: string; steps?: number; ms?: number };

const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const FN = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
const HASH = /^[0-9a-f]{64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** What is wrong with a request, empty when it is one. */
export function requestErrors(v: unknown): string[] {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return ["no es un objeto"];
  const r = v as Record<string, unknown>;
  const out: string[] = [];
  if (typeof r.id !== "string" || !ID.test(r.id)) out.push("id");
  if (typeof r.code !== "string" || !r.code.length) out.push("code");
  if (typeof r.hash !== "string" || !HASH.test(r.hash)) out.push("hash");
  if (typeof r.fn !== "string" || !FN.test(r.fn)) out.push("fn");
  if (!("input" in r)) out.push("input");
  if (typeof r.day !== "string" || !DAY.test(r.day)) out.push("day");
  if (typeof r.seed !== "number" || !Number.isInteger(r.seed)) out.push("seed");
  if (r.limits !== undefined) {
    if (typeof r.limits !== "object" || r.limits === null) out.push("limits");
    else
      for (const [k, x] of Object.entries(r.limits))
        if (!(k in DEFAULT_LIMITS) || typeof x !== "number" || !(x > 0)) out.push(`limits.${k}`);
  }
  if (r.output !== undefined) out.push(...schemaShapeErrors(r.output, "output"));
  return out;
}

/** A request's limits: its own where it says them, never past the most allowed. */
export function limitsOf(req: Pick<RunRequest, "limits">): Limits {
  const out = { ...DEFAULT_LIMITS };
  for (const k of Object.keys(out) as (keyof Limits)[]) {
    const want = req.limits?.[k];
    if (typeof want === "number" && want > 0) out[k] = Math.min(Math.floor(want), MAX_LIMITS[k]);
  }
  return out;
}

/** An answer's message, short and on one line (it comes from the function, so it is only text). */
export const shortMessage = (m: unknown) =>
  String(m ?? "")
    .replace(/\s+/g, " ")
    .slice(0, 500);
