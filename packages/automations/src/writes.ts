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
import { actionOf } from "./catalogue.ts";
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
import type { Connection } from "./connections.ts";
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
import { notBuilt } from "./pending.ts";
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
 * What a step can change, whatever its type, from one place: a «Colección» step's write action (from the catalogue,
 * AU-19: creating and modifying `yes`, as the rule of the background says of what is its own, decision 5; removing
 * `ask`, until its «Permiso» arrives, AU-187), a «Código»'s analysis with its connection's cells (whether its
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
      actions: writes.map((a) => ({ action: a, mode: a === "remove" ? "ask" : "yes" })),
    },
  ];
}

/**
 * What a published version's step says for one collection and one action (AU-186): its connection's cell, or for a
 * «Colección» step what `stepChanges` gives. What the server tells `decide` with each write of a run, read from the
 * version as saved: never from the box, a browser or a model. A `yes` is not yet a write without asking: the policy
 * still proposes one with something from outside (P4, P15), and until AU-186 to AU-188 (F14d) a «Código» asks
 * anyway (`YES_SAVES`).
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
 * and remove ask of the saved row, and create of the new row as it would be (the store gives a field not written no
 * value: the collection has no defaults of its own). The same filter, and the same evaluation of it, as a read's
 * `get` puts on its row: a field the filter names that the collection does not have leaves the row out.
 */
export function insideConnection(
  row: Fields,
  connection: Connection,
  typeOf: (field: string) => string | undefined,
  today: string,
): boolean {
  const where = connection.read === false ? [] : (connection.read.where ?? []);
  return !where.length || matchesFilters(row, typeOf, where, today, "fail");
}

/**
 * Whether a connection's «Sí» saves without asking. Not until AU-186 to AU-188 land (F14d: what does not ask, «Sí»
 * by the person's hand only, `lowerYes`): until then a «Sí» asks as «Preguntar» does, so nothing a model wrote can
 * save on its own (W2's brief, 2026-11-16).
 */
export const YES_SAVES: boolean = false;

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
}

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

  const changes: ChangeWith[] = [];
  const records: WriteRecord[] = [];
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
      for (const field of keys) {
        if (!types.has(field)) throw request("field", { field });
        if (seen && !seen.includes(field))
          throw fail(`${field} is not seen in ${key}`, "code.write.hidden", {
            collection: key,
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

    // The row it changes: one of that collection the connection lets the step see. Not there and left out are said
    // the same way, with the same words: code may not learn whether a row outside its filter exists.
    if (action === "create") {
      if (!insideConnection(fields, connection, typeOf, input.today))
        throw fail(
          `the row asked for in ${key} is not one the connection lets the step change`,
          "code.write.outside",
          {
            collection: key,
            why: "created",
            ...at,
          },
        );
      changes.push({ change: { kind: "create", collection: key, fields }, values });
      records.push({ collection: key, action, after: { ...fields } });
    } else {
      if (typeof r.id !== "string" || !r.id) throw request("id");
      const saved = await gate.get(key, r.id);
      if (!saved || !insideConnection(saved.json, connection, typeOf, input.today))
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
      changes.push({ change, values });
      records.push({
        collection: key,
        action,
        id: saved.origin.id,
        before: saved.json,
        ...(action === "update" ? { after: { ...saved.json, ...fields } } : {}),
      });
    }
    cells.push(cell.mode);
  }
  if (!changes.length)
    return input.test ? { kind: "tested", records, asks: false } : { kind: "applied", records };

  // The policy is asked for every one before any is written; a no to one is the whole step's.
  const decided = await gate.decideAll(changes);
  const asks = decided !== "allow" || !YES_SAVES || cells.includes("ask");
  if (input.test) {
    const tested = await gate.writeAll(changes);
    tested.forEach((t, i) => {
      const rec = records[i] as WriteRecord;
      if (t.kind === "tested" && rec.action !== "remove") rec.after = t.row.json;
    });
    return { kind: "tested", records, asks };
  }
  if (asks) {
    const byPolicy = decided === "allow" ? [] : decided;
    const asked = changes.map(({ change }): Asked => {
      const policy = byPolicy.find((a) => a.change === change);
      return (
        policy ?? {
          step: input.step,
          kind: change.kind === "trash" ? "confirm" : "propose",
          rule: CONNECTION_ASKS,
          change,
        }
      );
    });
    return { kind: "asked", records, asked };
  }
  const written = await gate.writeAll(changes);
  written.forEach((w, i) => {
    const rec = records[i] as WriteRecord;
    if (w.kind !== "applied") return;
    rec.id = w.row.origin.id;
    if (rec.action !== "remove") rec.after = w.row.json;
  });
  return { kind: "applied", records };
}
