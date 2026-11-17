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
/**
 * The «Agente»'s step type key (F15, AU-50). Its step is E3's; what its connections are born with (AU-196) and what
 * the policy is told of it (AU-204, `byAgent`) are read from this key in the stored version.
 */
export const AGENT_TYPE = "agent";
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
  // Saving from code (AU-175, `WRITE_LIMITS` in writes.ts). Passing one fails the step and saves nothing: never cut,
  // since half of a change is another change. Reasoned, not measured: a builder may lower one, never remove it.
  /**
   * Requests one evaluation may make. As many as a step: «Una vez con todas las filas» is one evaluation. It is
   * apart so the box stops a loop that never ends as soon as it passes it, inside the box.
   */
  writes: 5_000,
  /**
   * Requests a step may make in a run, all its evaluations together. `readRows`: what one read gives can be written
   * back at once, so a step over Juan's thousands of rows of one collection fits.
   */
  stepWrites: 5_000,
  /** Bytes of one request, as JSON: a row's fields, a long text among them. */
  writeBytes: 64 * KB,
  /** Bytes of all of a step's requests, as JSON: the server holds them until the step ends (384 MB in all). */
  stepWriteBytes: 4 * MB,
} as const;
export type CodeLimit = keyof typeof CODE_LIMITS;

/** The limits whose passing stops the step (`code.limit`); the two of «Consola» only cut what is kept. */
export const HARD_LIMITS: readonly CodeLimit[] = (Object.keys(CODE_LIMITS) as CodeLimit[]).filter(
  (k) => k !== "consoleLines" && k !== "consoleLineChars",
);

/**
 * The three write actions, by the keys `Connection` and the «Colección» step already use, and so their words (AU-85:
 * Crear, Modificar, Eliminar). They are also the names of `$col('…')`'s methods that ask to save (AU-172):
 * `.create({ field: value })`, `.update(id, { field: value })`, `.remove(id)` (to the trash, AU-122).
 */
export const WRITE_ACTIONS = ["create", "update", "remove"] as const;
export type WriteAction = (typeof WRITE_ACTIONS)[number];

/** `$col('…')`'s methods: the four that read (AU-31) and the three that ask to save. Any other does not validate. */
export const COL_METHODS = ["find", "get", "count", "sum", ...WRITE_ACTIONS] as const;
export type ColMethod = (typeof COL_METHODS)[number];

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
   * such field: `detail.field`), "hidden" (the connection does not let that field be read: `detail.field`), "op"
   * (an operation that is not find, get, count or sum),
   * "notNumber" (`sum` of a field that is not a number).
   */
  "code.read.query",
  /** There is no box to run it, or it is busy. `detail.why`: "unavailable" or "busy". Nothing ran. */
  "code.unavailable",
  // Why a step's requests to save were not saved (AU-174, AU-177, AU-183, AU-184; `WRITE_FAILURES` in writes.ts):
  // whichever it is, nothing of the step was saved. A request the policy refuses keeps `policy.denied`; a row that
  // changed since it was read, `row.changed`; a value the field does not take, `value.type` (the «Colección»
  // executor's own codes). A limit is `code.limit` with `writes`, `stepWrites`, `writeBytes` or `stepWriteBytes`.
  /**
   * The analysis of the saved code did not find that collection with that action (AU-183), or it came from an
   * evaluation of expressions (AU-184). `detail.collection` (as written), `detail.action`, `detail.where`: "code" or
   * "expression".
   */
  "code.write.unseen",
  /** The step's connection, as saved, does not give that action (AU-176). `detail.collection` (its key), `detail.action`. */
  "code.write.notAllowed",
  /**
   * Outside «Solo estas filas» (AU-177). `detail.why`: "row" (the row to modify or remove is not one the connection
   * lets the step see: it does not exist, or the filter leaves it out, said the same way so code cannot tell which)
   * or "created" (the row as it would be created does not pass the filter). `detail.collection` (its key).
   */
  "code.write.outside",
  /** A field «Solo estos campos» does not let the step see (AU-177). `detail.collection`, `detail.field`. */
  "code.write.hidden",
  /**
   * A request that is not one. `detail.why`: "id" (not a text), "fields" (not an object of fields), "field" (the
   * collection has no such field: `detail.field`), "empty" (`update` with no field).
   */
  "code.write.request",
] as const;
export type CodeFailureCode = (typeof CODE_FAILURES)[number];

export interface CodeFailure {
  code: CodeFailureCode;
  /** As `StepFailure.param`: the parameter whose expression failed; `CODE_PARAMS.source` in a «Código». */
  param?: string;
  detail?: Record<string, string | number>;
}

/**
 * A failure of JavaScript: a `StepFault`, so the engine records it as it records any other. `failure.code` is
 * `other` and `why` says which it is: the screen reads `why` and says it with the words of `CODE_FAILURES`
 * (boni-web's `words.ts`), until `STEP_FAILURES` takes these codes and `failure` is `why`.
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
  /**
   * `$col` of a name the published version kept for a collection that is now called otherwise (AU-192). `detail.name`
   * (as written), `detail.now` (today's name), `detail.collection` (its key): the button rewrites the citation.
   */
  "code.collectionRenamed",
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
  /** A limit that is not one: a field the collection does not have (`detail.field`), a filter that is not the views', a limit that is not a whole number from 1 to `CODE_LIMITS.readRows`. `detail.why`: "field", "where", "limit". */
  "connection.limits",
  // Saving from code (`WRITE_PROBLEMS` in writes.ts), with their place in the code.
  /**
   * `$col('…')` not called at once by one of `COL_METHODS` written by its name (AU-183), for reading and for saving
   * alike. `detail.why`: "kept" (kept in a variable, passed, returned), "computed" (`$col('Gastos')[accion](…)`),
   * "unknown" (a method it does not have: `detail.method`). The fix is always the same form: `$col('Gastos').update(…)`.
   */
  "code.colUse",
  /**
   * The code asks for an action its connection does not give (AU-176). `detail.collection` (its key),
   * `detail.action`: the button sets that cell to «Preguntar».
   */
  "code.write.notAllowed",
] as const;
export type CodeProblemCode = (typeof CODE_PROBLEMS)[number];

/** The codes of `CODE_PROBLEMS` that are only warnings; every other is an error. */
export const CODE_WARNINGS: readonly CodeProblemCode[] = ["code.fieldNotGiven"];

/**
 * A `Problem` with one of F14c's codes, saving's among them. Citations of steps keep the codes they have
 * (`expr.unknownStep`, `expr.notBefore`, `expr.cannotPair`, `expr.noCurrentRow`).
 */
export type CodeProblem = Omit<Problem, "code"> & { code: CodeProblemCode };
