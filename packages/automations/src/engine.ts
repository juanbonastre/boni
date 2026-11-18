/**
 * The engine: one run of an automation from one trigger (docs/automatizaciones.md §5.2). A pure core: it knows the
 * graph, the rows and the catalogue, and everything else arrives in `RunDeps` (effects.ts). It walks the steps in
 * `executionOrder`, one at a time; gives each step the rows its arrows bring; does the looping for the steps that
 * work row by row; and leaves a record of every step. The same automation with the same data gives the same
 * `Execution` twice, but for the times it took.
 *
 * How a step is decided (AU-10, AU-14), once every step an arrow reaches it from has finished:
 * - it runs when some arrow brings rows, or when an arrow comes from an output of a step whose «Seguir sin filas»
 *   is on and that step ran (then it may run with an empty list; no empty row is invented);
 * - if not, it is `skipped`, and so is what hangs only from it.
 * A step that runs with an empty list: an action that works with all the rows is called with none; one that works
 * row by row and reads or writes (the catalogue's `effect`) is called once with no row, so «Crear una fila» can say
 * «no hay nada» with fixed values, and a citation of `$json` fails with `noCurrentRow`; one that works row by row
 * and only changes or sorts out the rows it receives is not called and gives none.
 * The rows that reach one input by several arrows are put together in the order of `arrowsInto` (AU-11), and the
 * step runs once. «Seguir sin filas» does not count for the output «error».
 *
 * The label of the path (AU-164): the engine sets `Row.path` on every row a step gives. It is the join of the path
 * of the row it comes from (for a step that works with all the rows, of every row it received), and of the labels
 * of what decided that it exists or came this way: the fields a condition of the step tested, the values its
 * conditions and its `changesRows` parameters resolved to, and for a row read from a collection, the label of the
 * conditions it was searched with. A write is judged with it (`PolicyCall.control`).
 *
 * When a step fails (AU-16): the unit that failed (one row in a step that works row by row, the whole step if not)
 * is tried again up to `retry.times` more times, waiting `retry.waitMs` before each (`Clock.sleep`). If it still
 * fails: «Parar» ends the run as `failed`, and every step not yet decided is `stopped`; «Seguir» drops the rows
 * that failed and goes on; «Salir por error» sends them out by `OUT.error`, each with the field `ERROR_FIELD`.
 */
import { join, type Label, type Labeled } from "@boni/entities";
import {
  AGENT_PARAMS,
  AGENT_ROUNDS,
  type AgentCall,
  type AgentCodeTool,
  type AgentRecord,
  AgentTools,
  type AgentUnit,
  type AgentValue,
  addLine,
  agentConnections,
  deniedOf as agentDeniedOf,
  agentSchema,
  codeToolsOf,
  type Gathered,
  hiddenLines,
} from "./agent.ts";
import {
  AI_RETRY,
  type AiFailure,
  AiFault,
  type AiPort,
  type AiRecord,
  fieldsOf,
  isReaderType,
  modelLabelOf,
  type ReaderOutcome,
  readRows,
  retriesOf,
} from "./ai.ts";
import {
  BONI_ACTION_TYPE,
  BONI_PARAMS,
  BONI_READER_TYPE,
  BONI_TRIGGERS,
  BONI_VALUE,
  type BoniAnswer,
  type BoniCall,
  type BoniPort,
  boniPiece,
  isBoniTrigger,
  isBoniType,
} from "./boni.ts";
import {
  type Box,
  type ConsoleLine,
  type EvaluateInput,
  evaluate,
  limitFault,
  Reader,
  type ReadRecord,
  rowsOf,
  type StepEvaluation,
  seedOf,
} from "./box.ts";
import {
  actionOf,
  inputsOf,
  isTrigger,
  outputsOf,
  type ParamSpec,
  paramsOf,
  paramValue,
} from "./catalogue.ts";
import {
  AGENT_TYPE,
  CODE_LIMITS,
  CODE_PARAMS,
  CODE_TYPE,
  type CodeFailure,
  CodeFault,
  type CodeMode,
} from "./code.ts";
import { COLLECTION } from "./collection.ts";
import type { Connection } from "./connections.ts";
import {
  type Asked,
  type ChangeWith,
  type Clock,
  type Collections,
  type Dates,
  Denied,
  type Gate,
  guard,
  type Policy,
  type WriteResult,
} from "./effects.ts";
import {
  type Citation,
  CiteError,
  citationsIn,
  codeParts,
  parseExpression,
  printExpression,
  resolve,
  type Scope,
} from "./expression.ts";
import { type StepFailure, StepFault } from "./failures.ts";
import {
  type Automation,
  isExpr,
  limitsOf,
  OUT,
  type ParamValue,
  type RunLimit,
  type RunLimits,
  SETTINGS_DEFAULTS,
  type Step,
} from "./format.ts";
import { arrowsInto, executionOrder } from "./graph.ts";
import { type CodeContext, readCode } from "./javascript.ts";
import {
  ANSWER_FIELD,
  ASK_LIMITS,
  ASK_PARAMS,
  ASK_TYPE,
  type AskAnswer,
  type AskOption,
  type AskQuestion,
  type AskRecord,
  answerFits,
  asPlainText,
  cut,
  DAY_MS,
  type GivenAnswer,
  NO_ANSWER,
  NOTIFY_LIMITS,
  NOTIFY_PARAMS,
  NOTIFY_TYPE,
  type Notice,
  type NoticeRecord,
  type NotifyWhere,
  type PeopleFailure,
  PeopleFault,
  type PeoplePort,
  REPLY_PARAMS,
  REPLY_TYPE,
  type RunCounts,
  type RunReply,
  viaOf,
} from "./people.ts";
import type { Cell, Row } from "./rows.ts";
import { copy, fieldLabel, joinAll, StopRun, setField, TRANSFORM_AND_LOGIC } from "./steps.ts";
import { type Problem, type ValidationContext, validate } from "./validate.ts";
import { blocking } from "./versions.ts";
import {
  applyWrites,
  CONNECTION_ASKS,
  grantsOf,
  permissionOf,
  readWrites,
  type StepWrites,
  WRITE_ACTIONS,
  type WriteGate,
  type WriteGrant,
  type WriteRequest,
} from "./writes.ts";

export { StopRun } from "./steps.ts";

/**
 * A limit of the run stopped it (AU-17): what the engine throws before a step starts or before a change is asked or
 * written. It is a `StopRun`, so no retry and no «Si falla» apply; its failure is `run.limit`, with the limit's key,
 * its number and the number the run reached or was about to reach.
 */
export class LimitPassed extends StopRun {
  readonly limit: RunLimit;
  readonly max: number;
  readonly got: number;
  constructor(limit: RunLimit, max: number, got: number) {
    super(`the run's limit ${limit} is ${max}, and it reached ${got}`);
    this.name = "LimitPassed";
    this.limit = limit;
    this.max = max;
    this.got = got;
  }
}

/**
 * One more call to a model in a run (AU-206): an «Agente»'s round, a reader's call, a retry of either. Counted before
 * it is made: the one that would pass the run's `modelCalls` throws `LimitPassed` (its failure is `run.limit`) and is
 * not made. Gives the count with it.
 */
export function countModelCall(limits: Pick<RunLimits, "modelCalls">, made: number): number {
  const got = made + 1;
  if (got > limits.modelCalls) throw new LimitPassed("modelCalls", limits.modelCalls, got);
  return got;
}

/** A step's state in a run (AU-15). `waiting` is for the steps that wait for Juan or for a time (F18). */
export const STEP_STATES = [
  "queued",
  "running",
  "done",
  "failed",
  "skipped",
  "stopped",
  "waiting",
] as const;
export type StepState = (typeof STEP_STATES)[number];

/** The field a row that leaves by «error» gains: `{ message, rule? }`, the reason it failed (AU-16). */
export const ERROR_FIELD = "error";

export interface StepError {
  message: string;
  /** The policy's rule, when the policy said no. */
  rule?: string;
  /** The index, in the step's input, of the row it failed on; absent when the whole step failed. */
  row?: number;
  /** Why, as a key the screen can say, with the parameter at fault (failures.ts; set from F14b on). */
  failure?: StepFailure;
  /**
   * F14c: why its JavaScript failed (code.ts), while `failure.code` is `other`: the screen says this one, with the
   * words of `CODE_FAILURES` (boni-web's `words.ts`). The code's own message (`code.threw`) is here, in
   * `detail.message`, and never in `message`.
   */
  why?: CodeFailure;
  /** F15: why an AI step failed (ai.ts, `AI_FAILURES`), while `failure.code` is `other`. Never the value at fault. */
  ai?: AiFailure;
  /** F15 E4: why a «Preguntar», an «Avisar» or a «Responder» failed (people.ts), while `failure.code` is `other`. */
  people?: PeopleFailure;
}

/** What is kept of a step in a run (AU-15). What an AI step cost arrives with those steps (F15). */
export interface StepRecord {
  state: StepState;
  /** How many rows came in by each input. */
  in: Record<string, number>;
  /** What came out by each output, in order: the rows themselves (their count is its length). */
  out: Record<string, Row[]>;
  /** How long it took, waits between tries included. */
  ms: number;
  /** How many tries beyond the first, over all its rows. */
  retries: number;
  /** Rows that failed and were dropped («Seguir») or sent out by «error». */
  failed: number;
  /** Writes that were not done because they wait for Juan (they are in `Execution.asked`). */
  asked: number;
  /** Why it failed, when `state` is `failed`; with «Seguir», the first failure of a row. */
  error?: StepError;
  /** «Consola» (AU-33, F14c): what its JavaScript wrote, cut to `CODE_LIMITS.consoleLines`; `dropped` counts the rest. */
  console?: { lines: ConsoleLine[]; dropped: number };
  /** The reads its JavaScript made through the step's connections (AU-161, F14c): what, how much, never the rows. */
  reads?: ReadRecord[];
  /** Whether its JavaScript read the clock or chance (AU-34, F14c): what the screen says of a kept step that did. */
  uses?: { clock: boolean; random: boolean };
  /**
   * What its «Código» asked to save, as one change (AU-174, AU-181): saved, what a test would do and whether a run
   * would ask, or what waits for Juan. Absent when it asked for nothing, or when the step failed and saved nothing.
   */
  writes?: StepWrites;
  /**
   * What an AI step's calls to a model cost (AU-54, F15): how many, which models answered, how long, and how many
   * texts were cut. Absent in a step that called none.
   */
  ai?: AiRecord;
  /** An «Agente»'s «Lo que hizo» (AU-54, F15 E3): each unit of work, its rounds and its lines, written by code. */
  agent?: AgentRecord;
  /**
   * A «Preguntar»'s questions, what each takes and until when it waits (AU-125, AU-203, F15 E4): `waiting` while its
   * run waits, and kept once answered or left by «sin respuesta».
   */
  ask?: AskRecord;
  /** What an «Avisar» sent or, in a test, would send (AU-201). */
  notices?: NoticeRecord;
}

export interface Execution {
  automation: { id: string; version: number };
  /** The id of the trigger step it started in (AU-06). */
  trigger: string;
  test: boolean;
  /**
   * `done`: every step was decided. `failed`: a step stopped it. `waiting`: a «Preguntar» waits for Juan (AU-203):
   * what does not depend on the answer was decided, the steps after it are `queued`, and `resume` goes on.
   */
  state: "done" | "failed" | "waiting";
  /** Epoch ms, from the clock. */
  started: number;
  /**
   * The seed of its chance (AU-34, F14c): with `started`, which is also the instant its JavaScript sees, all a run
   * knows of the clock and of chance. `RunInput.seed`, or one made from `started` when it has none. Only in a run
   * where some JavaScript went to the box.
   */
  seed?: number;
  ms: number;
  /** `executionOrder`: the steps that hang from the trigger, in the order they were decided. */
  order: string[];
  /** By step id: every step of `order`. A step the trigger does not reach has no record. */
  steps: Record<string, StepRecord>;
  /** What the run wants to write and waits for Juan, in order: one proposal for the whole run (decision 4 of §10). */
  asked: Asked[];
  /** The step that stopped the run and why, when `state` is `failed`. */
  error?: StepError & { step: string };
  /** The run's answer (AU-202): the last «Responder» that ran, kept across a wait. Absent when none did. */
  reply?: RunReply;
  /**
   * While it waits (AU-203): the earliest wait limit of its questions, and what it counted so far, carried across the
   * wait (its `ms` is only what ran).
   */
  waits?: { until: number; counts: RunCounts };
}

/** What `$run.startedBy` says (AU-195): by hand, or a «Programada» at its hour (F18 adds one per trigger). */
export type StartedBy = "user" | "schedule";

export interface RunInput {
  automation: Automation;
  /** The id of the trigger step this run starts in. */
  trigger: string;
  /**
   * The row the trigger gives: for «Disparado por el usuario», the «Campos que pide» with what it was started with
   * and the label of who gave them (AU-110). A field the trigger declares and this lacks is null; one it does not
   * declare is refused before anything runs. The engine sets its `parent` and `path`.
   */
  fields: Pick<Row, "json" | "label" | "fields">;
  /** Runs everything and writes nothing (`PolicyCall.test`). */
  test: boolean;
  /**
   * How it started, as `$run.startedBy` gives it (AU-195): `user` (by hand) or `schedule` (a «Programada» at its
   * hour); `user` when not given. A closed list, never a name or an id; no decision about a write reads it.
   */
  startedBy?: StartedBy;
  /**
   * The seed of the run's chance (AU-34): drawn once by whoever starts the run and kept with it, so repeating the run
   * with it and with the same instant gives the same. Absent: made from the run's instant.
   */
  seed?: number;
}

export interface RunDeps {
  policy: Policy;
  collections: Collections;
  clock: Clock;
  dates: Dates;
  /** The label of what Juan wrote in the automation itself: its fixed values (`Scope.literal`). */
  own: Label;
  /** The language «Dar formato» writes in. */
  locale: string;
  /**
   * Where JavaScript runs (box.ts, F14c). Without one, an automation with JavaScript does not run: validation refuses
   * it (`expr.code`) as before F14c. With one, validation reads the code (`CodeContext`).
   */
  box?: Box;
  /**
   * A collection's key by the name a step's code cites it with (`$col('…')`, javascript.ts): as Juan sees it now or,
   * in a run of a published version, first by the names that version kept for that step (`namedFor`, AU-192).
   * `step`: the step whose code cites it; absent where no step is meant.
   */
  collectionNamed?(name: string, step?: string): string | undefined;
  /**
   * Told as each step starts (`started`, its record `running`) and as it is decided (`ended`, its record as the
   * execution will hold it): what the server keeps as the run goes, so a run in progress is read up to its last
   * finished step and one a restart cut says where it was (AU-99, AU-190). A step the run stopped before, or took
   * from a kept test, is told `ended` only. It must not throw: the engine does not catch it.
   */
  onStep?(step: string, record: StepRecord, phase: "started" | "ended"): void;
  /**
   * How a step calls a model (ai.ts, F15): the server's port, with its providers, «Modelos» and the month's budget
   * (S1); a test's scripted reader. Without one, the AI steps do not run: validation refuses them (`step.unknownType`).
   */
  ai?: AiPort;
  /**
   * How «Preguntar», «Avisar» and «Responder» reach Juan (people.ts, F15 E4): the server's notices and its Bandeja
   * (S2); a test's recorder. Without one they do not run: validation refuses them (`step.unknownType`).
   */
  people?: PeoplePort;
  /**
   * How a Boni step reaches Boni's code (boni.ts, F16): the server's port, which says which of Boni's automations this
   * run is from where it is stored; a test's scripted one. Without one, the Boni steps do not run: validation refuses
   * them (`step.unknownType`).
   */
  boni?: BoniPort;
}

/**
 * What a run validates with: the collections' shapes and, with a box, what reading code needs (`CodeContext`), so
 * JavaScript is checked instead of refused.
 */
export function validationOf(deps: RunDeps): ValidationContext | CodeContext {
  const collection = (key: string) => deps.collections.shape(key);
  const ai = {
    ...(deps.ai ? { ai: true } : {}),
    ...(deps.people ? { people: true } : {}),
    ...(deps.boni
      ? { boni: deps.boni.automation ? { automation: deps.boni.automation } : {} }
      : {}),
  };
  if (!deps.box) return { collection, ...ai };
  return { collection, ...ai, collectionNamed: (name, step) => deps.collectionNamed?.(name, step) };
}

/**
 * Runs an automation from a trigger to the end. It validates first and rejects with `CannotRun`, before any effect, when
 * `validate` gives an error that would stop a publish (`blocking`: on the automation or on a step a trigger reaches), the trigger is not a trigger step of the automation, or the trigger's row has a field it
 * does not ask for or one of another type; after that it never throws: what goes wrong is in the `Execution`. It holds
 * to the automation's limits (`limitsOf`, AU-17), in a test as in a real run: time and steps before each step starts,
 * rows written before a change is asked of the policy. Saving the run (AU-15 in tables) is the server's.
 */
export async function run(input: RunInput, deps: RunDeps): Promise<Execution> {
  const problems = validate(input.automation, validationOf(deps) as ValidationContext);
  // What stops a publish stops a run, and nothing else (AU-96): an error on a step no trigger reaches does neither.
  if (blocking(input.automation, problems).length)
    throw new CannotRun("the automation has errors", problems);
  const trigger = input.automation.steps.find((s) => s.id === input.trigger);
  if (!trigger || !isTrigger(trigger))
    throw new CannotRun(`${input.trigger} is not a trigger of the automation`);
  return new Run(input, deps, triggerRow(trigger, input.fields)).go();
}

/**
 * What a test of part of a draft decides (partial.ts): the steps in the order they are decided, and the records
 * taken as they were kept instead of running their steps. Each reused step comes before what hangs from it, and
 * everything it hangs from is reused too, so its rows keep their lineage.
 */
export interface Plan {
  order: string[];
  reuse: ReadonlyMap<string, StepRecord>;
}

/** `run` for a test: the same run, from a trigger checked by the caller, with the order and the reuse of `plan`. */
export function runPlanned(
  input: RunInput,
  deps: RunDeps,
  trigger: Step,
  plan: Plan,
): Promise<Execution> {
  return new Run(input, deps, triggerRow(trigger, input.fields), plan).go();
}

/**
 * The answers to a waiting run's questions, by the «Preguntar»'s step id: one per question, in the order of its
 * `AskRecord.questions`; null for one with no answer. A step not named here goes on waiting, unless its limit passed.
 */
export type Answers = Readonly<Record<string, readonly (GivenAnswer | null)[]>>;

/**
 * The state of a run that ended, for a caller that gives no `PeoplePort`: without one «Preguntar» does not validate
 * (`step.unknownType`), so no run waits, and a waiting one here is a bug. F15 S2 gives the server its port and keeps
 * the waiting runs.
 */
export function endedState(e: Pick<Execution, "state">): "done" | "failed" {
  if (e.state === "waiting") throw new Error("a run waits for an answer with no people port");
  return e.state;
}

/**
 * Goes on with a run that waits (AU-203): from each «Preguntar» answered or past its limit, with the outputs its
 * decided steps kept (`kept`, as the run left it, also after a restart), the version it started with (`input`'s
 * automation, the same id and version), its counts and its running time. It rejects with `CannotRun`, before any
 * effect, a run that does not wait, another version, another trigger or test, an answer to a step that does not
 * wait, or one that does not fit its question; after that it never throws, as `run`.
 */
export async function resume(
  input: RunInput,
  deps: RunDeps,
  kept: Execution,
  answers: Answers,
): Promise<Execution> {
  const problems = validate(input.automation, validationOf(deps) as ValidationContext);
  if (blocking(input.automation, problems).length)
    throw new CannotRun("the automation has errors", problems);
  if (kept.state !== "waiting") throw new CannotRun("the run does not wait");
  if (
    kept.automation.id !== input.automation.id ||
    kept.automation.version !== input.automation.version
  )
    throw new CannotRun("a run goes on with the version it started with");
  if (kept.trigger !== input.trigger || kept.test !== input.test)
    throw new CannotRun("a run goes on as it started");
  for (const [id, given] of Object.entries(answers)) {
    const ask = kept.steps[id]?.state === "waiting" ? kept.steps[id]?.ask : undefined;
    if (!ask) throw new CannotRun(`${id} does not wait for an answer`);
    if (given.length !== ask.questions.length)
      throw new CannotRun(`${id} asks ${ask.questions.length} questions`);
    given.forEach((g, i) => {
      if (g && !answerFits(ask.questions[i] as AskQuestion, ask.answer, g.value))
        throw new CannotRun(`the answer ${i} of ${id} does not fit its question`);
    });
  }
  const trigger = input.automation.steps.find((s) => s.id === input.trigger);
  const first = Object.values(kept.steps[input.trigger]?.out ?? {})[0]?.[0];
  if (!trigger || !isTrigger(trigger) || !first)
    throw new CannotRun(`${input.trigger} is not a trigger of the run`);
  const reuse = new Map(
    Object.entries(kept.steps).filter(([, r]) => r.state !== "waiting" && r.state !== "queued"),
  );
  return new Run(
    input,
    deps,
    first,
    { order: kept.order, reuse },
    { execution: kept, answers },
  ).go();
}

/** The trigger's row a run would start with, or `CannotRun` (AU-110): what `run` checks before any effect. */
export function checkTriggerRow(step: Step, given: RunInput["fields"]): void {
  triggerRow(step, given);
}

/** Why a run did not start: the automation's errors, or a trigger or a row it cannot start with. Nothing was done. */
export class CannotRun extends Error {
  readonly problems: readonly Problem[];
  constructor(message: string, problems: readonly Problem[] = []) {
    super(message);
    this.name = "CannotRun";
    this.problems = problems;
  }
}

/** What a value of each type a trigger asks for may be (catalogue: «Disparado por el usuario»). Null is no value. */
const TRIGGER_TYPES: Record<string, (v: Cell) => boolean> = {
  text: (v) => typeof v === "string",
  number: (v) => typeof v === "number" && Number.isFinite(v),
  checkbox: (v) => typeof v === "boolean",
  date: (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v),
  datetime: (v) => typeof v === "number" && Number.isFinite(v),
};

/** The trigger's row (AU-110): every field it asks for, null where none was given; another field is refused. */
function triggerRow(step: Step, given: RunInput["fields"]): Row {
  if (isBoniTrigger(step.type)) return boniTriggerRow(step, given);
  const types = new Map<string, string>();
  // A «Programada» gives the hour that was due (AU-114); «Disparado por el usuario», the fields it asks for.
  if (step.type === "schedule") types.set("date", "datetime");
  else
    for (const f of Array.isArray(step.params.fields) ? step.params.fields : []) {
      const o = f as Record<string, ParamValue>;
      if (typeof o.key === "string") types.set(o.key, typeof o.type === "string" ? o.type : "text");
    }
  for (const k of Object.keys(given.json))
    if (!types.has(k)) throw new CannotRun(`the trigger does not ask for the field ${k}`);
  const json: Record<string, Cell> = {};
  for (const [k, type] of types) {
    const v = given.json[k] ?? null;
    if (v !== null && !TRIGGER_TYPES[type]?.(v))
      throw new CannotRun(`the field ${k} is not of type ${type}`);
    json[k] = v;
  }
  const fields = Object.fromEntries(
    Object.entries(given.fields ?? {}).filter(([k]) => types.has(k)),
  );
  return {
    json,
    label: given.label,
    ...(Object.keys(fields).length ? { fields } : {}),
    path: null,
    parent: null,
  };
}

/**
 * The row a Boni trigger gives (AU-220, AU-137): what Boni's code started it with, whose keys are Boni's code's to
 * say. «Llega un correo»'s is labelled whole as from outside: given with any other label it does not start, and no
 * field of it keeps a label of its own.
 */
function boniTriggerRow(step: Step, given: RunInput["fields"]): Row {
  const mail = step.type === BONI_TRIGGERS.mail;
  if (mail && given.label.integrity !== "external")
    throw new CannotRun("a mail starts a run only labelled as from outside");
  const fields = mail ? {} : (given.fields ?? {});
  return {
    json: { ...given.json },
    label: given.label,
    ...(Object.keys(fields).length ? { fields: { ...fields } } : {}),
    path: null,
    parent: null,
  };
}

/** A step that neither reads nor writes gets a gate that refuses everything: it has no way to the collections. */
export const CLOSED: Gate = {
  shape: closed,
  find: closed,
  get: closed,
  aggregate: closed,
  write: closed,
  decideAll: closed,
  writeAll: closed,
};
function closed(): never {
  throw new Error("this step does not read or write collections");
}

/** The fields a parameter that changes the rows names, by input: what they hold decided the path (AU-164). */
function namedFields(p: ParamSpec, v: ParamValue | undefined): { input: string; field: string }[] {
  if (v === undefined || v === null) return [];
  if (
    p.control === "choice" &&
    !Array.isArray(p.options) &&
    "of" in p.options &&
    p.options.of === "input"
  )
    return typeof v === "string" ? [{ input: p.options.input, field: v }] : [];
  if (p.control === "conditions" && p.over.of === "input") {
    const input = p.over.input;
    const fields: { input: string; field: string }[] = [];
    const walk = (x: ParamValue) => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (typeof x === "object" && x !== null && !isExpr(x)) {
        if (typeof x.field === "string" && typeof x.op === "string")
          fields.push({ input, field: x.field });
        if (Array.isArray(x.rules)) walk(x.rules);
      }
    };
    walk(v);
    return fields;
  }
  if (p.control === "list" && Array.isArray(v))
    return v.flatMap((item) =>
      typeof item === "object" && item !== null && !Array.isArray(item) && !isExpr(item)
        ? p.columns.flatMap((c) => namedFields(c, item[c.key]))
        : [],
    );
  return [];
}

const hasExpr = (v: ParamValue | undefined): boolean =>
  isExpr(v) ||
  (Array.isArray(v)
    ? v.some(hasExpr)
    : typeof v === "object" && v !== null && Object.values(v).some(hasExpr));

/** A step's failure for the log and for the screen: the English message, the policy's rule and its code (AU-84). */
function stepErrorOf(e: unknown, step: Step): StepError {
  return {
    message: e instanceof Error ? e.message : String(e),
    ...(e instanceof Denied ? { rule: e.rule } : {}),
    failure: failureOf(e, step),
    ...(e instanceof CodeFault ? { why: e.why } : {}),
    ...(e instanceof AiFault ? { ai: e.ai } : {}),
    ...(e instanceof PeopleFault ? { people: e.people } : {}),
  };
}

function failureOf(e: unknown, step: Step): StepFailure {
  if (e instanceof StepFault) return e.failure;
  if (e instanceof LimitPassed)
    return { code: "run.limit", detail: { limit: e.limit, max: e.max, got: e.got } };
  if (e instanceof StopRun) return { code: "stopped", detail: { message: e.message } };
  if (e instanceof Denied) return { code: e.waits ? "policy.waits" : "policy.denied" };
  if (e instanceof CiteError) {
    const param = citedIn(step, e.cite);
    return {
      code: `cite.${e.failure}`,
      ...(param ? { param } : {}),
      ...(e.cite.step === null ? {} : { detail: { step: e.cite.step } }),
    };
  }
  return { code: "other" };
}

/** The parameter a citation is written in, as `Problem.param` writes one («where.0.value»); the first that has it. */
function citedIn(step: Step, cite: Citation): string | undefined {
  const same = (c: Citation) =>
    c.step === cite.step &&
    c.pick === cite.pick &&
    c.path.length === cite.path.length &&
    c.path.every((k, i) => k === cite.path[i]);
  const walk = (v: ParamValue, at: string): string | undefined => {
    if (isExpr(v)) return citationsIn(v).some(same) ? at : undefined;
    if (Array.isArray(v)) {
      for (const [i, x] of v.entries()) {
        const found = walk(x, `${at}.${i}`);
        if (found) return found;
      }
      return undefined;
    }
    if (typeof v === "object" && v !== null)
      for (const [k, x] of Object.entries(v)) {
        const found = walk(x, `${at}.${k}`);
        if (found) return found;
      }
    return undefined;
  };
  for (const p of paramsOf(step)) {
    const v = step.params[p.key];
    const found = v === undefined ? undefined : walk(v, p.key);
    if (found) return found;
  }
  for (const [k, v] of Object.entries(step.params)) {
    const found = walk(v, k);
    if (found) return found;
  }
  return undefined;
}

/** A step's JavaScript (F14c): what is sent to the box, and the parameter each source is written in. */
export interface Javascript {
  kind: "expressions" | "code";
  sources: string[];
  /** For each source, the parameter it is written in (the first that has it), as `Problem.param` writes one. */
  params: string[];
}

/**
 * The JavaScript of a step: a «Código»'s source, or every `{{ }}` of its parameters that is not a simple citation,
 * each source once. None: the step has no JavaScript and never reaches the box.
 */
export function javascriptOf(step: Step): Javascript | undefined {
  if (step.type === CODE_TYPE) {
    const source = step.params[CODE_PARAMS.source];
    return {
      kind: "code",
      sources: [typeof source === "string" ? source : ""],
      params: [CODE_PARAMS.source],
    };
  }
  const sources: string[] = [];
  const params: string[] = [];
  const walk = (v: ParamValue, at: string) => {
    if (isExpr(v)) {
      for (const p of codeParts(v.expr).parts)
        if (!sources.includes(p.source)) {
          sources.push(p.source);
          params.push(at);
        }
    } else if (Array.isArray(v)) for (const [i, x] of v.entries()) walk(x, `${at}.${i}`);
    else if (typeof v === "object" && v !== null)
      for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`);
  };
  for (const [k, v] of Object.entries(step.params)) walk(v, k);
  return sources.length ? { kind: "expressions", sources, params } : undefined;
}

/** A step's JavaScript once evaluated: the record's part, and what each unit reads of it. */
interface Prepared {
  run: StepEvaluation;
  /** The failures of single evaluations: a unit that meets one does not try again. */
  decided: WeakSet<object>;
  /** The scope's `code` for evaluation `i` (expressions); undefined for a «Código». */
  at(i: number): Scope["code"] | undefined;
  /** The rows evaluation `i` of a «Código» gave; throws its failure. */
  rows(i: number): readonly RowOut[];
  /**
   * What evaluation `i` of a «Código» asked to save, in the order asked, each with the label of what it received
   * (AU-169); in «Una vez por fila», each with its row. None for one that failed.
   */
  writes(i: number): { request: WriteRequest; label: Label }[];
}

/** A write a step asked to save: what it asked, the label of what it received, an «Agente»'s fixed expressions. */
type Asked_ = { request: WriteRequest; label: Label; fixed?: Record<string, Labeled<Cell>> };

/** What a step's writes are held to when it ends (writes.ts `applyWrites`). */
interface SaveHow {
  grants: readonly WriteGrant[];
  connections: readonly Connection[];
  collectionNamed(name: string): string | undefined;
}

/** An «Agente»'s state for its step (AU-51, AU-198). */
interface AgentState {
  reader: Reader;
  read: Set<string>;
  /** What each unit that worked asked to write, by the unit's place. */
  writes: Map<number, Gathered[]>;
  how: SaveHow;
  check(more: readonly Gathered[]): Promise<void>;
  record: AgentRecord;
}

/** One run: its records, and which step and input rows made each row (for `$('Step').item`, AU-13). */
class Run {
  readonly input: RunInput;
  readonly deps: RunDeps;
  readonly first: Row;
  readonly records: Record<string, StepRecord> = {};
  readonly asked: Asked[] = [];
  readonly made = new WeakMap<Row, { step: string; inputs: readonly Row[] }>();
  readonly byId: Map<string, Step>;
  readonly byName: Map<string, Step>;
  readonly plan: Plan | undefined;
  order: string[] = [];
  /** The run's instant and seed (AU-34): what every job to the box carries. */
  started = 0;
  seed = 0;
  /** Whether any step's JavaScript went to the box: only then is the seed part of what the run was. */
  boxed = false;
  /** What it holds to (AU-17), and how far it got: the steps started and the rows written, tested or proposed. */
  readonly limits: RunLimits;
  ran = 0;
  written = 0;
  /** Calls to a model made so far (AU-206). */
  models = 0;
  /** Rows each step asked to write with each action in each collection, saved, tested or proposed (AU-196). */
  readonly actionRows = new Map<string, number>();
  /** The run's answer (AU-202): the last «Responder» that ran. */
  reply: RunReply | undefined;
  /** The run it goes on from after a wait, and the answers it was given (AU-203). */
  readonly from: { execution: Execution; answers: Answers } | undefined;
  /** What ran before this part of the run (AU-203: its time limit counts what runs, not what waits), and when it began. */
  spent = 0;
  resumed = 0;
  /** By «Avisar» step: the notices past `NOTIFY_LIMITS.notices`, sent as one that groups them (AU-201). */
  readonly grouped = new Map<string, number>();

  constructor(
    input: RunInput,
    deps: RunDeps,
    first: Row,
    plan?: Plan,
    from?: { execution: Execution; answers: Answers },
  ) {
    this.input = input;
    this.deps = deps;
    this.first = first;
    this.plan = plan;
    this.from = from;
    this.reply = from?.execution.reply;
    this.byId = new Map(input.automation.steps.map((s) => [s.id, s]));
    this.byName = new Map(input.automation.steps.map((s) => [s.name, s]));
    this.limits = limitsOf(input.automation);
  }

  /** Throws `LimitPassed` when `got` is over `limit` (AU-17). */
  hold(limit: RunLimit, got: number): void {
    const max = this.limits[limit];
    if (got > max) throw new LimitPassed(limit, max, got);
  }

  /** Before `n` more rows are asked of the policy: they and the ones already written must fit (AU-17). */
  reserve(n: number): void {
    if (n > 0) this.hold("rowsWritten", this.written + n);
  }

  /** Before a call to a model (AU-206): `countModelCall` on the run's count. */
  modelCall(): void {
    this.models = countModelCall(this.limits, this.models);
  }

  /**
   * Before retry `n` of «Reintentar si el modelo falla» (`AI_RETRY`): waits `n` times `AI_RETRY.waitMs` by the run's
   * clock, then checks the run's time and counts the call like any other (AU-17, AU-206): `LimitPassed` stops the run.
   */
  async retryCall(n: number): Promise<void> {
    await this.deps.clock.sleep(AI_RETRY.waitMs * n);
    const elapsed = this.elapsed();
    if (elapsed >= this.limits.ms) throw new LimitPassed("ms", this.limits.ms, elapsed);
    this.modelCall();
  }

  /** What the run counted so far (AU-203): what a wait carries across. */
  counts(): RunCounts {
    return {
      ran: this.ran,
      written: this.written,
      models: this.models,
      actionRows: Object.fromEntries(this.actionRows),
    };
  }

  /** The run's time so far (AU-17): what ran before a wait, and this part's. */
  elapsed(): number {
    return this.spent + this.deps.clock.now() - this.resumed;
  }

  async go(): Promise<Execution> {
    const { automation, trigger, test } = this.input;
    const before = this.from?.execution;
    this.resumed = this.deps.clock.now();
    const started = before?.started ?? this.resumed;
    this.started = started;
    this.seed = this.input.seed ?? before?.seed ?? seedOf(started, "");
    if (before) {
      // What the run counted before it waited counts after it too (AU-203).
      this.spent = before.ms;
      this.boxed = before.seed !== undefined;
      const counts = before.waits?.counts;
      if (counts) {
        this.ran = counts.ran;
        this.written = counts.written;
        this.models = counts.models;
        for (const [k, n] of Object.entries(counts.actionRows)) this.actionRows.set(k, n);
      }
      this.asked.push(...before.asked);
    }
    this.order = this.plan?.order ?? executionOrder(automation, trigger);
    let error: Execution["error"];
    for (const id of this.order) {
      const step = this.byId.get(id) as Step;
      if (error) {
        this.records[id] = { ...blank(), state: "stopped" };
        this.told(id, "ended");
        continue;
      }
      const kept = this.plan?.reuse.get(id);
      if (kept) {
        // Taken as it was kept: its rows are remembered as this step's, made from what its arrows bring now.
        this.records[id] = kept;
        const inputs = id === trigger ? [] : this.arriving(step);
        for (const rows of Object.values(kept.out))
          for (const r of rows) this.made.set(r, { step: id, inputs });
        this.told(id, "ended");
        continue;
      }
      // A question it waited on: answered, past its limit, or still waiting (AU-203).
      const waited = before?.steps[id];
      if (waited?.state === "waiting" && waited.ask) {
        this.answered(step, waited);
        continue;
      }
      // What depends on an answer not given yet waits with it (AU-203): no rows reach it until then.
      if (
        id !== trigger &&
        inputsOf(step).some((name) =>
          arrowsInto(automation, this.order, id, name).some((a) => {
            const state = this.records[a.from.step]?.state;
            return state === "waiting" || state === "queued";
          }),
        )
      ) {
        this.records[id] = blank();
        continue;
      }
      if (id === trigger) {
        this.made.set(this.first, { step: id, inputs: [] });
        this.records[id] = {
          ...blank(),
          state: "done",
          out: { [outputsOf(step)[0] ?? OUT.main]: [this.first] },
        };
        this.told(id, "ended");
        continue;
      }
      const failure = await this.step(step);
      if (failure) error = { ...failure, step: id };
      this.told(id, "ended");
    }
    // What a waiting run keeps to go on (AU-203): every step's outputs with their labels and its questions, measured
    // after the steps that do not depend on the answer ran too. Over the limit, the first question fails and asks
    // nothing: its record keeps no question for the Bandeja.
    const asking = this.order.find((id) => this.records[id]?.state === "waiting");
    if (!error && asking) {
      const kept = utf8Bytes(JSON.stringify(this.records));
      if (kept > ASK_LIMITS.keptBytes) {
        const record = this.records[asking] as StepRecord;
        const step = this.byId.get(asking) as Step;
        record.error = stepErrorOf(
          new PeopleFault(`${kept} bytes to keep, at most ${ASK_LIMITS.keptBytes}`, {
            code: "ask.kept",
            detail: { max: ASK_LIMITS.keptBytes },
          }),
          step,
        );
        record.state = "failed";
        delete record.ask;
        error = { ...record.error, step: asking };
        this.told(asking, "ended");
      }
    }
    // A run that failed waits for nothing: what waited, or waited on it, stops with it.
    const waiting = this.order.filter((id) => {
      const state = this.records[id]?.state;
      return state === "waiting" || state === "queued";
    });
    if (error)
      for (const id of waiting) {
        (this.records[id] as StepRecord).state = "stopped";
        this.told(id, "ended");
      }
    const until = waiting.flatMap((id) => {
      const ask = this.records[id]?.state === "waiting" ? this.records[id]?.ask : undefined;
      return ask ? [ask.until] : [];
    });
    return {
      automation: { id: automation.id, version: automation.version },
      trigger,
      test,
      state: error ? "failed" : until.length ? "waiting" : "done",
      started,
      ...(this.boxed ? { seed: this.seed } : {}),
      ms: this.elapsed(),
      order: this.order,
      steps: this.records,
      asked: this.asked,
      ...(error ? { error } : {}),
      ...(this.reply ? { reply: this.reply } : {}),
      ...(!error && until.length
        ? { waits: { until: Math.min(...until), counts: this.counts() } }
        : {}),
    };
  }

  /**
   * A «Preguntar» its run waited on (AU-203): with its answers, or past its wait limit, it gives its rows (each with
   * `respuesta`, or by «sin respuesta» when its question had none); otherwise it goes on waiting. Its rows are the ones
   * the steps before it kept, so a restart loses nothing.
   */
  answered(step: Step, waited: StepRecord): void {
    const ask = waited.ask as AskRecord;
    const given = this.from?.answers[step.id];
    const late = this.deps.clock.now() >= ask.until;
    const record: StepRecord = { ...waited, out: {}, ask: { ...ask } };
    this.records[step.id] = record;
    if (!given && !late) return;
    for (const o of outputsOf(step)) record.out[o] = [];
    const rows = this.arriving(step);
    const by = { [inputsOf(step)[0] as string]: rows };
    const path = this.path(step, this.scope(null), by);
    let answeredAny = false;
    ask.questions.forEach((q, i) => {
      // Past its limit, an answer no longer counts («Ya no vale»).
      const a = late ? null : (given?.[i] ?? null);
      const units = ask.mode === "perRow" ? [rows[i] as Row] : rows;
      const at = (k: number) => (ask.mode === "perRow" ? i : k);
      if (!a) {
        for (const [k, r] of units.entries())
          (record.out[NO_ANSWER] as Row[]).push(this.row(step.id, copy(r), at(k), path, rows));
        return;
      }
      answeredAny = true;
      const value = { value: a.value, label: this.answerLabel(ask.answer, q, a), derived: false };
      if (!units.length) {
        // Asked with no row (an empty list that goes on, AU-14): its row is the answer alone.
        const out: RowOut = { json: {}, label: value.label };
        setField(out, ANSWER_FIELD, value);
        (record.out[OUT.main] as Row[]).push(this.row(step.id, out, null, path, rows));
      }
      for (const [k, r] of units.entries()) {
        const out = copy(r);
        setField(out, ANSWER_FIELD, value);
        (record.out[OUT.main] as Row[]).push(this.row(step.id, out, at(k), path, rows));
      }
    });
    (record.ask as AskRecord).ended = answeredAny ? "answered" : "noAnswer";
    record.state = "done";
    this.told(step.id, "ended");
  }

  /**
   * The label of an answer (AU-125): the hand's when he writes it; the option's when he chooses one (the
   * automation's own for «Sí o no» and for fixed options, the expression's for options it gave).
   */
  answerLabel(kind: AskAnswer, q: AskQuestion, a: GivenAnswer): Label {
    if (kind === "text") return a.by;
    if (kind === "yesNo") return this.deps.own;
    const chosen = Array.isArray(a.value) ? a.value : [a.value];
    const labels = (q.options ?? []).filter((o) => chosen.includes(o.value)).map((o) => o.label);
    return labels.length ? join(labels[0] as Label, ...labels.slice(1)) : this.deps.own;
  }

  /**
   * A «Preguntar» reached (AU-125, AU-203): its questions, made before any is asked, or the fault that fails the step
   * without asking: more than 20 with «Una vez por fila», the automation's 20 runs already waiting, options that are
   * not a list of texts, or more than 2 MB to keep.
   */
  async ask(step: Step, rows: readonly Row[], scopeOf: (i: number) => Scope): Promise<AskRecord> {
    const mode = actionOf(step)?.mode === "perRow" ? "perRow" : "all";
    const count = mode === "perRow" ? rows.length : 1;
    if (count > ASK_LIMITS.questions)
      throw new PeopleFault(`${count} questions, at most ${ASK_LIMITS.questions}`, {
        code: "ask.questions",
        detail: { got: count, max: ASK_LIMITS.questions },
      });
    const port = this.deps.people;
    if (!port) throw new PeopleFault("nothing can ask Juan here", { code: "people.unavailable" });
    // A test is answered in its own panel: it waits in no Bandeja (AU-203).
    if (!this.input.test && (await port.waiting(this.input.automation.id)) >= ASK_LIMITS.waiting)
      throw new PeopleFault(`${ASK_LIMITS.waiting} runs already wait`, {
        code: "ask.waiting",
        detail: { max: ASK_LIMITS.waiting },
      });
    const answer = (step.params[ASK_PARAMS.answer] ?? "yesNo") as AskAnswer;
    const questions: AskQuestion[] = [];
    for (let i = 0; i < count; i++) {
      const scope = scopeOf(i);
      const q = resolve(step.params[ASK_PARAMS.question] ?? "", scope);
      const question: AskQuestion = { text: asPlainText(q.value), label: q.label };
      if (answer === "one" || answer === "several")
        question.options = this.options(step.params[ASK_PARAMS.options] ?? null, scope);
      questions.push(question);
    }
    const days = step.params[ASK_PARAMS.waitDays];
    const until =
      this.deps.clock.now() + (typeof days === "number" ? days : ASK_LIMITS.waitDays.born) * DAY_MS;
    // What the run keeps is measured once it has done all it can before waiting (`go`): `ask.kept`.
    return {
      answer,
      mode,
      questions,
      until,
      ...(step.params[ASK_PARAMS.personal] === true ? { personal: true as const } : {}),
      via: viaOf("ask", step.params[ASK_PARAMS.via]),
      ...(step.params[ASK_PARAMS.where] && step.params[ASK_PARAMS.where] !== "all"
        ? { where: step.params[ASK_PARAMS.where] as NotifyWhere }
        : {}),
    };
  }

  /** A question's options (AU-125): fixed with the automation's label, or the list an expression gives with its own. */
  options(v: ParamValue, scope: Scope): AskOption[] {
    const got = resolve(v, scope);
    const list = got.value;
    if (
      !Array.isArray(list) ||
      !list.length ||
      !list.every((o) => typeof o === "string" && o.trim() !== "") ||
      new Set(list).size !== list.length
    )
      throw new PeopleFault("the options are not a list of texts", {
        code: "ask.options",
        param: ASK_PARAMS.options,
      });
    return (list as string[]).map((value) => ({ value, label: got.label }));
  }

  /**
   * One notice of an «Avisar» (AU-201): its text plain and cut to 300 characters, to the devices its «Dónde» names
   * as saved. Past the fifth of the step in this run, it is counted to be sent as one that groups them. In a test it
   * is kept as what it would send, and nothing is sent.
   */
  async notify(step: Step, record: StepRecord, text: Labeled<Cell> | null): Promise<void> {
    record.notices ??= { notices: [], sent: !this.input.test };
    const notices = record.notices;
    const where = (step.params[NOTIFY_PARAMS.where] ?? "all") as NotifyWhere;
    if (text && notices.notices.length >= NOTIFY_LIMITS.notices) {
      this.grouped.set(step.id, (this.grouped.get(step.id) ?? 0) + 1);
      return;
    }
    const more = text ? undefined : this.grouped.get(step.id);
    const notice: Notice = {
      automation: this.input.automation.id,
      step: step.id,
      text: text ? cut(asPlainText(text.value), NOTIFY_LIMITS.chars) : "",
      label: text ? text.label : this.deps.own,
      where,
      via: viaOf("notify", step.params[NOTIFY_PARAMS.via]),
      ...(more ? { more } : {}),
    };
    if (!this.input.test) {
      if (!this.deps.people)
        throw new PeopleFault("nothing can tell Juan here", { code: "people.unavailable" });
      await this.deps.people.notify(notice);
    }
    notices.notices.push(notice);
  }

  /** Tells `onStep` of a step's record as it stands. */
  told(id: string, phase: "started" | "ended"): void {
    const record = this.records[id];
    if (record) this.deps.onStep?.(id, record, phase);
  }

  /** Decides and runs one step, and leaves its record. Gives the error that stops the run, if it does. */
  async step(step: Step): Promise<StepError | undefined> {
    const { clock } = this.deps;
    const start = clock.now();
    const settings = { ...SETTINGS_DEFAULTS, ...(step.settings ?? {}) };
    const record: StepRecord = { ...blank(), state: "running" };
    this.records[step.id] = record;
    this.told(step.id, "started");
    const names = outputsOf(step);
    for (const o of names) record.out[o] = [];

    // What arrives, input by input, in the order of `arrowsInto` (AU-11); and whether the step runs (AU-10, AU-14).
    const inputs: Record<string, Row[]> = {};
    let brings = false;
    let empty = false;
    for (const name of inputsOf(step)) {
      inputs[name] = [];
      for (const a of arrowsInto(this.input.automation, this.order, step.id, name)) {
        const from = this.records[a.from.step];
        const rows = from?.out[a.from.output] ?? [];
        inputs[name].push(...rows);
        if (rows.length) brings = true;
        else if (
          from?.state === "done" &&
          a.from.output !== OUT.error &&
          this.byId.get(a.from.step)?.settings?.continueEmpty
        )
          empty = true;
      }
      record.in[name] = inputs[name].length;
      if (settings.firstRowOnly) inputs[name] = inputs[name].slice(0, 1);
    }
    const finish = (state: StepState) => {
      record.state = state;
      record.ms = clock.now() - start;
    };
    if (!brings && !empty) {
      finish("skipped");
      return;
    }
    const all = inputsOf(step).flatMap((n) => inputs[n] ?? []);
    const action = actionOf(step);

    // The run's limits, before the step starts (AU-17): its time by its own clock and the steps it started; and, for
    // a «Colección» that writes, the rows it would write, one per unit at most, before any is asked of the policy.
    // «Las que cumplan…» writes what it finds, known only once found: `StepContext.reserve` checks it then.
    try {
      const elapsed = this.elapsed();
      if (elapsed >= this.limits.ms) throw new LimitPassed("ms", this.limits.ms, elapsed);
      this.hold("steps", this.ran + 1);
      this.ran++;
      if (
        !settings.off &&
        step.type === "collection" &&
        action?.effect === "write" &&
        step.params.target !== "matching"
      )
        this.reserve(all.length || 1);
    } catch (e) {
      record.error = stepErrorOf(e, step);
      finish("failed");
      return record.error;
    }

    // «Apagado»: the rows pass as they are, by the first way out.
    if (settings.off) {
      const out = names.find((n) => n !== OUT.error);
      if (out)
        record.out[out] = all.map((r, i) =>
          this.row(
            step.id,
            { json: r.json, label: r.label, fields: r.fields, origin: r.origin },
            i,
            r.path,
            all,
          ),
        );
      finish("done");
      return;
    }

    const executor = action
      ? step.type === CODE_TYPE
        ? CODE_EXECUTORS[action.mode]
        : step.type === AGENT_TYPE
          ? AGENT_EXECUTORS[action.mode]
          : isReaderType(step.type)
            ? READER_EXECUTOR
            : step.type === NOTIFY_TYPE
              ? NOTIFY_EXECUTORS[action.mode]
              : step.type === REPLY_TYPE
                ? REPLY_EXECUTOR
                : isBoniType(step.type)
                  ? BONI_EXECUTORS[action.mode]
                  : EXECUTORS[executorKey(step.type, action.key)]
      : undefined;
    const tries = 1 + Math.max(0, settings.retry.times);
    let stop: StepError | undefined;

    /** What «Si falla» does with a unit that failed its last try. */
    const give = (
      lastError: unknown,
      row: Row | null,
      index: number,
      units: readonly Row[],
      path: Label | null,
    ) => {
      const failure: StepError = {
        ...stepErrorOf(lastError, step),
        ...(row ? { row: index } : {}),
      };
      if (settings.onError === "stop") {
        stop = failure;
        return;
      }
      const failed = row ? [row] : units;
      record.failed += failed.length;
      record.error ??= failure;
      if (settings.onError === "errorOutput")
        for (const [k, r] of failed.entries()) {
          const at = row ? index : k;
          (record.out[OUT.error] as Row[]).push(
            this.row(
              step.id,
              {
                json: {
                  ...r.json,
                  [ERROR_FIELD]: {
                    message: failure.message,
                    ...(failure.rule ? { rule: failure.rule } : {}),
                  },
                },
                label: r.label,
                fields: {
                  ...(r.fields ?? {}),
                  [ERROR_FIELD]: { label: this.deps.own, derived: true },
                },
                origin: r.origin,
              },
              at,
              path,
              units,
            ),
          );
        }
    };

    // Its JavaScript, for every row, before any row is worked on (AU-38): in the box, never here (AU-160). What
    // stops all of it (no box, a limit of the step) fails the step as one unit; a read refused fails its rows.
    const js = javascriptOf(step);
    let evaluated: Prepared | undefined;
    // Only when some unit will run (AU-14): row by row with no row and no effect, nothing runs.
    const works = action?.mode === "all" || all.length > 0 || action?.effect !== "none";
    if (js && action && works) {
      let lastError: unknown;
      for (let t = 0; t < tries && !evaluated; t++) {
        if (t > 0) {
          record.retries++;
          await clock.sleep(settings.retry.waitMs);
        }
        try {
          evaluated = await this.prepare(step, js, action.mode, all, inputs);
        } catch (e) {
          lastError = e;
        }
      }
      if (!evaluated) {
        give(lastError, null, 0, all, this.path(step, this.scope(null), inputs));
        if (stop) {
          record.error = stop;
          finish("failed");
          return stop;
        }
        finish("done");
        return;
      }
      record.console = { lines: [...evaluated.run.console], dropped: evaluated.run.dropped };
      record.reads = [...evaluated.run.reads];
      record.uses = { clock: evaluated.run.clock, random: evaluated.run.random };
    }

    // «Preguntar» (AU-125, AU-203): its questions, made before any is asked; then its run waits for the answer.
    if (step.type === ASK_TYPE) {
      try {
        record.ask = await this.ask(step, all, (i) =>
          this.scope(action?.mode === "perRow" ? (all[i] ?? null) : null, evaluated?.at(i)),
        );
      } catch (e) {
        give(e, null, 0, all, this.path(step, this.scope(null), inputs));
        if (stop) {
          record.error = stop;
          finish("failed");
          return stop;
        }
        finish("done");
        return;
      }
      finish(record.ask.questions.length ? "waiting" : "done");
      return;
    }

    // A reader's calls to a model, for every row, before any row is worked on (AU-57): in batches, each call counted
    // first (AU-206). What it decided for a row is that row's, on every try: a unit does not call the model again.
    let read: ReaderOutcome[] | undefined;
    const decided = new Set<object>();
    if (isReaderType(step.type) && all.length) {
      record.ai = { calls: 0, models: [], ms: 0, cut: 0 };
      try {
        const got = await readRows({
          step,
          rows: all,
          scope: (row, i) => this.scope(row, evaluated?.at(i)),
          resolve: (v, scope) => resolve(v, scope),
          port: this.deps.ai,
          modelCall: () => this.modelCall(),
          retry: (n) => this.retryCall(n),
          now: () => clock.now(),
          model: modelLabelOf(this.input.automation.id, step.id),
          record: record.ai,
        });
        read = got.outcomes;
        for (const o of read) if ("fault" in o) decided.add(o.fault);
      } catch (e) {
        if (e instanceof StopRun) stop = stepErrorOf(e, step);
        else give(e, null, 0, all, this.path(step, this.scope(null), inputs));
        if (stop) {
          record.error = stop;
          finish("failed");
          return stop;
        }
        finish("done");
        return;
      }
    }

    // An «Agente»: its reads for every unit, through its connections and the policy (AU-51), and what each unit that
    // worked asked to write, decided together when the units are done (AU-198).
    const agent =
      step.type === AGENT_TYPE && action ? this.agentState(step, record, inputs) : undefined;

    /**
     * One unit: one row, or all of them. Tries it, and on a last failure does what «Si falla» says. True when it
     * worked: what its «Código» asked to save is part of the step's change.
     */
    const unit = async (
      row: Row | null,
      index: number,
      units: readonly Row[],
      scope: Scope,
    ): Promise<boolean> => {
      const path = this.path(step, scope, row ? { [inputsOf(step)[0] as string]: [row] } : inputs);
      let lastError: unknown;
      for (let t = 0; t < tries; t++) {
        if (t > 0) {
          record.retries++;
          await clock.sleep(settings.retry.waitMs);
        }
        const asked: Asked[] = [];
        const pending: Gathered[] = [];
        try {
          if (!action || !executor) throw new Error(`no executor for ${step.type}`);
          const ctx = this.context(step, action.key, scope, this.gate(step, path, asked));
          if (evaluated) ctx.code = evaluated.rows;
          if (agent)
            ctx.agent = (r, rows) =>
              this.agentUnit(step, { row: r, index, rows, scope, state: agent, pending, record });
          if (step.type === NOTIFY_TYPE) ctx.notify = (t) => this.notify(step, record, t);
          if (isBoniType(step.type) && this.deps.boni) {
            const port = this.deps.boni;
            ctx.boni = (call) =>
              port.run({
                ...call,
                automation: this.input.automation.id,
                step: step.id,
                type: step.type,
                test: this.input.test,
              });
          }
          if (step.type === REPLY_TYPE)
            ctx.reply = (t) => {
              this.reply = { step: step.id, text: asPlainText(t.value), label: t.label };
            };
          if (read) {
            const outcomes = read;
            ctx.read = (at) => outcomes[at] as ReaderOutcome;
          }
          const out =
            executor.mode === "perRow"
              ? await executor.run(ctx, row, index)
              : await executor.run(ctx, inputs);
          for (const name of Object.keys(out))
            if (!names.includes(name) || name === OUT.error)
              throw new Error(`no output named ${name}`);
          for (const [name, rows] of Object.entries(out))
            for (const r of rows) {
              const parent = row
                ? index
                : action.pairs && action.mode === "all"
                  ? (r.from ?? null)
                  : null;
              (record.out[name] as Row[]).push(this.row(step.id, r, parent, path, units));
            }
          record.asked += asked.length;
          this.asked.push(...asked);
          agent?.writes.set(index, pending);
          return true;
        } catch (e) {
          // A unit that failed saves nothing of what it asked to write: its lines say so (AU-54).
          for (const g of pending) g.line.state = "failed";
          // «Parar con error» ends the run there, with no retry and no «Si falla» (AU-16).
          if (e instanceof StopRun) {
            stop = stepErrorOf(e, step);
            return false;
          }
          lastError = e;
          // What its JavaScript gave for this row is decided once for the step: trying it again gives the same.
          if (evaluated?.decided.has(e as object) || decided.has(e as object)) break;
        }
      }
      give(lastError, row, index, units, path);
      return false;
    };

    // The units that worked: what their «Código» asked to save is the step's change (AU-174).
    const worked: number[] = [];
    if (action?.mode === "all") {
      if (await unit(null, 0, all, this.scope(null, evaluated?.at(0)))) worked.push(0);
    } else if (all.length)
      for (const [i, row] of all.entries()) {
        if (await unit(row, i, all, this.scope(row, evaluated?.at(i)))) worked.push(i);
        if (stop) break;
      }
    // Row by row with an empty list: an action that reads or writes runs once with no row (AU-14).
    else if (action && action.effect !== "none")
      await unit(null, 0, all, this.scope(null, evaluated?.at(0)));

    // The notices past the fifth, as one that groups them (AU-201).
    if (!stop && this.grouped.get(step.id))
      try {
        await this.notify(step, record, null);
      } catch (e) {
        give(e, null, 0, all, this.path(step, this.scope(null), inputs));
      }

    // What its «Código» or its «Agente» asked to save, decided for the whole step at once, when the step has not
    // stopped (AU-174, AU-198).
    const code = evaluated && js?.kind === "code" ? evaluated : undefined;
    const how: SaveHow | undefined = agent
      ? agent.how
      : code && js
        ? this.codeHow(step, js.sources[0] ?? "")
        : undefined;
    const gathered = agent ? worked.flatMap((i) => agent.writes.get(i) ?? []) : undefined;
    if (!stop && how && (code || gathered)) {
      const asked: readonly Asked_[] = gathered ?? worked.flatMap((i) => code?.writes(i) ?? []);
      try {
        // All of them or none (AU-174): they must fit in the run's «rows written» before any is asked (AU-17).
        this.reserve(asked.length);
      } catch (e) {
        stop = stepErrorOf(e, step);
      }
      if (asked.length && !stop) {
        const whole = action?.mode === "all";
        const units = whole ? all : worked.map((i) => all[i] as Row);
        const path = this.path(
          step,
          this.scope(null),
          whole ? inputs : { [inputsOf(step)[0] as string]: units },
        );
        let lastError: unknown;
        let saved: StepWrites | undefined;
        for (let t = 0; t < tries && !saved; t++) {
          if (t > 0) {
            record.retries++;
            await clock.sleep(settings.retry.waitMs);
          }
          try {
            saved = await this.save(step, asked, path, how);
          } catch (e) {
            lastError = e;
            // What the code asked and what the policy said are the same on every try: only the store's may change.
            if (e instanceof CodeFault || e instanceof Denied) break;
          }
        }
        for (const g of gathered ?? []) g.line.state = saved ? saved.kind : "failed";
        if (saved) {
          this.written += asked.length;
          record.writes = saved;
          if (saved.kind === "asked") {
            record.asked += saved.asked.length;
            this.asked.push(...saved.asked);
          }
        } else {
          // Nothing of the step was saved: the rows that worked fail with it, and «Si falla» decides (AU-16).
          for (const name of Object.keys(record.out)) if (name !== OUT.error) record.out[name] = [];
          give(lastError, null, 0, units, path);
        }
      }
    }

    if (stop) {
      record.error = stop;
      finish("failed");
      return stop;
    }
    finish("done");
    return;
  }

  /**
   * Saves what a «Código» asked (writes.ts): held to the analysis of the code as saved and to its connections, as
   * saved, never to what the box said; every change judged by the policy before any is written, as the «Colección»
   * action that makes it; and all of them in one transaction, or none (AU-173 to AU-177).
   */
  async save(
    step: Step,
    asked: readonly Asked_[],
    control: Label | null,
    how: SaveHow,
  ): Promise<StepWrites> {
    const { collections, policy, clock, dates } = this.deps;
    const { collectionNamed } = how;
    const gate = guard(policy, collections, {
      automation: { id: this.input.automation.id, version: this.input.automation.version },
      step: step.id,
      type: step.type,
      action: actionOf(step)?.key ?? "",
      effect: "write",
      destroys: false,
      control,
      test: this.input.test,
      own: this.deps.own,
    });
    // The saved row, read with no other question to the policy: part of the write it is asked about (AU-173).
    const writer: WriteGate = {
      shape: (c) => collections.shape(c),
      get: (c, id) => collections.get(c, id),
      decideAll: (changes) => gate.decideAll(changes),
      writeAll: (changes) => gate.writeAll(changes),
    };
    // «Como mucho» (AU-196) counts by step and run, every unit together: what this step asked before, kept only once
    // a change of it was saved, tested or proposed (one that failed saved nothing).
    const tally = (collection: string, action: string) =>
      `${step.id}\u0000${collection}\u0000${action}`;
    const out = await applyWrites(
      {
        step: step.id,
        requests: asked.map((a) => a.request),
        labels: asked.map((a) => a.label),
        grants: how.grants,
        connections: how.connections,
        collectionNamed,
        ...(asked.some((a) => a.fixed) ? { fixed: asked.map((a) => a.fixed) } : {}),
        today: dates.day(this.started, clock.zone),
        test: this.input.test,
        own: this.deps.own,
        before: (collection, action) => this.actionRows.get(tally(collection, action)) ?? 0,
      },
      writer,
    );
    for (const { request } of asked) {
      const key = collectionNamed(request.collection);
      if (key === undefined) continue;
      const k = tally(key, request.action);
      this.actionRows.set(k, (this.actionRows.get(k) ?? 0) + 1);
    }
    return out;
  }

  /**
   * A step's JavaScript, evaluated in the box for all its rows before any of them is worked on (AU-38), with the run's
   * instant and the step's seed (AU-34) and only what the code cites (AU-163). Its reads go through a gate of the
   * policy that judges them as reads of this step (AU-161). It rejects for what stops the whole step: no box, a cited
   * step that has not run, a limit of the step. A read the policy refuses fails only the units that asked for it.
   */
  /**
   * The steps a step's JavaScript cites, with their rows, and the row each input row comes from where it asks for
   * `.item` (AU-13).
   */
  citedSteps(
    sources: readonly string[],
    kind: "code" | "expression",
    input: readonly Row[],
    perRow: boolean,
  ): EvaluateInput["steps"] {
    const cited = new Map<string, boolean>();
    for (const source of sources)
      for (const c of readCode(source, kind).steps)
        cited.set(c.name, (cited.get(c.name) ?? false) || c.item);
    const steps: EvaluateInput["steps"] = {};
    for (const [name, item] of cited) {
      const cite: Citation = { step: name, pick: "first", path: [] };
      const other = this.byName.get(name);
      if (!other) throw new CiteError("unknownStep", cite);
      const record = this.records[other.id];
      if (record?.state !== "done") throw new CiteError("notRun", cite);
      const rows = outputsOf(other)
        .filter((o) => o !== OUT.error)
        .flatMap((o) => record.out[o] ?? []);
      const at = new Map(rows.map((r, i) => [r, i]));
      steps[name] = {
        rows,
        ...(item && perRow ? { item: input.map((r) => this.pairIn(r, other.id, at)) } : {}),
      };
    }
    return steps;
  }

  async prepare(
    step: Step,
    js: Javascript,
    mode: CodeMode,
    all: readonly Row[],
    inputs: Record<string, Row[]>,
  ): Promise<Prepared> {
    const { box, clock, dates, locale } = this.deps;
    if (!box)
      throw new CodeFault("JavaScript runs only in the box, and there is none", {
        code: "code.unavailable",
      });
    this.boxed = true;
    const code = js.kind === "code";
    // Expressions of a step that works with all the rows have no row of their own: one evaluation, of no row.
    const input = code || mode === "perRow" ? all : [];
    const perRow = !code || mode === "perRow";

    const steps = this.citedSteps(js.sources, code ? "code" : "expression", input, perRow);

    const action = actionOf(step);
    const gate = guard(this.deps.policy, this.deps.collections, {
      automation: { id: this.input.automation.id, version: this.input.automation.version },
      step: step.id,
      type: step.type,
      action: action?.key ?? "",
      effect: "read",
      destroys: false,
      control: this.path(step, this.scope(null), inputs),
      test: this.input.test,
      own: this.deps.own,
    });
    const run = await evaluate(
      {
        kind: js.kind,
        sources: js.sources,
        mode: code ? mode : "perRow",
        input,
        steps,
        literal: this.deps.own,
        connections: code ? (step.connections ?? []) : [],
        collectionNamed: (name) => this.deps.collectionNamed?.(name, step.id),
        now: this.started,
        zone: clock.zone,
        locale,
        today: dates.day(this.started, clock.zone),
        seed: seedOf(this.seed, step.id),
        run: { test: this.input.test, startedBy: this.input.startedBy ?? "user" },
      },
      box,
      gate,
    );

    // Expressions never save (AU-184): an answer that asks to is not the box's to give, and fails the whole step.
    if (!code)
      for (const e of run.evaluations)
        if (e.state === "done" && e.writes?.length) {
          const w = e.writes[0] as WriteRequest;
          throw new CodeFault("an expression asked to save", {
            code: "code.write.unseen",
            detail: {
              collection: String(w.collection),
              action: String(w.action),
              where: "expression",
            },
          });
        }

    // One evaluation's failure, as the failure of the unit that reads it; the code's message only in `why`.
    const decided = new WeakSet<object>();
    const faultOf = (failure: CodeFailure, param: string | undefined) => {
      const f = new CodeFault(`the step's JavaScript failed (${failure.code})`, {
        ...failure,
        ...(param ? { param } : {}),
      });
      decided.add(f);
      return f;
    };
    // A read the policy refused: the unit fails with `policy.denied` or `policy.waits` and the policy's rule, never
    // with its reason, which may say what the code could not read (Juan, 2026-11-16).
    const deniedOf = (d: Denied) => {
      const code = d.waits ? "policy.waits" : "policy.denied";
      const f = new Denied(
        d.rule,
        `a read of the step's JavaScript was refused (${code})`,
        d.waits,
      );
      decided.add(f);
      return f;
    };
    const failures = run.evaluations.map((e) =>
      e.state === "failed"
        ? faultOf(e.failure, js.params[e.source])
        : e.state === "denied"
          ? deniedOf(e.denied)
          : undefined,
    );

    // What a «Código» gave, as rows (AU-30): each carries the label of everything its evaluation received (AU-169).
    const made: (readonly RowOut[] | CodeFault | Denied)[] = [];
    if (code) {
      let total = 0;
      for (const [i, e] of run.evaluations.entries()) {
        if (e.state !== "done") {
          made.push(failures[i] as CodeFault | Denied);
          continue;
        }
        const label = run.labels[i] as Label;
        try {
          const rows = rowsOf(e.values[0] ?? null).map((json) => ({
            json,
            label,
            fields: Object.fromEntries(Object.keys(json).map((k) => [k, { label, derived: true }])),
          }));
          total += rows.length;
          made.push(rows);
        } catch (f) {
          made.push(faultOf((f as CodeFault).why, CODE_PARAMS.source));
        }
      }
      if (total > CODE_LIMITS.outputRows) {
        const f = limitFault("outputRows", CODE_LIMITS.outputRows, total);
        throw new CodeFault(f.message, { ...f.why, param: CODE_PARAMS.source });
      }
    }

    return {
      run,
      decided,
      at: (i) =>
        code
          ? undefined
          : (source) => {
              const k = js.sources.indexOf(source);
              const e = run.evaluations[i];
              if (k < 0 || !e)
                throw new CodeFault("this JavaScript was not evaluated", {
                  code: "code.unavailable",
                });
              if (e.state !== "done") throw failures[i] as CodeFault | Denied;
              return { value: e.values[k] ?? null, label: run.labels[i] as Label, derived: true };
            },
      rows: (i) => {
        const m = made[i];
        if (!m)
          throw new CodeFault("this «Código» was not evaluated", { code: "code.unavailable" });
        if (m instanceof CodeFault || m instanceof Denied) throw m;
        return m;
      },
      writes: (i) => {
        const e = run.evaluations[i];
        if (!code || e?.state !== "done") return [];
        const label = run.labels[i] as Label;
        return (e.writes ?? []).map((request) => ({
          request: perRow ? { ...request, row: i } : request,
          label,
        }));
      },
    };
  }

  /** The place in `at` of the row of step `id` that `row` comes from, or null when it comes from none (AU-13). */
  pairIn(row: Row, id: string, at: ReadonlyMap<Row, number>): number | null {
    let r: Row | undefined = row;
    while (r) {
      const made = this.made.get(r);
      if (!made) return null;
      if (made.step === id) return at.get(r) ?? null;
      r = r.parent === null ? undefined : made.inputs[r.parent];
    }
    return null;
  }

  /** Every row that reaches a step, input by input in the order of `arrowsInto`, as `step` puts them together. */
  arriving(step: Step): Row[] {
    const firstOnly = step.settings?.firstRowOnly ?? SETTINGS_DEFAULTS.firstRowOnly;
    return inputsOf(step).flatMap((name) => {
      const rows = arrowsInto(this.input.automation, this.order, step.id, name).flatMap(
        (a) => this.records[a.from.step]?.out[a.from.output] ?? [],
      );
      return firstOnly ? rows.slice(0, 1) : rows;
    });
  }

  /** A row out, with its parent and path, remembered as this step's. */
  row(
    step: string,
    r: RowOut,
    parent: number | null,
    path: Label | null,
    inputs: readonly Row[],
  ): Row {
    const row: Row = {
      json: r.json,
      label: r.label,
      ...(r.fields && Object.keys(r.fields).length ? { fields: r.fields } : {}),
      ...(r.origin ? { origin: r.origin } : {}),
      path,
      parent,
    };
    this.made.set(row, { step, inputs });
    return row;
  }

  /**
   * The label of the path of what a unit gives (AU-164): the paths of the rows it works with, the labels of what
   * the parameters that change the rows resolved to (fixed values add nothing), and the labels of the fields they
   * name in those rows (what a condition tested, what decided an order or a duplicate). Null when nothing applies.
   */
  path(step: Step, scope: Scope, by: Record<string, readonly Row[]>): Label | null {
    const labels: Label[] = [];
    for (const rows of Object.values(by)) for (const r of rows) if (r.path) labels.push(r.path);
    for (const p of paramsOf(step)) {
      if (!p.changesRows) continue;
      const v = paramValue(step, p);
      if (hasExpr(v))
        try {
          labels.push(resolve(v as ParamValue, scope).label);
        } catch {
          // A citation that fails fails the step itself, when the executor resolves it.
        }
      for (const f of namedFields(p, v))
        for (const r of by[f.input] ?? []) labels.push(fieldLabel(r, f.field));
    }
    return labels.length ? joinAll(labels, this.deps.own) : null;
  }

  /** What a «Código»'s writes are held to: the analysis of its code as saved, its connections, its names. */
  codeHow(step: Step, source: string): SaveHow {
    const collectionNamed = (name: string) => this.deps.collectionNamed?.(name, step.id);
    return {
      grants: grantsOf(readWrites(source, "code"), collectionNamed),
      connections: step.connections ?? [],
      collectionNamed,
    };
  }

  /**
   * An «Agente»'s step-wide state (AU-51, AU-198): one reader through its connections and the policy, judged as the
   * step reading (`effect: read`); the rows it read in this run; and how its writes are held: every action of
   * its connections, by the collection's key (their own check refuses one in «No»), with no field the AI does not decide (AU-52).
   */
  agentState(step: Step, record: StepRecord, inputs: Record<string, Row[]>): AgentState {
    const { collections, policy, clock, dates } = this.deps;
    const connections = step.connections ?? [];
    const named = (name: string) =>
      connections.some((c) => c.collection === name) ? name : undefined;
    // The model names a collection by its key; its code and its code tools, by the name written in `$col('…')`.
    const either = (name: string) => named(name) ?? this.deps.collectionNamed?.(name, step.id);
    const today = dates.day(this.started, clock.zone);
    const gate = guard(policy, collections, {
      automation: { id: this.input.automation.id, version: this.input.automation.version },
      step: step.id,
      type: step.type,
      action: actionOf(step)?.key ?? "",
      effect: "read",
      destroys: false,
      control: this.path(step, this.scope(null), inputs),
      test: this.input.test,
      own: this.deps.own,
    });
    const reader = new Reader({ connections, collectionNamed: either, today }, gate);
    const how: SaveHow = {
      // Every action of every connection: an action in «No» is then refused by the connection's own check
      // (`code.write.notAllowed`, told to the model as `action-off`), not as one no analysis saw.
      grants: connections.flatMap((c) =>
        WRITE_ACTIONS.map((action) => ({ collection: c.collection, action })),
      ),
      connections: agentConnections(connections),
      collectionNamed: named,
    };
    const writes = new Map<number, Gathered[]>();
    record.ai = { calls: 0, models: [], ms: 0, cut: 0 };
    record.agent = { units: [] };
    record.reads = reader.records;
    // A write is checked as it is asked, with what the step's units that worked asked before: against the connection
    // as saved and the collection, deciding nothing and writing nothing (applyWrites as a test, with no policy).
    const dry: WriteGate = {
      shape: (c) => collections.shape(c),
      get: (c, id) => collections.get(c, id),
      decideAll: async () => "allow",
      writeAll: async (changes) =>
        changes.map((c) => ({
          kind: "tested" as const,
          row: { json: { ...(c.row ?? {}) }, label: this.deps.own },
        })),
    };
    const check = async (more: readonly Gathered[]) => {
      const all = [...[...writes.values()].flat(), ...more];
      await applyWrites(
        {
          step: step.id,
          requests: all.map((g) => g.request),
          labels: all.map((g) => g.label),
          grants: how.grants,
          connections: how.connections,
          collectionNamed: named,
          today,
          test: true,
          own: this.deps.own,
          fixed: all.map((g) => g.fixed),
          before: (collection, action) =>
            this.actionRows.get(`${step.id}\u0000${collection}\u0000${action}`) ?? 0,
        },
        dry,
      );
    };
    return { reader, read: new Set(), writes, how, check, record: record.agent };
  }

  /**
   * One unit of work of an «Agente» (AU-55, AU-197, AU-198): what its model receives, a closed list built here from
   * the version as saved; its rounds, through the port; and its row out with the answer. Its writes are gathered in
   * `pending`, kept only when the unit worked. Throws what fails the unit (`agent.*`, `ai.*`, a policy's no that is
   * not its connection's) or stops the run (`LimitPassed`).
   */
  async agentUnit(
    step: Step,
    u: {
      row: Row | null;
      index: number;
      rows: readonly Row[];
      scope: Scope;
      state: AgentState;
      pending: Gathered[];
      record: StepRecord;
    },
  ): Promise<RowOut[]> {
    const port = this.deps.ai;
    if (!port?.agent) throw new AiFault("there is no model to call", { code: "ai.unavailable" });
    const P = AGENT_PARAMS;
    const { clock, dates, collections } = this.deps;
    const ai = u.record.ai as AiRecord;
    const written = modelLabelOf(this.input.automation.id, step.id);
    const instructions = this.instructionsOf(step, u.scope);
    if (!instructions.some((p) => typeof p.value.json === "string" && p.value.json.trim()))
      throw new AiFault("«Instrucciones» is empty", {
        code: "ai.params",
        param: P.instructions,
        detail: { why: "instructions" },
      });
    const byCode = step.params[P.reads] === "code";
    const codeTools = codeToolsOf(step.params[P.tools]);
    if (!codeTools)
      throw new AiFault("«Herramientas de código» is not a list of tools", {
        code: "ai.params",
        param: P.tools,
        detail: { why: "tools" },
      });
    let answer: AgentCall["answer"] = { kind: "text" };
    if (step.params[P.answer] === "fields") {
      const fields = fieldsOf((step.params[P.fields] ?? null) as Cell);
      if (!fields)
        throw new AiFault("«Campos» is not a list of fields", {
          code: "ai.params",
          param: P.fields,
          detail: { why: "fields" },
        });
      answer = { kind: "fields", fields };
    }
    const max = step.params[P.maxRounds];
    const model = step.params[P.model];
    const unit: AgentUnit = {
      ...(u.row ? { row: u.index } : {}),
      rounds: 0,
      lines: [],
      more: 0,
      seen: [],
    };
    u.state.record.units.push(unit);
    // «Las hace este código» (AU-51): its code reads before the first round, and what it gives is the model's rows.
    let rows: AgentValue[];
    if (byCode) {
      rows = await this.agentCode(step, u.rows, u.state);
      addLine(unit, { op: "code", rows: rows.length });
    } else
      rows = u.rows.map((r) => ({
        json: r.json,
        label: r.label,
        ...(r.fields ? { fields: r.fields } : {}),
      }));
    for (const line of hiddenLines(instructions, rows)) addLine(unit, line);
    const tools = new AgentTools({
      step,
      shape: (c) => collections.shape(c),
      reader: u.state.reader,
      read: u.state.read,
      fixed: (collection, action) => this.fixedOf(step, collection, action, u.scope),
      check: (w) => u.state.check(w),
      gathered: u.pending,
      written,
      unit,
      tools: codeTools,
      runTool: (tool, inputs, label) => this.agentTool(step, tool, inputs, label, u.state),
    });
    const reply = await port.agent({
      use: "agent",
      model: typeof model === "string" && model ? model : null,
      instructions: instructions.map((p) => p.value),
      rows,
      connections: agentSchema(step.connections ?? [], (c) => collections.shape(c)),
      answer,
      reads: !byCode,
      ...(codeTools.length
        ? { codeTools: codeTools.map((t) => ({ name: t.name, inputs: t.inputs })) }
        : {}),
      maxRounds:
        typeof max === "number" && Number.isInteger(max)
          ? Math.min(Math.max(max, 1), AGENT_ROUNDS.max)
          : AGENT_ROUNDS.born,
      today: dates.day(this.started, clock.zone),
      zone: clock.zone,
      language: this.deps.locale,
      written,
      modelCall: () => {
        this.modelCall();
        ai.calls++;
      },
      retries: retriesOf(step),
      retry: async (n) => {
        await this.retryCall(n);
        ai.calls++;
        ai.retried = (ai.retried ?? 0) + 1;
      },
      called: (name, ms) => {
        ai.ms += ms;
        if (name && !ai.models.includes(name)) ai.models.push(name);
      },
      now: () => clock.now(),
      tool: (name, args) => tools.call(name, args),
    });
    unit.rounds = reply.rounds;
    unit.seen = [...reply.seen];
    if ("refused" in reply)
      throw new AiFault(`the model was not called: ${reply.refused}`, {
        code: "ai.refused",
        detail: { why: reply.refused },
      });
    if ("fault" in reply)
      throw new AiFault(`«${step.name}» ended with ${reply.fault}`, {
        code: reply.fault,
        detail: { errors: reply.errors.length },
      });
    // Its row out (AU-53): the answer's fields, each with its label (the model's, and what it cited), derived.
    const out: RowOut = u.row ? copy(u.row) : { json: {}, label: written };
    for (const [key, v] of Object.entries(reply.answer))
      setField(out, key, { value: v.json, label: v.label, derived: true });
    return [out];
  }

  /**
   * «Las hace este código» (AU-51): the step's code over the unit's rows, once, in the box, through the step's reader
   * (its connections, the policy and its limits). What it gives is what the model receives as rows, each with the
   * label of everything the code received and read; a list is one row per item.
   */
  async agentCode(step: Step, input: readonly Row[], state: AgentState): Promise<AgentValue[]> {
    const source = step.params[AGENT_PARAMS.code];
    if (typeof source !== "string" || !source.trim())
      throw new AiFault("«Las hace este código» has no code", {
        code: "ai.params",
        param: AGENT_PARAMS.code,
        detail: { why: "code" },
      });
    const got = await this.agentBox(step, source, "all", input, state);
    if ("failure" in got)
      throw new CodeFault(`the step's code failed (${got.failure.code})`, {
        ...got.failure,
        param: AGENT_PARAMS.code,
      });
    if ("denied" in got) throw this.agentDenied(got.denied, { param: AGENT_PARAMS.code });
    const values = Array.isArray(got.value) ? got.value : [got.value];
    return values.map((json) => ({ json, label: got.label }));
  }

  /**
   * One call of a «Herramienta de código» (AU-58): its code over one row, its inputs (`$json`), in the box through the
   * step's reader. A failure is told to the model (`code-failed`); a no of the policy fails the unit, P29's too, as
   * in a «Código»: the call was made by code, not by the model (AU-198, AU-161).
   */
  async agentTool(
    step: Step,
    tool: AgentCodeTool,
    inputs: Record<string, Cell>,
    label: Label,
    state: AgentState,
  ): Promise<{ rows: AgentValue[] } | { value: AgentValue } | { refused: string }> {
    const got = await this.agentBox(
      step,
      tool.code,
      "perRow",
      [{ json: inputs, label, path: null, parent: null }],
      state,
    );
    if ("failure" in got) return { refused: "code-failed" };
    if ("denied" in got) throw this.agentDenied(got.denied, { tool: tool.name });
    if (Array.isArray(got.value))
      return { rows: got.value.map((json) => ({ json, label: got.label })) };
    return { value: { json: got.value, label: got.label } };
  }

  /**
   * An «Agente»'s own code in the box: one evaluation, through the step's reader, so the code, its tools and the
   * model's reads count against the same limits. It reads only: a write it asks for fails it (`agent.reads.write` is
   * the validation's, this is the run's guard).
   */
  async agentBox(
    step: Step,
    source: string,
    mode: CodeMode,
    input: readonly Row[],
    state: AgentState,
  ): Promise<{ value: Cell; label: Label } | { failure: CodeFailure } | { denied: Denied }> {
    const { box, clock, dates, locale } = this.deps;
    if (!box)
      throw new CodeFault("JavaScript runs only in the box, and there is none", {
        code: "code.unavailable",
      });
    this.boxed = true;
    const run = await evaluate(
      {
        kind: "code",
        sources: [source],
        mode,
        input,
        steps: this.citedSteps([source], "code", input, false),
        literal: this.deps.own,
        connections: step.connections ?? [],
        collectionNamed: state.reader.input.collectionNamed,
        now: this.started,
        zone: clock.zone,
        locale,
        today: dates.day(this.started, clock.zone),
        seed: seedOf(this.seed, step.id),
        run: { test: this.input.test, startedBy: this.input.startedBy ?? "user" },
        reader: state.reader,
      },
      box,
      state.reader.gate,
    );
    const e = run.evaluations[0];
    const label = run.labels[0] ?? this.deps.own;
    if (!e) return { value: null, label };
    if (e.state === "failed") return { failure: e.failure };
    if (e.state === "denied") return { denied: e.denied };
    const w = e.writes?.[0] as WriteRequest | undefined;
    if (w)
      return {
        failure: {
          code: "code.write.unseen",
          detail: { collection: String(w.collection), action: String(w.action), where: "agent" },
        },
      };
    return { value: e.values[0] ?? null, label };
  }

  /**
   * The policy's no to an «Agente»'s own code: a collection made private gives `ai.private` (AU-166); any other, the
   * rule and `policy.denied` or `policy.waits`, never its reason (Juan, 2026-11-16).
   */
  agentDenied(d: Denied, where: Record<string, string>): Error {
    if (d.rule === "P29")
      try {
        agentDeniedOf(d, where);
      } catch (e) {
        if (e instanceof AiFault) return e;
      }
    return new Denied(
      d.rule,
      `a read of the step's code was refused (${d.waits ? "policy.waits" : "policy.denied"})`,
      d.waits,
    );
  }

  /**
   * «Instrucciones» resolved for a unit (AU-197): Juan's text with the automation's label, and each citation apart with
   * its own, so a value a planner may not see goes as a handle and the rest is read. With JavaScript in it, the whole
   * text is one value, with the label of everything it used.
   */
  instructionsOf(step: Step, scope: Scope): { value: AgentValue; field: string }[] {
    const v = step.params[AGENT_PARAMS.instructions];
    const own = this.deps.own;
    if (typeof v === "string") return [{ value: { json: v, label: own }, field: "" }];
    if (!isExpr(v)) return [];
    const parts = parseExpression(v.expr);
    if (parts.some((p) => p.kind === "code")) {
      const got = resolve(v, scope);
      return [{ value: { json: got.value, label: got.label }, field: "" }];
    }
    return parts.map((p) => {
      if (p.kind !== "cite")
        return { value: { json: p.kind === "text" ? p.text : "", label: own }, field: "" };
      const got = resolve({ expr: printExpression([p]) }, scope);
      return {
        value: { json: got.value, label: got.label },
        field: String(p.cite.path[0] ?? p.cite.step ?? ""),
      };
    });
  }

  /**
   * The fixed values of an «Agente»'s connection that are expressions, for create or modify (AU-52, decision 18 of
   * §10), resolved for a unit. They are read from the step as saved: never from the model, a request or the box.
   */
  fixedOf(
    step: Step,
    collection: string,
    action: "create" | "update",
    scope: Scope,
  ): Record<string, Labeled<Cell>> | undefined {
    const cell = step.connections?.find((c) => c.collection === collection)?.[action];
    const fixed = cell ? cell.fixed : undefined;
    if (!fixed) return undefined;
    const out: Record<string, Labeled<Cell>> = {};
    for (const [field, v] of Object.entries(fixed)) if (isExpr(v)) out[field] = resolve(v, scope);
    return Object.keys(out).length ? out : undefined;
  }

  context(step: Step, action: string, scope: Scope, gate: Gate): StepContext {
    const { dates, clock, locale } = this.deps;
    return {
      step,
      action,
      gate,
      dates,
      zone: clock.zone,
      locale,
      now: clock.now(),
      value: (p) => resolve(p, scope),
      scope,
      reserve: (n) => this.reserve(n),
      modelCall: () => this.modelCall(),
    };
  }

  /** The gate of one unit: closed for a step with no effect; else the policy's, noting what waits for Juan. */
  gate(step: Step, control: Label | null, asked: Asked[]): Gate {
    const action = actionOf(step);
    if (!action || action.effect === "none") return CLOSED;
    const g = guard(this.deps.policy, this.deps.collections, {
      automation: { id: this.input.automation.id, version: this.input.automation.version },
      step: step.id,
      type: step.type,
      action: action.key,
      effect: action.effect,
      destroys: action.destroys,
      control,
      test: this.input.test,
      own: this.deps.own,
    });
    // The first door of a «Colección» write (AU-186, AU-187): its «Permiso». «Preguntar» asks for its change in any
    // run, a test or one started by hand too, after the policy (the second door) was asked and did not refuse it.
    const cellAsks =
      step.type === "collection" && action.effect === "write" && permissionOf(step) === "ask";
    const run = this;
    /** «Permiso: Preguntar»: the policy is asked for each (it may refuse), and every one waits for Juan. */
    async function askAll(changes: readonly ChangeWith[]): Promise<WriteResult[]> {
      const decided = await g.decideAll(changes);
      const byPolicy = new Map((decided === "allow" ? [] : decided).map((a) => [a.change, a]));
      return changes.map(({ change, values }) => {
        const policy = byPolicy.get(change);
        const a: Asked = policy ?? {
          step: step.id,
          kind: change.kind === "trash" ? "confirm" : "propose",
          rule: CONNECTION_ASKS,
          change,
          values,
        };
        asked.push(a);
        return { kind: "asked", asked: a };
      });
    }
    const unit: Gate = {
      shape: (c) => g.shape(c),
      find: (q, v, f) => g.find(q, v, f),
      get: (c, id) => g.get(c, id),
      aggregate: (q, v, f) => g.aggregate(q, v, f),
      async write(change, values) {
        // Every change counts against «rows written», saved, tested or proposed, before the policy is asked (AU-17).
        run.reserve(1);
        run.written++;
        if (cellAsks) return askAll([{ change, values }]).then((r) => r[0] as WriteResult);
        const r = await g.write(change, values);
        if (r.kind === "asked") asked.push(r.asked);
        return r;
      },
      // An executor's changes for one unit (task 137): the policy is asked for each, one by one, as `write` asks it,
      // before any is written; then the ones it allows are written in one transaction of the store, all or nothing,
      // and the ones it would ask Juan about come back `asked`, in order. It decides itself, so an executor has no
      // way to write what was not decided. A change whose kind is not the step's action («Crear o modificar» makes a
      // `create` or an `update`) goes through `write`: `decideAll` tells the policy the change's kind as the action.
      async writeAll(changes) {
        if (changes.some((c) => c.change.kind !== action.key) || changes.length < 2) {
          const out: WriteResult[] = [];
          for (const { change, values } of changes) out.push(await unit.write(change, values));
          return out;
        }
        // All of them count against «rows written» before any is asked, as each would one by one (AU-17).
        run.reserve(changes.length);
        run.written += changes.length;
        // The same call `write` makes: no `row` and no `written`, which only an «Agente»'s writes carry.
        const plain = changes.map(({ change, values }) => ({ change, values }));
        if (cellAsks) return askAll(plain);
        const decided = await g.decideAll(plain);
        const byPolicy = new Map((decided === "allow" ? [] : decided).map((a) => [a.change, a]));
        for (const a of byPolicy.values()) asked.push(a);
        const saved = await g.writeAll(plain.filter((c) => !byPolicy.has(c.change)));
        let next = 0;
        return plain.map((c): WriteResult => {
          const a = byPolicy.get(c.change);
          return a ? { kind: "asked", asked: a } : (saved[next++] as WriteResult);
        });
      },
      // Deciding alone is the «Código»'s (writes.ts), through a gate of its own: never an executor's.
      decideAll: closed,
    };
    return unit;
  }

  /** What expressions are resolved against for one unit (AU-13), with what its JavaScript gave, if it has any. */
  scope(current: Row | null, code?: Scope["code"]): Scope {
    return {
      current,
      literal: this.deps.own,
      ...(code ? { code } : {}),
      row: (name, pick) => {
        const cite: Citation = { step: name, pick, path: [] };
        const step = this.byName.get(name);
        if (!step) throw new CiteError("unknownStep", cite);
        const record = this.records[step.id];
        if (record?.state !== "done") throw new CiteError("notRun", cite);
        if (pick !== "item") {
          const rows = outputsOf(step)
            .filter((o) => o !== OUT.error)
            .flatMap((o) => record.out[o] ?? []);
          const row = pick === "first" ? rows[0] : rows[rows.length - 1];
          if (!row) throw new CiteError("noRows", cite);
          return row;
        }
        if (!current) throw new CiteError("noCurrentRow", cite);
        // Back through the rows each one comes from, until one of that step's.
        let row: Row | undefined = current;
        while (row) {
          const made = this.made.get(row);
          if (!made) break;
          if (made.step === step.id) return row;
          row = row.parent === null ? undefined : made.inputs[row.parent];
        }
        throw new CiteError("noPair", cite);
      },
    };
  }
}

const blank = (): StepRecord => ({
  state: "queued",
  in: {},
  out: {},
  ms: 0,
  retries: 0,
  failed: 0,
  asked: 0,
});

// ---------------------------------------------------------------- the steps

/** What a step's executor works with. It has no other way out: no store, no clock but this one, no policy. */
export interface StepContext {
  step: Step;
  /** The action's key (`actionOf`). */
  action: string;
  /** The collections behind the policy, for this step and this row (AU-168). */
  gate: Gate;
  dates: Dates;
  zone: string;
  locale: string;
  /** Epoch ms: the same instant for every row of the step. */
  now: number;
  /**
   * A parameter's value for the row in hand, with its label (`resolve` with the scope the engine built). The label
   * of the path does not depend on it: the engine reads the parameters that change the rows before the executor runs,
   * so the gate can judge with it (`GateUnit.control`).
   */
  value(param: ParamValue): Labeled<Cell>;
  /** The scope itself, for an executor that resolves a structure piece by piece (conditions, the fields of a row). */
  scope: Scope;
  /** A «Código» only (F14c): the rows its evaluation `at` gave, evaluated before the units (AU-38); throws its failure. */
  code?(at: number): readonly RowOut[];
  /**
   * Before an executor writes the changes it has for one row, all at once: throws `LimitPassed` when they would pass
   * the run's «rows written» (AU-17), so none of them is asked or written. The gate counts each change anyway.
   */
  reserve?(rows: number): void;
  /**
   * Before each call to a model (AU-206: an «Agente»'s round, a reader's call, a retry): throws `LimitPassed` when it
   * would pass the run's `modelCalls`, so the call is not made and the run stops with `run.limit`. The AI steps (E2,
   * E3) call it; no step of F14 calls a model.
   */
  modelCall?(): void;
  /** A reader step only (F15): what its calls gave for the row `at`, read before the units (AU-57). */
  read?(at: number): ReaderOutcome;
  /**
   * An «Agente» only (F15 E3): runs the rounds of one unit of work, its row (or none, with all of them) and the rows
   * the model receives (AU-55), and gives its row out with the answer (AU-53).
   */
  agent?(row: Row | null, rows: readonly Row[]): Promise<RowOut[]>;
  /** An «Avisar» only (AU-201): sends its notice, or in a test keeps what it would send. */
  notify?(text: Labeled<Cell>): Promise<void>;
  /** A «Responder» only (AU-202): sets the run's answer, plain text with the label of what it cites. */
  reply?(text: Labeled<Cell>): void;
  /** A Boni step only (AU-127): one unit through the port, which the engine completes with the run's own. */
  boni?(call: Pick<BoniCall, "name" | "values" | "args" | "row">): Promise<BoniAnswer>;
}

/** A row an executor gives: its fields and their labels. The engine sets `parent` and `path`, never the executor. */
export type RowOut = Pick<Row, "json" | "label" | "fields" | "origin">;

/**
 * What an executor answers: rows by output. For a step that works with all the rows and whose action `pairs`, each
 * row out says which row of the input it is (`from`), so the engine keeps `parent`.
 */
export type StepOutput = Record<string, readonly (RowOut & { from?: number })[]>;

export type Executor =
  /**
   * Once per row that arrives: `index` is the row's place in the step's input. `row` is null only for an action
   * with an effect that runs with an empty list (AU-14): once, with `index` 0 and no current row in its scope.
   */
  | { mode: "perRow"; run(ctx: StepContext, row: Row | null, index: number): Promise<StepOutput> }
  /** Once, with every row: `input` by input name. */
  | {
      mode: "all";
      run(ctx: StepContext, input: Record<string, readonly Row[]>): Promise<StepOutput>;
    };

/**
 * One executor per action of the catalogue, by `executorKey`, in the catalogue's mode. A trigger has none: the
 * engine gives its row.
 */
export const EXECUTORS: Readonly<Record<string, Executor>> = {
  ...TRANSFORM_AND_LOGIC,
  ...COLLECTION,
};

/** The key of an action's executor in `EXECUTORS`. */
export const executorKey = (type: string, action: string): string => `${type}.${action}`;

/** What a «Código» gave for its unit: the rows the engine evaluated before (AU-30, AU-38). */
const codeRows = (ctx: StepContext, at: number): readonly RowOut[] => {
  if (!ctx.code)
    throw new CodeFault("this «Código» was not evaluated", { code: "code.unavailable" });
  return ctx.code(at);
};

/**
 * The four readers' executor (AU-57): it hands out what the engine read for its row, never calls a model itself.
 * Its row out is the row that came in with the answer's fields, each with the label of what was sent and of the
 * model that wrote it, derived (it is never a destination, P14).
 */
const READER_EXECUTOR: Executor = {
  mode: "perRow",
  run: async (ctx, row, index) => {
    const outcome = ctx.read?.(index);
    if (!row || !outcome) throw new AiFault("this reader was not read", { code: "ai.unavailable" });
    if ("fault" in outcome) throw outcome.fault;
    const out = copy(row);
    for (const [key, value] of Object.entries(outcome.values))
      setField(out, key, { value, label: outcome.label, derived: true });
    return { [OUT.main]: [out] };
  },
};

/**
 * The executors of «Código», by «Se ejecuta»: reachable by its type, outside `EXECUTORS` as it is outside
 * `CATALOGUE`. They only hand out what the box gave: the code never runs here.
 */
const agentRows = (ctx: StepContext, row: Row | null, rows: readonly Row[]) => {
  if (!ctx.agent) throw new AiFault("this «Agente» has no model", { code: "ai.unavailable" });
  return ctx.agent(row, rows);
};

/** The executors of «Agente», by «Se ejecuta» (AU-55): the engine runs its rounds (`StepContext.agent`). */
const AGENT_EXECUTORS: Readonly<Record<"all" | "perRow", Executor>> = {
  all: {
    mode: "all",
    run: async (ctx, input) => ({
      [OUT.main]: await agentRows(ctx, null, Object.values(input).flat()),
    }),
  },
  perRow: {
    mode: "perRow",
    run: async (ctx, row) => ({ [OUT.main]: await agentRows(ctx, row, row ? [row] : []) }),
  },
};

const CODE_EXECUTORS: Readonly<Record<CodeMode, Executor>> = {
  all: { mode: "all", run: async (ctx) => ({ [OUT.main]: codeRows(ctx, 0) }) },
  perRow: {
    mode: "perRow",
    run: async (ctx, _row, index) => ({ [OUT.main]: codeRows(ctx, index) }),
  },
};

/** The rows that came in, passed on as they are, each knowing its own (`pairs`). */
const passOn = (input: Record<string, readonly Row[]>) =>
  Object.values(input)
    .flat()
    .map((r, i) => copy(r, i));

/** «Avisar» (AU-201), by «Se ejecuta»: one notice with all the rows, or one per row; the rows pass on. */
const NOTIFY_EXECUTORS: Readonly<Record<"all" | "perRow", Executor>> = {
  all: {
    mode: "all",
    run: async (ctx, input) => {
      await notifyOf(ctx)(ctx.value(ctx.step.params[NOTIFY_PARAMS.text] ?? ""));
      return { [OUT.main]: passOn(input) };
    },
  },
  perRow: {
    mode: "perRow",
    run: async (ctx, row) => {
      await notifyOf(ctx)(ctx.value(ctx.step.params[NOTIFY_PARAMS.text] ?? ""));
      return { [OUT.main]: row ? [copy(row)] : [] };
    },
  },
};
const notifyOf = (ctx: StepContext) => {
  if (!ctx.notify)
    throw new PeopleFault("nothing can tell Juan here", { code: "people.unavailable" });
  return ctx.notify;
};

/**
 * A Boni step (AU-127, AU-223): one call to Boni's code per unit (with all the rows, the first is its row), with its
 * parameters resolved and labelled. Its row out holds the answer as `BONI_VALUE`, labelled with the answer's label
 * joined with everything the call was given: Boni's code can lower a label, never raise one above what it read. It
 * has no write cell: what Boni's code changes is decided behind the port (`decide`), and in «Probar» it changes nothing.
 */
const BONI_EXECUTORS: Readonly<Record<"all" | "perRow", Executor>> = {
  all: {
    mode: "all",
    run: async (ctx, input) => ({
      [OUT.main]: [await boniUnit(ctx, Object.values(input).flat()[0] ?? null)],
    }),
  },
  perRow: {
    mode: "perRow",
    run: async (ctx, row) => ({ [OUT.main]: [await boniUnit(ctx, row)] }),
  },
};
/** The parameters the port is not given as `values`: the arguments, and how the step runs. */
const BONI_NOT_VALUES: ReadonlySet<string> = new Set([BONI_PARAMS.args, BONI_PARAMS.mode]);
async function boniUnit(ctx: StepContext, row: Row | null): Promise<RowOut> {
  if (!ctx.boni) throw new StepFault("nothing reaches Boni's code here", { code: "other" });
  const step = ctx.step;
  const values: Record<string, Labeled<Cell>> = {};
  for (const p of paramsOf(step)) {
    if (BONI_NOT_VALUES.has(p.key)) continue;
    const v = paramValue(step, p);
    if (v !== undefined) values[p.key] = ctx.value(v);
  }
  const args: Record<string, Labeled<Cell>> = {};
  const listed = step.params[BONI_PARAMS.args];
  for (const a of Array.isArray(listed) ? listed : []) {
    const o = a as Record<string, ParamValue>;
    if (typeof o.key === "string" && o.value !== undefined) args[o.key] = ctx.value(o.value);
  }
  const name =
    step.type === BONI_ACTION_TYPE
      ? String(step.params[BONI_PARAMS.action] ?? "")
      : step.type === BONI_READER_TYPE
        ? String(step.params[BONI_PARAMS.reader] ?? "")
        : (boniPiece(step.type)?.old ?? step.type);
  const answer = await ctx.boni({ name, values, args, row });
  const read = [...Object.values(values), ...Object.values(args)].map((v) => v.label);
  if (row) read.push(row.label, ...Object.values(row.fields ?? {}).map((f) => f.label));
  return { json: { [BONI_VALUE]: answer.value }, label: join(answer.label, ...read) };
}

/** «Responder» (AU-202): sets the run's answer once with all the rows; the rows pass on. */
const REPLY_EXECUTOR: Executor = {
  mode: "all",
  run: async (ctx, input) => {
    if (!ctx.reply)
      throw new PeopleFault("this «Responder» has no run", { code: "people.unavailable" });
    ctx.reply(ctx.value(ctx.step.params[REPLY_PARAMS.text] ?? ""));
    return { [OUT.main]: passOn(input) };
  },
};

/** The bytes of a text in UTF-8, without making them. */
function utf8Bytes(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}
