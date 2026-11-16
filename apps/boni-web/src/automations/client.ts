/**
 * What the editor of «Automatizaciones» asks the server, call by call (docs/automatizaciones.md §5.7, §5.8, §7): the
 * routes of apps/server/src/automations/routes.ts and the shapes of its service.ts, as the wire carries them. The
 * app cannot import the server, so the shapes are written twice: the desktop e2e (the real app on the real server)
 * and the server's own tests hold them together. Every path is under `api/agent/`, which the desktop's `paths.cjs`
 * and Android's `Net.kt` already allow. C1 of F14b makes the calls of the list and the editor's header real, C2 the boxes'
 * places; the test and the rows stay pending until their PRs.
 *
 * The catalogue and validation are not asked: the app imports `@boni/automations` and runs the same code the
 * server runs (the server validates again before it tests: it trusts nothing the app says).
 */
import type { Automation, Cell, Problem, StepError, StepState } from "@boni/automations";
import type { Label } from "@boni/entities";
import type { AgentApi } from "../core/agent.ts";
import { notBuilt } from "./pending.ts";

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
    test: () => notBuilt("automationsClient.test (AU-90)"),
    rows: () => notBuilt("automationsClient.rows (AU-71)"),
    sample: () => notBuilt("automationsClient.sample (AU-20)"),
  };
}
