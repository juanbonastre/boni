// The limits of one run (docs/automatizaciones.md §5.2, AU-17; phase F14d): four named numbers, each with its default
// and its ceiling, checked by the engine before a step starts and before a step's change is asked or written. Real
// tests over the fakes of run.test-util.ts, with invented collections and generated keys; a «Código»'s change against
// the limit is writes.test.ts' («AU-17 · a «Código» whose change…»), where its box is.
import { clock as now, under } from "@boni/pace";
import { describe, expect, it } from "vitest";
import { cite, collection, ids, sketch } from "./automation.test-util.ts";
import type { Box } from "./box.ts";
import { CODE_TYPE } from "./code.ts";
import { newConnection } from "./connections.ts";
import type { CollectionShape } from "./effects.ts";
import { CannotRun, type Execution, LimitPassed, run } from "./engine.ts";
import {
  AUTOMATION_LIMITS,
  type Automation,
  FORMAT,
  limitsOf,
  type ParamValue,
  parseAutomation,
  RUN_LIMIT_KEYS,
  type RunLimits,
  type StepSettings,
} from "./format.ts";
import { clock, deps, type FakeStore, policy, start, store } from "./run.test-util.ts";
import { validate } from "./validate.ts";

const next = ids(17);
const things = collection(next, ["number", "text"]);
const [n, word] = things.fields.map((f) => f.key) as [string, string];

/** A list of `count` numbers as rows: a fixed list in one field, then «Separar» over it. */
const list = (count: number) => Array.from({ length: count }, (_, i) => i);

/** A «Colección» step that creates one row of `things` per row that arrives, with «Permiso» as given. */
const creates = (permission: "yes" | "ask" = "yes") => ({
  collection: things.key,
  action: "create",
  fields: [{ field: n, value: cite("$json.n") }],
  permission,
});

/**
 * «Inicio» → «Lista» (`count` numbers) → «Partir» → one «Colección» per entry of `writers`, each hanging from «Partir»,
 * in that order, with the run's limits as given.
 */
function writing(
  count: number,
  writers: { name: string; permission?: "yes" | "ask"; settings?: StepSettings }[],
  limits?: Partial<RunLimits>,
) {
  const s = sketch(3)
    .step("Inicio", "manual")
    .step("Lista", "edit", { fields: [{ field: "n", value: list(count) }] })
    .step("Partir", "split", { field: "n" })
    .arrow("Inicio", "Lista")
    .arrow("Lista", "Partir");
  for (const w of writers)
    s.step(w.name, "collection", creates(w.permission), w.settings).arrow("Partir", w.name);
  const a = s.build();
  return { s, a: limits ? { ...a, settings: { limits } } : a };
}

const db = (shapes: CollectionShape[] = [things], rows: Record<string, unknown>[] = []) =>
  store(shapes, { [things.key]: rows as never }, ids(18));
const writesAsked = (p: ReturnType<typeof policy>) => p.calls.filter((c) => c.effect === "write");
const errorOf = (e: Execution) => e.error?.failure;

describe("the limits of a run (F14d)", () => {
  it("AU-17 · each limit of a run (time, rows written, model calls, steps) is a named number with a default and a ceiling, and a document that asks for more than a ceiling does not validate (`limit.over`): it is never cut down silently", async () => {
    // Decision 12 of §10 (time, rows written) and the design's numbers (model calls, steps).
    expect(AUTOMATION_LIMITS).toEqual({
      ms: { default: 60_000, ceiling: 600_000 },
      rowsWritten: { default: 1_000, ceiling: 20_000 },
      modelCalls: { default: 20, ceiling: 40 },
      steps: { default: 200, ceiling: 1_000 },
    });
    expect([...RUN_LIMIT_KEYS].sort()).toEqual(Object.keys(AUTOMATION_LIMITS).sort());
    for (const k of RUN_LIMIT_KEYS)
      expect(AUTOMATION_LIMITS[k].default).toBeLessThanOrEqual(AUTOMATION_LIMITS[k].ceiling);

    const { a } = writing(1, [{ name: "Crear" }]);
    const context = { collection: (key: string) => (key === things.key ? things : undefined) };
    expect(validate(a, context)).toEqual([]);
    for (const k of RUN_LIMIT_KEYS) {
      const { ceiling } = AUTOMATION_LIMITS[k];
      // At the ceiling it validates and holds as written.
      const at = { ...a, settings: { limits: { [k]: ceiling } } };
      expect(validate(at, context), k).toEqual([]);
      expect(limitsOf(at)[k]).toBe(ceiling);
      // One over: an error of the automation that names the limit, its ceiling and the number asked.
      const over = { ...a, settings: { limits: { [k]: ceiling + 1 } } };
      expect(validate(over, context), k).toEqual([
        {
          code: "limit.over",
          severity: "error",
          param: `limits.${k}`,
          detail: { limit: k, max: ceiling, got: ceiling + 1 },
        },
      ]);
      // Read back as saved, the number is the one written, not the ceiling; and it does not run.
      const read = parseAutomation(JSON.parse(JSON.stringify({ ...over, format: FORMAT })));
      expect(read.settings.limits?.[k], k).toBe(ceiling + 1);
      await expect(start(over, writing(1, []).s.id("Inicio"))).rejects.toBeInstanceOf(CannotRun);
    }
  });

  it("AU-17 · a step whose change would pass «rows written» fails the run before the policy is asked and before any row is written, counting the rows that would be proposed as well as those that would be saved", async () => {
    const limit = { rowsWritten: 1_000 };
    // At the limit: all of them are saved.
    {
      const { a, s } = writing(1_000, [{ name: "Crear" }], limit);
      const st = db();
      const e = await start(a, s.id("Inicio"), {}, { collections: st });
      expect(e.state).toBe("done");
      expect(st.applied).toHaveLength(1_000);
    }
    // One over: not one, and the policy was never asked about a write.
    {
      const { a, s } = writing(1_001, [{ name: "Crear" }], limit);
      const st = db();
      const p = policy();
      const e = await start(a, s.id("Inicio"), {}, { collections: st, policy: p });
      expect(e.state).toBe("failed");
      expect(errorOf(e)).toEqual({
        code: "run.limit",
        detail: { limit: "rowsWritten", max: 1_000, got: 1_001 },
      });
      expect(e.error?.step).toBe(s.id("Crear"));
      expect(st.applied).toEqual([]);
      expect(writesAsked(p)).toEqual([]);
    }
    // Two steps that only pass it together: the first saves its 600, the second none of its own.
    {
      const { a, s } = writing(600, [{ name: "Uno" }, { name: "Dos" }], limit);
      const st = db();
      const p = policy();
      const e = await start(a, s.id("Inicio"), {}, { collections: st, policy: p });
      expect(e.steps[s.id("Uno")]?.state).toBe("done");
      expect(e.steps[s.id("Dos")]?.state).toBe("failed");
      expect(errorOf(e)?.detail).toEqual({ limit: "rowsWritten", max: 1_000, got: 1_200 });
      expect(st.applied).toHaveLength(600);
      expect(writesAsked(p)).toHaveLength(600);
    }
    // What «Preguntar» would propose counts as well: 600 proposed and 600 saved pass 1,000.
    {
      const { a, s } = writing(600, [{ name: "Uno", permission: "ask" }, { name: "Dos" }], limit);
      const st = db();
      const e = await start(a, s.id("Inicio"), {}, { collections: st });
      expect(e.asked).toHaveLength(600);
      expect(errorOf(e)?.detail).toEqual({ limit: "rowsWritten", max: 1_000, got: 1_200 });
      expect(st.applied).toEqual([]);
    }
    // A «Código» after a step that saved 600: its requests only pass it together with those, at 401 and not at 400.
    for (const [asks, passes] of [
      [400, false],
      [401, true],
    ] as const) {
      const { a, s } = writing(600, [{ name: "Uno" }], limit);
      a.steps.push({
        id: "s_codigo",
        name: "Código",
        type: CODE_TYPE,
        params: { mode: "all", source: "$col('Cosas').create({ a: 1 })\nreturn []" },
        connections: [{ ...newConnection(things.key), create: { mode: "yes" } }],
      });
      a.arrows.push({
        from: { step: s.id("Uno"), output: "main" },
        to: { step: "s_codigo", input: "main" },
      });
      const requests = Array.from({ length: asks }, (_, i) => ({
        collection: "Cosas",
        action: "create" as const,
        fields: { [n]: i },
      }));
      const box: Box = {
        run: async () => ({
          evaluations: [
            { state: "done", values: [[]], clock: false, random: false, writes: requests },
          ],
          console: [],
          dropped: 0,
          ms: 1,
        }),
      };
      const st = db();
      const p = policy();
      const e = await start(
        a,
        s.id("Inicio"),
        {},
        {
          collections: st,
          policy: p,
          box,
          collectionNamed: (x) => (x === "Cosas" ? things.key : undefined),
        },
      );
      if (passes) {
        expect(errorOf(e), String(asks)).toEqual({
          code: "run.limit",
          detail: { limit: "rowsWritten", max: 1_000, got: 1_001 },
        });
        expect(e.error?.step).toBe("s_codigo");
        expect(st.applied).toHaveLength(600);
        expect(writesAsked(p)).toHaveLength(600);
      } else {
        expect(e.state, JSON.stringify(e.error)).toBe("done");
        expect(st.applied).toHaveLength(1_000);
      }
    }
    // «Las que cumplan…» finds first and writes nothing when what it found would pass it.
    {
      const s = sketch(4)
        .step("Inicio", "manual")
        .step("Marcar", "collection", {
          collection: things.key,
          action: "update",
          target: "matching",
          where: [{ field: n, op: "gt", value: -1 }],
          fields: [{ field: word, value: "visto" }],
          permission: "yes",
        })
        .arrow("Inicio", "Marcar");
      const rows = list(1_001).map((i) => ({ [n]: i, [word]: "" }));
      for (const [count, fails] of [
        [1_000, false],
        [1_001, true],
      ] as const) {
        const st = db([things], rows.slice(0, count));
        const p = policy();
        const e = await start(
          { ...s.build(), settings: { limits: limit } },
          s.id("Inicio"),
          {},
          {
            collections: st,
            policy: p,
          },
        );
        expect(e.state, String(count)).toBe(fails ? "failed" : "done");
        expect(st.applied, String(count)).toHaveLength(fails ? 0 : count);
        expect(writesAsked(p), String(count)).toHaveLength(fails ? 0 : count);
        if (fails)
          expect(errorOf(e)?.detail).toEqual({ limit: "rowsWritten", max: 1_000, got: 1_001 });
      }
    }
  });

  it("AU-17 · the time and the steps are checked before each step starts, against the run's own clock: a run past its time starts no further step", async () => {
    // A step that takes 61 s of the run's clock (its read, here): the next does not start.
    const c = clock();
    const s = sketch(5)
      .step("Inicio", "manual")
      .step("Leer", "collection", { collection: things.key, action: "find" })
      .step("Crear", "collection", creates())
      .step("Después", "edit", { fields: [{ field: "x", value: 1 }] })
      .arrow("Inicio", "Leer")
      .arrow("Leer", "Crear")
      .arrow("Crear", "Después");
    const st = db([things], [{ [n]: 1, [word]: "" }]);
    const slow = policy((call) => {
      if (call.effect === "read") void c.sleep(61_000);
      return { kind: "allow", rule: "test.allow" };
    });
    const e = await start(
      s.build(),
      s.id("Inicio"),
      {},
      { collections: st, clock: c, policy: slow },
    );
    // «Leer» started in time and finished past it (a step in progress is not cut); «Crear» never started.
    expect(e.steps[s.id("Leer")]?.state).toBe("done");
    expect(e.steps[s.id("Crear")]?.state).toBe("failed");
    expect(e.steps[s.id("Después")]?.state).toBe("stopped");
    expect(errorOf(e)).toEqual({
      code: "run.limit",
      detail: { limit: "ms", max: 60_000, got: 61_000 },
    });
    expect(st.applied).toEqual([]);

    // Steps: with a limit of 2, the third step that would start is the one that stops it.
    const chain = sketch(6).step("Inicio", "manual");
    let before = "Inicio";
    for (const name of ["Uno", "Dos", "Tres", "Cuatro"]) {
      chain.step(name, "edit", { fields: [{ field: name, value: 1 }] }).arrow(before, name);
      before = name;
    }
    const two = await start(
      { ...chain.build(), settings: { limits: { steps: 2 } } },
      chain.id("Inicio"),
    );
    expect(["Uno", "Dos", "Tres", "Cuatro"].map((x) => two.steps[chain.id(x)]?.state)).toEqual([
      "done",
      "done",
      "failed",
      "stopped",
    ]);
    expect(errorOf(two)).toEqual({ code: "run.limit", detail: { limit: "steps", max: 2, got: 3 } });
    expect(two.error?.step).toBe(chain.id("Tres"));
  });

  it("AU-17 · a limit stops the whole run whatever the step's «Si falla» says («Seguir», «Salir por error»), and what earlier steps wrote stays, to be undone from the run", async () => {
    for (const onError of ["continue", "errorOutput"] as const) {
      const { a, s } = writing(
        600,
        [
          { name: "Uno" },
          { name: "Dos", settings: { onError, retry: { times: 3, waitMs: 1_000 } } },
        ],
        { rowsWritten: 1_000 },
      );
      const c = clock();
      const st = db();
      const e = await start(a, s.id("Inicio"), {}, { collections: st, clock: c });
      expect(e.state, onError).toBe("failed");
      expect(errorOf(e)?.code, onError).toBe("run.limit");
      const dos = e.steps[s.id("Dos")];
      expect(dos?.state, onError).toBe("failed");
      // No retry, no row by «error», nothing counted as a row that failed and went on.
      expect(dos?.retries, onError).toBe(0);
      expect(c.slept, onError).toEqual([]);
      expect(dos?.out.error ?? [], onError).toEqual([]);
      expect(dos?.failed, onError).toBe(0);
      // What «Uno» saved stays: its 600 changes are in the store, made by this run (AU-18 undoes them).
      expect(st.applied, onError).toHaveLength(600);
    }
  });

  it("AU-17 · stopping by a limit says which one, its number and the number reached (`run.limit`), in a test as in a real run, and the words name the setting to change", async () => {
    const { a, s } = writing(3_000, [{ name: "Crear" }]);
    const answers: unknown[] = [];
    for (const test of [false, true]) {
      const st = db();
      const p = policy();
      const e = await run(
        { automation: a, trigger: s.id("Inicio"), fields: { json: {}, label: deps().own }, test },
        deps({ collections: st, policy: p }),
      );
      expect(e.test).toBe(test);
      expect(st.applied).toEqual([]);
      expect(writesAsked(p)).toEqual([]);
      answers.push(e.error);
    }
    // The same in both: the step, the code, the limit's key (the setting «Cambiar el límite» opens) and both numbers.
    expect(answers[0]).toEqual(answers[1]);
    expect(answers[0]).toMatchObject({
      step: s.id("Crear"),
      failure: { code: "run.limit", detail: { limit: "rowsWritten", max: 1_000, got: 3_000 } },
    });
    const limit = (answers[0] as Execution["error"])?.failure?.detail?.limit;
    expect(RUN_LIMIT_KEYS as readonly unknown[]).toContain(limit);
    // The engine's own error says it too, for the log.
    const fault = new LimitPassed("rowsWritten", 1_000, 3_000);
    expect(fault.message).toContain("rowsWritten");
    // The words, «Paró: iba a escribir 3.000 filas y el límite son 1.000 · Cambiar el límite», are boni-web's
    // (`words.test.ts`, «AU-17 · …»).
  });

  it("AU-17 · «Las que cumplan…» with several rows arriving finds and writes one unit after another, and a later unit finds what an earlier one saved: so its rows cannot be counted before the first saves, and a limit passed in a later unit leaves what the earlier units saved or proposed, to be undone from the run (AU-18)", async () => {
    // Each row that arrives moves the rows whose number is its own to the next: «0» to «1», then «1» to «2».
    const marking = (permission: "yes" | "ask", where: ParamValue) =>
      sketch(19)
        .step("Inicio", "manual")
        .step("Lista", "edit", {
          fields: [
            {
              field: "n",
              value: [
                { from: 0, to: 1 },
                { from: 1, to: 2 },
              ],
            },
          ],
        })
        .step("Partir", "split", { field: "n" })
        .step("Mover", "collection", {
          collection: things.key,
          action: "update",
          target: "matching",
          where,
          fields: [{ field: n, value: cite("$json.n.to") }],
          permission,
        })
        .arrow("Inicio", "Lista")
        .arrow("Lista", "Partir")
        .arrow("Partir", "Mover");
    const own = [{ field: n, op: "is", value: cite("$json.n.from") }];
    expect(
      validate(marking("yes", own).build(), {
        collection: (key: string) => (key === things.key ? things : undefined),
      }),
    ).toEqual([]);
    const rows = Array.from({ length: 600 }, () => ({ [n]: 0, [word]: "" }));

    // With the limit raised, the second unit finds the 600 rows the first one saved: 1,200 rows written, where
    // finding before the first one saves would have counted 600.
    {
      const s = marking("yes", own);
      const st = db([things], rows);
      const e = await start(
        { ...s.build(), settings: { limits: { rowsWritten: 1_200 } } },
        s.id("Inicio"),
        {},
        { collections: st },
      );
      expect(e.state, JSON.stringify(e.error)).toBe("done");
      expect(st.applied).toHaveLength(1_200);
      expect(new Set(st.rows(things.key).map((r) => r.json[n]))).toEqual(new Set([2]));
    }
    // With the default 1,000, the second unit passes it before it writes any: the first one's 600 stay saved.
    {
      const s = marking("yes", own);
      const st = db([things], rows);
      const p = policy();
      const e = await start(s.build(), s.id("Inicio"), {}, { collections: st, policy: p });
      expect(e.error).toMatchObject({
        step: s.id("Mover"),
        failure: { code: "run.limit", detail: { limit: "rowsWritten", max: 1_000, got: 1_200 } },
      });
      expect(st.applied).toHaveLength(600);
      expect(writesAsked(p)).toHaveLength(600);
      expect(new Set(st.rows(things.key).map((r) => r.json[n]))).toEqual(new Set([1]));
      expect(e.asked).toEqual([]);
    }
    // With «Preguntar» nothing is saved, so each unit finds all 600: the first one's 600 proposals stay in the run's
    // `asked`, and the second one proposes none.
    {
      const s = marking("ask", [{ field: n, op: "gt", value: -1 }]);
      const st = db([things], rows);
      const e = await start(s.build(), s.id("Inicio"), {}, { collections: st });
      expect(e.error).toMatchObject({
        step: s.id("Mover"),
        failure: { code: "run.limit", detail: { limit: "rowsWritten", max: 1_000, got: 1_200 } },
      });
      expect(st.applied).toEqual([]);
      expect(e.asked).toHaveLength(600);
    }
  });

  it("AU-17 · all four limits hold whether or not the automation's settings show them: one with no step that writes still has its «rows written»", async () => {
    const reads: Automation = sketch(7)
      .step("Inicio", "manual")
      .step("Leer", "collection", { collection: things.key, action: "find" })
      .arrow("Inicio", "Leer")
      .build();
    expect(reads.settings).toEqual({});
    expect(limitsOf(reads)).toEqual({ ms: 60_000, rowsWritten: 1_000, modelCalls: 20, steps: 200 });
    // Only what it set changes; the rest keep their defaults.
    expect(limitsOf({ settings: { limits: { steps: 5 } } })).toEqual({
      ms: 60_000,
      rowsWritten: 1_000,
      modelCalls: 20,
      steps: 5,
    });

    // With nothing set, the default steps hold: of 201 steps after the trigger, the 201st does not start.
    const chain = sketch(8).step("Inicio", "manual");
    let before = "Inicio";
    for (let i = 1; i <= 201; i++) {
      const name = `Paso ${i}`;
      chain.step(name, "edit", { fields: [{ field: "i", value: i }] }).arrow(before, name);
      before = name;
    }
    const e = await start(chain.build(), chain.id("Inicio"));
    expect(e.steps[chain.id("Paso 200")]?.state).toBe("done");
    expect(e.error).toMatchObject({
      step: chain.id("Paso 201"),
      failure: { code: "run.limit", detail: { limit: "steps", max: 200, got: 201 } },
    });

    // And the default rows written, with Juan's volume: 3,000 rows that would be created save none, in its time.
    const { a, s } = writing(3_000, [{ name: "Crear" }]);
    expect(a.settings).toEqual({});
    const st: FakeStore = db();
    const t = now();
    const big = await start(a, s.id("Inicio"), {}, { collections: st });
    under(now() - t, 2_000, "clock", "3,000 rows stopped by «rows written» before any is written");
    expect(errorOf(big)?.detail).toEqual({ limit: "rowsWritten", max: 1_000, got: 3_000 });
    expect(st.applied).toEqual([]);
  });
});
