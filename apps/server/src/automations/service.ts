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
  type Box,
  CannotRun,
  type Cell,
  CODE_LIMITS,
  type Collections,
  executionOrder,
  FormatError,
  inputsOf,
  isExpr,
  isTrigger,
  type Kept,
  type KeptNames,
  keep,
  namedFor,
  OUT,
  outputsOf,
  type ParamValue,
  type Preview,
  type Print,
  type Problem,
  parseAutomation,
  preview,
  type Row,
  type RunDeps,
  runTest,
  SETTINGS_DEFAULTS,
  type Step,
  type StepError,
  type StepRecord,
  type StepState,
  type StepWrites,
  staleSteps,
  stepPrints,
  type WriteAction,
  type WriteRecord,
} from "@boni/automations";
import { type Label, label, newId } from "@boni/entities";
import type { AutomationPlace, AutomationTestRow, UserStore } from "@boni/store";
import { handLabel } from "../actions.ts";
import { sandboxBox } from "./box.ts";
import { collectionNamed, storeCollections } from "./collections.ts";
import { serverDates } from "./dates.ts";
import { automationPolicy } from "./policy.ts";
import { keepTestRun, type PinView, pinnedRecords, pinsView } from "./record.ts";

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
  /** «Consola» (AU-33): what its JavaScript wrote, the code's own text, for the app to paint as plain text. */
  console?: KeptRecord["console"];
  /** «Haría esto» of a «Código» (AU-181): what its requests would save, of which nothing was saved. */
  would?: CodeWould;
}

/**
 * What a «Código»'s requests would save in a test (AU-181): how many rows of each collection each action would
 * change, whether a run would ask first (all of the step together, AU-174), and the first `WOULD_ROWS` rows with
 * their before and after. Values are the code's: the app paints them as plain text (A-01).
 */
export interface CodeWould {
  asks: boolean;
  /** In the order first asked: one per collection and action. */
  counts: { collection: string; action: WriteAction; n: number }[];
  records: WriteRecord[];
}

/** Rows of «Haría esto» a kept test holds: the counts say the rest (a test of 3,000 rows keeps no 3,000 rows twice). */
export const WOULD_ROWS = 100;

/** A test's writes as the step's kept test holds them; undefined when it asked for nothing. */
export function codeWould(writes: StepWrites | undefined): CodeWould | undefined {
  if (!writes || writes.kind !== "tested" || writes.records.length === 0) return undefined;
  const counts: CodeWould["counts"] = [];
  for (const r of writes.records) {
    const c = counts.find((x) => x.collection === r.collection && x.action === r.action);
    if (c) c.n++;
    else counts.push({ collection: r.collection, action: r.action, n: 1 });
  }
  return { asks: writes.asks, counts, records: writes.records.slice(0, WOULD_ROWS) };
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
  /** «Fijar» (AU-93): by step id, the output pinned on the draft, which «Probar» gives instead of running the step. */
  pins: Record<string, PinView>;
  /** The device that saved it last, and when. */
  device: string | null;
  updated: number;
}

export type ServiceError = { error: "not-found" | "bad-request" | "too-large" };

export const NOT_FOUND: ServiceError = { error: "not-found" };
export const BAD: ServiceError = { error: "bad-request" };

/** An automation's id: a ULID like any of the account's, with its own prefix. */
const automationId = () => `a_${newId("e").slice(2)}`;

/** The label of what Juan wrote in an automation: its fixed values and the collection keys its steps name. */
export const automationLabel = (id: string): Label =>
  label("user", "personal", [{ kind: "user-edit", id: `automation:${id}` }]);

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

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

/**
 * The version that runs of an automation not deleted (AU-95), parsed, with the names its code cited when it was
 * published (AU-192), or null: never published, or deleted.
 */
export function publishedOf(
  store: UserStore,
  id: string,
): { n: number; automation: Automation; hash: string; names: KeptNames } | null {
  const row = store.journal.automation(id);
  if (!row || row.deleted || row.published === null) return null;
  const v = store.journal.automationVersion(id, row.published);
  if (!v) return null;
  return {
    n: v.n,
    automation: parseAutomation(JSON.parse(v.doc)),
    hash: v.hash,
    names: JSON.parse(v.names) as KeptNames,
  };
}

/**
 * The label of what Juan types for a test (AU-94): his own, from any device. Juan, 2026-11-17 (decision 14 of §10):
 * what he types for «Probar» on a shared device «cuenta como tuyo», so a test says the same on both. A test saves
 * nothing, and a shared device still cannot write a draft, set a «Sí», publish or pin (decision 13), so nothing a
 * test leaves carries this label into a real run.
 */
const typedLabel = (hand: Hand & { trust: Trust }): Label => handLabel(hand.device);

/** The automation, if there is one and it is not deleted, with its draft parsed. */
export function open(store: UserStore, id: string) {
  const row = store.journal.automation(id);
  const draft = row && !row.deleted ? store.journal.automationDraft(id) : null;
  if (!draft) return null;
  return { draft, automation: parseAutomation(JSON.parse(draft.doc)) };
}

export const isError = (x: unknown): x is ServiceError =>
  typeof x === "object" && x !== null && "error" in x && Object.keys(x).length === 1;

/** What the list says starts it (AU-61): its first trigger's type, kept at each save so no list parses a draft. */
export const triggerOf = (a: Automation): string | null => a.steps.find(isTrigger)?.type ?? null;

/**
 * Every function of the server that writes a draft (AU-188, decision 13 of §10), and how what it writes arrives: from
 * Juan's hand (the editor, «Duplicar», his actions), or without it (an assistant's proposal, the MCP, a package: none
 * in F14d), which must pass the document through `lowerYes` (`@boni/automations`' writes.ts) before it is a draft, so
 * no «Sí» arrives but by his hand. `publish.test.ts` finds every function that writes one and holds this list to
 * them: a new one missing here fails it, and one marked `outside` that does not call `lowerYes` fails it too.
 * Publishing, «Volver a esta», the switch, «Eliminar» and «Recuperar» write no draft (AU-98, AU-191).
 */
export const DRAFT_WRITERS: Readonly<Record<string, "hand" | "outside">> = {
  createAutomation: "hand",
  keepDraft: "hand",
  duplicateAutomation: "hand",
  // The actions of Juan's hand (actions.ts) that call the three above.
  withAutomationActions: "hand",
};

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
    {
      id,
      name: a.name,
      trigger: triggerOf(a),
      doc: JSON.stringify(a),
      device: hand.device,
      updated: hand.now,
    },
  );
  return automationView(store, id);
}

/** What is kept of a step's test, read back: the record without rows, and its print. */
export function keptTests(
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
export function asDeclared(
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
export function testedFields(
  store: UserStore,
  a: Automation,
  kept: ReadonlyMap<string, { kept: KeptRecord }>,
): Record<string, Record<string, Cell>> {
  const out: Record<string, Record<string, Cell>> = {};
  for (const s of a.steps) {
    if (!isTrigger(s) || !kept.has(s.id)) continue;
    const output = outputsOf(s)[0];
    const [first] = output ? store.journal.automationTestRows(a.id, s.id, output, 0, 1) : [];
    if (first) out[s.id] = (first as KeptRow).json;
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
      ...(k.console ? { console: k.console } : {}),
      ...(k.would ? { would: k.would } : {}),
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
    pins: pinsView(store, id, o.automation, prints, tested),
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
    trigger: triggerOf(a),
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
  /** Of `reused`, the steps that gave their pinned output instead of running (AU-93). */
  pinned: string[];
  /** A whole «Probar» is kept as a run marked as a test (AU-99): its id. */
  run?: string;
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
/**
 * What an automation runs with on the server: the user's store behind the policy of the origin `automation` (P28),
 * whoever starts the run (A-36), with the «Sí» of each write read from the document the store keeps (AU-188, A-37):
 * for a run for real (`run` given) that is the published version, and an automation with none has no run for real
 * at all (this throws: a draft never runs for real, AU-95); for «Probar», which saves nothing, the draft, so its
 * test says what it would save and what it would ask. His clock and zone, the box and the collections by name. A
 * run for real gives its id, and every operation it saves carries it in the log, so `undoRun` takes back all the
 * run saved, each step's change whole (AU-174, AU-185). Make one per run: the policy's counter is the run's.
 * The only caller with a `run` is `runPublished` (publish.ts), which reads the document it runs from the same
 * version.
 */
export function runDeps(
  store: UserStore,
  id: string,
  hand: Hand & { trust: Trust; zone: string },
  box: Box = sandboxBox(),
  run?: string,
): RunDeps & { policy: ReturnType<typeof automationPolicy> } {
  const own = automationLabel(id);
  const version = run ? publishedOf(store, id) : null;
  const doc = run ? version?.automation : open(store, id)?.automation;
  if (run && !doc)
    throw new Error(`automation ${id} has no published version: nothing runs for real`);
  // A collection a step's code cites by name: in a run of a published version, first by the name that version kept
  // for that step, while its key is still one of the step's connections (AU-192); otherwise by its name of today.
  const today = collectionNamed(store);
  const steps = new Map((version?.automation.steps ?? []).map((s) => [s.id, s]));
  const named = (name: string, step?: string) => {
    const s = step === undefined ? undefined : steps.get(step);
    return s && version ? namedFor(s, version.names, today)(name) : today(name);
  };
  return {
    policy: automationPolicy(doc, own),
    collections: storeCollections(store, {
      actor: "user",
      device: hand.device,
      zone: hand.zone,
      own,
      ...(run ? { run } : {}),
    }),
    clock: {
      now: () => Date.now(),
      zone: hand.zone,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    },
    dates: serverDates,
    own,
    locale: "es",
    box,
    collectionNamed: named,
  };
}

export async function testAutomation(
  store: UserStore,
  id: string,
  request: TestRequest,
  hand: Hand & { trust: Trust; zone: string },
  box: Box = sandboxBox(),
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
  // A «Programada» tried by hand runs as at its hour (AU-195): `$run.startedBy` is `schedule`, and its hour, unless
  // the screen gave one, is now.
  const scheduled = a.steps.find((s) => s.id === request.trigger)?.type === "schedule";
  const fields: Record<string, Cell> =
    scheduled && request.fields.date === undefined
      ? { ...request.fields, date: hand.now }
      : request.fields;
  const keptRows = keptTests(store, id);
  const tested = {
    ...testedFields(store, a, keptRows),
    [request.trigger]: asDeclared(a, request.trigger, fields),
  };
  const prints = stepPrints(a, tested, sha256);

  // «Probar paso» takes from the kept tests only the steps it may reuse: done, with the print they have now, before it.
  const kept: Record<string, Kept> = {};
  if (request.step !== undefined) {
    const before = arrowAncestors(a, request.step);
    for (const [step, t] of keptRows) {
      if (step === request.step || !before.has(step)) continue;
      if (t.kept.state !== "done" || t.print !== prints[step]) continue;
      kept[step] = keptOf(store, id, t, step);
    }
  }

  // «Fijar» (AU-93): a pinned step does not run; its pinned rows are its output.
  const pins = pinnedRecords(store, id, a);

  const deps = runDeps(store, id, hand, box);
  const real = deps.collections;
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
        fields: { json: fields, label: typedLabel(hand) },
        startedBy: scheduled ? "schedule" : "user",
        prints,
        ...(request.step !== undefined ? { step: request.step, kept } : {}),
        ...(pins.pins.size ? { pinned: pins.records } : {}),
      },
      { ...deps, collections },
    );
  } catch (e) {
    if (e instanceof CannotRun)
      return {
        state: "invalid",
        problems: [...e.problems],
        ms: 0,
        ran: [],
        reused: [],
        pinned: [],
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
      const { out, writes: asked, ...rest } = record;
      const would = codeWould(asked);
      if (would) wouldWrite += asked?.records.length ?? 0;
      const clock = keep(execution, step, prints[step] ?? "")?.clock;
      const keptRecord: KeptRecord = {
        ...rest,
        out: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])),
        wouldWrite,
        ...(would ? { would } : {}),
        trigger: request.trigger,
        ...(clock ? { clock } : {}),
      };
      return [
        { step, print: prints[step] ?? "", at: started, record: JSON.stringify(keptRecord), rows },
      ];
    }),
  );
  // A pinned step's kept test is its pin: what the steps after it got, so their inputs read back what came in.
  const pinnedKept = execution.pinned.flatMap((step) => {
    const p = pins.pins.get(step);
    return p ? [{ step, print: p.print, at: p.at, record: p.record, rows: p.rows }] : [];
  });
  if (pinnedKept.length) store.journal.keepAutomationTests(id, pinnedKept);
  const run =
    request.step === undefined ? keepTestRun(store, id, a, execution, request, hand) : undefined;
  return {
    state: execution.state,
    problems: [],
    ms: execution.ms,
    ran: execution.ran,
    reused: execution.reused,
    pinned: execution.pinned,
    ...(run ? { run } : {}),
    tests: views(keptTests(store, id), prints),
    ...(execution.error ? { failedAt: execution.error.step } : {}),
  };
}

/** A step's kept test as the engine keeps one: its record with its rows read back, and the instant and seed it ran with. */
function keptOf(
  store: UserStore,
  id: string,
  t: AutomationTestRow & { kept: KeptRecord },
  step: string,
): Kept {
  return {
    print: t.print,
    at: t.at,
    record: recordOf(store, id, t.kept, step),
    ...(t.kept.clock ? { clock: t.kept.clock } : {}),
  };
}

/** A kept test as the engine's record, its rows read back: what «Probar paso» reuses. */
function recordOf(store: UserStore, id: string, k: KeptRecord, step: string): StepRecord {
  const { out, wouldWrite: _w, trigger: _t, clock: _c, would: _wd, ...rest } = k;
  const rows: Record<string, Row[]> = {};
  for (const [output, n] of Object.entries(out))
    rows[output] = store.journal
      .automationTestRows(id, step, output, 0, n)
      .map((r) => rowOfKept(r as KeptRow));
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
): KeptRow[] {
  const out: KeptRow[] = [];
  let at = 0;
  for (const p of parts) {
    if (out.length >= limit) break;
    const from = Math.max(0, offset + out.length - at);
    if (from < p.count)
      out.push(
        ...(store.journal.automationTestRows(
          id,
          p.step,
          p.output,
          from,
          limit - out.length,
        ) as KeptRow[]),
      );
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
    return { rows: rows.map((r) => viewOf(r as KeptRow)), total: k.out[at.name] ?? 0 };
  }
  if (!(at.name in k.in)) return BAD;
  const parts = inputSources(o.automation, kept, at.step, at.name);
  const rows = pageAcross(store, id, parts, at.offset, limit);
  return {
    rows: rows.map(viewOf),
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
        return r ? { row: r as KeptRow, step: p.step } : null;
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
export type KeptRecord = Omit<StepRecord, "out" | "writes"> & {
  out: Record<string, number>;
  wouldWrite: number;
  /** A «Código»'s requests in that test (AU-181), cut to `WOULD_ROWS` rows. */
  would?: CodeWould;
  /** The trigger that test started in: what tells which arrows brought its input (`arrowsInto`). */
  trigger: string;
  /**
   * The instant and the seed its JavaScript ran with (AU-34), when it had any: what a preview of one of its
   * expressions is calculated with, so it shows what the test gave (AU-27).
   */
  clock?: { now: number; seed: number };
};

/** Which value to preview: the step, the path to the value in its parameters (as `Problem.param`) and the row. */
export interface PreviewRequest {
  step: string;
  param: string;
  row: number;
  /**
   * The expression as it is being written (AU-23): the line under it is asked when Juan stops typing, before the
   * draft with it is kept, so it is previewed in the draft's place. Absent: the draft's own value.
   */
  expr?: string;
}

/**
 * The longest text a preview takes: a `{{ }}`'s own limit (`code.long`), so that the request's line, with the text in
 * it, stays under what the server reads of a request's head (16 KB). The app asks for none longer.
 */
export const PREVIEW_CHARS = CODE_LIMITS.expressionChars;

/** The parameters with the value at `path` (as `Problem.param` writes one) replaced; undefined if it has none. */
function withValue(
  params: Step["params"],
  path: string,
  value: ParamValue,
): Step["params"] | undefined {
  const put = (v: ParamValue, keys: string[]): ParamValue | undefined => {
    const [k, ...rest] = keys;
    if (k === undefined) return value;
    if (Array.isArray(v)) {
      const i = Number(k);
      if (!Number.isInteger(i) || i < 0 || i >= v.length) return undefined;
      const inner = put(v[i] as ParamValue, rest);
      return inner === undefined ? undefined : v.map((x, j) => (j === i ? inner : x));
    }
    if (typeof v !== "object" || v === null || isExpr(v) || !Object.hasOwn(v, k)) return undefined;
    const inner = put((v as Record<string, ParamValue>)[k] as ParamValue, rest);
    return inner === undefined ? undefined : { ...(v as Record<string, ParamValue>), [k]: inner };
  };
  return put(params as ParamValue, path.split(".")) as Step["params"] | undefined;
}

/**
 * The line under an expression (AU-23, AU-27): what it is worth with one row of its step's kept input, calculated by
 * the engine's `preview` with the box, the rows the draft's tests kept and the instant and seed of the step's own kept
 * test, so it is what the test gave. It reads no collection and keeps nothing. `GET …/test/preview` calls it (F14c
 * P1), with the text being typed in `expr`; box.test.ts times it with 3,000 rows as he types (A-15).
 */
export async function previewExpression(
  store: UserStore,
  id: string,
  request: PreviewRequest,
  hand: Hand & { zone: string },
  box: Box = sandboxBox(),
): Promise<Preview | ServiceError> {
  const o = open(store, id);
  if (!o) return NOT_FOUND;
  const a = o.automation;
  if (
    !request ||
    typeof request.step !== "string" ||
    typeof request.param !== "string" ||
    !Number.isSafeInteger(request.row) ||
    request.row < 0 ||
    !a.steps.some((s) => s.id === request.step) ||
    (request.expr !== undefined &&
      (typeof request.expr !== "string" || request.expr.length > PREVIEW_CHARS))
  )
    return BAD;
  let draft = a;
  if (request.expr !== undefined) {
    const text = request.expr;
    const steps: Step[] = [];
    for (const s of a.steps) {
      if (s.id !== request.step) {
        steps.push(s);
        continue;
      }
      const params = withValue(s.params, request.param, { expr: text });
      if (!params) return BAD;
      steps.push({ ...s, params });
    }
    draft = { ...a, steps };
  }
  const keptRows = keptTests(store, id);
  const prints = stepPrints(draft, testedFields(store, draft, keptRows), sha256);
  const kept: Record<string, Kept> = {};
  // A stale test is never what the preview is calculated with (`preview` says to test it again): its rows are not read.
  for (const [step, t] of keptRows)
    if (t.kept.state === "done" && t.print === prints[step])
      kept[step] = keptOf(store, id, t, step);
  // The step's own test gives the instant and the seed even once its expression changed (it is being typed, or was
  // kept since): the rows it previews with are of that test, and so is their hour.
  const clock = keptRows.get(request.step)?.kept.clock ?? { now: hand.now, seed: 0 };
  try {
    return await preview(
      {
        automation: draft,
        step: request.step,
        param: request.param,
        row: request.row,
        kept,
        prints,
        now: clock.now,
        seed: clock.seed,
        zone: hand.zone,
        locale: "es",
      },
      box,
    );
  } catch (e) {
    // `preview` throws only for a parameter the step does not have.
    if (e instanceof Error && !("why" in e)) return BAD;
    throw e;
  }
}
