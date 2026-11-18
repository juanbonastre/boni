// The category «Boni» of the catalogue (docs/automatizaciones.md §5.9 and §5.10, phase F16): Boni's triggers, the
// pieces of its own automations as step types, and the two generic steps that carry what the catalogue has no name
// for, «Acción de Boni» and «Lector de Boni» (AU-127, AU-220).
//
// They run the engine with a scripted port for Boni's code (`RunDeps.boni`), as the AI steps do with a scripted
// model: this package imports no app (A-02), and no model is called. Collections are shaped like his (generated
// keys, D-14); the mail is invented.
import { label } from "@boni/entities";
import { describe, expect, it } from "vitest";
import { cite, collection, ids, knowing, sketch } from "./automation.test-util.ts";
import {
  BONI_ACTION_TYPE,
  BONI_CATEGORY,
  BONI_PIECES,
  BONI_READER_TYPE,
  BONI_TRIGGERS,
  BONI_TYPES,
  BONI_VALUE,
  type BoniAnswer,
  type BoniAutomation,
  type BoniCall,
  type BoniPort,
} from "./boni.ts";
import { CATALOGUE, CATEGORIES, isTrigger, paramsOf, specOf } from "./catalogue.ts";
import { CannotRun, type Execution, run } from "./engine.ts";
import type { Automation, ParamValue, Step } from "./format.ts";
import { deps, OUTSIDE, OWN, policy } from "./run.test-util.ts";
import { type ValidationContext, validate } from "./validate.ts";
import { consentOf, lowerYes, stepChanges } from "./writes.ts";

const next = ids(130);
/** Shaped like his: generated keys, a text and a date. */
const notes = collection(next, ["text", "date"]);
const events = collection(next, ["text", "datetime"]);
const shapes = knowing(notes, events);
const inBoni = (automation?: BoniAutomation): ValidationContext => ({
  ...shapes,
  boni: automation ? { automation } : {},
});
/** The mail, as the mail collection keeps it: invented. */
const MAIL = {
  from: "ejemplo.remitente@example.com",
  subject: "Reunión del jueves",
  text: "¿Nos vemos el jueves a las diez?",
};

/** A port that keeps every call and answers what `answer` says (by default, the call's name, labelled as its own). */
function port(
  automation?: BoniAutomation,
  answer: (c: BoniCall) => BoniAnswer = (c) => ({
    value: c.test ? `haría ${c.name}` : c.name,
    label: OWN,
  }),
): BoniPort & { calls: BoniCall[] } {
  const calls: BoniCall[] = [];
  return {
    ...(automation ? { automation } : {}),
    calls,
    async run(c) {
      calls.push(structuredClone(c));
      return answer(c);
    },
  };
}

const unknown = (a: Automation, context: ValidationContext) =>
  validate(a, context)
    .filter((p) => p.code === "step.unknownType")
    .map((p) => p.detail?.type);
const errors = (a: Automation, context: ValidationContext) =>
  validate(a, context)
    .filter((p) => p.severity === "error")
    .map((p) => `${p.code}${p.param ? `@${p.param}` : ""}`);
const one = (type: string, params: Record<string, ParamValue> = {}) =>
  sketch(131).step("Inicio", "manual").step("Paso", type, params).arrow("Inicio", "Paso");
const go = (
  a: Automation,
  over: Parameters<typeof deps>[0],
  opts: { test?: boolean; json?: Record<string, string>; outside?: boolean } = {},
): Promise<Execution> =>
  run(
    {
      automation: a,
      trigger: a.steps[0]?.id as string,
      fields: { json: opts.json ?? {}, label: opts.outside ? OUTSIDE : OWN },
      test: opts.test ?? false,
    },
    deps({ collections: { ...deps().collections, shape: (k) => shapes.collection(k) }, ...over }),
  );

/** Every Boni step the catalogue knows, as a step with the least it needs to validate. */
const stepOf = (type: string): Step => ({
  id: "s_boni",
  name: "Boni",
  type,
  params:
    type === BONI_ACTION_TYPE
      ? { action: "pages.create" }
      : type === BONI_READER_TYPE
        ? { reader: "extract_tasks", input: "texto" }
        : type === BONI_TRIGGERS.chat
          ? { page: "p_ejemplo" }
          : type === "boni.mailDecider"
            ? { collections: [{ collection: notes.key }] }
            : type === "boni.create"
              ? { collection: events.key }
              : {},
});

describe("the steps of the category «Boni» (F16)", () => {
  it("AU-127 · each piece is a step type with its name and only the parameters it lets change; it validates only inside its own automation, and a copy loses it and says so", () => {
    // One per piece of the server's `PIECES`, and the readers and «Crear» of «Leer correo» and «Revisar la guía».
    expect(BONI_PIECES.map((p) => p.old).sort()).toEqual(
      [
        "classify",
        "entities.create",
        "entities.create",
        "fill",
        "guide.decisions",
        "guide.measure",
        "guide.suggest",
        "inbox.accept_alone",
        "inbox.fold",
        "mail.invitation",
        "mail.known",
        "mail.relations",
        "mail.rule",
        "mail.save",
        "read_message",
        "review_reading",
      ].sort(),
    );
    for (const piece of BONI_PIECES) {
      const spec = specOf(piece.type);
      expect(spec?.category).toBe(BONI_CATEGORY);
      // What it lets change and what its call passed, in sight; its why and how it runs, behind «Añadir opción»;
      // nothing else. Only the why is not fixed: it is text, as the plan said it.
      const params = paramsOf(stepOf(piece.type));
      expect(params.filter((p) => p.place === "shown").map((p) => p.key)).toEqual([
        ...piece.params,
        "args",
      ]);
      expect(params.filter((p) => p.place !== "shown").map((p) => p.key)).toEqual(["why", "mode"]);
      expect(params.filter((p) => !p.shape).map((p) => p.key)).toEqual(["why"]);

      const a = one(piece.type, stepOf(piece.type).params).build();
      expect(unknown(a, inBoni(piece.owner))).toEqual([]);
      expect(errors(a, inBoni(piece.owner))).toEqual([]);
      // A copy (another automation, or no way to Boni's code at all) loses it, and says which type.
      for (const other of ["readMail", "fetchMail", "reviewGuide", "budgetNotice"] as const)
        if (other !== piece.owner) expect(unknown(a, inBoni(other))).toEqual([piece.type]);
      expect(unknown(a, inBoni())).toEqual([piece.type]);
      expect(unknown(a, shapes)).toEqual([piece.type]);
    }
    // What a piece lets change stays within its code's bounds.
    const at = (type: string, params: Record<string, ParamValue>, owner: BoniAutomation) =>
      errors(one(type, params).build(), inBoni(owner));
    expect(at("boni.fold", { days: 366 }, "readMail")).toEqual([]);
    expect(at("boni.fold", { days: 0 }, "readMail")).toEqual(["param.value@days"]);
    expect(at("boni.fold", { days: 367 }, "readMail")).toEqual(["param.value@days"]);
    expect(at("boni.fold", { days: 1.5 }, "readMail")).toEqual(["param.value@days"]);
    expect(at("boni.guideMeasure", { mails: 21 }, "reviewGuide")).toEqual(["param.value@mails"]);
    expect(at("boni.acceptAlone", { alone: "sí" }, "readMail")).toEqual(["param.value@alone"]);
    expect(at("boni.fold", { days: cite("$json.dias") }, "readMail")).toEqual(["param.shape@days"]);
    // The «Decisora» chooses among collections written in the step, each once, each one that exists (decision 20).
    const decider = (keys: string[]) =>
      at(
        "boni.mailDecider",
        { collections: keys.map((collection) => ({ collection })) },
        "readMail",
      );
    expect(decider([notes.key, events.key])).toEqual([]);
    expect(decider([notes.key, notes.key])).toEqual(["param.value@collections"]);
    expect(decider([])).toEqual(["param.value@collections"]);
    expect(decider(["t_ninguna"])).toEqual(["collection.unknown@collections.0.collection"]);
    expect(at("boni.create", {}, "readMail")).toEqual(["param.required@collection"]);
    // A parameter it does not let change is refused, not kept: no «Permiso» either.
    expect(at("boni.mailRule", { permission: "yes" }, "readMail")).toEqual([
      "param.unknown@permission",
    ]);
    expect(at("boni.mailReader", { prompt: "otro" }, "readMail")).toEqual(["param.unknown@prompt"]);
  });

  it("AU-127 · a piece runs through the port it is given, has no write cells, and in «Probar» changes nothing and says what it would do", async () => {
    const s = sketch(132)
      .step("Llega un correo", BONI_TRIGGERS.mail)
      .step("Regla del remitente", "boni.mailRule")
      .step("Decisora", "boni.mailDecider", {
        model: "",
        collections: [{ collection: notes.key }, { collection: events.key }],
      })
      .step("Crear en la elegida", "boni.createChosen")
      .step("Plegar hilo", "boni.fold", { days: 30 }, undefined)
      .arrow("Llega un correo", "Regla del remitente")
      .arrow("Regla del remitente", "Decisora")
      .arrow("Decisora", "Crear en la elegida")
      .arrow("Crear en la elegida", "Plegar hilo");
    const a = s.build();
    const p = policy();
    const boni = port("readMail");
    const e = await go(a, { boni, policy: p }, { json: MAIL, outside: true });
    expect(e.state).toBe("done");
    expect(boni.calls.map((c) => [c.name, c.type, c.test])).toEqual([
      ["mail.rule", "boni.mailRule", false],
      ["classify", "boni.mailDecider", false],
      ["entities.create", "boni.createChosen", false],
      ["inbox.fold", "boni.fold", false],
    ]);
    const decider = boni.calls[1] as BoniCall;
    expect(decider.automation).toBe(a.id);
    expect(decider.step).toBe(s.id("Decisora"));
    expect(decider.values.collections?.value).toEqual([
      { collection: notes.key },
      { collection: events.key },
    ]);
    expect(boni.calls[3]?.values.days?.value).toBe(30);
    // The first piece gets the mail; each next, the row of the one before, with what Boni's code answered.
    expect(boni.calls[0]?.row?.json).toEqual(MAIL);
    expect(boni.calls[1]?.row?.json).toEqual({ [BONI_VALUE]: "mail.rule" });
    // What it answers about the mail stays labelled as from outside, whatever label Boni's code gave it.
    for (const id of ["Regla del remitente", "Decisora", "Crear en la elegida"]) {
      const out = e.steps[s.id(id)]?.out.main?.[0];
      expect(out?.label.integrity).toBe("external");
    }
    // No cell: the engine asked the policy nothing and saved nothing (what Boni's code changes is decided behind the
    // port, with `decide`, as today).
    expect(p.calls).toEqual([]);
    expect(e.asked).toEqual([]);
    for (const step of a.steps) {
      expect(stepChanges(step, { collectionNamed: () => undefined })).toEqual([]);
      for (const c of [notes.key, events.key])
        for (const action of ["create", "update", "remove"] as const)
          expect(consentOf(step, c, action)).toBe(false);
    }
    // «Probar»: the port is told so, changes nothing and says what it would do.
    const trial = port("readMail");
    const t = await go(a, { boni: trial }, { json: MAIL, outside: true, test: true });
    expect(trial.calls.every((c) => c.test)).toBe(true);
    expect(t.steps[s.id("Crear en la elegida")]?.out.main?.[0]?.json).toEqual({
      [BONI_VALUE]: "haría entities.create",
    });
    // A failure of Boni's code is the step's failure, said in the run.
    const failing: BoniPort = {
      automation: "readMail",
      run: async () => {
        throw new Error("no se pudo leer");
      },
    };
    const f = await go(a, { boni: failing }, { json: MAIL, outside: true });
    expect(f.state).toBe("failed");
    // Without the port, the steps are not step types: the run is refused before any effect.
    await expect(go(a, {}, { json: MAIL, outside: true })).rejects.toBeInstanceOf(CannotRun);
    await expect(
      go(a, { boni: port("reviewGuide") }, { json: MAIL, outside: true }),
    ).rejects.toBeInstanceOf(CannotRun);
  });

  it("AU-127 · «Acción de Boni» names one action as a literal and «Lector de Boni» one reader; the add panel offers neither", async () => {
    const context = inBoni();
    expect(errors(one(BONI_ACTION_TYPE, { action: "pages.create" }).build(), context)).toEqual([]);
    expect(errors(one(BONI_ACTION_TYPE, {}).build(), context)).toEqual(["param.required@action"]);
    expect(
      errors(one(BONI_ACTION_TYPE, { action: cite("$json.accion") }).build(), context),
    ).toEqual(["param.shape@action"]);
    expect(errors(one(BONI_ACTION_TYPE, { action: "borrar todo" }).build(), context)).toEqual([
      "param.value@action",
    ]);
    expect(
      errors(
        one(BONI_ACTION_TYPE, {
          action: "pages.create",
          args: [
            { key: "title", value: "Hoy" },
            { key: "title", value: "Otro" },
          ],
        }).build(),
        context,
      ),
    ).toEqual(["param.value@args.1.key"]);
    expect(
      errors(one(BONI_READER_TYPE, { reader: "extract_tasks", input: "texto" }).build(), context),
    ).toEqual([]);
    // Only a reader with no step of its own: «Resumir» is a step, and so is «Clasificar».
    expect(
      errors(one(BONI_READER_TYPE, { reader: "summarize", input: "texto" }).build(), context),
    ).toEqual(["param.value@reader"]);
    expect(
      errors(one(BONI_READER_TYPE, { reader: cite("$json.r"), input: "x" }).build(), context),
    ).toEqual(["param.shape@reader"]);

    // It runs through the port: the action by its name, each argument resolved with its label.
    const s = sketch(133)
      .step("Inicio", "manual", {
        fields: [{ key: "asunto", name: "Asunto", type: "text" }],
      })
      .step("Acción", BONI_ACTION_TYPE, {
        action: "pages.create",
        args: [
          { key: "title", value: cite("$('Inicio').first().asunto") },
          { key: "kind", value: "nota" },
        ],
        why: "lo pidió el plan",
      })
      .step("Lector", BONI_READER_TYPE, {
        reader: "answer_about",
        input: cite("$('Acción').first().value"),
      })
      .arrow("Inicio", "Acción")
      .arrow("Acción", "Lector");
    const boni = port();
    const e = await go(s.build(), { boni }, { json: { asunto: "Recordatorio" }, outside: true });
    expect(e.state).toBe("done");
    const [action, reader] = boni.calls as [BoniCall, BoniCall];
    expect(action.name).toBe("pages.create");
    expect(action.args.title?.value).toBe("Recordatorio");
    expect(action.args.title?.label.integrity).toBe("external");
    expect(action.args.kind?.value).toBe("nota");
    expect(action.values.why?.value).toBe("lo pidió el plan");
    expect(Object.keys(action.values)).not.toContain("args");
    expect(reader.name).toBe("answer_about");
    expect(reader.values.input?.value).toBe("pages.create");

    // The add panel lists the catalogue (and «Código»): no Boni type is in it, nor is the category.
    expect(CATALOGUE.filter((t) => BONI_TYPES.includes(t.type))).toEqual([]);
    expect(CATEGORIES as readonly string[]).not.toContain(BONI_CATEGORY);
  });

  it("AU-220 · «Llega un correo» is a trigger any automation may use and gives one row labelled as from outside; the other three exist only in their own automation", async () => {
    for (const type of Object.values(BONI_TRIGGERS)) expect(isTrigger(stepOf(type))).toBe(true);
    const mail = sketch(134)
      .step("Llega un correo", BONI_TRIGGERS.mail)
      .step("Aviso", "edit", { fields: [{ field: "visto", value: "sí" }] })
      .arrow("Llega un correo", "Aviso");
    const a = mail.build();
    // Any automation of Juan's: with a way to Boni's code, it validates whatever automation it is.
    expect(errors(a, inBoni())).toEqual([]);
    expect(errors(a, inBoni("reviewGuide"))).toEqual([]);
    expect(unknown(a, shapes)).toEqual([BONI_TRIGGERS.mail]);

    // One row, the mail, labelled whole as from outside: a field given another label loses it.
    const e = await run(
      {
        automation: a,
        trigger: mail.id("Llega un correo"),
        fields: {
          json: MAIL,
          label: OUTSIDE,
          fields: { subject: { label: OWN, derived: false } },
        },
        test: false,
      },
      deps({ boni: port() }),
    );
    const row = e.steps[mail.id("Llega un correo")]?.out.main;
    expect(row?.length).toBe(1);
    expect(row?.[0]?.json).toEqual(MAIL);
    expect(row?.[0]?.label).toBe(OUTSIDE);
    expect(row?.[0]?.fields).toBeUndefined();
    // Started with any label but from outside, it does not start.
    const own = label("user", "personal", [{ kind: "user-edit", id: "d_ejemplo" }]);
    for (const l of [OWN, own])
      await expect(
        run(
          {
            automation: a,
            trigger: mail.id("Llega un correo"),
            fields: { json: MAIL, label: l },
            test: false,
          },
          deps({ boni: port() }),
        ),
      ).rejects.toBeInstanceOf(CannotRun);

    // The other three, only in their own automation of Boni's.
    const owned: [string, BoniAutomation][] = [
      [BONI_TRIGGERS.mailbox, "fetchMail"],
      [BONI_TRIGGERS.decisions, "reviewGuide"],
      [BONI_TRIGGERS.spending, "budgetNotice"],
    ];
    for (const [type, owner] of owned) {
      const t = sketch(135)
        .step("Disparador", type)
        .step("Después", "edit", { fields: [{ field: "x", value: "1" }] })
        .arrow("Disparador", "Después")
        .build();
      expect(errors(t, inBoni(owner))).toEqual([]);
      expect(unknown(t, inBoni())).toEqual([type]);
      for (const other of ["fetchMail", "readMail", "reviewGuide", "budgetNotice"] as const)
        if (other !== owner) expect(unknown(t, inBoni(other))).toEqual([type]);
    }
    // «Cada cuántas decisiones», from 10 to 500.
    const every = (n: number) =>
      errors(
        sketch(136).step("D", BONI_TRIGGERS.decisions, { every: n }).build(),
        inBoni("reviewGuide"),
      );
    expect(every(10)).toEqual([]);
    expect(every(500)).toEqual([]);
    expect(every(9)).toEqual(["param.value@every"]);
    expect(every(501)).toEqual(["param.value@every"]);

    // «Mensaje de chat» (AU-137): the page, its welcome and up to six buttons, within the chat's lengths.
    const chat = (params: Record<string, ParamValue>) =>
      errors(sketch(137).step("Chat", BONI_TRIGGERS.chat, params).build(), inBoni());
    const button = { label: "Resumen", text: "Hazme un resumen de hoy" };
    expect(chat({ page: "p_ejemplo", welcome: "Hola", buttons: [button] })).toEqual([]);
    expect(chat({})).toEqual(["param.required@page"]);
    expect(chat({ page: "p_ejemplo", welcome: "a".repeat(401) })).toEqual(["param.value@welcome"]);
    expect(chat({ page: "p_ejemplo", buttons: Array(7).fill(button) })).toEqual([
      "param.value@buttons",
    ]);
    expect(chat({ page: "p_ejemplo", buttons: [{ ...button, label: "a".repeat(41) }] })).toEqual([
      "param.value@buttons.0.label",
    ]);
    expect(chat({ page: "p_ejemplo", buttons: [{ ...button, text: "a".repeat(301) }] })).toEqual([
      "param.value@buttons.0.text",
    ]);
  });

  it("AU-127 · no Boni step has a «Sí»: lowering an automation of them changes nothing, and none can be given one", () => {
    const s = sketch(138).step("Inicio", "manual");
    for (const [i, type] of BONI_TYPES.filter((t) => !isTrigger(stepOf(t))).entries())
      s.step(`P${i}`, type, { ...stepOf(type).params }).arrow("Inicio", `P${i}`);
    const a = s.build();
    expect(lowerYes(a)).toBe(a);
    // Given one by hand in the document, it is refused where it validates, and still writes nothing.
    for (const type of BONI_TYPES.filter((t) => !isTrigger(stepOf(t)))) {
      const step = { ...stepOf(type), params: { ...stepOf(type).params, permission: "yes" } };
      expect(stepChanges(step, { collectionNamed: () => undefined })).toEqual([]);
      const owner = BONI_PIECES.find((p) => p.type === type)?.owner;
      expect(errors(one(type, step.params).build(), inBoni(owner))).toEqual([
        "param.unknown@permission",
      ]);
    }
  });
});
