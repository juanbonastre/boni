/**
 * What is kept of a run and what is pinned on a draft (docs/automatizaciones.md §5.8, phase F14d S2: AU-99, AU-93,
 * AU-100), shared by «Probar» (service.ts) and a run for real (runs.ts): one step's record and rows into the
 * store's tables of runs, a step's record read back as the screen sees it, and the pins of a draft.
 *
 * A step's record is kept as the engine gave it, but for its rows, which go apart, 50 to a chunk (as a kept test's),
 * and for its «Código»'s writes, of which it keeps the counts: what it saved, asked or would save. The rows of the
 * log are the operations it saved, each with the run's id (AU-18); the record says how many, never which.
 */

import {
  type Automation,
  type Cell,
  type Execution,
  isTrigger,
  outputsOf,
  type Row,
  type StepRecord,
  type StepWrites,
  stepPrints,
} from "@boni/automations";
import { newId } from "@boni/entities";
import type { UserStore } from "@boni/store";
import { type KeptRecord, sha256 } from "./service.ts";

/** A run's id: what every operation it saves carries in the log (`ops.run`). */
export const newRunId = (): string => newId("o").replace(/^o_/, "r_");

/** What a step's «Código» saved, asked or would save, in a run's record: counts, never the rows. */
export interface WritesCount {
  saved: number;
  asked: number;
  /** A test: what it would save (AU-181). */
  would: number;
}

/** A step's record as a run keeps it: the engine's, with counts for its rows and its writes. */
export type RunRecord = Omit<StepRecord, "out" | "writes"> & {
  out: Record<string, number>;
  writes?: WritesCount;
};

/** A step of a run as the screen sees it (AU-99): its record. Steps the run did not reach have none. */
export type RunStepView = RunRecord;

const writesCount = (w: StepWrites | undefined): WritesCount | undefined => {
  if (!w || w.records.length === 0) return undefined;
  const n = w.records.length;
  return w.kind === "applied"
    ? { saved: n, asked: 0, would: 0 }
    : w.kind === "asked"
      ? { saved: 0, asked: n, would: 0 }
      : { saved: 0, asked: 0, would: n };
};

/** One step's record without its rows. */
export function recordOfStep(record: StepRecord): RunRecord {
  const { out, writes, ...rest } = record;
  const counted = writesCount(writes);
  return {
    ...rest,
    out: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])),
    ...(counted ? { writes: counted } : {}),
  };
}

/** Keeps one decided step of a run, `n` its place in the order: its record and its rows, in one transaction. */
export function keepStep(
  store: UserStore,
  run: string,
  n: number,
  step: string,
  record: StepRecord,
): void {
  const rows: Record<string, string[]> = {};
  for (const [output, list] of Object.entries(record.out))
    rows[output] = list.map((r) => JSON.stringify(r));
  store.journal.keepAutomationRunStep(run, {
    step,
    n,
    record: JSON.stringify(recordOfStep(record)),
    rows,
  });
}

/** The step under which a run keeps what it asked and waits for Juan (S3's proposal reads it): no step has this id. */
export const ASKED_STEP = "";

/** Keeps what a run asked (the engine's `asked`, in order), for the proposal S3 makes of it (AU-193). */
export function keepAsked(store: UserStore, run: string, asked: Execution["asked"]): void {
  if (!asked.length) return;
  store.journal.keepAutomationRunStep(run, {
    step: ASKED_STEP,
    n: -1,
    record: JSON.stringify({ asked: asked.length }),
    rows: { asked: asked.map((a) => JSON.stringify(a)) },
  });
}

/**
 * A whole «Probar» kept as a run marked as a test (AU-99): the draft as it ran, each step's record and rows. It saved
 * nothing, so it has nothing to undo; «Probar paso» is not kept. It is no operation of the log.
 */
export function keepTestRun(
  store: UserStore,
  id: string,
  a: Automation,
  e: Execution,
  request: { trigger: string; fields: Record<string, Cell> },
  hand: { device: string },
): string {
  const run = newRunId();
  store.journal.createAutomationRun({
    id: run,
    automation: id,
    version: null,
    test: true,
    state: "running",
    trigger: request.trigger,
    fields: JSON.stringify(request.fields),
    startedBy: "user",
    device: hand.device,
    retryOf: null,
    at: e.started,
    started: e.started,
    doc: JSON.stringify(a),
  });
  e.order.forEach((step, n) => {
    const record = e.steps[step];
    if (record) keepStep(store, run, n, step, record);
  });
  store.journal.endAutomationRun(run, {
    state: e.state,
    ended: e.started + e.ms,
    ms: e.ms,
    step: e.error?.step ?? null,
    error: e.error ? JSON.stringify(e.error) : null,
    line: JSON.stringify({ writes: [], asked: [], outside: false }),
  });
  return run;
}

/** A pinned output as the screen sees it (AU-93): when it was tested, how many rows by output, and whether the step changed since. */
export interface PinView {
  at: number;
  out: Record<string, number>;
  stale: boolean;
}

/**
 * The pins of a draft's steps that are still in it, with `prints` the draft's of now. A pinned trigger is compared
 * with the print it has with the fields of its own pinned row (`triggerPrint`), not with the last test's: pinned from
 * a run (AU-100), its row is that run's, and only a change of the step makes it stale.
 */
export function pinsView(
  store: UserStore,
  id: string,
  a: Automation,
  prints: Readonly<Record<string, string>>,
  tested: Readonly<Record<string, Record<string, Cell>>>,
): Record<string, PinView> {
  const steps = new Set(a.steps.map((s) => s.id));
  const out: Record<string, PinView> = {};
  for (const p of store.journal.automationPins(id)) {
    if (!steps.has(p.step)) continue;
    const k = JSON.parse(p.record) as KeptRecord;
    const output = triggerOutput(a, p.step);
    const [first] = output
      ? (store.journal.automationPinRows(id, p.step, output, 0, 1) as Row[])
      : [];
    const now = first ? triggerPrint(a, tested, p.step, first.json, sha256) : prints[p.step];
    out[p.step] = { at: p.at, out: k.out, stale: now !== p.print };
  }
  return out;
}

/** A kept row without what a test said it would do: the row as the engine gave it. */
const rowOf = (k: Row & { would?: unknown; before?: unknown }): Row => {
  const { would: _w, before: _b, ...row } = k;
  return row;
};

/**
 * The pinned steps of a draft as the engine takes them (AU-93): each one's record with its pinned rows read back,
 * each row with the label it had. Steps no longer in the draft are not given.
 */
export function pinnedRecords(
  store: UserStore,
  id: string,
  a: Automation,
): {
  records: Record<string, StepRecord>;
  pins: Map<string, { print: string; at: number; record: string; rows: Record<string, string[]> }>;
} {
  const steps = new Set(a.steps.map((s) => s.id));
  const records: Record<string, StepRecord> = {};
  const pins = new Map<
    string,
    { print: string; at: number; record: string; rows: Record<string, string[]> }
  >();
  for (const p of store.journal.automationPins(id)) {
    if (!steps.has(p.step)) continue;
    const k = JSON.parse(p.record) as KeptRecord;
    const rows: Record<string, Row[]> = {};
    const kept: Record<string, string[]> = {};
    for (const [output, n] of Object.entries(k.out)) {
      const list = store.journal.automationPinRows(id, p.step, output, 0, n) as Row[];
      rows[output] = list.map(rowOf);
      kept[output] = list.map((r) => JSON.stringify(r));
    }
    const { out: _o, wouldWrite: _w, trigger: _t, clock: _c, would: _wd, ...rest } = k;
    records[p.step] = { ...rest, state: "done", out: rows };
    pins.set(p.step, { print: p.print, at: p.at, record: p.record, rows: kept });
  }
  return { records, pins };
}

/**
 * The print a trigger's pinned output has in a draft: the trigger's with the fields of the row it gave (AU-94), as
 * `stepPrints` makes it for a test with those fields.
 */
export function triggerPrint(
  a: Automation,
  tested: Readonly<Record<string, Record<string, Cell>>>,
  trigger: string,
  fields: Record<string, Cell>,
  digest: (text: string) => string,
): string {
  return stepPrints(a, { ...tested, [trigger]: fields }, digest)[trigger] ?? "";
}

/** The first output of a trigger step: where its one row comes out. */
export const triggerOutput = (a: Automation, trigger: string): string | undefined => {
  const s = a.steps.find((x) => x.id === trigger);
  return s && isTrigger(s) ? outputsOf(s)[0] : undefined;
};
