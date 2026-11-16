/**
 * JavaScript in an automation (docs/automatizaciones.md §5.3, §5.4, §6): the «Código» step as the catalogue will hold
 * it, every limit of an evaluation as a named number, and the codes of what can go wrong, before running (a problem of
 * validation) and while running (a `StepFault`). Contracts of F14c: the lists here are apart from `CATALOGUE`,
 * `CONTROLS`, `PROBLEMS` and `STEP_FAILURES` until the PR that brings their words to the screen joins them (the canvas
 * has a text for each entry of those four, and F14b is still building it).
 */
import { type StepFailure, StepFault } from "./failures.ts";
import type { Problem } from "./validate.ts";

// ---------------------------------------------------------------- the step

/** The step type's key. Its category is «Transformar». */
export const CODE_TYPE = "code";
/** Its two parameters, both `shape`: neither may be an expression (AU-26). */
export const CODE_PARAMS = { mode: "mode", source: "source" } as const;
/** «Se ejecuta» (AU-30): «Una vez con todas las filas», the default, or «Una vez por fila». */
export const CODE_MODES = ["all", "perRow"] as const;
export type CodeMode = (typeof CODE_MODES)[number];
/** The two controls F14c adds to the catalogue's seven (AU-80): the code editor and the connections' table. */
export const CODE_CONTROLS = ["code", "connections"] as const;

// ---------------------------------------------------------------- the limits

const KB = 1024;
const MB = 1024 * KB;

/**
 * Every limit of JavaScript in an automation, by its key (AU-35). The key is what a failure says (`code.limit`,
 * `detail.limit`) and what the screen has words for. They are the starting numbers, chosen so that the server (384 MB)
 * and the box hold a step of 3,000 rows: the builder measures (AU-38) and may lower one, never remove it.
 */
export const CODE_LIMITS = {
  /** Characters of a «Código» step's source. Checked by validation. */
  sourceChars: 20_000,
  /** Characters of the JavaScript of one `{{ }}`. Checked by validation. */
  expressionChars: 2_000,
  /** Milliseconds one call to the box may run (one batch of rows, or «Código» once with all). */
  ms: 5_000,
  /** The interpreter's own count (it stops to ask about every ten thousand operations): the same on any machine. */
  steps: 5_000,
  /** The interpreter's memory for one call, bytes. */
  memoryBytes: 64 * MB,
  /**
   * The interpreter's stack, bytes: about 1,500 calls deep. Measured 2026-11-16 (E1): at 512 KB a recursion without end
   * overflowed the thread's own stack before QuickJS's, and the call failed whole instead of as the code's error.
   */
  stackBytes: 256 * KB,
  /** What one call may be sent, as JSON: its rows, the rows of the steps it cites and what it has read. */
  inputBytes: 8 * MB,
  /** What one call may answer, as JSON. */
  outputBytes: 4 * MB,
  /** Rows a «Código» step may give. */
  outputRows: 10_000,
  /** Rows of the step's input per call to the box, in an expression or in «Una vez por fila» (AU-38). */
  batchRows: 500,
  /** Different reads one evaluation may make (one row's, or the whole step's in «Una vez con todas las filas»). */
  reads: 20,
  /** Reads a step may make in a run, all its rows together. */
  stepReads: 100,
  /** Rows one read may give. A read with more fails; it is never cut to this (the code and the connection can limit). */
  readRows: 5_000,
  /** Bytes one read may give, as JSON. */
  readBytes: 2 * MB,
  /** Bytes a step may read in a run, all its reads together (the server holds them while it runs). */
  stepReadBytes: 4 * MB,
  /** Lines of «Consola» kept for a step; the rest are counted and not kept. Never a failure. */
  consoleLines: 200,
  /** Characters of one line of «Consola»; a longer one is cut. Never a failure. */
  consoleLineChars: 2_000,
} as const;
export type CodeLimit = keyof typeof CODE_LIMITS;

/** The limits whose passing stops the step (`code.limit`); the two of «Consola» only cut what is kept. */
export const HARD_LIMITS: readonly CodeLimit[] = (Object.keys(CODE_LIMITS) as CodeLimit[]).filter(
  (k) => k !== "consoleLines" && k !== "consoleLineChars",
);

// ---------------------------------------------------------------- what goes wrong while running

/**
 * Why JavaScript failed, as keys (AU-33, AU-35, AU-67). A citation that gives nothing keeps the codes it has
 * (`cite.*`), and a read the policy refuses keeps `policy.denied` and `policy.waits`.
 */
export const CODE_FAILURES = [
  /**
   * The code threw. `detail.message` is its message as it is, plain text, at most 500 characters; `detail.line` and
   * `detail.column`, where (1-based, of the source Juan wrote; absent when the interpreter cannot say).
   */
  "code.threw",
  /**
   * A limit was passed. `detail.limit`: its key in `CODE_LIMITS`; `detail.max`: the limit; `detail.got`: what it
   * reached, where that can be known (bytes, rows, reads; never for `ms`, `steps` or `memoryBytes`, which are cut at
   * the limit).
   */
  "code.limit",
  /**
   * What it gave is not what the step takes. `detail.why`: "nothing" (no `return`), "notRows" (not a list of objects
   * nor one object), "notJson" (a function, a cycle, a number that is not finite), "promise" (code cannot wait).
   */
  "code.result",
  /**
   * It tried to change what it may only look at: another step's rows, what it read, `$run`, or something of the
   * interpreter or of the world Boni gives it. The rows that reach the step it may change (AU-37, Juan 2026-11-16).
   * `detail.line`, `detail.column`.
   */
  "code.frozen",
  /** `$col` of a collection the step is not connected to, found while running (AU-161). `detail.collection`: as written. */
  "code.read.notConnected",
  /**
   * A read that is not one. `detail.collection`; `detail.why`: "where", "sort", "limit", "id", "field" (it has no
   * such field: `detail.field`), "hidden" (the connection does not let that field be read: `detail.field`),
   * "notNumber" (`sum` of a field that is not a number).
   */
  "code.read.query",
  /** There is no box to run it, or it is busy. `detail.why`: "unavailable" or "busy". Nothing ran. */
  "code.unavailable",
] as const;
export type CodeFailureCode = (typeof CODE_FAILURES)[number];

export interface CodeFailure {
  code: CodeFailureCode;
  /** As `StepFailure.param`: the parameter whose expression failed; `CODE_PARAMS.source` in a «Código». */
  param?: string;
  detail?: Record<string, string | number>;
}

/**
 * A failure of JavaScript: a `StepFault`, so the engine records it as it records any other. Until `STEP_FAILURES`
 * takes these codes (with the screen that has their words), `failure.code` is `other` and `why` says which it is;
 * from then on `failure` is `why`.
 */
export class CodeFault extends StepFault {
  readonly why: CodeFailure;
  constructor(message: string, why: CodeFailure) {
    const failure: StepFailure = { code: "other" };
    if (why.param !== undefined) failure.param = why.param;
    super(message, failure);
    this.name = "CodeFault";
    this.why = why;
  }
}

// ---------------------------------------------------------------- what is wrong before running

/**
 * The problems F14c adds to validation, as keys. `step` and `param` as in any `Problem`; where the problem has a
 * place in the code, `detail.line` and `detail.column` (1-based) and `detail.from` and `detail.to` (offsets in the
 * source), so the editor marks it (AU-36). They replace `expr.code`, which nothing gives once JavaScript is in.
 */
export const CODE_PROBLEMS = [
  /** It is not JavaScript. `detail.message`: the parser's, plain text. */
  "code.syntax",
  /** Over `sourceChars` or `expressionChars`. `detail.max`, `detail.got`. */
  "code.long",
  /** `$(…)` or `$col(…)` with anything but a text written there: what it cites must be readable before it runs (AU-163). `detail.what`: "step" or "collection". */
  "code.computed",
  /** A name that starts with `$` and is none of `CODE_GLOBALS`. `detail.name`. */
  "code.unknownGlobal",
  /** `$col` of a name no collection has. `detail.name`. */
  "code.unknownCollection",
  /** `$col` of a collection the step has no connection to (AU-31). `detail.collection` (its key): the button connects it. */
  "code.notConnected",
  /** `$col` in an expression: only «Código» reads collections (AU-46). */
  "code.readInExpression",
  /** `await`, `async`, `import` or a generator: code gives its result at once. `detail.what`. */
  "code.cannotWait",
  /**
   * A warning: a field read of a step (`$('Paso').first().campo`) that the step's last test did not give (AU-25,
   * AU-36). `detail.name` (the step), `detail.field`. It runs: the field is `undefined` if it is still not there.
   */
  "code.fieldNotGiven",
  /** A connection on a step type that takes none (AU-46). */
  "connection.notAllowed",
  /** A connection to a collection that does not exist. `detail.collection`. */
  "connection.unknown",
  /** Two connections of one step to the same collection. `detail.collection`. */
  "connection.repeated",
  /** More than `MAX_CONNECTIONS`. */
  "connection.many",
  /** A permission to create, modify or remove on a step that only reads (AU-32, AU-41). `detail.action`. */
  "connection.write",
  /** A limit that is not one: a field the collection does not have (`detail.field`), a filter that is not the views', a limit that is not a whole number from 1 to `CODE_LIMITS.readRows`. `detail.why`: "field", "where", "limit". */
  "connection.limits",
] as const;
export type CodeProblemCode = (typeof CODE_PROBLEMS)[number];

/** The codes of `CODE_PROBLEMS` that are only warnings; every other is an error. */
export const CODE_WARNINGS: readonly CodeProblemCode[] = ["code.fieldNotGiven"];

/** A `Problem` with one of F14c's codes. Citations of steps keep the codes they have (`expr.unknownStep`, `expr.notBefore`, `expr.cannotPair`, `expr.noCurrentRow`). */
export type CodeProblem = Omit<Problem, "code"> & { code: CodeProblemCode };
