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

import { createHash } from "node:crypto";
import type { Trust } from "@boni/agent";
import {
  type Automation,
  actionOf,
  arrowsInto,
  CannotRun,
  type Cell,
  type Collections,
  executionOrder,
  FormatError,
  inputsOf,
  isTrigger,
  type Kept,
  OUT,
  outputsOf,
  type Print,
  type Problem,
  parseAutomation,
  type Row,
  runTest,
  SETTINGS_DEFAULTS,
  type Step,
  type StepError,
  type StepRecord,
  type StepState,
  staleSteps,
  stepPrints,
} from "@boni/automations";
import { type Label, label, newId } from "@boni/entities";
import type { AutomationPlace, AutomationTestRow, UserStore } from "@boni/store";
import { handLabel } from "../actions.ts";
import { storeCollections } from "./collections.ts";
import { serverDates } from "./dates.ts";
import { handPolicy } from "./policy.ts";

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

const NOT_FOUND: ServiceError = { error: "not-found" };
const BAD: ServiceError = { error: "bad-request" };

/** An automation's id: a ULID like any of the account's, with its own prefix. */
const automationId = () => `a_${newId("e").slice(2)}`;

/** The label of what Juan wrote in an automation: its fixed values and the collection keys its steps name. */
export const automationLabel = (id: string): Label =>
  label("user", "personal", [{ kind: "user-edit", id: `automation:${id}` }]);

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** A document as a draft: its JSON within the size, in the format. `id`: the id it must have (or is given). */
function draftOf(doc: unknown, id: string, give: boolean): Automation | ServiceError {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return BAD;
  const withId = give ? { ...(doc as object), id } : doc;
  let text: string;
  try {
    text = JSON.stringify(withId);
  } catch {
    return BAD;
  }
  if (text.length > DRAFT_MAX) return { error: "too-large" };
  let a: Automation;
  try {
    a = parseAutomation(withId);
  } catch (e) {
    if (e instanceof FormatError) return BAD;
    throw e;
  }
  return a.id === id ? a : BAD;
}

/** The automation, if there is one and it is not deleted, with its draft parsed. */
function open(store: UserStore, id: string) {
  const row = store.journal.automation(id);
  const draft = row && !row.deleted ? store.journal.automationDraft(id) : null;
  if (!draft) return null;
  return { draft, automation: parseAutomation(JSON.parse(draft.doc)) };
}

const isError = (x: unknown): x is ServiceError =>
  typeof x === "object" && x !== null && "error" in x && Object.keys(x).length === 1;

/** The first step added to a new canvas: the automation and its first draft. The id is made here. */
export function createAutomation(
  store: UserStore,
  doc: unknown,
  hand: Hand,
): AutomationView | ServiceError {
  const id = automationId();
  const a = draftOf(doc, id, true);
  if (isError(a)) return a;
  store.journal.createAutomation(
    { id, by: "user", created: hand.now },
    { id, name: a.name, doc: JSON.stringify(a), device: hand.device, updated: hand.now },
  );
  return automationView(store, id);
}

/** What is kept of a step's test, read back: the record without rows, and its print. */
function keptTests(
  store: UserStore,
  id: string,
): Map<string, AutomationTestRow & { kept: KeptRecord }> {
  return new Map(
    store.journal
      .automationTests(id)
      .map((t) => [t.step, { ...t, kept: JSON.parse(t.record) as KeptRecord }]),
  );
}

/** The fields given for a trigger as its row will hold them: each it declares, null where none was given (AU-94),
 * so the print of the test is the one its kept row gives back. A field it does not declare stays, for the engine to
 * refuse. */
function asDeclared(
  a: Automation,
  trigger: string,
  given: Record<string, Cell>,
): Record<string, Cell> {
  const s = a.steps.find((x) => x.id === trigger);
  const declared = Array.isArray(s?.params.fields) ? s.params.fields : [];
  const out: Record<string, Cell> = {};
  for (const f of declared) {
    const key = (f as Record<string, unknown>).key;
    if (typeof key === "string") out[key] = given[key] ?? null;
  }
  return { ...out, ...given };
}

/** By trigger id, the fields of the row it gave in its kept test (AU-94). */
function testedFields(
  store: UserStore,
  a: Automation,
  kept: ReadonlyMap<string, { kept: KeptRecord }>,
): Record<string, Record<string, Cell>> {
  const out: Record<string, Record<string, Cell>> = {};
  for (const s of a.steps) {
    if (!isTrigger(s) || !kept.has(s.id)) continue;
    const output = outputsOf(s)[0];
    const [first] = output ? store.journal.automationTestRows(a.id, s.id, output, 0, 1) : [];
    if (first) out[s.id] = (JSON.parse(first) as KeptRow).json;
  }
  return out;
}

function views(
  kept: ReadonlyMap<string, AutomationTestRow & { kept: KeptRecord }>,
  prints: Readonly<Record<string, Print>>,
): Record<string, StepTestView> {
  const tests: Record<string, StepTestView> = {};
  for (const [step, t] of kept) {
    const k = t.kept;
    tests[step] = {
      state: k.state,
      at: t.at,
      ms: k.ms,
      in: k.in,
      out: k.out,
      retries: k.retries,
      failed: k.failed,
      wouldWrite: k.wouldWrite,
      ...(k.error ? { error: k.error } : {}),
      stale: prints[step] !== undefined && prints[step] !== t.print,
    };
  }
  return tests;
}

/** The editor's read of one automation, or `not-found` (a deleted one too). */
export function automationView(store: UserStore, id: string): AutomationView | ServiceError {
  const o = open(store, id);
  if (!o) return NOT_FOUND;
  const kept = keptTests(store, id);
  const tested = testedFields(store, o.automation, kept);
  const prints = stepPrints(o.automation, tested, sha256);
  return {
    id,
    rev: o.draft.rev,
    automation: o.automation,
    places: store.journal.automationLayout(id),
    tests: views(kept, prints),
    tested,
    device: o.draft.device,
    updated: o.draft.updated,
  };
}

/** A save of the draft: see «Se guarda solo» above. */
export function keepDraft(
  store: UserStore,
  id: string,
  doc: unknown,
  hand: Hand,
): { rev: number; stale: string[] } | ServiceError {
  if (!open(store, id)) return NOT_FOUND;
  const a = draftOf(doc, id, false);
  if (isError(a)) return a;
  const rev = store.journal.saveAutomationDraft({
    id,
    name: a.name,
    doc: JSON.stringify(a),
    device: hand.device,
    updated: hand.now,
  });
  // The steps the draft no longer has lost their test with the save; the rest are compared by their prints.
  const kept = keptTests(store, id);
  const prints = stepPrints(a, testedFields(store, a, kept), sha256);
  return { rev, stale: staleSteps(prints, printsOf(kept)) };
}

const printsOf = (kept: ReadonlyMap<string, AutomationTestRow>) =>
  Object.fromEntries([...kept].map(([step, t]) => [step, { print: t.print }]));

/** Where boxes were left (AU-05): the steps named, the rest as they were. A step the draft lacks is `bad-request`. */
export function placeSteps(
  store: UserStore,
  id: string,
  places: readonly AutomationPlace[],
): { ok: true } | ServiceError {
  const o = open(store, id);
  if (!o) return NOT_FOUND;
  const steps = new Set(o.automation.steps.map((s) => s.id));
  const ok = (p: AutomationPlace) =>
    p && typeof p === "object" && steps.has(p.step) && Number.isFinite(p.x) && Number.isFinite(p.y);
  if (!Array.isArray(places) || !places.every(ok)) return BAD;
  store.journal.placeAutomationSteps(
    id,
    places.map((p) => ({ step: p.step, x: p.x, y: p.y })),
  );
  return { ok: true };
}

/** «Duplicar» (AU-62): a new automation named «<name> (copia)» with the same steps, arrows and places; no tests. */
export function duplicateAutomation(
  store: UserStore,
  id: string,
  copyName: string,
  hand: Hand,
): AutomationView | ServiceError {
  const o = open(store, id);
  if (!o) return NOT_FOUND;
  if (typeof copyName !== "string" || !copyName.trim()) return BAD;
  const made = createAutomation(store, { ...o.automation, name: copyName.trim() }, hand);
  if (isError(made)) return made;
  store.journal.placeAutomationSteps(made.id, store.journal.automationLayout(id));
  return automationView(store, made.id);
}

/** «Eliminar» and its «Deshacer» (AU-62): out of the list and back, with everything it had. */
export function setDeleted(
  store: UserStore,
  id: string,
  deleted: boolean,
): { ok: true } | ServiceError {
  if (!store.journal.automation(id)) return NOT_FOUND;
  store.journal.setAutomationDeleted(id, deleted);
  return { ok: true };
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

/** A step and every step an arrow path reaches it from: what «Probar paso» may take from its kept test. */
function arrowAncestors(a: Automation, step: string): Set<string> {
  const seen = new Set([step]);
  const queue = [step];
  while (queue.length) {
    const id = queue.pop() as string;
    for (const arrow of a.arrows)
      if (arrow.to.step === id && !seen.has(arrow.from.step)) {
        seen.add(arrow.from.step);
        queue.push(arrow.from.step);
      }
  }
  return seen;
}

/** What a step that writes would do to a row it gives (AU-72). */
const wouldOf = (step: Step, row: Row): "create" | "update" | "trash" =>
  actionOf(step)?.destroys ? "trash" : row.origin ? "update" : "create";
const writes = (step: Step) => actionOf(step)?.effect === "write";

/**
 * «Probar» and «Probar paso» (AU-90, AU-91, AU-94, AU-115): runs the draft as the store has it, from `trigger`,
 * with the real `Collections` and the real `Policy` and `test: true`. It reads and computes for real; it writes
 * nothing in any collection, proposes nothing, notifies nothing and leaves no run in the journal: the operation log
 * is as long after it as before. The only thing it changes is the kept test of the steps that ran.
 * A trigger of any type is tested this way, by hand, with the fields it declares (AU-115).
 * `zone`: Juan's IANA time zone, the day «hoy» is.
 */
export async function testAutomation(
  store: UserStore,
  id: string,
  request: TestRequest,
  hand: Hand & { trust: Trust; zone: string },
): Promise<TestAnswer | ServiceError> {
  const o = open(store, id);
  if (!o) return NOT_FOUND;
  const a = o.automation;
  if (
    !request ||
    typeof request.trigger !== "string" ||
    !request.fields ||
    typeof request.fields !== "object" ||
    Array.isArray(request.fields) ||
    (request.step !== undefined && typeof request.step !== "string")
  )
    return BAD;
  const keptRows = keptTests(store, id);
  const tested = {
    ...testedFields(store, a, keptRows),
    [request.trigger]: asDeclared(a, request.trigger, request.fields),
  };
  const prints = stepPrints(a, tested, sha256);

  // «Probar paso» takes from the kept tests only the steps it may reuse: done, with the print they have now, before it.
  const kept: Record<string, Kept> = {};
  if (request.step !== undefined) {
    const before = arrowAncestors(a, request.step);
    for (const [step, t] of keptRows) {
      if (step === request.step || !before.has(step)) continue;
      if (t.kept.state !== "done" || t.print !== prints[step]) continue;
      kept[step] = { print: t.print, at: t.at, record: recordOf(store, id, t.kept, step) };
    }
  }

  const own = automationLabel(id);
  const real = storeCollections(store, {
    actor: "user",
    device: hand.device,
    zone: hand.zone,
    own,
  });
  // The saved rows a write reads to say what it would leave (AU-168: part of the write the policy allowed).
  const saved = new Map<string, Record<string, Cell>>();
  const collections: Collections = {
    ...real,
    async get(collection, rowId) {
      const r = await real.get(collection, rowId);
      if (r) saved.set(rowId, r.json);
      return r;
    },
  };
  const started = hand.now;
  let execution: Awaited<ReturnType<typeof runTest>>;
  try {
    execution = await runTest(
      {
        automation: a,
        trigger: request.trigger,
        fields: { json: request.fields, label: handLabel(hand.device) },
        prints,
        ...(request.step !== undefined ? { step: request.step, kept } : {}),
      },
      {
        policy: handPolicy({ trust: hand.trust, device: hand.device, own }),
        collections,
        clock: {
          now: () => Date.now(),
          zone: hand.zone,
          sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        },
        dates: serverDates,
        own,
        locale: "es",
      },
    );
  } catch (e) {
    if (e instanceof CannotRun)
      return {
        state: "invalid",
        problems: [...e.problems],
        ms: 0,
        ran: [],
        reused: [],
        tests: views(keptRows, prints),
      };
    throw e;
  }

  const byId = new Map(a.steps.map((s) => [s.id, s]));
  store.journal.keepAutomationTests(
    id,
    execution.ran.flatMap((step) => {
      const record = execution.steps[step];
      const s = byId.get(step);
      if (!record || !s) return [];
      const writer = writes(s);
      const rows: Record<string, string[]> = {};
      let wouldWrite = 0;
      for (const [output, list] of Object.entries(record.out)) {
        if (writer && output !== OUT.error) wouldWrite += list.length;
        rows[output] = list.map((r) => {
          if (!writer || output === OUT.error) return JSON.stringify(r);
          const would = wouldOf(s, r);
          const before = would === "create" ? null : (saved.get(r.origin?.id ?? "") ?? null);
          return JSON.stringify({ ...r, would, before } satisfies KeptRow);
        });
      }
      const { out, ...rest } = record;
      const keptRecord: KeptRecord = {
        ...rest,
        out: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])),
        wouldWrite,
        trigger: request.trigger,
      };
      return [
        { step, print: prints[step] ?? "", at: started, record: JSON.stringify(keptRecord), rows },
      ];
    }),
  );
  return {
    state: execution.state,
    problems: [],
    ms: execution.ms,
    ran: execution.ran,
    reused: execution.reused,
    tests: views(keptTests(store, id), prints),
    ...(execution.error ? { failedAt: execution.error.step } : {}),
  };
}

/** A kept test as the engine's record, its rows read back: what «Probar paso» reuses. */
function recordOf(store: UserStore, id: string, k: KeptRecord, step: string): StepRecord {
  const { out, wouldWrite: _w, trigger: _t, ...rest } = k;
  const rows: Record<string, Row[]> = {};
  for (const [output, n] of Object.entries(out))
    rows[output] = store.journal
      .automationTestRows(id, step, output, 0, n)
      .map((r) => rowOfKept(JSON.parse(r) as KeptRow));
  return { ...rest, out: rows };
}

const rowOfKept = (k: KeptRow): Row => {
  const { would: _w, before: _b, ...row } = k;
  return row;
};

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

/** A kept row: the engine's row and, for one a write step gives, what it would do and the saved row it read. */
type KeptRow = Row & { would?: RowView["would"]; before?: RowView["before"] };

const viewOf = (k: KeptRow): RowView => ({
  json: k.json,
  label: k.label,
  ...(k.fields && Object.keys(k.fields).length
    ? { fields: Object.fromEntries(Object.entries(k.fields).map(([f, l]) => [f, l.label])) }
    : {}),
  ...(k.would ? { would: k.would, before: k.before ?? null } : {}),
});

/** The kept output rows that came into a step by one input, as the engine joined them: by arrow, in its order. */
function inputSources(
  a: Automation,
  kept: ReadonlyMap<string, { kept: KeptRecord }>,
  step: string,
  input: string,
): { step: string; output: string; count: number }[] {
  const mine = kept.get(step)?.kept;
  if (!mine) return [];
  let order: string[];
  try {
    order = executionOrder(a, mine.trigger);
  } catch {
    return [];
  }
  return arrowsInto(a, order, step, input).map((arrow) => ({
    step: arrow.from.step,
    output: arrow.from.output,
    count: kept.get(arrow.from.step)?.kept.out[arrow.from.output] ?? 0,
  }));
}

/** Rows `offset` to `offset + limit` of a list made of several kept outputs one after another. */
function pageAcross(
  store: UserStore,
  id: string,
  parts: readonly { step: string; output: string; count: number }[],
  offset: number,
  limit: number,
): string[] {
  const out: string[] = [];
  let at = 0;
  for (const p of parts) {
    if (out.length >= limit) break;
    const from = Math.max(0, offset + out.length - at);
    if (from < p.count)
      out.push(...store.journal.automationTestRows(id, p.step, p.output, from, limit - out.length));
    at += p.count;
  }
  return out;
}

/**
 * Some rows of the last test of a step (AU-71, AU-72): of one of its outputs, or of what came in by one of its
 * inputs (the rows the steps before it gave, joined in the engine's order). `ROWS_PAGE` at most per call, whatever
 * `limit` says; `total` is how many there are. Read from the kept chunks, never the whole test (A-15).
 */
export function testRows(
  store: UserStore,
  id: string,
  at: { step: string; side: "in" | "out"; name: string; offset: number; limit: number },
): { rows: RowView[]; total: number } | ServiceError {
  const o = open(store, id);
  if (!o) return NOT_FOUND;
  if (
    !at ||
    (at.side !== "in" && at.side !== "out") ||
    !Number.isInteger(at.offset) ||
    !Number.isInteger(at.limit) ||
    at.offset < 0 ||
    at.limit < 0
  )
    return BAD;
  const limit = Math.min(at.limit, ROWS_PAGE);
  const kept = keptTests(store, id);
  const k = kept.get(at.step)?.kept;
  if (!k) return NOT_FOUND;
  if (at.side === "out") {
    if (!(at.name in k.out)) return BAD;
    const rows = store.journal.automationTestRows(id, at.step, at.name, at.offset, limit);
    return { rows: rows.map((r) => viewOf(JSON.parse(r) as KeptRow)), total: k.out[at.name] ?? 0 };
  }
  if (!(at.name in k.in)) return BAD;
  const parts = inputSources(o.automation, kept, at.step, at.name);
  const rows = pageAcross(store, id, parts, at.offset, limit);
  return {
    rows: rows.map((r) => viewOf(JSON.parse(r) as KeptRow)),
    total: parts.reduce((n, p) => n + p.count, 0),
  };
}

/**
 * What the app previews a step's expressions with (AU-20): the first row that came into the step and, for each step
 * before it by name, the row that one comes from (`item`: null when no row pairs with it) and its first and last
 * rows. One call when a step is opened and after each test; the app resolves every keystroke itself.
 */
export function testSample(
  store: UserStore,
  id: string,
  step: string,
):
  | {
      current: RowView | null;
      total: number;
      steps: Record<string, { item: RowView | null; first: RowView | null; last: RowView | null }>;
    }
  | ServiceError {
  const o = open(store, id);
  if (!o) return NOT_FOUND;
  const a = o.automation;
  const byId = new Map(a.steps.map((s) => [s.id, s]));
  const here = byId.get(step);
  if (!here) return BAD;
  const kept = keptTests(store, id);

  /** The rows a step's inputs joined (as `arriving`: each input cut to one with «Solo la primera fila»). */
  const joined = (s: Step) =>
    inputsOf(s).flatMap((input) => {
      const parts = inputSources(a, kept, s.id, input);
      const firstOnly = s.settings?.firstRowOnly ?? SETTINGS_DEFAULTS.firstRowOnly;
      return firstOnly ? cutTo(parts, 1) : parts;
    });
  /** The row at `index` of a joined list, with the step that made it. */
  const rowAt = (parts: ReturnType<typeof joined>, index: number) => {
    let at = 0;
    for (const p of parts) {
      if (index < at + p.count) {
        const [r] = store.journal.automationTestRows(id, p.step, p.output, index - at, 1);
        return r ? { row: JSON.parse(r) as KeptRow, step: p.step } : null;
      }
      at += p.count;
    }
    return null;
  };

  const into = joined(here);
  const total = into.reduce((n, p) => n + p.count, 0);
  const first = rowAt(into, 0);
  const steps: Record<
    string,
    { item: RowView | null; first: RowView | null; last: RowView | null }
  > = {};
  for (const before of arrowAncestors(a, step)) {
    const s = byId.get(before);
    if (!s || before === step) continue;
    const outs = outputsOf(s)
      .filter((x) => x !== OUT.error)
      .map((output) => ({
        step: before,
        output,
        count: kept.get(before)?.kept.out[output] ?? 0,
      }));
    const n = outs.reduce((m, p) => m + p.count, 0);
    // `.item`: back through the rows each one comes from, until one of this step's (the engine's `scope`).
    let item: RowView | null = null;
    let cursor = first;
    while (cursor) {
      if (cursor.step === before) {
        item = viewOf(cursor.row);
        break;
      }
      const maker = byId.get(cursor.step);
      if (!maker || cursor.row.parent === null) break;
      cursor = rowAt(joined(maker), cursor.row.parent);
    }
    const at = (i: number) => {
      const r = i >= 0 && i < n ? rowAt(outs, i) : null;
      return r ? viewOf(r.row) : null;
    };
    steps[s.name] = { item, first: at(0), last: at(n - 1) };
  }
  return { current: first ? viewOf(first.row) : null, total, steps };
}

/** The first `n` rows of a list made of parts. */
function cutTo<P extends { count: number }>(parts: readonly P[], n: number): P[] {
  const out: P[] = [];
  let left = n;
  for (const p of parts) {
    if (left <= 0) break;
    const c = Math.min(p.count, left);
    if (c > 0) out.push({ ...p, count: c });
    left -= c;
  }
  return out;
}

/** What is kept of a step's record: everything but its rows (store's `AutomationTestRow.record`). */
export type KeptRecord = Omit<StepRecord, "out"> & {
  out: Record<string, number>;
  wouldWrite: number;
  /** The trigger that test started in: what tells which arrows brought its input (`arrowsInto`). */
  trigger: string;
};
