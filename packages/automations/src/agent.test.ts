// The «Agente» step in the engine (docs/automatizaciones.md §5.6 and §6, phase F15): its two ways of reading, its
// answer, «Lo que hizo», how it runs, what its model receives, its rounds and the run's count of model calls
// (AU-51, AU-53, AU-54, AU-55, AU-58, AU-197, AU-198, AU-200, AU-206).
//
// The engine runs it with a scripted model behind the port it receives (`agent.test-util.ts`: the real rounds of
// packages/agent, no model called and no provider imported, A-02), a store per test and data shaped like the user's:
// generated keys and ids, a text, an option, a number and a relation, 3,000 rows where a bound is checked (A-15).
// Its own code («Las hace este código», AU-51, and code tools, AU-58) runs in a scripted box (`codeBox`): what the
// engine sends it and does with its answer is this file's; the box's own contract is box.test.ts's.
import { clock as now, under } from "@boni/pace";
import { describe, expect, it } from "vitest";
import {
  analyst,
  answer,
  call,
  codeBox,
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
import type { Cell } from "./rows.ts";
import { OUTSIDE, policy, store } from "./run.test-util.ts";
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

/** The collections by the name their code writes. */
const named = (n: string) => (n === "tareas de ejemplo" ? tasks.key : undefined);
/** «Las hace este código»: the open tasks, three at most. Only the scripted box answers it; validation reads it. */
const READS =
  "return $col('tareas de ejemplo').find({ where: [{ field: 'x', op: 'is', value: 'abierta' }], limit: 3 })";
/** The same, with a call that asks to save, in a branch never taken. */
const WRITES = `if (false) $col('tareas de ejemplo').create({ x: 1 })\n${READS}`;
/** Its unit's rows as they are. */
const EACH = "return $input.all().map((r) => r.json)";
/** A code tool: how many tasks are in a state, its input (`$json`). */
const COUNT =
  "return { cuantas: $col('tareas de ejemplo').count({ where: [{ field: 'x', op: 'is', value: $json.estado }] }) }";
const BROKEN = "throw new Error('no')";
const TOOLS = [
  { name: "contar", inputs: [{ name: "estado", type: "text" }], code: COUNT },
  { name: "rota", inputs: [], code: BROKEN },
];

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
    expect(step?.out.main?.[0]?.json.texto).toBe("Propongo una tarea");
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
    expect(f.steps[off.id]?.out.main?.[0]?.json.texto).toBe("No puedo leer las tareas");
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
  it("AU-51 · «Las hace este código»: the code runs once per unit before the first round, through the step's reader; what it gives is the model's rows, and the model's schema has no read", async () => {
    const open = [{ field: state, op: "is", value: "abierta" }];
    const box = codeBox({
      [READS]: (job) =>
        "abiertas" in job.reads
          ? { value: job.reads.abiertas as Cell }
          : {
              needs: {
                key: "abiertas",
                read: {
                  collection: "tareas de ejemplo",
                  op: "find",
                  where: open as never,
                  limit: 3,
                },
              },
            },
    });
    // A read asked for anyway is not offered: it is refused and told (`read-off`), and then it answers.
    const ai = scripted((_, n) => (n === 1 ? plan(FIND("s1")) : plan(answer("s1"))));
    const { automation, id } = analyst({ reads: "code", code: READS }, [conn()]);
    const e = await go(automation, {
      collections: db(10),
      ai: ai.port,
      box,
      collectionNamed: named,
    });
    expect(e.state).toBe("done");
    expect(box.jobs.map((j) => [j.kind, j.mode])).toEqual([
      ["code", "all"],
      ["code", "all"],
    ]);
    const rows = ai.asked[0]?.rows as Record<string, unknown>[];
    expect(rows.map((r) => r[title])).toEqual([
      "tarea de ejemplo 1",
      "tarea de ejemplo 3",
      "tarea de ejemplo 5",
    ]);
    expect(ai.asked[0]?.tools).toEqual(["create", "update", "trash", "answer"]);
    expect(ai.asked[1]?.again).toBeUndefined();
    expect(ai.asked[1]?.rounds).toEqual([{ s1: { refused: "read-off" } }]);
    expect(e.steps[id]?.agent?.units[0]?.lines).toEqual([
      { op: "code", rows: 3 },
      { op: "refused", tool: "find", collection: tasks.key, why: "read-off" },
    ]);
    expect(e.steps[id]?.reads).toMatchObject([{ collection: tasks.key, op: "find", rows: 3 }]);

    // «Una vez por fila»: once per unit, with that unit's row.
    const each = codeBox({ [EACH]: (job) => ({ value: job.input as Cell }) });
    const per = analyst({ reads: "code", code: EACH, mode: "perRow" }, [conn()], tasks.key);
    const f = await go(per.automation, {
      collections: db(2),
      ai: scripted(() => plan(answer("s1"))).port,
      box: each,
      collectionNamed: named,
    });
    expect(f.state).toBe("done");
    expect(each.jobs.map((j) => j.input.map((r) => r[title]))).toEqual([
      ["tarea de ejemplo 0"],
      ["tarea de ejemplo 1"],
    ]);

    // A failure of the code fails the unit, with the parameter it is in; no model is called.
    const failing = codeBox({
      [READS]: () => ({ fails: { code: "code.threw", detail: { message: "no" } } }),
    });
    const quiet = scripted(() => plan(answer("s1")));
    const g = await go(automation, {
      collections: db(2),
      ai: quiet.port,
      box: failing,
      collectionNamed: named,
    });
    expect(g.state, JSON.stringify(g.error)).toBe("failed");
    console.log(JSON.stringify(g.error));
    expect(g.error).toMatchObject({
      step: id,
      failure: { param: "code" },
      why: { code: "code.threw" },
    });
    expect(quiet.asked).toEqual([]);
  });

  it("AU-51 · the code of «Las hace este código» only reads: a call that asks to save, wherever it sits, is `agent.reads.write`; without a box it is `expr.code`", () => {
    const context = { ...knowing(tasks, groups), ai: true, collectionNamed: named };
    const of = (code: string, reads = "code") =>
      validate(analyst({ reads, code }, [conn()]).automation, context).map((p) => [
        p.code,
        p.param,
      ]);
    expect(of(READS)).toEqual([]);
    expect(of(WRITES)).toEqual([["agent.reads.write", "code"]]);
    // With «Las decide la IA» the code is kept and not read (changing the mode does not delete it).
    expect(of(WRITES, "ai")).toEqual([]);
    const { automation } = analyst({ reads: "code", code: READS }, [conn()]);
    expect(
      validate(automation, { ...knowing(tasks, groups), ai: true }).map((p) => [p.code, p.param]),
    ).toEqual([["expr.code", "code"]]);
    expect(
      validate(analyst({ reads: "code", code: { expr: "{{ 1 }}" } }, [conn()]).automation, context)
        .map((p) => [p.code, p.param])
        .slice(0, 1),
    ).toEqual([["param.shape", "code"]]);
  });

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
    expect(e.steps[shaped.id]?.out.main?.map((r) => r.json)).toEqual([
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
    const out = e.steps[id]?.out.main?.[0];
    expect(out?.json.texto).toBe("tarea de ejemplo 0");
    expect(out?.fields?.texto?.derived).toBe(true);
    expect(out?.fields?.texto?.label.integrity).toBe("external");
    expect(JSON.stringify(ai.asked[1]?.rounds)).not.toContain("tarea de ejemplo 0");
    // A literal answer is the model's own.
    const own = scripted(() => plan(answer("s1")));
    const g = await go(automation, { collections: db(5), ai: own.port });
    const label = g.steps[id]?.out.main?.[0]?.fields?.texto?.label;
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
  it("AU-58 · a code tool runs in the box with the step's connections and only reads; the model calls it by its name with its inputs, and what it returns goes back with its labels", async () => {
    const box = codeBox({
      [COUNT]: (job, row) => {
        const key = `n:${String(row?.estado)}`;
        return key in job.reads
          ? { value: { cuantas: job.reads[key] as Cell } }
          : {
              needs: {
                key,
                read: {
                  collection: "tareas de ejemplo",
                  op: "count",
                  where: [{ field: state, op: "is", value: row?.estado }] as never,
                },
              },
            };
      },
      [BROKEN]: () => ({ fails: { code: "code.threw", detail: { message: "no" } } }),
    });
    const ai = scripted((r, n) =>
      n === 1
        ? plan(
            call("s1", "contar", { estado: lit("abierta") }),
            call("s2", "contar", { estado: lit(3) }),
            call("s3", "rota", {}),
          )
        : plan(answer("s1", lit(JSON.stringify(r.rounds[0])))),
    );
    const { automation, id } = analyst({ tools: TOOLS as never }, [conn()]);
    const e = await go(automation, {
      collections: db(10),
      ai: ai.port,
      box,
      collectionNamed: named,
    });
    expect(e.state).toBe("done");
    expect(ai.asked[0]?.tools).toEqual([
      "find",
      "get",
      "count",
      "sum",
      "create",
      "update",
      "trash",
      "contar",
      "rota",
      "answer",
    ]);
    expect(ai.asked[0]?.codeTools).toEqual([
      { name: "contar", inputs: [{ name: "estado", type: "text" }] },
      { name: "rota", inputs: [] },
    ]);
    // Its value, an input of another type refused, and a failure told as one.
    expect(ai.asked[1]?.rounds).toEqual([
      { s1: { cuantas: 5 }, s2: { refused: "bad-request" }, s3: { refused: "code-failed" } },
    ]);
    expect(box.jobs[0]).toMatchObject({
      kind: "code",
      mode: "perRow",
      input: [{ estado: "abierta" }],
    });
    expect(e.steps[id]?.agent?.units[0]?.lines).toEqual([
      { op: "tool", name: "contar", rows: 1 },
      { op: "refused", tool: "contar", why: "bad-request" },
      { op: "refused", tool: "rota", why: "code-failed" },
    ]);
    expect(e.steps[id]?.reads).toMatchObject([{ collection: tasks.key, op: "count" }]);
  });

  it("AU-58 · code tools: at most 8, each a name of its own and its inputs typed; their code only reads", () => {
    const context = { ...knowing(tasks, groups), ai: true, collectionNamed: named };
    const of = (tools: unknown) =>
      validate(analyst({ tools: tools as never }, [conn()]).automation, context).map((p) => [
        p.code,
        p.param,
      ]);
    expect(of(TOOLS)).toEqual([]);
    expect(of([{ ...TOOLS[0], code: WRITES }])).toEqual([["agent.reads.write", "tools.0.code"]]);
    expect(of([{ ...TOOLS[0], name: "find" }])).toEqual([["param.value", "tools"]]);
    expect(of([{ ...TOOLS[0], inputs: [{ name: "x", type: "color" }] }])).toEqual([
      ["param.value", "tools"],
    ]);
    expect(of(Array.from({ length: 9 }, (_, i) => ({ ...TOOLS[0], name: `t${i}` })))).toEqual([
      ["param.value", "tools"],
    ]);
    // Two tools of one name.
    expect(of([TOOLS[0], { ...TOOLS[1], name: "contar" }])).toEqual([["param.value", "tools"]]);
  });

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
    // With «Las hace este código» and a code tool: `codeTools` joins the list, the reads leave the tools, and no code
    // is ever in it, the step's or a tool's.
    const coded = scripted(() => plan(answer("s1")));
    const c2 = analyst({ reads: "code", code: EACH, tools: [TOOLS[0]] as never }, [conn()]);
    const f = await go(c2.automation, {
      collections: db(2),
      ai: coded.port,
      box: codeBox({ [EACH]: () => ({ value: [{ n: 1 }] }) }),
      collectionNamed: named,
    });
    expect(f.state).toBe("done");
    const q = coded.asked[0];
    expect(Object.keys(q ?? {}).sort()).toEqual([...Object.keys(r ?? {}), "codeTools"].sort());
    expect(q?.tools).toEqual(["create", "update", "trash", "contar", "answer"]);
    expect(q?.codeTools).toEqual([{ name: "contar", inputs: [{ name: "estado", type: "text" }] }]);
    const sent = JSON.stringify(q);
    for (const code of [EACH, COUNT, "$col", "$input"]) expect(sent).not.toContain(code);
  });

  it("AU-51 · going back to «Las decide la IA» keeps the code saved and runs none of it: the round reads", async () => {
    const box = codeBox({});
    const ai = scripted(() => plan(answer("s1")));
    const { automation } = analyst({ reads: "ai", code: READS }, [conn()]);
    const e = await go(automation, {
      collections: db(2),
      ai: ai.port,
      box,
      collectionNamed: named,
    });
    expect(e.state).toBe("done");
    expect(box.jobs).toEqual([]);
    expect(ai.asked[0]?.tools).toEqual(expect.arrayContaining(["find", "get", "count", "sum"]));
    expect(automation.steps.find((x) => x.type === "agent")?.params.code).toBe(READS);
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
    // «Lo que hizo» says nothing of it was saved: each create it asked is `failed`, none stays `planned`.
    const states = (e.steps[id]?.agent?.units[0]?.lines ?? []).map((l) =>
      "state" in l ? l.state : l.op,
    );
    expect(states).toEqual(["failed", "failed", "failed"]);
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

  it("AU-198 · a unit «Reintentar» tries again is a second unit in «Lo que hizo», with its own rounds", async () => {
    const bad = { version: 1, steps: [{ id: "s1", op: "nope" }] };
    // Twice a plan that is not one: `agent.plan`; then, tried again, it answers.
    const ai = scripted((_, n) => (n <= 2 ? bad : plan(answer("s1"))));
    const { automation, id } = analyst({}, [conn()], undefined, {
      retry: { times: 1, waitMs: 0 },
    });
    const e = await go(automation, { collections: db(2), ai: ai.port });
    expect(e.state).toBe("done");
    expect(e.steps[id]?.retries).toBe(1);
    expect(e.steps[id]?.agent?.units.map((u) => u.rounds)).toEqual([1, 1]);
    expect(e.steps[id]?.ai?.calls).toBe(3);
  });

  it("AU-53 · AU-198 · after an answer that does not fit, the plan asked again in the round gathers its writes on top of the first's, which the model saw as planned", async () => {
    const ai = scripted((_, n) =>
      n === 1
        ? plan(CREATE("s1"), call("s2", "answer", { total: lit("no es un número") }))
        : plan(CREATE("s1", lit("otra tarea")), call("s2", "answer", { total: lit(2) })),
    );
    const { automation, id } = analyst(
      { answer: "fields", fields: [{ key: "total", type: "number" }] as never },
      [conn({ create: { ...YES, fields: [title, state] } })],
    );
    const st = db(1);
    const e = await go(automation, { collections: st, ai: ai.port });
    expect(e.state).toBe("done");
    expect(ai.asked[1]?.again).toMatchObject({ fault: "reply" });
    expect(ai.asked[1]?.rounds).toMatchObject([{ s1: { planned: expect.any(String) } }]);
    expect(st.rows(tasks.key).map((r) => r.json[title])).toEqual([
      "tarea de ejemplo 0",
      "tarea propuesta",
      "otra tarea",
    ]);
    expect(e.steps[id]?.agent?.units[0]?.lines).toEqual([
      { op: "create", collection: tasks.key, state: "applied" },
      { op: "create", collection: tasks.key, state: "applied" },
    ]);
  });

  it("AU-52 · each field the AI decides goes to the model with its line, empty when it has none", async () => {
    const ai = scripted(() => plan(answer("s1")));
    const lines = { [title]: "el título, corto" };
    const { automation } = analyst({}, [
      conn({ create: { ...YES, fields: [title, state], lines } }),
    ]);
    await go(automation, { collections: db(1), ai: ai.port });
    expect(ai.asked[0]?.connections).toMatchObject([
      {
        create: {
          fields: [
            { key: title, line: "el título, corto" },
            { key: state, line: "" },
          ],
        },
      },
    ]);
  });

  it("AU-55 · 250 input rows reach the model through the planner's view (200 rows, 20,000 characters), saying what was left out", async () => {
    const ai = scripted(() => plan(answer("s1")));
    const { automation } = analyst({}, [conn()], tasks.key);
    const e = await go(automation, { collections: db(250), ai: ai.port });
    expect(e.state).toBe("done");
    // At most 200 rows and 20,000 characters: here the characters cut first.
    const rows = ai.asked[0]?.rows as unknown[];
    expect(rows.length).toBeLessThanOrEqual(200);
    expect(JSON.stringify(rows).length).toBeLessThanOrEqual(20_000 + 2);
    expect(ai.asked[0]?.seen).toEqual([{ at: "$rows", saw: rows.length, of: 250 }]);

    // Small rows: the 200 rows cut first, the characters far below theirs.
    const small = codeBox({
      [EACH]: () => ({ value: Array.from({ length: 250 }, (_, n) => ({ n })) }),
    });
    const few = scripted(() => plan(answer("s1")));
    const f = await go(analyst({ reads: "code", code: EACH }, [conn()]).automation, {
      collections: db(1),
      ai: few.port,
      box: small,
      collectionNamed: named,
    });
    expect(f.state).toBe("done");
    expect(few.asked[0]?.rows).toHaveLength(200);
    expect(JSON.stringify(few.asked[0]?.rows).length).toBeLessThan(20_000);
    expect(few.asked[0]?.seen).toEqual([{ at: "$rows", saw: 200, of: 250 }]);
  });

  it("AU-51 · `count` and `sum` give their value over every row the connection reads, never cut by the view", async () => {
    const ai = scripted((r, n) =>
      n === 1
        ? plan(
            call("s1", "count", { collection: lit(tasks.key), query: lit({}) }),
            call("s2", "sum", { collection: lit(tasks.key), field: lit(amount), query: lit({}) }),
          )
        : plan(answer("s1", lit(JSON.stringify(r.rounds[0])))),
    );
    const { automation } = analyst({}, [conn()]);
    const e = await go(automation, { collections: db(3000), ai: ai.port });
    expect(e.state).toBe("done");
    expect(ai.asked[1]?.rounds).toEqual([{ s1: 3000, s2: (2999 * 3000) / 2 }]);
    expect(ai.asked[1]?.seen).toEqual([]);
  });

  it("AU-198 · `bad-query`, `too-many`, `over-limit` and `outside-rows` are told to the model; a row that is not there and one the connection leaves out are told the same (AU-177)", async () => {
    // Only the open ones are read, so only they may be modified; one row created at most.
    const open = [{ field: state, op: "is", value: "abierta" }];
    const c = conn({
      read: { where: open as never },
      create: { ...YES, limit: 1, fields: [title, state] },
      update: { ...YES, fields: [title] },
    });
    const st = db(4);
    const [closed, opened] = st.rows(tasks.key).map((r) => r.origin?.id as string);
    const UPDATE = (sid: string, rid: string) =>
      call(sid, "update", {
        collection: lit(tasks.key),
        id: lit(rid),
        fields: obj(lit(title), lit("cambiada")),
      });
    const ai = scripted((r, n) =>
      n === 1
        ? plan(
            FIND("s1", { foo: 1 }),
            CREATE("s2"),
            CREATE("s3"),
            UPDATE("s4", closed as string),
            UPDATE("s5", "fila-que-no-existe"),
            UPDATE("s6", opened as string),
          )
        : plan(answer("s1", lit(JSON.stringify(r.rounds[0])))),
    );
    const { automation, id } = analyst({}, [c]);
    const e = await go(automation, { collections: st, ai: ai.port });
    expect(e.state).toBe("done");
    expect(ai.asked[1]?.rounds).toMatchObject([
      {
        s1: { refused: "bad-query" },
        s2: { planned: expect.any(String) },
        s3: { refused: "over-limit" },
        s4: { refused: "outside-rows" },
        s5: { refused: "outside-rows" },
        s6: { planned: expect.any(String) },
      },
    ]);
    expect(e.steps[id]?.writes?.kind).toBe("applied");

    // A read over the read limit of one read (`readBytes`): `too-many`.
    const long = store(
      [tasks, groups],
      {
        [tasks.key]: Array.from({ length: 3000 }, (_, i) => ({
          [title]: `${"x".repeat(1000)}${i}`,
        })),
        [groups.key]: [],
      },
      ids(174),
    );
    const many = scripted((r, n) =>
      n === 1 ? plan(FIND("s1", {})) : plan(answer("s1", lit(JSON.stringify(r.rounds[0])))),
    );
    const f = await go(analyst({}, [conn()]).automation, { collections: long, ai: many.port });
    expect(f.state).toBe("done");
    expect(many.asked[1]?.rounds).toEqual([{ s1: { refused: "too-many" } }]);
  });

  it("AU-205 · the policy's P29 on a read is told to the model; a collection made private fails the unit with `ai.private`", async () => {
    const deny = (reason: string) =>
      policy((call) =>
        call.effect === "read"
          ? { kind: "deny", rule: "P29", reason }
          : { kind: "allow", rule: "test.allow" },
      );
    const ai = scripted((r, n) =>
      n === 1 ? plan(FIND("s1")) : plan(answer("s1", lit(JSON.stringify(r.rounds[0])))),
    );
    const { automation, id } = analyst({}, [conn()]);
    const e = await go(automation, { collections: db(3), ai: ai.port, policy: deny("read-off") });
    expect(e.state).toBe("done");
    expect(ai.asked[1]?.rounds).toEqual([{ s1: { refused: "read-off" } }]);
    expect(e.steps[id]?.agent?.units[0]?.lines).toEqual([
      { op: "refused", tool: "find", collection: tasks.key, why: "read-off" },
    ]);

    const hidden = scripted(() => plan(FIND("s1")));
    const f = await go(automation, {
      collections: db(3),
      ai: hidden.port,
      policy: deny("private-collection"),
    });
    expect(f.state).toBe("failed");
    expect(f.error).toMatchObject({
      step: id,
      ai: { code: "ai.private", detail: { collection: tasks.key } },
    });
  });

  it("AU-198 · AU-161 · a no to a call made by code fails the unit, as in a «Código»: «Las hace este código» and a code tool, P29 included; a write the code asks for fails it (`code.write.unseen`)", async () => {
    const deny = (reason: string) =>
      policy((call) =>
        call.effect === "read"
          ? { kind: "deny", rule: "P29", reason }
          : { kind: "allow", rule: "test.allow" },
      );
    const reads = (job: Parameters<Parameters<typeof codeBox>[0][string]>[0]) =>
      "r" in job.reads
        ? { value: job.reads.r as Cell }
        : {
            needs: {
              key: "r",
              read: { collection: "tareas de ejemplo", op: "find" as const, limit: 3 },
            },
          };
    // «Las hace este código»: the model is never asked; P29 is the rule and its code, never told as a refusal.
    for (const [reason, code] of [
      ["read-off", "policy.denied"],
      ["private-collection", "ai.private"],
    ] as const) {
      const ai = scripted(() => plan(answer("s1")));
      const { automation, id } = analyst({ reads: "code", code: READS }, [conn()]);
      const e = await go(automation, {
        collections: db(3),
        ai: ai.port,
        box: codeBox({ [READS]: reads }),
        collectionNamed: named,
        policy: deny(reason),
      });
      expect(e.state, reason).toBe("failed");
      expect(e.error?.step).toBe(id);
      expect(JSON.stringify(e.error), reason).toContain(code);
      expect(ai.asked, reason).toHaveLength(0);
    }

    // A code tool: the model called it, but its read is code's, and P29 fails the unit as well.
    const tool = { name: "leer", inputs: [], code: COUNT };
    const asked = scripted(() => plan(call("s1", "leer", {})));
    const t = analyst({ tools: [tool] as never }, [conn()]);
    const f = await go(t.automation, {
      collections: db(3),
      ai: asked.port,
      box: codeBox({ [COUNT]: reads }),
      collectionNamed: named,
      policy: deny("read-off"),
    });
    expect(f.state).toBe("failed");
    expect(JSON.stringify(f.error)).toContain("policy.denied");
    expect(asked.asked).toHaveLength(1);

    // A write the code asks for, though validation refuses one (`agent.reads.write`): the run's guard fails it.
    const writes = codeBox({
      [READS]: () => ({
        value: [],
        writes: [{ collection: "tareas de ejemplo", action: "create" }],
      }),
    });
    const w = analyst({ reads: "code", code: READS }, [
      conn({ create: { ...YES, fields: [title] } }),
    ]);
    const st = db(3);
    const g = await go(w.automation, {
      collections: st,
      ai: scripted(() => plan(answer("s1"))).port,
      box: writes,
      collectionNamed: named,
    });
    expect(g.state).toBe("failed");
    expect(g.error?.why).toMatchObject({
      code: "code.write.unseen",
      detail: { where: "agent" },
    });
    expect(st.rows(tasks.key)).toHaveLength(3);
  });

  it("AU-200 · an «Agente» whose connection reads a collection with values from outside saves «con datos de fuera» with «Sí», and not with «Preguntar»", () => {
    const of = (create: typeof YES | typeof ASK) =>
      abilities(analyst({}, [conn({ create: { ...create, fields: [title] } })]).automation, {
        collectionNamed: (n) => n,
        outside: new Set([tasks.key]),
      }).find((a) => a.action === "create");
    expect(of(YES)).toMatchObject({ how: "saves", outside: true, byAgent: true });
    expect(of(ASK)).not.toHaveProperty("outside");
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
