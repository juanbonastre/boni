// The steps that talk to the person, in the engine (docs/automatizaciones.md §5.10, phase F15 E4): «Preguntar»,
// «Avisar», «Responder», and a run that waits for an answer (AU-125, AU-201, AU-202, AU-203).
//
// They run the engine with its effects injected: a port that records what is notified and how many runs wait, the
// answers given to `resume`, and the fake clock of run.test-util (it moves only when a test moves it, so a wait of
// days is exact and no test bounds real time). No model is called: a reader's port is scripted. Collections are
// shaped like his (generated keys, D-14), samples invented.
import { label } from "@boni/entities";
import { describe, expect, it } from "vitest";
import { cite, collection, ids, sketch } from "./automation.test-util.ts";
import { outputsOf, PEOPLE_CATEGORY, paramsOf, specOf } from "./catalogue.ts";
import {
  type Answers,
  CannotRun,
  type Execution,
  type RunDeps,
  resume,
  run,
  type StepRecord,
} from "./engine.ts";
import { ACTION, type Automation, MAIN } from "./format.ts";
import {
  ANSWER_FIELD,
  ASK_TYPE,
  DAY_MS,
  NO_ANSWER,
  NOTIFY_TYPE,
  NOTIFY_WHERE,
  type Notice,
  type PeoplePort,
  REPLY_TYPE,
} from "./people.ts";
import type { Row } from "./rows.ts";
import { clock, deps, OUTSIDE, OWN, store } from "./run.test-util.ts";
import { validate } from "./validate.ts";

/** The label of Juan's hand on a personal device: what a tap or what he types carries. */
const HAND = label("user", "personal", [{ kind: "user-edit", id: "d_ejemplo" }]);

/** A port that keeps every notice and says how many runs of the automation already wait. */
function recorder(waiting = 0): PeoplePort & { sent: Notice[]; asked: number } {
  const port = {
    sent: [] as Notice[],
    asked: 0,
    async notify(n: Notice) {
      port.sent.push(structuredClone(n));
    },
    waiting() {
      port.asked++;
      return waiting;
    },
  };
  return port;
}

const next = ids(145);
/** Shaped like his: generated keys, a number and a text. */
const tasks = collection(next, ["number", "text"]);
const [amount, note] = tasks.fields.map((f) => f.key) as [string, string];
const ROWS = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ [amount]: i, [note]: `nota ${i}` }));
const db = (n: number) => store([tasks], { [tasks.key]: ROWS(n) }, ids(146));

/** «Disparado por el usuario» asking for two texts, so a test can bring something from outside with its label. */
const INICIO = {
  fields: [
    { key: "opciones", name: "Opciones", type: "text" },
    { key: "asunto", name: "Asunto", type: "text" },
  ],
} as never;

const startOf = (a: Automation) => a.steps[0]?.id as string;
const go = (
  automation: Automation,
  over: Partial<RunDeps>,
  opts: { test?: boolean; json?: Row["json"]; fields?: Row["fields"] } = {},
): Promise<Execution> =>
  run(
    {
      automation,
      trigger: startOf(automation),
      fields: {
        json: opts.json ?? {},
        label: OWN,
        ...(opts.fields ? { fields: opts.fields } : {}),
      },
      test: opts.test ?? false,
    },
    deps(over),
  );
/** Goes on with a waiting run, as the server would after a restart: from what it kept, read back. */
const goOn = (
  automation: Automation,
  kept: Execution,
  answers: Answers,
  over: Partial<RunDeps>,
): Promise<Execution> =>
  resume(
    { automation, trigger: kept.trigger, fields: { json: {}, label: OWN }, test: kept.test },
    deps(over),
    JSON.parse(JSON.stringify(kept)) as Execution,
    answers,
  );
const yes = (by = HAND) => ({ value: true, by });

/**
 * «Inicio» → «Buscar» (n rows) → «Preguntar» (these params) → «Después» (sets a field), and «Inicio» → «Aparte»
 * (does not depend on the answer).
 */
function asking(params: Record<string, unknown> = {}) {
  const s = sketch(147)
    .step("Inicio", "manual", INICIO)
    .step("Buscar", "collection", { collection: tasks.key, [ACTION]: "find", limit: 5000 })
    .step("Preguntar", ASK_TYPE, { question: "¿Las cierro?", answer: "yesNo", ...params } as never)
    .step("Después", "edit", { fields: [{ field: "visto", value: "sí" }] })
    .step("Aparte", "edit", { fields: [{ field: "aparte", value: "sí" }] })
    .arrow("Inicio", "Buscar")
    .arrow("Buscar", "Preguntar")
    .arrow("Preguntar", "Después")
    .arrow("Inicio", "Aparte");
  return { s, automation: s.build(), id: s.id("Preguntar"), after: s.id("Después") };
}

const rec = (e: Execution, id: string) => e.steps[id] as StepRecord;
const jsonOf = (e: Execution, id: string, out: string = MAIN) =>
  rec(e, id).out[out]?.map((r) => r.json);

describe("the people steps (F15)", () => {
  it("AU-125 · «Preguntar» has its three parameters and two outputs: the row with its answer, and «sin respuesta»", async () => {
    const spec = specOf(ASK_TYPE);
    expect(spec?.category).toBe(PEOPLE_CATEGORY);
    const step = (params: Record<string, unknown>) =>
      ({ id: "s_p", name: "Preguntar", type: ASK_TYPE, params }) as never;
    const shown = (params: Record<string, unknown>) =>
      paramsOf(step(params))
        .filter((p) => p.place === "shown")
        .map((p) => p.key);
    expect(shown({ answer: "yesNo" })).toEqual(["question", "via", "answer", "waitDays"]);
    expect(shown({ answer: "one" })).toEqual([
      "question",
      "via",
      "answer",
      "options",
      "waitDays",
    ]);
    expect(paramsOf(step({})).find((p) => p.key === "mode")?.place).toBe("option");
    expect(paramsOf(step({})).find((p) => p.key === "waitDays")?.default).toBe(1);
    expect(outputsOf(step({}))).toEqual([MAIN, NO_ANSWER]);

    // Only with a port that reaches Juan, and with a wait of 1 to 30 whole days and options that are texts.
    const { automation, id, after } = asking();
    const codes = (a: Automation, people = true) =>
      validate(a, { collection: (k) => (k === tasks.key ? tasks : undefined), people })
        .filter((p) => p.step === id)
        .map((p) => `${p.code}${p.param ? `:${p.param}` : ""}`);
    expect(codes(automation, false)).toContain("step.unknownType");
    expect(codes(automation)).toEqual([]);
    for (const [params, problem] of [
      [{ waitDays: 31 }, "param.value:waitDays"],
      [{ waitDays: 0.5 }, "param.value:waitDays"],
      [{ answer: "one" }, "param.required:options"],
      [{ answer: "one", options: [] }, "param.value:options"],
      [{ answer: "several", options: ["a", "a"] }, "param.value:options"],
      [{ waitDays: { expr: "{{ 3 }}" } }, "param.shape:waitDays"],
    ] as const)
      expect(codes(asking(params as never).automation)).toContain(problem);
    expect(
      codes(asking({ answer: "one", mode: "perRow", options: cite("$json.x") }).automation),
    ).toEqual([]);

    // Answered, its row comes out with `respuesta`; with no answer, by «sin respuesta», and with nothing connected
    // there the run ends and says so.
    const port = recorder();
    const kept = await go(automation, { people: port, collections: db(2) });
    const done = await goOn(
      automation,
      kept,
      { [id]: [yes()] },
      { people: port, collections: db(2) },
    );
    expect(done.state).toBe("done");
    expect(jsonOf(done, id)).toEqual(ROWS(2).map((r) => ({ ...r, [ANSWER_FIELD]: true })));
    expect(jsonOf(done, id, NO_ANSWER)).toEqual([]);
    const none = await goOn(
      automation,
      kept,
      { [id]: [null] },
      { people: port, collections: db(2) },
    );
    expect(none.state).toBe("done");
    expect(jsonOf(none, id, NO_ANSWER)).toEqual(ROWS(2));
    expect(rec(none, id).ask?.ended).toBe("noAnswer");
    expect(rec(none, after).state).toBe("skipped");
  });

  it("AU-125 · it asks once with all the rows; «Una vez por fila» with more than 20 rows fails before asking any", async () => {
    const once = asking();
    const e = await go(once.automation, { people: recorder(), collections: db(3) });
    expect(e.state).toBe("waiting");
    expect(rec(e, once.id).ask?.questions.map((q) => q.text)).toEqual(["¿Las cierro?"]);

    const each = asking({ mode: "perRow", question: { expr: `¿Cierro {{ $json.${note} }}?` } });
    const three = await go(each.automation, { people: recorder(), collections: db(3) });
    expect(rec(three, each.id).ask?.questions.map((q) => q.text)).toEqual([
      "¿Cierro nota 0?",
      "¿Cierro nota 1?",
      "¿Cierro nota 2?",
    ]);
    // Each row with its own answer, the ones not answered by «sin respuesta».
    const on = await goOn(
      each.automation,
      three,
      { [each.id]: [yes(), null, { value: false, by: HAND }] },
      { people: recorder(), collections: db(3) },
    );
    expect(jsonOf(on, each.id)?.map((r) => r[ANSWER_FIELD])).toEqual([true, false]);
    expect(jsonOf(on, each.id, NO_ANSWER)).toEqual([ROWS(3)[1]]);
    expect(rec(on, each.id).out[MAIN]?.map((r) => r.parent)).toEqual([0, 2]);

    // 21 questions: it fails before asking any, and asks the port nothing.
    const port = recorder();
    const many = await go(each.automation, { people: port, collections: db(21) });
    expect(many.state).toBe("failed");
    expect(rec(many, each.id).ask).toBeUndefined();
    expect(rec(many, each.id).error?.people).toEqual({
      code: "ask.questions",
      detail: { got: 21, max: 20 },
    });
    expect(port.asked).toBe(0);

    // 20 runs already waiting: the next fails in that step («Ya hay 20 preguntas sin responder»); a test waits in
    // no Bandeja, so it does not count them.
    const full = await go(once.automation, { people: recorder(20), collections: db(1) });
    expect(rec(full, once.id).error?.people?.code).toBe("ask.waiting");
    const tested = await go(
      once.automation,
      { people: recorder(20), collections: db(1) },
      { test: true },
    );
    expect(tested.state).toBe("waiting");

    // Options from an expression that does not give a list of texts.
    const bad = asking({ answer: "one", options: { expr: "{{ $('Inicio').first().opciones }}" } });
    const wrong = await go(
      bad.automation,
      { people: recorder(), collections: db(1) },
      { json: { opciones: "una" } },
    );
    expect(rec(wrong, bad.id).error?.people).toEqual({ code: "ask.options", param: "options" });

    // More than 2 MB to keep: it fails without asking.
    const big = await go(once.automation, {
      people: recorder(),
      collections: store([tasks], { [tasks.key]: [{ [note]: "x".repeat(2_200_000) }] }, ids(148)),
    });
    expect(rec(big, once.id).error?.people?.code).toBe("ask.kept");
    expect(rec(big, once.id).ask).toBeUndefined();
    // Measured once what does not depend on the answer ran too, also a step that runs after the question.
    const late = sketch(160)
      .step("Inicio", "manual", INICIO)
      .step("Preguntar", ASK_TYPE, { question: "¿Sigo?", answer: "yesNo" })
      .step("Luego", "edit", { fields: [{ field: "a", value: "b" }] })
      .step("Buscar", "collection", { collection: tasks.key, [ACTION]: "find", limit: 5000 })
      .arrow("Inicio", "Preguntar")
      .arrow("Inicio", "Luego")
      .arrow("Luego", "Buscar");
    const after = await go(late.build(), {
      people: recorder(),
      collections: store([tasks], { [tasks.key]: [{ [note]: "x".repeat(2_200_000) }] }, ids(161)),
    });
    expect(after.order.indexOf(late.id("Buscar"))).toBeGreaterThan(
      after.order.indexOf(late.id("Preguntar")),
    );
    expect(after.state).toBe("failed");
    expect(rec(after, late.id("Preguntar")).error?.people).toEqual({
      code: "ask.kept",
      detail: { max: 2 * 1024 * 1024 },
    });
    expect(rec(after, late.id("Preguntar")).ask).toBeUndefined();
  });

  it("AU-125 · an answer he writes carries his hand's label, and a chosen option keeps the option's label", async () => {
    const answerOf = (e: Execution, id: string) =>
      rec(e, id).out[MAIN]?.[0]?.fields?.[ANSWER_FIELD];
    const text = asking({
      answer: "text",
      question: "<b>¿Por qué?</b> [mira](https://example.com)",
    });
    const t0 = await go(text.automation, { people: recorder(), collections: db(1) });
    // The question is the step's text as it was written: plain, never markup.
    expect(rec(t0, text.id).ask?.questions[0]?.text).toBe(
      "<b>¿Por qué?</b> [mira](https://example.com)",
    );
    const t1 = await goOn(
      text.automation,
      t0,
      { [text.id]: [{ value: "porque sí", by: HAND }] },
      { people: recorder(), collections: db(1) },
    );
    expect(jsonOf(t1, text.id)?.[0]?.[ANSWER_FIELD]).toBe("porque sí");
    expect(answerOf(t1, text.id)).toEqual({ label: HAND, derived: false });

    // Fixed options: the automation's label, whoever taps.
    const fixed = asking({ answer: "one", options: ["pagar", "esperar"] });
    const f0 = await go(fixed.automation, { people: recorder(), collections: db(1) });
    const f1 = await goOn(
      fixed.automation,
      f0,
      { [fixed.id]: [{ value: "esperar", by: HAND }] },
      { people: recorder(), collections: db(1) },
    );
    expect(jsonOf(f1, fixed.id)?.[0]?.[ANSWER_FIELD]).toBe("esperar");
    expect(answerOf(f1, fixed.id)).toEqual({ label: OWN, derived: false });

    // Options from an expression over something from outside: the option keeps that label.
    const outside = asking({
      answer: "several",
      options: { expr: `{{ $('Buscar').first().${note} }}` },
    });
    const o0 = await go(outside.automation, {
      people: recorder(),
      collections: store(
        [tasks],
        { [tasks.key]: [{ [note]: ["una", "otra"] }] },
        ids(159),
        OUTSIDE,
      ),
    });
    expect(rec(o0, outside.id).ask?.questions[0]?.options?.map((o) => o.value)).toEqual([
      "una",
      "otra",
    ]);
    const o1 = await goOn(
      outside.automation,
      o0,
      { [outside.id]: [{ value: ["otra"], by: HAND }] },
      { people: recorder(), collections: db(1) },
    );
    expect(answerOf(o1, outside.id)?.label.integrity).toBe("external");

    // An answer that does not fit its question is refused before anything goes on.
    for (const value of ["quizá", ["pagar", "pagar"], 3])
      await expect(
        goOn(fixed.automation, f0, { [fixed.id]: [{ value, by: HAND }] }, { people: recorder() }),
      ).rejects.toBeInstanceOf(CannotRun);
    await expect(
      goOn(fixed.automation, f0, { [fixed.id]: [yes(), yes()] }, { people: recorder() }),
    ).rejects.toBeInstanceOf(CannotRun);
  });

  it("AU-201 · «Avisar» has no recipient parameter; one notice per run, and «Una vez por fila» sends 5 and then one that groups the rest", async () => {
    // No parameter names to whom: a text, its mode, and «Dónde», a closed list of his own devices fixed in the step.
    const keys = (type: string) => specOf(type)?.actions.flatMap((a) => a.params.map((p) => p.key));
    expect(keys(NOTIFY_TYPE)).toEqual(["text", "via", "mode", "where"]);
    expect(keys(REPLY_TYPE)).toEqual(["text"]);
    const where = specOf(NOTIFY_TYPE)?.actions[0]?.params.find((p) => p.key === "where");
    expect(where).toMatchObject({
      control: "choice",
      place: "option",
      shape: true,
      default: "all",
    });
    expect(where && "options" in where ? where.options : []).toEqual(["all", "desktop", "phone"]);
    expect(NOTIFY_WHERE).toEqual(["all", "desktop", "phone"]);
    for (const type of [NOTIFY_TYPE, REPLY_TYPE, ASK_TYPE])
      expect(
        specOf(type)
          ?.actions.flatMap((a) => a.params)
          .filter((p) => p.control === "picker"),
      ).toEqual([]);

    const telling = (params: Record<string, unknown>) => {
      const s = sketch(149)
        .step("Inicio", "manual", INICIO)
        .step("Buscar", "collection", { collection: tasks.key, [ACTION]: "find", limit: 5000 })
        .step("Avisar", NOTIFY_TYPE, { text: "Hay tareas", ...params } as never)
        .step("Después", "edit", { fields: [{ field: "visto", value: "sí" }] })
        .arrow("Inicio", "Buscar")
        .arrow("Buscar", "Avisar")
        .arrow("Avisar", "Después");
      return { automation: s.build(), id: s.id("Avisar"), after: s.id("Después") };
    };
    // «Dónde» is never an expression, and only one of its keys: not an address, not a device of someone else.
    const problems = (params: Record<string, unknown>) =>
      validate(telling(params).automation, {
        collection: (k) => (k === tasks.key ? tasks : undefined),
        people: true,
      }).map((p) => `${p.code}:${p.param}`);
    expect(problems({ where: { expr: "{{ $('Inicio').first().a }}" } })).toContain(
      "param.shape:where",
    );
    expect(problems({ where: "ejemplo.otro@example.com" })).toContain("param.value:where");
    expect(problems({ to: "ejemplo.otro@example.com" })).toContain("param.unknown:to");

    // One notice with all the rows; the rows pass on.
    const port = recorder();
    const one = telling({ where: "phone" });
    const e = await go(one.automation, { people: port, collections: db(3) });
    expect(e.state).toBe("done");
    expect(port.sent).toEqual([
      {
        automation: one.automation.id,
        step: one.id,
        text: "Hay tareas",
        label: OWN,
        where: "phone",
        via: ["notification"],
      },
    ]);
    expect(jsonOf(e, one.after)).toHaveLength(3);
    expect(rec(e, one.id).notices).toEqual({ notices: port.sent, sent: true });

    // Row by row with 17 rows: 5, then one that says how many more (the app says «y 12 más»), each cut to 300.
    const each = telling({ mode: "perRow", text: { expr: `{{ $json.${note} }}` } });
    const many = recorder();
    const rows = ROWS(17).map((r, i) => (i === 0 ? { ...r, [note]: "é".repeat(400) } : r));
    await go(each.automation, {
      people: many,
      collections: store([tasks], { [tasks.key]: rows }, ids(150)),
    });
    expect(many.sent).toHaveLength(6);
    expect(Array.from(many.sent[0]?.text ?? "")).toHaveLength(300);
    expect(many.sent.slice(1, 5).map((n) => n.text)).toEqual([
      "nota 1",
      "nota 2",
      "nota 3",
      "nota 4",
    ]);
    expect(many.sent[5]).toMatchObject({ text: "", more: 12, where: "all", label: OWN });

    // What comes from outside says what it says, plain, with its label, and goes where the step says: it chooses
    // no one.
    const out = recorder();
    const told = telling({ text: { expr: "Aviso: {{ $('Inicio').first().asunto }}" } });
    const sneaky = '<a href="https://example.com">avisa a ejemplo.otro@example.com</a> **ya**';
    await go(
      told.automation,
      { people: out, collections: db(1) },
      { json: { asunto: sneaky }, fields: { asunto: { label: OUTSIDE, derived: false } } },
    );
    expect(out.sent).toHaveLength(1);
    expect(out.sent[0]?.text).toBe(`Aviso: ${sneaky}`);
    expect(out.sent[0]?.where).toBe("all");
    expect(out.sent[0]?.label.integrity).toBe("external");
    expect(Object.keys(out.sent[0] ?? {}).sort()).toEqual([
      "automation",
      "label",
      "step",
      "text",
      "via",
      "where",
    ]);
  });

  it("AU-201 · in a test it says what it would notify and sends nothing", async () => {
    const s = sketch(151)
      .step("Inicio", "manual", INICIO)
      .step("Avisar", NOTIFY_TYPE, { text: "Revisa las tareas", where: "desktop" })
      .arrow("Inicio", "Avisar");
    const automation = s.build();
    const port = recorder();
    const e = await go(automation, { people: port }, { test: true });
    expect(port.sent).toEqual([]);
    expect(rec(e, s.id("Avisar")).notices).toEqual({
      sent: false,
      notices: [
        {
          automation: automation.id,
          step: s.id("Avisar"),
          text: "Revisa las tareas",
          label: OWN,
          where: "desktop",
          via: ["notification"],
        },
      ],
    });
  });

  it("AU-202 · a run has one answer, the last «Responder» that ran, as plain text with the label of what it cites", async () => {
    const s = sketch(152)
      .step("Inicio", "manual", INICIO)
      .step("Primero", REPLY_TYPE, { text: "Empiezo" })
      .step("Segundo", REPLY_TYPE, {
        text: { expr: "**Hecho**: {{ $('Inicio').first().asunto }}" },
      })
      .arrow("Inicio", "Primero")
      .arrow("Primero", "Segundo");
    const automation = s.build();
    const port = recorder();
    const e = await go(
      automation,
      { people: port },
      {
        json: { asunto: "<i>de fuera</i>" },
        fields: { asunto: { label: OUTSIDE, derived: false } },
      },
    );
    expect(e.reply?.step).toBe(s.id("Segundo"));
    expect(e.reply?.text).toBe("**Hecho**: <i>de fuera</i>");
    expect(e.reply?.label.integrity).toBe("external");
    // It stays in the run: no notice, also for a run that started alone.
    expect(port.sent).toEqual([]);
    const alone = await run(
      {
        automation,
        trigger: startOf(automation),
        fields: { json: { asunto: "x" }, label: OWN },
        test: false,
        startedBy: "schedule",
      },
      deps({ people: port }),
    );
    expect(alone.reply?.text).toBe("**Hecho**: x");
    expect(port.sent).toEqual([]);
    // A run with no «Responder» has no answer.
    expect(
      (await go(asking().automation, { people: port, collections: db(1) })).reply,
    ).toBeUndefined();

    // Kept across a wait: the one before the question stays the run's answer when nothing replies after.
    const w = sketch(153)
      .step("Inicio", "manual", INICIO)
      .step("Antes", REPLY_TYPE, { text: "Te he preguntado" })
      .step("Preguntar", ASK_TYPE, { question: "¿Sigo?", answer: "yesNo" })
      .arrow("Inicio", "Antes")
      .arrow("Antes", "Preguntar");
    const waits = await go(w.build(), { people: port });
    expect(waits.reply?.text).toBe("Te he preguntado");
    const on = await goOn(w.build(), waits, { [w.id("Preguntar")]: [yes()] }, { people: port });
    expect(on.reply).toEqual(waits.reply);
  });

  it("AU-203 · a run that reaches «Preguntar» finishes what does not depend on the answer and waits; the steps after it get no rows until it is answered", async () => {
    const c = clock();
    const told: string[] = [];
    const { automation, id, after, s } = asking();
    const both = s
      .step("Junto", "edit", { fields: [] })
      .arrow("Aparte", "Junto")
      .arrow("Preguntar", "Junto");
    const a = both.build();
    const e = await go(a, {
      people: recorder(),
      collections: db(2),
      clock: c,
      onStep: (step, r, phase) => {
        if (phase === "ended") told.push(`${step}:${r.state}`);
      },
    });
    expect(e.state).toBe("waiting");
    expect(rec(e, s.id("Aparte")).state).toBe("done");
    expect(rec(e, s.id("Buscar")).state).toBe("done");
    expect(rec(e, id).state).toBe("waiting");
    expect(rec(e, id).ask).toMatchObject({ answer: "yesNo", mode: "all", until: c.now() + DAY_MS });
    // What depends on the answer, also through a step that does not, is queued with no rows.
    for (const queued of [after, s.id("Junto")]) {
      expect(rec(e, queued).state).toBe("queued");
      expect(rec(e, queued).in).toEqual({});
      expect(told.some((t) => t.startsWith(queued))).toBe(false);
    }
    expect(told).toContain(`${id}:waiting`);
    expect(e.waits?.until).toBe(c.now() + DAY_MS);

    // Two questions on two branches: answering one leaves the run waiting for the other.
    const two = sketch(154)
      .step("Inicio", "manual", INICIO)
      .step("Una", ASK_TYPE, { question: "¿Una?", answer: "yesNo" })
      .step("Otra", ASK_TYPE, { question: "¿Otra?", answer: "yesNo", waitDays: 3 })
      .arrow("Inicio", "Una")
      .arrow("Inicio", "Otra");
    const t = two.build();
    const w = await go(t, { people: recorder(), clock: c });
    expect(w.waits?.until).toBe(c.now() + DAY_MS);
    const half = await goOn(t, w, { [two.id("Una")]: [yes()] }, { people: recorder(), clock: c });
    expect(half.state).toBe("waiting");
    expect(rec(half, two.id("Una")).state).toBe("done");
    expect(half.waits?.until).toBe(c.now() + 3 * DAY_MS);
    const whole = await goOn(
      t,
      half,
      { [two.id("Otra")]: [yes()] },
      { people: recorder(), clock: c },
    );
    expect(whole.state).toBe("done");

    // A run that fails while a question waits waits for nothing.
    const failing = sketch(155)
      .step("Inicio", "manual", INICIO)
      .step("Preguntar", ASK_TYPE, { question: "¿Sigo?", answer: "yesNo" })
      .step("Para", "stop", { message: "no" })
      .arrow("Inicio", "Preguntar")
      .arrow("Inicio", "Para");
    const f = await go(failing.build(), { people: recorder() });
    expect(f.state).toBe("failed");
    expect(rec(f, failing.id("Preguntar")).state).toBe("stopped");
    expect(f.waits).toBeUndefined();
    expect(automation.steps).toHaveLength(5);
  });

  it("AU-203 · answered, it goes on from that step with the outputs it kept; past its wait limit it leaves by «sin respuesta»", async () => {
    const c = clock();
    const { automation, id, after, s } = asking();
    const st = db(2);
    const kept = await go(automation, { people: recorder(), collections: st, clock: c });
    const reads = st.calls.length;
    // Read back as after a restart, it goes on from the question: what was decided is not run again.
    const on = await goOn(
      automation,
      kept,
      { [id]: [yes()] },
      { people: recorder(), collections: st, clock: c },
    );
    expect(st.calls.length).toBe(reads);
    expect(on.state).toBe("done");
    expect(jsonOf(on, after)).toEqual(
      ROWS(2).map((r) => ({ ...r, [ANSWER_FIELD]: true, visto: "sí" })),
    );
    expect(jsonOf(on, s.id("Aparte"))).toEqual(jsonOf(kept, s.id("Aparte")));
    // `$('Buscar').item` still pairs across the question.
    const cites = s
      .step("Cita", "edit", { fields: [{ field: "n", value: cite(`$('Buscar').item.${amount}`) }] })
      .arrow("Preguntar", "Cita")
      .build();
    const k2 = await go(cites, { people: recorder(), collections: db(2), clock: c });
    const o2 = await goOn(
      cites,
      k2,
      { [id]: [yes()] },
      { people: recorder(), collections: db(2), clock: c },
    );
    expect(jsonOf(o2, s.id("Cita"))?.map((r) => r.n)).toEqual([0, 1]);

    // Not answered and within its limit, it goes on waiting.
    const still = await goOn(
      automation,
      kept,
      {},
      { people: recorder(), collections: st, clock: c },
    );
    expect(still.state).toBe("waiting");

    // Past its limit it leaves by «sin respuesta», even with an answer that came late («Ya no vale»).
    await c.sleep(DAY_MS);
    const late = await goOn(
      automation,
      kept,
      { [id]: [yes()] },
      { people: recorder(), collections: st, clock: c },
    );
    expect(late.state).toBe("done");
    expect(jsonOf(late, id, NO_ANSWER)).toEqual(ROWS(2));
    expect(rec(late, after).state).toBe("skipped");

    // It goes on only with the version it started with, as it started, and for a step that waits.
    const other = { ...automation, version: automation.version + 1 };
    await expect(goOn(other, kept, {}, { people: recorder() })).rejects.toBeInstanceOf(CannotRun);
    await expect(
      goOn(automation, kept, { [after]: [yes()] }, { people: recorder() }),
    ).rejects.toBeInstanceOf(CannotRun);
    await expect(goOn(automation, on, {}, { people: recorder() })).rejects.toBeInstanceOf(
      CannotRun,
    );
  });

  it("AU-203 · the run's time limit counts what runs and not what waits; rows written and model calls are counted across the wait", async () => {
    const c = clock();
    // Two days waiting, under a limit of one minute: what ran is what counts.
    const { automation, id } = asking();
    automation.settings = { limits: { ms: 60_000 } };
    const kept = await go(automation, { people: recorder(), collections: db(1), clock: c });
    await c.sleep(2 * DAY_MS - 1);
    const on = await goOn(
      automation,
      kept,
      { [id]: [yes()] },
      { people: recorder(), collections: db(1), clock: c },
    );
    expect(on.state).toBe("done");
    expect(on.ms).toBe(kept.ms);
    expect(on.started).toBe(kept.started);

    // One row may be written: «Crear» before the question writes it, «Crear» after it is over the limit.
    const s = sketch(156)
      .step("Inicio", "manual", INICIO)
      .step("Crear", "collection", {
        collection: tasks.key,
        [ACTION]: "create",
        fields: [{ field: note, value: "antes" }],
      })
      .step("Preguntar", ASK_TYPE, { question: "¿Otra?", answer: "yesNo" })
      .step("Otra", "collection", {
        collection: tasks.key,
        [ACTION]: "create",
        fields: [{ field: note, value: "después" }],
      })
      .arrow("Inicio", "Crear")
      .arrow("Crear", "Preguntar")
      .arrow("Preguntar", "Otra");
    const writes = s.build();
    writes.settings = { limits: { rowsWritten: 1 } };
    const st = store([tasks], {}, ids(157));
    const w0 = await go(writes, { people: recorder(), collections: st, clock: c });
    expect(w0.waits?.counts.written).toBe(1);
    const w1 = await goOn(
      writes,
      w0,
      { [s.id("Preguntar")]: [yes()] },
      { people: recorder(), collections: st, clock: c },
    );
    expect(w1.state).toBe("failed");
    expect(w1.error).toMatchObject({
      step: s.id("Otra"),
      failure: { code: "run.limit", detail: { limit: "rowsWritten", max: 1, got: 2 } },
    });

    // Three calls to a model: two before the question, the third after it is over the limit.
    const m = sketch(158)
      .step("Inicio", "manual", INICIO)
      .step("Escribir", "write", { instructions: "Una frase", text: "hola" })
      .step("Preguntar", ASK_TYPE, { question: "¿Otra?", answer: "yesNo" })
      .step("Otra", "write", { instructions: "Otra frase", text: "hola" })
      .arrow("Inicio", "Escribir")
      .arrow("Escribir", "Preguntar")
      .arrow("Preguntar", "Otra");
    const models = m.build();
    models.settings = { limits: { modelCalls: 1 } };
    const ai = {
      read: async () => ({ answer: { text: "una frase" }, model: "modelo-de-ejemplo" }),
    };
    const m0 = await go(models, { people: recorder(), ai, clock: c });
    expect(m0.state).toBe("waiting");
    expect(m0.waits?.counts.models).toBe(1);
    const m1 = await goOn(
      models,
      m0,
      { [m.id("Preguntar")]: [yes()] },
      { people: recorder(), ai, clock: c },
    );
    expect(m1.error).toMatchObject({
      step: m.id("Otra"),
      failure: { code: "run.limit", detail: { limit: "modelCalls", max: 1, got: 2 } },
    });
  });
});
