// A real run over the real store (docs/automatizaciones.md §5.2, §5.8: AU-97, AU-99, AU-18, AU-100, AU-93, AU-103,
// AU-190, AU-192, and AU-17 at the user's volume; phase F14d): «Ejecutar», the record kept step by step, undoing a
// run whole, retrying it, what is pinned, what is kept of old runs and a run a restart left half done. The rule's id
// is kept in each test's name (`make check` reads them, T-10). A store per test with collections shaped like the
// user's (seed.test-util.ts) and, for AU-17 and AU-99, his volume; every bound read from `@boni/pace` (T-11). The
// volume tests load the machine on purpose: they run inside `make check`, which holds the shared queue of tests
// (T-08), never by hand outside it. What waits for S3 (proposals, the scheduler) or for AU-103 stays pending, saying so.
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakePlanner, ToolRegistry } from "@boni/agent";
import {
  type Automation,
  type Box,
  type BoxAnswer,
  type BoxJob,
  bornParams,
  type Cell,
  FORMAT,
  type KeptNames,
  namedFor,
  newConnection,
  type WriteRequest,
} from "@boni/automations";
import { label, newId } from "@boni/entities";
import { clock, under } from "@boni/pace";
import { openUserStore, type UserStore } from "@boni/store";
import { SYS } from "@boni/views";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ACTIONS, runAction } from "../actions.ts";
import { AgentHost } from "../agent.ts";
import { addUser } from "../auth.ts";
import { renameCollection } from "../data.ts";
import { openDb } from "../db.ts";
import { Feeds } from "../feeds.ts";
import { flowMap } from "../flowMap.ts";
import { flowsCollection } from "../flowsCollection.ts";
import { makeApp, serve } from "../http.ts";
import { LoginGuard } from "../limits.ts";
import { ROUTES } from "../routes.ts";
import { seed, typeId } from "../seed.test-util.ts";
import { withAutomationActions, withPublishActions, withRunActions } from "./actions.ts";
import { sandboxBox } from "./box.ts";
import { KEEP_TESTS, KEEP_WHOLE, PRUNE_BATCH, pruneAllRuns, pruneRuns } from "./keep.ts";
import { publish } from "./publish.ts";
import { ASKED_STEP } from "./record.ts";
import { RUN_ACTIONS, RUN_ROUTES } from "./routes.ts";
import {
  interruptRuns,
  onRunEvent,
  pinFromRun,
  pinStep,
  type RunEvent,
  type RunSummary,
  retryRun,
  runRows,
  runsOf,
  runView,
  settled,
  startRun,
  startScheduledRun,
  undoAutomationRun,
  unpinStep,
} from "./runs.ts";
import {
  automationView,
  createAutomation,
  duplicateAutomation,
  keepDraft,
  runDeps,
  type ServiceError,
  testAutomation,
} from "./service.ts";

const NOW = Date.UTC(2026, 10, 17, 9, 0);
const HAND = { device: "d_portatil", now: NOW };
const JUAN = { ...HAND, trust: "personal" as const, zone: "Europe/Madrid" };
const SHARED = { ...JUAN, device: "d_salon", trust: "shared" as const };
const OUTSIDE = label("external", "personal", [{ kind: "mail", id: "m_ejemplo" }]);
const SEED = label("imported", "public", [{ kind: "vault", id: "seed" }]);
const PEDIDO = typeId("pedido");
const CLIENTE = typeId("cliente");
const BY_HAND = { actor: "user" as const, device: "d_portatil" };

const dir = mkdtempSync(join(tmpdir(), "boni-ejecuciones-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let store: UserStore;
let n = 0;
/** Two collections shaped like the user's, with a few rows each, as his notes came in. */
const seeded = (s: UserStore) =>
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
beforeEach(() => {
  store = openUserStore(join(dir, `u${++n}.db`), { now: () => NOW });
  seeded(store);
});

const stepId = () => newId("o").replace(/^o_/, "s_");

function ok<T>(x: T): Exclude<T, ServiceError | { refused: unknown }> {
  if (
    x &&
    typeof x === "object" &&
    ("refused" in x || ("error" in x && Object.keys(x).length === 1))
  )
    throw new Error(`not done: ${JSON.stringify(x)}`);
  return x as Exclude<T, ServiceError | { refused: unknown }>;
}

/** A step by name: its type, its parameters over the born ones, and what else the step has (its connections). */
type StepSpec = [string, string, Record<string, unknown>?, Record<string, unknown>?];

/** A document from steps by name, each arrow from one to the next. */
function docOf(
  steps: readonly StepSpec[],
  ids: Map<string, string>,
  settings: Record<string, unknown> = {},
): Automation {
  const id = (name: string) => {
    let s = ids.get(name);
    if (!s) {
      s = stepId();
      ids.set(name, s);
    }
    return s;
  };
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
    arrows: steps.slice(1).map(([name], i) => ({
      from: { step: id(steps[i]?.[0] as string), output: "main" },
      to: { step: id(name), input: "main" },
    })),
    settings,
  } as unknown as Automation;
}

const cite = (c: string) => ({ expr: `{{ ${c} }}` });
const START: StepSpec = [
  "Inicio",
  "manual",
  { fields: [{ key: "nota", name: "Nota", type: "text" }] },
];
/** «Crear» an order whose note is the trigger's, or this text; with «Sí». */
const CREATE = (nota: unknown = cite("$json.nota")): StepSpec => [
  "Crear",
  "collection",
  {
    collection: "pedido",
    action: "create",
    fields: [{ field: "nota", value: nota }],
    permission: "yes",
  },
];
/** A «Código» that asks to create an order; what it saves is the box's answer (`answering`). */
const CODE: StepSpec = [
  "Código",
  "code",
  { mode: "all", source: "$col('Pedido').create({ nota: 'del código' })\nreturn []" },
  { connections: [{ ...newConnection("pedido"), create: { mode: "yes" } }] },
];

/** A new automation with these steps; `edit` keeps another draft of it with the same step ids. */
function made(steps: readonly StepSpec[], settings: Record<string, unknown> = {}, s = store) {
  const ids = new Map<string, string>();
  const view = ok(createAutomation(s, docOf(steps, ids, settings), HAND));
  const id = view.id;
  return {
    id,
    step: (name: string) => ids.get(name) as string,
    edit(next: readonly StepSpec[], more: Record<string, unknown> = {}) {
      return ok(keepDraft(s, id, { ...docOf(next, ids, more), id }, HAND)).rev;
    },
    publish: () => ok(publish(s, id, { rev: ok(automationView(s, id)).rev }, JUAN)),
  };
}

/** A box's answer to a «Código» in «Todas a la vez»: it returned no rows and asked for these writes. */
const answering = (writes: readonly WriteRequest[]): BoxAnswer => ({
  evaluations: [{ state: "done", values: [[]], clock: false, random: false, writes }],
  console: [],
  dropped: 0,
  ms: 1,
});
const CREATE_ONE: WriteRequest[] = [
  { collection: "Pedido", action: "create", fields: { nota: "del código" } },
];
/** A box that holds each job until `open()`: a run is caught in the middle of its «Código». */
function held(writes: readonly WriteRequest[] = CREATE_ONE) {
  let open: () => void = () => {};
  const opened = new Promise<void>((r) => {
    open = r;
  });
  let arrive: () => void = () => {};
  /** Resolves when the first job reaches the box: the run is in its «Código». */
  const arrived = new Promise<void>((r) => {
    arrive = r;
  });
  const jobs: BoxJob[] = [];
  const box: Box = {
    async run(job) {
      jobs.push(job);
      arrive();
      await opened;
      return answering(writes);
    },
  };
  return { box, jobs, arrived, open: () => open() };
}
/** No box listening: a «Código» fails with `code.unavailable`. */
const noBox = () => sandboxBox({ socket: join(dir, "ninguna.sock"), marginMs: 50 });

const field = (s: UserStore, type: string, key: string) =>
  s.schema().types[type]?.fields.find((f) => f.key === key)?.id as string;
/** The orders as they are, by id: what undoing must leave as it found. */
const orders = (s = store) =>
  Object.fromEntries(
    s
      .list(PEDIDO)
      .map((e) => [e.entity.id, JSON.stringify(e.entity.values)] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
const notes = (s = store) => s.list(PEDIDO).map((e) => e.entity.values[field(s, PEDIDO, "nota")]);
const opLog = (s = store) => s.logPage(0, 1_000_000).length;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Keeps runs of `id` straight in the store, ended, as a year of them would be: each with the steps (and one row per
 * output) of `steps`, at `at(i)`; `o.test` makes them tests. Inside one batch: the volume tests' seed.
 */
function seedRuns(
  id: string,
  trigger: string,
  n: number,
  at: (i: number) => number,
  o: {
    steps?: ReturnType<UserStore["journal"]["automationRunSteps"]>;
    test?: boolean;
    prefix?: string;
    state?: (i: number) => "done" | "failed";
  } = {},
  s = store,
): string[] {
  const ids: string[] = [];
  s.batch(() => {
    for (let i = 0; i < n; i++) {
      const run = `r_${o.prefix ?? "sem"}${String(i).padStart(6, "0")}`;
      ids.push(run);
      const t = at(i);
      s.journal.createAutomationRun({
        id: run,
        automation: id,
        version: o.test ? null : 1,
        test: !!o.test,
        state: "running",
        trigger,
        fields: "{}",
        startedBy: "schedule",
        device: null,
        retryOf: null,
        at: t,
        started: t,
        doc: o.test ? "{}" : null,
      });
      for (const [k, st] of (o.steps ?? []).entries())
        s.journal.keepAutomationRunStep(run, {
          step: st.step,
          n: k,
          record: st.record,
          rows: { main: ['{"json":{},"label":null}'] },
        });
      s.journal.endAutomationRun(run, {
        state: o.state?.(i) ?? "done",
        ended: t + 40,
        ms: 40,
        step: null,
        error: null,
        line: JSON.stringify({ writes: [], asked: [], outside: false }),
      });
    }
  });
  return ids;
}
/** Whether a run is still whole: its row not pruned and its steps there. */
const whole = (run: string, s = store) =>
  s.journal.automationRun(run)?.pruned === null && s.journal.automationRunSteps(run).length > 0;

/** Starts a run by hand and waits for it to end. */
async function ran(
  id: string,
  trigger: string,
  fields: Record<string, Cell> = {},
  o: { box?: Box } = {},
  s = store,
): Promise<RunSummary> {
  const { run } = ok(await startRun(s, id, { trigger, fields }, JUAN, o));
  await settled(s);
  return ok(runView(s, id, run.id)).run;
}

describe("«Ejecutar» (F14d)", () => {
  it("AU-97 · «Ejecutar» runs the published version and answers at once with the run, which goes on in the server; the fields the trigger asks for arrive as its row", async () => {
    const a = made([START, CREATE()]);
    a.publish();
    // The draft would write something else: only the version runs.
    a.edit([START, CREATE("del borrador")]);
    const gate = held();
    const b = made([START, CREATE(), CODE]);
    b.publish();
    const answer = ok(
      await startRun(
        store,
        b.id,
        { trigger: b.step("Inicio"), fields: { nota: "de la mano" } },
        JUAN,
        {
          box: gate.box,
        },
      ),
    );
    // It answered at once, running; the run reaches its «Código» in the server.
    await gate.arrived;
    expect(answer.run).toMatchObject({ state: "running", version: 1, test: false, ended: null });
    expect(gate.jobs).toHaveLength(1);
    expect(gate.jobs[0]?.run.test).toBe(false);
    gate.open();
    await settled(store);
    expect(ok(runView(store, b.id, answer.run.id)).run.state).toBe("done");
    expect(notes()).toEqual(expect.arrayContaining(["de la mano", "del código"]));

    const done = await ran(a.id, a.step("Inicio"), { nota: "publicada" });
    expect(done.state).toBe("done");
    expect(notes()).toContain("publicada");
    expect(notes()).not.toContain("del borrador");
    // Every operation it saved carries the run.
    expect(store.runOps(done.id)).toHaveLength(1);
    // Off, unpublished, or from a shared device, nothing starts and nothing is kept.
    const c = made([START, CREATE()]);
    expect(await startRun(store, c.id, { trigger: c.step("Inicio"), fields: {} }, JUAN)).toEqual({
      refused: "unpublished",
    });
    expect(await startRun(store, a.id, { trigger: a.step("Inicio"), fields: {} }, SHARED)).toEqual({
      refused: "not-personal",
    });
    expect(ok(runsOf(store, c.id, {})).runs).toEqual([]);
  });

  it("AU-97 · an automation runs one run at a time: a second «Ejecutar» while one runs is refused saying so, and the runs of one account go one after another in the order they arrived", async () => {
    const gate = held();
    const a = made([START, CODE]);
    a.publish();
    const b = made([START, CREATE()]);
    b.publish();
    const first = ok(
      await startRun(store, a.id, { trigger: a.step("Inicio"), fields: {} }, JUAN, {
        box: gate.box,
      }),
    );
    expect(first.run.state).toBe("running");
    await gate.arrived;
    expect(await startRun(store, a.id, { trigger: a.step("Inicio"), fields: {} }, JUAN)).toEqual({
      refused: "running",
      run: first.run.id,
    });
    // Another automation of the same account waits behind it, and says so.
    const second = ok(
      await startRun(store, b.id, { trigger: b.step("Inicio"), fields: { nota: "después" } }, JUAN),
    );
    expect(second.run.state).toBe("queued");
    expect(notes()).not.toContain("después");
    gate.open();
    await settled(store);
    const one = ok(runView(store, a.id, first.run.id)).run;
    const two = ok(runView(store, b.id, second.run.id)).run;
    expect([one.state, two.state]).toEqual(["done", "done"]);
    expect(two.started).toBeGreaterThanOrEqual(one.ended as number);
    expect(notes()).toContain("después");
  });

  it("AU-97 · a «Código» of a real run runs in the box as in a test, and with no box the step fails saying so and nothing is written", async () => {
    const a = made([START, CODE]);
    a.publish();
    const jobs: BoxJob[] = [];
    const box: Box = {
      run: async (job) => {
        jobs.push(job);
        return answering(CREATE_ONE);
      },
    };
    const done = await ran(a.id, a.step("Inicio"), {}, { box });
    expect(done.state).toBe("done");
    expect(jobs[0]?.run).toEqual({ test: false, startedBy: "user" });
    expect(notes()).toContain("del código");
    const before = opLog();
    const failed = await ran(a.id, a.step("Inicio"), {}, { box: noBox() });
    expect(failed.state).toBe("failed");
    expect(failed.step).toBe(a.step("Código"));
    expect(failed.error?.why?.code).toBe("code.unavailable");
    expect(opLog()).toBe(before);
  });
});

describe("the record of a run (F14d)", () => {
  it("AU-99 · what is kept of a run is what the engine gave: per step its state, the rows in and out by each output, how long it took and what came out, written as each step ends, so a run in progress is read up to its last finished step", async () => {
    const gate = held();
    const a = made([START, CREATE(), CODE]);
    a.publish();
    const events: RunEvent[] = [];
    const off = onRunEvent(store, (e) => events.push(e));
    const { run } = ok(
      await startRun(
        store,
        a.id,
        { trigger: a.step("Inicio"), fields: { nota: "en marcha" } },
        JUAN,
        {
          box: gate.box,
        },
      ),
    );
    // In its «Código»: the two steps before it are kept, the «Código» is where it is.
    await gate.arrived;
    const going = ok(runView(store, a.id, run.id));
    expect(going.run.state).toBe("running");
    expect(going.run.step).toBe(a.step("Código"));
    expect(Object.keys(going.steps).sort()).toEqual([a.step("Inicio"), a.step("Crear")].sort());
    expect(going.steps[a.step("Crear")]).toMatchObject({
      state: "done",
      in: { main: 1 },
      out: { main: 1 },
    });
    gate.open();
    await settled(store);
    off();
    const done = ok(runView(store, a.id, run.id));
    expect(done.run.state).toBe("done");
    expect(done.steps[a.step("Código")]).toMatchObject({
      state: "done",
      writes: { saved: 1, asked: 0, would: 0 },
    });
    expect(typeof done.steps[a.step("Crear")]?.ms).toBe("number");
    // What came out of «Crear», and what came into the «Código», read back a page at a time.
    const out = ok(
      runRows(store, a.id, run.id, { step: a.step("Crear"), side: "out", name: "main", offset: 0 }),
    );
    expect(out.total).toBe(1);
    expect(JSON.stringify(out.rows[0]?.json)).toContain("en marcha");
    const into = ok(
      runRows(store, a.id, run.id, { step: a.step("Código"), side: "in", name: "main", offset: 0 }),
    );
    expect(into.rows).toEqual(out.rows);
    // Told as it went: started, each step that ended with its counts, ended; never its rows.
    expect(events.map((e) => e.state)).toEqual([
      "running",
      "running",
      "running",
      "running",
      "done",
    ]);
    expect(events[2]).toEqual({
      automation: a.id,
      run: run.id,
      state: "running",
      step: a.step("Crear"),
      out: { main: 1 },
    });
    expect(JSON.stringify(events)).not.toContain("en marcha");
  });

  it("AU-99 · the list of runs is asked fifty at a time by the index and reads no step and no row; «Fallos» and «Pruebas» filter it; a whole «Probar» is kept as a run marked as a test and «Probar paso» is not", async () => {
    const a = made([START, CREATE()]);
    a.publish();
    for (let i = 0; i < 55; i++) await ran(a.id, a.step("Inicio"), { nota: `n${i}` });
    const failing = made([START, CREATE(), CODE]);
    failing.publish();
    const failed = await ran(failing.id, failing.step("Inicio"), {}, { box: noBox() });
    // «Probar» whole is kept as a test; «Probar paso» is not.
    const whole = ok(
      await testAutomation(store, a.id, { trigger: a.step("Inicio"), fields: { nota: "p" } }, JUAN),
    );
    expect(whole.run).toMatch(/^r_/);
    const one = ok(
      await testAutomation(
        store,
        a.id,
        { trigger: a.step("Inicio"), fields: {}, step: a.step("Crear") },
        JUAN,
      ),
    );
    expect(one.run).toBeUndefined();

    const first = ok(runsOf(store, a.id, {}));
    expect(first.runs).toHaveLength(50);
    expect(first.runs[0]?.id).toBe(whole.run);
    expect(first.runs[0]?.test).toBe(true);
    const rest = ok(runsOf(store, a.id, { before: first.next as string }));
    expect(rest.runs).toHaveLength(6);
    expect(rest.next).toBeNull();
    expect(new Set([...first.runs, ...rest.runs].map((r) => r.id)).size).toBe(56);
    // A summary has no step and no row in it.
    expect(Object.keys(first.runs[1] ?? {})).not.toContain("steps");
    expect(ok(runsOf(store, a.id, { filter: "tests" })).runs.map((r) => r.id)).toEqual([whole.run]);
    expect(ok(runsOf(store, a.id, { filter: "failed" })).runs).toEqual([]);
    expect(ok(runsOf(store, failing.id, { filter: "failed" })).runs.map((r) => r.id)).toEqual([
      failed.id,
    ]);
    expect(runsOf(store, a.id, { filter: "todas" })).toEqual({ error: "bad-request" });
  });

  it("AU-99 · the line of what a run did comes from its record («created 1 row in …», «proposed …», «failed at …», «did nothing»), and a run shows the canvas of the version it ran, not the draft", async () => {
    const a = made([START, CREATE()]);
    a.publish();
    a.edit([
      START,
      CREATE("del borrador"),
      ["Otro", "collection", { collection: "cliente", action: "find" }],
    ]);
    const created = await ran(a.id, a.step("Inicio"), { nota: "una" });
    expect(created.line).toEqual({
      writes: [{ collection: "pedido", name: "Pedido", action: "create", n: 1 }],
      asked: [],
      outside: false,
    });
    const view = ok(runView(store, a.id, created.id));
    expect(view.automation?.steps.map((s) => s.name)).toEqual(["Inicio", "Crear"]);
    expect(view).toMatchObject({
      trigger: a.step("Inicio"),
      fields: { nota: "una" },
      undoable: true,
      wrote: true,
      published: 1,
    });

    const asks = made([START, ["Crear", "collection", { ...CREATE()[2], permission: "ask" }]]);
    asks.publish();
    const asked = await ran(asks.id, asks.step("Inicio"), { nota: "pedida" });
    expect(asked.line).toEqual({
      writes: [],
      asked: [{ collection: "pedido", name: "Pedido", action: "create", n: 1 }],
      outside: false,
    });
    expect(notes()).not.toContain("pedida");
    expect(ok(runView(store, asks.id, asked.id)).undoable).toBe(false);
    // «Deshacer lo que hizo» is there only when it saved something.
    expect(undoAutomationRun(store, asks.id, asked.id, JUAN)).toEqual({ refused: "nothing" });

    const reads = made([
      START,
      ["Buscar", "collection", { collection: "cliente", action: "find" }],
    ]);
    reads.publish();
    const nothing = await ran(reads.id, reads.step("Inicio"));
    expect(nothing.line).toEqual({ writes: [], asked: [], outside: false });
  });

  it("AU-99 · with a year of hourly runs of one automation, the list and one run answer within the time written here", async () => {
    const a = made([START, CREATE()]);
    a.publish();
    const sample = await ran(a.id, a.step("Inicio"), { nota: "muestra" });
    const steps = store.journal.automationRunSteps(sample.id);
    const hour = 3_600_000;
    const ids: string[] = [];
    store.batch(() => {
      for (let i = 0; i < 8_760; i++) {
        const id = `r_ano${String(i).padStart(5, "0")}`;
        ids.push(id);
        const at = NOW - (8_760 - i) * hour;
        store.journal.createAutomationRun({
          id,
          automation: a.id,
          version: 1,
          test: false,
          state: "running",
          trigger: a.step("Inicio"),
          fields: "{}",
          startedBy: "user",
          device: "d_portatil",
          retryOf: null,
          at,
          started: at,
          doc: null,
        });
        for (const [k, s] of steps.entries())
          store.journal.keepAutomationRunStep(id, {
            step: s.step,
            n: k,
            record: s.record,
            rows: { main: ['{"json":{},"label":null}'] },
          });
        store.journal.endAutomationRun(id, {
          state: i % 50 === 0 ? "failed" : "done",
          ended: at + 40,
          ms: 40,
          step: null,
          error: null,
          line: JSON.stringify({ writes: [], asked: [], outside: false }),
        });
      }
    });
    let t = clock();
    const page = ok(runsOf(store, a.id, {}));
    under(clock() - t, 40, "clock");
    expect(page.runs).toHaveLength(50);
    t = clock();
    const deep = ok(runsOf(store, a.id, { before: ids[1_000] as string }));
    under(clock() - t, 40, "clock");
    expect(deep.runs[0]?.id).toBe(ids[999]);
    t = clock();
    ok(runsOf(store, a.id, { filter: "failed" }));
    under(clock() - t, 60, "clock");
    t = clock();
    const one = ok(runView(store, a.id, ids[4_000] as string));
    under(clock() - t, 20, "clock");
    expect(Object.keys(one.steps)).toHaveLength(2);
  });

  it("AU-99 AU-47 · with 200 scheduled automations, one of them with a year of hourly runs, the list of automations and the map count them within the time written here, from a table and an index, never counting rows; tests and hours that did not run are not counted", async () => {
    const schedule: StepSpec = [
      "A su hora",
      "schedule",
      { rules: [{ key: "r_cada_hora", every: "hour", at: "08:00" }] },
    ];
    const autos = Array.from({ length: 200 }, () => {
      const a = made([schedule, CREATE("fija")]);
      a.publish();
      return a;
    });
    // A year of every hour for the first; a day of them for each of the others.
    const year = 8_760;
    for (const [k, a] of autos.entries()) {
      const n = k === 0 ? year : 24;
      seedRuns(a.id, a.step("A su hora"), n, (i) => NOW - (n - i) * HOUR, {
        prefix: `m${k}_`,
        state: (i) => (i % 30 === 0 ? "failed" : "done"),
      });
      seedRuns(a.id, a.step("A su hora"), 3, (i) => NOW - i * MINUTE, {
        prefix: `t${k}_`,
        test: true,
      });
    }
    const first = autos[0] as (typeof autos)[number];
    store.journal.missAutomationRun({
      id: "r_no_corrio",
      automation: first.id,
      version: 1,
      trigger: first.step("A su hora"),
      fields: "{}",
      slot: NOW,
      at: NOW,
    });
    const F = SYS.flows;
    let t = clock();
    const list = flowsCollection(store).rows;
    under(clock() - t, 60, "clock");
    const row = list.find((r) => r.id === `${F.automation}${first.id}`);
    expect(row?.values[F.runs]).toBe(year);
    expect(row?.values[F.last]).toBe(new Date(NOW - HOUR).toISOString());
    t = clock();
    const map = flowMap(store, {
      now: NOW,
      days: 365,
      tz: "Europe/Madrid",
      mailType: null,
      mailAccount: null,
    });
    under(clock() - t, 150, "clock");
    const node = map.nodes.filter((m) => m.kind === "automation");
    expect(node).toHaveLength(200);
    // The year's hours, the hour that did not run and the tests left out.
    expect(node.find((m) => m.id === `auto:${first.id}`)).toMatchObject({ runs: year, version: 1 });
    // A run kept as a summary (AU-103) still counts: the table is the store's, kept as each run is kept.
    expect(pruneRuns(store, first.id, NOW)).toBe(PRUNE_BATCH);
    const after = flowsCollection(store).rows.find((r) => r.id === `${F.automation}${first.id}`);
    expect(after?.values[F.runs]).toBe(year);
  });
});

describe("undoing a run (F14d)", () => {
  // The principle «Lo que escribe una ejecución se deshace entero» (docs/principios.md, A-40).
  it("AU-18 · a run of three steps that write (one creates, one modifies, one sends to the trash) is undone whole from the run: the store is as it was before, in one transaction, and the run says it was undone and when", async () => {
    const a = made([
      START,
      CREATE(),
      [
        "Modificar",
        "collection",
        {
          collection: "pedido",
          action: "update",
          target: "matching",
          where: [{ field: "nota", op: "is", value: "primero" }],
          fields: [{ field: "nota", value: "cambiado" }],
          permission: "yes",
        },
      ],
      [
        "Tirar",
        "collection",
        {
          collection: "pedido",
          action: "trash",
          target: "matching",
          where: [{ field: "nota", op: "is", value: "segundo" }],
          permission: "yes",
        },
      ],
    ]);
    a.publish();
    const before = orders();
    const r = await ran(a.id, a.step("Inicio"), { nota: "nuevo" });
    expect(r.state, JSON.stringify(r.error)).toBe("done");
    expect(r.line?.writes.map((w) => [w.action, w.n])).toEqual(
      expect.arrayContaining([
        ["create", 1],
        ["update", 1],
        ["trash", 1],
      ]),
    );
    expect(orders()).not.toEqual(before);
    expect(ok(runView(store, a.id, r.id)).undoable).toBe(true);
    // From a shared device, no.
    expect(undoAutomationRun(store, a.id, r.id, SHARED)).toEqual({ refused: "not-personal" });
    const undone = ok(undoAutomationRun(store, a.id, r.id, JUAN));
    expect(undone.run.undone).toBe(NOW);
    expect(orders()).toEqual(before);
    // Undone, there is nothing to undo again and no «Rehacer».
    expect(undoAutomationRun(store, a.id, r.id, JUAN)).toEqual({ refused: "nothing" });
    expect(ok(runView(store, a.id, r.id)).undoable).toBe(false);
    expect(ok(runsOf(store, a.id, {})).runs[0]?.undone).toBe(NOW);
  });

  it("AU-18 · with one row changed after the run, undoing it undoes nothing, overwrites nothing and says which row", async () => {
    const a = made([
      START,
      CREATE(),
      [
        "Modificar",
        "collection",
        {
          collection: "pedido",
          action: "update",
          target: "matching",
          where: [{ field: "nota", op: "is", value: "primero" }],
          fields: [{ field: "nota", value: "cambiado" }],
          permission: "yes",
        },
      ],
    ]);
    a.publish();
    const r = await ran(a.id, a.step("Inicio"), { nota: "nuevo" });
    const uno = store
      .list(PEDIDO)
      .find((e) => e.entity.values[field(store, PEDIDO, "nota")] === "cambiado");
    if (!uno) throw new Error("no row changed");
    store.update(
      uno.entity.id,
      { [field(store, PEDIDO, "nota")]: { value: "a mano", label: SEED } },
      BY_HAND,
    );
    const after = orders();
    const refused = undoAutomationRun(store, a.id, r.id, JUAN);
    expect(refused).toEqual({ refused: "changed", row: uno.entity.id, title: "Uno" });
    expect(orders()).toEqual(after);
    expect(ok(runView(store, a.id, r.id)).run.undone).toBeNull();
  });

  // What was accepted of a run's proposal, undone with the run: proposal.test.ts (S3).
  it("AU-18 AU-103 · a run of which only the summary is left is undone the same: undoing reads the operation log, not its steps", async () => {
    const a = made([START, CREATE()]);
    a.publish();
    const before = orders();
    const r = await ran(a.id, a.step("Inicio"), { nota: "de hace tiempo" });
    expect(notes()).toContain("de hace tiempo");
    // Forty days later it is old: its steps and rows go, its row stays.
    expect(pruneRuns(store, a.id, Date.now() + 40 * DAY)).toBe(1);
    const kept = ok(runView(store, a.id, r.id));
    expect(store.journal.automationRunSteps(r.id)).toEqual([]);
    expect(kept.run).toMatchObject({ state: "done", undone: null });
    expect(kept.run.pruned).not.toBeNull();
    expect(kept.run.line?.writes).toEqual([
      { collection: "pedido", name: "Pedido", action: "create", n: 1 },
    ]);
    expect(kept.undoable).toBe(true);
    // Its rows are not there to pin.
    expect(pinFromRun(store, a.id, r.id, JUAN)).toEqual({ refused: "pruned" });
    ok(undoAutomationRun(store, a.id, r.id, JUAN));
    expect(orders()).toEqual(before);
    expect(ok(runView(store, a.id, r.id)).run.undone).not.toBeNull();
  });

  it("AU-17 AU-18 · «Las que cumplan…» with several rows, stopped by the limit partway on the real server: what the earlier rows saved stays, undone whole leaves the store as it was; «Reintentar» runs it again from the store as it finds it", async () => {
    const importe = field(store, PEDIDO, "importe");
    store.batch(() => {
      for (let i = 0; i < 600; i++)
        store.create(
          PEDIDO,
          { [importe]: { value: 0, label: SEED } },
          { actor: "import", device: "seed" },
        );
    });
    // Each row that arrives moves the orders whose amount is its own to the next: «0» to «1», then «1» to «2».
    const a = made([
      ["Inicio", "manual", { fields: [] }],
      [
        "Lista",
        "edit",
        {
          fields: [
            {
              field: "n",
              value: [
                { from: 0, to: 1 },
                { from: 1, to: 2 },
              ],
            },
          ],
        },
      ],
      ["Partir", "split", { field: "n" }],
      [
        "Mover",
        "collection",
        {
          collection: "pedido",
          action: "update",
          target: "matching",
          where: [{ field: "importe", op: "is", value: cite("$json.n.from") }],
          fields: [{ field: "importe", value: cite("$json.n.to") }],
          permission: "yes",
        },
      ],
    ]);
    a.publish();
    const amounts = () => {
      const c: Record<string, number> = {};
      for (const e of store.list(PEDIDO)) {
        const v = String(e.entity.values[importe]);
        c[v] = (c[v] ?? 0) + 1;
      }
      return c;
    };
    const before = orders();
    expect(amounts()).toEqual({ "0": 600, "12": 1, "30": 1 });
    // The second row would write 600 more: 1,200 passes 1,000 before it saves any; the first one's 600 stay.
    const stopped = await ran(a.id, a.step("Inicio"));
    expect(stopped.state).toBe("failed");
    expect(stopped.error).toMatchObject({
      step: a.step("Mover"),
      failure: { code: "run.limit", detail: { limit: "rowsWritten", max: 1_000, got: 1_200 } },
    });
    expect(amounts()).toEqual({ "1": 600, "12": 1, "30": 1 });
    expect(store.runOps(stopped.id)).toHaveLength(600);
    expect(stopped.line?.writes).toEqual([
      { collection: "pedido", name: "Pedido", action: "update", n: 600 },
    ]);
    // Undone whole: as it was.
    ok(undoAutomationRun(store, a.id, stopped.id, JUAN));
    expect(orders()).toEqual(before);

    // «Reintentar» from the store as it was stops again, the same way: nothing is saved twice.
    const again = ok(await retryRun(store, a.id, stopped.id, {}, JUAN));
    await settled(store);
    expect(again).toMatchObject({ version: 1, was: 1 });
    const second = ok(runView(store, a.id, again.run.id)).run;
    expect(second.state).toBe("failed");
    expect(second.retryOf).toBe(stopped.id);
    expect(amounts()).toEqual({ "1": 600, "12": 1, "30": 1 });
    // «Reintentar» without undoing first: the first row finds no «0» left, the second moves the 600 on to «2», within
    // the limit. Retried from where it stopped, the run ends as if it had had room for all of it.
    const third = ok(await retryRun(store, a.id, second.id, { undo: false }, JUAN));
    await settled(store);
    expect(ok(runView(store, a.id, third.run.id)).run.state).toBe("done");
    expect(amounts()).toEqual({ "2": 600, "12": 1, "30": 1 });
    // Each is undone on its own, the last first.
    expect(undoAutomationRun(store, a.id, second.id, JUAN)).toMatchObject({ refused: "changed" });
    ok(undoAutomationRun(store, a.id, third.run.id, JUAN));
    ok(undoAutomationRun(store, a.id, second.id, JUAN));
    expect(orders()).toEqual(before);
    // A run commits one transaction per row today (task 137): about 25 ms a row here, so this one takes its time.
  }, 120_000);
});

describe("retrying and opening in the editor (F14d)", () => {
  it("AU-100 · «Reintentar» starts a new run by hand with the trigger's data of that run and the version published now, and says so when it is not the version of then", async () => {
    const a = made([START, CREATE()]);
    a.publish();
    const first = await ran(a.id, a.step("Inicio"), { nota: "otra vez" });
    a.edit([
      START,
      CREATE(cite("$json.nota")),
      ["Buscar", "collection", { collection: "cliente", action: "find" }],
    ]);
    a.publish();
    const again = ok(await retryRun(store, a.id, first.id, {}, JUAN));
    await settled(store);
    expect(again).toMatchObject({ version: 2, was: 1 });
    const view = ok(runView(store, a.id, again.run.id));
    expect(view).toMatchObject({ trigger: a.step("Inicio"), fields: { nota: "otra vez" } });
    expect(view.run).toMatchObject({ retryOf: first.id, version: 2, state: "done" });
    expect(notes().filter((x) => x === "otra vez")).toHaveLength(2);
    // A test is not retried; one still running is not either.
    const t = ok(
      await testAutomation(store, a.id, { trigger: a.step("Inicio"), fields: {} }, JUAN),
    );
    expect(await retryRun(store, a.id, t.run as string, {}, JUAN)).toEqual({ refused: "test" });
    expect(await retryRun(store, a.id, first.id, {}, SHARED)).toEqual({ refused: "not-personal" });
  });

  it("AU-100 · retrying a run that wrote before it failed offers to undo it first: with «Deshacer y reintentar» nothing is left written twice", async () => {
    const a = made([START, CREATE(), CODE]);
    a.publish();
    const failed = await ran(a.id, a.step("Inicio"), { nota: "una vez" }, { box: noBox() });
    expect(failed.state).toBe("failed");
    const view = ok(runView(store, a.id, failed.id));
    expect(view).toMatchObject({ wrote: true, undoable: true });
    const box: Box = { run: async () => answering(CREATE_ONE) };
    const again = ok(await retryRun(store, a.id, failed.id, { undo: true }, JUAN, box));
    await settled(store);
    expect(ok(runView(store, a.id, again.run.id)).run.state).toBe("done");
    expect(ok(runView(store, a.id, failed.id)).run.undone).toBe(NOW);
    expect(notes().filter((x) => x === "una vez")).toHaveLength(1);
    // Without undoing, what the first one saved is there twice.
    const twice = ok(await retryRun(store, a.id, again.run.id, {}, JUAN, box));
    await settled(store);
    expect(ok(runView(store, a.id, twice.run.id)).run.state).toBe("done");
    expect(notes().filter((x) => x === "una vez")).toHaveLength(2);
  });

  it("AU-100 · «Abrir en el editor con estos datos» pins the output the trigger gave in that run on the draft, and the next «Probar» starts from it", async () => {
    const a = made([START, CREATE()]);
    a.publish();
    const r = await ran(a.id, a.step("Inicio"), { nota: "de la ejecución" });
    const pinned = ok(pinFromRun(store, a.id, r.id, JUAN));
    expect(pinned.trigger).toBe(a.step("Inicio"));
    expect(pinned.pins[a.step("Inicio")]).toMatchObject({ out: { main: 1 }, stale: false });
    expect(ok(automationView(store, a.id)).pins[a.step("Inicio")]).toBeDefined();
    // «Probar» with other fields still starts from the run's row: the trigger is not run.
    const t = ok(
      await testAutomation(
        store,
        a.id,
        { trigger: a.step("Inicio"), fields: { nota: "otra" } },
        JUAN,
      ),
    );
    expect(t.state).toBe("done");
    expect(t.pinned).toEqual([a.step("Inicio")]);
    const rows = ok(
      runRows(store, a.id, t.run as string, {
        step: a.step("Crear"),
        side: "in",
        name: "main",
        offset: 0,
      }),
    );
    expect(JSON.stringify(rows.rows)).toContain("de la ejecución");
    expect(JSON.stringify(rows.rows)).not.toContain("otra");
    expect(pinFromRun(store, a.id, r.id, SHARED)).toEqual({ refused: "not-personal" });
    // The trigger changed after it was pinned: «puede estar vieja» (AU-92).
    a.edit([
      [
        "Inicio",
        "manual",
        {
          fields: [
            { key: "nota", name: "Nota", type: "text" },
            { key: "otra", name: "Otra", type: "text" },
          ],
        },
      ],
      CREATE(),
    ]);
    expect(ok(automationView(store, a.id)).pins[a.step("Inicio")]?.stale).toBe(true);
  });
});

describe("«Fijar» (F14d)", () => {
  const FIND: StepSpec = ["Buscar", "collection", { collection: "pedido", action: "find" }];
  const CLIENT: StepSpec = [
    "Crear",
    "collection",
    {
      collection: "cliente",
      action: "create",
      fields: [{ field: "nombre", value: cite("$json.nota") }],
      permission: "yes",
    },
  ];

  it("AU-93 · a step with a pinned output is not run by «Probar» or «Probar paso» (no box, no read, no model): its pinned rows are its output, with the label each row had", async () => {
    const jobs: BoxJob[] = [];
    const box: Box = {
      run: async (job) => {
        jobs.push(job);
        return answering([]);
      },
    };
    const a = made([START, FIND, CODE]);
    const req = { trigger: a.step("Inicio"), fields: {} };
    // Not tested yet: there is nothing to pin.
    expect(pinStep(store, a.id, a.step("Buscar"), JUAN)).toEqual({ refused: "untested" });
    ok(await testAutomation(store, a.id, req, JUAN, box));
    expect(jobs).toHaveLength(1);
    const { pins } = ok(pinStep(store, a.id, a.step("Buscar"), JUAN));
    expect(pins[a.step("Buscar")]).toMatchObject({ out: { main: 2 }, stale: false });
    ok(pinStep(store, a.id, a.step("Código"), JUAN));
    expect(pinStep(store, a.id, a.step("Buscar"), SHARED)).toEqual({ refused: "not-personal" });
    // Another order arrives: «Buscar» pinned still gives its two, and the «Código» pinned asks no box.
    store.create(
      PEDIDO,
      { [field(store, PEDIDO, "nota")]: { value: "tercero", label: OUTSIDE } },
      { actor: "import", device: "seed" },
    );
    const whole = ok(await testAutomation(store, a.id, req, JUAN, box));
    expect(whole.pinned.sort()).toEqual([a.step("Buscar"), a.step("Código")].sort());
    expect(whole.tests[a.step("Buscar")]?.out).toEqual({ main: 2 });
    expect(jobs).toHaveLength(1);
    const step = ok(
      await testAutomation(store, a.id, { ...req, step: a.step("Código") }, JUAN, box),
    );
    expect(step.pinned).toContain(a.step("Código"));
    expect(jobs).toHaveLength(1);
    // Each pinned row keeps the label it had: the run's rows of «Buscar» say where each order came from.
    const rows = ok(
      runRows(store, a.id, whole.run as string, {
        step: a.step("Buscar"),
        side: "out",
        name: "main",
        offset: 0,
      }),
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((r) => r.label !== null)).toBe(true);
  });

  it("AU-93 · a pin is never part of a version: a real run of an automation whose step is pinned runs that step, and releasing the pin makes the test run it again", async () => {
    const a = made([START, FIND, CLIENT]);
    const req = { trigger: a.step("Inicio"), fields: {} };
    ok(await testAutomation(store, a.id, req, JUAN));
    ok(pinStep(store, a.id, a.step("Buscar"), JUAN));
    // «Duplicar» does not copy what is pinned.
    expect(ok(duplicateAutomation(store, a.id, "Copia", HAND)).pins).toEqual({});
    a.publish();
    expect(JSON.stringify(store.journal.automationVersion(a.id, 1))).not.toContain("pin");
    store.create(
      PEDIDO,
      { [field(store, PEDIDO, "nota")]: { value: "tercero", label: SEED } },
      { actor: "import", device: "seed" },
    );
    const r = await ran(a.id, a.step("Inicio"));
    expect(ok(runView(store, a.id, r.id)).steps[a.step("Buscar")]?.out).toEqual({ main: 3 });
    expect(store.list(CLIENTE)).toHaveLength(4);
    expect(ok(await testAutomation(store, a.id, req, JUAN)).tests[a.step("Buscar")]?.out).toEqual({
      main: 2,
    });
    const { pins } = ok(unpinStep(store, a.id, a.step("Buscar"), JUAN));
    expect(pins).toEqual({});
    const t = ok(await testAutomation(store, a.id, req, JUAN));
    expect(t.pinned).toEqual([]);
    expect(t.tests[a.step("Buscar")]?.out).toEqual({ main: 3 });
  });
});

describe("«Probar» from a shared device (F14d)", () => {
  it("AU-94 · what Juan types for «Probar» on a shared device counts as his, as on a personal one (decision 14): the trigger's row has his label, the test saves nothing, and the shared device still cannot pin it", async () => {
    const a = made([START, CREATE()]);
    const req = { trigger: a.step("Inicio"), fields: { nota: "desde el salón" } };
    const before = opLog();
    const triggered = async (hand: typeof JUAN | typeof SHARED) => {
      const t = ok(await testAutomation(store, a.id, req, hand));
      expect(t.state).toBe("done");
      const out = ok(
        runRows(store, a.id, t.run as string, {
          step: a.step("Inicio"),
          side: "out",
          name: "main",
          offset: 0,
        }),
      );
      return out.rows[0]?.label;
    };
    const shared = await triggered(SHARED);
    const mine = await triggered(JUAN);
    expect(shared?.integrity).toBe("user");
    expect(shared?.integrity).toBe(mine?.integrity);
    expect(shared?.sensitivity).toBe(mine?.sensitivity);
    expect(opLog()).toBe(before);
    expect(notes()).not.toContain("desde el salón");
    expect(pinStep(store, a.id, a.step("Inicio"), SHARED)).toEqual({ refused: "not-personal" });
  });
});

describe("what is kept of old runs (F14d)", () => {
  it("AU-103 · a run is kept whole while it is among the last 100 of its automation and younger than 30 days; of the others its summary stays and its steps and rows go; of the tests the last 20 stay and older ones go entirely", async () => {
    expect([KEEP_WHOLE, KEEP_TESTS]).toEqual([100, 20]);
    const a = made([START, CREATE()]);
    a.publish();
    const sample = await ran(a.id, a.step("Inicio"), { nota: "muestra" });
    const steps = store.journal.automationRunSteps(sample.id);
    const t0 = Date.now();
    const trigger = a.step("Inicio");
    // Young, all of them: the 10 oldest (and the sample) are past the newest 100.
    const young = seedRuns(a.id, trigger, 110, (i) => t0 + (i + 1) * MINUTE, { steps });
    // Among the last 100 of theirs, but 40 days old.
    const b = made([START, CREATE()]);
    b.publish();
    const old = seedRuns(b.id, b.step("Inicio"), 5, (i) => t0 - 40 * DAY + i * HOUR, {
      steps,
      prefix: "viejo",
    });
    const tests = seedRuns(a.id, trigger, 25, (i) => t0 + i * MINUTE, {
      steps,
      test: true,
      prefix: "prueba",
    });
    const now = t0 + DAY;
    expect(pruneRuns(store, a.id, now)).toBe(11 + 5);
    expect(pruneRuns(store, b.id, now)).toBe(5);
    for (const r of [sample.id, ...young.slice(0, 10), ...old]) {
      expect(whole(r), r).toBe(false);
      // Its summary stays: what it did, how it ended, which version, what started it.
      const view = ok(runView(store, store.journal.automationRun(r)?.automation as string, r));
      expect(view.run).toMatchObject({ state: "done", version: 1, pruned: now });
      expect(view.run.line).not.toBeNull();
      expect(view.steps).toEqual({});
    }
    for (const r of young.slice(10)) expect(whole(r), r).toBe(true);
    // Of the tests, the last 20; the rest are gone whole.
    for (const r of tests.slice(0, 5)) expect(store.journal.automationRun(r)).toBeNull();
    for (const r of tests.slice(5)) expect(whole(r), r).toBe(true);
    // The list still shows every real run, the summary ones with the rest.
    expect(ok(runsOf(store, a.id, {})).runs.at(-1)?.id).toBe(young[60]);
    // Again, nothing more goes.
    expect(pruneRuns(store, a.id, now)).toBe(0);
    // Hours that did not run, newer than all of them, take no place among the last 100.
    for (let i = 0; i < 5; i++)
      store.journal.missAutomationRun({
        id: `r_no_corrio${i}`,
        automation: a.id,
        version: 1,
        trigger,
        fields: "{}",
        slot: t0 + (200 + i) * MINUTE,
        at: t0 + (200 + i) * MINUTE,
      });
    pruneRuns(store, a.id, now);
    for (const r of young.slice(10)) expect(whole(r), r).toBe(true);
  });

  it("AU-103 · a run whose proposal waits in the inbox stays whole until it is answered: what it asked is read when it is accepted", async () => {
    const asks = made([START, ["Crear", "collection", { ...CREATE()[2], permission: "ask" }]]);
    asks.publish();
    const asked = await ran(asks.id, asks.step("Inicio"), { nota: "pedida" });
    const proposal = asked.proposal as string;
    expect(store.journal.proposal(proposal)?.status).toBe("pending");
    const t0 = Date.now();
    seedRuns(asks.id, asks.step("Inicio"), 100, (i) => t0 + (i + 1) * MINUTE);
    expect(pruneRuns(store, asks.id, t0 + DAY)).toBe(0);
    expect(store.journal.automationRunSteps(asked.id).map((x) => x.step)).toContain(ASKED_STEP);
    store.journal.setProposal(proposal, "rejected", t0);
    expect(pruneRuns(store, asks.id, t0 + DAY)).toBe(1);
    expect(store.journal.automationRunSteps(asked.id)).toEqual([]);
  });

  it("AU-103 · a year of hourly runs of one automation leaves 100 whole, and pruning them, at the end of a run and at start-up, stays within the time written here", async () => {
    const a = made([START, CREATE()]);
    a.publish();
    const sample = await ran(a.id, a.step("Inicio"), { nota: "muestra" });
    const steps = store.journal.automationRunSteps(sample.id);
    const year = 8_760;
    const ids = seedRuns(a.id, a.step("Inicio"), year, (i) => NOW - (year - i) * HOUR, {
      steps,
      prefix: "ano",
      state: (i) => (i % 50 === 0 ? "failed" : "done"),
    });
    // What a run's end does: one short write (task 137: the server answers nothing while it runs).
    let t = clock();
    expect(pruneRuns(store, a.id, NOW)).toBe(PRUNE_BATCH);
    under(clock() - t, 60, "clock");
    // At start-up: the rest, in writes as short, the event loop free between them.
    let between = 0;
    const timer = setInterval(() => between++, 0);
    t = clock();
    const rest = await pruneAllRuns(store, NOW);
    const ms = clock() - t;
    clearInterval(timer);
    expect(rest).toBe(year + 1 - KEEP_WHOLE - PRUNE_BATCH);
    under(ms, 3_000, "clock");
    expect(between).toBeGreaterThan(0);
    const left = ids.filter((r) => whole(r));
    expect(left).toEqual(ids.slice(year - (KEEP_WHOLE - 1)));
    expect(whole(sample.id)).toBe(true);
    // The list and one run still answer as they did (AU-99).
    t = clock();
    expect(ok(runsOf(store, a.id, { before: ids[1_000] as string })).runs[0]?.id).toBe(ids[999]);
    under(clock() - t, 40, "clock");
  });
});

describe("a run a restart left half done (F14d)", () => {
  it("AU-190 · a server that starts with a run still marked as running closes it as interrupted, naming the step it was in, and does not run it again; what its finished steps wrote stays and is undone from it", async () => {
    const home = mkdtempSync(join(dir, "arranque-"));
    const planner = fakePlanner([]);
    const host = new AgentHost({ dataDir: home, providers: { planner, reader: planner } });
    const own = host.store(1);
    seeded(own);
    const gate = held();
    const a = made([START, CREATE(), CODE], {}, own);
    a.publish();
    const { run } = ok(
      await startRun(own, a.id, { trigger: a.step("Inicio"), fields: { nota: "a medias" } }, JUAN, {
        box: gate.box,
      }),
    );
    // The server stops in the middle of the «Código»: the box never answers and the store is opened again.
    await gate.arrived;
    expect(notes(own)).toContain("a medias");
    const before = opLog(own);
    host.close();
    const next = new AgentHost({ dataDir: home, providers: { planner, reader: planner } });
    const again = next.store(1);
    const view = ok(runView(again, a.id, run.id));
    expect(view.run.state).toBe("interrupted");
    expect(view.run.step).toBe(a.step("Código"));
    expect(view.run.ended).not.toBeNull();
    expect(ok(runsOf(again, a.id, { filter: "failed" })).runs.map((r) => r.id)).toEqual([run.id]);
    // Not run again: no other run, nothing more saved; opening again finds none to close.
    await settled(again);
    expect(ok(runsOf(again, a.id, {})).runs).toHaveLength(1);
    expect(opLog(again)).toBe(before);
    expect(interruptRuns(again)).toEqual([]);
    // What «Crear» saved stays, and is undone from it.
    expect(view.undoable).toBe(true);
    ok(undoAutomationRun(again, a.id, run.id, JUAN));
    expect(notes(again)).not.toContain("a medias");
    // A new run of it may start: none is open.
    expect(
      (
        await ran(
          a.id,
          a.step("Inicio"),
          { nota: "otra" },
          { box: { run: async () => answering([]) } },
          again,
        )
      ).state,
    ).toBe("done");
    next.close();
  });

  // The hour of an interrupted scheduled run counts as run: scheduler.test.ts (S3).
});

describe("a renamed collection (F14d)", () => {
  it("AU-192 · after a collection is renamed, the published version whose code cites it by its old name still reads and saves in that same collection", async () => {
    const a = made([START, CODE]);
    a.publish();
    renameCollection(store, PEDIDO, { name: "Encargo" });
    // Another collection takes the old name: the code's «Pedido» is still the collection it was published with.
    renameCollection(store, CLIENTE, { name: "Pedido" });
    const box: Box = { run: async () => answering(CREATE_ONE) };
    const r = await ran(a.id, a.step("Inicio"), {}, { box });
    expect(r.state, JSON.stringify(r.error)).toBe("done");
    expect(notes()).toContain("del código");
    expect(store.list(CLIENTE)).toHaveLength(1);
    expect(r.line?.writes).toEqual([
      { collection: "pedido", name: "Encargo", action: "create", n: 1 },
    ]);
  });

  it("AU-192 · the name a version kept never widens what it reaches: without that collection among the step's connections the step fails, and with the collection archived it fails saying which", async () => {
    const a = made([START, CODE]);
    a.publish();
    renameCollection(store, PEDIDO, { name: "Encargo" });
    renameCollection(store, CLIENTE, { name: "Pedido" });
    const run = runDeps(store, a.id, JUAN, undefined, "r_ejemplo");
    const code = store.journal.automationVersion(a.id, 1);
    const step = (JSON.parse(code?.doc ?? "{}") as Automation).steps.find(
      (s) => s.id === a.step("Código"),
    );
    if (!step) throw new Error("no step");
    // With its connection, the kept name; the same step with no connection to it gets today's name, never the kept one.
    expect(run.collectionNamed?.("Pedido", step.id)).toBe("pedido");
    expect(run.collectionNamed?.("Pedido")).toBe("cliente");
    const kept = JSON.parse(code?.names ?? "{}") as KeptNames;
    const today = (name: string) => (name === "Pedido" ? "cliente" : undefined);
    expect(namedFor(step, kept, today)("Pedido")).toBe("pedido");
    expect(namedFor({ ...step, connections: [] }, kept, today)("Pedido")).toBe("cliente");
    // Archived: the run does not start, and says which collection.
    store.applySchema({ op: "archive_type", type: PEDIDO, archived: true }, BY_HAND);
    const box: Box = { run: async () => answering(CREATE_ONE) };
    const before = opLog();
    const refused = await startRun(store, a.id, { trigger: a.step("Inicio"), fields: {} }, JUAN, {
      box,
    });
    expect(JSON.stringify(refused)).toMatch(/invalid|failed/);
    expect(JSON.stringify(refused)).toContain("pedido");
    await settled(store);
    expect(opLog()).toBe(before);
    expect(store.list(CLIENTE)).toHaveLength(1);
  });
});

describe("the limits of a run at the user's volume (F14d)", () => {
  /** 12,000 orders, 3,000 of each amount from 0 to 3, as an import brings them. */
  const twelve = () => {
    const importe = field(store, PEDIDO, "importe");
    store.batch(() => {
      for (let i = 0; i < 12_000; i++)
        store.create(
          PEDIDO,
          { [importe]: { value: i % 4, label: SEED } },
          { actor: "import", device: "seed" },
        );
    });
    return importe;
  };
  const count = (importe: string, v: number) =>
    store.list(PEDIDO).filter((e) => e.entity.values[importe] === v).length;
  /** The event loop's longest pause while `f` runs: what the app's other requests wait for meanwhile. */
  async function paused<T>(f: () => Promise<T>): Promise<{ value: T; worst: number; ms: number }> {
    let last = clock();
    let worst = 0;
    const tick = setInterval(() => {
      const now = clock();
      worst = Math.max(worst, now - last);
      last = now;
    }, 5);
    const t = clock();
    try {
      const value = await f();
      return { value, worst: Math.max(worst, clock() - last), ms: clock() - t };
    } finally {
      clearInterval(tick);
    }
  }
  /**
   * The measurements are kept by hand, never in CI: `BONI_MEASURE=<file>` runs them and appends each line to the file
   * (vitest keeps a test's console to itself). Task 137 makes them fast enough to bound here.
   */
  const MEASURE = process.env.BONI_MEASURE;
  const told = (what: string, m: { ms: number; worst: number }) => {
    if (MEASURE)
      appendFileSync(
        MEASURE,
        `${what}: ${Math.round(m.ms)} ms, the server paused ${Math.round(m.worst)} ms at most\n`,
      );
  };
  const MARK: StepSpec[] = [
    ["Inicio", "manual", { fields: [] }],
    [
      "Marcar",
      "collection",
      {
        collection: "pedido",
        action: "update",
        target: "matching",
        where: [{ field: "importe", op: "is", value: 0 }],
        fields: [{ field: "importe", value: 9 }],
        permission: "yes",
      },
    ],
  ];

  it("AU-17 · «Las que cumplan…» matching 3,000 rows in a store of 12,000 records stops at the default limit of rows written before it saves any, with no operation in the log and nothing to undo", async () => {
    const importe = twelve();
    const a = made(MARK);
    a.publish();
    const before = opLog();
    const m = await paused(() => ran(a.id, a.step("Inicio")));
    told("3,000 rows found, stopped by the limit", m);
    expect(m.value.error).toMatchObject({
      failure: { code: "run.limit", detail: { limit: "rowsWritten", max: 1_000, got: 3_000 } },
    });
    expect(opLog()).toBe(before);
    expect(count(importe, 0)).toBe(3_000);
    expect(runView(store, a.id, m.value.id)).toMatchObject({ undoable: false, wrote: false });
  }, 60_000);

  it.todo(
    "AU-17 · with the limit raised, «Las que cumplan…» saves its 3,000 rows in one transaction within the time written here, and undoing the run brings them back (task 137: a run commits one transaction per row today, 72 s for these 3,000)",
  );

  it.skipIf(!MEASURE)(
    "measured by hand: a run that writes 3,000 and then 12,000 rows of a store of 12,000, and its undo, with how long the server pauses meanwhile",
    async () => {
      const importe = twelve();
      const a = made(MARK, { limits: { rowsWritten: 3_000 } });
      a.publish();
      const m = await paused(() => ran(a.id, a.step("Inicio")));
      told("3,000 rows written", m);
      expect(m.value.state, JSON.stringify(m.value.error)).toBe("done");
      expect(store.runOps(m.value.id)).toHaveLength(3_000);
      const u = await paused(async () => ok(undoAutomationRun(store, a.id, m.value.id, JUAN)));
      told("3,000 rows undone", u);
      expect(count(importe, 0)).toBe(3_000);

      const b = made(
        [
          ["Inicio", "manual", { fields: [] }],
          [
            "Lista",
            "edit",
            { fields: [{ field: "n", value: [0, 1, 2, 3].map((v) => ({ from: v, to: v + 10 })) }] },
          ],
          ["Partir", "split", { field: "n" }],
          [
            "Mover",
            "collection",
            {
              collection: "pedido",
              action: "update",
              target: "matching",
              where: [{ field: "importe", op: "is", value: cite("$json.n.from") }],
              fields: [{ field: "importe", value: cite("$json.n.to") }],
              permission: "yes",
            },
          ],
        ],
        { limits: { rowsWritten: 12_000, ms: 600_000 } },
      );
      b.publish();
      const n = await paused(() => ran(b.id, b.step("Inicio")));
      told("12,000 rows written", n);
      expect(n.value.state, JSON.stringify(n.value.error)).toBe("done");
      expect(store.runOps(n.value.id)).toHaveLength(12_000);
      const v = await paused(async () => ok(undoAutomationRun(store, b.id, n.value.id, JUAN)));
      told("12,000 rows undone", v);
      expect(count(importe, 13)).toBe(0);
    },
    3_600_000,
  );

  it.todo(
    "AU-17 · a run that writes 12,000 rows, with its limit raised to them, saves and is undone whole within the time written here (task 137: 314 s today)",
  );
});

describe("what a failure tells (F14d)", () => {
  it("AU-182 · the line of a run that saved something from outside without asking ends in «con datos de fuera», from the labels of what it wrote; one that saved only its own does not", async () => {
    const a = made([
      ["Inicio", "manual", { fields: [] }],
      [
        "Buscar",
        "collection",
        {
          collection: "pedido",
          action: "find",
          where: [{ field: "nota", op: "is", value: "de un correo" }],
        },
      ],
      [
        "Crear",
        "collection",
        {
          collection: "cliente",
          action: "create",
          fields: [{ field: "nombre", value: cite("$json.nota") }],
          permission: "yes",
        },
      ],
    ]);
    a.publish();
    store.create(
      PEDIDO,
      { [field(store, PEDIDO, "nota")]: { value: "de un correo", label: SEED } },
      { actor: "import", device: "seed" },
    );
    const own = await ran(a.id, a.step("Inicio"));
    expect(own.line).toMatchObject({ writes: [{ collection: "cliente", n: 1 }], outside: false });
    store.create(
      PEDIDO,
      { [field(store, PEDIDO, "nota")]: { value: "de un correo", label: OUTSIDE } },
      { actor: "import", device: "seed" },
    );
    const outside = await ran(a.id, a.step("Inicio"));
    expect(outside.state, JSON.stringify(outside.error)).toBe("done");
    expect(outside.line?.outside).toBe(true);
  });

  it("AU-188 AU-192 · a «Sí» belongs to its collection by key: after a rename the run still saves in the same one, and a new collection given the name of a deleted one gets no «Sí»", async () => {
    const a = made([START, CODE]);
    a.publish();
    renameCollection(store, PEDIDO, { name: "Encargo" });
    renameCollection(store, CLIENTE, { name: "Pedido" });
    // The «Código» asks for «Pedido»: its «Sí» is the order collection's, by key, never the one now named so.
    const box: Box = { run: async () => answering(CREATE_ONE) };
    const r = await ran(a.id, a.step("Inicio"), {}, { box });
    expect(r.line?.writes).toEqual([
      { collection: "pedido", name: "Encargo", action: "create", n: 1 },
    ]);
    expect(store.list(CLIENTE)).toHaveLength(1);
    // The order collection sent to the trash: the collection with its old name gets nothing, with «Sí» or without.
    store.applySchema({ op: "archive_type", type: PEDIDO, archived: true }, BY_HAND);
    const before = opLog();
    await startRun(store, a.id, { trigger: a.step("Inicio"), fields: {} }, JUAN, { box });
    await settled(store);
    expect(opLog()).toBe(before);
    expect(store.list(CLIENTE)).toHaveLength(1);
  });

  it("AU-102 · the kept record and the notice of a write outside its connection's filter (`code.write.outside`) are the same whether or not that row exists", async () => {
    const a = made([
      ["A su hora", "schedule", { rules: [{ key: "r_cada_hora", every: "hour", at: "08:00" }] }],
      [
        "Cambiar",
        "code",
        {
          mode: "all",
          source: "$col('Pedido').update('una fila', { nota: 'cambiada' })\nreturn []",
        },
        {
          connections: [
            {
              ...newConnection("pedido"),
              read: { where: [{ field: "nota", op: "is", value: "abierto" }] },
              update: { mode: "yes" },
            },
          ],
        },
      ],
    ]);
    a.publish();
    const uno = store.list(PEDIDO)[0]?.entity.id as string;
    const nowhere = `${uno.slice(0, -6)}zzzzzz`;
    expect(store.get(nowhere)).toBeNull();
    let id = uno;
    const box: Box = {
      run: async () =>
        answering(
          id
            ? [
                {
                  collection: "Pedido",
                  action: "update",
                  id,
                  fields: { nota: "cambiada" },
                  line: 1,
                },
              ]
            : [],
        ),
    };
    const at = async (slot: number) => {
      const { run } = ok(
        await startScheduledRun(store, a.id, a.step("A su hora"), slot, "Europe/Madrid", { box }),
      );
      await settled(store);
      const r = ok(runView(store, a.id, run.id));
      const step = store.journal
        .automationRunSteps(run.id)
        .find((x) => x.step === a.step("Cambiar"));
      // The record without how long it took, the one thing that may differ.
      const { ms: _ms, ...record } = JSON.parse(step?.record ?? "{}");
      return { error: r.run.error, notice: r.run.notice, record };
    };
    const before = orders();
    const outside = await at(NOW);
    // One that ends well between them closes the streak, so the second failure tells too.
    id = "";
    await at(NOW + HOUR);
    id = nowhere;
    const missing = await at(NOW + 2 * HOUR);
    expect(outside.error?.why).toMatchObject({
      code: "code.write.outside",
      detail: { why: "row" },
    });
    expect(outside.notice).toEqual({
      kind: "failed",
      text: "Revisar pedidos falló en «Cambiar»: el código guarda fuera de las filas que su conexión le deja.",
    });
    expect(missing).toEqual(outside);
    expect(orders()).toEqual(before);
  });
});

describe("the actions and their routes (F14d)", () => {
  it("AU-97 AU-18 · «Ejecutar» through its action writes with the run in the log, and «Deshacer lo que hizo» undoes it whole; the actions wait for their controls, and the reads are routed", async () => {
    const registry = withRunActions(withPublishActions(withAutomationActions(new ToolRegistry())));
    expect(Object.keys(RUN_ACTIONS).every((x) => registry.get(x))).toBe(true);
    // Registered for everyone with their controls (P2), each route listed and run by its action.
    for (const x of Object.keys(RUN_ACTIONS)) expect(ACTIONS.get(x)?.name).toBe(x);
    for (const [route, { action }] of Object.entries(RUN_ROUTES)) {
      expect(ACTIONS.get(action)?.name, route).toBe(action);
      expect(ROUTES[route], route).toBe("tailnet");
    }
    const a = made([START, CREATE()]);
    a.publish();
    const mine = { store, trust: "personal" as const, device: "d_portatil", registry };
    const before = orders();
    const started = await runAction(
      "automations.run",
      { id: a.id, trigger: a.step("Inicio"), fields: { nota: "por la acción" } },
      mine,
    );
    const run = (started as { out: { run: RunSummary } }).out.run;
    expect(run.state).toBe("running");
    await settled(store);
    expect(notes()).toContain("por la acción");
    expect(store.runOps(run.id)).toHaveLength(1);
    const shared = { ...mine, trust: "shared" as const, device: "d_salon" };
    expect(
      JSON.stringify(await runAction("automations.undo_run", { id: a.id, run: run.id }, shared)),
    ).toMatch(/not-personal|refused/);
    const undone = await runAction("automations.undo_run", { id: a.id, run: run.id }, mine);
    expect("out" in undone).toBe(true);
    expect(orders()).toEqual(before);

    // The reads over HTTP, from a shared device too.
    const { server, host, call, trust } = await served();
    try {
      const own = host.store(1);
      seeded(own);
      const b = made([START, CREATE()], {}, own);
      b.publish();
      const r = await ran(b.id, b.step("Inicio"), { nota: "por http" }, {}, own);
      trust("shared");
      const base = `/api/agent/automations/${b.id}`;
      const list = await call("GET", `${base}/runs?filter=all`);
      expect(list.status, JSON.stringify(list.body)).toBe(200);
      expect((list.body.runs as RunSummary[]).map((x) => x.id)).toEqual([r.id]);
      const one = await call("GET", `${base}/runs/${r.id}`);
      expect(one.status).toBe(200);
      expect((one.body.run as RunSummary).state).toBe("done");
      const rows = await call(
        "GET",
        `${base}/runs/${r.id}/rows?step=${b.step("Crear")}&side=out&name=main&offset=0`,
      );
      expect(rows.status, JSON.stringify(rows.body)).toBe(200);
      expect(rows.body.total).toBe(1);
      expect((await call("GET", `${base}/runs/r_ninguna`)).status).toBe(404);
    } finally {
      server.close();
    }
  });

  it("AU-97 AU-18 AU-100 AU-93 · the touches over HTTP as the app calls them: «Ejecutar», «Reintentar», «Deshacer lo que hizo» and «Fijar», refused from a shared device and done from his own", async () => {
    const { server, host, call, trust } = await served();
    try {
      const own = host.store(1);
      seeded(own);
      const b = made([START, CREATE()], {}, own);
      b.publish();
      const base = `/api/agent/automations/${b.id}`;
      const trigger = b.step("Inicio");
      const mine = { status: 403, body: { error: "personal-device-only" } };
      trust("shared");
      expect(await call("POST", `${base}/run`, { trigger, fields: { nota: "del salón" } })).toEqual(
        mine,
      );
      trust("personal");
      const started = await call("POST", `${base}/run`, { trigger, fields: { nota: "por http" } });
      expect(started.status, JSON.stringify(started.body)).toBe(200);
      const first = (started.body.run as RunSummary).id;
      await settled(own);
      expect(notes(own)).toContain("por http");
      // «Reintentar» with the version published now, and «Deshacer y reintentar»: the first is undone before.
      const again = await call("POST", `${base}/runs/${first}/retry`, {});
      expect(again.status, JSON.stringify(again.body)).toBe(200);
      expect(again.body.version).toBe(1);
      expect((again.body.run as RunSummary).retryOf).toBe(first);
      await settled(own);
      expect(notes(own).filter((x) => x === "por http")).toHaveLength(2);
      const second = (again.body.run as RunSummary).id;
      // Each is undone on its own (a later one that changed the same rows refuses it: «changed», above).
      const undone = await call("POST", `${base}/runs/${second}/undo`);
      expect(undone.status, JSON.stringify(undone.body)).toBe(200);
      expect(undone.body.refused).toBeUndefined();
      expect(notes(own).filter((x) => x === "por http")).toHaveLength(1);
      expect((await call("POST", `${base}/runs/${second}/undo`)).body.refused).toBe("nothing");
      const redo = await call("POST", `${base}/runs/${first}/retry`, { undo: true });
      expect(redo.status, JSON.stringify(redo.body)).toBe(200);
      await settled(own);
      expect(notes(own).filter((x) => x === "por http")).toHaveLength(1);
      // «Fijar» a tested step's output and release it; «Abrir en el editor con estos datos» pins the trigger's.
      expect((await call("PUT", `${base}/pins/${trigger}`)).body.refused).toBe("untested");
      await call("POST", `${base}/test`, { trigger, fields: { nota: "de prueba" } });
      const pinned = await call("PUT", `${base}/pins/${trigger}`);
      expect(Object.keys(pinned.body.pins as object)).toEqual([trigger]);
      expect((await call("DELETE", `${base}/pins/${trigger}`)).body.pins).toEqual({});
      const opened = await call("POST", `${base}/runs/${first}/pin`);
      expect(opened.status, JSON.stringify(opened.body)).toBe(200);
      expect(opened.body.trigger).toBe(trigger);
      trust("shared");
      expect(await call("POST", `${base}/runs/${first}/undo`)).toEqual(mine);
      expect(await call("DELETE", `${base}/pins/${trigger}`)).toEqual(mine);
    } finally {
      server.close();
    }
  });
});

// ---------------------------------------------------------------- the server over HTTP

const SIGN_IN = "una contraseña larga de ejemplo";
/** The server on the tailnet entry, with its own accounts and Juan's store in its host, signed in from a laptop. */
async function served() {
  const home = mkdtempSync(join(dir, "http-"));
  const db = openDb(join(home, "system.db"));
  addUser(db, "juan", SIGN_IN);
  const planner = fakePlanner([]);
  const host = new AgentHost({ dataDir: home, providers: { planner, reader: planner } });
  const app = makeApp({
    db,
    key: randomBytes(32),
    feeds: new Feeds(async () => ""),
    guard: new LoginGuard({ perUser: 50, perAddress: 100, windowMs: 60_000, perMinute: 100 }),
    agent: host,
    write: true,
  });
  const server: Server = serve(app, "tailnet");
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  server.on("close", () => db.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const login = await fetch(`${base}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user: "juan", password: SIGN_IN, device: "portatil-ejemplo" }),
  });
  const token = ((await login.json()) as { token: string }).token;
  const call = async (method: string, p: string, body?: unknown) => {
    const res = await fetch(`${base}${p}`, {
      method,
      headers: { authorization: `Bearer ${token}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const trust = (t: string) =>
    db.prepare("UPDATE devices SET trust = ? WHERE name = ?").run(t, "portatil-ejemplo");
  return { server, host, call, trust };
}
