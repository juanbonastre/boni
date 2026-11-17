/**
 * What the editor of «Automatizaciones» asks the server, call by call (docs/automatizaciones.md §5.7, §5.8, §7): the
 * routes of apps/server/src/automations/routes.ts and the shapes of its service.ts, as the wire carries them. The
 * app cannot import the server, so the shapes are written twice: the desktop e2e (the real app on the real server)
 * and the server's own tests hold them together. Every path is under `api/agent/`, which the desktop's `paths.cjs`
 * and Android's `Net.kt` already allow, each query value escaped strictly (`queryValue`). C1 of F14b makes the calls of the list and the editor's header real, C2 the boxes'
 * places, E the test, its rows and the sample. P1 of F14d «Publicar», the versions and the switch, and «Ejecutar» over
 * the shapes S2 gives its route (`POST automations/:id/run`); P2 «Ejecuciones» (its list, a run, its rows), «Reintentar»,
 * «Deshacer lo que hizo» and «Fijar» (AU-99, AU-100, AU-18, AU-93).
 *
 * The catalogue and validation are not asked: the app imports `@boni/automations` and runs the same code the
 * server runs (the server validates again before it tests: it trusts nothing the app says).
 */
import type {
  Ability,
  Automation,
  AutomationDiff,
  Cell,
  CodeFailure,
  ConsoleLine,
  Look,
  Problem,
  StepError,
  StepFailure,
  StepState,
  WriteAction,
} from "@boni/automations";
import type { Label } from "@boni/entities";
import { type AgentApi, queryValue } from "../core/agent.ts";

/** Where a step's box is on the canvas, in the canvas's own units (AU-05). */
export interface Place {
  step: string;
  x: number;
  y: number;
}

/** A step's last test: counts, never rows (those come by page, `rows`). */
export interface StepTest {
  state: StepState;
  /** When it was tested (epoch ms) and how long it took. */
  at: number;
  ms: number;
  /** Rows in by input and out by output. */
  in: Record<string, number>;
  out: Record<string, number>;
  retries: number;
  failed: number;
  /** How many rows it would write: a test writes none (AU-90). */
  wouldWrite: number;
  /** `error.failure` is the key the screen says, with the parameter at fault (AU-84); `message` is never shown. */
  error?: StepError;
  /** The step changed since (AU-92). */
  stale: boolean;
  /** «Consola» (AU-33): the code's own text, checked before it is painted (automations/code.ts `consoleOf`). */
  console?: { lines: ConsoleLine[]; dropped: number };
  /** «Haría esto» of a «Código» (AU-181): its values are the code's, painted as plain text (A-01). */
  would?: CodeWould;
}

/** What a «Código»'s requests would save in a test (AU-181), as the server keeps it: the counts and the first rows. */
export interface CodeWould {
  asks: boolean;
  counts: { collection: string; action: WriteAction; n: number }[];
  records: {
    collection: string;
    action: WriteAction;
    id?: string;
    before?: Record<string, Cell>;
    after?: Record<string, Cell>;
  }[];
}

/** What the editor opens with. */
export interface Opened {
  id: string;
  rev: number;
  automation: Automation;
  places: Place[];
  tests: Record<string, StepTest>;
  /** By trigger id, the fields of its last test (AU-94). */
  tested: Record<string, Record<string, Cell>>;
  /** «Fijar» (AU-93): by step id, the output pinned on the draft. */
  pins: Record<string, Pin>;
  device: string | null;
  updated: number;
}

/** A pinned output (AU-93): when it was tested, its rows by output and whether the step changed since. */
export interface Pin {
  at: number;
  out: Record<string, number>;
  stale: boolean;
}

export interface TestRequest {
  trigger: string;
  fields: Record<string, Cell>;
  /** «Probar paso». Absent: «Probar». */
  step?: string;
}

export interface TestAnswer {
  state: "done" | "failed" | "invalid";
  problems: Problem[];
  ms: number;
  ran: string[];
  reused: string[];
  tests: Record<string, StepTest>;
  failedAt?: string;
}

/** A row as ENTRADA and SALIDA paint it. Its values are data from anywhere: plain text, always (A-01). */
export interface RowView {
  json: Record<string, Cell>;
  label: Label;
  /** Only the fields whose label is not the row's. */
  fields?: Record<string, Label>;
  /** «Haría esto» (AU-72): the saved row as it is now; null for one it would make. */
  before?: Record<string, Cell> | null;
  would?: "create" | "update" | "trash";
}

/**
 * What an expression of a step is previewed with (AU-20: «= 5 · con la fila 1 de 128»): the first row that came
 * into the step and, for each step before it by name, the row that one comes from (`item`; null when no row pairs)
 * and its first and last rows. Asked once when a step is opened and after each test; every keystroke is then
 * resolved in the app with `resolve` of `@boni/automations`, with no call (A-15).
 */
export interface Sample {
  current: RowView | null;
  /** How many rows came in. */
  total: number;
  steps: Record<string, { item: RowView | null; first: RowView | null; last: RowView | null }>;
}

/**
 * What an expression gives with one row of its step's last test, as the server works it out in the box (AU-23,
 * AU-27): `preview` of `@boni/automations` over the rows, the instant and the seed that test kept. `row` and `of`:
 * which row, from 0, and how many came in. `untested`: the steps to test first, by id, in the order to test them.
 */
export type ExprPreview =
  | { state: "value"; value: Cell; row: number; of: number }
  | { state: "noRows" }
  | { state: "untested"; steps: string[] }
  | { state: "failed"; failure: StepFailure | CodeFailure; row: number; of: number };

/** What «Publicar» shows (AU-96): the server's `PublishView` (apps/server/src/automations/publish.ts). */
export interface PublishView {
  /** The draft's `rev` it was read with: what «Publicar» sends back. */
  rev: number;
  /** The version that runs, or null. */
  running: number | null;
  /** Never published: publishing turns it on (AU-194). */
  first: boolean;
  /** The same document as the one that runs: nothing to publish. */
  same: boolean;
  diff: AutomationDiff | null;
  blocks: Problem[];
  looks: Look[];
  abilities: Ability[];
  outside: string[];
}

/** One published version (AU-95): its number, when and from which device. */
export interface VersionInfo {
  n: number;
  at: number;
  device: string | null;
  by: string;
}

/** `GET automations/:id/versions`: the versions, the one that runs and the switch (AU-194). */
export interface Versions {
  versions: VersionInfo[];
  running: number | null;
  enabled: boolean;
}

/** Why the server did nothing (a 200 with `refused`, publish.ts and S2's runs): the screen words each one. */
export interface Refused {
  refused: string;
  rev?: number;
  problems?: Problem[];
  /** «Ya se está ejecutando»: the run in progress. */
  run?: string;
  /** `changed` (AU-18): the row that changed after the run, and its title. */
  row?: string;
  title?: string;
}

/** `POST automations/:id/publish`: the version made and the switch, or why not. */
export type PublishAnswer = { version: number; enabled: boolean } | Refused;
/** `POST automations/:id/run` (AU-97, S2's route): the run as it started, or why not. */
export type RunAnswer = { run: { id: string; state: string; version: number | null } } | Refused;

/**
 * How a run ended or where it is (AU-99, AU-190); "missed" (S3: it did not run, Boni was off at its hour) is read
 * as it comes, a state this app may not know yet is said as a failure (`runWords`).
 */
export type RunState = "queued" | "running" | "done" | "failed" | "interrupted" | "missed";

/** What a run saved or proposed, by collection and action (AU-99's line): counts, never rows. */
export interface RunCount {
  collection: string;
  name: string | null;
  action: "create" | "update" | "trash";
  n: number;
}

/** A run as the list and its bar say it: the server's `RunSummary` (apps/server/src/automations/runs.ts). */
export interface RunSummary {
  id: string;
  automation: string;
  version: number | null;
  test: boolean;
  state: RunState;
  startedBy: string;
  device: string | null;
  at: number;
  started: number | null;
  ended: number | null;
  ms: number | null;
  /** Where it is, or where it stopped. */
  step: string | null;
  error: (StepError & { step: string | null }) | null;
  line: { writes: RunCount[]; asked: RunCount[]; outside: boolean } | null;
  undone: number | null;
  retryOf: string | null;
  /** S3: the hour a scheduled run was due. */
  slot: number | null;
}

/** A step's record in a run (AU-99): the engine's, with counts for its rows and its writes. */
export interface RunStep {
  state: StepState;
  in: Record<string, number>;
  out: Record<string, number>;
  ms: number;
  retries: number;
  failed: number;
  asked: number;
  error?: StepError;
  console?: { lines: ConsoleLine[]; dropped: number };
  reads?: { collection: string; rows: number }[];
  writes?: { saved: number; asked: number; would: number };
}

/** `GET automations/:id/runs/:run`: one run, the version it ran and each step it reached. */
export interface RunView {
  run: RunSummary;
  /** The document it ran: its version's, or a test's draft. Null when nothing is left of it. */
  automation: Automation | null;
  trigger: string;
  fields: Record<string, Cell>;
  steps: Record<string, RunStep>;
  /** «Deshacer lo que hizo» can be pressed: it wrote, it ended and it was not undone. */
  undoable: boolean;
  wrote: boolean;
  /** The version that runs now: «Reintentar» runs it (AU-100). */
  published: number | null;
}

export type RunsFilter = "all" | "failed" | "tests";

export const isRefused = (x: unknown): x is Refused =>
  !!x && typeof x === "object" && typeof (x as Refused).refused === "string";

export interface AutomationsClient {
  /** `GET automations/:id`. */
  open(id: string): Promise<Opened>;
  /** `POST automations`: the first step added to an empty canvas (AU-61). */
  create(draft: Automation): Promise<Opened>;
  /** `PUT automations/:id/draft`: the whole draft; answers its `rev` and the steps whose test is now stale. */
  save(id: string, draft: Automation): Promise<{ rev: number; stale: string[] }>;
  /** `PUT automations/:id/layout`: the boxes that moved, no others. */
  place(id: string, places: readonly Place[]): Promise<void>;
  /** `POST automations/:id/duplicate`, with the copy's name already worded (i18n: «<name> (copia)»). */
  duplicate(id: string, copyName: string): Promise<Opened>;
  /** `DELETE automations/:id`, and `POST automations/:id/restore` for its «Deshacer». */
  remove(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  /** `POST automations/:id/test`. */
  test(id: string, request: TestRequest): Promise<TestAnswer>;
  /** `GET automations/:id/test/rows`: 50 rows at most, and how many there are. */
  rows(
    id: string,
    at: { step: string; side: "in" | "out"; name: string; offset: number },
  ): Promise<{ rows: RowView[]; total: number }>;
  /** `GET automations/:id/test/sample`. */
  sample(id: string, step: string): Promise<Sample>;
  /**
   * `GET automations/:id/test/preview`: the value at `param` of `step` (a path as `Problem.param` writes one) with
   * row `row`, written as `expr` and not as the draft has it, so what is being typed is asked before it is saved.
   */
  preview(
    id: string,
    at: { step: string; param: string; row: number; expr: string },
  ): Promise<ExprPreview>;
  /** `GET automations/:id/publish`: what «Publicar» shows for the draft, or with `version` for «Volver a esta». */
  publishView(id: string, version?: number): Promise<PublishView>;
  /** `POST automations/:id/publish`: the draft the screen showed (`rev`), or an old `version` again. */
  publish(id: string, what: { rev: number } | { version: number }): Promise<PublishAnswer>;
  /** `GET automations/:id/versions`. */
  versions(id: string): Promise<Versions>;
  /** `GET automations/:id/versions/:n`: that version's document as it runs. */
  version(id: string, n: number): Promise<Automation>;
  /** `PUT automations/:id/enabled`: the switch (AU-194). */
  setEnabled(id: string, enabled: boolean): Promise<{ enabled: boolean } | Refused>;
  /** `POST automations/:id/run` (AU-97): the published version, with the trigger and its fields. */
  run(id: string, request: { trigger: string; fields: Record<string, Cell> }): Promise<RunAnswer>;
  /** `GET automations/:id/runs`: 50, the newest first; `next` asks the 50 before it. */
  runs(
    id: string,
    q: { filter: RunsFilter; before?: string },
  ): Promise<{ runs: RunSummary[]; next: string | null }>;
  /** `GET automations/:id/runs/:run`. */
  runView(id: string, run: string): Promise<RunView>;
  /** `GET automations/:id/runs/:run/rows`: a page of one step's rows in that run. */
  runRows(
    id: string,
    run: string,
    at: { step: string; side: "in" | "out"; name: string; offset: number },
  ): Promise<{ rows: RowView[]; total: number }>;
  /** `POST automations/:id/runs/:run/retry` (AU-100): another run with its data; `undo` undoes that one first. */
  retry(id: string, run: string, undo: boolean): Promise<{ run: RunSummary } | Refused>;
  /** `POST automations/:id/runs/:run/undo` (AU-18): all it saved, or nothing. */
  undoRun(id: string, run: string): Promise<{ run: RunSummary } | Refused>;
  /** `PUT` and `DELETE automations/:id/pins/:step` (AU-93). */
  pin(id: string, step: string): Promise<{ pins: Record<string, Pin> } | Refused>;
  unpin(id: string, step: string): Promise<{ pins: Record<string, Pin> } | Refused>;
  /** `POST automations/:id/runs/:run/pin` (AU-100): the trigger's output of that run, pinned on the draft. */
  pinFromRun(
    id: string,
    run: string,
  ): Promise<{ pins: Record<string, Pin>; trigger: string } | Refused>;
}

/**
 * The most an expression may take once escaped in a preview's request (`queryValue`), well under the 16 KB of a
 * request's head the server reads, with the rest of the request around it. 2,000 characters fit `CODE_LIMITS`, but
 * one that escapes to three bytes each («—», «€») is about 18 KB: such a text is said too long, never asked (AU-23).
 */
export const PREVIEW_QUERY_CHARS = 12_000;
/** Whether `expr` fits a preview's request (`PREVIEW_QUERY_CHARS`). */
export const previewFits = (expr: string) => queryValue(expr).length <= PREVIEW_QUERY_CHARS;

/** The way to the server the client needs: `AgentApi.automations` (offline and errors are its own). */
export type AutomationsApi = Pick<AgentApi, "automations">;

const isObj = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const path = (id: string, rest = "") => `${encodeURIComponent(id)}${rest}`;

/** What `GET automations/:id` and the calls that make one answer, read as the editor needs it. */
export function openedOf(x: unknown): Opened {
  if (!isObj(x) || typeof x.id !== "string" || !isObj(x.automation))
    throw new Error("automations: not an automation");
  return {
    id: x.id,
    rev: typeof x.rev === "number" ? x.rev : 0,
    automation: x.automation as unknown as Automation,
    places: Array.isArray(x.places) ? (x.places as Place[]) : [],
    tests: isObj(x.tests) ? (x.tests as Record<string, StepTest>) : {},
    tested: isObj(x.tested) ? (x.tested as Record<string, Record<string, Cell>>) : {},
    pins: pinsOf(x.pins),
    device: typeof x.device === "string" ? x.device : null,
    updated: typeof x.updated === "number" ? x.updated : 0,
  };
}

/** The pins an answer carries (AU-93). */
export const pinsOf = (x: unknown): Record<string, Pin> =>
  isObj(x)
    ? (Object.fromEntries(Object.entries(x).filter(([, v]) => isObj(v))) as Record<string, Pin>)
    : {};

/** A run's summary as the wire carries it, with what a server before S3 does not say yet. */
export function runSummaryOf(x: unknown): RunSummary {
  const o = isObj(x) ? x : {};
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const line = isObj(o.line) ? o.line : null;
  const counts = (v: unknown) =>
    Array.isArray(v) ? (v.filter(isObj) as unknown as RunCount[]) : [];
  return {
    id: typeof o.id === "string" ? o.id : "",
    automation: typeof o.automation === "string" ? o.automation : "",
    version: num(o.version),
    test: o.test === true,
    state: (typeof o.state === "string" ? o.state : "failed") as RunState,
    startedBy: typeof o.startedBy === "string" ? o.startedBy : "user",
    device: typeof o.device === "string" ? o.device : null,
    at: num(o.at) ?? 0,
    started: num(o.started),
    ended: num(o.ended),
    ms: num(o.ms),
    step: typeof o.step === "string" ? o.step : null,
    error: isObj(o.error) ? (o.error as unknown as RunSummary["error"]) : null,
    line: line
      ? { writes: counts(line.writes), asked: counts(line.asked), outside: line.outside === true }
      : null,
    undone: num(o.undone),
    retryOf: typeof o.retryOf === "string" ? o.retryOf : null,
    slot: num(o.slot),
  };
}

/** What `GET automations/:id/runs/:run` answers. */
export function runViewOf(x: unknown): RunView {
  const o = isObj(x) ? x : {};
  return {
    run: runSummaryOf(o.run),
    automation: isObj(o.automation) ? (o.automation as unknown as Automation) : null,
    trigger: typeof o.trigger === "string" ? o.trigger : "",
    fields: isObj(o.fields) ? (o.fields as Record<string, Cell>) : {},
    steps: isObj(o.steps) ? (o.steps as Record<string, RunStep>) : {},
    undoable: o.undoable === true,
    wrote: o.wrote === true,
    published: typeof o.published === "number" ? o.published : null,
  };
}

const rowsOf = (r: unknown) => {
  const o = isObj(r) ? r : {};
  return {
    rows: Array.isArray(o.rows) ? (o.rows.filter(isObj) as unknown as RowView[]) : [],
    total: typeof o.total === "number" ? o.total : 0,
  };
};

/** What `POST automations/:id/test` answers, read as the editor needs it. */
export function testAnswerOf(x: unknown): TestAnswer {
  const o = isObj(x) ? x : {};
  const strings = (v: unknown) =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
  const state = o.state === "done" || o.state === "failed" ? o.state : "invalid";
  return {
    state,
    problems: Array.isArray(o.problems) ? (o.problems.filter(isObj) as unknown as Problem[]) : [],
    ms: typeof o.ms === "number" ? o.ms : 0,
    ran: strings(o.ran),
    reused: strings(o.reused),
    tests: isObj(o.tests) ? (o.tests as Record<string, StepTest>) : {},
    ...(typeof o.failedAt === "string" ? { failedAt: o.failedAt } : {}),
  };
}

/** The calls over the app's one way to the server. */
export function automationsClient(api: AutomationsApi): AutomationsClient {
  return {
    open: async (id) => openedOf(await api.automations("GET", path(id))),
    create: async (draft) => openedOf(await api.automations("POST", "", { automation: draft })),
    save: async (id, draft) => {
      const r = await api.automations("PUT", path(id, "/draft"), { automation: draft });
      const o = isObj(r) ? r : {};
      return {
        rev: typeof o.rev === "number" ? o.rev : 0,
        stale: Array.isArray(o.stale)
          ? o.stale.filter((s): s is string => typeof s === "string")
          : [],
      };
    },
    duplicate: async (id, copyName) =>
      openedOf(await api.automations("POST", path(id, "/duplicate"), { name: copyName })),
    remove: async (id) => void (await api.automations("DELETE", path(id))),
    restore: async (id) => void (await api.automations("POST", path(id, "/restore"))),
    place: async (id, places) =>
      void (await api.automations("PUT", path(id, "/layout"), { places })),
    test: async (id, request) =>
      testAnswerOf(await api.automations("POST", path(id, "/test"), request)),
    rows: async (id, at) => {
      const q = new URLSearchParams({
        step: at.step,
        side: at.side,
        name: at.name,
        offset: String(at.offset),
      });
      return rowsOf(await api.automations("GET", path(id, `/test/rows?${q}`)));
    },
    sample: async (id, step) => {
      const r = await api.automations(
        "GET",
        path(id, `/test/sample?${new URLSearchParams({ step })}`),
      );
      const o = isObj(r) ? r : {};
      return {
        current: isObj(o.current) ? (o.current as unknown as RowView) : null,
        total: typeof o.total === "number" ? o.total : 0,
        steps: isObj(o.steps) ? (o.steps as unknown as Sample["steps"]) : {},
      };
    },
    preview: async (id, at) => {
      // Escaped strictly: the expression's `*`, `(` or `...` would not pass the apps' allowed paths otherwise.
      const q = Object.entries({
        step: at.step,
        param: at.param,
        row: String(at.row),
        expr: at.expr,
      })
        .map(([k, v]) => `${k}=${queryValue(v)}`)
        .join("&");
      return previewOf(await api.automations("GET", path(id, `/test/preview?${q}`)));
    },
    publishView: async (id, version) =>
      publishViewOf(
        await api.automations(
          "GET",
          path(id, version === undefined ? "/publish" : `/publish?version=${version}`),
        ),
      ),
    publish: async (id, what) => {
      const r = await api.automations("POST", path(id, "/publish"), what);
      if (isRefused(r)) return r;
      const o = isObj(r) ? r : {};
      return { version: Number(o.version) || 0, enabled: o.enabled === true };
    },
    versions: async (id) => {
      const o = await api.automations("GET", path(id, "/versions"));
      const x = isObj(o) ? o : {};
      return {
        versions: Array.isArray(x.versions)
          ? (x.versions.filter(isObj) as unknown as VersionInfo[])
          : [],
        running: typeof x.running === "number" ? x.running : null,
        enabled: x.enabled === true,
      };
    },
    version: async (id, n) => {
      const o = await api.automations("GET", path(id, `/versions/${n}`));
      if (!isObj(o) || !isObj(o.automation)) throw new Error("automations: not a version");
      return o.automation as unknown as Automation;
    },
    setEnabled: async (id, enabled) => {
      const r = await api.automations("PUT", path(id, "/enabled"), { enabled });
      if (isRefused(r)) return r;
      return { enabled: isObj(r) && r.enabled === true };
    },
    run: async (id, request) => {
      const r = await api.automations("POST", path(id, "/run"), request);
      if (isRefused(r)) return r;
      const run = isObj(r) && isObj(r.run) ? r.run : {};
      return {
        run: {
          id: typeof run.id === "string" ? run.id : "",
          state: typeof run.state === "string" ? run.state : "queued",
          version: typeof run.version === "number" ? run.version : null,
        },
      };
    },
    runs: async (id, q) => {
      const p = new URLSearchParams({
        filter: q.filter,
        ...(q.before ? { before: q.before } : {}),
      });
      const o = await api.automations("GET", path(id, `/runs?${p}`));
      const x = isObj(o) ? o : {};
      return {
        runs: Array.isArray(x.runs) ? x.runs.map(runSummaryOf) : [],
        next: typeof x.next === "string" ? x.next : null,
      };
    },
    runView: async (id, run) =>
      runViewOf(await api.automations("GET", path(id, `/runs/${encodeURIComponent(run)}`))),
    runRows: async (id, run, at) => {
      const q = new URLSearchParams({
        step: at.step,
        side: at.side,
        name: at.name,
        offset: String(at.offset),
      });
      return rowsOf(
        await api.automations("GET", path(id, `/runs/${encodeURIComponent(run)}/rows?${q}`)),
      );
    },
    retry: async (id, run, undo) => {
      const r = await api.automations(
        "POST",
        path(id, `/runs/${encodeURIComponent(run)}/retry`),
        undo ? { undo: true } : {},
      );
      return isRefused(r) ? r : { run: runSummaryOf(isObj(r) ? r.run : null) };
    },
    undoRun: async (id, run) => {
      const r = await api.automations("POST", path(id, `/runs/${encodeURIComponent(run)}/undo`));
      return isRefused(r) ? r : { run: runSummaryOf(isObj(r) ? r.run : null) };
    },
    pin: async (id, step) => {
      const r = await api.automations("PUT", path(id, `/pins/${encodeURIComponent(step)}`));
      return isRefused(r) ? r : { pins: pinsOf(isObj(r) ? r.pins : null) };
    },
    unpin: async (id, step) => {
      const r = await api.automations("DELETE", path(id, `/pins/${encodeURIComponent(step)}`));
      return isRefused(r) ? r : { pins: pinsOf(isObj(r) ? r.pins : null) };
    },
    pinFromRun: async (id, run) => {
      const r = await api.automations("POST", path(id, `/runs/${encodeURIComponent(run)}/pin`));
      if (isRefused(r)) return r;
      const o = isObj(r) ? r : {};
      return { pins: pinsOf(o.pins), trigger: typeof o.trigger === "string" ? o.trigger : "" };
    },
  };
}

/** What `GET automations/:id/publish` answers, read as «Publicar» needs it. */
export function publishViewOf(x: unknown): PublishView {
  const o = isObj(x) ? x : {};
  const list = <X>(v: unknown) => (Array.isArray(v) ? (v.filter(isObj) as unknown as X[]) : []);
  return {
    rev: typeof o.rev === "number" ? o.rev : 0,
    running: typeof o.running === "number" ? o.running : null,
    first: o.first === true,
    same: o.same === true,
    diff: isObj(o.diff) ? (o.diff as unknown as AutomationDiff) : null,
    blocks: list<Problem>(o.blocks),
    looks: list<Look>(o.looks),
    abilities: list<Ability>(o.abilities),
    outside: Array.isArray(o.outside)
      ? o.outside.filter((s): s is string => typeof s === "string")
      : [],
  };
}

/** What `GET automations/:id/test/preview` answers, read as the line under an expression needs it. */
export function previewOf(x: unknown): ExprPreview {
  const o = isObj(x) ? x : {};
  const at = {
    row: typeof o.row === "number" ? o.row : 0,
    of: typeof o.of === "number" ? o.of : 0,
  };
  if (o.state === "value") return { state: "value", value: (o.value ?? null) as Cell, ...at };
  if (o.state === "untested")
    return {
      state: "untested",
      steps: Array.isArray(o.steps)
        ? o.steps.filter((s): s is string => typeof s === "string")
        : [],
    };
  if (o.state === "failed" && isObj(o.failure) && typeof o.failure.code === "string")
    return { state: "failed", failure: o.failure as unknown as StepFailure, ...at };
  return { state: "noRows" };
}
