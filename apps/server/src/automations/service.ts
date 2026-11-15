/**
 * What the server does with an automation in F14b (docs/automatizaciones.md §5.7, §5.8): keep it and its draft, keep
 * where its boxes are, and test it. Each function is what one route or one action runs; none of them is reached but
 * through the list of actions (routes.ts in this folder), and the two engines live side by side until F16 (AU-151):
 * nothing here touches `flows.ts`.
 *
 * «Se guarda solo» (AU-62), in calls:
 * 1. «Nueva» makes no call. The first step added is `createAutomation` with the whole document: the automation
 *    exists from then on, with its draft at `rev` 1.
 * 2. Every change of the draft after that (a step, an arrow, a parameter, a setting, the name) is `keepDraft` with
 *    the whole document, sent after a short pause without changes and at once when the editor is left, the window
 *    hidden or the app closed. One save at a time, in order; one that fails is tried again, waiting longer each time.
 * 3. The answer says the draft's new `rev` and which steps' kept tests are now stale (AU-92).
 * 4. Moving a box is `placeSteps`, on its own: it changes no `rev` and makes nothing stale (AU-05).
 * The last save wins, as with a flow's draft today (D-55): the draft says which device wrote it last.
 * A draft is refused when it is not the format (`parseAutomation`), when its `id` is another's, or over 200,000
 * characters. One with problems of `validate` is kept all the same: a draft may be half made.
 */

import type { Trust } from "@boni/agent";
import type {
  Automation,
  Cell,
  Problem,
  StepError,
  StepRecord,
  StepState,
} from "@boni/automations";
import type { Label } from "@boni/entities";
import type { AutomationPlace, UserStore } from "@boni/store";
import { notBuilt } from "./pending.ts";

/** The largest draft kept, in characters of its JSON: as a flow's draft. */
export const DRAFT_MAX = 200_000;
/** How many rows of a step's input or output one call gives (AU-71, AU-72). */
export const ROWS_PAGE = 50;

/** Who asks: Juan, from one of his devices. */
export interface Hand {
  device: string;
  now: number;
}

/** One output of a step in its last test: how many rows, never the rows (they are asked by page: `testRows`). */
export interface StepTestView {
  state: StepState;
  /** When it was tested (epoch ms) and how long it took. */
  at: number;
  ms: number;
  /** Rows in by input and rows out by output, in the catalogue's order. */
  in: Record<string, number>;
  out: Record<string, number>;
  retries: number;
  failed: number;
  /** Writes of a test are never done: how many it would do («Haría esto»). */
  wouldWrite: number;
  /** Why it failed: `error.failure` is the key the screen says, with the parameter at fault (AU-84). */
  error?: StepError;
  /** Its kept test no longer stands for the step as it is (AU-92). */
  stale: boolean;
}

/** What the editor opens with. */
export interface AutomationView {
  id: string;
  rev: number;
  /** The draft: the automation as it is being made. */
  automation: Automation;
  places: AutomationPlace[];
  /** The last test of each step that has one, by step id. */
  tests: Record<string, StepTestView>;
  /**
   * By trigger id, the fields it was last tested with: what «Probar» offers again (AU-94). Not kept apart: they are
   * the one row the trigger gave in its kept test (the first row of its only output).
   */
  tested: Record<string, Record<string, Cell>>;
  /** The device that saved it last, and when. */
  device: string | null;
  updated: number;
}

export type ServiceError = { error: "not-found" | "bad-request" | "too-large" };

/** The first step added to a new canvas: the automation and its first draft. The id is made here. */
export function createAutomation(
  _store: UserStore,
  _doc: unknown,
  _hand: Hand,
): AutomationView | ServiceError {
  return notBuilt("createAutomation (AU-61, AU-62)");
}

/** The editor's read of one automation, or `not-found` (a deleted one too). */
export function automationView(_store: UserStore, _id: string): AutomationView | ServiceError {
  return notBuilt("automationView");
}

/** A save of the draft: see «Se guarda solo» above. */
export function keepDraft(
  _store: UserStore,
  _id: string,
  _doc: unknown,
  _hand: Hand,
): { rev: number; stale: string[] } | ServiceError {
  return notBuilt("keepDraft (AU-62, AU-92)");
}

/** Where boxes were left (AU-05): the steps named, the rest as they were. A step the draft lacks is `bad-request`. */
export function placeSteps(
  _store: UserStore,
  _id: string,
  _places: readonly AutomationPlace[],
): { ok: true } | ServiceError {
  return notBuilt("placeSteps (AU-05)");
}

/** «Duplicar» (AU-62): a new automation named «<name> (copia)» with the same steps, arrows and places; no tests. */
export function duplicateAutomation(
  _store: UserStore,
  _id: string,
  _copyName: string,
  _hand: Hand,
): AutomationView | ServiceError {
  return notBuilt("duplicateAutomation (AU-62)");
}

/** «Eliminar» and its «Deshacer» (AU-62): out of the list and back, with everything it had. */
export function setDeleted(
  _store: UserStore,
  _id: string,
  _deleted: boolean,
): { ok: true } | ServiceError {
  return notBuilt("setDeleted (AU-62)");
}

export interface TestRequest {
  /** The trigger it starts in. */
  trigger: string;
  /** What that trigger asks, by field key, as Juan typed them (AU-94): labelled as his, from his device. */
  fields: Record<string, Cell>;
  /** «Probar paso»: only that step and what it lacks (AU-91). Absent: the whole draft (AU-90). */
  step?: string;
}

export interface TestAnswer {
  /** `invalid`: it did not run, and `problems` says why (AU-64); nothing kept changes. */
  state: "done" | "failed" | "invalid";
  problems: Problem[];
  ms: number;
  /** The steps that ran now and the ones taken from their kept test, in order. */
  ran: string[];
  reused: string[];
  /** Every step's test as it stands after this one, by step id. */
  tests: Record<string, StepTestView>;
  /** The step that stopped it, when `failed`. */
  failedAt?: string;
}

/**
 * «Probar» and «Probar paso» (AU-90, AU-91, AU-94, AU-115): runs the draft as the store has it, from `trigger`,
 * with the real `Collections` and the real `Policy` and `test: true`. It reads and computes for real; it writes
 * nothing in any collection, proposes nothing, notifies nothing and leaves no run in the journal: the operation log
 * is as long after it as before. The only thing it changes is the kept test of the steps that ran.
 * A trigger of any type is tested this way, by hand, with the fields it declares (AU-115).
 */
export async function testAutomation(
  _store: UserStore,
  _id: string,
  _request: TestRequest,
  _hand: Hand & { trust: Trust },
): Promise<TestAnswer | ServiceError> {
  return notBuilt("testAutomation (AU-90, AU-91)");
}

/** A row as the step view paints it: its values, and of each field whether it came from outside. */
export interface RowView {
  json: Record<string, Cell>;
  /** The row's label and, only where they differ, each field's (AU-162): what «de fuera» is painted from. */
  label: Label;
  fields?: Record<string, Label>;
  /** For a row a test would write («Haría esto», AU-72): the saved row as it is now, or null for one it would make. */
  before?: Record<string, Cell> | null;
  /** `create`, `update` or `trash`, for such a row. */
  would?: "create" | "update" | "trash";
}

/**
 * Some rows of the last test of a step (AU-71, AU-72): of one of its outputs, or of what came in by one of its
 * inputs (the rows the steps before it gave, joined in the engine's order). `ROWS_PAGE` at most per call, whatever
 * `limit` says; `total` is how many there are. Read from the kept chunks, never the whole test (A-15).
 */
export function testRows(
  _store: UserStore,
  _id: string,
  _at: { step: string; side: "in" | "out"; name: string; offset: number; limit: number },
): { rows: RowView[]; total: number } | ServiceError {
  return notBuilt("testRows (AU-71, AU-72)");
}

/**
 * What the app previews a step's expressions with (AU-20): the first row that came into the step and, for each step
 * before it by name, the row that one comes from (`item`: null when no row pairs with it) and its first and last
 * rows. One call when a step is opened and after each test; the app resolves every keystroke itself.
 */
export function testSample(
  _store: UserStore,
  _id: string,
  _step: string,
):
  | {
      current: RowView | null;
      total: number;
      steps: Record<string, { item: RowView | null; first: RowView | null; last: RowView | null }>;
    }
  | ServiceError {
  return notBuilt("testSample (AU-20)");
}

/** What is kept of a step's record: everything but its rows (store's `AutomationTestRow.record`). */
export type KeptRecord = Omit<StepRecord, "out"> & {
  out: Record<string, number>;
  wouldWrite: number;
};
