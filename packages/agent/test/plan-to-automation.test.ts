// The translator from the plan language to an automation (docs/automatizaciones.md §5.12 and §5.13, phase F16):
// one function with three uses (the conversion of the saved flows, a turn's plan, «Guardar como automatización»),
// its table with a row for everything the language can say, and the proof that what it makes does the same
// (AU-143, AU-223, AU-224).
//
// The tests walk the language itself (the operations, `READERS`, the ask controls, `REPLY_COMPONENTS`, `FNS`, the
// triggers and every action of the list), so a new piece of it cannot arrive without its row; they check each
// function's expression against the function of before on the same values, the shape of `when`, `each` and `zip`, and
// run converted flows on the new engine with collections shaped like a user's (generated keys and ids) and no model.
// Still pending: the differential test against the old engine's dry run (S1 builds it with the server's ports).

import {
  type Automation,
  BONI_ACTION_TYPE,
  BONI_PIECES,
  BONI_READER_TYPE,
  BONI_TRIGGERS,
  type CodeContext,
  lowerYes,
  NOTIFY_TYPE,
  REPLY_TYPE,
  run,
  validate,
} from "@boni/automations";
import { label } from "@boni/entities";
import { describe, expect, it } from "vitest";
import { clock, policy, store } from "../../automations/src/run.test-util.ts";
import {
  CHANGES,
  FN_JS,
  LANGUAGE,
  planToAutomation,
  TRANSLATION,
  TRIGGER_NAMES,
  UNTRANSLATED_REASONS,
} from "../src/convert.ts";
import { callFn } from "../src/fns.ts";
import { type Plan, validatePlan } from "../src/plan.ts";
import { coreTools } from "../src/tools.ts";
import { type Json, leaf, list, plain, rec, type Val } from "../src/values.ts";
import {
  jsBox,
  NOTE_TEXT,
  NOTE_TITLE,
  NOTES,
  next,
  TASK_HOURS,
  TASK_STATE,
  TASK_TITLE,
  TASKS,
} from "./convert.test-util.ts";

const lit = (v: unknown) => ({ lit: v });
const ref = (r: string) => ({ ref: r });
const fn = (name: string, ...args: unknown[]) => ({ fn: name, args });
const plan = (...steps: unknown[]) => ({ version: 1, steps }) as Plan;
const convert = (p: Plan, trigger: unknown = { manual: true }, extra: object = {}) =>
  planToAutomation({
    id: "e_flujo_ejemplo",
    name: "Revisar pendientes",
    plan: p,
    trigger,
    from: "flow",
    ...extra,
  });

/** What validation knows when the run has the box, a model, people and Boni's code. */
const context = (automation?: (typeof BONI_PIECES)[number]["owner"]): CodeContext => ({
  collection: (k) => [TASKS, NOTES].find((c) => c.key === k),
  collectionNamed: () => undefined,
  ai: true,
  people: true,
  boni: automation ? { automation } : {},
});
const stepIds = (a: Automation) => a.steps.map((s) => s.id);
const arrowsTo = (a: Automation, step: string) =>
  a.arrows
    .filter((x) => x.to.step === step)
    .map((x) => `${x.from.step}:${x.from.output}>${x.to.input}`);

describe("a plan translated to an automation (F16)", () => {
  it("AU-223 · every operation, reader, ask control, reply component, function, trigger and action of the plan language has its row: a step, or a name for what has none", () => {
    const rows: [string, readonly string[]][] = [
      ["op", LANGUAGE.ops],
      ["form", LANGUAGE.forms],
      ["atom", LANGUAGE.atoms],
      ["reader", LANGUAGE.readers],
      ["ask", LANGUAGE.asks],
      ["reply", LANGUAGE.replies],
      ["fn", LANGUAGE.fns],
      ["trigger", LANGUAGE.triggers],
    ];
    for (const [kind, names] of rows)
      for (const n of names) expect(TRANSLATION[`${kind}:${n}`], `${kind}:${n}`).toBeTruthy();
    // Every action of the list: its own row, or «Acción de Boni».
    for (const tool of coreTools().names())
      expect(TRANSLATION[`tool:${tool}`] ?? TRANSLATION["tool:*"], tool).toBeTruthy();
    expect(TRANSLATION["tool:*"]).toBe(BONI_ACTION_TYPE);
    for (const p of BONI_PIECES)
      expect(Object.values(TRANSLATION).join(" "), p.type).toContain(p.type);

    // And nothing is dropped: one step of each makes its step, or says why it has none, by its step.
    const said = (p: Plan, extra: object = {}) => {
      const c = convert(p, { manual: true }, extra);
      const made = stepIds(c.automation).includes("p-x");
      const why = c.untranslated.filter((u) => u.step === "x");
      expect(made || why.length > 0, JSON.stringify(p.steps[0])).toBe(true);
      for (const u of c.untranslated) expect(UNTRANSLATED_REASONS).toContain(u.reason);
      return c;
    };
    for (const tool of coreTools().names()) said(plan({ id: "x", op: "call", tool, args: {} }));
    for (const reader of LANGUAGE.readers)
      said(plan({ id: "x", op: "read", reader, input: lit("Un texto de ejemplo") }));
    for (const control of LANGUAGE.asks)
      said(plan({ id: "x", op: "ask", control, prompt: lit("¿Seguimos?") }));
    for (const component of LANGUAGE.replies)
      said(plan({ id: "x", op: "reply", component, data: { template: lit("Hecho") } }));
    said({ version: 1, steps: [{ id: "x", op: "agent", instructions: "", actions: [] }] } as never);
    // A piece is its step in its own automation, and says so in any other (a copy loses it, AU-127).
    for (const p of BONI_PIECES) {
      const step =
        p.old === "entities.create"
          ? {
              id: "x",
              op: "call",
              tool: p.old,
              args: p.params.length
                ? { type: lit(TASKS.key), values: fn("obj") }
                : { type: fn("case", lit("a"), lit("a"), lit(TASKS.key)), values: fn("obj") },
            }
          : (LANGUAGE.readers as readonly string[]).includes(p.old)
            ? { id: "x", op: "read", reader: p.old, input: lit("Un texto") }
            : { id: "x", op: "call", tool: p.old, args: {} };
      const own = said(plan(step), { boni: p.owner, decides: [TASKS.key, NOTES.key] });
      expect(own.automation.steps.find((s) => s.id === "p-x")?.type, p.type).toBe(p.type);
      if (p.old !== "entities.create" && p.old !== "classify" && p.old !== "fill") {
        const other = said(plan(step));
        expect(
          other.untranslated.map((u) => u.reason),
          p.type,
        ).toContain("pieceNotHere");
      }
    }
    for (const r of ["extract_tasks", "answer_about"]) {
      const c = said(plan({ id: "x", op: "read", reader: r, input: lit("Un texto") }));
      expect(c.automation.steps.find((s) => s.id === "p-x")?.type).toBe(BONI_READER_TYPE);
    }
  });

  it("AU-223 · each function of the plan language is one expression that gives what the function of before gave, on the same values", () => {
    const J = label("user", "personal", [{ kind: "flow", id: "e_ejemplo" }]);
    const val = (j: Json): Val =>
      Array.isArray(j)
        ? list(j.map(val), J)
        : j !== null && typeof j === "object"
          ? rec(Object.fromEntries(Object.entries(j).map(([k, v]) => [k, val(v)])), J)
          : leaf(j, J);
    const today = "2026-11-18";
    const evalJs = (src: string): unknown => {
      const dateOf = (d: string): object => ({
        toDay: () => d,
        plus: ({ days }: { days: number }) =>
          dateOf(
            new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10),
          ),
      });
      return new Function("$today", "$date", `"use strict"; return (${src});`)(
        dateOf(today),
        dateOf,
      );
    };
    const cases: Record<string, Json[][]> = {
      count: [[[1, 2, 3]], [[]]],
      sum: [[[1.1, 2.25]], [[{ h: 2 }, { h: 3.5 }], "h"], [[{ amount: 1.105 }, { amount: 2 }]]],
      min: [[[3, 1, 2]], [[{ h: 2 }, { h: 0.5 }], "h"]],
      max: [[[3, 1, 2]], [[{ h: 2 }, { h: 0.5 }], "h"]],
      pick: [
        [{ a: 1 }, "a"],
        [{ a: 1 }, "b"],
      ],
      item: [
        [[5, 6], 1],
        [[5], 3],
      ],
      field: [[[{ a: 1 }, { a: 2 }, {}], "a"]],
      filter_eq: [[[{ s: "x" }, { s: "y" }, { s: "x" }], "s", "x"]],
      first: [
        [null, "", "b"],
        [null, false],
      ],
      concat: [["a", 1, null, true]],
      list: [[1, "a", null]],
      obj: [["a", 1, "b", 2]],
      case: [
        ["b", "a", 1, "b", 2],
        ["z", "a", 1],
      ],
      merge: [[{ a: 1, b: "" }, { c: 2 }]],
      length: [["ábc"], [[1, 2]]],
      eq: [
        [{ a: 1 }, { a: 1 }],
        [1, "1"],
      ],
      ne: [[{ a: 1 }, { a: 2 }]],
      gt: [
        [3, 2],
        [1, { amount: 2 }],
      ],
      lt: [
        [3, 2],
        [1, 2],
      ],
      and: [
        [1, [1]],
        [1, []],
      ],
      or: [
        [0, ""],
        [0, "x"],
      ],
      not: [[[]], ["x"]],
      today: [[]],
      add_days: [
        ["2026-11-18", 3],
        ["2026-12-30", 5],
      ],
    };
    expect(Object.keys(cases).sort()).toEqual([...LANGUAGE.fns].sort());
    for (const [name, all] of Object.entries(cases))
      for (const args of all) {
        const before = plain(callFn(name, args.map(val), today));
        const now = evalJs(
          (FN_JS[name as keyof typeof FN_JS] as (a: string[]) => string)(
            args.map((a) => JSON.stringify(a)),
          ),
        );
        expect(now, `${name}(${JSON.stringify(args)})`).toEqual(before);
      }
    // What stopped a function of before stops the step now: a text where a number or a list was.
    for (const [name, args] of [
      ["gt", ["3", 2]],
      ["count", ["abc"]],
      ["sum", [[1, "x"]]],
    ] as const) {
      expect(() => callFn(name, (args as unknown as Json[]).map(val), today)).toThrow();
      expect(() =>
        evalJs((FN_JS[name] as (a: string[]) => string)(args.map((a) => JSON.stringify(a)))),
      ).toThrow();
    }
  });

  it("AU-223 · a step that ran once still runs once whatever rows reach it, a `when` hangs from a «Si», an `each` is the work per row and a `zip` a «Combinar» by position", async () => {
    const flow = plan(
      {
        id: "q",
        op: "call",
        tool: "entities.query",
        args: { type: lit(TASKS.key), field: lit(TASK_STATE), equals: lit("pendiente") },
      },
      {
        id: "c",
        op: "call",
        tool: "entities.create",
        each: ref("$q"),
        when: ref("$q"),
        args: {
          type: lit(NOTES.key),
          values: fn(
            "obj",
            lit(NOTE_TITLE),
            fn("concat", lit("Revisar: "), ref(`$item.${TASK_TITLE}`)),
            lit(NOTE_TEXT),
            ref("$tema"),
          ),
        },
      },
      {
        id: "n",
        op: "call",
        tool: "entities.aggregate",
        args: { type: lit(TASKS.key), op: lit("sum"), of: lit(TASK_HOURS) },
      },
    );
    const c = convert(flow, { manual: true, inputs: [{ name: "tema" }] });
    expect(c.untranslated).toEqual([]);
    expect(c.complete).toBe(true);
    const a = c.automation;
    expect(validate(a, context())).toEqual([]);
    // The trigger, with the input it asks; the find; the create guarded and walked; the sum.
    expect(a.steps[0]).toMatchObject({ id: "trigger", type: "manual", name: TRIGGER_NAMES.manual });
    expect(stepIds(a)).toEqual([
      "trigger",
      "p-q",
      "p-c-join",
      "p-c-cond",
      "p-c-if",
      "p-c-items",
      "p-c-split",
      "p-c",
      "p-n-join",
      "p-n",
    ]);
    // A find gives many rows: «Juntar en una» before what ran once.
    expect(arrowsTo(a, "p-c-join")).toEqual(["p-q:main>main"]);
    // «Solo si»: the step hangs from «sí»; what followed, from both ways, and from the list when it is empty.
    expect(arrowsTo(a, "p-c-items")).toEqual(["p-c-if:yes>main"]);
    expect(arrowsTo(a, "p-n-join").sort()).toEqual([
      "p-c-if:no>main",
      "p-c-items:main>main",
      "p-c:main>main",
    ]);
    expect(a.steps.find((s) => s.id === "p-c")?.settings).toEqual({ continueEmpty: true });
    expect(a.steps.find((s) => s.id === "p-n")?.settings).toEqual({
      continueEmpty: true,
      firstRowOnly: true,
    });
    expect(a.steps.find((s) => s.id === "p-c-split")?.settings).toEqual({ continueEmpty: false });

    // Run it: three pending tasks, one done.
    const rows = (n: number) => [
      ...Array.from({ length: n }, (_, i) => ({
        [TASK_TITLE]: `Tarea de ejemplo ${i + 1}`,
        [TASK_STATE]: "pendiente",
        [TASK_HOURS]: i + 1,
      })),
      { [TASK_TITLE]: "Tarea hecha", [TASK_STATE]: "hecha", [TASK_HOURS]: 5 },
    ];
    for (const n of [3, 0]) {
      const s = store([TASKS, NOTES], { [TASKS.key]: rows(n) }, next);
      const p = policy();
      const e = await run(
        {
          automation: a,
          trigger: "trigger",
          fields: { json: { tema: "Ejemplo" }, label: label("user", "personal", []) },
          test: false,
        },
        {
          policy: p,
          collections: s,
          clock: clock(),
          dates: (await import("../../automations/src/run.test-util.ts")).dates,
          own: label("user", "personal", []),
          locale: "es",
          box: jsBox(),
        },
      );
      expect(e.state, JSON.stringify(e.error ?? null)).toBe("done");
      // Each read once, whatever the rows; the sum after the writes, as before.
      expect(s.calls.map((x) => `${x.method}:${x.collection}`)).toEqual([
        `find:${TASKS.key}`,
        `aggregate:${TASKS.key}`,
      ]);
      // Every write proposed (AU-230): one per pending task, none saved.
      expect(s.applied).toEqual([]);
      expect(e.asked.map((x) => x.values[NOTE_TITLE]?.value)).toEqual(
        Array.from({ length: n }, (_, i) => `Revisar: Tarea de ejemplo ${i + 1}`),
      );
      expect(e.steps["p-n"]?.out.main?.[0]?.json).toEqual({
        [`sum_${TASK_HOURS}`]: (n * (n + 1)) / 2 + 5,
      });
    }

    // «Junto con»: a «Combinar» by position of the list and what the zipped step gave for each.
    const zipped = convert(
      plan(
        { id: "q", op: "call", tool: "entities.query", args: { type: lit(TASKS.key) } },
        {
          id: "r",
          op: "read",
          reader: "summarize",
          each: ref("$q"),
          input: ref(`$item.${TASK_TITLE}`),
        },
        {
          id: "c",
          op: "call",
          tool: "entities.create",
          each: ref("$q"),
          zip: ref("$r"),
          args: {
            type: lit(NOTES.key),
            values: fn(
              "obj",
              lit(NOTE_TITLE),
              ref(`$item.${TASK_TITLE}`),
              lit(NOTE_TEXT),
              ref("$zip.text"),
            ),
          },
        },
      ),
    );
    expect(zipped.untranslated).toEqual([]);
    const z = zipped.automation;
    expect(z.steps.find((s) => s.id === "p-c-zip")).toMatchObject({
      type: "combine",
      params: { by: "position", keep: "a" },
    });
    expect(arrowsTo(z, "p-c-zip").sort()).toEqual(["p-c-split:main>a", "p-r:main>b"]);
    expect(JSON.stringify(z.steps.find((s) => s.id === "p-c")?.params)).toContain("$json.resumen");
    expect(validate(z, context())).toEqual([]);
  });

  it.todo(
    "AU-224 · with the same inputs and the same scripted model answers, the converted automation makes the same reader calls, the same reads and asks the policy for the same writes, in the same order and with the same labels",
  );

  it("AU-224 · where the new step is tighter or behaves differently, the conversion says it as «Lo que cambia», from a closed list of sentences", () => {
    const writes = plan({
      id: "c",
      op: "call",
      tool: "entities.create",
      args: { type: lit(NOTES.key), values: fn("obj", lit(NOTE_TITLE), lit("Nota de ejemplo")) },
    });
    const reads = plan({
      id: "s",
      op: "read",
      reader: "summarize",
      input: lit("Un texto de ejemplo"),
    });
    // By his hand, it wrote alone; now it asks. Every write of a run is undone whole; its limits are an automation's.
    expect(convert(writes).changes).toEqual(["asksNow", "undoWhole", "automationLimits"]);
    // Started by the clock, it already asked (P7): only what is undone and the limits change.
    expect(convert(writes, { schedule: { every: "day" } }).changes).toEqual([
      "undoWhole",
      "automationLimits",
    ]);
    expect(convert(reads).changes).toEqual(["textsCut", "automationLimits"]);
    // A flow's `classify` was the decider's, asked in both orders; «Clasificar» is the reader's (task 130 S1).
    const classifies = plan({
      id: "k",
      op: "read",
      reader: "classify",
      input: lit("Un texto de ejemplo"),
      params: { options: lit(["a", "b"]) },
    });
    expect(convert(classifies).changes).toEqual([
      "textsCut",
      "readerClassifies",
      "automationLimits",
    ]);
    // A turn keeps the turn's limits (AU-143).
    expect(
      planToAutomation({
        id: "e_turno",
        name: "Turno",
        plan: reads,
        trigger: undefined,
        from: "turn",
      }).changes,
    ).toEqual(["textsCut"]);
    for (const p of [writes, reads, classifies])
      for (const ch of convert(p).changes) expect(CHANGES).toContain(ch);
  });

  it("AU-143 · a turn's plan is validated as today and translated by the same function, every «Sí» lowered and what Juan wrote kept as his", () => {
    const given = {
      version: 1,
      steps: [
        {
          id: "q",
          op: "call",
          tool: "entities.query",
          args: { type: lit(TASKS.key), field: lit(TASK_TITLE), contains: { quote: "ejemplo" } },
        },
        {
          id: "c",
          op: "call",
          tool: "entities.create",
          args: {
            type: lit(NOTES.key),
            values: fn(
              "obj",
              lit(NOTE_TITLE),
              fn("concat", lit("Encontradas: "), fn("count", ref("$q"))),
            ),
          },
        },
      ],
    };
    const checked = validatePlan(given, coreTools(), "busca las tareas de ejemplo");
    expect(checked.ok).toBe(true);
    const c = planToAutomation({
      id: "e_turno",
      name: "Turno",
      plan: given as unknown as Plan,
      trigger: undefined,
      from: "turn",
    });
    expect(c.untranslated).toEqual([]);
    expect(c.automation.steps[0]).toMatchObject({ type: "manual", params: { fields: [] } });
    expect(c.automation.steps.find((s) => s.id === "p-q")?.params.where).toEqual([
      { field: TASK_TITLE, op: "contains", value: "ejemplo" },
    ]);
    expect(c.automation.steps.find((s) => s.id === "p-c")?.params.permission).toBe("ask");
    expect(lowerYes(c.automation)).toEqual(c.automation);
    // In a flow, a quote is what only a turn says.
    expect(convert(given as unknown as Plan).untranslated).toEqual([
      { step: "q", what: "atom:quote", reason: "turnOnly" },
    ]);
  });

  it.todo(
    "AU-143 · a turn's plan is validated as today, translated by the same function and saved as a draft by «Guardar como automatización», every «Sí» lowered",
  );

  it("AU-220 · each trigger of before is its step: by hand with its inputs, the clock with its rule, the mail, the mailbox, the decisions, the spending and the chat", () => {
    const empty = plan();
    const t = (trigger: unknown, boni?: (typeof BONI_PIECES)[number]["owner"]) =>
      planToAutomation({
        id: "e_x",
        name: "x",
        plan: empty,
        trigger,
        from: "flow",
        ...(boni ? { boni } : {}),
      }).automation.steps[0];
    expect(t({ manual: true, inputs: [{ name: "mes" }] })).toMatchObject({
      type: "manual",
      params: { fields: [{ key: "mes", name: "mes", type: "text" }] },
    });
    expect(t({ schedule: { every: "week", at: "07:30", day: 0 } })).toMatchObject({
      type: "schedule",
      params: { rules: [{ every: "week", at: "07:30", day: "sunday" }] },
    });
    expect(t({ schedule: { every: "day" } })).toMatchObject({
      params: { rules: [{ every: "day", at: "08:00" }] },
    });
    expect(t({ created: "correo" })?.type).toBe(BONI_TRIGGERS.mail);
    expect(t({ connector: "mail" }, "fetchMail")?.type).toBe(BONI_TRIGGERS.mailbox);
    expect(t({ learning: "mail" }, "reviewGuide")?.type).toBe(BONI_TRIGGERS.decisions);
    expect(t({ spending: "warn" }, "budgetNotice")?.type).toBe(BONI_TRIGGERS.spending);
    expect(
      t({
        chat: {
          page: "e_pagina_ejemplo",
          welcome: "Hola",
          buttons: [{ label: "Resumen", text: "Resume la página" }],
        },
      }),
    ).toMatchObject({
      type: BONI_TRIGGERS.chat,
      params: {
        page: "e_pagina_ejemplo",
        welcome: "Hola",
        buttons: [{ label: "Resumen", text: "Resume la página" }],
      },
    });
    // «Cada cuántas decisiones»: kept within the step's limits; outside them it is said and the step keeps its own.
    const learning = (every: number) =>
      planToAutomation({
        id: "e_x",
        name: "x",
        plan: empty,
        trigger: { learning: "mail", every },
        from: "flow",
        boni: "reviewGuide",
      });
    expect(learning(80).automation.steps[0]?.params.every).toBe(80);
    for (const every of [3, 9999]) {
      const c = learning(every);
      expect(c.automation.steps[0]?.params.every).toBeUndefined();
      expect(c.untranslated).toEqual([
        { step: null, what: "trigger:decisions.every", reason: "notExpressible" },
      ]);
      expect(validate(c.automation, context("reviewGuide"))).toEqual([]);
    }
    for (const tr of LANGUAGE.triggers) expect(TRANSLATION[`trigger:${tr}`]).toBeTruthy();
  });

  it("AU-223 · the same plan gives the same document, byte for byte, and translating never throws on what it does not know", () => {
    const p = plan(
      { id: "q", op: "call", tool: "entities.query", args: { type: lit(TASKS.key) } },
      {
        id: "u",
        op: "call",
        tool: "entities.update",
        args: { id: ref("$q[0].id"), values: fn("obj") },
      },
      {
        id: "w",
        op: "call",
        tool: "otra.accion",
        args: { texto: ref("$q") },
        why: lit("Porque sí"),
      },
      { id: "k", op: "ask", control: "number", prompt: lit("¿Cuántas?") },
    );
    const one = JSON.stringify(convert(p));
    expect(JSON.stringify(convert(p))).toBe(one);
    const c = convert(p);
    expect(c.complete).toBe(false);
    expect(c.untranslated).toEqual([
      { step: "u", what: "tool:entities.update", reason: "noCollection" },
      { step: "k", what: "ask:number", reason: "laterPhase" },
    ]);
    // «Acción de Boni» keeps its action, its arguments and its why; and it validates only where Boni's code is reached.
    expect(c.automation.steps.find((s) => s.id === "p-w")).toMatchObject({
      type: BONI_ACTION_TYPE,
      params: { action: "otra.accion", why: "Porque sí" },
    });
    expect(validate(c.automation, context())).toEqual([]);
    expect(validate(c.automation, { ...context(), boni: undefined }).map((x) => x.code)).toContain(
      "step.unknownType",
    );
    // Shapes no checked plan has: each is said as what it is, and the steps around it are kept.
    const odd = convert({
      version: 1,
      steps: [
        { id: "q", op: "call", tool: "entities.query", args: { type: lit(TASKS.key) } },
        { id: "a", op: "call", tool: "entities.create" },
        { id: "b", op: "read" },
        null,
        { id: "r", op: "reply", component: "text", data: { template: lit("Hecho") } },
      ],
    } as unknown as Plan);
    expect(odd.untranslated.map((x) => [x.step, x.what])).toEqual([
      ["a", "op:call"],
      ["b", "reader:undefined"],
      [null, "op:?"],
    ]);
    expect(odd.automation.steps.map((s) => s.id)).toEqual(["trigger", "p-q", "p-r-join", "p-r"]);
    expect(() => convert({} as unknown as Plan)).not.toThrow();
  });

  it("AU-230 · «Avisar» and «Responder», translated, have no recipient: only their text, and where on Juan's own devices", () => {
    const c = convert(
      plan(
        { id: "n", op: "call", tool: "notify", args: { text: lit("Aviso de ejemplo") } },
        {
          id: "r",
          op: "reply",
          component: "text",
          data: { template: lit("Respuesta de ejemplo") },
        },
      ),
    );
    const n = c.automation.steps.find((s) => s.id === "p-n");
    const r = c.automation.steps.find((s) => s.id === "p-r");
    expect(n?.type).toBe(NOTIFY_TYPE);
    expect(r?.type).toBe(REPLY_TYPE);
    expect(Object.keys(n?.params ?? {}).every((k) => ["text", "mode", "where"].includes(k))).toBe(
      true,
    );
    expect(Object.keys(r?.params ?? {})).toEqual(["text"]);
  });
});
