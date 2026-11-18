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
 * - **What it tells and what stays** (S4): as it ends, what it tells is kept with it and goes with its last event
 *   (notices.ts: a failure once per streak, what it saved once per run, only for one that started alone; AU-102,
 *   AU-167), and its automation's runs no longer whole are let go (keep.ts, AU-103).
 * - **Undone whole** (AU-18): every operation it saved carries its id, and «Deshacer lo que hizo» is the store's
 *   `undoRun`, all or nothing in one transaction: a row changed since undoes none and says which.
 * - **Retried by hand** (AU-100): the same trigger and fields, the version published now; «Deshacer y reintentar»
 *   undoes the run first, so nothing is written twice.
 * - **What it waits for** (`asked`): kept with the run (`ASKED_STEP`), counted in its line, and made one proposal in
 *   the inbox (proposal.ts, AU-193, S3): accepted, it is saved with the run's id, so «Deshacer lo que hizo» takes it
 *   back too.
 * - **At its hour** (S3, AU-114): `startScheduledRun` starts a «Programada» in the same lane, `startedBy` `schedule`
 *   and the hour kept (`slot`), and `missRun` keeps an hour it could not run as «No corrió» (scheduler.ts).
 */

import { EventEmitter } from "node:events";
import type { Trust } from "@boni/agent";
import {
  type AskRecord,
  type Automation,
  answerFits,
  arrowsInto,
  type Box,
  CannotRun,
  type Cell,
  type Execution,
  executionOrder,
  type GivenAnswer,
  parseAutomation,
  type StartedBy,
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
import { handLabel } from "../actions.ts";
import { sandboxBox } from "./box.ts";
import { pruneRuns } from "./keep.ts";
import { learnUndo, recordRun } from "./learning.ts";
import { type AutomationNotice, keepNotice, type RunNotice } from "./notices.ts";
import { type AskedView, askedOf, proposeRun } from "./proposal.ts";
import {
  isRefusal,
  type Refusal,
  type RunRequest,
  resumePublished,
  runPublished,
} from "./publish.ts";
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
import {
  type AskPlace,
  addAskCards,
  askPlace,
  endAskCards,
  untilOf,
  waitingAsks,
} from "./waits.ts";

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
  /** A «Programada»'s: the hour it ran for (AU-114). */
  slot: number | null;
  /** The proposal of what it asked, in the inbox (AU-193). */
  proposal: string | null;
  at: number;
  started: number | null;
  ended: number | null;
  ms: number | null;
  step: string | null;
  error: (StepError & { step: string | null }) | null;
  line: RunLine | null;
  undone: number | null;
  retryOf: string | null;
  /** What it told when it ended (AU-102, AU-167; notices.ts): only a run that started alone tells. */
  notice: RunNotice | null;
  /** When its steps and rows were let go (AU-103, keep.ts): its line stays, and «Deshacer lo que hizo» still works. */
  pruned: number | null;
}

/** The event a run sends as it goes, on the account's stream (agent.ts): never its rows. */
export interface RunEvent {
  automation: string;
  run: string;
  state: AutomationRunState;
  step?: string;
  out?: Record<string, number>;
  /** What it told as it ended (AU-102, AU-167). */
  notice?: AutomationNotice;
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
  | { refused: "untested" }
  /** Its steps and rows were let go (AU-103): only its line is left. */
  | { refused: "pruned" };

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

/** What Boni learned of a cell (learning.ts: a pause, a suggestion), told once on the stream with the run it came of. */
export function tellLearned(store: UserStore, notices: readonly AutomationNotice[]): void {
  for (const notice of notices) {
    const r = store.journal.automationRun(notice.run);
    if (r) told(store, { automation: notice.automation, run: notice.run, state: r.state, notice });
  }
}

/** A run ended: what it tells is kept with it and goes with its last event, and what is no longer whole is let go. */
function hasEnded(store: UserStore, id: string, run: string, state: AutomationRunState): void {
  const notice = keepNotice(store, run);
  pruneRuns(store, id);
  told(store, { automation: id, run, state, ...(notice ? { notice } : {}) });
}

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
    slot: r.slot,
    proposal: r.proposal,
    at: r.at,
    started: r.started,
    ended: r.ended,
    ms: r.ms,
    step: r.step,
    error: r.error ? (JSON.parse(r.error) as RunSummary["error"]) : null,
    line: r.line ? (JSON.parse(r.line) as RunLine) : null,
    undone: r.undone,
    retryOf: r.retryOf,
    notice: r.notice ? (JSON.parse(r.notice) as RunNotice) : null,
    pruned: r.pruned,
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
  o: { box?: Box; retryOf?: string; startedBy?: StartedBy } = {},
): Promise<{ run: RunSummary } | RunRefusal | ServiceError> {
  const no = cannotStart(store, id, hand);
  if (no) return no;
  if (!validRequest(request)) return BAD;
  return enqueue(store, id, request, hand, { ...o, startedBy: o.startedBy ?? "user" });
}

/** Who a scheduled run is in the store: no device and no hand; its trigger's row is the code's (the hour). */
const scheduledHand = (zone: string): RunHand => ({
  device: "",
  now: Date.now(),
  trust: "personal",
  zone,
});

/**
 * A «Programada» at its hour (AU-114): as «Ejecutar», in the account's lane, with `startedBy` `schedule`, the hour
 * that was due kept with the run (an hour the store already has is refused: it never runs twice) and given by the
 * trigger. Whatever it writes is decided as a run by hand is (AU-195). Refused: unpublished, off, or one under way.
 */
export async function startScheduledRun(
  store: UserStore,
  id: string,
  trigger: string,
  slot: number,
  zone: string,
  o: { box?: Box } = {},
): Promise<{ run: RunSummary } | RunRefusal | ServiceError> {
  const row = store.journal.automation(id);
  if (!row || row.deleted) return NOT_FOUND;
  if (row.published === null) return { refused: "unpublished" };
  if (!row.enabled) return { refused: "off" };
  const busy = store.journal.openAutomationRun(id);
  if (busy) return { refused: "running", run: busy.id };
  return enqueue(store, id, { trigger, fields: { date: slot } }, scheduledHand(zone), {
    ...o,
    startedBy: "schedule",
    slot,
  });
}

/**
 * An hour of a «Programada» past its margin (AU-114): kept as «No corrió», with no step, so «Ejecuciones» says it and
 * the hour is not tried again. False when the store already had that hour.
 */
export function missRun(
  store: UserStore,
  id: string,
  trigger: string,
  slot: number,
  now = Date.now(),
): boolean {
  const run = newRunId();
  const kept = store.journal.missAutomationRun({
    id: run,
    automation: id,
    version: store.journal.automation(id)?.published ?? null,
    trigger,
    fields: JSON.stringify({ date: slot }),
    slot,
    at: now,
  });
  if (kept) hasEnded(store, id, run, "missed");
  return kept;
}

/** Keeps a run as asked and runs it in the account's lane (`startRun`, `startScheduledRun`). */
async function enqueue(
  store: UserStore,
  id: string,
  request: RunRequest,
  hand: RunHand,
  o: { box?: Box; retryOf?: string; startedBy: StartedBy; slot?: number },
): Promise<{ run: RunSummary } | RunRefusal | ServiceError> {
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
    startedBy: o.startedBy,
    device: hand.device || null,
    retryOf: o.retryOf ?? null,
    at: Date.now(),
    started: null,
    doc: null,
    ...(o.slot !== undefined ? { slot: o.slot } : {}),
  });
  const lane = laneOf(store);
  const waiting = lane.pending > 0;
  lane.pending++;
  const begun = new Promise<RunRefusal | ServiceError | null>((resolve) => {
    lane.tail = lane.tail
      .then(() =>
        execute(
          store,
          id,
          run,
          request,
          hand,
          o.startedBy,
          o.box ?? sandboxBox(),
          waiting,
          resolve,
        ),
      )
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
  startedBy: StartedBy,
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
    result = await runPublished(store, id, request, hand, run, box, { onStep }, startedBy);
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
      hasEnded(store, id, run, "failed");
    }
    return;
  }
  if (result.state === "waiting") return wait(store, id, run, result, ended - started, ended);
  finish(store, id, run, result, ended - started, ended);
}

/**
 * A run reached a «Preguntar» (AU-203): it waits, keeping what it needs to go on, its questions in the Bandeja, and
 * its turn let go (the lane goes on with the next). Nothing is proposed yet: its proposal is made once, as it ends.
 */
function wait(
  store: UserStore,
  id: string,
  run: string,
  e: Execution,
  ms: number,
  now: number,
): void {
  store.journal.waitAutomationRun(run, {
    ms,
    line: JSON.stringify(lineOf(store, run, e.asked)),
    automation: id,
    until: untilOf(e),
    execution: JSON.stringify(e),
  });
  addAskCards(store, id, run, e, now);
  told(store, { automation: id, run, state: "waiting" });
}

/** A run ended, at once or after waiting: what it asked is one proposal (AU-193), its end is kept and told. */
function finish(
  store: UserStore,
  id: string,
  run: string,
  result: Execution,
  ms: number,
  ended: number,
): void {
  const state = result.state === "failed" ? "failed" : "done";
  keepAsked(store, run, result.asked);
  // What it asked is one proposal in the inbox, for Juan to accept or reject (AU-193).
  if (result.asked.length) proposeRun(store, id, run, result.asked);
  store.journal.endAutomationRun(run, {
    state,
    ended,
    ms,
    step: result.error?.step ?? null,
    error: result.error ? JSON.stringify(result.error) : null,
    line: JSON.stringify(lineOf(store, run, result.asked)),
  });
  // What it saved with «Sí» is one decision of each cell, judged later (AU-207).
  recordRun(store, run, result);
  hasEnded(store, id, run, state);
}

// ---------------------------------------------------------------- a run that waits (AU-203)

/** By the «Preguntar»'s step, by the question's place: its answer, or null for none (put away). */
type KeptAnswers = Record<string, Record<string, GivenAnswer | null>>;

const keptAnswers = (text: string): KeptAnswers => {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as KeptAnswers) : {};
  } catch {
    return {};
  }
};

/**
 * A waiting run goes on (AU-203): in the account's lane, behind what is queued (its turn, as any run), from what it
 * kept. Called when a step's every question has an entry and when its limit passes (the scheduler); one that no
 * longer waits by its turn (it went on already, was cancelled or undone) does nothing.
 */
export function goOn(store: UserStore, run: string, o: { zone: string; box?: Box }): Promise<void> {
  const lane = laneOf(store);
  lane.pending++;
  const going = lane.tail
    .then(() => carryOn(store, run, o.zone, o.box ?? sandboxBox()))
    .catch((e) => console.error(`automation run ${run}:`, e))
    .finally(() => {
      lane.pending--;
    });
  lane.tail = going;
  return going;
}

/**
 * Goes on with a waiting run by its turn: the version it started with, its steps as they were, and the lowest «Sí»
 * between that version's and the one published now (`lowerYes`: a step that is not the same in both asks, so waiting
 * never keeps a «Sí» Juan took back), and a cell paused since asks (AU-210). Off or deleted meanwhile, it is cancelled.
 */
async function carryOn(store: UserStore, run: string, zone: string, box: Box): Promise<void> {
  const r = store.journal.automationRun(run);
  const w = store.journal.automationWait(run);
  if (!r || r.state !== "waiting" || !w) return;
  const id = r.automation;
  const row = store.journal.automation(id);
  const v = r.version === null ? null : store.journal.automationVersion(id, r.version);
  if (!row || row.deleted || !row.enabled || !v) return cancelWait(store, r, Date.now());
  const kept = JSON.parse(w.execution) as Execution;
  // The steps whose every question has an entry go on; the rest stay as they were, past their limit or not.
  const given = keptAnswers(w.answers);
  const answers: Record<string, (GivenAnswer | null)[]> = {};
  for (const [step, ask] of waitingAsks(kept)) {
    const got = given[step];
    if (got && ask.questions.every((_, i) => String(i) in got)) {
      answers[step] = ask.questions.map((_, i) => got[String(i)] ?? null);
      delete given[step];
    }
  }
  store.journal.setAutomationWaitAnswers(run, JSON.stringify(given));
  const hand: RunHand = { device: r.device ?? "", now: Date.now(), trust: "personal", zone };
  store.journal.resumeAutomationRun(run);
  told(store, { automation: id, run, state: "running" });
  let n = Object.keys(kept.steps).length;
  const onStep = (step: string, record: StepRecord, phase: "started" | "ended") => {
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
  let result: Execution;
  try {
    // Its version, read again by its number, and the lowest «Sí» are publish.ts's (AU-95: only it runs for real).
    const going = await resumePublished(
      store,
      id,
      {
        version: v.n,
        trigger: r.trigger,
        fields: JSON.parse(r.fields) as Record<string, Cell>,
        startedBy: r.startedBy as StartedBy,
      },
      hand,
      run,
      { kept, answers, box },
      { onStep },
    );
    if (isError(going)) throw new CannotRun("its version is no longer kept");
    result = going;
  } catch (e) {
    // It cannot go on as it started (its version no longer valid, say): it fails saying so, nothing more runs.
    const ended = Date.now();
    store.journal.dropAutomationWait(run);
    endAskCards(store, run, "expired", ended);
    store.journal.endAutomationRun(run, {
      state: "failed",
      ended,
      ms: r.ms ?? 0,
      step: null,
      error: JSON.stringify({
        message: e instanceof CannotRun ? e.message : "it could not go on",
        step: null,
      }),
      line: r.line ?? JSON.stringify(lineOf(store, run, kept.asked)),
    });
    if (!(e instanceof CannotRun)) console.error(`automation run ${run}:`, e);
    return hasEnded(store, id, run, "failed");
  }
  const ended = Date.now();
  if (result.state === "waiting") return wait(store, id, run, result, result.ms, ended);
  store.journal.dropAutomationWait(run);
  // A question it no longer waits for (another failed and stopped it, say): its card says «Ya no vale».
  endAskCards(store, run, "expired", ended);
  finish(store, id, run, result, result.ms, ended);
}

/** What a card's answer may be, as the route reads it (the Bandeja's controls). */
export type AskGiven =
  | { yes: boolean }
  | { choice: number }
  | { choices: number[] }
  | { text: string };

/** The answer's value for its question, or null when it does not fit (a number out of the options, say). */
function answerValue(place: AskPlace, ask: AskRecord, given: unknown): Cell | null {
  const g = (given ?? {}) as Record<string, unknown>;
  const q = ask.questions[place.i];
  if (!q) return null;
  const option = (i: unknown) =>
    Number.isInteger(i) && (i as number) >= 0 ? q.options?.[i as number]?.value : undefined;
  let value: Cell | undefined;
  if (place.answer === "yesNo" && typeof g.yes === "boolean") value = g.yes;
  else if (place.answer === "one") value = option(g.choice);
  else if (place.answer === "several" && Array.isArray(g.choices)) {
    const values = g.choices.map(option);
    value = values.every((x) => x !== undefined) ? (values as string[]) : undefined;
  } else if (place.answer === "text" && typeof g.text === "string") value = g.text;
  return value !== undefined && answerFits(q, ask.answer, value) ? value : null;
}

/**
 * Juan answers a card of a «Preguntar» (AU-125, AU-203): from a personal device only, as accepting a proposal
 * (AU-193, decision 13). The answer is kept with the wait, labelled his hand on that device, and when every question
 * of its step has one the run goes on in its turn. `dismissed`: put away, it counts as no answer. A card no longer
 * pending, past its limit, or of a run that no longer waits is `gone` («Ya no vale»).
 */
export function answerAsk(
  store: UserStore,
  card: string,
  given: AskGiven | null,
  hand: RunHand,
  box?: Box,
): { run: string } | { gone: true } | RunRefusal | ServiceError {
  if (hand.trust !== "personal") return { refused: "not-personal" };
  const r = store.journal.request(card);
  const place = r ? askPlace(r.view) : null;
  if (!r || !place) return NOT_FOUND;
  const w = store.journal.automationWait(place.run);
  if (r.status !== "pending" || r.expires <= hand.now || !w) return { gone: true };
  const ask = (JSON.parse(w.execution) as Execution).steps[place.step]?.ask;
  if (!ask || ask.ended) return { gone: true };
  const value = given === null ? null : answerValue(place, ask, given);
  if (given !== null && value === null) return BAD;
  store.journal.setRequest(
    card,
    given === null ? "dismissed" : "answered",
    hand.now,
    given ?? undefined,
  );
  const answers = keptAnswers(w.answers);
  const step = answers[place.step] ?? {};
  step[String(place.i)] = value === null ? null : { value, by: handLabel(hand.device) };
  answers[place.step] = step;
  store.journal.setAutomationWaitAnswers(place.run, JSON.stringify(answers));
  if (ask.questions.every((_, i) => String(i) in step))
    void goOn(store, place.run, { zone: hand.zone, ...(box ? { box } : {}) });
  return { run: place.run };
}

/** The waits past their limit go on, by «sin respuesta» (AU-203): the scheduler's, each tick, 50 at most. */
export function expireWaits(
  store: UserStore,
  o: { now: number; zone: string; box?: Box },
): Promise<void>[] {
  return store.journal
    .automationWaitsDue(o.now, 50)
    .map((run) => goOn(store, run, { zone: o.zone, ...(o.box ? { box: o.box } : {}) }));
}

/** A waiting run is cancelled (AU-203: «Cancelada»): nothing more of it runs, and its cards say «Ya no vale». */
function cancelWait(store: UserStore, r: AutomationRunRow, now: number): void {
  store.journal.dropAutomationWait(r.id);
  endAskCards(store, r.id, "expired", now);
  store.journal.endAutomationRun(r.id, {
    state: "cancelled",
    ended: now,
    ms: r.ms ?? 0,
    step: null,
    error: null,
    line: r.line ?? JSON.stringify(lineOf(store, r.id, [])),
  });
  told(store, { automation: r.automation, run: r.id, state: "cancelled" });
}

/** Every waiting run of an automation is cancelled: it was turned off or deleted (AU-203). */
export function cancelWaits(store: UserStore, id: string, now = Date.now()): void {
  for (const r of store.journal.waitingAutomationRuns(id)) cancelWait(store, r, now);
}

/**
 * At start-up (AU-190, decision 12): every run still queued or running is closed as interrupted, saying the step
 * it was in; nothing is run again. What its finished steps saved stays, and is undone from it (AU-18). One that
 * waits for an answer is not cut (AU-203): it goes on waiting, and its cards stay.
 */
export function interruptRuns(store: UserStore, now = Date.now()): string[] {
  const ids = store.journal.interruptAutomationRuns(now);
  // One that started alone counts as a failure of its streak (AU-102): it tells as one.
  for (const run of ids) {
    // Cut while it went on after a wait: its questions left go with it.
    endAskCards(store, run, "expired", now);
    const notice = keepNotice(store, run);
    if (notice) told(store, { automation: notice.automation, run, state: "interrupted", notice });
  }
  return ids;
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
  // Undoing one that waits cancels its wait (AU-203), whether or not it saved anything yet.
  const waiting = r.state === "waiting";
  if (r.undone !== null || !store.runUndoable(r.id)) {
    if (!waiting) return { refused: "nothing" };
    cancelWait(store, r, hand.now);
    return null;
  }
  try {
    store.undoRun(r.id, { actor: "user", device: hand.device });
  } catch (e) {
    if (e instanceof StoreError && e.code === "conflict" && e.target)
      return { refused: "changed", row: e.target, title: titleOf(store, e.target) };
    if (e instanceof StoreError && e.code === "undo") return { refused: "nothing" };
    throw e;
  }
  store.journal.setAutomationRunUndone(r.id, hand.now);
  // His hand undid it (a personal device: `undoAutomationRun`, `retryRun`): what it saved was wrong (AU-207).
  tellLearned(store, learnUndo(store, r.id, hand.now));
  if (waiting) cancelWait(store, r, hand.now);
  // What it still proposed goes with it: accepting it would save into a run undone (AU-193).
  if (r.proposal && store.journal.proposal(r.proposal)?.status === "pending")
    store.journal.setProposal(r.proposal, "stale", hand.now);
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
    // It runs with that run's trigger data, so a branch over how it started goes the same way (AU-195).
    startedBy: r.startedBy === "schedule" ? "schedule" : "user",
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
      /** Its proposal's state in the inbox (AU-193): waiting, accepted, rejected or no longer valid. */
      proposal: { id: string; status: string } | null;
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
    proposal: r.proposal
      ? { id: r.proposal, status: store.journal.proposal(r.proposal)?.status ?? "stale" }
      : null,
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

/**
 * «Ver todo» of what a run asked (AU-193): its rows as its card in the inbox paints them, 50 at a time from `offset`,
 * with how many it asked; of a run of this automation only.
 */
export function runAsked(
  store: UserStore,
  id: string,
  run: string,
  offset: number,
): { asked: AskedView[]; total: number } | ServiceError {
  if (!runOf(store, id, run)) return NOT_FOUND;
  if (!Number.isInteger(offset) || offset < 0) return BAD;
  return askedOf(store, run, offset) ?? NOT_FOUND;
}

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
  if (r.pruned !== null) return { refused: "pruned" };
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
