// Automations over a real store for the tests of «Programada» and of a run's proposal (scheduler.test.ts,
// proposal.test.ts): a store seeded with collections shaped like the user's, documents made of steps by name, a
// published version, boxes that answer as a «Código» would, and a scheduler driven by the test's clock.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Automation,
  type Box,
  type BoxAnswer,
  type BoxJob,
  bornParams,
  type Cell,
  FORMAT,
  newConnection,
  type WriteRequest,
} from "@boni/automations";
import { label, newId } from "@boni/entities";
import { openUserStore, type UserStore } from "@boni/store";
import { seed, typeId } from "../seed.test-util.ts";
import { publish } from "./publish.ts";
import { type RunSummary, runView, settled, startRun } from "./runs.ts";
import { AutomationScheduler } from "./scheduler.ts";
import { automationView, createAutomation, keepDraft, type ServiceError } from "./service.ts";

/** 2026-11-17 09:00 UTC: 10:00 in Madrid. */
export const NOW = Date.UTC(2026, 10, 17, 9, 0);
export const ZONE = "Europe/Madrid";
export const HAND = { device: "d_portatil", now: NOW };
export const JUAN = { ...HAND, trust: "personal" as const, zone: ZONE };
export const SHARED = { ...JUAN, device: "d_salon", trust: "shared" as const };
export const OUTSIDE = label("external", "personal", [{ kind: "mail", id: "m_ejemplo" }]);
export const PEDIDO = typeId("pedido");
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/** A folder for the test file's stores, removed with `done`. */
export function folder(name: string) {
  const dir = mkdtempSync(join(tmpdir(), `boni-${name}-`));
  let n = 0;
  return {
    dir,
    /** A store with two collections shaped like the user's and a few rows each, as his notes came in. */
    store(now: () => number = () => NOW): UserStore {
      const s = openUserStore(join(dir, `u${++n}.db`), { now });
      seeded(s);
      return s;
    },
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export const seeded = (s: UserStore) =>
  seed(
    s,
    [
      {
        key: "pedido",
        name: "Pedido",
        folder: "pedidos/",
        fields: { importe: "number", nota: "text" },
      },
      { key: "cliente", name: "Cliente", folder: "clientes/", fields: { nombre: "text" } },
    ],
    {
      "pedidos/uno.md": '---\nimporte: 12\nnota: "primero"\n---\n# Uno\n',
      "pedidos/dos.md": '---\nimporte: 30\nnota: "segundo"\n---\n# Dos\n',
      "clientes/ana.md": '---\nnombre: "Ana Ejemplo"\n---\n# Ana\n',
    },
  );

export function ok<T>(x: T): Exclude<T, ServiceError | { refused: unknown }> {
  if (
    x &&
    typeof x === "object" &&
    ("refused" in x || ("error" in x && Object.keys(x).length === 1))
  )
    throw new Error(`not done: ${JSON.stringify(x)}`);
  return x as Exclude<T, ServiceError | { refused: unknown }>;
}

/** A step by name: its type, its parameters over the born ones, and what else the step has (its connections). */
export type StepSpec = [string, string, Record<string, unknown>?, Record<string, unknown>?];
/** An arrow by step names, from an output other than the main one when it says so. */
export type ArrowSpec = [string, string, string?];

const stepId = () => newId("o").replace(/^o_/, "s_");

/** A document from steps by name; with no arrows given, each step's main output goes to the next. */
export function docOf(
  steps: readonly StepSpec[],
  ids: Map<string, string>,
  arrows?: readonly ArrowSpec[],
): Automation {
  const id = (name: string) => {
    let s = ids.get(name);
    if (!s) {
      s = stepId();
      ids.set(name, s);
    }
    return s;
  };
  const pairs: ArrowSpec[] = arrows
    ? [...arrows]
    : steps.slice(1).map(([name], i) => [steps[i]?.[0] as string, name]);
  return {
    format: FORMAT,
    id: "",
    version: 0,
    name: "Revisar pedidos",
    steps: steps.map(([name, type, params, extra]) => ({
      id: id(name),
      name,
      type,
      params: {
        ...bornParams(type, typeof params?.action === "string" ? params.action : undefined),
        ...(params ?? {}),
      },
      ...(extra ?? {}),
    })),
    arrows: pairs.map(([from, to, output]) => ({
      from: { step: id(from), output: output ?? "main" },
      to: { step: id(to), input: "main" },
    })),
    settings: {},
  } as unknown as Automation;
}

export const cite = (c: string) => ({ expr: `{{ ${c} }}` });

/** «Programada» with these rules (AU-114). */
export const SCHEDULE = (
  rules: Record<string, unknown>[] = [{ key: "r_cada_hora", every: "hour", at: "08:00" }],
): StepSpec => ["A su hora", "schedule", { rules }];
export const START: StepSpec = [
  "Inicio",
  "manual",
  { fields: [{ key: "nota", name: "Nota", type: "text" }] },
];
/** «Crear» an order with this note, with «Sí» or «Preguntar». */
export const CREATE = (
  nota: unknown,
  permission: "yes" | "ask" = "yes",
  name = "Crear",
): StepSpec => [
  name,
  "collection",
  { collection: "pedido", action: "create", fields: [{ field: "nota", value: nota }], permission },
];
/** «Eliminar filas» of the orders whose note is this one, with «Sí» or «Preguntar». */
export const TRASH = (nota: unknown, permission: "yes" | "ask", name = "Eliminar"): StepSpec => [
  name,
  "collection",
  {
    collection: "pedido",
    action: "trash",
    target: "matching",
    where: [{ field: "nota", op: "is", value: nota }],
    permission,
  },
];
/** A «Código» that reads what it is given and asks the box; `create` is the «Sí» of its connection. */
export const CODE = (create: "yes" | "ask" = "yes", name = "Código"): StepSpec => [
  name,
  "code",
  { mode: "all", source: "$col('Pedido').create({ nota: 'del código' })\nreturn []" },
  { connections: [{ ...newConnection("pedido"), create: { mode: create } }] },
];

/** A box's answer to a «Código» in «Todas a la vez»: these rows, and these writes asked. */
export const answering = (
  rows: readonly Record<string, Cell>[] = [],
  writes: readonly WriteRequest[] = [],
): BoxAnswer => ({
  evaluations: [{ state: "done", values: [rows as Cell[]], clock: false, random: false, writes }],
  console: [],
  dropped: 0,
  ms: 1,
});

/** A box that answers each job with `answer(job)`, keeping the jobs it was given. */
export function boxOf(answer: (job: BoxJob) => BoxAnswer) {
  const jobs: BoxJob[] = [];
  const box: Box = {
    async run(job) {
      jobs.push(job);
      return answer(job);
    },
  };
  return { box, jobs };
}

/** A box that holds each job until `open()`: a run is caught in the middle of its «Código». */
export function held(answer: BoxAnswer = answering()) {
  let open: () => void = () => {};
  const opened = new Promise<void>((r) => {
    open = r;
  });
  let arrive: () => void = () => {};
  const arrived = new Promise<void>((r) => {
    arrive = r;
  });
  const box: Box = {
    async run() {
      arrive();
      await opened;
      return answer;
    },
  };
  return { box, arrived, open: () => open() };
}

/** A new automation with these steps, made and published by Juan's hand at `at`. */
export function made(
  s: UserStore,
  steps: readonly StepSpec[],
  o: { arrows?: readonly ArrowSpec[]; at?: number } = {},
) {
  const ids = new Map<string, string>();
  const hand = { ...HAND, now: o.at ?? NOW };
  const view = ok(createAutomation(s, docOf(steps, ids, o.arrows), hand));
  const id = view.id;
  return {
    id,
    step: (name: string) => ids.get(name) as string,
    edit(next: readonly StepSpec[], arrows?: readonly ArrowSpec[]) {
      return ok(keepDraft(s, id, { ...docOf(next, ids, arrows), id }, hand)).rev;
    },
    publish: (at = o.at ?? NOW) =>
      publish(s, id, { rev: ok(automationView(s, id)).rev }, { ...JUAN, now: at }),
  };
}

/** Starts a run by hand and waits for it to end. */
export async function ran(
  s: UserStore,
  id: string,
  trigger: string,
  fields: Record<string, Cell> = {},
  o: { box?: Box } = {},
): Promise<RunSummary> {
  const { run } = ok(await startRun(s, id, { trigger, fields }, JUAN, o));
  await settled(s);
  return ok(runView(s, id, run.id)).run;
}

/** A scheduler over one store (account 1), on the test's clock; `at(t)` ticks at t and waits for what it started. */
export function scheduler(s: UserStore, zone = ZONE, box?: Box) {
  let now = NOW;
  const lines: string[] = [];
  const sched = new AutomationScheduler({
    accounts: () => [1],
    hasStore: () => true,
    store: () => s,
    zone: () => zone,
    now: () => now,
    log: (l) => lines.push(l),
    ...(box ? { box } : {}),
  });
  return {
    sched,
    lines,
    /** Sets the clock without ticking. */
    now(t: number) {
      now = t;
    },
    async at(t: number) {
      now = t;
      await Promise.all(sched.tick());
      await settled(s);
    },
  };
}

/** The notes of the orders, as they are. */
export const notes = (s: UserStore) => {
  const f = s.schema().types[PEDIDO]?.fields.find((x) => x.key === "nota")?.id as string;
  return s.list(PEDIDO).map((e) => e.entity.values[f]);
};
