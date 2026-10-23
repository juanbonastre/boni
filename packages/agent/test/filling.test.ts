import { label } from "@boni/entities";
import { afterEach, describe, expect, it } from "vitest";
import { checkAnswers, JevProvider } from "../src/decider.ts";
import {
  checkFill,
  type FillField,
  fillQuestions,
  fromAnswers,
  readFields,
} from "../src/filling.ts";
import { fakePlanner, type ModelRequest, ScriptedProvider } from "../src/providers.ts";
import { leaf } from "../src/values.ts";
import { type Env, makeEnv, OWN } from "./fixture.ts";

/** Invented fields: a select, a relation-like choice and a checkbox. */
const FIELDS: FillField[] = [
  {
    key: "prioridad",
    name: "Prioridad",
    kind: "choice",
    options: [
      { value: "o_alta", label: "Alta" },
      { value: "o_baja", label: "Baja" },
    ],
  },
  { key: "hecho", name: "Hecho", kind: "check", options: [] },
];
const codeFields = (f: unknown = FIELDS) =>
  leaf(f as never, label("own", "personal", [{ kind: "code", id: "fill" }]));

describe("filling a proposal's fields (filling.ts)", () => {
  it("the fields are checked again: closed sets, limits, no repeated keys", () => {
    expect(readFields(FIELDS)).toEqual(FIELDS);
    expect(readFields([])).toBeNull();
    expect(readFields([{ ...FIELDS[0], options: [] }])).toBeNull();
    expect(readFields([FIELDS[1], FIELDS[1]])).toBeNull();
    expect(readFields([{ ...FIELDS[1], key: "no keys with spaces" }])).toBeNull();
  });

  it("a reader's answer: each value one of its field's, the note plain text without links", () => {
    expect(checkFill({ values: { f0: "Alta", f1: true }, note: "En el aula 3." }, FIELDS)).toEqual({
      values: { prioridad: "o_alta", hecho: true },
      note: "En el aula 3.",
    });
    expect(checkFill({ values: { f0: null, f1: null }, note: null }, FIELDS)).toEqual({
      values: { prioridad: null, hecho: null },
      note: null,
    });
    // An option it made up, an extra field: refused.
    expect(checkFill({ values: { f0: "Urgente", f1: null }, note: null }, FIELDS)).toBeNull();
    expect(checkFill({ values: { f0: null, f1: null, f2: "x" }, note: null }, FIELDS)).toBeNull();
    // A link in the note: the note is dropped, not the values.
    expect(
      checkFill({ values: { f0: "Baja", f1: null }, note: "Mira https://example.com" }, FIELDS)
        ?.note,
    ).toBeNull();
  });

  it("the decider's answers: kept only when both orders agree with enough confidence", () => {
    const q = fillQuestions(FIELDS);
    expect(Object.keys(q)).toEqual(["f0", "f0r", "f1", "note"]);
    const choice = (c: string, confidence: number) => ({
      type: "choice" as const,
      choice: c,
      confidence,
    });
    const sure = fromAnswers(
      {
        f0: choice("Alta", 0.9),
        f0r: choice("Alta", 0.8),
        f1: { type: "noul", noul: 0.9 },
        note: { type: "noul", noul: 0.7 },
      },
      FIELDS,
    );
    expect(sure).toEqual({ values: { prioridad: "o_alta", hecho: true }, wantsNote: true });
    // The order changed its answer, it was not sure, or it said none: nothing is filled.
    const pairs: [ReturnType<typeof choice>, ReturnType<typeof choice>][] = [
      [choice("Alta", 0.9), choice("Baja", 0.9)],
      [choice("Alta", 0.9), choice("Alta", 0.4)],
      [choice("Ninguna: el correo no lo dice", 0.9), choice("Ninguna: el correo no lo dice", 0.9)],
    ];
    for (const [a, b] of pairs)
      expect(
        fromAnswers(
          { f0: a, f0r: b, f1: { type: "noul", noul: 0.5 }, note: { type: "noul", noul: 0.1 } },
          FIELDS,
        ),
      ).toEqual({ values: { prioridad: null, hecho: null }, wantsNote: false });
    // An answer outside the options is refused by the code before anything else.
    expect(checkAnswers({ f0: choice("Urgente", 1) }, { f0: q.f0 as never })).toBeNull();
  });

  it("Jev's API: the request carries the state and the questions; a bad answer is an error", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const jev = new JevProvider({
      apiKey: "k",
      via: "typesafe",
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(
          JSON.stringify({
            model: "jev-1.14.0",
            answers: { a: { type: "noul", noul: 0.2 } },
            usage: { input_tokens: 31, output_tokens: 2 },
          }),
        );
      }) as typeof fetch,
    });
    const r = await jev.complete({
      role: "decider",
      system: "",
      input: { state: "Hola", questions: { a: { type: "noul", instructions: "¿Pide algo?" } } },
      schema: {},
      maxTokens: 0,
    });
    expect(calls[0]?.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(calls[0]?.body).toMatchObject({ model: "jev-1.14.0", state: "Hola" });
    expect(r).toEqual({
      json: { a: { type: "noul", noul: 0.2 } },
      usage: { input: 31, output: 0 },
      model: "jev-1.14.0",
    });
    await expect(
      jev.complete({
        role: "decider",
        system: "",
        input: { state: "Hola", questions: { b: { type: "noul", instructions: "¿?" } } },
        schema: {},
        maxTokens: 0,
      }),
    ).rejects.toMatchObject({ code: "bad-answer" });
  });
});

describe("the fill reader in a plan (agent.ts)", () => {
  let env: Env | undefined;
  afterEach(() => env?.close());
  const MAIL = {
    asunto: "Revisión",
    de: "coordinacion@example.com",
    cuerpo: "Antes del viernes, revisa el acta. Es urgente. Está en la carpeta compartida.",
  };
  const prepare = () => {
    env = makeEnv([MAIL]);
    env.store.applySchema(
      {
        op: "add_field",
        type: "t_tarea",
        field: {
          id: "f_prio",
          key: "prioridad",
          name: "Prioridad",
          type: "select",
          options: [
            { id: "o_alta", name: "Alta", label: OWN },
            { id: "o_baja", name: "Baja", label: OWN },
          ],
          label: OWN,
        },
      },
      { actor: "import" },
    );
    return env;
  };
  const plan = {
    version: 1,
    steps: [
      { id: "m", op: "call", tool: "entities.query", args: { type: { lit: "correo" } } },
      {
        id: "r",
        op: "read",
        reader: "read_message",
        input: { ref: "$m.items[0].cuerpo" },
        params: { modules: { fn: "list", args: [{ lit: "tasks" }] }, user_in: { lit: "to" } },
      },
      {
        id: "f",
        op: "read",
        reader: "fill",
        each: { ref: "$r.tasks" },
        input: {
          fn: "concat",
          args: [{ ref: "$m.items[0].cuerpo" }, { lit: "\n\nElemento: " }, { ref: "$item.title" }],
        },
        params: { fields: { ref: "$fields" } },
      },
      {
        id: "c",
        op: "call",
        tool: "entities.create",
        each: { ref: "$r.tasks" },
        zip: { ref: "$f" },
        why: { ref: "$item.quote" },
        args: {
          type: { lit: "tarea" },
          values: {
            fn: "obj",
            args: [
              { lit: "titulo" },
              { ref: "$item.title" },
              { lit: "prioridad" },
              { ref: "$zip.values.prioridad" },
              { lit: "hecho" },
              { ref: "$zip.values.hecho" },
              { lit: "body" },
              { ref: "$zip.note" },
            ],
          },
        },
      },
    ],
  };
  const reading = (req: ModelRequest) =>
    /find what it asks of the user/.test(req.system)
      ? {
          items: [
            {
              quote: "revisa el acta",
              actor: "recipient",
              kind: "task",
              title: "Revisar el acta",
              due: null,
            },
          ],
        }
      : null;
  const rowsOf = (e: Env) =>
    e.store.journal
      .proposals("pending")
      .map((p) => (p.view as { rows: { arg: string; value: unknown }[] }).rows);

  it("with Jev: it chooses among the code's options and the reader writes only the note", async () => {
    const e = prepare();
    const decisions: ModelRequest[] = [];
    const decider = new ScriptedProvider("jev", (req) => {
      decisions.push(req);
      return {
        f0: { choice: "Alta", confidence: 0.9 },
        f0r: { choice: "Alta", confidence: 0.85 },
        f1: { noul: 0.1 },
        note: { noul: 0.8 },
      };
    });
    const reader = new ScriptedProvider(
      "fake",
      (req) => reading(req) ?? { note: "Está en la carpeta compartida." },
    );
    const res = await e
      .agent(fakePlanner([]), reader, { decider })
      .background(plan, { fields: codeFields() });
    expect(res.error).toBeNull();
    // The decider saw the mail and the item, never a field it could not choose from.
    expect(decisions[0]?.role).toBe("decider");
    expect((decisions[0]?.input as { state: string } | undefined)?.state).toContain(
      "Elemento: Revisar el acta",
    );
    expect(
      reader.requests.map((r) => (r.schema as { properties: object }).properties),
    ).toHaveLength(2);
    const [rows] = rowsOf(e);
    const v = (arg: string) => rows?.find((r) => r.arg === arg)?.value;
    expect(v("values.titulo")).toBe("Revisar el acta");
    expect(v("values.prioridad")).toBe("o_alta");
    expect(v("values.body")).toBe("Está en la carpeta compartida.");
    expect(rows?.some((r) => r.arg === "values.hecho")).toBe(false); // not sure: left empty
    // The quote is its reason.
    const p = e.store.journal.proposals("pending")[0];
    expect((p?.args as { why: { value: string } } | undefined)?.why.value).toBe("revisa el acta");
  });

  it("without Jev (or with Jev down) the reader fills it in one call", async () => {
    const e = prepare();
    const reader = new ScriptedProvider("fake", (req) => {
      const r = reading(req);
      if (r) return r;
      expect((req.input as { fields: unknown }).fields).toEqual([
        { id: "f0", name: "Prioridad", options: ["Alta", "Baja"] },
        { id: "f1", name: "Hecho", checkbox: true },
      ]);
      return { values: { f0: "Baja", f1: null }, note: null };
    });
    const down = new ScriptedProvider("jev", () => {
      throw Object.assign(new Error("x"), { code: "http-529" });
    });
    const res = await e
      .agent(fakePlanner([]), reader, { decider: down })
      .background(plan, { fields: codeFields() });
    expect(res.error).toBeNull();
    const [rows] = rowsOf(e);
    expect(rows?.find((r) => r.arg === "values.prioridad")?.value).toBe("o_baja");
    expect(rows?.some((r) => r.arg === "values.body")).toBe(false);
  });

  it("the fields must be the code's: unbound, or Juan's data passed as fields, stops it", async () => {
    const e = prepare();
    const reader = new ScriptedProvider(
      "fake",
      (req) => reading(req) ?? { values: {}, note: null },
    );
    const agent = e.agent(fakePlanner([]), reader);
    expect((await agent.background(plan)).error).toBe("plan-invalid");
    // Juan's own task titles as "fields" next to the mail: R1.
    const leak = {
      ...plan,
      steps: plan.steps.map((s) =>
        s.id === "f" ? { ...s, params: { fields: { ref: "$t.items" } } } : s,
      ),
    };
    leak.steps.unshift({
      id: "t",
      op: "call",
      tool: "entities.query",
      args: { type: { lit: "tarea" } },
    });
    expect((await agent.background(leak)).error).toBe("R1-private-data-to-reader");
    // Code-labelled but not fields (an option made up): refused before any model call.
    expect(
      (
        await agent.background(plan, {
          fields: codeFields([{ key: "x", name: "X", kind: "choice", options: [] }]),
        })
      ).error,
    ).toBe("reader-bad-fields");
  });
});
