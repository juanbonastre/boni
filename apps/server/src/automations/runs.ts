/**
 * «Ejecutar», «Ejecuciones» and what is done with a run, on the server (docs/automatizaciones.md §5.8, phase F14d S2:
 * AU-97, AU-99, AU-18, AU-100, AU-93, AU-190). A run for real starts only here, and only through `runPublished`
 * (publish.ts): the published version, its «Sí», on. This keeps it.
 *
 * - **One at a time** (AU-97): an automation with a run queued or running refuses another (`running`, with its id);
 *   the runs of one account go one after another in the order they arrived, in one lane per store. The route answers
 *   at once with the run: `running` when it started, `queued` behind another; the run goes on in the server.
 * - **Kept as it goes** (AU-99): its row when it is asked, each step's record and rows as the step ends
 *   (`onStep`), its end. So a run in progress is read up to its last finished step, and one a restart cut is
 *   found still `running` at start-up and closed as `interrupted`, never run again (AU-190, decision 12):
 *   `interruptRuns`, called when the server opens the account's store.
 * - **Told as it goes**: an event `run` per start, per step that ends (its counts, never its rows) and per end, on
 *   the account's stream of events (agent.ts, `onRunEvent`).
 * - **Undone whole** (AU-18): every operation it saved carries its id, and «Deshacer lo que hizo» is the store's
 *   `undoRun`, all or nothing in one transaction: a row changed since undoes none and says which.
 * - **Retried by hand** (AU-100): the same trigger and fields, the version published now; «Deshacer y reintentar»
 *   undoes the run first, so nothing is written twice.
 * - **What it waits for** (`asked`): kept with the run (`ASKED_STEP`), counted in its line. The proposal made of it
 *   and its acceptance are S3's (AU-193); until then a run that asked leaves its asked changes kept and unsaved.
 */

import { EventEmitter } from "node:events";
import type { Trust } from "@boni/agent";
import {
  type Automation,
  arrowsInto,
  type Box,
  type Cell,
  type Execution,
  executionOrder,
  parseAutomation,
  type StepError,
  type StepRecord,
  stepPrints,
} from "@boni/automations";
import {
  type AutomationRunFilter,
  type AutomationRunRow,
  type AutomationRunState,
  StoreError,
  type UserStore,
} from "@boni/store";
import { sandboxBox } from "./box.ts";
import { isRefusal, type Refusal, type RunRequest, runPublished } from "./publish.ts";
import {
  ASKED_STEP,
  keepAsked,
  keepStep,
  newRunId,
  type PinView,
  pinsView,
  type RunRecord,
  type RunStepView,
  triggerOutput,
  triggerPrint,
} from "./record.ts";
import {
  BAD,
  type Hand,
  isError,
  keptTests,
  NOT_FOUND,
  open,
  ROWS_PAGE,
  type RowView,
  type ServiceError,
  sha256,
  testedFields,
} from "./service.ts";

/** «Lo que hizo en una línea» (AU-99): the app words it with i18n.ts. */
export interface RunLine {
  /** Saved, from the log: by collection (its key and its name now) and action. */
  writes: RunCount[];
  /** Proposed («Preguntar»): it waits for Juan, S3's proposal. */
  asked: RunCount[];
  /** «Con datos de fuera» (AU-182): something it saved without asking holds a value from outside. */
  outside: boolean;
}
export interface RunCount {
  collection: string;
  name: string | null;
  action: "create" | "update" | "trash";
  n: number;
}

/** A run as the list and its detail say it (AU-99). */
export interface RunSummary {
  id: string;
  automation: string;
  version: number | null;
  test: boolean;
  state: AutomationRunState;
  startedBy: string;
  device: string | null;
  at: number;
  started: number | null;
  ended: number | null;
  ms: number | null;
  step: string | null;
  error: (StepError & { step: string | null }) | null;
  line: RunLine | null;
  undone: number | null;
  retryOf: string | null;
}

/** The event a run sends as it goes, on the account's stream (agent.ts): never its rows. */
export interface RunEvent {
  automation: string;
  run: string;
  state: AutomationRunState;
  step?: string;
  out?: Record<string, number>;
}

/** Who starts a run: Juan's hand, with his device's trust and his zone. */
export type RunHand = Hand & { trust: Trust; zone: string };

/** What a run's touches may refuse, beside `runPublished`'s, in a 200 with `{refused}` (the routes' note). */
export type RunRefusal =
  | Refusal
  | { refused: "running"; run: string }
  | { refused: "test" }
  | { refused: "nothing" }
  | { refused: "changed"; row: string; title: string }
  | { refused: "untested" };

/** The runs of one store: their lane and their events. */
interface Lane {
  tail: Promise<unknown>;
  pending: number;
  events: EventEmitter;
}
const lanes = new WeakMap<UserStore, Lane>();
function laneOf(store: UserStore): Lane {
  let lane = lanes.get(store);
  if (!lane) {
    lane = { tail: Promise.resolve(), pending: 0, events: new EventEmitter() };
    lane.events.setMaxListeners(0);
    lanes.set(store, lane);
  }
  return lane;
}

/** Listens to the events of the runs of an account's store; gives what stops listening. */
export function onRunEvent(store: UserStore, listener: (e: RunEvent) => void): () => void {
  const events = laneOf(store).events;
  events.on("run", listener);
  return () => events.off("run", listener);
}
const told = (store: UserStore, e: RunEvent) => laneOf(store).events.emit("run", e);

/** Resolves when the store's lane has no run queued or running: for tests and for closing a store. */
export function settled(store: UserStore): Promise<unknown> {
  return laneOf(store).tail;
}

export function summaryOf(r: AutomationRunRow): RunSummary {
  return {
    id: r.id,
    automation: r.automation,
    version: r.version,
    test: r.test,
    state: r.state,
    startedBy: r.startedBy,
    device: r.device,
    at: r.at,
    started: r.started,
    ended: r.ended,
    ms: r.ms,
    step: r.step,
    error: r.error ? (JSON.parse(r.error) as RunSummary["error"]) : null,
    line: r.line ? (JSON.parse(r.line) as RunLine) : null,
    undone: r.undone,
    retryOf: r.retryOf,
  };
}

/** The collection of a type id, by its key and name now. */
function collectionOf(store: UserStore, type: string): { key: string; name: string | null } {
  const t = store.schema().types[type];
  return { key: t?.key ?? type, name: t && !t.archived ? t.name : null };
}
const nameOfKey = (store: UserStore, key: string): string | null => {
  const t = Object.values(store.schema().types).find((x) => x.key === key);
  return t && !t.archived ? t.name : null;
};

/** What a run did in one line (AU-99, AU-182): what it saved by the log, what it asked by its record. */
export function lineOf(store: UserStore, run: string, asked: Execution["asked"]): RunLine {
  const w = store.journal.automationRunWrites(run);
  const writes: RunCount[] = w.counts.map((c) => {
    const col = collectionOf(store, c.type);
    return {
      collection: col.key,
      name: col.name,
      action: c.kind === "delete" ? "trash" : c.kind,
      n: c.n,
    };
  });
  const byKey = new Map<string, RunCount>();
  for (const a of asked) {
    const collection = a.change.kind === "create" ? a.change.collection : a.change.row.collection;
    const k = `${collection}\u0000${a.change.kind}`;
    const had = byKey.get(k);
    if (had) had.n++;
    else
      byKey.set(k, {
        collection,
        name: nameOfKey(store, collection),
        action: a.change.kind,
        n: 1,
      });
  }
  return { writes, asked: [...byKey.values()], outside: w.outside };
}

/** Why a run for real cannot start now, before anything is kept: the same order as `runPublished`'s, and one at a time. */
function cannotStart(
  store: UserStore,
  id: string,
  hand: RunHand,
): RunRefusal | ServiceError | null {
  const row = store.journal.automation(id);
  if (!row || row.deleted) return NOT_FOUND;
  // A run for real is his hand's, from a personal device (decision 13); a shared one looks (the routes' note).
  if (hand.trust !== "personal") return { refused: "not-personal" };
  if (row.published === null) return { refused: "unpublished" };
  if (!row.enabled) return { refused: "off" };
  const busy = store.journal.openAutomationRun(id);
  if (busy) return { refused: "running", run: busy.id };
  return null;
}

const validRequest = (r: RunRequest | undefined): r is RunRequest =>
  !!r &&
  typeof r.trigger === "string" &&
  !!r.fields &&
  typeof r.fields === "object" &&
  !Array.isArray(r.fields);

/**
 * «Ejecutar» (AU-97): keeps the run as asked and starts it in the account's lane; answers when it started, or at
 * once when it waits behind another. What `runPublished` refuses before running (`invalid`, with its problems) is
 * answered as the route's refusal and nothing is kept; refused once it was queued, the run ends `failed` saying so.
 */
export async function startRun(
  store: UserStore,
  id: string,
  request: RunRequest,
  hand: RunHand,
  o: { box?: Box; retryOf?: string } = {},
): Promise<{ run: RunSummary } | RunRefusal | ServiceError> {
  const no = cannotStart(store, id, hand);
  if (no) return no;
  if (!validRequest(request)) return BAD;
  const version = store.journal.automation(id)?.published ?? null;
  const run = newRunId();
  const test = false; // the run's row; the engine is given it by `runPublished` alone (AU-95)
  store.journal.createAutomationRun({
    id: run,
    automation: id,
    version,
    test,
    state: "queued",
    trigger: request.trigger,
    fields: JSON.stringify(request.fields),
    startedBy: "user",
    device: hand.device,
    retryOf: o.retryOf ?? null,
    at: Date.now(),
    started: null,
    doc: null,
  });
  const lane = laneOf(store);
  const waiting = lane.pending > 0;
  lane.pending++;
  const begun = new Promise<RunRefusal | ServiceError | null>((resolve) => {
    lane.tail = lane.tail
      .then(() => execute(store, id, run, request, hand, o.box ?? sandboxBox(), waiting, resolve))
      .catch((e) => {
        console.error(`automation run ${run}:`, e);
        resolve({ error: "bad-request" });
      })
      .finally(() => {
        lane.pending--;
      });
  });
  if (!waiting) {
    const refused = await begun;
    if (refused) return refused;
  }
  const kept = store.journal.automationRun(run);
  return kept ? { run: summaryOf(kept) } : NOT_FOUND;
}

/** Runs a kept run when its turn comes, keeping each step as it ends; `begun` is told once: started, or refused. */
async function execute(
  store: UserStore,
  id: string,
  run: string,
  request: RunRequest,
  hand: RunHand,
  box: Box,
  queued: boolean,
  begun: (refused: RunRefusal | ServiceError | null) => void,
): Promise<void> {
  const started = Date.now();
  store.journal.startAutomationRun(run, started);
  let n = 0;
  let going = false;
  const onStep = (step: string, record: StepRecord, phase: "started" | "ended") => {
    if (!going) {
      going = true;
      told(store, { automation: id, run, state: "running" });
      begun(null);
    }
    if (phase === "started") {
      store.journal.setAutomationRunStep(run, step);
      return;
    }
    keepStep(store, run, n++, step, record);
    told(store, {
      automation: id,
      run,
      state: "running",
      step,
      out: Object.fromEntries(Object.entries(record.out).map(([k, v]) => [k, v.length])),
    });
  };
  let result: Execution | Refusal | ServiceError;
  try {
    result = await runPublished(store, id, request, hand, run, box, { onStep });
  } catch (e) {
    result = { error: "bad-request" };
    console.error(`automation run ${run}:`, e);
  }
  const ended = Date.now();
  if (isRefusal(result) || isError(result)) {
    if (!going) {
      // Refused before any step: nothing ran and nothing was saved. Asked now, the route says why and keeps nothing;
      // asked earlier and queued since, the run says it did not start.
      begun(result);
      if (!queued) {
        store.journal.dropAutomationRun(run);
        return;
      }
      store.journal.endAutomationRun(run, {
        state: "failed",
        ended,
        ms: 0,
        step: null,
        error: JSON.stringify({
          message: isRefusal(result) ? result.refused : result.error,
          step: null,
          refused: result,
        }),
        line: JSON.stringify(lineOf(store, run, [])),
      });
      told(store, { automation: id, run, state: "failed" });
    }
    return;
  }
  keepAsked(store, run, result.asked);
  const state = result.state;
  store.journal.endAutomationRun(run, {
    state,
    ended,
    ms: ended - started,
    step: result.error?.step ?? null,
    error: result.error ? JSON.stringify(result.error) : null,
    line: JSON.stringify(lineOf(store, run, result.asked)),
  });
  told(store, { automation: id, run, state });
}

/**
 * At start-up (AU-190, decision 12): every run still queued or running is closed as interrupted, saying the step
 * it was in; nothing is run again. What its finished steps saved stays, and is undone from it (AU-18).
 */
export function interruptRuns(store: UserStore, now = Date.now()): string[] {
  return store.journal.interruptAutomationRuns(now);
}

/** A run of this automation, or not found. */
function runOf(store: UserStore, id: string, run: string): AutomationRunRow | null {
  const row = store.journal.automation(id);
  if (!row || row.deleted) return null;
  const r = store.journal.automationRun(run);
  return r && r.automation === id ? r : null;
}

/** The title of a record, as the app names it: its type's title field. */
function titleOf(store: UserStore, entity: string): string {
  const e = store.get(entity);
  if (!e) return "";
  const def = store.schema().types[e.entity.type];
  const v = def ? e.entity.values[def.titleField] : undefined;
  return typeof v === "string" ? v : "";
}

/** Undoes all a run saved, or nothing: the refusal says why (AU-18). */
function undoAll(store: UserStore, r: AutomationRunRow, hand: Hand): RunRefusal | null {
  if (r.test) return { refused: "nothing" };
  if (r.state === "queued" || r.state === "running") return { refused: "running", run: r.id };
  if (r.undone !== null || !store.runUndoable(r.id)) return { refused: "nothing" };
  try {
    store.undoRun(r.id, { actor: "user", device: hand.device });
  } catch (e) {
    if (e instanceof StoreError && e.code === "conflict" && e.target)
      return { refused: "changed", row: e.target, title: titleOf(store, e.target) };
    if (e instanceof StoreError && e.code === "undo") return { refused: "nothing" };
    throw e;
  }
  store.journal.setAutomationRunUndone(r.id, hand.now);
  return null;
}

/** «Deshacer lo que hizo» (AU-18, AU-100): all it saved, in one transaction, or nothing and why. */
export function undoAutomationRun(
  store: UserStore,
  id: string,
  run: string,
  hand: RunHand,
): { run: RunSummary } | RunRefusal | ServiceError {
  if (hand.trust !== "personal") return { refused: "not-personal" };
  const r = runOf(store, id, run);
  if (!r) return NOT_FOUND;
  const refused = undoAll(store, r, hand);
  if (refused) return refused;
  return { run: summaryOf(store.journal.automationRun(run) as AutomationRunRow) };
}

/**
 * «Reintentar» and «Deshacer y reintentar» (AU-100): a new run by hand with that run's trigger and fields and the
 * version published now (`version`; `was`, the one it ran). A test is not retried. With `undo`, the run is undone
 * first, all or nothing. What refuses a start before anything (off, unpublished, a run in progress, a shared device)
 * is checked before the undo, so it undoes nothing; a refusal found only when the new run starts (its trigger's fields
 * no longer valid, say) comes after the undo, which stays.
 */
export async function retryRun(
  store: UserStore,
  id: string,
  run: string,
  o: { undo?: boolean },
  hand: RunHand,
  box?: Box,
): Promise<{ run: RunSummary; version: number; was: number | null } | RunRefusal | ServiceError> {
  const r = runOf(store, id, run);
  if (!r) return NOT_FOUND;
  if (r.test) return { refused: "test" };
  if (r.state === "queued" || r.state === "running") return { refused: "running", run: r.id };
  const no = cannotStart(store, id, hand);
  if (no) return no;
  if (o.undo && r.undone === null && store.runUndoable(r.id)) {
    const refused = undoAll(store, r, hand);
    if (refused) return refused;
  }
  const request = { trigger: r.trigger, fields: JSON.parse(r.fields) as Record<string, Cell> };
  const started = await startRun(store, id, request, hand, {
    retryOf: r.id,
    ...(box ? { box } : {}),
  });
  if ("refused" in started || isError(started)) return started;
  return {
    run: started.run,
    version: started.run.version ?? 0,
    was: r.version,
  };
}

/** A page of an automation's runs (AU-99): 50, the newest first, by the index; no step and no row is read. */
export function runsOf(
  store: UserStore,
  id: string,
  q: { filter?: string; before?: string },
): { runs: RunSummary[]; next: string | null } | ServiceError {
  const row = store.journal.automation(id);
  if (!row || row.deleted) return NOT_FOUND;
  const filter = (q.filter ?? "all") as AutomationRunFilter;
  if (!["all", "failed", "tests"].includes(filter)) return BAD;
  const page = store.journal.automationRuns(id, {
    filter,
    ...(q.before ? { before: q.before } : {}),
    limit: ROWS_PAGE + 1,
  });
  const runs = page.slice(0, ROWS_PAGE).map(summaryOf);
  return { runs, next: page.length > ROWS_PAGE ? (runs.at(-1)?.id ?? null) : null };
}

/** The document a run ran: its version's, or a test's draft as it was. */
function docOf(store: UserStore, r: AutomationRunRow): Automation | null {
  if (r.doc) return parseAutomation(JSON.parse(r.doc));
  if (r.version === null) return null;
  const v = store.journal.automationVersion(r.automation, r.version);
  return v ? parseAutomation(JSON.parse(v.doc)) : null;
}

/** The records of a run's steps, by step id, without the one that holds what it asked. */
function stepsOf(store: UserStore, run: string): Map<string, RunRecord> {
  return new Map(
    store.journal
      .automationRunSteps(run)
      .filter((s) => s.step !== ASKED_STEP)
      .map((s) => [s.step, JSON.parse(s.record) as RunRecord]),
  );
}

/** One run (AU-99, AU-100): its summary, the version it ran, what it started with and each step's record. */
export function runView(
  store: UserStore,
  id: string,
  run: string,
):
  | {
      run: RunSummary;
      automation: Automation | null;
      trigger: string;
      fields: Record<string, Cell>;
      steps: Record<string, RunStepView>;
      undoable: boolean;
      wrote: boolean;
      published: number | null;
    }
  | ServiceError {
  const r = runOf(store, id, run);
  if (!r) return NOT_FOUND;
  const ended = r.state !== "queued" && r.state !== "running";
  const undoable = !r.test && ended && r.undone === null && store.runUndoable(r.id);
  return {
    run: summaryOf(r),
    automation: docOf(store, r),
    trigger: r.trigger,
    fields: JSON.parse(r.fields) as Record<string, Cell>,
    steps: Object.fromEntries(stepsOf(store, run)),
    undoable,
    wrote: !r.test && store.runOps(r.id).length > 0,
    published: store.journal.automation(id)?.published ?? null,
  };
}

type StoredRow = {
  json: Record<string, Cell>;
  label: RowView["label"];
  fields?: Record<string, { label: RowView["label"] }>;
};
const viewOfRow = (k: StoredRow): RowView => ({
  json: k.json,
  label: k.label,
  ...(k.fields && Object.keys(k.fields).length
    ? { fields: Object.fromEntries(Object.entries(k.fields).map(([f, l]) => [f, l.label])) }
    : {}),
});

/** Some rows of one step of a run (AU-99): of one of its outputs, or of what came in by one input, a page at a time. */
export function runRows(
  store: UserStore,
  id: string,
  run: string,
  at: { step: string; side: string; name: string; offset: number },
): { rows: RowView[]; total: number } | ServiceError {
  const r = runOf(store, id, run);
  if (!r) return NOT_FOUND;
  if ((at.side !== "in" && at.side !== "out") || !Number.isInteger(at.offset) || at.offset < 0)
    return BAD;
  const steps = stepsOf(store, run);
  const mine = steps.get(at.step);
  if (!mine) return NOT_FOUND;
  if (at.side === "out") {
    if (!(at.name in mine.out)) return BAD;
    const rows = store.journal.automationRunRows(run, at.step, at.name, at.offset, ROWS_PAGE);
    return { rows: (rows as StoredRow[]).map(viewOfRow), total: mine.out[at.name] ?? 0 };
  }
  if (!(at.name in mine.in)) return BAD;
  const a = docOf(store, r);
  if (!a) return NOT_FOUND;
  let order: string[];
  try {
    order = executionOrder(a, r.trigger);
  } catch {
    return BAD;
  }
  const parts = arrowsInto(a, order, at.step, at.name).map((arrow) => ({
    step: arrow.from.step,
    output: arrow.from.output,
    count: steps.get(arrow.from.step)?.out[arrow.from.output] ?? 0,
  }));
  const out: StoredRow[] = [];
  let seen = 0;
  for (const p of parts) {
    if (out.length >= ROWS_PAGE) break;
    const from = Math.max(0, at.offset + out.length - seen);
    if (from < p.count)
      out.push(
        ...(store.journal.automationRunRows(
          run,
          p.step,
          p.output,
          from,
          ROWS_PAGE - out.length,
        ) as StoredRow[]),
      );
    seen += p.count;
  }
  return { rows: out.map(viewOfRow), total: parts.reduce((n, p) => n + p.count, 0) };
}

/** The pins of the draft as the editor shows them, with the draft's prints of now. */
function pinsNow(store: UserStore, id: string): Record<string, PinView> | ServiceError {
  const o = open(store, id);
  if (!o) return NOT_FOUND;
  const kept = keptTests(store, id);
  const tested = testedFields(store, o.automation, kept);
  return pinsView(store, id, o.automation, stepPrints(o.automation, tested, sha256), tested);
}

/**
 * «Fijar» (AU-93): pins the last tested output of a step on the draft, each row with its label; without a test of
 * it that ended done, `untested`. Pins live beside the draft, never in a version: a real run has none.
 */
export function pinStep(
  store: UserStore,
  id: string,
  step: string,
  hand: RunHand,
): { pins: Record<string, PinView> } | RunRefusal | ServiceError {
  if (hand.trust !== "personal") return { refused: "not-personal" };
  const o = open(store, id);
  if (!o) return NOT_FOUND;
  if (!o.automation.steps.some((s) => s.id === step)) return NOT_FOUND;
  const t = keptTests(store, id).get(step);
  if (t?.kept.state !== "done") return { refused: "untested" };
  const rows: Record<string, string[]> = {};
  for (const [output, n] of Object.entries(t.kept.out))
    rows[output] = store.journal
      .automationTestRows(id, step, output, 0, n)
      .map((r) => JSON.stringify(r));
  store.journal.pinAutomationStep({
    id,
    step,
    print: t.print,
    at: t.at,
    record: t.record,
    rows,
  });
  const pins = pinsNow(store, id);
  return isError(pins) ? pins : { pins };
}

/** Releases a pin (AU-93): the next test runs the step again. */
export function unpinStep(
  store: UserStore,
  id: string,
  step: string,
  hand: RunHand,
): { pins: Record<string, PinView> } | RunRefusal | ServiceError {
  if (hand.trust !== "personal") return { refused: "not-personal" };
  if (!open(store, id)) return NOT_FOUND;
  store.journal.unpinAutomationStep(id, step);
  const pins = pinsNow(store, id);
  return isError(pins) ? pins : { pins };
}

/**
 * «Abrir en el editor con estos datos» (AU-100): pins on the draft the output the trigger gave in that run, so the
 * next «Probar» starts from it (AU-93). A test has it too. The draft must still have that trigger.
 */
export function pinFromRun(
  store: UserStore,
  id: string,
  run: string,
  hand: RunHand,
): { pins: Record<string, PinView>; trigger: string } | RunRefusal | ServiceError {
  if (hand.trust !== "personal") return { refused: "not-personal" };
  const r = runOf(store, id, run);
  if (!r) return NOT_FOUND;
  const o = open(store, id);
  if (!o) return NOT_FOUND;
  const output = triggerOutput(o.automation, r.trigger);
  const record = stepsOf(store, run).get(r.trigger);
  if (!output || !record) return NOT_FOUND;
  const rows: Record<string, string[]> = {};
  for (const [name, n] of Object.entries(record.out))
    rows[name] = store.journal
      .automationRunRows(run, r.trigger, name, 0, n)
      .map((x) => JSON.stringify(x));
  const [first] = store.journal.automationRunRows(run, r.trigger, output, 0, 1) as StoredRow[];
  const tested = testedFields(store, o.automation, keptTests(store, id));
  const { writes: _w, ...rest } = record;
  store.journal.pinAutomationStep({
    id,
    step: r.trigger,
    print: triggerPrint(o.automation, tested, r.trigger, first?.json ?? {}, sha256),
    at: r.started ?? r.at,
    record: JSON.stringify({ ...rest, wouldWrite: 0, trigger: r.trigger }),
    rows,
  });
  const pins = pinsNow(store, id);
  return isError(pins) ? pins : { pins, trigger: r.trigger };
}
