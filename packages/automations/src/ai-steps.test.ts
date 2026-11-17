// The four reader steps in the engine (docs/automatizaciones.md §5.6 and §6, phase F15): «Extraer datos»,
// «Clasificar», «Resumir» and «Escribir texto», and what never reaches a model (AU-57, AU-166).
//
// The engine runs them with a scripted reader behind the port it receives (`RunDeps.ai`): no model is called and no
// provider is imported (A-02). Rows are shaped like the user's: generated keys and ids, a text, a number and an
// option, from a store per test, and 3,000 of them where the batches are timed (A-15).
import { type Label, label } from "@boni/entities";
import { clock as now, under } from "@boni/pace";
import { describe, expect, it } from "vitest";
import {
  type AiPort,
  READER_BATCH,
  READER_TEXT_CHARS,
  type ReaderCall,
  type ReaderReply,
  readRows,
} from "./ai.ts";
import { collection, ids, knowing, sketch } from "./automation.test-util.ts";
import { actionOf, paramsOf, specOf } from "./catalogue.ts";
import { newConnection } from "./connections.ts";
import type { CollectionShape } from "./effects.ts";
import { type Execution, type RunDeps, run } from "./engine.ts";
import { resolve } from "./expression.ts";
import { ACTION, type Automation, type Step } from "./format.ts";
import type { Row } from "./rows.ts";
import { deps, OUTSIDE, OWN, store } from "./run.test-util.ts";
import { validate } from "./validate.ts";

const next = ids(157);
/** Shaped like his: generated keys; a text (a mail's body, say), a number and an option. */
const notes = collection(next, ["text", "number", "select"]);
const [body, amount, kind] = notes.fields.map((f) => f.key) as [string, string, string];
/** Another collection, whose AI access is `opaque`: every value read from it carries `noModel` (AU-166). */
const hidden = collection(next, ["text", "number"]);
const [secret] = hidden.fields.map((f) => f.key) as [string];
const PRIVATE: Label = {
  ...label("own", "personal", [{ kind: "vault", id: "e_ejemplo" }]),
  noModel: true,
};

const ROWS = (n: number, text = (i: number) => `texto de ejemplo ${i}`) =>
  Array.from({ length: n }, (_, i) => ({
    [body]: text(i),
    [amount]: i,
    [kind]: i % 2 ? "abierta" : "cerrada",
  }));

/** A scripted reader: answers what `answer` says for each call, and keeps every call it was asked. */
function scripted(
  answer: (call: ReaderCall, n: number) => ReaderReply = valid,
): AiPort & { calls: ReaderCall[] } {
  const calls: ReaderCall[] = [];
  return {
    calls,
    async read(call) {
      calls.push(structuredClone(call));
      return answer(call, calls.length);
    },
  };
}
const MODEL = "modelo-de-ejemplo";
/** An answer of the right shape for any reader: the first option, a line, a text, every field empty. */
function valid(call: ReaderCall): ReaderReply {
  const first = call.options?.[0] ?? null;
  switch (call.reader) {
    case "label_each":
      return { answer: { choices: call.texts.map(() => first) }, model: MODEL };
    case "classify":
      return { answer: { choice: first }, model: MODEL };
    case "summarize_each":
      return { answer: { items: call.texts.map((t) => ({ line: t.slice(0, 20) })) }, model: MODEL };
    case "summarize":
    case "rewrite":
      return { answer: { text: "un texto escrito" }, model: MODEL };
    case "fill":
      return {
        answer: Object.fromEntries((call.fields ?? []).map((f) => [f.key, null])),
        model: MODEL,
      };
  }
}

const cite = (key: string) => ({ expr: `{{ $json.${key} }}` });
const OPTIONS = ["factura", "aviso", "otro"];

/** «Inicio» → «Buscar» (every row of a collection) → the reader. */
function reading(
  type: string,
  params: Record<string, unknown>,
  settings?: Step["settings"],
  from: CollectionShape = notes,
): { automation: Automation; reader: string } {
  const s = sketch(158)
    .step("Inicio", "manual")
    .step("Buscar", "collection", { collection: from.key, [ACTION]: "find", limit: 5000 })
    .step("Leer", type, params as Step["params"], settings)
    .arrow("Inicio", "Buscar")
    .arrow("Buscar", "Leer");
  return { automation: s.build(), reader: s.id("Leer") };
}

const go = (automation: Automation, over: Partial<RunDeps>): Promise<Execution> =>
  run(
    {
      automation,
      trigger: automation.steps[0]?.id as string,
      fields: { json: {}, label: OWN },
      test: false,
    },
    deps(over),
  );

const db = (n: number, of: Label = OWN, text?: (i: number) => string) =>
  store([notes], { [notes.key]: ROWS(n, text) }, ids(159), of);

describe("the reader steps (F15)", () => {
  it("AU-57 · each of the four shows its parameters and no more, takes no connection, and uses the reader role", async () => {
    const shown = (type: string) =>
      paramsOf({ id: "s_x", name: "x", type, params: {} })
        .filter((p) => p.place === "shown")
        .map((p) => p.key);
    // The table of AU-57: «Texto», what each needs, «Modelo»; «Largo» of «Resumir» behind «Añadir opción».
    expect(shown("extract")).toEqual(["text", "fields", "model"]);
    expect(shown("classify")).toEqual(["text", "options", "model"]);
    expect(shown("summarize")).toEqual(["text", "model"]);
    expect(shown("write")).toEqual(["instructions", "text", "model"]);
    expect(
      paramsOf({ id: "s_x", name: "x", type: "summarize", params: {} }).map((p) => p.key),
    ).toEqual(["text", "model", "length"]);
    for (const type of ["extract", "classify", "summarize", "write"]) {
      const action = actionOf({ id: "s_x", name: "x", type, params: {} });
      // Row by row, each row out paired to its own, nothing read or written in a collection.
      expect(action).toMatchObject({ effect: "none", mode: "perRow", pairs: true });
      expect(specOf(type)?.category).toBe("ai");
    }

    const { automation, reader } = reading("classify", { text: cite(body), options: OPTIONS });
    // A type only where a model can be called (`ai`), as «Código» only with a box.
    expect(validate(automation, knowing(notes)).map((p) => p.code)).toEqual(["step.unknownType"]);
    expect(validate(automation, { ...knowing(notes), ai: true })).toEqual([]);
    // No connection (AU-46): a reader does not read or write a collection.
    const joined = structuredClone(automation);
    const step = joined.steps.find((x) => x.id === reader) as Step;
    step.connections = [newConnection(notes.key)];
    expect(
      validate(joined, { ...knowing(notes), ai: true }).some(
        (p) => p.step === reader && p.code.startsWith("connection."),
      ),
    ).toBe(true);
    // Something that is not a parameter of the step does not validate: no keys, temperature or tokens.
    const extra = structuredClone(automation);
    (extra.steps.find((x) => x.id === reader) as Step).params.temperature = 0.2;
    expect(validate(extra, { ...knowing(notes), ai: true }).map((p) => p.code)).toEqual([
      "param.unknown",
    ]);
    // «Extraer datos» takes at most 12 fields.
    const fields = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ key: `campo${i}`, type: "text", line: "" }));
    const many = reading("extract", { text: cite(body), fields: fields(13) });
    expect(validate(many.automation, { ...knowing(notes), ai: true }).map((p) => p.param)).toEqual([
      "fields",
    ]);

    // Every call spends the use «Lector» with the step's «Modelo» or «El de la cuenta» (null), and the record says
    // which model answered.
    for (const [type, params] of [
      ["extract", { text: cite(body), fields: fields(2), model: "lector-b" }],
      ["classify", { text: cite(body), options: OPTIONS }],
      ["summarize", { text: cite(body) }],
      ["write", { instructions: "Escribe una línea amable", text: cite(body) }],
    ] as const) {
      const ai = scripted();
      const r = reading(type, params);
      const e = await go(r.automation, { collections: db(3), ai });
      expect(e.state).toBe("done");
      expect(ai.calls.length).toBeGreaterThan(0);
      for (const c of ai.calls) {
        expect(c.use).toBe("reader");
        expect(c.model).toBe(type === "extract" ? "lector-b" : null);
      }
      expect(e.steps[r.reader]?.ai).toMatchObject({
        calls: ai.calls.length,
        models: [MODEL],
        cut: 0,
      });
    }
  });

  it("AU-57 · a reader's output carries its input's label: what comes out of a text from outside is from outside", async () => {
    const { automation, reader } = reading("classify", { text: cite(body), options: OPTIONS });
    const outside = await go(automation, { collections: db(4, OUTSIDE), ai: scripted() });
    const rows = outside.steps[reader]?.out.main as Row[];
    expect(rows.map((r) => r.json.clase)).toEqual(["factura", "factura", "factura", "factura"]);
    for (const r of rows) {
      const own = r.fields?.clase;
      // From outside, as its text, and written by a model: derived, never a destination (P14).
      expect(own?.label.integrity).toBe("external");
      expect(own?.label.sources).toEqual(
        expect.arrayContaining([
          ...OUTSIDE.sources,
          { kind: "model", id: `${automation.id}:${reader}` },
        ]),
      );
      expect(own?.derived).toBe(true);
      // The rest of the row is as it came in.
      expect(r.label).toBe(OUTSIDE);
      expect(r.json[amount]).toBeTypeOf("number");
    }
    // A text of his own gives what a model wrote: never more than `model`, so it is never his own.
    const own = await go(automation, { collections: db(2, OWN), ai: scripted() });
    for (const r of (own.steps[reader]?.out.main ?? []) as Row[])
      expect(r.fields?.clase?.label.integrity).toBe("model");
  });

  it("AU-57 · a reader receives its text and its options only, never the user's own data next to a text from outside", async () => {
    const ai = scripted();
    // The options are an expression over the row: each row's list goes with its text, and nothing else of the row.
    const { automation } = reading("classify", {
      text: cite(body),
      options: { expr: `{{ $json.${kind} }}` },
    });
    // An expression that is not a list fails its row (`ai.params`); a list per row: written as one.
    const listed = structuredClone(automation);
    (listed.steps[2] as Step).params.options = [{ expr: `{{ $json.${kind} }}` }, "otro"];
    const e = await go(listed, { collections: db(4, OUTSIDE), ai });
    expect(e.state).toBe("done");
    const keys = new Set(ai.calls.flatMap((c) => Object.keys(c)));
    expect([...keys].sort()).toEqual(["model", "options", "reader", "texts", "use"]);
    // Grouped by what goes with them: the rows with the same options share a call, in their order.
    expect(ai.calls.map((c) => [c.options, c.texts])).toEqual([
      [
        ["cerrada", "otro"],
        ["texto de ejemplo 0", "texto de ejemplo 2"],
      ],
      [
        ["abierta", "otro"],
        ["texto de ejemplo 1", "texto de ejemplo 3"],
      ],
    ]);
    // No number, no other field, no id of a saved row: what is sent is a closed list (`ReaderCall`).
    const sent = JSON.stringify(ai.calls);
    for (const r of db(4).rows(notes.key)) expect(sent).not.toContain(r.origin.id);
    expect(sent).not.toContain(amount);

    const bad = await go(automation, {
      collections: db(2),
      ai: scripted(),
    });
    expect(bad.state).toBe("failed");
    expect(bad.error).toMatchObject({
      failure: { code: "other", param: "options" },
      ai: { code: "ai.params", detail: { why: "options" } },
    });
  });

  it("AU-57 · 120 rows go to a list reader in batches of 50, and a text over 4,000 characters is cut and the output says so", async () => {
    const ai = scripted();
    const long = "a".repeat(READER_TEXT_CHARS + 900);
    const { automation, reader } = reading("summarize", { text: cite(body) });
    const e = await go(automation, {
      collections: db(120, OWN, (i) => (i === 7 ? long : `texto ${i}`)),
      ai,
    });
    expect(e.state).toBe("done");
    expect(ai.calls.map((c) => [c.reader, c.texts.length])).toEqual([
      ["summarize_each", 50],
      ["summarize_each", 50],
      ["summarize_each", 20],
    ]);
    expect(ai.calls[0]?.texts[7]).toHaveLength(READER_TEXT_CHARS);
    expect(e.steps[reader]?.ai).toMatchObject({ calls: 3, cut: 1, models: [MODEL] });
    expect(e.steps[reader]?.out.main).toHaveLength(120);
    expect(e.steps[reader]?.out.main?.[1]?.json.resumen).toBe("texto 1");
    // «Largo» medio or largo: one text per call (`summarize`), saying the length.
    const one = scripted();
    const medium = reading("summarize", { text: cite(body), length: "medium" });
    await go(medium.automation, { collections: db(3), ai: one });
    expect(one.calls.map((c) => [c.reader, c.texts.length, c.length])).toEqual([
      ["summarize", 1, "medium"],
      ["summarize", 1, "medium"],
      ["summarize", 1, "medium"],
    ]);
    // An empty text gives an empty field with no call.
    const none = scripted();
    const empty = await go(reading("summarize", { text: cite(body) }).automation, {
      collections: db(3, OWN, () => "  "),
      ai: none,
    });
    expect(none.calls).toEqual([]);
    expect(empty.steps[reader]?.out.main?.map((r) => r.json.resumen)).toEqual([null, null, null]);
  });

  it("AU-57 · «Clasificar» returns one of its options or nothing; an output outside the shape is retried once and then fails the step", async () => {
    const { automation, reader } = reading("classify", { text: cite(body), options: OPTIONS });
    // One option or nothing: «nada» is the reader's null.
    const some = scripted((c) => ({
      answer: { choices: c.texts.map((_, i) => (i ? null : "aviso")) },
      model: MODEL,
    }));
    const e = await go(automation, { collections: db(3), ai: some });
    expect(e.steps[reader]?.out.main?.map((r) => r.json.clase)).toEqual(["aviso", null, null]);

    // Outside its options the first time, right the second: asked again once, saying why, and both calls count.
    const late = scripted((c, n) =>
      n === 1 ? { answer: { choices: c.texts.map(() => "inventada") }, model: MODEL } : valid(c),
    );
    const again = await go(automation, { collections: db(3), ai: late });
    expect(again.state).toBe("done");
    expect(late.calls.map((c) => c.again)).toEqual([undefined, { fault: "choice" }]);
    expect(again.steps[reader]?.ai?.calls).toBe(2);

    // Wrong twice: the rows of that batch fail by «Si falla»; with «Parar» (the default), the step and the run.
    const never = scripted((c) => ({ answer: { choices: c.texts.map(() => 7) }, model: MODEL }));
    const failed = await go(automation, { collections: db(3), ai: never });
    expect(never.calls).toHaveLength(2);
    expect(failed.state).toBe("failed");
    expect(failed.error).toMatchObject({
      row: 0,
      failure: { code: "other" },
      ai: { code: "ai.reply", detail: { reader: "label_each", why: "choice" } },
    });
    // A step retry does not call the model again: what the reader decided for a row is decided.
    const stubborn = scripted((c) => ({ answer: { choices: [] }, model: MODEL }));
    const retried = reading(
      "classify",
      { text: cite(body), options: OPTIONS },
      {
        retry: { times: 2, waitMs: 0 },
        onError: "continue",
      },
    );
    const r = await go(retried.automation, { collections: db(3), ai: stubborn });
    expect(stubborn.calls).toHaveLength(2);
    expect(r.state).toBe("done");
    expect(r.steps[retried.reader]?.failed).toBe(3);
    // The provider saying no is not retried: each row fails with its key.
    const refusing = scripted(() => ({ refused: "budget" }));
    const refused = await go(automation, { collections: db(3), ai: refusing });
    expect(refusing.calls).toHaveLength(1);
    expect(refused.error?.ai).toEqual({ code: "ai.refused", detail: { why: "budget" } });
  });

  it("AU-57 · «Escribir texto» and «Extraer datos» put what the model wrote in the row, as plain text: a link or HTML is asked again and then refused", async () => {
    // «Escribir texto»: the row with `texto`, the model's label on it.
    const write = reading("write", { instructions: "Escribe una línea", text: cite(body) });
    const wrote = await go(write.automation, { collections: db(2, OUTSIDE), ai: scripted() });
    const rows = wrote.steps[write.reader]?.out.main ?? [];
    expect(rows.map((r) => r.json.texto)).toEqual(["un texto escrito", "un texto escrito"]);
    expect(rows[0]?.fields?.texto?.label.integrity).toBe("external");

    // «Extraer datos»: its fields, typed, land in the row.
    const fields = [
      { key: "importe", type: "number", line: "lo que se paga" },
      { key: "concepto", type: "text", line: "" },
    ];
    const extract = reading("extract", { text: cite(body), fields });
    const filled = scripted((c) =>
      c.reader === "fill"
        ? { answer: { importe: 12.5, concepto: "agua" }, model: MODEL }
        : valid(c),
    );
    const got = await go(extract.automation, { collections: db(2), ai: filled });
    expect(
      got.steps[extract.reader]?.out.main?.map((r) => [r.json.importe, r.json.concepto]),
    ).toEqual([
      [12.5, "agua"],
      [12.5, "agua"],
    ]);
    // A number given as text does not fit its field.
    const wrongType = scripted(() => ({
      answer: { importe: "12", concepto: "agua" },
      model: MODEL,
    }));
    const typed = await go(extract.automation, { collections: db(1), ai: wrongType });
    expect(wrongType.calls).toHaveLength(2);
    expect(typed.error?.ai).toMatchObject({ code: "ai.reply", detail: { reader: "fill" } });

    // A link or HTML in what a model wrote is asked again once, then the row fails: it is never painted.
    for (const text of ["mira https://ejemplo.example", "<b>hola</b>"]) {
      const linking = scripted(() => ({ answer: { text }, model: MODEL }));
      const linked = await go(write.automation, { collections: db(1), ai: linking });
      expect(linking.calls).toHaveLength(2);
      expect(linking.calls[1]?.again).toBeDefined();
      expect(linked.state).toBe("failed");
      expect(linked.error?.ai).toMatchObject({ code: "ai.reply", detail: { reader: "rewrite" } });
    }

    // With no port to call (a server without models), a reader is not a step this run knows: it is refused before it
    // starts, as at publishing, and nothing is read.
    await expect(go(write.automation, { collections: db(2) })).rejects.toThrow(
      "the automation has errors",
    );
  });

  it("AU-166 · a value that no model may receive, arriving at a reader's text, fails that row (`ai.private`) by the step's «Si falla», naming the field and never the value", async () => {
    const SECRET = "valor-que-no-sale";
    const both = store(
      [notes, hidden],
      { [notes.key]: ROWS(2), [hidden.key]: [{ [secret]: SECRET }] },
      ids(160),
    );
    // The private collection's rows carry `noModel` (the server sets it on reading an `opaque` collection).
    const labelled = {
      ...both,
      async find(q: Parameters<typeof both.find>[0]) {
        const rows = await both.find(q);
        return q.collection === hidden.key ? rows.map((r) => ({ ...r, label: PRIVATE })) : rows;
      },
    };
    // Two searches into one reader: his rows, and one of the private collection.
    const s = sketch(161)
      .step("Inicio", "manual")
      .step("Notas", "collection", { collection: notes.key, [ACTION]: "find" })
      .step("Privada", "collection", { collection: hidden.key, [ACTION]: "find" })
      .step(
        "Resumir",
        "summarize",
        { text: { expr: `Resume: {{ $json.${body} }}{{ $json.${secret} }}` } },
        {
          onError: "errorOutput",
        },
      )
      .arrow("Inicio", "Notas")
      .arrow("Inicio", "Privada")
      .arrow("Notas", "Resumir")
      .arrow("Privada", "Resumir");
    const ai = scripted();
    const e = await go(s.build(), { collections: labelled, ai });
    const step = e.steps[s.id("Resumir")];
    expect(e.state).toBe("done");
    // His two rows are read; the private one never reaches the reader.
    expect(step?.out.main).toHaveLength(2);
    expect(ai.calls.flatMap((c) => c.texts)).toHaveLength(2);
    expect(JSON.stringify(ai.calls)).not.toContain(SECRET);
    // That row goes out by «error», saying the field and the collection, never the value.
    expect(step?.out.error).toHaveLength(1);
    expect(step?.failed).toBe(1);
    expect(step?.error).toMatchObject({
      row: 2,
      failure: { code: "other", param: "text" },
      ai: { code: "ai.private", param: "text", detail: { field: secret, collection: hidden.key } },
    });
    expect(JSON.stringify(step?.error)).not.toContain(SECRET);
  });

  it("AU-206 · a reader's calls count, retries included: the call that would pass «Llamadas a modelos» is not made and the run stops with `run.limit`", async () => {
    const { automation, reader } = reading("classify", { text: cite(body), options: OPTIONS });
    automation.settings = { limits: { modelCalls: 3 } };
    // 120 rows: three batches. The first is answered wrong and asked again: the third call is the last one allowed.
    const ai = scripted((c, n) => (n === 1 ? { answer: { choices: [] }, model: MODEL } : valid(c)));
    const e = await go(automation, { collections: db(120), ai });
    expect(ai.calls).toHaveLength(3);
    expect(e.state).toBe("failed");
    expect(e.error).toMatchObject({
      step: reader,
      failure: { code: "run.limit", detail: { limit: "modelCalls", max: 3, got: 4 } },
    });
    // Nothing of the step came out: the run stopped before its units. What it spent is still in its record (AU-54).
    expect(e.steps[reader]?.out.main).toEqual([]);
    expect(e.steps[reader]?.ai).toMatchObject({ calls: 3, models: [MODEL] });
  });

  it("AU-57 · 3,000 rows shaped like his go through a list reader in batches: what costs is the calls, not the engine (A-15)", async () => {
    // At most 40 calls a run (the ceiling of «Llamadas a modelos», AU-206) at 50 rows a call: 2,000 rows in one run;
    // 1,000 with the default 20. Measured on 2026-11-17 (five runs): the 2,000-row run, its search, 40 batches and
    // 2,000 units, 65 to 77 ms; the batching alone of 3,000 rows into 60 calls, 35 to 57 ms. What a batch size decides
    // is how many calls a run makes, which its limit counts; a model's own time per call is not measured here.
    const ai = scripted();
    const { automation, reader } = reading("classify", { text: cite(body), options: OPTIONS });
    automation.settings = { limits: { modelCalls: 40 } };
    const t0 = now();
    const e = await go(automation, { collections: db(2000, OUTSIDE), ai });
    const ms = now() - t0;
    expect(e.state).toBe("done");
    expect(ai.calls).toHaveLength(40);
    expect(e.steps[reader]?.out.main).toHaveLength(2000);
    under(ms, 400, "clock", "a run of 2,000 rows through a list reader");

    // The batching alone over 3,000 rows: 60 calls of 50, in the order of the rows.
    const rows: Row[] = ROWS(3000).map((json) => ({
      json,
      label: OUTSIDE,
      path: null,
      parent: null,
    }));
    const port = scripted();
    const t1 = now();
    const got = await readRows({
      step: automation.steps[2] as Step,
      rows,
      scope: (current) => ({ current, literal: OWN, row: () => rows[0] as Row }),
      resolve,
      port,
      modelCall: () => {},
      now: () => 0,
      model: OWN,
    });
    under(now() - t1, 250, "clock", "batching 3,000 rows for a list reader");
    expect(port.calls).toHaveLength(3000 / READER_BATCH);
    expect(got.outcomes).toHaveLength(3000);
  });
});
