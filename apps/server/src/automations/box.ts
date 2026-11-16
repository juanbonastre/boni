/**
 * The engine's box, made of the real one (docs/automatizaciones.md §7, AU-160): the `Box` that `RunDeps` takes, over
 * the socket of the sandbox container (sandbox.ts), speaking protocol 2. It turns a job into a request (the limits of
 * `CODE_LIMITS`, the zone's table and the names of months and days, which the box cannot compute) and an answer into
 * what the engine reads, each fault with its code (AU-35, AU-175). It reads no collection and asks no policy: the
 * engine does both (`evaluate`, through the gate). What comes back is data from another process, never trusted: a
 * line that is not an answer to this call is the box being unavailable, never something the engine acts on.
 */
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import {
  type Box,
  type BoxAnswer,
  type BoxJob,
  CODE_LIMITS,
  type CodeFailure,
  CodeFault,
  type CodeLimit,
  type CodeRead,
  type ConsoleLine,
  type Evaluated,
  type WriteRequest,
} from "@boni/automations";
import { type Locale, monthNames, tzOffsetMs, weekdayNames } from "@boni/calendar";
import {
  type DateNames,
  EVAL_DEFAULT_LIMITS,
  EVALUATE,
  type EvalLimits,
  type EvalRequest,
  type EvalResponse,
  MAX_REQUEST_BYTES,
  type WireEvaluated,
  ZONE_YEARS,
  type ZoneTable,
} from "@boni/sandbox";
import { codeHash, sandboxSocket } from "../sandbox.ts";

export interface SandboxBoxOptions {
  /** The box's socket; `sandboxSocket()` when absent. */
  socket?: string;
  /**
   * How long past a call's own time (`CODE_LIMITS.ms`) the server waits for its answer: what the box takes to start an
   * interpreter and what a call waits at its door behind others. A box that answers later is not waited for.
   */
  marginMs?: number;
}

/**
 * The limits every evaluation is sent with: the engine's, by the keys the box knows. Without them the box would use
 * its own defaults (1 s, 1 MB of answer), and a «Código» with all of 3,000 rows passes the mega (AU-35).
 */
export const BOX_LIMITS: EvalLimits = Object.fromEntries(
  (Object.keys(EVAL_DEFAULT_LIMITS) as (keyof EvalLimits)[]).map((k) => [k, CODE_LIMITS[k]]),
) as unknown as EvalLimits;

/** The box behind the socket. With no box listening, a job rejects with `CodeFault` (`code.unavailable`). */
export function sandboxBox(opts: SandboxBoxOptions = {}): Box {
  const margin = opts.marginMs ?? 5_000;
  return {
    async run(job: BoxJob): Promise<BoxAnswer> {
      const req = requestOf(job);
      const socket = opts.socket ?? sandboxSocket();
      const waitMs = BOX_LIMITS.ms + margin;
      let answer = await once(req, socket, waitMs);
      // A box that is restarting refuses for a moment: one more try, as an extension's call does (sandbox.ts).
      if (answer === "refused") {
        await new Promise((r) => setTimeout(r, 300));
        answer = await once(req, socket, waitMs);
      }
      if (typeof answer === "string") throw unavailable(answer === "late" ? "late" : "unavailable");
      return answerOf(answer);
    },
  };
}

/** A job as the box takes it: only data, the limits of the engine, the zone as a table and the names (AU-28). */
export function requestOf(job: BoxJob): EvalRequest {
  return {
    id: randomUUID(),
    v: EVALUATE,
    kind: job.kind,
    mode: job.kind === "code" ? job.mode : "perRow",
    sources: job.sources,
    hash: codeHash(job.sources.join("\n")),
    input: job.input as EvalRequest["input"],
    from: job.from,
    steps: job.steps as EvalRequest["steps"],
    now: job.now,
    zone: zoneTable(job.zone),
    names: dateNames(job.locale),
    seed: job.seed,
    run: job.run,
    reads: job.reads as EvalRequest["reads"],
    ...(job.kind === "code" && job.writes ? { writes: job.writes } : {}),
    limits: BOX_LIMITS,
  };
}

/** Why a call got no answer: the box refused or is not there, it said nothing in time, or it said something else. */
type NoAnswer = "refused" | "late" | "broken";

/** One request on a connection of its own, one line back: what the box answered, or why it did not. */
function once(req: EvalRequest, socket: string, waitMs: number): Promise<EvalResponse | NoAnswer> {
  return new Promise((resolve) => {
    const s = createConnection(socket);
    const parts: string[] = [];
    let size = 0;
    let done = false;
    const end = (r: EvalResponse | NoAnswer) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      s.destroy();
      resolve(r);
    };
    const timer = setTimeout(() => end("late"), waitMs);
    s.setEncoding("utf8");
    s.on("data", (d: string) => {
      const at = d.indexOf("\n");
      parts.push(at < 0 ? d : d.slice(0, at));
      size += d.length;
      // The box's answer is held whole only up to what a line may be; past it, the box is not doing what it says.
      if (size > MAX_REQUEST_BYTES) return end("broken");
      if (at < 0) return;
      try {
        const r = JSON.parse(parts.join("")) as EvalResponse;
        end(r && typeof r === "object" && r.id === req.id ? r : "broken");
      } catch {
        end("broken");
      }
    });
    // Not there, or refusing: the box is not listening (yet).
    s.on("error", () => end("refused"));
    s.on("close", () => end("broken"));
    s.write(`${JSON.stringify(req)}\n`);
  });
}

const unavailable = (why: "unavailable" | "busy" | "late", message?: string): CodeFault =>
  new CodeFault(message ?? `the box is ${why}`, {
    code: "code.unavailable",
    detail: { why: why === "busy" ? "busy" : "unavailable" },
  });

const limitHit = (limit: CodeLimit, message: string): CodeFault =>
  new CodeFault(message, { code: "code.limit", detail: { limit, max: CODE_LIMITS[limit] } });

/** A call's own failure: what stops the whole step, never one row's (the port's contract, box.ts in the engine). */
function callFault(r: Extract<EvalResponse, { ok: false }>): CodeFault {
  switch (r.error) {
    case "busy":
      return unavailable("busy", r.message);
    case "timeout":
      return limitHit("ms", r.message);
    case "steps":
      return limitHit("steps", r.message);
    case "memory":
      return limitHit("memoryBytes", r.message);
    case "output":
      return limitHit("outputBytes", r.message);
    default:
      // `invalid`, `exception`, `unavailable`: the box could not run it, whatever the code is.
      return unavailable("unavailable", r.message);
  }
}

/** The most characters of a thrown message kept (`code.threw`). */
const MESSAGE_CHARS = 500;

const at = (e: { line?: number; column?: number }): Record<string, number> => ({
  ...(typeof e.line === "number" ? { line: e.line } : {}),
  ...(typeof e.column === "number" ? { column: e.column } : {}),
});

/** One evaluation's fault as the engine's failure: what the code did, said by its code (AU-33, AU-35, AU-175). */
function failureOf(e: Extract<WireEvaluated, { state: "failed" }>): CodeFailure {
  const message = String(e.message ?? "");
  switch (e.fault) {
    case "threw":
      return { code: "code.threw", detail: { message: message.slice(0, MESSAGE_CHARS), ...at(e) } };
    case "result":
      return { code: "code.result", detail: { why: message } };
    case "frozen":
      return { code: "code.frozen", detail: at(e) };
    case "reads":
      return { code: "code.limit", detail: { limit: "reads", max: CODE_LIMITS.reads } };
    case "writes":
      return { code: "code.limit", detail: { limit: "writes", max: CODE_LIMITS.writes } };
    default:
      throw unavailable("unavailable", "the box gave a fault it does not have");
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** An answer as the engine reads it. Anything not in the protocol's shape is the box being unavailable. */
export function answerOf(r: EvalResponse): BoxAnswer {
  if (!r.ok) throw callFault(r);
  if (!Array.isArray(r.evaluations) || !Array.isArray(r.console))
    throw unavailable("unavailable", "the box gave an answer that is not one");
  const evaluations = r.evaluations.map((e): Evaluated => {
    if (!isObject(e))
      throw unavailable("unavailable", "the box gave an evaluation that is not one");
    if (e.state === "done") {
      if (!Array.isArray(e.values)) throw unavailable("unavailable", "the box gave no values");
      return {
        state: "done",
        values: e.values,
        clock: e.clock === true,
        random: e.random === true,
        // Requests are only a «Código»'s; the engine fails an evaluation of expressions that carries one (AU-184).
        ...(Array.isArray(e.writes) ? { writes: e.writes as readonly WriteRequest[] } : {}),
      };
    }
    if (e.state === "needs") {
      if (typeof e.key !== "string" || !isObject(e.read) || typeof e.read.collection !== "string")
        throw unavailable("unavailable", "the box asked for a read that is not one");
      // As the code wrote it: the engine checks every part of it against the step's connection (AU-161).
      return { state: "needs", key: e.key, read: e.read as unknown as CodeRead };
    }
    if (e.state === "failed")
      return {
        state: "failed",
        failure: failureOf(e as unknown as Extract<WireEvaluated, { state: "failed" }>),
        source: typeof e.source === "number" ? e.source : 0,
      };
    throw unavailable("unavailable", "the box gave an evaluation that is not one");
  });
  const console: ConsoleLine[] = [];
  for (const l of r.console) {
    if (!isObject(l) || typeof l.text !== "string") continue;
    const level = l.level === "info" || l.level === "warn" || l.level === "error" ? l.level : "log";
    console.push({
      level,
      text: l.text,
      ...(typeof l.line === "number" ? { line: l.line } : {}),
      ...(typeof l.row === "number" ? { row: l.row } : {}),
    });
  }
  return {
    evaluations,
    console,
    dropped: typeof r.dropped === "number" ? r.dropped : 0,
    ms: typeof r.ms === "number" ? r.ms : 0,
  };
}

const tables = new Map<string, ZoneTable>();

/**
 * A time zone's changes of offset over `ZONE_YEARS`, computed once per zone with `packages/calendar/src/time.ts` and
 * kept: what a date in the box does must be what the same date does in Boni (AU-28). Found by weeks, then to the
 * minute: no zone changes its offset twice in a week.
 */
export function zoneTable(zone: string): ZoneTable {
  const known = tables.get(zone);
  if (known) return known;
  const start = Date.UTC(ZONE_YEARS[0], 0, 1);
  const end = Date.UTC(ZONE_YEARS[1] + 1, 0, 1);
  const off = (ms: number) => Math.round(tzOffsetMs(ms, zone) / 60_000);
  const offsets: [number, number][] = [[start, off(start)]];
  const WEEK = 7 * 86_400_000;
  for (let t = start; t < end; t += WEEK) {
    const next = Math.min(t + WEEK, end);
    const before = off(t);
    if (off(next) === before) continue;
    let lo = t;
    let hi = next;
    while (hi - lo > 60_000) {
      const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
      if (off(mid) === before) lo = mid;
      else hi = mid;
    }
    offsets.push([hi, off(hi)]);
  }
  const table: ZoneTable = { zone, offsets };
  tables.set(zone, table);
  return table;
}

/** The names of months and days in a language, from `time.ts`, the days from Monday. Spanish for any other. */
export function dateNames(locale: string): DateNames {
  const lang: Locale = locale === "en" ? "en" : "es";
  const fromMonday = (a: string[]) => [...a.slice(1), a[0] as string];
  return {
    months: monthNames(lang, "long"),
    monthsShort: monthNames(lang, "short"),
    days: fromMonday(weekdayNames(lang, "long")),
    daysShort: fromMonday(weekdayNames(lang, "short")),
  };
}
