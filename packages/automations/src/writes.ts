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
import { matchesFilters } from "@boni/views";
import { type Fields, jsonBytes } from "./box.ts";
import { actionOf, PERMISSION, PERMISSION_BORN } from "./catalogue.ts";
import {
  CODE_LIMITS,
  CODE_PARAMS,
  CODE_TYPE,
  type CodeFailureCode,
  CodeFault,
  type CodeLimit,
  type CodeProblemCode,
  WRITE_ACTIONS,
  type WriteAction,
} from "./code.ts";
import { asRead, type Connection, literalCell } from "./connections.ts";
import type {
  Asked,
  Change,
  ChangeWith,
  CollectionShape,
  Gate,
  Labelled,
  StoredRow,
} from "./effects.ts";
import type { Automation, Step } from "./format.ts";
import { type CodeContext, type CodeReading, readCode, type Span } from "./javascript.ts";
import type { Cell } from "./rows.ts";
import type { Problem } from "./validate.ts";

// ---------------------------------------------------------------- what code may ask

// The write actions and `$col`'s methods are code.ts's, so the analysis reads them without importing saving.
export { COL_METHODS, type ColMethod, WRITE_ACTIONS, type WriteAction } from "./code.ts";

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

// ---------------------------------------------------------------- the limits, failures and problems

/**
 * The limits of asking to save, by their key (AU-175): `CODE_LIMITS`'s, where `code.limit` says them
 * (`detail.limit`). Passing one fails the step and saves nothing: never cut, since half of a change is another
 * change.
 */
export const WRITE_LIMITS = {
  writes: CODE_LIMITS.writes,
  stepWrites: CODE_LIMITS.stepWrites,
  writeBytes: CODE_LIMITS.writeBytes,
  stepWriteBytes: CODE_LIMITS.stepWriteBytes,
} as const satisfies Partial<Record<CodeLimit, number>>;
export type WriteLimit = keyof typeof WRITE_LIMITS;

/**
 * Why a step's requests were not saved (AU-174, AU-177, AU-183, AU-184), as `CODE_FAILURES`'s keys, where each says
 * its detail: whichever it is, nothing of the step was saved. A request the policy refuses keeps `policy.denied`; a
 * row that changed since it was read, `row.changed`; a value the field does not take, `value.type`.
 */
export const WRITE_FAILURES = [
  "code.write.unseen",
  "code.write.notAllowed",
  "code.write.outside",
  "code.write.hidden",
  "code.write.request",
] as const satisfies readonly CodeFailureCode[];
export type WriteFailureCode = (typeof WRITE_FAILURES)[number];

/** The problems saving adds to validation, as `CODE_PROBLEMS`'s keys, with their place in the code (AU-36). */
export const WRITE_PROBLEMS = [
  "code.colUse",
  "code.write.notAllowed",
] as const satisfies readonly CodeProblemCode[];
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

/** What each write action of «Colección» (AU-120) asks of a collection: «Crear o modificar» asks both. */
const COLLECTION_WRITES: Record<string, readonly WriteAction[]> = {
  create: ["create"],
  update: ["update"],
  upsert: ["create", "update"],
  trash: ["remove"],
};

/**
 * The mode of a «Colección» step's «Permiso» (AU-187): `yes` only for the fixed word written in the step; a step
 * saved without it asks, wherever it came from (a «Sí» is never a missing value, AU-188), and so does anything else
 * (an expression, which validation refuses).
 */
export function permissionOf(step: Step): WriteMode {
  return step.params[PERMISSION] === "yes" ? "yes" : "ask";
}

/**
 * What a step can change, whatever its type, from one place: a «Colección» step's write action with its «Permiso»
 * (AU-19, AU-187), a «Código»'s analysis with its connection's cells (whether its
 * connection allows it yet or not: that is a problem apart), and from F15 an «Agente»'s write permissions. Empty for
 * a step that only reads or calculates. Changing in memory the rows that reach the code (AU-37) is never in it. In
 * the order of the code's calls, or of the connections; each collection's actions in the order of `WRITE_ACTIONS`.
 */
export function stepChanges(
  step: Step,
  context: Pick<CodeContext, "collectionNamed">,
): StepChange[] {
  if (step.type === CODE_TYPE) {
    const source = step.params[CODE_PARAMS.source];
    if (typeof source !== "string") return [];
    const asked = new Map<string, Set<WriteAction>>();
    for (const site of readWrites(source, "code").writes) {
      const key = context.collectionNamed(site.name);
      if (key === undefined) continue;
      const set = asked.get(key) ?? new Set<WriteAction>();
      set.add(site.action);
      asked.set(key, set);
    }
    return [...asked].map(([collection, set]) => {
      const connection = (step.connections ?? []).find((c) => c.collection === collection);
      return {
        collection,
        actions: WRITE_ACTIONS.filter((a) => set.has(a)).map((action) => {
          const cell = connection?.[action];
          return { action, mode: cell ? cell.mode : false };
        }),
      };
    });
  }
  const action = actionOf(step);
  const collection = step.params.collection;
  const writes = action?.effect === "write" ? COLLECTION_WRITES[action.key] : undefined;
  if (!writes || typeof collection !== "string") return [];
  return [
    {
      collection,
      actions: writes.map((a) => ({ action: a, mode: permissionOf(step) })),
    },
  ];
}

/**
 * What a published version's step says for one collection and one action (AU-186): its connection's cell, or for a
 * «Colección» step what `stepChanges` gives. What the server tells `decide` with each write of a run, read from the
 * version as saved: never from the box, a browser or a model. A `yes` is not yet a write without asking: the policy
 * is the second door: it proposes what a model wrote and denies what no «Sí» opens (P2, P9, P14, P28).
 */
export function consentOf(step: Step, collection: string, action: WriteAction): false | WriteMode {
  if (step.type === CODE_TYPE) {
    const cell = (step.connections ?? []).find((c) => c.collection === collection)?.[action];
    return cell ? cell.mode : false;
  }
  for (const change of stepChanges(step, NO_NAMES))
    if (change.collection === collection)
      for (const a of change.actions) if (a.action === action) return a.mode;
  return false;
}

/** No collection by name: a «Colección» step names its collection by key. */
const NO_NAMES = { collectionNamed: () => undefined };

/** Two plain values (a parsed document's) equal key by key, whatever the order of their keys. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.hasOwn(b, k) &&
      same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/** What reaches a step: the arrows into it, as one sorted list (where its rows come from). */
const into = (a: Automation, step: string): string[] =>
  a.arrows
    .filter((r) => r.to.step === step)
    .map((r) => `${r.from.step}:${r.from.output}>${r.to.input}`)
    .sort();

/** A step with every «Sí» of saving lowered to «Preguntar»: its connections' cells, and its «Permiso» written as «Preguntar» (also where it was missing). */
function lowered(step: Step): Step {
  let out = step;
  if (step.connections?.some((c) => WRITE_ACTIONS.some((a) => c[a] && c[a].mode === "yes")))
    out = {
      ...out,
      connections: (step.connections ?? []).map((c) => {
        const next = { ...c };
        for (const a of WRITE_ACTIONS) {
          const cell = c[a];
          if (cell && cell.mode === "yes") Object.assign(next, { [a]: { ...cell, mode: "ask" } });
        }
        return next;
      }),
    };
  const action = actionOf(step);
  if (
    step.type !== CODE_TYPE &&
    action?.effect === "write" &&
    action.key in PERMISSION_BORN &&
    step.params[PERMISSION] !== "ask"
  )
    out = { ...out, params: { ...out.params, [PERMISSION]: "ask" } };
  return out;
}

/**
 * An automation that arrives not written by the person (AU-188: the assistant's proposal, «Pedir a Boni», «Escribir
 * con IA», a package, a template, the MCP's `automations_propose`), with each `yes` of saving lowered to `ask`:
 * create, modify and remove alike, in connections and in the «Permiso» of a «Colección» step (also one it would be
 * born with, AU-187). A step `current` (the draft it is proposed over) already had keeps its «Sí» only when it
 * arrives exactly as it was there, with the same arrows into it; a new step, or one whose code, parameters,
 * connections or incoming rows changed, is lowered whole (decision 13 of §10: a «Sí» given to one code is not
 * given to another). Nothing else changes, and a document with no «Sí» comes back equal.
 */
export function lowerYes(proposed: Automation, current?: Automation): Automation {
  const steps = proposed.steps.map((step) => {
    const was = current?.steps.find((s) => s.id === step.id);
    const kept =
      current !== undefined &&
      was !== undefined &&
      same(was, step) &&
      same(into(current, step.id), into(proposed, step.id));
    return kept ? step : lowered(step);
  });
  return steps.every((s, i) => s === proposed.steps[i]) ? proposed : { ...proposed, steps };
}

// ---------------------------------------------------------------- saving

/**
 * Whether a row, as it is or as it would be saved, passes the connection's «Solo estas filas» (AU-177): what modify
 * and remove ask of the saved row, and create of the new row as it would be (the store gives a field not written no
 * value: the collection has no defaults of its own). With `action` (AU-48), the action's own filter too, with «y»:
 * modify's and remove's (create has none). The same filter, and the same evaluation of it, as a read's `get` puts on
 * its row: a field the filter names that the collection does not have leaves the row out.
 */
export function insideConnection(
  row: Fields,
  connection: Connection,
  typeOf: (field: string) => string | undefined,
  today: string,
  action?: WriteAction,
): boolean {
  const cell = action === "update" || action === "remove" ? connection[action] : false;
  const where = [
    ...(connection.read === false ? [] : (connection.read.where ?? [])),
    ...(cell ? (cell.where ?? []) : []),
  ];
  return !where.length || matchesFilters(row, typeOf, where, today, "fail");
}

/**
 * The gate as saving a step's requests needs it (AU-174): the collections' fields, the saved row with no other
 * question to the policy (as AU-168 reads it in a test), every change decided before any is written, and all of them
 * written in one transaction of the store (`Gate.decideAll` and `Gate.writeAll`, effects.ts).
 */
export interface WriteGate {
  shape(collection: string): CollectionShape | undefined;
  get(collection: string, id: string): Promise<StoredRow | undefined>;
  decideAll: Gate["decideAll"];
  writeAll: Gate["writeAll"];
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
  /** The civil day of the run in Juan's zone: «hoy» of a connection's filter. */
  today: string;
  /** «Probar» or «Probar paso»: nothing is saved (AU-181). */
  test: boolean;
  /** The label of what the automation itself writes: of create's fixed values, which Juan set (AU-48). */
  own?: Label;
  /**
   * Rows this step has already asked to write with an action in a collection in this run, saved, tested or proposed:
   * what «Como mucho» counts on top of these requests (AU-196). Absent: none.
   */
  before?: (collection: string, action: WriteAction) => number;
}

/** The key «Como mucho» counts by: one collection and one action. */
const tally = (collection: string, action: string) => `${collection}\u0000${action}`;

/** One row a step's requests change, for «Haría esto» (AU-181) and a run's record: before and after, as AU-72 shows. */
export interface WriteRecord {
  /** The collection's key. */
  collection: string;
  action: WriteAction;
  /** The row's id; absent for a row created in a test, or one that waits for Juan. */
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
   * from outside (P4, P15), or a removal without what AU-186 asks (P5). `asked` holds every change of the step.
   */
  | { kind: "asked"; records: readonly WriteRecord[]; asked: readonly Asked[] };

/** The rule of an `Asked` that waits because the step's connection asks (AU-176), not because the policy did. */
export const CONNECTION_ASKS = "connection.ask";

/**
 * Saves a step's requests when it ends (AU-173 to AU-177), all of them as one change: checks each, in order, against
 * the step's limits, the analysis of the code as saved (`grants`), the connection as saved and its limits, and the
 * collection's fields; reads each row it modifies or removes (with no other question to the policy); builds the same
 * `Change` a «Colección» action builds, its values with the label of what the evaluation received (AU-169, AU-185);
 * asks the policy for all; and writes all or none. Rejects with `CodeFault`, `Denied` or the store's `StepFault`
 * (`row.changed`, `value.type`), and then nothing was saved. A row that is not there and one the connection leaves
 * out fail the same way, so code cannot learn from a failure whether a row it may not see exists.
 */
export async function applyWrites(input: WriteInput, gate: WriteGate): Promise<StepWrites> {
  const fail = (message: string, code: WriteFailureCode, detail: Record<string, string | number>) =>
    new CodeFault(message, { code, param: CODE_PARAMS.source, detail });
  const limit = (key: WriteLimit, got: number) =>
    new CodeFault(`over the limit ${key} (${WRITE_LIMITS[key]})`, {
      code: "code.limit",
      param: CODE_PARAMS.source,
      detail: { limit: key, max: WRITE_LIMITS[key], got },
    });
  if (input.requests.length > WRITE_LIMITS.stepWrites)
    throw limit("stepWrites", input.requests.length);
  let total = 0;
  for (const r of input.requests) {
    const bytes = jsonBytes(r);
    if (bytes > WRITE_LIMITS.writeBytes) throw limit("writeBytes", bytes);
    total += bytes;
  }
  if (total > WRITE_LIMITS.stepWriteBytes) throw limit("stepWriteBytes", total);

  // «Como mucho» (AU-196) counts every row asked with an action, before any is checked: the number a failure says is
  // what the step asked, not where it was stopped.
  const asked = new Map<string, number>();
  for (const r of input.requests) {
    const key = input.collectionNamed(r.collection);
    if (key !== undefined)
      asked.set(tally(key, r.action), (asked.get(tally(key, r.action)) ?? 0) + 1);
  }
  const seenOf = new Map<string, number>();

  const changes: ChangeWith[] = [];
  const records: WriteRecord[] = [];
  /** For each record, the fields its request set (and create's fixed ones): what AU-171 leaves without «Leer». */
  const fieldsSet: string[][] = [];
  const cells: WriteMode[] = [];
  for (const [i, r] of input.requests.entries()) {
    const at: Record<string, number> = r.line === undefined ? {} : { line: r.line };
    const action = r.action;
    const key = input.collectionNamed(r.collection);
    if (
      !(WRITE_ACTIONS as readonly string[]).includes(action) ||
      key === undefined ||
      !input.grants.some((g) => g.collection === key && g.action === action)
    )
      throw fail(
        `the code as saved does not ask to ${String(action)} in ${r.collection}`,
        "code.write.unseen",
        {
          collection: r.collection,
          action: String(action),
          where: "code",
          ...at,
        },
      );
    const connection = input.connections.find((c) => c.collection === key);
    const cell = connection?.[action];
    const shape = gate.shape(key);
    if (!connection || !cell || !shape)
      throw fail(
        `the step's connection does not let it ${action} in ${key}`,
        "code.write.notAllowed",
        {
          collection: key,
          action,
          ...at,
        },
      );
    // «Como mucho N filas» (AU-196): what the step asked with this action in this run, these requests with it.
    const before = input.before?.(key, action) ?? 0;
    const got = before + (asked.get(tally(key, action)) ?? 0);
    if (cell.limit !== undefined && got > cell.limit)
      throw fail(
        `the step asks to ${action} ${got} rows in ${key}, at most ${cell.limit}`,
        "code.write.notAllowed",
        { collection: key, action, why: "many", max: cell.limit, got, ...at },
      );
    const written = before + (seenOf.get(tally(key, action)) ?? 0);
    seenOf.set(tally(key, action), (seenOf.get(tally(key, action)) ?? 0) + 1);
    const types = new Map(shape.fields.map((f) => [f.key, f.type]));
    const typeOf = (f: string) => types.get(f);
    const request = (why: string, more: Record<string, string> = {}) =>
      fail(`a request to ${action} in ${key} that is not one (${why})`, "code.write.request", {
        collection: key,
        why,
        ...more,
        ...at,
      });

    // The fields, by key: an object of fields the collection has and the connection lets the step see.
    let fields: Record<string, Cell> = {};
    if (action !== "remove") {
      const given = r.fields;
      if (typeof given !== "object" || given === null || Array.isArray(given))
        throw request("fields");
      fields = given;
      const keys = Object.keys(fields);
      if (action === "update" && !keys.length) throw request("empty");
      const seen = connection.read === false ? undefined : connection.read.fields;
      // «Solo estos campos» of the action (AU-48), and create's fixed fields, which are not the step's to choose.
      const chosen = "fields" in cell ? cell.fields : undefined;
      const pinned = "fixed" in cell ? cell.fixed : undefined;
      for (const field of keys) {
        if (!types.has(field)) throw request("field", { field });
        if (seen && !seen.includes(field))
          throw fail(`${field} is not seen in ${key}`, "code.write.hidden", {
            collection: key,
            field,
            ...at,
          });
        if ((chosen && !chosen.includes(field)) || (pinned && Object.hasOwn(pinned, field)))
          throw fail(`the step may not ${action} ${field} in ${key}`, "code.write.notAllowed", {
            collection: key,
            action,
            why: "field",
            field,
            ...at,
          });
      }
    }
    const label = input.labels[i] as Label;
    const values: Labelled = {};
    for (const [field, value] of Object.entries(fields))
      Object.defineProperty(values, field, {
        value: { value, label, derived: true },
        enumerable: true,
        writable: true,
        configurable: true,
      });

    // Create's fixed values (AU-48): Juan's, with the automation's own label, in the row as it would be.
    const fixed = action === "create" && "fixed" in cell ? cell.fixed : undefined;
    if (fixed && Object.keys(fixed).length) {
      const own = input.own;
      if (!own) throw new Error("a create with fixed values needs the automation's label");
      fields = { ...fields };
      for (const [field, v] of Object.entries(fixed)) {
        // An expression is AU-52's (E3); validation refuses one until then, and nothing unchecked is written.
        if (!literalCell(v)) throw request("field", { field });
        Object.defineProperty(fields, field, {
          value: v,
          enumerable: true,
          writable: true,
          configurable: true,
        });
        Object.defineProperty(values, field, {
          value: { value: v, label: own, derived: false },
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
    }

    // The row it changes: one of that collection the connection and its action let the step change. Not there and
    // left out are said the same way, with the same words: code may not learn whether a row outside its filter exists.
    if (action === "create") {
      if (!insideConnection(fields, connection, typeOf, input.today, action))
        throw fail(
          `the row asked for in ${key} is not one the connection lets the step change`,
          "code.write.outside",
          {
            collection: key,
            why: "created",
            ...at,
          },
        );
      changes.push({
        change: { kind: "create", collection: key, fields },
        values,
        row: fields,
        written,
      });
      records.push({ collection: key, action, after: { ...fields } });
    } else {
      if (typeof r.id !== "string" || !r.id) throw request("id");
      const saved = await gate.get(key, r.id);
      if (!saved || !insideConnection(saved.json, connection, typeOf, input.today, action))
        throw fail(
          `the row asked for in ${key} is not one the connection lets the step change`,
          "code.write.outside",
          {
            collection: key,
            why: "row",
            ...at,
          },
        );
      const change: Change =
        action === "update"
          ? { kind: "update", row: saved.origin, fields }
          : { kind: "trash", row: saved.origin };
      changes.push({ change, values, row: saved.json, written });
      records.push({
        collection: key,
        action,
        id: saved.origin.id,
        before: saved.json,
        ...(action === "update" ? { after: { ...saved.json, ...fields } } : {}),
      });
    }
    cells.push(cell.mode);
    fieldsSet.push(Object.keys(fields));
  }
  if (!changes.length)
    return input.test ? { kind: "tested", records, asks: false } : { kind: "applied", records };
  // What a write gives back passes the step's read limits (AU-171), once its rows are known.
  const cut = () => records.map((r, i) => cutRecord(r, input.connections, fieldsSet[i] ?? []));

  // The policy is asked for every one before any is written; a no to one is the whole step's.
  const decided = await gate.decideAll(changes);
  // The two doors (AU-186): the cell first, then the policy. A «Sí» never turns the policy's answer.
  const asks = decided !== "allow" || cells.includes("ask");
  if (input.test) {
    const tested = await gate.writeAll(changes);
    tested.forEach((t, i) => {
      const rec = records[i] as WriteRecord;
      if (t.kind === "tested" && rec.action !== "remove") rec.after = t.row.json;
    });
    return { kind: "tested", records: cut(), asks };
  }
  if (asks) {
    const byPolicy = decided === "allow" ? [] : decided;
    const asked = changes.map(({ change, values }): Asked => {
      const policy = byPolicy.find((a) => a.change === change);
      return (
        policy ?? {
          step: input.step,
          kind: change.kind === "trash" ? "confirm" : "propose",
          rule: CONNECTION_ASKS,
          change,
          values,
        }
      );
    });
    return { kind: "asked", records: cut(), asked };
  }
  const written = await gate.writeAll(changes);
  written.forEach((w, i) => {
    const rec = records[i] as WriteRecord;
    if (w.kind !== "applied") return;
    rec.id = w.row.origin.id;
    if (rec.action !== "remove") rec.after = w.row.json;
  });
  return { kind: "applied", records: cut() };
}

/**
 * A row a write gives back, as the step may read it (AU-171): with «Solo estos campos» of reading, those fields (the
 * id is the record's own); with «Leer» in «No», only the fields the step set, before and after, and nothing else of
 * the row. In a test the same. What a write gives back to code (nothing, AU-172) or to a model (its count, AU-198)
 * is less still.
 */
export function cutRecord(
  record: WriteRecord,
  connections: readonly Connection[],
  set: readonly string[],
): WriteRecord {
  const read = connections.find((c) => c.collection === record.collection)?.read;
  const fields = read === false || read === undefined ? set : read.fields;
  if (!fields) return record;
  const keep = (row: Fields): Fields => {
    const { id: _, ...only } = asRead("", row, { fields });
    return only as Fields;
  };
  const out: WriteRecord = { ...record };
  if (record.before) out.before = keep(record.before);
  if (record.after) out.after = keep(record.after);
  return out;
}
