// The «Agente» step in the engine (docs/automatizaciones.md §5.6 and §6, phase F15): its two ways of reading, its
// answer, «Lo que hizo», how it runs, what its model receives, its rounds and the run's count of model calls
// (AU-51, AU-53, AU-54, AU-55, AU-58, AU-197, AU-198, AU-200, AU-206).
//
// The engine runs it with a scripted model behind the port it receives (`agent.test-util.ts`: the real rounds of
// packages/agent, no model called and no provider imported, A-02), a store per test and data shaped like the user's:
// generated keys and ids, a text, an option, a number and a relation, 3,000 rows where a bound is checked (A-15).
// «Las hace este código» (AU-51) and code tools (AU-58) come in E3's second PR.
import { clock as now, under } from "@boni/pace";
import { describe, expect, it } from "vitest";
import {
  analyst,
  answer,
  call,
  go,
  lit,
  MODEL,
  obj,
  plan,
  ref,
  scripted,
} from "./agent.test-util.ts";
import { AGENT_ROUNDS } from "./agent.ts";
import { collection, ids, knowing } from "./automation.test-util.ts";
import { paramsOf } from "./catalogue.ts";
import { type Connection, newConnection } from "./connections.ts";
import type { CollectionShape } from "./effects.ts";
import { countModelCall, LimitPassed, StopRun } from "./engine.ts";
import { AUTOMATION_LIMITS, type Automation, limitsOf } from "./format.ts";
import { OUTSIDE, store } from "./run.test-util.ts";
import { validate } from "./validate.ts";
import { abilities } from "./versions.ts";

const next = ids(171);
const groups = collection(next, ["text"]);
const [groupName] = groups.fields.map((f) => f.key) as [string];
const base = collection(next, ["text", "select", "number", "relation"]);
/** Shaped like his: a title, a state with its options, an amount and a relation to another collection. */
const tasks: CollectionShape = {
  key: base.key,
  fields: base.fields.map((f, i) =>
    i === 1
      ? { ...f, options: ["abierta", "cerrada"] }
      : i === 3
        ? { ...f, target: groups.key }
        : f,
  ),
};
const [title, state, amount] = tasks.fields.map((f) => f.key) as [string, string, string];

const ROWS = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    [title]: `tarea de ejemplo ${i}`,
    [state]: i % 2 ? "abierta" : "cerrada",
    [amount]: i,
  }));
const db = (n: number, of = undefined as Parameters<typeof store>[3]) =>
  store(
    [tasks, groups],
    { [tasks.key]: ROWS(n), [groups.key]: [{ [groupName]: "grupo" }] },
    ids(172),
    of,
  );

/** A connection with «Leer» and these write cells. */
const conn = (over: Partial<Connection> = {}, of = tasks.key): Connection => ({
  ...newConnection(of),
  ...over,
});
const YES = { mode: "yes" as const, limit: 20 };
const ASK = { mode: "ask" as const, limit: 20 };
/** What a plan creates: a title and a state, both of the fields the AI decides. */
const CREATE = (id: string, t: unknown = lit("tarea propuesta"), of = tasks.key) =>
  call(id, "create", {
    collection: lit(of),
    fields: obj(lit(title), t, lit(state), lit("abierta")),
  });
const FIND = (id: string, query: unknown = { limit: 3 }) =>
  call(id, "find", { collection: lit(tasks.key), query: lit(query) });
const allSteps = (a: Automation) => a.steps;

describe("the «Agente» step (F15)", () => {
  it("«Analista»: with a scripted model it reads, proposes a row and, without «Leer», answers that it cannot", async () => {
    // Round 1 reads three tasks; round 2 asks to create one from what it read, and answers. The cell says «Preguntar»:
    // the row waits in the run's proposal and nothing is saved.
    const reads = scripted((_, n) =>
      n === 1
        ? plan(FIND("s1"))
        : plan(
            CREATE("s1", ref(`$round1.s1[0].${title}`)),
            answer("s2", lit("Propongo una tarea")),
          ),
    );
    const { automation, id } = analyst({}, [conn({ create: { ...ASK, fields: [title, state] } })]);
    const st = db(10);
    const e = await go(automation, { collections: st, ai: reads.port });
    const step = e.steps[id];
    expect(e.state).toBe("done");
    expect(step?.out.main).toHaveLength(1);
    expect(step?.out.main[0]?.json.texto).toBe("Propongo una tarea");
    expect(step?.writes?.kind).toBe("asked");
    expect(e.asked).toHaveLength(1);
    expect(st.rows(tasks.key)).toHaveLength(10);
    expect(step?.agent?.units).toEqual([
      {
        rounds: 2,
        lines: [
          { op: "find", collection: tasks.key, rows: 3, limit: 3 },
          { op: "create", collection: tasks.key, state: "asked" },
        ],
        more: 0,
        seen: [],
      },
    ]);
    expect(step?.ai).toMatchObject({ calls: 2, models: [MODEL] });
    // What the second round saw of the first: the rows it read, by their ids.
    expect(JSON.stringify(reads.asked[1]?.rounds)).toContain("tarea de ejemplo 0");

    // Without «Leer»: the read is refused, the model is told so in the next round, and it answers that it cannot.
    const blind = scripted((r, n) =>
      n === 1
        ? plan(FIND("s1"))
        : plan(
            answer(
              "s1",
              lit(
                JSON.stringify(r.rounds[0]).includes("read-off")
                  ? "No puedo leer las tareas"
                  : "Leí las tareas",
              ),
            ),
          ),
    );
    const off = analyst({}, [conn({ read: false, create: { ...ASK, fields: [title, state] } })]);
    const f = await go(off.automation, { collections: db(10), ai: blind.port });
    expect(f.state).toBe("done");
    expect(f.steps[off.id]?.out.main[0]?.json.texto).toBe("No puedo leer las tareas");
    expect(f.steps[off.id]?.agent?.units[0]?.lines).toEqual([
      { op: "refused", tool: "find", collection: tasks.key, why: "read-off" },
    ]);
    // Its schema said so before: the connection has no read.
    expect(blind.asked[0]?.connections).toMatchObject([{ collection: tasks.key, read: false }]);
  });

  it("AU-51 · «Las decide la IA»: a read the plan asks for is narrowed by the step's connection, like a «Código»'s", async () => {
    const only = [{ field: state, op: "is", value: "abierta" }];
    const ai = scripted((_, n) => (n === 1 ? plan(FIND("s1", {})) : plan(answer("s1"))));
    const { automation, id } = analyst({}, [conn({ read: { where: only as never, limit: 4 } })]);
    const e = await go(automation, { collections: db(20), ai: ai.port });
    expect(e.state).toBe("done");
    // Only the open ones, at most four: the plan asked for all and could not widen it.
    const seen =
      (ai.asked[1]?.rounds[0] as { s1: Record<string, unknown>[] } | undefined)?.s1 ?? [];
    expect(seen).toHaveLength(4);
    expect(seen.every((r) => r[state] === "abierta")).toBe(true);
    expect(e.steps[id]?.reads).toMatchObject([{ collection: tasks.key, op: "find", rows: 4 }]);
  });
  it.todo(
    "AU-51 · «Las hace este código»: the code runs once per unit before the first round, only reads (a write call in it is `agent.reads.write`), and the model's schema has no read",
  );

  it("AU-53 · «Texto» gives one row with `texto`, «Campos» a row of that shape; an answer outside the shape is asked again once and then fails the step (`agent.reply`)", async () => {
    const fields = [
      { key: "resumen", type: "text" },
      { key: "total", type: "number" },
    ];
    const good = scripted(() =>
      plan(call("s1", "answer", { resumen: lit("Diez tareas"), total: lit(10) })),
    );
    const shaped = analyst({ answer: "fields", fields: fields as never }, [conn()]);
    const e = await go(shaped.automation, { collections: db(10), ai: good.port });
    expect(e.state).toBe("done");
    expect(e.steps[shaped.id]?.out.main.map((r) => r.json)).toEqual([
      { resumen: "Diez tareas", total: 10 },
    ]);
    expect(good.asked[0]?.answer).toMatchObject({ kind: "fields" });

    // A number where a text goes, twice: asked again once in the round, then the step fails.
    const bad = scripted(() => plan(call("s1", "answer", { resumen: lit(3), total: lit("x") })));
    const f = await go(shaped.automation, { collections: db(10), ai: bad.port });
    expect(bad.asked).toHaveLength(2);
    expect(bad.asked[1]?.again).toMatchObject({ fault: "reply" });
    expect(f.state).toBe("failed");
    expect(f.error).toMatchObject({ step: shaped.id, ai: { code: "agent.reply" } });
    expect(f.steps[shaped.id]?.out.main).toEqual([]);
  });

  it("AU-53 · the answer is labelled `model`, and also as from outside when it cites by handle a value the model did not read", async () => {
    // His rows came from outside (a mail's text, say): the model sees them as handles, and cites one.
    const ai = scripted((_, n) =>
      n === 1 ? plan(FIND("s1")) : plan(answer("s1", ref(`$round1.s1[0].${title}`))),
    );
    const { automation, id } = analyst({}, [conn()]);
    const e = await go(automation, { collections: db(5, OUTSIDE), ai: ai.port });
    expect(e.state).toBe("done");
    const out = e.steps[id]?.out.main[0];
    expect(out?.json.texto).toBe("tarea de ejemplo 0");
    expect(out?.fields?.texto?.derived).toBe(true);
    expect(out?.fields?.texto?.label.integrity).toBe("external");
    expect(JSON.stringify(ai.asked[1]?.rounds)).not.toContain("tarea de ejemplo 0");
    // A literal answer is the model's own.
    const own = scripted(() => plan(answer("s1")));
    const g = await go(automation, { collections: db(5), ai: own.port });
    const label = g.steps[id]?.out.main[0]?.fields?.texto?.label;
    expect(label?.integrity).toBe("model");
  });

  it("AU-54 · «Lo que hizo» is written by code from the plan steps that ran, in order, with rounds, model calls, the model that answered and the time; at most 50 lines per unit", async () => {
    // 30 counts a round, two rounds, then the answer: 60 plan steps that ran, 50 lines and 10 more.
    const counts = () =>
      plan(
        ...Array.from({ length: 30 }, (_, i) =>
          call(`s${i + 1}`, "count", { collection: lit(tasks.key) }),
        ),
      );
    const ai = scripted((_, n) => (n <= 2 ? counts() : plan(answer("s1"))));
    const { automation, id } = analyst({}, [conn()]);
    const e = await go(automation, { collections: db(7), ai: ai.port });
    const step = e.steps[id];
    expect(e.state).toBe("done");
    const unit = step?.agent?.units[0];
    expect(unit?.rounds).toBe(3);
    expect(unit?.lines).toHaveLength(50);
    expect(unit?.more).toBe(10);
    expect(unit?.lines[0]).toEqual({ op: "count", collection: tasks.key, rows: 1 });
    expect(step?.ai).toMatchObject({ calls: 3, models: [MODEL] });
    expect(typeof step?.ai?.ms).toBe("number");
    // Keys and values only, never words: the screen says them (P2).
    expect(JSON.stringify(unit)).not.toMatch(/Leyó|Creó|Leí/);
  });

  it("AU-54 · in a test the lines say what it would do and nothing is saved or proposed", async () => {
    const ai = scripted(() => plan(CREATE("s1"), CREATE("s2"), answer("s3")));
    const { automation, id } = analyst({}, [conn({ create: { ...YES, fields: [title, state] } })]);
    const st = db(3);
    const e = await go(automation, { collections: st, ai: ai.port }, true);
    expect(e.state).toBe("done");
    expect(e.steps[id]?.writes).toMatchObject({ kind: "tested" });
    expect(e.steps[id]?.agent?.units[0]?.lines.map((l) => l.op === "create" && l.state)).toEqual([
      "tested",
      "tested",
    ]);
    expect(e.asked).toEqual([]);
    expect(st.rows(tasks.key)).toHaveLength(3);
    expect(st.applied).toEqual([]);
  });

  it("AU-55 · «Una vez con todas las filas» is one unit of work; «Una vez por fila» is one unit per row, each with its own rounds", async () => {
    const ai = scripted(() => plan(answer("s1")));
    const all = analyst({}, [conn()], tasks.key);
    const e = await go(all.automation, { collections: db(3), ai: ai.port });
    expect(e.state).toBe("done");
    expect(ai.asked).toHaveLength(1);
    expect(ai.asked[0]?.rows).toHaveLength(3);
    expect(e.steps[all.id]?.out.main).toHaveLength(1);
    expect(e.steps[all.id]?.agent?.units).toHaveLength(1);

    const each = scripted(() => plan(answer("s1")));
    const per = analyst({ mode: "perRow" }, [conn()], tasks.key);
    const f = await go(per.automation, { collections: db(3), ai: each.port });
    expect(f.state).toBe("done");
    expect(each.asked).toHaveLength(3);
    expect(each.asked.map((r) => (r.rows as unknown[]).length)).toEqual([1, 1, 1]);
    // Each row goes out with its own fields and the answer.
    const out = f.steps[per.id]?.out.main ?? [];
    expect(out.map((r) => [r.json[title], r.json.texto])).toEqual([
      ["tarea de ejemplo 0", "Hecho"],
      ["tarea de ejemplo 1", "Hecho"],
      ["tarea de ejemplo 2", "Hecho"],
    ]);
    expect(f.steps[per.id]?.agent?.units.map((u) => [u.row, u.rounds])).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
  });

  it("AU-58 · «Rondas máximas» is born at 5 and a document asking for more than 10 does not validate", () => {
    const spec = paramsOf({ id: "s_x", name: "x", type: "agent", params: {} });
    expect(spec.find((p) => p.key === "maxRounds")?.default).toBe(AGENT_ROUNDS.born);
    expect(AGENT_ROUNDS).toEqual({ born: 5, max: 10 });
    const context = { ...knowing(tasks, groups), ai: true };
    const at = (maxRounds: number) => {
      const { automation } = analyst({ maxRounds }, [conn()]);
      return validate(automation, context).map((p) => [p.code, p.param]);
    };
    expect(at(10)).toEqual([]);
    expect(at(1)).toEqual([]);
    expect(at(11)).toEqual([["param.value", "maxRounds"]]);
    expect(at(0)).toEqual([["param.value", "maxRounds"]]);
    // Without a model to call, the type is not one (as «Código» without a box).
    const { automation } = analyst({}, [conn()]);
    expect(validate(automation, knowing(tasks, groups)).map((p) => p.code)).toEqual([
      "step.unknownType",
    ]);
  });
  it.todo(
    "AU-58 · a code tool runs in the box with the step's connections and only reads; what it returns goes through the planner's view",
  );

  it("AU-197 · what the model receives is a closed list: a new source in the request breaks this test", async () => {
    const ai = scripted(() => plan(answer("s1")));
    const { automation } = analyst({}, [
      conn({ create: { ...YES, fields: [title, state] }, update: false, remove: ASK }),
    ]);
    await go(automation, { collections: db(2), ai: ai.port });
    const r = ai.asked[0];
    expect(Object.keys(r ?? {}).sort()).toEqual(
      [
        "answer",
        "connections",
        "instructions",
        "language",
        "model",
        "rounds",
        "rows",
        "seen",
        "today",
        "tools",
        "use",
        "zone",
      ].sort(),
    );
    // Each connection: its collection, its fields by key and type, and each action it gives with its limits.
    const [c] = (r?.connections ?? []) as Record<string, unknown>[];
    expect(Object.keys(c ?? {}).sort()).toEqual([
      "collection",
      "create",
      "fields",
      "read",
      "trash",
    ]);
    expect(c?.create).toEqual({
      fields: [
        { key: title, line: "" },
        { key: state, line: "" },
      ],
      fixed: [],
      limit: 20,
    });
    expect(((c?.fields ?? []) as { key: string }[]).map((f) => f.key)).toEqual(
      tasks.fields.map((f) => f.key),
    );
    expect(r?.tools.sort()).toEqual(
      ["answer", "count", "create", "find", "get", "sum", "trash", "update"].sort(),
    );
  });

  it("AU-197 · a value from outside in «Instrucciones» or in the input rows reaches the model as a handle, never as its text", async () => {
    const ai = scripted(() => plan(answer("s1")));
    const { automation, id } = analyst(
      { instructions: { expr: `Resume esta tarea: {{ $json.${title} }}` }, mode: "perRow" },
      [conn()],
      tasks.key,
    );
    const e = await go(automation, { collections: db(1, OUTSIDE), ai: ai.port });
    expect(e.state).toBe("done");
    const sent = JSON.stringify(ai.asked[0]);
    expect(sent).not.toContain("tarea de ejemplo 0");
    expect(sent).toContain("Resume esta tarea: ");
    expect(sent).toContain("$handle");
    // «Lo que hizo» says what went as a handle, by field, from where.
    expect(e.steps[id]?.agent?.units[0]?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: "hidden", field: title, from: "instructions" }),
        expect.objectContaining({ op: "hidden", from: "rows" }),
      ]),
    );
  });

  it("AU-198 · a plan without an answer opens another round with what it returned; rounds used up fail the step (`agent.rounds`) and save nothing", async () => {
    const ai = scripted(() => plan(CREATE("s1")));
    const { automation, id } = analyst({ maxRounds: 3 }, [
      conn({ create: { ...YES, fields: [title, state] } }),
    ]);
    const st = db(2);
    const e = await go(automation, { collections: st, ai: ai.port });
    expect(ai.asked).toHaveLength(3);
    // Each round sees what the one before returned: what it will do, never the row.
    expect(ai.asked[1]?.rounds).toEqual([{ s1: { planned: `will create 1 row in ${tasks.key}` } }]);
    expect(e.state).toBe("failed");
    expect(e.error).toMatchObject({ step: id, ai: { code: "agent.rounds" } });
    expect(st.applied).toEqual([]);
    expect(e.steps[id]?.writes).toBeUndefined();
  });

  it("AU-198 · a round returns at most 200 rows and 20,000 characters to the next, saying what was left out, with 3,000 rows in the collection", async () => {
    const ai = scripted((_, n) => (n === 1 ? plan(FIND("s1", {})) : plan(answer("s1"))));
    const { automation, id } = analyst({}, [conn()]);
    const st = db(3000);
    const t0 = now();
    const e = await go(automation, { collections: st, ai: ai.port });
    const ms = now() - t0;
    expect(e.state).toBe("done");
    const seen = (ai.asked[1]?.rounds[0] as { s1: unknown[] } | undefined)?.s1 ?? [];
    expect(seen.length).toBeLessThanOrEqual(200);
    expect(JSON.stringify(ai.asked[1]?.rounds).length).toBeLessThanOrEqual(20_000 + 2);
    expect(ai.asked[1]?.seen).toEqual([{ at: "$round1.s1", saw: seen.length, of: 3000 }]);
    expect(e.steps[id]?.agent?.units[0]?.seen).toEqual(ai.asked[1]?.seen);
    expect(e.steps[id]?.agent?.units[0]?.lines[0]).toMatchObject({ op: "find", rows: 3000 });
    // A read of 3,000 rows and its view for the next round, with the store made: measured on 2026-11-17 (five runs),
    // 79 to 136 ms for the whole test.
    under(ms, 600, "clock", "an «Agente» reading 3,000 rows and cutting its view");
  });

  it("AU-198 · a request outside the connection is refused, told to the model in the next round and written in «Lo que hizo»; the step does not fail", async () => {
    const ai = scripted((r, n) =>
      n === 1
        ? plan(CREATE("s1"), call("s2", "find", { collection: lit(groups.key) }))
        : plan(answer("s1", lit(JSON.stringify(r.rounds[0])))),
    );
    // Reading tasks only, and «No» on creating.
    const { automation, id } = analyst({}, [conn()]);
    const st = db(2);
    const e = await go(automation, { collections: st, ai: ai.port });
    expect(e.state).toBe("done");
    expect(ai.asked[1]?.rounds).toEqual([
      { s1: { refused: "action-off" }, s2: { refused: "not-connected" } },
    ]);
    expect(e.steps[id]?.agent?.units[0]?.lines).toEqual([
      { op: "refused", tool: "create", collection: tasks.key, why: "action-off" },
      { op: "refused", tool: "find", collection: groups.key, why: "not-connected" },
    ]);
    expect(st.applied).toEqual([]);
  });

  it("AU-198 · the writes of a unit are decided at the end as one change: all saved, or all waiting in the run's proposal if one of them asks; a step that fails leaves nothing saved", async () => {
    const twice = () =>
      scripted(() =>
        plan(
          CREATE("s1"),
          call("s2", "create", {
            collection: lit(groups.key),
            fields: obj(lit(groupName), lit("grupo propuesto")),
          }),
          answer("s3"),
        ),
      );
    const both = (cell: typeof YES | typeof ASK) =>
      analyst({}, [
        conn({ create: { ...YES, fields: [title, state] } }),
        conn({ create: { ...cell, fields: [groupName] } }, groups.key),
      ]);
    // Both «Sí»: both saved, in one transaction.
    const yes = both(YES);
    const st = db(1);
    const e = await go(yes.automation, { collections: st, ai: twice().port });
    expect(e.state).toBe("done");
    expect(e.steps[yes.id]?.writes?.kind).toBe("applied");
    expect(st.rows(tasks.key)).toHaveLength(2);
    expect(st.rows(groups.key)).toHaveLength(2);
    expect(st.calls.filter((c) => c.method === "applyAll")).toHaveLength(2);
    // One asks: the whole change waits, nothing saved.
    const ask = both(ASK);
    const st2 = db(1);
    const f = await go(ask.automation, { collections: st2, ai: twice().port });
    expect(f.steps[ask.id]?.writes?.kind).toBe("asked");
    expect(f.asked).toHaveLength(2);
    expect(st2.applied).toEqual([]);
    expect(
      f.steps[ask.id]?.agent?.units[0]?.lines.map(
        (l) => l.op !== "hidden" && "state" in l && l.state,
      ),
    ).toEqual(["asked", "asked"]);
  });

  it("AU-200 · `abilities` gives one line per collection and action an «Agente»'s connection allows, each marked as decided by the AI", () => {
    const { automation, id } = analyst({}, [
      conn({ create: { ...YES, fields: [title] }, remove: ASK }),
      conn({ read: false, update: YES }, groups.key),
    ]);
    expect(abilities(automation, { collectionNamed: (n) => n })).toEqual(
      [
        { collection: tasks.key, action: "read", byAgent: true, steps: [id] },
        { collection: tasks.key, action: "create", how: "saves", byAgent: true, steps: [id] },
        { collection: tasks.key, action: "remove", how: "asks", byAgent: true, steps: [id] },
        { collection: groups.key, action: "update", how: "saves", byAgent: true, steps: [id] },
      ].sort((x, y) => (x.collection < y.collection ? -1 : x.collection > y.collection ? 1 : 0)),
    );
    // A «Colección» step's line carries no such mark.
    expect(allSteps(automation)).toHaveLength(2);
  });

  it("AU-206 · each round, each reader call and each retry counts; the call that would pass the limit is not made and the run stops with `run.limit`", () => {
    // The count every model call of a run goes through (`StepContext.modelCall`, which E2's reader and E3's
    // «Agente» call before each call, retries included): with «Llamadas a modelos» at 3, three are made and the
    // fourth is refused before it is made, saying the limit's key and both numbers, as every limit of the run does.
    const limits = limitsOf({ settings: { limits: { modelCalls: 3 } } } as Pick<
      Automation,
      "settings"
    >);
    expect(limits.modelCalls).toBe(3);
    let made = 0;
    for (let i = 0; i < 3; i++) made = countModelCall(limits, made);
    expect(made).toBe(3);
    let stopped: unknown = null;
    try {
      made = countModelCall(limits, made);
    } catch (e) {
      stopped = e;
    }
    expect(made).toBe(3);
    // A `StopRun`: no retry and no «Si falla» apply; its failure is `run.limit` (limits.test.ts, AU-17).
    expect(stopped).toBeInstanceOf(LimitPassed);
    expect(stopped).toBeInstanceOf(StopRun);
    expect(stopped).toMatchObject({ limit: "modelCalls", max: 3, got: 4 });
    // Born at 20 and never over 40, as the format says.
    expect(limitsOf({ settings: {} } as Pick<Automation, "settings">).modelCalls).toBe(20);
    expect(AUTOMATION_LIMITS.modelCalls).toEqual({ default: 20, ceiling: 40 });
  });
});
