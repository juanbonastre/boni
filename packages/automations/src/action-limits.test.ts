// The limits of each write action of a connection (docs/automatizaciones.md §5.5, §5.6 and §6, phase F15): «Solo
// estas filas» and «Solo estos campos» per action, the fields an AI decides, «Como mucho N filas», and what a write
// gives back (AU-48, AU-52, AU-171, AU-196). They are checked on the stored connection in the engine
// (`insideConnection`, `applyWrites`), for a «Código» here and for an «Agente» alike (E3 saves through the same
// door), with a store per test, generated ids and 3,000 rows where a count is bounded (A-15). An «Agente»'s call is
// also checked by the policy (P29, packages/agent/test/automation-ai.test.ts). AU-52 is E3's.
import type { Label } from "@boni/entities";
import { label } from "@boni/entities";
import { clock as now, under } from "@boni/pace";
import { describe, expect, it } from "vitest";
import { collection, ids, knowing, sketch } from "./automation.test-util.ts";
import type { Box, BoxJob, Evaluated } from "./box.ts";
import { AGENT_TYPE, CODE_TYPE, CodeFault, type WriteAction } from "./code.ts";
import {
  ACTION_ROWS_MAX,
  AGENT_BORN_ROWS,
  allowing,
  bornCell,
  type Connection,
  connectionActions,
  connectionProblems,
  narrow,
  newConnection,
  parseConnection,
  permissions,
} from "./connections.ts";
import { type GateUnit, guard } from "./effects.ts";
import { run, type StepRecord } from "./engine.ts";
import type { Step } from "./format.ts";
import type { Cell } from "./rows.ts";
import { deps, type FakePolicy, type FakeStore, OWN, policy, store } from "./run.test-util.ts";
import {
  applyWrites,
  grantsOf,
  insideConnection,
  readWrites,
  type WriteGate,
  type WriteInput,
  type WriteRequest,
} from "./writes.ts";

const next = ids(129);
/** Shaped like his: generated keys, a number, a text and an option («abierta», «cerrada»). */
const tasks = collection(next, ["number", "text", "select"]);
const [amount, note, state] = tasks.fields.map((f) => f.key) as [string, string, string];
const NAME = "Tareas";
const named = (name: string) => (name === NAME ? tasks.key : undefined);
const typeOf = (f: string) => tasks.fields.find((x) => x.key === f)?.type;
/** The automation's own label: of what it writes itself (a fixed value), apart from what its code computed. */
const AUTO: Label = label("own", "personal", [{ kind: "flow", id: "e_ejemplo" }]);

/** `n` rows: the amount is the row's place; «abierta» on the odd ones, «cerrada» on the even; a note on all. */
const ROWS = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    [amount]: i,
    [note]: `nota ${i}`,
    [state]: i % 2 ? "abierta" : "cerrada",
  }));
const db = (n = 6) => store([tasks], { [tasks.key]: ROWS(n) }, ids(130));
const idsOf = (st: FakeStore) =>
  st
    .rows(tasks.key)
    .map((r) => r.origin.id)
    .sort();
/** A row's place in the store's id order: the even places hold «cerrada» rows… by their amount. */
const rowOf = (st: FakeStore, id: string) => st.rows(tasks.key).find((r) => r.origin.id === id);
const isOpen = (st: FakeStore, id: string) => rowOf(st, id)?.json[state] === "abierta";

const is = (field: string, value: string | number) => [{ field, op: "is" as const, value }];
const gt = (field: string, value: number) => [{ field, op: "gt" as const, value }];
const YES = { mode: "yes" } as const;
const conn = (more: Partial<Connection> = {}): Connection => ({
  ...newConnection(tasks.key),
  ...more,
});
const SAVES_ALL = [
  `$col('${NAME}').create({ a: 1 })`,
  `$col('${NAME}').update('x', { a: 1 })`,
  `$col('${NAME}').remove('x')`,
  "return []",
].join("\n");

const UNIT: GateUnit = {
  automation: { id: "e_ejemplo", version: 1 },
  step: "s_ejemplo",
  type: CODE_TYPE,
  action: "",
  effect: "write",
  destroys: false,
  control: null,
  test: false,
  own: AUTO,
};
const writer = (st: FakeStore, p: FakePolicy = policy(), test = false): WriteGate => {
  const g = guard(p, st, { ...UNIT, test });
  return {
    shape: (c) => st.shape(c),
    get: (c, id) => st.get(c, id),
    decideAll: (cs) => g.decideAll(cs),
    writeAll: (cs) => g.writeAll(cs),
  };
};
/** A gate that fails if it is asked anything but the collection's fields: nothing read, nothing judged. */
const untouched: WriteGate = {
  shape: (c) => (c === tasks.key ? tasks : undefined),
  get: () => Promise.reject(new Error("read")),
  decideAll: () => Promise.reject(new Error("decided")),
  writeAll: () => Promise.reject(new Error("written")),
};
const input = (
  requests: WriteRequest[],
  connections: Connection[],
  more: Partial<WriteInput> = {},
): WriteInput => ({
  step: "s_ejemplo",
  requests,
  labels: requests.map(() => OWN),
  grants: grantsOf(readWrites(SAVES_ALL, "code"), named),
  connections,
  collectionNamed: named,
  today: "2026-11-17",
  test: false,
  own: AUTO,
  ...more,
});
const update = (id: string, fields: Record<string, Cell>): WriteRequest => ({
  collection: NAME,
  action: "update",
  id,
  fields,
});
const create = (fields: Record<string, Cell>): WriteRequest => ({
  collection: NAME,
  action: "create",
  fields,
});
const remove = (id: string): WriteRequest => ({ collection: NAME, action: "remove", id });
const why = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(CodeFault);
  return (e as CodeFault).why;
};

describe("the limits of a write action (F15)", () => {
  it("AU-48 · an action's filter and fields narrow on top of the connection's read limits: a row outside either is not modified or trashed", async () => {
    const st = db();
    const all = idsOf(st);
    const open = all.filter((id) => isOpen(st, id));
    const closed = all.filter((id) => !isOpen(st, id));
    // Reading sees every row; modifying, only the open ones and only the note; removing, only amounts over 2.
    const c = conn({
      update: { ...YES, where: is(state, "abierta"), fields: [note] },
      remove: { ...YES, where: gt(amount, 2) },
    });
    const one = (r: WriteRequest, cs = [c]) => applyWrites(input([r], cs), writer(st));
    // Inside both: saved.
    const ok = await one(update(open[0] as string, { [note]: "hecha" }));
    expect(ok.kind).toBe("applied");
    // Outside the action's filter, outside the read's, and not there at all: one failure, the same detail, so a
    // failure never tells whether a row outside the filter exists. Nothing is judged or saved.
    const outside = await why(one(update(closed[0] as string, { [note]: "x" })));
    const missing = await why(one(update("e_01ejemploquenoesta0000000", { [note]: "x" })));
    expect(outside).toMatchObject({ code: "code.write.outside", detail: { why: "row" } });
    expect(missing).toEqual(outside);
    const narrowRead = conn({ read: { where: is(state, "cerrada") }, update: YES });
    expect(await why(one(update(open[1] as string, { [note]: "x" }), [narrowRead]))).toEqual(
      outside,
    );
    // A field outside «Solo estos campos» of modifying, though reading sees it.
    expect(await why(one(update(open[0] as string, { [amount]: 99 })))).toMatchObject({
      code: "code.write.notAllowed",
      detail: { collection: tasks.key, action: "update", why: "field", field: amount },
    });
    // Removing: the row must pass the read's and the action's filter.
    const low = all.find((id) => (rowOf(st, id)?.json[amount] as number) <= 2) as string;
    expect(await why(one(remove(low)))).toEqual(outside);
    const high = all.find((id) => (rowOf(st, id)?.json[amount] as number) > 2) as string;
    expect((await one(remove(high))).kind).toBe("applied");
    expect(st.applied).toHaveLength(2);
    // `insideConnection` with the action is the same test the policy is given (P29); without it, the read's alone.
    const saved = rowOf(st, closed[0] as string)?.json ?? {};
    expect(insideConnection(saved, c, typeOf, "2026-11-17")).toBe(true);
    expect(insideConnection(saved, c, typeOf, "2026-11-17", "update")).toBe(false);
    // And what an «Agente» is shown as rows it may modify is narrowed the same way (`narrow` with the action).
    const asked = narrow({ collection: tasks.key, op: "find" }, [c], "update");
    expect(asked.where).toEqual(is(state, "abierta"));
    expect(() => narrow({ collection: tasks.key, op: "find" }, [conn()], "remove")).toThrow(
      CodeFault,
    );
  });

  it("AU-48 · a created row gets the action's fixed values, and a field outside «Solo estos campos» is refused", async () => {
    const st = db(2);
    const c = conn({
      read: { where: is(state, "abierta") },
      create: { ...YES, fields: [note], fixed: { [state]: "abierta" } },
    });
    const out = await applyWrites(input([create({ [note]: "nueva" })], [c]), writer(st));
    expect(out.kind).toBe("applied");
    const made = st.applied[0];
    expect(made).toMatchObject({ kind: "create", fields: { [note]: "nueva", [state]: "abierta" } });
    // The fixed value carries the automation's label, not what the code computed from.
    const p = policy();
    await applyWrites(input([create({ [note]: "otra" })], [c]), writer(db(2), p));
    const values = p.calls.find((x) => x.effect === "write")?.values ?? {};
    expect(values[state]?.label).toBe(AUTO);
    expect(values[note]?.label).toBe(OWN);
    // The row as it would be, fixed values in, is what the read's filter is asked of (P29 gets it too).
    expect(p.calls.find((x) => x.effect === "write")?.row).toMatchObject({ [state]: "abierta" });
    // A field the step does not choose, or a fixed one it tries to set: refused, nothing judged.
    for (const fields of [{ [amount]: 1 }, { [note]: "x", [state]: "cerrada" }])
      expect(await why(applyWrites(input([create(fields)], [c]), untouched))).toMatchObject({
        code: "code.write.notAllowed",
        detail: { action: "create", why: "field" },
      });
    // Without the fixed value, the new row would fall outside the read's filter: refused as one outside.
    const bare = conn({ read: { where: is(state, "abierta") }, create: YES });
    expect(
      await why(applyWrites(input([create({ [note]: "x" })], [bare]), untouched)),
    ).toMatchObject({ code: "code.write.outside", detail: { why: "created" } });
    // Validation: a fixed value of a field the collection lacks, of one also left to the step, or an expression
    // (AU-52, E3) is a problem of the connection.
    const step = { id: "s_ejemplo", type: CODE_TYPE, connections: [] } as unknown as Step;
    const problems = (connection: Connection) =>
      connectionProblems({ ...step, connections: [connection] }, knowing(tasks)).map((x) => [
        x.code,
        x.detail?.why,
      ]);
    expect(problems(c)).toEqual([]);
    for (const fixed of [{ f_noesta: 1 }, { [note]: "x" }, { [state]: { expr: "{{ 1 }}" } }])
      expect(
        problems(conn({ create: { ...YES, fields: [note], fixed } as Connection["create"] })),
      ).toEqual([["connection.limits", "field"]]);
  });

  it.todo(
    "AU-52 · the fields control gives `fields` (those the AI decides) and `fixed` (fixed values and expressions); an unmarked field is never written",
  );
  it.todo(
    "AU-52 · an option the field does not have, or a related row the step did not read in this run, is refused",
  );

  it("AU-171 · what a write gives back is cut by the connection's read limits; without read permission, only the fields it set and the id, in a test too", async () => {
    for (const test of [false, true]) {
      const st = db(4);
      const [first, second] = idsOf(st) as [string, string];
      const seeing = conn({ read: { fields: [note] }, update: YES });
      const a = await applyWrites(
        input([update(first, { [note]: "hecha" })], [seeing], { test }),
        writer(st, policy(), test),
      );
      expect(a.kind).toBe(test ? "tested" : "applied");
      const [ra] = a.records;
      expect(ra?.id).toBe(first);
      expect(Object.keys(ra?.before ?? {})).toEqual([note]);
      expect(ra?.after).toEqual({ [note]: "hecha" });
      // «Leer» in «No»: the fields it set, before and after, and nothing else of the row.
      const blind = conn({ read: false, update: YES, remove: YES });
      const b = await applyWrites(
        input([update(second, { [note]: "vista" }), remove(first)], [blind], { test }),
        writer(st, policy(), test),
      );
      const [rb, rc] = b.records;
      expect(rb?.after, `${test}`).toEqual({ [note]: "vista" });
      expect(Object.keys(rb?.before ?? {})).toEqual([note]);
      expect(rc?.before, `${test}`).toEqual({});
      expect(rc?.id).toBe(first);
    }
    // Proposed («Propondría…» in a test, the run's proposal for real): cut the same way.
    const st = db(4);
    const [one] = idsOf(st) as [string];
    const asking = conn({ read: { fields: [note] }, update: { mode: "ask" } });
    const asked = await applyWrites(
      input([update(one, { [note]: "pendiente" })], [asking]),
      writer(st),
    );
    expect(asked.kind).toBe("asked");
    expect(Object.keys(asked.records[0]?.before ?? {})).toEqual([note]);
    expect(asked.records[0]?.after).toEqual({ [note]: "pendiente" });
    expect(st.applied).toEqual([]);
  });

  it("AU-196 · a «Código»'s request that would pass «Como mucho» fails as any that cannot be saved and says both numbers; an «Agente»'s call is refused and told to the model", async () => {
    // 3,000 rows shaped like his; the code asks to trash 240 with «Como mucho 20»: refused before a row is read or
    // the policy asked, saying 240 and 20.
    const st = store([tasks], { [tasks.key]: ROWS(3000) }, ids(131));
    const all = idsOf(st);
    const c = conn({ remove: { ...YES, limit: 20 } });
    const t0 = now();
    const fault = await why(applyWrites(input(all.slice(0, 240).map(remove), [c]), untouched));
    under(now() - t0, 50, "clock", "«Como mucho» over 240 requests");
    expect(fault).toMatchObject({
      code: "code.write.notAllowed",
      detail: { collection: tasks.key, action: "remove", why: "many", max: 20, got: 240 },
    });
    // 20 fit; with 15 already asked by the step in this run (`before`), 6 more do not: the count is the step's in
    // the run, every unit together, saved, tested or proposed alike.
    expect((await applyWrites(input(all.slice(0, 20).map(remove), [c]), writer(st))).kind).toBe(
      "applied",
    );
    const before = (_: string, action: WriteAction) => (action === "remove" ? 15 : 0);
    expect(
      await why(applyWrites(input(all.slice(20, 26).map(remove), [c], { before }), untouched)),
    ).toMatchObject({ detail: { why: "many", max: 20, got: 21 } });
    // Each action counts its own: 20 updates and 20 creates under limits of 20 each.
    const each = conn({ create: { ...YES, limit: 20 }, update: { ...YES, limit: 20 } });
    const mixed = [
      ...all.slice(100, 120).map((id) => update(id, { [note]: "x" })),
      ...Array.from({ length: 20 }, () => create({ [note]: "y" })),
    ];
    expect((await applyWrites(input(mixed, [each]), writer(st))).kind).toBe("applied");
    // What the policy is given with each change for P29: the step's count before it.
    const p = policy();
    await applyWrites(
      input(all.slice(200, 203).map(remove), [c], { before: () => 4 }),
      writer(st, p),
    );
    expect(p.calls.filter((x) => x.effect === "write").map((x) => x.written)).toEqual([4, 5, 6]);

    // In a run: the step fails as any change that cannot be saved, and nothing of it is saved.
    const run240 = await saving(`$col('${NAME}').remove('x')\nreturn []`, [c], st, () =>
      done([], all.slice(500, 740).map(remove)),
    );
    expect(run240.rec.state).toBe("failed");
    expect(run240.rec.error?.why).toMatchObject({
      code: "code.write.notAllowed",
      detail: { why: "many", max: 20, got: 240 },
    });
    expect(run240.rec.writes).toBeUndefined();
  });

  it("AU-196 · a write action of an «Agente» that leaves «No» is born with a limit of 20 rows; a «Código»'s is born without one, and a «Colección» step has none", () => {
    expect(AGENT_BORN_ROWS).toBe(20);
    for (const action of ["create", "update", "remove"] as const) {
      expect(allowing(newConnection(tasks.key), action, AGENT_TYPE)[action]).toEqual({
        mode: "ask",
        limit: 20,
      });
      expect(allowing(newConnection(tasks.key), action, CODE_TYPE)[action]).toEqual({
        mode: "ask",
      });
      expect(allowing(newConnection(tasks.key), action)[action]).toEqual({ mode: "ask" });
    }
    expect(bornCell(AGENT_TYPE, "yes")).toEqual({ mode: "yes", limit: 20 });
    expect(bornCell(CODE_TYPE, "yes")).toEqual({ mode: "yes" });
    // A «Colección» step takes no connection: its «Permiso» has its condition and the run's limit, no «Como mucho».
    expect(connectionActions("collection")).toEqual([]);
    // The limit is said with the permission, kept by the format, and is a whole number from 1 to 5,000.
    const kept = conn({ update: { ...YES, limit: 20 } });
    expect(permissions([kept]).find((x) => x.action === "update")?.limit).toBe(20);
    expect(parseConnection(JSON.parse(JSON.stringify(kept)), "c", (v) => v as Cell)).toEqual(kept);
    const step = { id: "s_ejemplo", type: CODE_TYPE, connections: [] } as unknown as Step;
    for (const [limit, ok] of [
      [1, true],
      [ACTION_ROWS_MAX, true],
      [0, false],
      [ACTION_ROWS_MAX + 1, false],
      [2.5, false],
    ] as const)
      expect(
        connectionProblems(
          { ...step, connections: [conn({ remove: { ...YES, limit } })] },
          knowing(tasks),
        ).map((x) => x.detail?.why),
        `${limit}`,
      ).toEqual(ok ? [] : ["limit"]);
  });
});

// ---------------------------------------------------------------- a run through the engine

/** An evaluation that gave `value` and asked for `writes`. */
const done = (value: Cell, writes: readonly WriteRequest[] = []): Evaluated => ({
  state: "done",
  values: [value],
  clock: false,
  random: false,
  ...(writes.length ? { writes } : {}),
});
/** A box that answers each evaluation by `answer`: a real interpreter's answer, without one. */
function writingBox(answer: (job: BoxJob) => Evaluated): Box {
  return {
    async run(job) {
      const all = job.kind === "code" && job.mode === "all";
      const n = all ? 1 : job.input.length;
      return {
        evaluations: Array.from({ length: n }, () => answer(job)),
        console: [],
        dropped: 0,
        ms: 1,
      };
    },
  };
}
/** A trigger, then a «Código» over all its rows with that source and those connections, run over the store. */
async function saving(
  source: string,
  connections: Connection[],
  st: FakeStore,
  answer: (job: BoxJob) => Evaluated,
) {
  const s = sketch(132)
    .step("Inicio", "manual", { fields: [] })
    .step("Código", CODE_TYPE, { mode: "all", source })
    .arrow("Inicio", "Código");
  const a = s.build();
  const step = a.steps.find((x) => x.name === "Código") as Step;
  step.connections = connections;
  const e = await run(
    { automation: a, trigger: s.id("Inicio"), fields: { json: {}, label: OWN }, test: false },
    deps({ collectionNamed: named, collections: st, box: writingBox(answer), policy: policy() }),
  );
  return { e, rec: e.steps[step.id] as StepRecord };
}
