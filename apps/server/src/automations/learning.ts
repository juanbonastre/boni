/**
 * What Boni learns from Juan's answers to an automation (docs/automatizaciones.md §5.15, phase F15 S3: AU-207,
 * AU-209, AU-210, AU-212), outside the automation (decision 10 of §10): nothing here writes a draft, a version or a
 * step, and no model reads or moves a count.
 *
 * - **Signals** (AU-207): one decision per cell and run, kept where the decisions of docs/fiabilidad.md are, with the
 *   cell as its area (`cellArea`: automation, step, collection, action and the step's print, so a changed step starts
 *   another count). A run that saved with «Sí» is one decision to judge (`recordRun`); Juan's «Aceptar» or
 *   «Rechazar» of its proposal on a personal device judges it at once (`learnAnswer`), and so does «Deshacer lo que
 *   hizo» (`learnUndo`). Once a day the operation log is read by each run's operations and their rows (`judgeCells`):
 *   his hand on a personal device changing the same fields of a row, or trashing one, within 7 days makes it wrong;
 *   untouched for 7 days, what was saved with «Sí» is right. Another run, an assistant or an import moves nothing.
 * - **The suggestion** (AU-209): at 20 judged with 95 % right in a cell in «Preguntar», once, at most one a day for
 *   every learner (`maySuggest`), never for «Eliminar», never again after a «No» while the step stays the same. It is
 *   a notice: it never sets a «Sí», in the version or the draft (decision 13).
 * - **The pause** (AU-210, decision 16): when a «Sí» fails and the cell's last results go back (`backOff`: three in a
 *   row, or a fifth of the last 20), the runs treat it as «Preguntar» (`pausedDoc`, read by publish.ts with the
 *   version). The published version does not change, and a pause only lowers. Only his hand lifts it (`unpause`).
 * - **The limits** (AU-212): with «Aprender» off, decisions are still kept (they are his) and nothing is suggested
 *   or paused.
 *
 * What it keeps beside the decisions is one setting of his store (D-02): the pauses, the suggestions made and the
 * «No» given, by cell; and the day it last judged.
 */

import { randomUUID } from "node:crypto";
import { BACK_OFF, backOff, earned, type Trust } from "@boni/agent";
import {
  type Automation,
  cellPrint,
  type Execution,
  lowerCells,
  parseAutomation,
  stepCell,
  type WriteAction,
  writeCells,
} from "@boni/automations";
import type { AutomationRunRow, DecisionRow, LogRow, UserStore } from "@boni/store";
import { CELL_AREA, DAY, learningOn, markSuggested, maySuggest } from "../learning.ts";
import type { AutomationNotice } from "./notices.ts";
import { ACCEPT_RUN, askedCells } from "./proposal.ts";
import { publishedOf, sha256 } from "./service.ts";

export { CELL_AREA };

/** A cell's decisions are of class B (they write his data), as docs/fiabilidad.md counts them. */
const CELL_COST = "B" as const;
/** How long his hand may correct what a run saved and make it wrong (AU-207). */
export const CORRECTED_WITHIN = 7 * DAY;
/** The judged decisions a count reads: the last 20 (docs/fiabilidad.md). */
const LAST = BACK_OFF.last;
/** How far back a judge looks at most when the server was off for long: a month past the 7 days. */
const CATCH_UP = 30 * DAY;

const STATE = "automations/learning";
const JUDGED = "automations/learning-judged";

/** A cell as the counts know it. */
export interface CellKey {
  automation: string;
  step: string;
  collection: string;
  action: WriteAction;
  /** The step's print (`cellPrint`): another one is another count. */
  print: string;
}

export const cellArea = (c: CellKey): string =>
  CELL_AREA + JSON.stringify([c.automation, c.step, c.collection, c.action, c.print]);

export function cellOfArea(area: string): CellKey | null {
  if (!area.startsWith(CELL_AREA)) return null;
  try {
    const v = JSON.parse(area.slice(CELL_AREA.length)) as unknown;
    if (!Array.isArray(v) || v.length !== 5 || !v.every((x) => typeof x === "string")) return null;
    const [automation, step, collection, action, print] = v as string[];
    if (action !== "create" && action !== "update" && action !== "remove") return null;
    return {
      automation: automation as string,
      step: step as string,
      collection: collection as string,
      action,
      print: print as string,
    };
  } catch {
    return null;
  }
}

/** What is kept of a cell beside its decisions. */
interface CellState extends CellKey {
  /** Paused (AU-210): when, why and which run's failure did it. */
  paused?: { at: number; why: "inARow" | "share"; run: string };
  /** When it was suggested (AU-209). */
  suggested?: number;
  /** When Juan said «No» to its suggestion. */
  declined?: number;
  /** When his hand last lifted a pause: a new pause counts only what came after. */
  lifted?: number;
}

type LearningState = Record<string, CellState>;

function stateOf(store: UserStore): LearningState {
  try {
    const v = JSON.parse(store.setting(STATE) ?? "{}") as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as LearningState) : {};
  } catch {
    return {};
  }
}

const saveState = (store: UserStore, s: LearningState) =>
  store.setSetting(STATE, Object.keys(s).length ? JSON.stringify(s) : null);

// ---------------------------------------------------------------- what a run saved

/** The run and the version it ran, as kept: a test, or one without a version, teaches nothing. */
function ranOf(store: UserStore, run: string): { r: AutomationRunRow; doc: Automation } | null {
  const r = store.journal.automationRun(run);
  if (!r || r.test || r.version === null) return null;
  const v = store.journal.automationVersion(r.automation, r.version);
  if (!v) return null;
  try {
    return { r, doc: parseAutomation(JSON.parse(v.doc)) };
  } catch {
    return null;
  }
}

/** The print of each step of one document, worked out once. */
function printer(doc: Automation): (step: string) => string {
  const kept = new Map<string, string>();
  return (step) => {
    let p = kept.get(step);
    if (p === undefined) {
      p = cellPrint(doc, step, sha256);
      kept.set(step, p);
    }
    return p;
  };
}

const ACTION_OF: Record<string, WriteAction | undefined> = {
  create: "create",
  update: "update",
  delete: "remove",
};

const cellOf = (collection: string, action: WriteAction) => `${collection}\u0000${action}`;

/** The fields an operation wrote (its after), the body as `$body`. */
function fieldsOf(op: LogRow): string[] {
  const after = op.after as {
    entity?: { values?: Record<string, unknown>; body?: unknown };
    values?: Record<string, unknown>;
    body?: unknown;
  } | null;
  const values = op.kind === "create" ? after?.entity?.values : after?.values;
  const body = op.kind === "create" ? after?.entity?.body : after?.body;
  return [...Object.keys(values ?? {}), ...(body !== undefined ? ["$body"] : [])];
}

/** What a run saved of one collection and action: each row with the fields it wrote, and when it last saved. */
interface Saved {
  rows: Map<string, { fields: Set<string>; trashed: boolean }>;
  seqs: Set<number>;
  at: number;
}

/** What a run saved, by collection and action, from its operations (AU-18: they all carry its id). */
function savedOf(store: UserStore, run: string): Map<string, Saved> {
  const out = new Map<string, Saved>();
  const types = store.schema().types;
  const keyOf = new Map<string, string | null>();
  for (const op of store.log({ run })) {
    const action = ACTION_OF[op.kind];
    if (!action || op.undoes !== null) continue;
    let collection = keyOf.get(op.target);
    if (collection === undefined) {
      const e = store.get(op.target);
      collection = (e ? types[e.entity.type]?.key : undefined) ?? null;
      keyOf.set(op.target, collection);
    }
    if (!collection) continue;
    const k = cellOf(collection, action);
    const s = out.get(k) ?? { rows: new Map(), seqs: new Set(), at: op.at };
    const row = s.rows.get(op.target) ?? { fields: new Set<string>(), trashed: false };
    for (const f of fieldsOf(op)) row.fields.add(f);
    if (op.kind === "delete") row.trashed = true;
    s.rows.set(op.target, row);
    s.seqs.add(op.seq);
    s.at = Math.max(s.at, op.at);
    out.set(k, s);
  }
  return out;
}

// ---------------------------------------------------------------- the signals (AU-207)

/**
 * A run for real ended: each cell in «Sí» that saved is one decision, judged later (undone, corrected or left for 7
 * days). A cell paused at the time asked instead, and its answer is what counts.
 */
export function recordRun(store: UserStore, run: string, ran: Execution): void {
  const x = ranOf(store, run);
  if (!x) return;
  const doc = pausedDoc(store, x.r.automation, x.doc);
  // Only a cell in «Sí» whose step ran can have saved alone: no other run's log is read.
  const yes = writeCells(doc).filter((c) => c.mode === "yes" && ran.steps[c.step]);
  if (!yes.length) return;
  const saved = savedOf(store, run);
  const print = printer(doc);
  for (const c of yes) {
    const s = saved.get(cellOf(c.collection, c.action));
    if (!s) continue;
    const key: CellKey = {
      automation: x.r.automation,
      step: c.step,
      collection: c.collection,
      action: c.action,
      print: print(c.step),
    };
    store.journal.addDecision({
      id: randomUUID(),
      run,
      area: cellArea(key),
      cost: CELL_COST,
      p: 1,
      outcome: "do",
      detail: { version: x.r.version },
      at: s.at,
    });
  }
}

/**
 * Juan answered a run's proposal (AU-207): on a personal device, each cell it asked for is one decision, right when
 * accepted and wrong when rejected. Only his act counts, whatever the rows say (P9). An answer already counted, a
 * shared device, or a proposal that is not a run's count nothing.
 */
export function learnAnswer(
  store: UserStore,
  proposal: string,
  trust: Trust,
  now: number,
): AutomationNotice[] {
  if (trust !== "personal") return [];
  const p = store.journal.proposal(proposal);
  if (!p || p.tool !== ACCEPT_RUN) return [];
  if (p.status !== "accepted" && p.status !== "rejected") return [];
  const run = (p.view as { run?: { run?: unknown } } | null)?.run?.run;
  if (typeof run !== "string") return [];
  if (
    store.journal
      .decisionsOf(run)
      .some((d) => (d.detail as { proposal?: unknown } | null)?.proposal === proposal)
  )
    return [];
  const x = ranOf(store, run);
  if (!x) return [];
  const right = p.status === "accepted";
  const saved = right ? savedOf(store, run) : null;
  const print = printer(x.doc);
  const notices: AutomationNotice[] = [];
  for (const c of askedCells(store, run)) {
    const key: CellKey = {
      automation: x.r.automation,
      step: c.step,
      collection: c.collection,
      action: c.action,
      print: print(c.step),
    };
    const id = randomUUID();
    store.journal.addDecision({
      id,
      run,
      area: cellArea(key),
      cost: CELL_COST,
      p: 1,
      outcome: "ask",
      detail: { version: x.r.version, proposal },
      at: saved?.get(cellOf(c.collection, c.action))?.at ?? now,
    });
    store.journal.setDecisionResult(id, right ? "right" : "wrong", now);
    const n = right ? suggest(store, key, run, now) : pause(store, key, run, now);
    if (n) notices.push(n);
  }
  return notices;
}

/** «Deshacer lo que hizo» (AU-207): every decision of the run is wrong, the last of his acts being what counts. */
export function learnUndo(store: UserStore, run: string, now: number): AutomationNotice[] {
  const notices: AutomationNotice[] = [];
  const areas = new Set<string>();
  for (const d of store.journal.decisionsOf(run)) {
    if (!d.area.startsWith(CELL_AREA) || d.result === "wrong") continue;
    store.journal.reviseDecision(d.id, "wrong", now);
    areas.add(d.area);
  }
  for (const area of areas) {
    const key = cellOfArea(area);
    const n = key ? pause(store, key, run, now) : null;
    if (n) notices.push(n);
  }
  return notices;
}

/** His hand: an operation of the log made by hand (no run) on a personal device. */
const byHand = (op: LogRow, personal: ReadonlySet<string>) =>
  op.actor === "user" && op.run === null && op.device !== null && personal.has(op.device);

/**
 * The day's look at the operation log (AU-207): the decisions of the last days still standing, each run's
 * operations once and each of its rows' operations once, by their indexes. Corrected by his hand within 7 days, a
 * decision is wrong; what was saved with «Sí» and left 7 days is right. `personal`: his personal devices' names.
 * Gives what it judged and what it paused.
 */
export function judgeCells(
  store: UserStore,
  now: number,
  personal: ReadonlySet<string>,
): { judged: number; notices: AutomationNotice[] } {
  const last = Number(store.setting(JUDGED)) || null;
  const since =
    last === null
      ? now - CORRECTED_WITHIN - DAY
      : Math.max(last - CORRECTED_WITHIN - DAY, now - CORRECTED_WITHIN - CATCH_UP);
  const standing = store.journal
    .decisionsSince(CELL_AREA, since)
    .filter((d) => d.result !== "wrong" && (d.outcome === "do" || d.result === "right"));
  const byRun = new Map<string, DecisionRow[]>();
  for (const d of standing) byRun.set(d.run, [...(byRun.get(d.run) ?? []), d]);
  const onRow = new Map<string, LogRow[]>();
  const opsOf = (row: string) => {
    let ops = onRow.get(row);
    if (!ops) {
      ops = store.opsOn(row, since, now).filter((op) => byHand(op, personal));
      onRow.set(row, ops);
    }
    return ops;
  };
  /** When his hand first corrected what was saved, after `from` and up to `to`, or null. */
  const corrected = (s: Saved, from: number, to: number): number | null => {
    let first: number | null = null;
    for (const [row, w] of s.rows)
      for (const op of opsOf(row)) {
        if (op.at <= from || op.at > to) continue;
        const hit =
          op.undoes !== null
            ? s.seqs.has(op.undoes)
            : op.kind === "delete" ||
              (op.kind === "restore" && w.trashed) ||
              (op.kind === "update" && fieldsOf(op).some((f) => w.fields.has(f)));
        if (hit && (first === null || op.at < first)) first = op.at;
      }
    return first;
  };
  let judged = 0;
  const notices: AutomationNotice[] = [];
  for (const [run, ds] of byRun) {
    const saved = savedOf(store, run);
    for (const d of ds) {
      const key = cellOfArea(d.area);
      if (!key) continue;
      const s = saved.get(cellOf(key.collection, key.action));
      const hit = s ? corrected(s, d.at, Math.min(d.at + CORRECTED_WITHIN, now)) : null;
      if (hit !== null) {
        store.journal.reviseDecision(d.id, "wrong", hit);
        judged++;
        const n = pause(store, key, run, now);
        if (n) notices.push(n);
      } else if (d.result === null && now - d.at >= CORRECTED_WITHIN) {
        store.journal.setDecisionResult(d.id, "right", d.at + CORRECTED_WITHIN);
        judged++;
      }
    }
  }
  store.setSetting(JUDGED, String(now));
  return { judged, notices };
}

/** Whether a day passed since the last look (the scheduler's tick asks it every minute: one setting). */
export function judgeDue(store: UserStore, now: number): boolean {
  const last = Number(store.setting(JUDGED)) || null;
  return last === null || now - last >= DAY;
}

// ---------------------------------------------------------------- the counts, the suggestion and the pause

/** A cell's last judged results, newest last (true = right), by its area's index; taken after `after`. */
function resultsOf(store: UserStore, area: string, after = 0): boolean[] {
  return store.journal.judgedDecisions(area, LAST, after).map((d) => d.result === "right");
}

/** The cell as the version published now has it, when it is the same step (by its print); else null. */
function publishedCell(store: UserStore, key: CellKey) {
  const pub = publishedOf(store, key.automation);
  if (!pub) return null;
  const cell = stepCell(pub.automation, key.step, key.collection, key.action);
  if (!cell || cellPrint(pub.automation, key.step, sha256) !== key.print) return null;
  return { cell, automation: pub.automation };
}

const collectionName = (store: UserStore, key: string): string =>
  Object.values(store.schema().types).find((t) => t.key === key)?.name ?? key;

const stepName = (a: Automation, step: string): string =>
  a.steps.find((s) => s.id === step)?.name ?? "";

const noticeOf = (
  kind: "paused" | "suggested",
  text: string,
  automation: string,
  run: string,
): AutomationNotice => ({ kind, text, automation, run });

/**
 * A «Sí» failed (AU-210): with «Aprender» on, its cell paused when its last results go back (`backOff`). Only a cell
 * the published version has in «Sí» for the same step; one already paused stays as it is. Nothing is written into
 * the version or the draft.
 */
function pause(store: UserStore, key: CellKey, run: string, now: number): AutomationNotice | null {
  if (!learningOn(store)) return null;
  const pub = publishedCell(store, key);
  if (!pub || pub.cell.mode !== "yes") return null;
  const area = cellArea(key);
  const state = stateOf(store);
  if (state[area]?.paused) return null;
  // After «Quitar pausa», the failures before it were already heard.
  const results = resultsOf(store, area, state[area]?.lifted ?? 0);
  if (!backOff(results)) return null;
  const tail = results.slice(-BACK_OFF.inARow);
  const why = tail.length === BACK_OFF.inARow && tail.every((r) => !r) ? "inARow" : "share";
  state[area] = { ...state[area], ...key, paused: { at: now, why, run } };
  saveState(store, state);
  const wrong = results.filter((r) => !r).length;
  const said =
    why === "inARow"
      ? `${BACK_OFF.inARow} seguidas deshechas, rechazadas o corregidas`
      : `${wrong} de las últimas ${results.length} deshechas, rechazadas o corregidas`;
  return noticeOf(
    "paused",
    `Boni vuelve a preguntar en «${stepName(pub.automation, key.step)}» · ${collectionName(store, key.collection)}: ${said}`,
    key.automation,
    run,
  );
}

/**
 * An answer was right (AU-209): with «Aprender» on, a cell in «Preguntar» whose last 20 judged are 95 % right is
 * suggested once, within every learner's day (`maySuggest`). Never for «Eliminar», never after a «No» for the same
 * step, never twice. It is a notice and nothing else: no «Sí», in the version or the draft.
 */
function suggest(
  store: UserStore,
  key: CellKey,
  run: string,
  now: number,
): AutomationNotice | null {
  if (key.action === "remove" || !maySuggest(store, now)) return null;
  const pub = publishedCell(store, key);
  if (!pub || pub.cell.mode !== "ask") return null;
  const area = cellArea(key);
  const state = stateOf(store);
  if (state[area]?.declined || state[area]?.suggested) return null;
  const results = resultsOf(store, area);
  const right = results.filter(Boolean).length;
  if (!earned(results.length, right)) return null;
  state[area] = { ...state[area], ...key, suggested: now };
  saveState(store, state);
  markSuggested(store, now);
  return noticeOf(
    "suggested",
    `Has aceptado ${right} de ${results.length} propuestas de «${stepName(pub.automation, key.step)}» en ${collectionName(store, key.collection)}. ¿Quieres que guarde sin preguntar?`,
    key.automation,
    run,
  );
}

/**
 * The version a run of `automation` runs with its paused cells lowered to «Preguntar» (AU-210): only cells in «Sí»
 * whose step is the one paused (by its print), and only lowered. The same document when none is paused.
 */
export function pausedDoc(store: UserStore, automation: string, doc: Automation): Automation {
  const paused = Object.values(stateOf(store)).filter(
    (c) => c.automation === automation && c.paused,
  );
  if (!paused.length) return doc;
  const print = printer(doc);
  return lowerCells(doc, (step, collection, action) =>
    paused.some(
      (c) =>
        c.step === step &&
        c.collection === collection &&
        c.action === action &&
        c.print === print(step),
    ),
  );
}

// ---------------------------------------------------------------- what the app reads and his hand does

/** One cell of the published version with its count (AU-208 paints it; P2/P3). */
export interface CellLearning extends CellKey {
  mode: "yes" | "ask";
  /** Its last judged decisions (at most 20) and how many were right. */
  decided: number;
  right: number;
  paused: { at: number; why: "inARow" | "share" } | null;
  suggested: number | null;
  declined: number | null;
}

/** The cells of an automation's published version with their counts: one query per cell, by the area's index. */
export function learningOf(store: UserStore, automation: string): CellLearning[] {
  const pub = publishedOf(store, automation);
  if (!pub) return [];
  const state = stateOf(store);
  const print = printer(pub.automation);
  return writeCells(pub.automation).flatMap((c) => {
    if (c.mode !== "yes" && c.mode !== "ask") return [];
    const key: CellKey = {
      automation,
      step: c.step,
      collection: c.collection,
      action: c.action,
      print: print(c.step),
    };
    const area = cellArea(key);
    const results = resultsOf(store, area);
    const s = state[area];
    return [
      {
        ...key,
        mode: c.mode,
        decided: results.length,
        right: results.filter(Boolean).length,
        paused: s?.paused ? { at: s.paused.at, why: s.paused.why } : null,
        suggested: s?.suggested ?? null,
        declined: s?.declined ?? null,
      },
    ];
  });
}

/** What his hand may do to a pause or a suggestion: only from a personal device (decision 13). */
export type LearningRefusal = { refused: "not-personal" } | { refused: "nothing" };

/** «Quitar pausa» (AU-210): the cell asks no more because of the pause; the version was never changed. */
export function unpause(
  store: UserStore,
  key: CellKey,
  hand: { trust: Trust; now: number },
): LearningRefusal | null {
  if (hand.trust !== "personal") return { refused: "not-personal" };
  const area = cellArea(key);
  const state = stateOf(store);
  const s = state[area];
  if (!s?.paused) return { refused: "nothing" };
  const { paused: _paused, ...rest } = s;
  state[area] = { ...rest, lifted: hand.now };
  saveState(store, state);
  return null;
}

/** «No» to a suggestion (AU-209): it is not made again while the step stays the same. */
export function declineSuggestion(
  store: UserStore,
  key: CellKey,
  hand: { trust: Trust; now: number },
): LearningRefusal | null {
  if (hand.trust !== "personal") return { refused: "not-personal" };
  const area = cellArea(key);
  const state = stateOf(store);
  if (!state[area]?.suggested) return { refused: "nothing" };
  state[area] = { ...(state[area] as CellState), declined: hand.now };
  saveState(store, state);
  return null;
}
