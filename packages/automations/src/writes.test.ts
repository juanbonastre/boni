// A «Código» that saves (docs/automatizaciones.md AU-172 to AU-185; writes.ts). The lists run already: they hold what
// the builders and the screen count on while they are apart from `CODE_*`. The rest is pending: the builder turns each
// into a real one, keeping the rule's id in its name (`make check` reads them). Every rule holds against code written
// to get around it (A-01): the rules such code could get around have their attack here. Real tests use the fakes of
// run.test-util.ts; collection and field names in them are invented («Gastos», «Categorías», «Notas»).
import type { Label } from "@boni/entities";
import { clock as now, under } from "@boni/pace";
import { describe, expect, it } from "vitest";
import { collection, ids, knowing, sketch } from "./automation.test-util.ts";
import type { Box, BoxJob, Evaluated, Fields } from "./box.ts";
import {
  CODE_FAILURES,
  CODE_LIMITS,
  CODE_PROBLEMS,
  CODE_TYPE,
  CodeFault,
  type WriteAction,
} from "./code.ts";
import {
  allowing,
  CONNECTION_ACTIONS,
  type Connection,
  connectionActions,
  newConnection,
  permissions,
} from "./connections.ts";
import { type GateUnit, guard, type StoredRow } from "./effects.ts";
import { run, type StepRecord } from "./engine.ts";
import { STEP_FAILURES } from "./failures.ts";
import { AUTOMATION_LIMITS, type RunLimits, type Step, type StepSettings } from "./format.ts";
import { type CodeContext, readCode } from "./javascript.ts";
import type { Cell } from "./rows.ts";
import {
  deps,
  type FakePolicy,
  type FakeStore,
  OUTSIDE,
  OWN,
  outOf,
  policy,
  store,
} from "./run.test-util.ts";
import { canRun, PROBLEMS, validate } from "./validate.ts";
import {
  applyWrites,
  COL_METHODS,
  CONNECTION_ASKS,
  connectionUses,
  consentOf,
  grantsOf,
  insideConnection,
  readWrites,
  stepChanges,
  WRITE_ACTIONS,
  WRITE_FAILURES,
  WRITE_LIMITS,
  WRITE_MODES,
  WRITE_PROBLEMS,
  type WriteGate,
  type WriteInput,
  type WriteRequest,
  writeProblems,
} from "./writes.ts";

const next = ids(13);
const expenses = collection(next, ["number", "text"]);
const categories = collection(next, ["text"]);
const notes = collection(next, ["text"]);
const NAMES: Record<string, string> = {
  Gastos: expenses.key,
  Categorías: categories.key,
  Notas: notes.key,
};
const named = (name: string) => NAMES[name];
const ctx: CodeContext = {
  ...knowing(expenses, categories, notes),
  collectionNamed: named,
  collectionName: (key) => Object.entries(NAMES).find(([, k]) => k === key)?.[0],
};

/** A trigger, a search of «Gastos», then a «Código» with that source and those connections. */
function withCode(
  source: string,
  connections: Connection[],
  more: { mode?: "all" | "perRow"; onError?: StepSettings["onError"] } = {},
) {
  const s = sketch(5)
    .step("Inicio", "manual", { fields: [] })
    .step("Buscar", "collection", { collection: expenses.key, action: "find" })
    .step(
      "Código",
      CODE_TYPE,
      { mode: more.mode ?? "all", source },
      more.onError ? { onError: more.onError } : undefined,
    )
    .arrow("Inicio", "Buscar")
    .arrow("Buscar", "Código");
  const a = s.build();
  const step = a.steps.find((x) => x.name === "Código") as Step;
  step.connections = connections;
  return { a, s, step };
}
const codes = (problems: readonly { code: string }[]) => problems.map((p) => p.code);
const ofStep = <P extends { step?: string }>(problems: readonly P[], step: Step) =>
  problems.filter((p) => p.step === step.id);
/** A connection to «Gastos» that reads and gives these write cells. */
const toExpenses = (cells: Partial<Pick<Connection, "create" | "update" | "remove">> = {}) => ({
  ...newConnection(expenses.key),
  ...cells,
});
/** The text a site or a problem's place points at. */
const cut = (source: string, at: { from: number | string; to: number | string }) =>
  source.slice(Number(at.from), Number(at.to));

// ---------------------------------------------------------------- a box that asks to save, and a run through it

const [amount, note] = expenses.fields.map((f) => f.key) as [string, string];
const [title] = categories.fields.map((f) => f.key) as [string];
/** `n` rows of «Gastos»: the amount is the row's place; the note «abierto» on the odd ones, «cerrado» on the even. */
const ROWS = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ [amount]: i, [note]: i % 2 ? "abierto" : "cerrado" }));
const db = (n = 4, of: Label = OWN) =>
  store(
    [expenses, categories, notes],
    { [expenses.key]: ROWS(n), [categories.key]: [{ [title]: "Casa" }] },
    ids(14),
    of,
  );
/** The ids of a collection's rows, in the order a search gives them. */
const idsOf = (st: FakeStore, key = expenses.key) =>
  st
    .rows(key)
    .map((r) => r.origin.id)
    .sort() as [string, string, ...string[]];
/** A row's id at a place, which a test knows is there. */
const at = (list: readonly string[], i: number) => list[i] as string;

interface Seen {
  /** The row of this evaluation, as sent; undefined in «Una vez con todas las filas». */
  row: Fields | undefined;
  /** The row's place in the step's whole input. */
  at: number;
  job: BoxJob;
}
interface WritingBox extends Box {
  /** Every job it was sent, as it was sent. */
  jobs: BoxJob[];
}
/** A box that answers each evaluation by `answer`, requests to save among it: a real interpreter's answer, without one. */
function writingBox(answer: (s: Seen) => Evaluated): WritingBox {
  const jobs: BoxJob[] = [];
  return {
    jobs,
    async run(job) {
      jobs.push(structuredClone(job));
      const all = job.kind === "code" && job.mode === "all";
      const evaluations = Array.from({ length: all ? 1 : job.input.length }, (_, j) =>
        answer({ row: all ? undefined : job.input[j], at: job.from + j, job }),
      );
      return { evaluations, console: [], dropped: 0, ms: 1 };
    },
  };
}
/** An evaluation that gave `value` and asked for `writes`. */
const done = (value: Cell, writes: readonly WriteRequest[] = []): Evaluated => ({
  state: "done",
  values: [value],
  clock: false,
  random: false,
  ...(writes.length ? { writes } : {}),
});
/** It stopped at a read of «Gastos» it does not have yet; `key` is the box's. */
const needs = (key: string): Evaluated => ({
  state: "needs",
  key,
  read: { collection: "Gastos", op: "count" },
});
const update = (id: Cell, fields: Cell, more: Partial<WriteRequest> = {}): WriteRequest => ({
  collection: "Gastos",
  action: "update",
  id,
  fields,
  ...more,
});
const create = (fields: Cell, more: Partial<WriteRequest> = {}): WriteRequest => ({
  collection: "Gastos",
  action: "create",
  fields,
  ...more,
});
const remove = (id: Cell, more: Partial<WriteRequest> = {}): WriteRequest => ({
  collection: "Gastos",
  action: "remove",
  id,
  ...more,
});

/** A source the analysis reads as asking for each write action of «Gastos». */
const SAVES_ALL = [
  "$col('Gastos').create({ a: 1 })",
  "$col('Gastos').update('x', { a: 1 })",
  "$col('Gastos').remove('x')",
  "return []",
].join("\n");
/** One that asks only to modify «Gastos». */
const UPDATES = "$col('Gastos').update('x', { a: 1 })\nreturn []";
const YES = { mode: "yes" } as const;
const ASK = { mode: "ask" } as const;
const ALL_YES = toExpenses({ create: YES, update: YES, remove: YES });
const ALL_ASK = toExpenses({ create: ASK, update: ASK, remove: ASK });
/** «Solo estas filas»: the rows of «Gastos» whose note is «abierto». */
const onlyOpen = (cells: Partial<Pick<Connection, "create" | "update" | "remove">>) => ({
  ...toExpenses(cells),
  read: { where: [{ field: note, op: "is" as const, value: "abierto" }] },
});

/** Runs `withCode(source, connections)` over the store (a test when `test`), its box answering by `answer`. */
async function saving(
  source: string,
  connections: Connection[],
  answer: (s: Seen) => Evaluated,
  more: {
    test?: boolean;
    store?: FakeStore;
    policy?: FakePolicy;
    mode?: "all" | "perRow";
    onError?: StepSettings["onError"];
    /** The run's limits (AU-17), when a test needs more than their defaults. */
    limits?: Partial<RunLimits>;
  } = {},
) {
  const { a: drawn, s, step } = withCode(source, connections, more);
  const a = more.limits ? { ...drawn, settings: { limits: more.limits } } : drawn;
  const st = more.store ?? db();
  const box = writingBox(answer);
  const p = more.policy ?? policy();
  const e = await run(
    {
      automation: a,
      trigger: s.id("Inicio"),
      fields: { json: {}, label: OWN },
      test: more.test ?? false,
    },
    deps({ collectionNamed: named, collections: st, box, policy: p }),
  );
  return { a, e, rec: e.steps[step.id] as StepRecord, st, box, p, step };
}
const whyOf = (rec: StepRecord) => rec.error?.why;
/** What the policy was asked of writes, as action, destroys and collection. */
const writeCalls = (p: FakePolicy) =>
  p.calls.filter((c) => c.effect === "write").map((c) => [c.action, c.destroys, c.collection]);
/** The rows a step's change touches, as kind and id. */
const touched = (rec: StepRecord) =>
  rec.writes?.records.map((r) => [r.action, r.id ?? null]) ?? "nothing";

/** The unit of a «Código» saving, for the gate alone. */
const UNIT: GateUnit = {
  automation: { id: "e_ejemplo", version: 1 },
  step: "s_ejemplo",
  type: CODE_TYPE,
  action: "",
  effect: "write",
  destroys: false,
  control: null,
  test: false,
  own: OWN,
};
/** The gate of saving over a store, through `guard` as the engine builds it. */
const writer = (st: FakeStore, p: FakePolicy = policy(), test = false): WriteGate => {
  const g = guard(p, st, { ...UNIT, test });
  return {
    shape: (c) => st.shape(c),
    get: (c, id) => st.get(c, id),
    decideAll: (cs) => g.decideAll(cs),
    writeAll: (cs) => g.writeAll(cs),
  };
};
/** A gate that fails if it is asked anything but the collections' fields. */
const untouched: WriteGate = {
  shape: (c) => [expenses, categories, notes].find((x) => x.key === c),
  get: () => Promise.reject(new Error("read")),
  decideAll: () => Promise.reject(new Error("decided")),
  writeAll: () => Promise.reject(new Error("written")),
};
/** What `applyWrites` is given for these requests of `SAVES_ALL` with every cell «Sí», unless `more` says else. */
const writeInput = (requests: WriteRequest[], more: Partial<WriteInput> = {}): WriteInput => ({
  step: "s_ejemplo",
  requests,
  labels: requests.map(() => OWN),
  grants: grantsOf(readWrites(SAVES_ALL, "code"), named),
  connections: [ALL_ASK],
  collectionNamed: named,
  today: "2026-11-16",
  test: false,
  ...more,
});

describe("the lists of saving from code", () => {
  it("every limit of saving is a whole number over zero, and is the one of `CODE_LIMITS` by the same key", () => {
    for (const [key, value] of Object.entries(WRITE_LIMITS)) {
      expect(Number.isInteger(value), key).toBe(true);
      expect(value, key).toBeGreaterThan(0);
      expect(CODE_LIMITS[key as keyof typeof CODE_LIMITS], key).toBe(value);
    }
  });

  it("what one evaluation may ask fits a step, a request fits a step, and what one read gives can be written back", () => {
    expect(WRITE_LIMITS.writes).toBeLessThanOrEqual(WRITE_LIMITS.stepWrites);
    expect(WRITE_LIMITS.writeBytes).toBeLessThanOrEqual(WRITE_LIMITS.stepWriteBytes);
    expect(WRITE_LIMITS.stepWrites).toBeGreaterThanOrEqual(CODE_LIMITS.readRows);
    expect(WRITE_LIMITS.stepWriteBytes).toBeLessThanOrEqual(CODE_LIMITS.outputBytes);
  });

  it("the failures and problems of saving are joined into `CODE_FAILURES` and `CODE_PROBLEMS`, each once, and none is one the engine or validation has of its own", () => {
    for (const code of WRITE_FAILURES)
      expect(
        CODE_FAILURES.filter((c) => c === code),
        code,
      ).toHaveLength(1);
    for (const code of WRITE_PROBLEMS)
      expect(
        CODE_PROBLEMS.filter((c) => c === code),
        code,
      ).toHaveLength(1);
    const failures = new Set<string>([...STEP_FAILURES, ...CODE_FAILURES]);
    expect(failures.size).toBe(STEP_FAILURES.length + CODE_FAILURES.length);
    const problems = new Set<string>([...PROBLEMS, ...CODE_PROBLEMS]);
    expect(problems.size).toBe(PROBLEMS.length + CODE_PROBLEMS.length);
  });

  it("the write actions are the connection's, each takes «Preguntar» or «Sí» on its own, and `$col` has no other method", () => {
    for (const action of WRITE_ACTIONS) {
      expect(CONNECTION_ACTIONS).toContain(action);
      expect(WRITE_MODES[action]).toEqual(["ask", "yes"]);
    }
    expect(new Set(COL_METHODS).size).toBe(COL_METHODS.length);
  });

  it("a failure of saving is a `CodeFault` of the source that says which, as any failure of a «Código»", async () => {
    const fault = await applyWrites(
      writeInput([update("e_ejemplo", { [amount]: 1 })], { connections: [toExpenses()] }),
      untouched,
    ).catch((e: unknown) => e);
    expect(fault).toBeInstanceOf(CodeFault);
    expect((fault as CodeFault).failure).toEqual({ code: "other", param: "source" });
    expect((fault as CodeFault).why).toEqual({
      code: "code.write.notAllowed",
      param: "source",
      detail: { collection: expenses.key, action: "update" },
    });
  });
});

describe("asking to save", () => {
  it("AU-172 · the three methods that ask to save are `.create({ … })`, `.update(id, { … })` and `.remove(id)` of `$col('Nombre')`, with the words of «Colección» (create, update, remove), and the analysis reads each call as one request of its action, in the order of the source, at the whole call; the four that read are no request", () => {
    expect(COL_METHODS.filter((m) => !(WRITE_ACTIONS as readonly string[]).includes(m))).toEqual([
      "find",
      "get",
      "count",
      "sum",
    ]);
    const source = [
      "const rows = $col('Gastos').find({ limit: 3 })",
      "$col('Notas').create({ texto: 'resumen' })",
      "for (const r of rows) $col('Gastos').update(r.id, { categoria: 'Casa' })",
      "$col('Gastos').remove(rows[0].id)",
      "return [{ n: $col('Notas').count() + $col('Gastos').sum('importe') }]",
    ].join("\n");
    const reading = readWrites(source, "code");
    expect(reading.problems).toEqual([]);
    expect(reading.writes.map((w) => [w.name, w.action, cut(source, w.at)])).toEqual([
      ["Notas", "create", "$col('Notas').create({ texto: 'resumen' })"],
      ["Gastos", "update", "$col('Gastos').update(r.id, { categoria: 'Casa' })"],
      ["Gastos", "remove", "$col('Gastos').remove(rows[0].id)"],
    ]);
    expect(reading.writes.map((w) => [w.at.line, w.at.column])).toEqual([
      [2, 1],
      [3, 23],
      [4, 1],
    ]);
    // `readCode` gives the same, in the same walk that finds the collections it cites.
    const read = readCode(source, "code");
    expect(read.writes).toEqual(reading.writes);
    expect(read.collections.map((c) => c.name)).toEqual(["Gastos", "Notas"]);
  });
  it("AU-172 · `.create({ … })`, `.update(id, { … })` and `.remove(id)` save nothing while the code runs: the evaluation's result lists them as requests, in the order asked, and the box gets only the methods granted", async () => {
    // That each call gives `undefined` and copies its arguments at the call is the box's: apps/sandbox's «saving».
    const st = db(3);
    const [first, second] = idsOf(st);
    const only = await saving(
      "$col('Gastos').update('x', { a: 1 })\nreturn [{ n: $col('Notas').count() }]",
      [ALL_ASK, { ...newConnection(notes.key), create: ASK }],
      () => done([], [update(first, { [amount]: 9 })]),
      { store: st },
    );
    // Only what the analysis found and the connection allows: «Notas» creates nowhere in the code.
    expect(only.box.jobs[0]?.writes).toEqual({ Gastos: ["update"] });
    const asked = [remove(second), create({ [amount]: 5 }), update(first, { [amount]: 9 })];
    const { e, rec, box } = await saving(SAVES_ALL, [ALL_ASK], () => done([], asked), {
      store: st,
    });
    expect([...(box.jobs[0]?.writes?.Gastos ?? [])].sort()).toEqual(["create", "remove", "update"]);
    expect(st.calls.filter((c) => c.method === "apply" || c.method === "applyAll")).toEqual([]);
    expect(st.applied).toEqual([]);
    expect(rec.state).toBe("done");
    expect(touched(rec)).toEqual([
      ["remove", second],
      ["create", null],
      ["update", first],
    ]);
    expect(e.asked.map((a) => a.change.kind)).toEqual(["trash", "create", "update"]);
  });
  it("AU-172 · a read after a request does not see it: `update` then `get` of the same row gives the row as saved, in a run and in «Probar»", async () => {
    for (const test of [false, true]) {
      const st = db(2);
      const first = at(idsOf(st), 0);
      const { e, step } = await saving(
        "$col('Gastos').update('x', { a: 1 })\nreturn [{ visto: $col('Gastos').get('x') }]",
        [toExpenses({ update: ASK })],
        ({ job }) =>
          "k" in job.reads
            ? done(
                [{ visto: (job.reads.k as Fields)[amount] ?? null }],
                [update(first, { [amount]: 99 })],
              )
            : { state: "needs", key: "k", read: { collection: "Gastos", op: "get", id: first } },
        { store: st, test },
      );
      expect(outOf(e, step.id), String(test)).toEqual([{ visto: 0 }]);
      expect(st.rows(expenses.key)[0]?.json[amount]).toBe(0);
    }
  });
  it("AU-172 · an id is data: `update` with a number, an object or an id of another collection's row fails at save (`code.write.request`, or `code.write.outside` as a row that is not there), never earlier and never by luck", async () => {
    const st = db(2);
    const first = at(idsOf(st), 0);
    const other = at(idsOf(st, categories.key), 0);
    for (const [id, why] of [
      [5, { code: "code.write.request", detail: { why: "id" } }],
      [{ id: first }, { code: "code.write.request", detail: { why: "id" } }],
      ["", { code: "code.write.request", detail: { why: "id" } }],
      [other, { code: "code.write.outside", detail: { why: "row" } }],
    ] as const) {
      const { e, rec, box } = await saving(
        UPDATES,
        [toExpenses({ update: YES })],
        () => done([], [update(id, { [amount]: 1 })]),
        { store: st },
      );
      expect(box.jobs, JSON.stringify(id)).toHaveLength(1);
      expect(whyOf(rec), JSON.stringify(id)).toMatchObject({
        ...why,
        detail: { ...why.detail, collection: expenses.key },
      });
      expect(rec.writes).toBeUndefined();
      expect(e.asked).toEqual([]);
    }
    expect(st.applied).toEqual([]);
  });
  it("AU-173 · the requests are applied when the step ends, in the order asked within an evaluation and in the order of the rows in «Una vez por fila»; only the last complete pass of an evaluation repeated for its reads counts, so a pass stopped at a read adds none", async () => {
    const st = db(3);
    const all = idsOf(st);
    const { rec } = await saving(
      SAVES_ALL,
      [ALL_ASK],
      ({ at: i, job }) =>
        "k" in job.reads
          ? done({ n: i }, [update(at(all, i), { [amount]: 10 + i }), create({ [amount]: i })])
          : needs("k"),
      { store: st, mode: "perRow" },
    );
    expect(rec.writes?.records.map((r) => [r.action, r.id ?? null, r.after?.[amount]])).toEqual([
      ["update", all[0], 10],
      ["create", null, 0],
      ["update", all[1], 11],
      ["create", null, 1],
      ["update", all[2], 12],
      ["create", null, 2],
    ]);
  });
  it("AU-173 · `update` and `remove` read the saved row once for the limits, «Haría esto» and the version: a row changed between that read and the write fails the step with `row.changed` and saves nothing", async () => {
    const st = db(3);
    const [first, second] = idsOf(st);
    const { rec } = await saving(
      SAVES_ALL,
      [ALL_ASK],
      () => done([], [update(first, { [amount]: 7 }), remove(second), create({ [amount]: 1 })]),
      { store: st },
    );
    // One read of each row, with no other question to the policy, and the change carries the version it read.
    expect(st.calls.filter((c) => c.method === "get")).toHaveLength(2);
    const asked = rec.writes?.kind === "asked" ? rec.writes.asked : [];
    expect(asked.map((a) => (a.change.kind === "create" ? null : a.change.row.version))).toEqual([
      1,
      1,
      null,
    ]);
    // Written later, as a whole: a row changed since that read takes back the whole change.
    const read = (await st.get(expenses.key, at(idsOf(st), 2))) as StoredRow;
    await st.apply({ kind: "update", row: read.origin, fields: { [amount]: 50 } }, {});
    const before = structuredClone(st.rows(expenses.key));
    const changes = asked.map((a) => ({ change: a.change, values: {} }));
    await expect(
      writer(st).writeAll([
        ...changes,
        { change: { kind: "update", row: read.origin, fields: { [amount]: 8 } }, values: {} },
      ]),
    ).rejects.toMatchObject({ failure: { code: "row.changed" } });
    expect(st.rows(expenses.key)).toEqual(before);
    expect(st.applied).toHaveLength(1);
  });
});

describe("all or nothing", () => {
  it("AU-174 · the policy is asked for every request before any is written, each as the «Colección» action that makes it: one refused fails the step with `policy.denied` and none of the others is saved", async () => {
    const st = db(3);
    const [first, second] = idsOf(st);
    let writes = 0;
    const p = policy((c) =>
      c.effect === "write" && ++writes === 3
        ? { kind: "deny", rule: "test.deny", reason: "no" }
        : { kind: "allow", rule: "test.allow" },
    );
    const { e, rec } = await saving(
      SAVES_ALL,
      [ALL_YES],
      () => done([], [create({ [amount]: 1 }), update(first, { [amount]: 2 }), remove(second)]),
      { store: st, policy: p },
    );
    expect(writeCalls(p)).toEqual([
      ["create", false, expenses.key],
      ["update", false, expenses.key],
      ["trash", true, expenses.key],
    ]);
    expect(rec.error?.failure?.code).toBe("policy.denied");
    expect(rec.writes).toBeUndefined();
    expect(e.asked).toEqual([]);
    expect(st.applied).toEqual([]);
  });
  it("AU-174 · a step's requests are written in one transaction of the store: a failure in the middle (the 3,000th of 3,000) leaves every row as it was", async () => {
    const st = store([expenses], { [expenses.key]: ROWS(3000) }, ids(15));
    const rows = [...st.rows(expenses.key)];
    const last = rows[2999] as StoredRow;
    await st.apply({ kind: "update", row: last.origin, fields: { [amount]: -1 } }, {});
    const before = structuredClone(st.rows(expenses.key));
    const changes = rows.map((r) => ({
      change: { kind: "update" as const, row: r.origin, fields: { [amount]: 1 } },
      values: {},
    }));
    await expect(writer(st).writeAll(changes)).rejects.toMatchObject({
      failure: { code: "row.changed" },
    });
    expect(st.rows(expenses.key)).toEqual(before);
    expect(st.applied).toHaveLength(1);
    // The server's store does the same in one transaction: apps/server/src/automations.test.ts (AU-174).
  });
  it("AU-174 · a «Preguntar» on any action asked for makes the whole step's change wait as one proposal («todo junto», Juan, 2026-11-16): modifying 12 rows with «Sí» and removing one with «Preguntar» proposes 13, and saves none", async () => {
    const st = db(13);
    const all = idsOf(st);
    const { e, rec } = await saving(
      "$col('Gastos').update('x', { a: 1 })\n$col('Gastos').remove('x')\nreturn []",
      [toExpenses({ update: YES, remove: ASK })],
      () =>
        done(
          [],
          [...all.slice(0, 12).map((id) => update(id, { [amount]: 1 })), remove(at(all, 12))],
        ),
      { store: st },
    );
    expect(rec.writes?.kind).toBe("asked");
    expect(rec.asked).toBe(13);
    expect(e.asked.map((a) => a.kind)).toEqual([...Array(12).fill("propose"), "confirm"]);
    expect(st.applied).toEqual([]);
  });
  it("AU-176 · AU-186 · a step whose every cell is «Sí» and a policy that allows saves its whole change in a real run and asks nothing (no `YES_SAVES`): create, modify and remove alike", async () => {
    const st = db(3);
    const [first, second] = idsOf(st);
    const { e, rec } = await saving(
      SAVES_ALL,
      [ALL_YES],
      () => done([], [create({ [amount]: 1 }), update(first, { [amount]: 2 }), remove(second)]),
      { store: st },
    );
    expect(rec.writes?.kind).not.toBe("asked");
    expect(e.asked).toEqual([]);
    expect(st.applied.map((c) => c.kind)).toEqual(["create", "update", "trash"]);
  });
  it("AU-174 · a code that throws after its requests, or a step that fails for any other reason, saves nothing; under «Si falla: seguir» the requests of the failed row are dropped and the others are saved", async () => {
    // Row 1 throws (its requests never leave the box); row 2 asks and then gives what is not rows.
    const answer =
      (all: readonly string[]) =>
      ({ at: i }: Seen): Evaluated =>
        i === 1
          ? {
              state: "failed",
              failure: { code: "code.threw", param: "source", detail: { message: "después" } },
              source: 0,
            }
          : done(i === 2 ? "texto" : { n: i }, [update(at(all, i), { [amount]: 100 + i })]);
    for (const onError of ["continue", "errorOutput"] as const) {
      const st = db(4);
      const all = idsOf(st);
      const { e, rec } = await saving(UPDATES, [toExpenses({ update: ASK })], answer(all), {
        store: st,
        mode: "perRow",
        onError,
      });
      expect(touched(rec), onError).toEqual([
        ["update", all[0]],
        ["update", all[3]],
      ]);
      expect(e.asked).toHaveLength(2);
    }
    const st = db(4);
    const stopped = await saving(UPDATES, [toExpenses({ update: ASK })], answer(idsOf(st)), {
      store: st,
      mode: "perRow",
    });
    expect(stopped.e.state).toBe("failed");
    expect(stopped.rec.writes).toBeUndefined();
    expect(stopped.e.asked).toEqual([]);
    // All the rows at once: what is not rows fails the step, and what it asked goes with it.
    const whole = await saving(
      UPDATES,
      [toExpenses({ update: ASK })],
      () => done("texto", [update(at(idsOf(st), 0), { [amount]: 1 })]),
      { store: st },
    );
    expect(whyOf(whole.rec)?.code).toBe("code.result");
    expect(whole.rec.writes).toBeUndefined();
    expect(whole.e.asked).toEqual([]);
    expect(st.applied).toEqual([]);
  });
  it("AU-174 · a request the policy refuses fails the whole step even under «Si falla: seguir» or «salir por error»: the refusal is the step's change, not a row's, so no other row's request is saved", async () => {
    for (const onError of ["continue", "errorOutput"] as const) {
      const st = db(4);
      const all = idsOf(st);
      let writes = 0;
      const p = policy((c) =>
        c.effect === "write" && ++writes === 2
          ? { kind: "deny", rule: "test.deny", reason: "no" }
          : { kind: "allow", rule: "test.allow" },
      );
      const { e, rec } = await saving(
        UPDATES,
        [toExpenses({ update: YES })],
        ({ at: i }: Seen) => done({ n: i }, [update(at(all, i), { [amount]: 100 + i })]),
        { store: st, policy: p, mode: "perRow", onError },
      );
      expect(rec.error?.failure?.code, onError).toBe("policy.denied");
      expect(rec.writes, onError).toBeUndefined();
      expect(e.asked, onError).toEqual([]);
      expect(st.applied, onError).toEqual([]);
    }
  });
  it.todo(
    "AU-174 · every operation of the step carries the run, so undoing the run undoes all of them and nothing else",
  );
  it("A-15 · 5,000 requests, as many as a step may make, are checked, read, judged and proposed over 5,000 rows in a moment", async () => {
    const st = store([expenses], { [expenses.key]: ROWS(WRITE_LIMITS.stepWrites) }, ids(16));
    const requests = idsOf(st).map((id) => update(id, { [amount]: 1 }));
    const t0 = now();
    const out = await applyWrites(writeInput(requests), writer(st));
    const ms = now() - t0;
    expect(out.kind).toBe("asked");
    expect(out.records).toHaveLength(WRITE_LIMITS.stepWrites);
    under(ms, 1500, "clock", "5,000 requests to save");
  });
  it("AU-175 · over `stepWrites`, `writeBytes` or `stepWriteBytes` fails the step with `code.limit` and saves nothing, never a part, before any row is read or the policy asked (one evaluation's `writes`, inside the box, is apps/sandbox's)", async () => {
    const over = async (requests: WriteRequest[], limit: string) => {
      const fault = await applyWrites(writeInput(requests), untouched).catch((e: unknown) => e);
      expect(fault, limit).toBeInstanceOf(CodeFault);
      expect((fault as CodeFault).why, limit).toMatchObject({
        code: "code.limit",
        detail: { limit },
      });
    };
    const many = (n: number, text = "") =>
      Array.from({ length: n }, () => create({ [amount]: 1, [note]: text }));
    await over(many(WRITE_LIMITS.stepWrites + 1), "stepWrites");
    await over(many(1, "x".repeat(WRITE_LIMITS.writeBytes)), "writeBytes");
    const half = Math.floor(WRITE_LIMITS.writeBytes / 2);
    await over(
      many(Math.ceil(WRITE_LIMITS.stepWriteBytes / half) + 1, "x".repeat(half)),
      "stepWriteBytes",
    );
    // In a run: two rows that ask for 2,501 each pass the step's limit together.
    const st = db(2);
    const { e, rec } = await saving(
      "$col('Gastos').create({ a: 1 })\nreturn []",
      [toExpenses({ create: YES })],
      () => done({ n: 1 }, many(WRITE_LIMITS.stepWrites / 2 + 1)),
      // The run's «rows written» at its ceiling, so the step's own limit is the one it meets (AU-17 is limits.test.ts).
      { store: st, mode: "perRow", limits: { rowsWritten: AUTOMATION_LIMITS.rowsWritten.ceiling } },
    );
    expect(whyOf(rec)).toMatchObject({ code: "code.limit", detail: { limit: "stepWrites" } });
    expect(e.asked).toEqual([]);
    expect(st.applied).toEqual([]);
  });
});

describe("the run's «rows written» (AU-17)", () => {
  it("AU-17 · a «Código» whose change would pass the run's «rows written» fails the run before the policy is asked: nothing saved and nothing proposed, with «Sí» as with «Preguntar»; at the limit it saves them all", async () => {
    const creates = (k: number) => Array.from({ length: k }, (_, i) => create({ [amount]: i }));
    const source = "$col('Gastos').create({ a: 1 })\nreturn []";
    for (const cell of [YES, ASK]) {
      const st = db(1);
      const { e, p } = await saving(
        source,
        [toExpenses({ create: cell })],
        () => done({ n: 1 }, creates(1_001)),
        { store: st },
      );
      expect(e.error?.failure, cell.mode).toEqual({
        code: "run.limit",
        detail: { limit: "rowsWritten", max: 1_000, got: 1_001 },
      });
      expect(writeCalls(p), cell.mode).toEqual([]);
      expect(e.asked, cell.mode).toEqual([]);
      expect(st.applied, cell.mode).toEqual([]);
    }
    // One row of «Gastos» arrives, so the step runs.
    const st = db(1);
    const { e } = await saving(
      source,
      [toExpenses({ create: YES })],
      () => done({ n: 1 }, creates(1_000)),
      {
        store: st,
      },
    );
    expect(e.state).toBe("done");
    expect(st.applied).toHaveLength(1_000);
  });
});

describe("the connection's permission", () => {
  it("AU-176 · a «Código»'s connection takes «No», «Preguntar» or «Sí» for `create`, `update` and `remove`, each on its own (modify «Sí» with remove «No» holds as written); a new connection only reads, and `connectionActions('code')` gives the four", () => {
    expect(connectionActions(CODE_TYPE)).toEqual(CONNECTION_ACTIONS);
    expect(permissions([newConnection(expenses.key)])).toEqual([
      { collection: expenses.key, action: "read", mode: "yes" },
    ]);
    const source = "$col('Gastos').update('r_1', { importe: 1 })\nreturn []";
    for (const create of [false, { mode: "ask" }, { mode: "yes" }] as const)
      for (const update of [{ mode: "ask" }, { mode: "yes" }] as const)
        for (const remove of [false, { mode: "ask" }, { mode: "yes" }] as const) {
          const c = toExpenses({ create, update, remove });
          const { a, step } = withCode(source, [c]);
          const said = JSON.stringify({ create, update, remove });
          expect(ofStep(validate(a, ctx), step), said).toEqual([]);
          // Each cell is said as written, with its mode: what the chip and «sin preguntar» read (AU-178, AU-189).
          expect(
            permissions([c]).map((p) => [p.action, p.mode]),
            said,
          ).toEqual([
            ["read", "yes"],
            ...(create ? [["create", create.mode]] : []),
            ["update", update.mode],
            ...(remove ? [["remove", remove.mode]] : []),
          ]);
        }
  });
  it("AU-176 · a code that asks for an action its connection does not give is `code.write.notAllowed` with the collection's key, the action and the call's place, at every call, and cannot run; its fix sets that cell to «Preguntar», never «Sí», and leaves a cell that allows it as it is", () => {
    const source = [
      "for (const r of $input.all()) {",
      "  if (r.json.importe > 100) $col('Gastos').remove(r.json.id)",
      "  $col('Gastos').update(r.json.id, { importe: 0 })",
      "}",
      "if (false) $col('Gastos').remove('r_1')",
      "return []",
    ].join("\n");
    const { a, step } = withCode(source, [toExpenses({ update: { mode: "yes" } })]);
    const problems = ofStep(validate(a, ctx), step);
    expect(codes(problems)).toEqual(["code.write.notAllowed", "code.write.notAllowed"]);
    expect(problems.map((p) => p.detail?.action)).toEqual(["remove", "remove"]);
    expect(problems[0]).toMatchObject({
      severity: "error",
      param: "source",
      detail: { collection: expenses.key, line: 2, column: 29 },
    });
    expect(problems.map((p) => cut(source, p.detail as { from: number; to: number }))).toEqual([
      "$col('Gastos').remove(r.json.id)",
      "$col('Gastos').remove('r_1')",
    ]);
    expect(canRun(problems)).toBe(false);
    // `writeProblems` says the same of the step alone.
    expect(writeProblems(step, a, ctx)).toEqual(problems);
    // The fix: «Preguntar».
    const fixed = allowing(toExpenses({ update: { mode: "yes" } }), "remove");
    expect(fixed).toEqual(toExpenses({ update: { mode: "yes" }, remove: { mode: "ask" } }));
    step.connections = [fixed];
    expect(ofStep(validate(a, ctx), step)).toEqual([]);
    for (const action of WRITE_ACTIONS) {
      expect(allowing(newConnection(expenses.key), action)[action]).toEqual({ mode: "ask" });
      const given = toExpenses({ [action]: { mode: "yes" } });
      expect(allowing(given, action)).toBe(given);
    }
    // A collection with no connection says so as before (AU-31), not as a permission.
    const unconnected = withCode("$col('Notas').create({ texto: 'x' })\nreturn []", []);
    expect(codes(ofStep(validate(unconnected.a, ctx), unconnected.step))).toEqual([
      "code.notConnected",
    ]);
  });
  it("AU-176 · a connection changed after the code was checked is what counts: the engine holds each request to the connection as saved, and one it no longer allows fails with `code.write.notAllowed` and saves nothing", async () => {
    const st = db(2);
    const p = policy();
    const first = at(idsOf(st), 0);
    for (const connections of [[toExpenses()], [toExpenses({ create: YES, remove: YES })], []]) {
      const fault = await applyWrites(
        writeInput([update(first, { [amount]: 1 }, { line: 2 })], { connections }),
        writer(st, p),
      ).catch((e: unknown) => e);
      expect(fault, JSON.stringify(connections)).toBeInstanceOf(CodeFault);
      expect((fault as CodeFault).why).toEqual({
        code: "code.write.notAllowed",
        param: "source",
        detail: { collection: expenses.key, action: "update", line: 2 },
      });
    }
    expect(writeCalls(p)).toEqual([]);
    expect(st.calls).toEqual([]);
  });
  it("AU-177 · with «Solo estas filas» a code cannot modify or remove a row outside it (`code.write.outside`, `row`), nor create one that would not pass it with the fields it gives (`created`: the store gives no defaults); a modify may take a row out of it", async () => {
    const connection = onlyOpen({ create: ASK, update: ASK, remove: ASK });
    const st = db(4);
    const [shut, open] = idsOf(st);
    for (const [request, why] of [
      [update(shut, { [amount]: 1 }), "row"],
      [remove(shut), "row"],
      [create({ [note]: "cerrado" }), "created"],
      [create({ [amount]: 1 }), "created"],
    ] as const) {
      const { e, rec } = await saving(SAVES_ALL, [connection], () => done([], [request]), {
        store: st,
      });
      expect(whyOf(rec), JSON.stringify(request)).toMatchObject({
        code: "code.write.outside",
        detail: { collection: expenses.key, why },
      });
      expect(e.asked).toEqual([]);
    }
    const { rec } = await saving(
      SAVES_ALL,
      [connection],
      () => done([], [update(open, { [note]: "cerrado" }), create({ [note]: "abierto" })]),
      { store: st },
    );
    expect(rec.writes?.records.map((r) => r.after?.[note])).toEqual(["cerrado", "abierto"]);
    expect(st.applied).toEqual([]);
  });
  it("AU-177 · a row that is not there and one the connection leaves out fail the same way: the same code, detail, words and record, so code cannot learn whether a row it may not see exists", async () => {
    const connection = onlyOpen({ update: YES });
    const st = db(4);
    const shut = at(idsOf(st), 0);
    const nowhere = ids(99)("o");
    const fails = (id: string) =>
      saving(UPDATES, [connection], () => done([], [update(id, { [amount]: 1 }, { line: 1 })]), {
        store: st,
      });
    const missing = await fails(nowhere);
    const outside = await fails(shut);
    expect(missing.rec.error).toMatchObject({
      why: { code: "code.write.outside", detail: { why: "row", line: 1 } },
    });
    expect(missing.rec).toEqual(outside.rec);
    expect(missing.e.error).toEqual(outside.e.error);
    // And the fault itself, words and all.
    const faultOf = (id: string) =>
      applyWrites(
        writeInput([update(id, { [amount]: 1 })], { connections: [connection] }),
        writer(st),
      ).then(
        () => undefined,
        (e: unknown) => e as CodeFault,
      );
    const [a, b] = [await faultOf(nowhere), await faultOf(shut)];
    expect(a).toBeInstanceOf(CodeFault);
    expect([a?.message, a?.why]).toEqual([b?.message, b?.why]);
  });
  it("AU-177 · with «Solo estos campos» a code cannot set a field outside them (`code.write.hidden`), even one it never read; creating gives the row only the fields it sets", async () => {
    const connection = { ...toExpenses({ create: ASK, update: ASK }), read: { fields: [amount] } };
    const st = db(2);
    const first = at(idsOf(st), 0);
    const source =
      "$col('Gastos').create({ a: 1 })\n$col('Gastos').update('x', { a: 1 })\nreturn []";
    for (const request of [update(first, { [note]: "x" }), create({ [amount]: 1, [note]: "x" })]) {
      const { rec } = await saving(source, [connection], () => done([], [request]), { store: st });
      expect(whyOf(rec), request.action).toMatchObject({
        code: "code.write.hidden",
        detail: { collection: expenses.key, field: note },
      });
    }
    const { rec } = await saving(
      source,
      [connection],
      () => done([], [update(first, { [amount]: 2 }), create({ [amount]: 1 })]),
      { store: st },
    );
    // What it gives back is cut by the read's fields: the note it may not see stays out (AU-171, F15).
    expect(rec.writes?.records.map((r) => r.after)).toEqual([{ [amount]: 2 }, { [amount]: 1 }]);
    // A field the collection does not have is not one: the request is wrong, whatever the connection.
    const unknown = await saving(source, [connection], () => done([], [create({ otro: 1 })]), {
      store: st,
    });
    expect(whyOf(unknown.rec)).toMatchObject({
      code: "code.write.request",
      detail: { why: "field", field: "otro" },
    });
    expect(st.applied).toEqual([]);
  });
  it("AU-178 · AU-189 · `permissions` gives each write the connection allows with its mode, which is all the chip, the sentence and «sin preguntar» need: «Solo lee» has only `read`; a removal with «Sí» is told apart from one that asks, and creating or modifying with «Sí» carry the same mode", () => {
    expect(permissions([newConnection(expenses.key)]).map((p) => p.action)).toEqual(["read"]);
    const said = (c: Connection) => permissions([c]).map((p) => `${p.action}:${p.mode}`);
    expect(said(toExpenses({ update: { mode: "ask" }, remove: { mode: "yes" } }))).toEqual([
      "read:yes",
      "update:ask",
      "remove:yes",
    ]);
    expect(said(toExpenses({ create: { mode: "yes" }, remove: { mode: "ask" } }))).toEqual([
      "read:yes",
      "create:yes",
      "remove:ask",
    ]);
  });
  it("AU-179 · `connectionUses` says of each write action allowed whether the code uses it, and lists one used and not allowed: «Sí · lo usa», «Preguntar · sin usar», and the problem for the third; one allowed and unused is not a problem", () => {
    const source = [
      "$col('Gastos').create({ importe: 1 })",
      "$col('Gastos').update('r_1', { importe: 2 })",
      "$col('Gastos').update('r_2', { importe: 3 })",
      "$col('Categorías').find()",
      "return []",
    ].join("\n");
    const connections = [
      toExpenses({ update: { mode: "yes" }, remove: { mode: "ask" } }),
      newConnection(categories.key),
    ];
    const uses = connectionUses(connections, readWrites(source, "code"), named);
    expect(
      uses.map((u) => [u.collection, u.action, u.allowed, u.used, u.at.map((s) => s.line)]),
    ).toEqual([
      [expenses.key, "create", false, true, [1]],
      [expenses.key, "update", "yes", true, [2, 3]],
      [expenses.key, "remove", "ask", false, []],
    ]);
    // The one used and not allowed is the problem; the one allowed and unused is none.
    const { a, step } = withCode(source, connections);
    expect(
      ofStep(validate(a, ctx), step).map((p) => [p.code, p.detail?.action, p.detail?.line]),
    ).toEqual([["code.write.notAllowed", "create", 1]]);
    expect(connectionUses([newConnection(notes.key)], readWrites(source, "code"), named)).toEqual(
      [],
    );
  });
});

describe("what the person sees", () => {
  it("AU-180 · `stepChanges` gives the collections and actions a step can change: a «Colección» step's action, a «Código»'s analysis whether its connection allows it yet or not, nothing for a code that changes only the rows it received in memory; `consentOf` reads one cell of it", () => {
    const action = (key: string) =>
      sketch(6).step("Cambiar", "collection", { collection: expenses.key, action: key }).build()
        .steps[0] as Step;
    expect(stepChanges(action("update"), ctx)).toEqual([
      { collection: expenses.key, actions: [{ action: "update", mode: "yes" }] },
    ]);
    expect(stepChanges(action("upsert"), ctx)).toEqual([
      {
        collection: expenses.key,
        actions: [
          { action: "create", mode: "yes" },
          { action: "update", mode: "yes" },
        ],
      },
    ]);
    expect(stepChanges(action("trash"), ctx)).toEqual([
      { collection: expenses.key, actions: [{ action: "remove", mode: "ask" }] },
    ]);
    expect(stepChanges(action("find"), ctx)).toEqual([]);
    expect(consentOf(action("trash"), expenses.key, "remove")).toBe("ask");
    expect(consentOf(action("update"), expenses.key, "remove")).toBe(false);

    const { step } = withCode(
      [
        "$col('Notas').create({ texto: 'x' })",
        "$col('Gastos').remove('x')",
        "$col('Gastos').update('x', { a: 1 })",
        "return []",
      ].join("\n"),
      [toExpenses({ update: ASK, remove: YES })],
    );
    expect(stepChanges(step, ctx)).toEqual([
      { collection: notes.key, actions: [{ action: "create", mode: false }] },
      {
        collection: expenses.key,
        actions: [
          { action: "update", mode: "ask" },
          { action: "remove", mode: "yes" },
        ],
      },
    ]);
    expect(consentOf(step, expenses.key, "update")).toBe("ask");
    expect(consentOf(step, expenses.key, "create")).toBe(false);
    expect(consentOf(step, notes.key, "create")).toBe(false);
    const inMemory = withCode("const all = $input.all(); all[0].json.x = 1; return all", []);
    expect(stepChanges(inMemory.step, ctx)).toEqual([]);
  });
  it("AU-181 · «Probar» and «Probar paso» check every request as a run would and save none: «Haría esto» lists them with each row before and after, says whether a run would ask, and a request that would fail fails the test the same way", async () => {
    const st = db(3);
    const [first, second] = idsOf(st);
    const asked = [
      update(first, { [amount]: 9 }),
      create({ [amount]: 5, [note]: "nuevo" }),
      remove(second),
    ];
    const t = await saving(SAVES_ALL, [ALL_ASK], () => done([], asked), { store: st, test: true });
    expect(t.rec.writes).toMatchObject({ kind: "tested", asks: true });
    expect(t.rec.writes?.records).toEqual([
      {
        collection: expenses.key,
        action: "update",
        id: first,
        before: { [amount]: 0, [note]: "cerrado" },
        after: { [amount]: 9, [note]: "cerrado" },
      },
      { collection: expenses.key, action: "create", after: { [amount]: 5, [note]: "nuevo" } },
      {
        collection: expenses.key,
        action: "remove",
        id: second,
        before: { [amount]: 1, [note]: "abierto" },
      },
    ]);
    expect(t.e.asked).toEqual([]);
    expect(st.applied).toEqual([]);
    expect(st.calls.filter((c) => c.method === "applyAll")).toEqual([]);
    // Nothing asked: nothing to say.
    const none = await saving(SAVES_ALL, [ALL_ASK], () => done([]), { store: st, test: true });
    expect(none.rec.writes).toBeUndefined();
    // What would fail fails the same in a test as in a run.
    const bad = (test: boolean) =>
      saving(UPDATES, [toExpenses({ update: ASK })], () => done([], [update(5, { [amount]: 1 })]), {
        store: st,
        test,
      });
    const [inTest, inRun] = [await bad(true), await bad(false)];
    expect(inTest.rec.error).toEqual(inRun.rec.error);
    expect(whyOf(inTest.rec)?.code).toBe("code.write.request");
  });
  it("AU-181 · the record of a real run lists what the step saved or proposed, row by row, as «Probar» does, and nothing for a step that failed", async () => {
    const st = db(3);
    const [first, second] = idsOf(st);
    const asked = [update(first, { [amount]: 9 }), create({ [amount]: 5 }), remove(second)];
    const tested = await saving(SAVES_ALL, [ALL_ASK], () => done([], asked), {
      store: st,
      test: true,
    });
    const ran = await saving(SAVES_ALL, [ALL_ASK], () => done([], asked), { store: st });
    expect(ran.rec.writes?.kind).toBe("asked");
    expect(ran.rec.writes?.records).toEqual(tested.rec.writes?.records);
    const failed = await saving(
      SAVES_ALL,
      [ALL_ASK],
      () => done([], [...asked, update(5, { [amount]: 1 })]),
      { store: st },
    );
    expect(failed.rec.state).toBe("failed");
    expect(failed.rec.writes).toBeUndefined();
    expect(failed.rec.asked).toBe(0);
  });
  it.todo(
    "AU-182 · «Lo que podrá hacer» in Publicar, and every proposal of an automation Juan did not write, list what each «Código» can change before he accepts it; a code that saves never runs before it is published",
  );
});

describe("the analysis binds", () => {
  it("AU-183 · `readWrites` finds every call that asks to save wherever it sits (an `if` never taken, a loop, a function never called) and `grantsOf` gives one pair per collection and action", () => {
    const source = [
      "if (false) $col('Gastos').remove('r_1')",
      "while ($json.n > 0) { $col('Gastos').update('r_2', { importe: 1 }); break }",
      "function nunca() { return $col('Notas').create({ texto: 'x' }) }",
      "const flecha = () => $col('Gastos').update('r_3', { importe: 2 })",
      "try { throw 1 } catch { $col('Categorías').create({ nombre: 'y' }) }",
      "[1].map(() => $col('Gastos')?.remove('r_4'))",
      "$col('Nadie').create({})",
      "return []",
    ].join("\n");
    const reading = readWrites(source, "code");
    expect(reading.problems).toEqual([]);
    expect(reading.writes.map((w) => `${w.name}.${w.action}@${w.at.line}`)).toEqual([
      "Gastos.remove@1",
      "Gastos.update@2",
      "Notas.create@3",
      "Gastos.update@4",
      "Categorías.create@5",
      "Gastos.remove@6",
      "Nadie.create@7",
    ]);
    // One pair per collection and action, by its key; a name no collection has gives none (it is
    // `code.unknownCollection` already).
    expect(grantsOf(reading, named)).toEqual([
      { collection: expenses.key, action: "remove" },
      { collection: expenses.key, action: "update" },
      { collection: notes.key, action: "create" },
      { collection: categories.key, action: "create" },
    ]);
    expect(grantsOf(readWrites("return $col('Gastos').find()", "code"), named)).toEqual([]);
  });
  it("AU-183 · only `$col('Nombre').método(…)` validates, for reading too: `const g = $col('Gastos')`, passing it, returning it, `$col('Gastos')[accion](…)` and a method `$col` does not have are `code.colUse` with the fix", () => {
    const forms = [
      ["const g = $col('Gastos'); g.update('r_1', { importe: 1 })", "kept", undefined],
      ["const g = $col('Gastos'); return g.find()", "kept", undefined],
      ["guardar($col('Gastos'))", "kept", undefined],
      ["return $col('Gastos')", "kept", undefined],
      ["const { update } = $col('Gastos')", "kept", undefined],
      ["(0, $col('Gastos')).remove('r_1')", "kept", undefined],
      ["const u = $col('Gastos').update; u('r_1', {})", "kept", "update"],
      ["$col('Gastos').update.call(null, 'r_1', {})", "kept", "update"],
      ["$col('Gastos')[accion]('r_1')", "computed", undefined],
      ["$col('Gastos')['update']('r_1', {})", "computed", undefined],
      ["$col('Gastos').delete('r_1')", "unknown", "delete"],
      ["$col('Gastos').constructor", "unknown", "constructor"],
    ] as const;
    const connected = [
      toExpenses({ create: { mode: "ask" }, update: { mode: "ask" }, remove: { mode: "ask" } }),
    ];
    for (const [line, why, method] of forms) {
      const source = `${line}\nreturn []`;
      const reading = readWrites(source, "code");
      expect(reading.writes, line).toEqual([]);
      expect(reading.problems, line).toMatchObject([
        { code: "code.colUse", severity: "error", detail: { why, name: "Gastos", line: 1 } },
      ]);
      expect(reading.problems[0]?.detail?.method, line).toBe(method);
      const { a, step } = withCode(source, connected);
      const problems = ofStep(validate(a, ctx), step).filter((p) => p.code === "code.colUse");
      expect(problems, line).toMatchObject([{ param: "source", detail: { why, name: "Gastos" } }]);
      expect(canRun(problems), line).toBe(false);
    }
    // The fix is the direct form, which validates.
    const { a, step } = withCode(
      "$col('Gastos').update('r_1', { importe: 1 })\nreturn $col('Gastos').find()",
      connected,
    );
    expect(ofStep(validate(a, ctx), step)).toEqual([]);
  });
  it.todo(
    "AU-183 · `$col` reached any other way (`globalThis['$c' + 'ol']`, `this`, `eval`, `Function`, a getter, a `Proxy`) gives no method the grants do not have: in the box, `$col` of a collection has only the write methods granted",
  );
  it("AU-183 · a request the analysis did not see fails the step with `code.write.unseen` and saves nothing, even when the box's answer is forged to carry it; the server reads the grants from the code as saved at every run, never from the box or a browser", async () => {
    const st = db(2);
    const first = at(idsOf(st), 0);
    const connections = [ALL_YES, { ...newConnection(notes.key), create: YES }];
    for (const forged of [
      remove(first),
      create({ [amount]: 1 }),
      { collection: "Notas", action: "create", fields: {} } as WriteRequest,
      { collection: "Gastos", action: "drop" as WriteAction, id: first },
      { collection: "Otra", action: "update", id: first, fields: {} } as WriteRequest,
    ])
      for (const test of [false, true]) {
        const p = policy();
        const { e, rec, box } = await saving(
          UPDATES,
          connections,
          () => done([], [update(first, { [amount]: 1 }), forged]),
          { store: st, policy: p, test },
        );
        const what = `${JSON.stringify(forged)} ${test}`;
        expect(box.jobs[0]?.writes, what).toEqual({ Gastos: ["update"] });
        expect(whyOf(rec), what).toMatchObject({
          code: "code.write.unseen",
          detail: { collection: forged.collection, action: forged.action, where: "code" },
        });
        expect(writeCalls(p), what).toEqual([]);
        expect(rec.writes).toBeUndefined();
        expect(e.asked).toEqual([]);
      }
    expect(st.applied).toEqual([]);
  });
  it("AU-184 · an expression never saves: `{{ $col('Gastos').update(…) }}` is `code.readInExpression`, to read or to save, and the analysis gives it no request", () => {
    for (const expr of [
      "$col('Gastos').update('r_1', { importe: 1 })",
      "$col('Gastos').create({ importe: 1 })",
      "$col('Gastos').remove('r_1')",
      "$col('Gastos').count()",
      "$col('Gastos')",
    ]) {
      expect(codes(readCode(expr, "expression").problems), expr).toEqual(["code.readInExpression"]);
      expect(readWrites(expr, "expression"), expr).toEqual({ writes: [], problems: [] });
    }
    const s = sketch(5)
      .step("Inicio", "manual", { fields: [] })
      .step("Buscar", "collection", { collection: expenses.key, action: "find" })
      .step("Editar", "edit", {
        fields: [
          { field: "nuevo", value: { expr: "{{ $col('Gastos').update('r_1', { importe: 1 }) }}" } },
        ],
      })
      .arrow("Inicio", "Buscar")
      .arrow("Buscar", "Editar");
    const problems = validate(s.build(), ctx).filter((p) => p.step === s.id("Editar"));
    expect(codes(problems)).toEqual(["code.readInExpression"]);
    expect(canRun(problems)).toBe(false);
  });
  it("AU-184 · an evaluation of expressions whose answer carries a request fails the step with `code.write.unseen` (`expression`) and saves nothing", async () => {
    const st = db(2);
    const first = at(idsOf(st), 0);
    const s = sketch(5)
      .step("Inicio", "manual", { fields: [] })
      .step("Buscar", "collection", { collection: expenses.key, action: "find" })
      .step("Editar", "edit", { fields: [{ field: "nuevo", value: { expr: "{{ 1 + 1 }}" } }] })
      .arrow("Inicio", "Buscar")
      .arrow("Buscar", "Editar");
    const p = policy();
    const box = writingBox(({ job }) =>
      done(2, job.kind === "expressions" ? [update(first, { [amount]: 1 })] : []),
    );
    const e = await run(
      {
        automation: s.build(),
        trigger: s.id("Inicio"),
        fields: { json: {}, label: OWN },
        test: false,
      },
      deps({ collectionNamed: named, collections: st, box, policy: p }),
    );
    expect(box.jobs.map((j) => j.kind)).toEqual(["expressions"]);
    expect(e.steps[s.id("Editar")]?.error?.why).toMatchObject({
      code: "code.write.unseen",
      detail: { collection: "Gastos", action: "update", where: "expression" },
    });
    expect(writeCalls(p)).toEqual([]);
    expect(e.asked).toEqual([]);
    expect(st.applied).toEqual([]);
  });
  it("AU-185 · a code's write is a change of its step: it carries the version and the step, and the label of what its evaluation received (AU-169), so a value from outside is proposed (P4); that it carries the run and is stored as from outside (AU-170) is the server's (S1)", async () => {
    const st = db(2, OUTSIDE);
    const first = at(idsOf(st), 0);
    const p = policy((c) =>
      c.effect === "write" &&
      Object.values(c.values).some((v) => v.label.integrity === OUTSIDE.integrity)
        ? { kind: "propose", rule: "test.outside" }
        : { kind: "allow", rule: "test.allow" },
    );
    const { a, e, step } = await saving(
      UPDATES,
      [toExpenses({ update: YES })],
      () => done([], [update(first, { [amount]: 3 })]),
      { store: st, policy: p },
    );
    const call = p.calls.find((c) => c.effect === "write");
    expect(call).toMatchObject({
      automation: { id: a.id, version: a.version },
      step: step.id,
      type: CODE_TYPE,
      action: "update",
      collection: expenses.key,
    });
    expect(call?.values[amount]).toMatchObject({ value: 3, derived: true });
    expect(call?.values[amount]?.label.integrity).toBe(OUTSIDE.integrity);
    expect(e.asked.map(({ values: _values, ...a }) => a)).toEqual([
      {
        step: step.id,
        kind: "propose",
        rule: "test.outside",
        change: {
          kind: "update",
          row: (st.rows(expenses.key)[0] as StoredRow).origin,
          fields: { [amount]: 3 },
        },
      },
    ]);
    // What waits keeps where its values came from (AU-170): accepting it writes them as from outside.
    expect(e.asked[0]?.values[amount]?.label.integrity).toBe(OUTSIDE.integrity);
  });
  it.todo(
    "AU-185 · until F18 no automation starts on a change of a row, so a code's write starts nothing; F18's loop guard (AU-113) counts it as any write of a «Colección» step",
  );
});

describe("removing without asking (Juan, 2026-11-16)", () => {
  it.todo(
    "AU-186 · a removal from a published version's «Código» whose connection says «Sí», with nothing from outside in what the evaluation received, goes to the trash without a proposal, carries the run, and undoing the run brings the row back",
  );
  it.todo(
    "AU-186 · the same removal with something from outside in what the evaluation received (a value from a mail, or the path, AU-164) goes to the trash too, keeping its label (decision 11 of §10); with a value a model wrote it is proposed, and with it everything the step asks to save (S3: proposal.test.ts)",
  );
  it.todo(
    "AU-186 · an «Agente»'s removal with «Sí» and something from outside in what it received is proposed, as any write of it (F15)",
  );
  it.todo(
    "AU-186 · nothing in an automation deletes for ever, whatever the cells say: every removal of a «Código», «Colección» or «Agente» step is the trash act, and the policy is told so",
  );
  it.todo(
    "AU-186 · a removal without the person's «Sí» for that collection, or from a draft, still confirms (P5); the assistant's own removals outside automations keep P5 and P24 as they are",
  );
  it.todo(
    "AU-187 · «Eliminar filas» of a «Colección» step with «Sí» in a published run sends the rows to the trash without asking, with something from outside too, and undoing the run brings them back (S1: published versions; the engine's two doors are consent.test.ts)",
  );
  it.todo(
    "AU-188 · an automation proposed by the assistant, by «Pedir a Boni» or «Escribir con IA», or brought by a package or a template, arrives with every «Sí» of saving lowered to «Preguntar» (`lowerYes`), for create, modify and remove alike",
  );
  it.todo(
    "AU-188 · a «Sí» the draft already had from the person's hand stays when a proposal is made over it; a «Sí» the proposal adds or changes is lowered, and the fix of a missing permission sets «Preguntar»",
  );
  it.todo(
    "AU-189 · «Lo que podrá hacer» names each removal that will not ask, apart from those that ask (F14d)",
  );
});
