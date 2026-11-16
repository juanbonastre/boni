/**
 * What the editor of «Automatizaciones» asks the server, call by call (docs/automatizaciones.md §5.7, §5.8, §7): the
 * routes of apps/server/src/automations/routes.ts and the shapes of its service.ts, as the wire carries them. The
 * app cannot import the server, so the shapes are written twice: the desktop e2e (the real app on the real server)
 * and the server's own tests hold them together. Every path is under `api/agent/`, which the desktop's `paths.cjs`
 * and Android's `Net.kt` already allow, each query value escaped strictly (`queryValue`). C1 of F14b makes the calls of the list and the editor's header real, C2 the boxes'
 * places, E the test, its rows and the sample.
 *
 * The catalogue and validation are not asked: the app imports `@boni/automations` and runs the same code the
 * server runs (the server validates again before it tests: it trusts nothing the app says).
 */
import type {
  Automation,
  Cell,
  CodeFailure,
  Problem,
  StepError,
  StepFailure,
  StepState,
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
  device: string | null;
  updated: number;
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
}

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
    device: typeof x.device === "string" ? x.device : null,
    updated: typeof x.updated === "number" ? x.updated : 0,
  };
}

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
      const r = await api.automations("GET", path(id, `/test/rows?${q}`));
      const o = isObj(r) ? r : {};
      return {
        rows: Array.isArray(o.rows) ? (o.rows.filter(isObj) as unknown as RowView[]) : [],
        total: typeof o.total === "number" ? o.total : 0,
      };
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
