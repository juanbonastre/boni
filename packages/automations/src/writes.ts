/**
 * A «Código» that saves (docs/automatizaciones.md AU-172 to AU-185; Juan, 2026-11-16): the code asks to create,
 * modify or remove rows of a connected collection, and the engine saves them when the step ends, through the same
 * gate and the same executor as a «Colección» step's action, all or nothing. What the code may ask is read from it
 * before it runs (the analysis, an upper bound the engine enforces) and allowed by its connection (the permission,
 * checked again at run time). The box still has no way to the store: a request is data in what an evaluation gives.
 * Built in W1: the analysis (`readWrites`, `grantsOf`), what validation says of it (`writeProblems`, joined into
 * `codeProblems`) and what the step's view says (`connectionUses`). The rest are contracts (pending.ts), and these
 * lists stay apart from `CODE_LIMITS`, `CODE_FAILURES` and `CODE_PROBLEMS` until the PR that builds saving joins them
 * (the screen has words for each entry).
 */
import type { Label } from "@boni/entities";
import type { Fields } from "./box.ts";
import { CODE_PARAMS, CODE_TYPE } from "./code.ts";
import type { Connection } from "./connections.ts";
import type { Asked, Change, Labelled, StoredRow, WriteResult } from "./effects.ts";
import { type StepFailure, StepFault } from "./failures.ts";
import type { Automation, Step } from "./format.ts";
import { type CodeContext, type CodeReading, readCode, type Span } from "./javascript.ts";
import { notBuilt } from "./pending.ts";
import type { Cell } from "./rows.ts";
import type { Problem } from "./validate.ts";

// ---------------------------------------------------------------- what code may ask

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

/**
 * The cells of each write action in a «Código»'s connection, the same as the «Agente»'s (AU-41, AU-176): `false` is
 * «No» and the default; «Preguntar» is `ask`; «Sí» is `yes`. The three alike, each on its own (Juan, 2026-11-16: until
 * then removing had no `yes`). Removing is always to the trash (AU-122). A `yes` saves without asking only as AU-186
 * says, and only the person's hand sets it (AU-188).
 */
export type WriteMode = "ask" | "yes";
export const WRITE_MODES: { readonly [A in WriteAction]: readonly WriteMode[] } = {
  create: ["ask", "yes"],
  update: ["ask", "yes"],
  remove: ["ask", "yes"],
};

/**
 * One request, as the box gives it back in an evaluation's result (AU-173): nothing is checked yet, and nothing in it
 * is trusted. `collection` is the name written in `$col('…')`; `id` and `fields` are whatever the code passed.
 */
export interface WriteRequest {
  collection: string;
  action: WriteAction;
  /** `update` and `remove`: the row's id, as the code gave it (the engine checks it is a text and a row it may touch). */
  id?: Cell;
  /** `create` and `update`: the fields by key, as the code gave them. */
  fields?: Cell;
  /** 1-based, of the source Juan wrote: the call that asked. Absent when the interpreter cannot say. */
  line?: number;
  /** In «Una vez por fila», the row of the step's input it was asked for (what «Si falla: seguir» drops by). */
  row?: number;
}

/**
 * What an evaluation that ended (`Evaluated`, state "done", in box.ts) gains: its requests, in the order asked, of
 * its last complete pass only (a pass stopped at a read it did not have is thrown away, AU-173). An evaluation of
 * expressions has none: one with any fails the step (AU-184).
 */
export interface EvaluatedWrites {
  writes: readonly WriteRequest[];
}

// ---------------------------------------------------------------- the limits

const KB = 1024;
const MB = 1024 * KB;

/**
 * The limits of asking to save, by their key (AU-175): the key is what `code.limit` says (`detail.limit`) once these
 * join `CODE_LIMITS`. Passing one fails the step and saves nothing: never cut, since half of a change is another
 * change. Reasoned, not measured (as `CODE_LIMITS`): a builder may lower one after measuring, never remove it.
 */
export const WRITE_LIMITS = {
  /**
   * Requests one evaluation may make. As many as a step: «Una vez con todas las filas» is one evaluation. It is
   * apart so the box stops a loop that never ends as soon as it passes it, inside the box.
   */
  writes: 5_000,
  /**
   * Requests a step may make in a run, all its evaluations together. `CODE_LIMITS.readRows`: what one read gives can
   * be written back at once, so a step over Juan's thousands of rows of one collection fits.
   */
  stepWrites: 5_000,
  /** Bytes of one request, as JSON: a row's fields, a long text among them. */
  writeBytes: 64 * KB,
  /** Bytes of all of a step's requests, as JSON: the server holds them until the step ends (384 MB in all). */
  stepWriteBytes: 4 * MB,
} as const;
export type WriteLimit = keyof typeof WRITE_LIMITS;

// ---------------------------------------------------------------- what goes wrong while running

/**
 * Why a step's requests were not saved (AU-174, AU-177, AU-183, AU-184), as keys; whichever it is, nothing of the
 * step was saved. A request the policy refuses keeps `policy.denied`; a row that changed since it was read,
 * `row.changed`; an id no row of that collection has, `row.missing`; a value the field does not take, `value.type`
 * (the «Colección» executor's own codes). A limit is `code.limit` with a key of `WRITE_LIMITS`.
 */
export const WRITE_FAILURES = [
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
   * lets the step see) or "created" (the row as it would be created does not pass the filter). `detail.collection`.
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
export type WriteFailureCode = (typeof WRITE_FAILURES)[number];

export interface WriteFailure {
  code: WriteFailureCode;
  detail?: Record<string, string | number>;
}

/**
 * A failure of a step's requests: a `StepFault`, so the engine records it as any other. As `CodeFault`: until
 * `STEP_FAILURES` takes these codes, `failure.code` is `other`, `failure.param` is the code's source and `why` says
 * which it is.
 */
export class WriteFault extends StepFault {
  readonly why: WriteFailure;
  constructor(message: string, why: WriteFailure) {
    const failure: StepFailure = { code: "other", param: "source" };
    super(message, failure);
    this.name = "WriteFault";
    this.why = why;
  }
}

// ---------------------------------------------------------------- what is wrong before running

/**
 * The problems these rules add to validation, with their place in the code (`detail.line`, `.column`, `.from`, `.to`)
 * so the editor marks them (AU-36).
 */
export const WRITE_PROBLEMS = [
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
export type WriteProblemCode = (typeof WRITE_PROBLEMS)[number];

/** A `Problem` with one of these codes. `$col` of a collection that is not connected keeps `code.notConnected`. */
export type WriteProblem = Omit<Problem, "code"> & { code: WriteProblemCode };

// ---------------------------------------------------------------- the analysis

/** One call that asks to save, found in the code without running it, wherever it sits (an `if`, a loop, a function). */
export interface WriteSite {
  /** The collection's name, as written in `$col('…')`. */
  name: string;
  action: WriteAction;
  at: Span;
}

/** What reading a piece of code says it may ask to save (AU-183). Total, as `readCode`. */
export interface WriteReading {
  /** Every call that asks to save, in the order of the source. None for an expression. */
  writes: readonly WriteSite[];
  /** `code.colUse` wherever `$col` is used in a form that cannot be followed. */
  problems: readonly WriteProblem[];
}

/**
 * Reads one piece of JavaScript with `readCode` (javascript.ts), and never runs it: its `writes`, and its problems of
 * `$col`'s form. One reading: `readCode` finds both in the same walk, and validation takes them from it.
 */
export function readWrites(source: string, as: "expression" | "code"): WriteReading {
  return writesOf(readCode(source, as));
}

/** The part of a reading `readWrites` gives. */
export const writesOf = (reading: CodeReading): WriteReading => ({
  writes: reading.writes,
  problems: reading.problems.filter((p): p is WriteProblem => p.code === "code.colUse"),
});

/** One collection with one action the code may ask for: the analysis's upper bound, one entry per pair. */
export interface WriteGrant {
  /** The collection's key. */
  collection: string;
  action: WriteAction;
}

/**
 * The pairs the reading found, by the collection's key (a name no collection has gives nothing: it is already
 * `code.unknownCollection`). What the job sends the box, so its `$col` has only these methods, and what the engine
 * holds each request to. The server reads them from the code as saved, every run: never from the box or a browser.
 */
export function grantsOf(
  reading: WriteReading,
  collectionNamed: (name: string) => string | undefined,
): WriteGrant[] {
  const out: WriteGrant[] = [];
  for (const site of reading.writes) {
    const collection = collectionNamed(site.name);
    if (collection === undefined) continue;
    if (!out.some((g) => g.collection === collection && g.action === site.action))
      out.push({ collection, action: site.action });
  }
  return out;
}

/**
 * Everything wrong with a «Código»'s writes for `validate` to add (`WRITE_PROBLEMS`), given a `CodeContext`: `$col`
 * in a form that cannot be followed (`code.colUse`) and an action its connection does not give
 * (`code.write.notAllowed`, AU-176), at every call that asks for it. Any other step saves nothing from code: none.
 * `validate` gives the same through `codeProblems`, from the one reading of the step's code.
 */
export function writeProblems(
  step: Step,
  _automation: Automation,
  context: CodeContext,
): WriteProblem[] {
  const source = step.params[CODE_PARAMS.source];
  if (step.type !== CODE_TYPE || typeof source !== "string") return [];
  const reading = readWrites(source, "code");
  return [
    ...reading.problems.map((p) => ({ ...p, step: step.id, param: CODE_PARAMS.source })),
    ...notAllowed(step, reading, context.collectionNamed),
  ];
}

/**
 * `code.write.notAllowed` at each call that asks for an action the step's connection to that collection does not give
 * (AU-176). A collection with no connection is `code.notConnected` already, and one with no name, `code.unknownCollection`.
 */
export function notAllowed(
  step: Step,
  reading: WriteReading,
  collectionNamed: (name: string) => string | undefined,
): WriteProblem[] {
  const out: WriteProblem[] = [];
  for (const site of reading.writes) {
    const collection = collectionNamed(site.name);
    const connection = (step.connections ?? []).find((c) => c.collection === collection);
    if (collection === undefined || !connection || connection[site.action] !== false) continue;
    out.push({
      code: "code.write.notAllowed",
      severity: "error",
      step: step.id,
      param: CODE_PARAMS.source,
      detail: {
        collection,
        action: site.action,
        line: site.at.line,
        column: site.at.column,
        from: site.at.from,
        to: site.at.to,
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------- what the person sees

/**
 * One write action of one connection, as the step's view says it (AU-179): what the connection allows and whether
 * the code uses it. `allowed` false and `used` true is the problem `code.write.notAllowed`.
 */
export interface ConnectionUse {
  /** The collection's key. */
  collection: string;
  action: WriteAction;
  allowed: false | "ask" | "yes";
  used: boolean;
  /** Where the code asks for it; empty when it does not. */
  at: readonly Span[];
}

/**
 * Every write action a «Código»'s connections allow, and every one its code uses without the permission, in the
 * order of the connections and of `WRITE_ACTIONS`. An action neither allowed nor used is not listed.
 */
export function connectionUses(
  connections: readonly Connection[],
  reading: WriteReading,
  collectionNamed: (name: string) => string | undefined,
): ConnectionUse[] {
  const out: ConnectionUse[] = [];
  for (const c of connections)
    for (const action of WRITE_ACTIONS) {
      const given = c[action];
      const allowed = given === false ? false : given.mode;
      const at = reading.writes
        .filter((w) => w.action === action && collectionNamed(w.name) === c.collection)
        .map((w) => w.at);
      if (allowed === false && at.length === 0) continue;
      out.push({ collection: c.collection, action, allowed, used: at.length > 0, at });
    }
  return out;
}

/**
 * One action a step can take on a collection, with whether it asks: `yes` saves without asking where AU-186 lets it
 * (a removal so is «sin preguntar» on the card, AU-189), `ask` waits for the person, `false` is used by the code
 * without its connection's permission (the problem of AU-176).
 */
export interface StepAction {
  action: WriteAction;
  mode: false | WriteMode;
}

/** One collection a step can change, with how: the card's mark (AU-180, AU-189) and «Lo que podrá hacer» (AU-182). */
export interface StepChange {
  /** The collection's key. */
  collection: string;
  actions: readonly StepAction[];
}

/**
 * What a step can change, whatever its type, from one place: a «Colección» step's write action (from the catalogue,
 * AU-19: creating and modifying `yes`, as the rule of the background says of what is its own, decision 5; removing
 * its «Permiso», AU-187), a «Código»'s analysis with its connection's cells (whether its connection allows it yet or
 * not: that is a problem apart), and from F15 an «Agente»'s write permissions. Empty for a step that only reads or
 * calculates. Changing in memory the rows that reach the code (AU-37) is never in it.
 */
export function stepChanges(step: Step, context: CodeContext): StepChange[] {
  return notBuilt(`stepChanges(${step.id}, ${typeof context})`);
}

/**
 * What a published version's step says for one collection and one action (AU-186): its connection's cell, or for a
 * «Colección» step what `stepChanges` gives. What the server tells `decide` with each write of a run, read from the
 * version as saved: never from the box, a browser or a model. A `yes` is not yet a write without asking: the policy
 * still proposes one with something from outside (P4, P15).
 */
export function consentOf(step: Step, collection: string, action: WriteAction): false | WriteMode {
  return notBuilt(`consentOf(${step.id}, ${collection}, ${action})`);
}

/**
 * An automation that arrives not written by the person (AU-188: the assistant's proposal, «Pedir a Boni», «Escribir
 * con IA», a package, a template, the MCP's `automations_propose`), with each `yes` of saving lowered to `ask`:
 * create, modify and remove alike, in connections and in «Eliminar filas». A `yes` that `current` (the draft it is
 * proposed over, if any) already had at the same step, collection and action stays; a new or changed one is lowered.
 */
export function lowerYes(proposed: Automation, current?: Automation): Automation {
  return notBuilt(`lowerYes(${proposed.id}, ${current?.version ?? "new"})`);
}

// ---------------------------------------------------------------- saving

/**
 * Whether a row, as it is or as it would be saved, passes the connection's «Solo estas filas» (AU-177): what modify
 * and remove ask of the saved row, and create of the new row with the collection's defaults. The same filter, and
 * the same evaluation of it, as `narrow` puts on a read.
 */
export function insideConnection(row: Fields, connection: Connection): boolean {
  return notBuilt(`insideConnection(${Object.keys(row).length}, ${connection.collection})`);
}

/**
 * The gate as saving a step's requests needs it (AU-174): the saved row with no other question to the policy (as
 * AU-168 reads it in a test), every change decided before any is written, and all of them written in one
 * transaction of the store. The build adds `decideAll` and `writeAll` to `Gate` (effects.ts) and `applyAll` to
 * `Collections`, which the server implements with `UserStore.batch`, each operation with the run (`OpMeta.run`).
 */
export interface WriteGate {
  get(collection: string, id: string): Promise<StoredRow | undefined>;
  /** Asks the policy for every change. `allow` only when it allows all; else what waits for Juan. Throws `Denied`. */
  decideAll(changes: readonly { change: Change; values: Labelled }[]): Promise<"allow" | Asked[]>;
  /** All or nothing. In a test nothing is written and each result is `tested`, with the row as it would be. */
  writeAll(changes: readonly { change: Change; values: Labelled }[]): Promise<WriteResult[]>;
}

export interface WriteInput {
  /** The step's id: what each `Asked` and each record carries. */
  step: string;
  /** The step's requests in the order asked; those of a row that failed under «Si falla: seguir» already dropped. */
  requests: readonly WriteRequest[];
  /** For each request, the label of everything its evaluation received (AU-169): its values carry it, derived. */
  labels: readonly Label[];
  /** From the code as saved (`grantsOf`): a request outside these is `code.write.unseen`. */
  grants: readonly WriteGrant[];
  /** The step's connections, as saved. */
  connections: readonly Connection[];
  collectionNamed(name: string): string | undefined;
  /** «Probar» or «Probar paso»: nothing is saved (AU-181). */
  test: boolean;
}

/** One row a step's requests change, for «Haría esto» (AU-181) and a run's record: before and after, as AU-72 shows. */
export interface WriteRecord {
  /** The collection's key. */
  collection: string;
  action: WriteAction;
  /** The row's id; absent for a row created in a test. */
  id?: string;
  /** As it was: absent for `create`. */
  before?: Fields;
  /** As it is or would be: absent for `remove`. */
  after?: Fields;
}

export type StepWrites =
  /** Saved, all of them, in one transaction. */
  | { kind: "applied"; records: readonly WriteRecord[] }
  /**
   * A test: nothing saved; the rows as they would be, and whether a run would ask first (all of the step together,
   * AU-174): «Haría esto» says «sin preguntar» of removals that would not (AU-189).
   */
  | { kind: "tested"; records: readonly WriteRecord[]; asks: boolean }
  /**
   * Nothing saved: the whole change waits for Juan as one proposal: a «Preguntar» on an action asked for, something
   * from outside (P4, P15), or a removal without what AU-186 asks (P5).
   */
  | { kind: "asked"; records: readonly WriteRecord[]; asked: readonly Asked[] };

/**
 * Saves a step's requests when it ends (AU-173 to AU-177): checks each against the grants, the connection and its
 * limits, builds the same `Change` a «Colección» action builds and validates it the same way, asks the policy for
 * all, and writes all or none. Rejects with `WriteFault`, `Denied` or the executor's `StepFault`, and then nothing
 * was saved. A connection's «Preguntar» on any action asked for makes the whole change `asked`.
 */
export function applyWrites(input: WriteInput, gate: WriteGate): Promise<StepWrites> {
  return notBuilt(`applyWrites(${input.step}, ${input.requests.length}, ${typeof gate})`);
}
