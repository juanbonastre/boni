// The category «Boni» of the catalogue (docs/automatizaciones.md §5.9 and §5.10, phase F16): Boni's triggers, the
// pieces of its own automations as step types, and the two generic steps that carry what the catalogue has no name
// for, «Acción de Boni» and «Lector de Boni» (AU-127, AU-220).
//
// They run the engine with a scripted port for Boni's code (`RunDeps.boni`), as the AI steps do with a scripted
// model: this package imports no app (A-02), and no model is called. Collections are shaped like his (generated
// keys, D-14); the mail is invented.
import { type Label, label } from "@boni/entities";
import { describe, expect, it } from "vitest";
import type { AiPort, PieceCall } from "./ai.ts";
import { cite, collection, ids, knowing, sketch } from "./automation.test-util.ts";
import {
  BONI_ACTION_TYPE,
  BONI_CATEGORY,
  BONI_DOUBT,
  BONI_PIECES,
  BONI_READER_TYPE,
  BONI_TRIGGERS,
  BONI_TYPES,
  BONI_VALUE,
  type BoniAnswer,
  type BoniAutomation,
  type BoniCall,
  type BoniPort,
  CHOSEN,
  CREATE_CHOSEN,
  type PieceRead,
} from "./boni.ts";
import { CATALOGUE, CATEGORIES, isTrigger, paramsOf, specOf } from "./catalogue.ts";
import type { Connection } from "./connections.ts";
import { CannotRun, type Execution, run } from "./engine.ts";
import type { Automation, ParamValue, Step } from "./format.ts";
import { deps, OUTSIDE, OWN, policy, store } from "./run.test-util.ts";
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
  answer: (c: BoniCall) => BoniAnswer | Promise<BoniAnswer> = (c) => ({
    value: c.test ? `haría ${c.name}` : c.name,
    label: OWN,
  }),
): BoniPort & { calls: BoniCall[] } {
  const calls: BoniCall[] = [];
  return {
    ...(automation ? { automation } : {}),
    calls,
    async run(c) {
      const { read, ...rest } = c;
      calls.push({ ...structuredClone(rest), ...(read ? { read } : {}) });
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
  opts: {
    test?: boolean;
    json?: Record<string, string>;
    outside?: boolean;
    startedBy?: "user" | "schedule";
  } = {},
): Promise<Execution> =>
  run(
    {
      automation: a,
      trigger: a.steps[0]?.id as string,
      fields: { json: opts.json ?? {}, label: opts.outside ? OUTSIDE : OWN },
      test: opts.test ?? false,
      ...(opts.startedBy ? { startedBy: opts.startedBy } : {}),
    },
    deps({ collections: { ...deps().collections, shape: (k) => shapes.collection(k) }, ...over }),
  );

/** «Crear en la elegida»'s cells for one collection: only «Crear», at `mode` (decision 30: born «Preguntar»). */
const cellsFor = (c: { key: string }, mode: "ask" | "yes" | false = "ask"): Connection => ({
  collection: c.key,
  read: false,
  create: mode ? { mode } : false,
  update: false,
  remove: false,
});
/** The automation with these connections on its step of type «Crear en la elegida». */
const withCells = (a: Automation, connections: Connection[]): Automation => ({
  ...a,
  steps: a.steps.map((s) => (s.type === CREATE_CHOSEN ? { ...s, connections } : s)),
});
const textOf = (c: { fields: readonly { key: string }[] }) => c.fields[0]?.key as string;

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
            : {},
});

describe("the steps of the category «Boni» (F16)", () => {
  it("AU-127 · each piece is a step type with its name and only the parameters it lets change; it validates only inside its own automation, and a copy loses it and says so", () => {
    // One per piece of the server's `PIECES`, and the readers and «Crear» of «Leer correo» and «Revisar la guía».
    expect(BONI_PIECES.map((p) => p.old).sort()).toEqual(
      [
        "classify",
        "entities.create",
        "fill",
        "guide.decisions",
        "guide.measure",
        "guide.suggest",
        "inbox.fold",
        "mail.invitation",
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
      // What it lets change and what its call passed, in sight; its options («Ejemplos», «Solo conocidos»), its why
      // and how it runs, behind «Añadir opción»; nothing else. Only the why is not fixed: it is text, as the plan said.
      const params = paramsOf(stepOf(piece.type));
      expect(params.filter((p) => p.place === "shown").map((p) => p.key)).toEqual([
        ...piece.params,
        "args",
      ]);
      expect(params.filter((p) => p.place !== "shown").map((p) => p.key)).toEqual([
        ...(piece.options ?? []),
        "why",
        "mode",
      ]);
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
    expect(at("boni.createChosen", { onlyKnown: "sí" }, "readMail")).toEqual([
      "param.value@onlyKnown",
    ]);
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
    // «Regla del remitente»: «Saltar» names no collection, «A una colección» one that exists; a sender within a mail
    // address's length (AU-249).
    const rule = (rules: Record<string, ParamValue>[]) =>
      at("boni.mailRule", { rules }, "readMail");
    expect(
      rule([
        { sender: "ejemplo.boletin@example.com", do: "skip" },
        { sender: "ejemplo.club@example.com", do: "collection", collection: events.key },
      ]),
    ).toEqual([]);
    expect(rule([{ sender: "ejemplo.a@example.com", do: "collection" }])).toEqual([
      "param.value@rules.0.collection",
    ]);
    expect(rule([{ sender: "ejemplo.a@example.com", do: "skip", collection: notes.key }])).toEqual([
      "param.value@rules.0.collection",
    ]);
    expect(rule([{ sender: "a".repeat(321), do: "skip" }])).toEqual(["param.value@rules.0.sender"]);
    expect(rule([{ sender: "ejemplo.a@example.com", do: "borrar" }])).toEqual([
      "param.value@rules.0.do",
    ]);
    // «Lectora»: what it looks for among its two, its instructions and examples within the reader's text.
    const reader = (params: Record<string, ParamValue>) =>
      at("boni.mailReader", params, "readMail");
    expect(
      reader({
        modules: ["events"],
        instructions: "Las fechas sin año son de este año.",
        examples: [{ mail: "Quedamos el lunes", want: "Un evento el lunes" }],
      }),
    ).toEqual([]);
    expect(reader({ modules: ["pagos"] })).toEqual(["param.value@modules"]);
    expect(reader({ instructions: "a".repeat(4001) })).toEqual(["param.value@instructions"]);
    expect(reader({ examples: [{ mail: "a".repeat(4001), want: "x" }] })).toEqual([
      "param.value@examples.0.mail",
    ]);
    // A parameter it does not let change is refused, not kept: no «Permiso» either.
    expect(at("boni.mailRule", { permission: "yes" }, "readMail")).toEqual([
      "param.unknown@permission",
    ]);
    expect(at("boni.mailReader", { prompt: "otro" }, "readMail")).toEqual(["param.unknown@prompt"]);
  });

  it("AU-127 · a piece runs through the port it is given, has no write cells but «Crear en la elegida»'s, and in «Probar» changes nothing and says what it would do", async () => {
    const s = sketch(132)
      .step("Llega un correo", BONI_TRIGGERS.mail)
      .step("Regla del remitente", "boni.mailRule")
      .step("Invitación", "boni.mailInvitation")
      .step("Plegar hilo", "boni.fold", { days: 30 }, undefined)
      .arrow("Llega un correo", "Regla del remitente")
      .arrow("Regla del remitente", "Invitación")
      .arrow("Invitación", "Plegar hilo");
    const a = s.build();
    const p = policy();
    const boni = port("readMail");
    const e = await go(a, { boni, policy: p }, { json: MAIL, outside: true });
    expect(e.state).toBe("done");
    expect(boni.calls.map((c) => [c.name, c.type, c.test])).toEqual([
      ["mail.rule", "boni.mailRule", false],
      ["mail.invitation", "boni.mailInvitation", false],
      ["inbox.fold", "boni.fold", false],
    ]);
    const fold = boni.calls[2] as BoniCall;
    expect(fold.automation).toBe(a.id);
    expect(fold.step).toBe(s.id("Plegar hilo"));
    expect(fold.values.days?.value).toBe(30);
    // The first piece gets the mail; each next, the row of the one before, with what Boni's code answered.
    expect(boni.calls[0]?.row?.json).toEqual(MAIL);
    expect(boni.calls[1]?.row?.json).toEqual({ [BONI_VALUE]: "mail.rule" });
    // A piece that does not read is given no way to a model.
    expect(boni.calls.every((c) => c.read === undefined)).toBe(true);
    // What it answers about the mail stays labelled as from outside, whatever label Boni's code gave it.
    for (const id of ["Regla del remitente", "Invitación", "Plegar hilo"]) {
      const out = e.steps[s.id(id)]?.out.main?.[0];
      expect(out?.label.integrity).toBe("external");
    }
    // No cell: the engine asked the policy nothing and saved nothing (what Boni's code changes is decided behind the
    // port, with `decide`, as today). Only «Crear en la elegida» has cells (AU-250).
    expect(p.calls).toEqual([]);
    expect(e.asked).toEqual([]);
    for (const piece of BONI_PIECES.filter((x) => x.type !== CREATE_CHOSEN)) {
      const step = { ...stepOf(piece.type), connections: [cellsFor(events, "yes")] };
      expect(stepChanges(step, { collectionNamed: () => undefined })).toEqual([]);
      for (const c of [notes.key, events.key])
        for (const action of ["create", "update", "remove"] as const)
          expect(consentOf(step, c, action)).toBe(false);
    }
    // «Probar»: the port is told so, changes nothing and says what it would do.
    const trial = port("readMail");
    const t = await go(a, { boni: trial }, { json: MAIL, outside: true, test: true });
    expect(trial.calls.every((c) => c.test)).toBe(true);
    expect(t.steps[s.id("Plegar hilo")]?.out.main?.[0]?.json).toEqual({
      [BONI_VALUE]: "haría inbox.fold",
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

  it("AU-253 · a run whose caller does not say his hand started it is not a hand's: Boni's code is told `schedule`, so a «Regla del remitente» «No leer» is not passed, and only a `user` given says `user`", async () => {
    const s = sketch(133)
      .step("Llega un correo", BONI_TRIGGERS.mail)
      .step("Regla del remitente", "boni.mailRule")
      .arrow("Llega un correo", "Regla del remitente");
    const a = s.build();
    const said = async (startedBy?: "user" | "schedule") => {
      const boni = port("readMail");
      const e = await go(
        a,
        { boni },
        { json: MAIL, outside: true, ...(startedBy ? { startedBy } : {}) },
      );
      expect(e.state).toBe("done");
      return boni.calls.map((c) => c.startedBy);
    };
    expect(await said()).toEqual(["schedule"]);
    expect(await said("schedule")).toEqual(["schedule"]);
    expect(await said("user")).toEqual(["user"]);
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

  it("AU-127 · no Boni step has a «Sí» but «Crear en la elegida»'s cells: lowering an automation of them lowers only those, and none takes a «Permiso»", () => {
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
    // «Crear en la elegida» with a «Sí» Juan gave: an automation that arrives not his comes with it at «Preguntar».
    const chosen = withCells(one(CREATE_CHOSEN).build(), [
      cellsFor(events, "yes"),
      cellsFor(notes),
    ]);
    const low = lowerYes(chosen);
    expect(low.steps[1]?.connections?.map((c) => c.create)).toEqual([
      { mode: "ask" },
      { mode: "ask" },
    ]);
  });
});

/** A model's port that answers every piece's call with `answer` and keeps each call (no model is called). */
function models(answer: (call: PieceCall) => unknown = () => ({})) {
  const calls: PieceCall[] = [];
  const ai: AiPort = {
    read: async () => ({ refused: "no reader here" }),
    piece: async (call) => {
      calls.push(structuredClone(call));
      return { answer: answer(call), model: "modelo-ejemplo" };
    },
  };
  return { ai, calls };
}

/** «Leer correo»'s «Decisora» as Boni's code runs it: its reader is given the subject and chooses, or doubts. */
const decider = (
  options: string[] = [notes.key, events.key],
  texts: (c: BoniCall) => PieceRead["texts"] = (c) => [
    { value: String(c.row?.json.subject), label: c.row?.label ?? OUTSIDE, derived: false },
  ],
) =>
  port("readMail", async (c) => {
    if (c.type !== "boni.mailDecider") return { value: c.name, label: OWN };
    const reply = await c.read?.({ texts: texts(c), options });
    if (!reply) throw new Error("the step gave no reader");
    if ("refused" in reply) throw new Error(reply.refused);
    const chosen = (reply.answer as { collection?: string | null }).collection;
    return {
      rows: [
        chosen
          ? { json: { [CHOSEN.collection]: chosen, [CHOSEN.values]: { [textOf(events)]: "x" } } }
          : { output: BONI_DOUBT, json: { ...(c.row?.json ?? {}) } },
      ],
      label: reply.label,
    };
  });

describe("«Leer correo» remade (F16, §5.17)", () => {
  const filled = (collection: string | number = events.key) =>
    port("readMail", (c) =>
      c.type === "boni.mailFiller"
        ? {
            rows: [
              {
                json: {
                  [CHOSEN.collection]: collection,
                  [CHOSEN.values]: { [textOf(events)]: MAIL.subject },
                },
              },
            ],
            label: OWN,
          }
        : { value: c.name, label: OWN },
    );
  const chosenFlow = (params: Record<string, ParamValue> = {}) =>
    sketch(140)
      .step("Llega un correo", BONI_TRIGGERS.mail)
      .step("Rellenadora", "boni.mailFiller")
      .step("Crear en la elegida", CREATE_CHOSEN, params)
      .arrow("Llega un correo", "Rellenadora")
      .arrow("Rellenadora", "Crear en la elegida");
  const chosenRun = async (
    cells: Connection[],
    opts: { test?: boolean; params?: Record<string, ParamValue>; boni?: BoniPort } = {},
  ) => {
    const s = chosenFlow(opts.params);
    const st = store([notes, events], {}, next);
    const p = policy();
    const e = await go(
      withCells(s.build(), cells),
      { boni: opts.boni ?? filled(), policy: p, collections: st },
      { json: MAIL, outside: true, test: opts.test ?? false },
    );
    return { e, st, p, out: e.steps[s.id("Crear en la elegida")]?.out.main ?? [] };
  };

  it("AU-250 · «Crear en la elegida» creates in the collection its row names, and that collection's «Crear» cell decides: «Preguntar» proposes, «Sí» goes to the policy, «No» creates nothing; it is born with no cell at all", async () => {
    // Born: no connection, so no «Sí» and nothing it may create.
    const born = one(CREATE_CHOSEN).build();
    expect(born.steps[1]?.connections).toBeUndefined();
    expect(stepChanges(born.steps[1] as Step, { collectionNamed: () => undefined })).toEqual([]);
    const none = await chosenRun([]);
    expect(none.e.state).toBe("done");
    expect([none.out, none.e.asked, none.p.calls, none.st.rows(events.key)]).toEqual([
      [],
      [],
      [],
      [],
    ]);

    // «Preguntar»: the policy is asked, and it waits for Juan as from outside; nothing is saved, no row passes.
    const ask = await chosenRun([cellsFor(events)]);
    expect(ask.e.state).toBe("done");
    expect(ask.st.rows(events.key)).toEqual([]);
    expect(ask.out).toEqual([]);
    expect(ask.e.asked.map((x) => [x.kind, x.change])).toEqual([
      [
        "propose",
        { kind: "create", collection: events.key, fields: { [textOf(events)]: MAIL.subject } },
      ],
    ]);
    expect(ask.e.asked[0]?.values[textOf(events)]?.label.integrity).toBe("external");
    expect(ask.p.calls.map((c) => [c.type, c.action, c.collection])).toEqual([
      [CREATE_CHOSEN, "create", events.key],
    ]);

    // «Sí», set by his hand: a write the policy judges (P28) with what came by mail labelled as from outside.
    const yes = await chosenRun([cellsFor(events, "yes")]);
    expect(yes.e.asked).toEqual([]);
    expect(yes.st.rows(events.key).map((r) => r.json)).toEqual([
      { [textOf(events)]: MAIL.subject },
    ]);
    expect(yes.p.calls[0]?.values[textOf(events)]?.label.integrity).toBe("external");
    expect(yes.out.map((r) => r.json)).toEqual([{ [textOf(events)]: MAIL.subject }]);
    // The policy may still say no: then nothing is saved.
    const refusing = await go(
      withCells(chosenFlow().build(), [cellsFor(events, "yes")]),
      {
        boni: filled(),
        policy: policy(() => ({ kind: "deny", rule: "test.deny", reason: "no" })),
        collections: store([notes, events], {}, next),
      },
      { json: MAIL, outside: true },
    );
    expect(refusing.state).toBe("failed");

    // «No» (its cell, or no connection for the collection the row names): nothing created, nothing asked.
    for (const cells of [[cellsFor(events, false)], [cellsFor(notes, "yes")]]) {
      const no = await chosenRun(cells);
      expect([no.out, no.e.asked, no.p.calls, no.st.rows(events.key)]).toEqual([[], [], [], []]);
    }
    // A row that names no collection creates nothing.
    const odd = await chosenRun([cellsFor(events, "yes")], { boni: filled(7) });
    expect([odd.out, odd.e.asked, odd.st.rows(events.key)]).toEqual([[], [], []]);

    // «Probar» with a «Sí»: nothing saved; the row it would save passes on.
    const trial = await chosenRun([cellsFor(events, "yes")], { test: true });
    expect(trial.st.rows(events.key)).toEqual([]);
    expect(trial.out.map((r) => r.json)).toEqual([{ [textOf(events)]: MAIL.subject }]);

    // Its cells are «Crear» only: reading, modifying or removing is refused, and so are limits of what it creates.
    const check = (c: Connection) =>
      errors(withCells(one(CREATE_CHOSEN).build(), [c]), inBoni("readMail"));
    expect(check(cellsFor(events))).toEqual([]);
    expect(check({ ...cellsFor(events), read: {} })).toEqual(["connection.notAllowed@connections"]);
    expect(check({ ...cellsFor(events), update: { mode: "ask" } })).toEqual([
      "connection.notAllowed@connections",
    ]);
    expect(
      check({ ...cellsFor(events), create: { mode: "ask", fields: [textOf(events)] } }),
    ).toEqual(["connection.limits@connections"]);
    expect(check(cellsFor({ key: "t_ninguna" }))).toEqual(["connection.unknown@connections"]);
  });

  it("AU-250 · «Solo conocidos» only narrows a «Sí»: an unknown sender is asked; it never makes a «Preguntar» write", async () => {
    const known = (answer: boolean) => {
      const asked: string[] = [];
      const boni = filled();
      boni.known = async (_row, collection) => {
        asked.push(collection);
        return answer;
      };
      return { boni, asked };
    };
    const stranger = known(false);
    const a = await chosenRun([cellsFor(events, "yes")], {
      params: { onlyKnown: true },
      boni: stranger.boni,
    });
    expect(stranger.asked).toEqual([events.key]);
    expect(a.st.rows(events.key)).toEqual([]);
    expect(a.e.asked.map((x) => x.kind)).toEqual(["propose"]);
    const friend = known(true);
    const b = await chosenRun([cellsFor(events, "yes")], {
      params: { onlyKnown: true },
      boni: friend.boni,
    });
    expect(b.e.asked).toEqual([]);
    expect(b.st.rows(events.key).length).toBe(1);
    // Known or not, a «Preguntar» stays one.
    const c = await chosenRun([cellsFor(events)], {
      params: { onlyKnown: true },
      boni: friend.boni,
    });
    expect(c.st.rows(events.key)).toEqual([]);
    expect(c.e.asked.length).toBe(1);
    // Without a way to know, nobody is known.
    const d = await chosenRun([cellsFor(events, "yes")], { params: { onlyKnown: true } });
    expect(d.st.rows(events.key)).toEqual([]);
    expect(d.e.asked.length).toBe(1);
  });

  it("AU-252 · the «Decisora» answers by «Principal» or by «Duda», and a doubt goes on by its own arrow; an output it does not have fails", async () => {
    const s = sketch(141)
      .step("Llega un correo", BONI_TRIGGERS.mail)
      .step("Decisora", "boni.mailDecider", {
        collections: [{ collection: notes.key }, { collection: events.key }],
      })
      .step("Crear en la elegida", CREATE_CHOSEN)
      .step("Pregunta", "edit", { fields: [{ field: "duda", value: "sí" }] })
      .arrow("Llega un correo", "Decisora")
      .arrow("Decisora", "Crear en la elegida")
      .arrow("Decisora", "Pregunta", BONI_DOUBT);
    const a = withCells(s.build(), [cellsFor(notes), cellsFor(events)]);
    expect(errors(a, inBoni("readMail"))).toEqual([]);
    const sure = models(() => ({ collection: events.key }));
    const e = await go(a, { boni: decider(), ai: sure.ai }, { json: MAIL, outside: true });
    expect(e.state).toBe("done");
    expect(e.steps[s.id("Decisora")]?.out.main?.length).toBe(1);
    expect(e.steps[s.id("Decisora")]?.out[BONI_DOUBT]).toEqual([]);
    expect(e.asked.map((x) => x.change.kind)).toEqual(["create"]);
    expect(e.steps[s.id("Pregunta")]?.state).toBe("skipped");

    const doubt = models(() => ({ collection: null }));
    const d = await go(a, { boni: decider(), ai: doubt.ai }, { json: MAIL, outside: true });
    expect(d.state).toBe("done");
    expect(d.steps[s.id("Decisora")]?.out.main).toEqual([]);
    const row = d.steps[s.id("Decisora")]?.out[BONI_DOUBT]?.[0];
    expect(row?.json).toEqual(MAIL);
    expect(row?.label.integrity).toBe("external");
    expect(d.asked).toEqual([]);
    expect(d.steps[s.id("Pregunta")]?.state).toBe("done");

    const wrong = port("readMail", () => ({ rows: [{ output: "otra", json: {} }], label: OWN }));
    const w = await go(a, { boni: wrong }, { json: MAIL, outside: true });
    expect(w.state).toBe("failed");
  });

  it("AU-255 · a piece's reader is counted, gets only what no label forbids and its panel's own words, and its answer carries the label of all it read", async () => {
    const s = sketch(142)
      .step("Llega un correo", BONI_TRIGGERS.mail)
      .step("Decisora", "boni.mailDecider", {
        collections: [{ collection: notes.key }, { collection: events.key }],
        model: "proveedor:modelo-ejemplo",
      })
      .arrow("Llega un correo", "Decisora");
    const a = s.build();
    const named = {
      ...shapes,
      collection: (k: string) => {
        const c = shapes.collection(k);
        return (
          c && { ...c, name: k === notes.key ? "Notas" : "Eventos", description: "Lo que va." }
        );
      },
    };
    const goNamed = (boni: BoniPort, ai?: AiPort) =>
      run(
        {
          automation: a,
          trigger: s.id("Llega un correo"),
          fields: { json: MAIL, label: OUTSIDE },
          test: false,
        },
        deps({
          boni,
          ...(ai ? { ai } : {}),
          collections: { ...deps().collections, shape: (k) => named.collection(k) },
        }),
      );
    const m = models(() => ({ collection: notes.key }));
    const e = await goNamed(decider(), m.ai);
    expect(e.state).toBe("done");
    // One call, of a decision, with the subject and the panel's collections by their names.
    expect(m.calls.map((c) => [c.use, c.reader, c.model, c.texts])).toEqual([
      ["decision", "decide", "proveedor:modelo-ejemplo", [MAIL.subject]],
    ]);
    expect(m.calls[0]?.options).toEqual([
      { key: notes.key, name: "Notas", description: "Lo que va." },
      { key: events.key, name: "Eventos", description: "Lo que va." },
    ]);
    const record = e.steps[s.id("Decisora")]?.ai;
    expect(record?.calls).toBe(1);
    expect(record?.models).toEqual(["modelo-ejemplo"]);
    // What it answers about the mail is from outside: a model's answer never raises it.
    expect(e.steps[s.id("Decisora")]?.out.main?.[0]?.label.integrity).toBe("external");

    // A text no model may receive: refused before any call.
    const secret: Label = { ...OUTSIDE, noModel: true };
    const shut = models();
    const p = await goNamed(
      decider(undefined, () => [{ value: "privado", label: secret, derived: false }]),
      shut.ai,
    );
    expect(p.state).toBe("failed");
    expect(p.steps[s.id("Decisora")]?.error?.ai?.code).toBe("ai.private");
    expect(shut.calls).toEqual([]);
    // An option its panel does not hold: refused, no call.
    const o = await goNamed(decider([notes.key, "t_otra"]), shut.ai);
    expect(o.steps[s.id("Decisora")]?.error?.ai?.code).toBe("ai.private");
    expect(shut.calls).toEqual([]);
    // No port of the models: nothing is called.
    const u = await goNamed(decider());
    expect(u.steps[s.id("Decisora")]?.error?.ai?.code).toBe("ai.unavailable");
    // A long text is cut to what a reader gets, and counted.
    const long = models(() => ({ collection: notes.key }));
    const l = await goNamed(
      decider(undefined, () => [{ value: "a".repeat(5000), label: OUTSIDE, derived: false }]),
      long.ai,
    );
    expect(long.calls[0]?.texts[0]?.length).toBe(4000);
    expect(l.steps[s.id("Decisora")]?.ai?.cut).toBe(1);
  });

  it("AU-249 · AU-255 · the «Lectora» gets what it looks for and its instructions as his, its «Ejemplos» as from outside, and never a row of his", async () => {
    const reading = (trigger: "mail" | "manual") =>
      sketch(143)
        .step(
          "Inicio",
          trigger === "mail" ? BONI_TRIGGERS.mail : "manual",
          trigger === "mail" ? {} : { fields: [{ key: "text", name: "Texto", type: "text" }] },
        )
        .step("Lectora", "boni.mailReader", {
          modules: ["events"],
          instructions: "Las fechas sin año son de este año.",
          examples: [{ mail: "Quedamos el lunes a las diez", want: "Un evento el lunes" }],
        })
        .arrow("Inicio", "Lectora");
    const m = models(() => ({ events: [] }));
    let label: BoniAnswer["label"] | undefined;
    const reader = port("readMail", async (c) => {
      const reply = await c.read?.({
        texts: [
          { value: String(c.row?.json.text), label: c.row?.label ?? OUTSIDE, derived: false },
        ],
        userIn: "to",
      });
      if (!reply || "refused" in reply) throw new Error("refused");
      label = reply.label;
      return { value: "leído", label: reply.label };
    });
    const s = reading("mail");
    const e = await go(s.build(), { boni: reader, ai: m.ai }, { json: MAIL, outside: true });
    expect(e.state).toBe("done");
    expect(
      m.calls.map((c) => [
        c.use,
        c.reader,
        c.modules,
        c.instructions,
        c.examples,
        c.userIn,
        c.texts,
      ]),
    ).toEqual([
      [
        "reading",
        "read_message",
        ["events"],
        "Las fechas sin año son de este año.",
        [{ mail: "Quedamos el lunes a las diez", want: "Un evento el lunes" }],
        "to",
        [MAIL.text],
      ],
    ]);
    expect(label?.integrity).toBe("external");
    expect(e.steps[s.id("Lectora")]?.out.main?.[0]?.label.integrity).toBe("external");
    // A row of his own (here, what he typed to start it) is no mail: refused before any call.
    const own = models();
    const mine = reading("manual");
    const o = await go(mine.build(), { boni: reader, ai: own.ai }, { json: { text: MAIL.text } });
    expect(o.state).toBe("failed");
    expect(o.steps[mine.id("Lectora")]?.error?.ai?.code).toBe("ai.private");
    expect(own.calls).toEqual([]);
  });
});
