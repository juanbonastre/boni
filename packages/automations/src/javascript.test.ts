// Reading JavaScript before it runs (docs/automatizaciones.md §5.3, §5.4, §6; javascript.ts, expression.ts). Real
// tests read code as text and run none: no box, no store. Step, field and collection names in them are invented and
// say nothing of anyone's data (D-14).
import { describe, expect, it } from "vitest";
import { collection, ids, knowing, sketch } from "./automation.test-util.ts";
import { CODE_LIMITS, CODE_TYPE } from "./code.ts";
import { newConnection } from "./connections.ts";
import { codeParts, joinParts, parseExpression, printExpression } from "./expression.ts";
import { renameStep } from "./format.ts";
import { type CodeContext, completions, readCode } from "./javascript.ts";
import { canRun, validate } from "./validate.ts";

const next = ids(7);
const orders = collection(next, ["text", "number", "date"]);
const notes = collection(next, ["text"]);
const NAMES: Record<string, string> = { Pedidos: orders.key, Notas: notes.key };

/** A context that can read code: the collections above, by the names written in `$col('…')`. */
const ctx = (over: Partial<CodeContext> = {}): CodeContext => ({
  ...knowing(orders, notes),
  collectionNamed: (name) => NAMES[name],
  collectionName: (key) => Object.entries(NAMES).find(([, k]) => k === key)?.[0],
  ...over,
});

/** A trigger, a search, then a «Código» with that source and mode, and a step that does not run before it. */
function withCode(
  source: string,
  mode: "all" | "perRow" = "all",
  connections = [newConnection(orders.key)],
) {
  const s = sketch(9)
    .step("Inicio", "manual", { fields: [] })
    .step("Buscar", "collection", { collection: orders.key, action: "find" })
    .step("Código", CODE_TYPE, { mode, source })
    .step("Suelto", "manual", { fields: [] })
    .arrow("Inicio", "Buscar")
    .arrow("Buscar", "Código");
  const a = s.build();
  const step = a.steps.find((x) => x.name === "Código");
  if (step) step.connections = connections;
  return { a, id: s.id("Código"), s };
}

/** The problems of one step. */
const of = <P extends { step?: string }>(problems: readonly P[], step: string) =>
  problems.filter((p) => p.step === step);
const codes = (problems: readonly { code: string }[]) => problems.map((p) => p.code);

/** An «Editar» over the search, with one value written as an expression. */
function withExpression(expr: string) {
  const s = sketch(9)
    .step("Inicio", "manual", { fields: [] })
    .step("Buscar", "collection", { collection: orders.key, action: "find" })
    .step("Editar", "edit", { fields: [{ field: "nuevo", value: { expr } }] })
    .arrow("Inicio", "Buscar")
    .arrow("Buscar", "Editar");
  return { a: s.build(), id: s.id("Editar") };
}

describe("an expression with JavaScript", () => {
  it("AU-22 · an expression is text with JavaScript between `{{ }}`: `parseExpression` gives its parts in order, a simple citation as a citation and anything else as code with its source, and printing the parts gives the text back", () => {
    const expr =
      "Hola {{ $json.nombre }}, llevas {{ $('Sumar').first().total * 2 }} € y {{ [1, 2].length }}";
    const parts = parseExpression(expr);
    expect(parts).toEqual([
      { kind: "text", text: "Hola " },
      { kind: "cite", cite: { step: null, pick: "item", path: ["nombre"] } },
      { kind: "text", text: ", llevas " },
      { kind: "code", source: "$('Sumar').first().total * 2" },
      { kind: "text", text: " € y " },
      { kind: "code", source: "[1, 2].length" },
    ]);
    expect(printExpression(parts)).toBe(expr);
    expect(parseExpression(printExpression(parts))).toEqual(parts);
  });

  it("AU-22 · a `{{ }}` ends at the first `}}` that leaves a whole JavaScript expression before it: an object written inside, or a text that holds `}}`, does not close it; one that never closes is `code.syntax` with its place", () => {
    expect(parseExpression("{{ {a:{b:1}}.a }} fin")).toEqual([
      { kind: "code", source: "{a:{b:1}}.a" },
      { kind: "text", text: " fin" },
    ]);
    expect(parseExpression('{{ "a}}b" + $json.x }}')).toEqual([
      { kind: "code", source: '"a}}b" + $json.x' },
    ]);
    expect(codeParts("x {{ `}}` }}").parts).toEqual([{ source: "`}}`", at: 5 }]);
    // Unclosed: the text stays text (it reads), and validation says where it opens.
    expect(parseExpression("abierta {{ $json.a")).toEqual([
      { kind: "text", text: "abierta {{ $json.a" },
    ]);
    const { a, id } = withExpression("abierta {{ $json.a");
    const wrong = of(validate(a, ctx()), id);
    expect(wrong).toEqual([
      {
        code: "code.syntax",
        severity: "error",
        step: id,
        param: "fields.0.value",
        detail: { message: "a `{{` that never closes", line: 1, column: 9, from: 8, to: 10 },
      },
    ]);
  });

  it("AU-22 · a value that is one `{{ }}` alone keeps the type of what it gives (a number, a list, a date); with text around it is text: null gives nothing, a number its digits, an object its JSON", () => {
    const one = parseExpression("{{ $json.a + 1 }}");
    expect(joinParts(one, [5])).toBe(5);
    expect(joinParts(one, [[1, 2]])).toEqual([1, 2]);
    expect(joinParts(one, ["2026-11-16T09:30:00.000Z"])).toBe("2026-11-16T09:30:00.000Z");
    expect(joinParts(one, [null])).toBeNull();
    const two = parseExpression("{{ $json.a + 1 }} y {{ [$json.b] }}.");
    expect(joinParts(two, [null, 3])).toBe(" y 3.");
    expect(joinParts(two, [{ a: 1 }, [true]])).toBe('{"a":1} y [true].');
    expect(joinParts(two, [1.5, "texto"])).toBe("1.5 y texto.");
  });

  it("AU-22 · a `{{ }}` with a statement, an assignment or more than one expression does not validate (`code.syntax`): an expression gives a value and nothing else", () => {
    for (const source of ["x = 1", "a, b", "if (a) b", "1; 2", "let a = 1", "i++", "return 1"])
      expect(codes(readCode(source, "expression").problems), source).toEqual(["code.syntax"]);
    // An error after a whole expression is placed where it is in the source, not in what follows it.
    for (const [source, at] of [
      ["$json.aaaaaaaaaa )", 17],
      ["$json.a\n  + )", 12],
      ["$json.a $json.b", 8],
    ] as const) {
      const [p] = readCode(source, "expression").problems;
      expect([p?.code, p?.detail?.from], source).toEqual(["code.syntax", at]);
      const lines = source.slice(0, at).split("\n");
      expect([p?.detail?.line, p?.detail?.column], source).toEqual([
        lines.length,
        (lines.at(-1)?.length ?? 0) + 1,
      ]);
    }
    for (const source of [
      "$json.a + 1",
      "{ a: 1 }",
      "(x) => x * 2",
      "a ? b : c",
      "[1, 2].map((n) => n + 1)",
      "($json.a)",
      "(($json.a + 1)) * 2",
    ])
      expect(readCode(source, "expression").problems, source).toEqual([]);
    const { a, id } = withExpression("{{ $json.a = 1 }}");
    expect(codes(of(validate(a, ctx()), id))).toEqual(["code.syntax"]);
  });

  it("AU-22 · validation gives `expr.code` for JavaScript only while the run has no box; with one, the same automation validates and its `{{ }}` that are not simple citations are the box's", () => {
    const { a, id } = withExpression("Total: {{ $json.a * 2 }}");
    expect(codes(of(validate(a, knowing(orders, notes)), id))).toEqual(["expr.code"]);
    const withBox = validate(a, ctx());
    expect(of(withBox, id)).toEqual([]);
    expect(canRun(withBox)).toBe(true);
    // Without a box, «Código» is not a type yet; with one, it is.
    const code = withCode("return []");
    expect(codes(of(validate(code.a, knowing(orders, notes)), code.id))).toEqual([
      "step.unknownType",
    ]);
    expect(of(validate(code.a, ctx()), code.id)).toEqual([]);
  });
});

describe("what code may name", () => {
  it("AU-24 · `readCode` reads the same names in an expression and in a «Código»: `$json`, `$input` with `.all()`, `.first()`, `.last()` and `.item`, `$('Step')`, `$now`, `$today`, `$run`, `$page`, `$date` and `console`; a `$name` that is none of `CODE_GLOBALS` is `code.unknownGlobal`", () => {
    const list =
      "[$json.a, $input.all(), $input.first().b, $input.last().c, $input.item.d, $('Buscar').first().e, $now, $today, $run.test, $page, $date('2026-11-16'), console.log(1)]";
    for (const [source, as] of [
      [list, "expression"],
      [`return ${list}`, "code"],
    ] as const) {
      const r = readCode(source, as);
      expect(r.problems, as).toEqual([]);
      expect(r.uses).toEqual({ clock: true, run: true, page: true });
      expect(r.input).toMatchObject({ current: true, all: true });
      expect(r.input?.at.length).toBe(5);
      expect(r.steps.map((s) => [s.name, s.fields])).toEqual([["Buscar", ["e"]]]);
    }
    const unknown = readCode("return $nada + $json.a", "code").problems;
    expect(unknown).toEqual([
      {
        code: "code.unknownGlobal",
        severity: "error",
        detail: { name: "$nada", line: 1, column: 8, from: 7, to: 12 },
      },
    ]);
    // A name the code declares is its own.
    expect(readCode("const $mio = 1; return $mio", "code").problems).toEqual([]);
  });

  it("AU-24 · `$json` and `.item` in a «Código» that runs once with all the rows are `expr.noCurrentRow`; a step cited that does not always run before this one is `expr.notBefore`, and `.item` across a step that remakes the rows is `expr.cannotPair`: the codes simple citations already have", () => {
    const all = withCode("return [{ a: $json.a }]");
    expect(codes(of(validate(all.a, ctx()), all.id))).toEqual(["expr.noCurrentRow"]);
    const item = withCode("return [{ a: $('Buscar').item.b }]");
    expect(codes(of(validate(item.a, ctx()), item.id))).toEqual(["expr.noCurrentRow"]);
    const perRow = withCode("return { a: $json.a, b: $('Buscar').item.b }", "perRow");
    expect(of(validate(perRow.a, ctx()), perRow.id)).toEqual([]);
    const notBefore = withCode("return $('Suelto').all()");
    expect(of(validate(notBefore.a, ctx()), notBefore.id)).toMatchObject([
      { code: "expr.notBefore", detail: { name: "Suelto" } },
    ]);
    const missing = withCode("return $('Nadie').all()");
    expect(of(validate(missing.a, ctx()), missing.id)).toMatchObject([
      { code: "expr.unknownStep", detail: { name: "Nadie" } },
    ]);
    // A «Agrupar» between: the current row does not come from one of «Buscar»'s.
    const s = sketch(9)
      .step("Inicio", "manual", { fields: [] })
      .step("Buscar", "collection", { collection: orders.key, action: "find" })
      .step("Agrupar", "group", {})
      .step("Código", CODE_TYPE, { mode: "perRow", source: "return { b: $('Buscar').item.b }" })
      .arrow("Inicio", "Buscar")
      .arrow("Buscar", "Agrupar")
      .arrow("Agrupar", "Código");
    expect(of(validate(s.build(), ctx()), s.id("Código"))).toMatchObject([
      {
        code: "expr.cannotPair",
        param: "source",
        detail: {
          name: "Buscar",
          by: "Agrupar",
          first: "$('Buscar').first().b",
          all: "$('Buscar').all()",
        },
      },
    ]);
  });

  it("AU-24 · `$col` in an expression is `code.readInExpression`; `await`, `async`, `import` and a generator are `code.cannotWait`, in an expression and in a «Código», and `validate` gives them as errors with their place, so `canRun` is false", () => {
    expect(codes(readCode("$col('Notas').count()", "expression").problems)).toEqual([
      "code.readInExpression",
    ]);
    expect(readCode("return $col('Notas').count()", "code").problems).toEqual([]);
    const waits = [
      ["await $json.a", "await"],
      ["(async () => 1)()", "async"],
      ["import('x')", "import"],
      ["(function* () {})", "generator"],
    ] as const;
    for (const [source, what] of waits) {
      for (const [text, as] of [
        [source, "expression"],
        [`return ${source}`, "code"],
      ] as const)
        expect(readCode(text, as).problems, `${as}: ${text}`).toMatchObject([
          { code: "code.cannotWait", detail: { what } },
        ]);
    }
    expect(readCode("for await (const x of y) {}\nreturn []", "code").problems).toMatchObject([
      { code: "code.cannotWait", detail: { what: "await", line: 1 } },
    ]);
    // Validation says the same, as errors of the step and the parameter, with their place: nothing with them runs.
    const read = withExpression("Total: {{ $col('Pedidos').count() }}");
    const p1 = validate(read.a, ctx());
    expect(of(p1, read.id)).toMatchObject([
      {
        code: "code.readInExpression",
        severity: "error",
        param: "fields.0.value",
        detail: { name: "Pedidos", from: 10, line: 1, column: 11 },
      },
    ]);
    expect(canRun(p1)).toBe(false);
    const wait = withCode("const a = 1\nreturn await $col('Pedidos').count()");
    const p2 = validate(wait.a, ctx());
    expect(of(p2, wait.id)).toMatchObject([
      {
        code: "code.cannotWait",
        severity: "error",
        param: "source",
        detail: { what: "await", line: 2, column: 8 },
      },
    ]);
    expect(canRun(p2)).toBe(false);
  });

  it("AU-25 · fields are read by their key: `$json.precio`, `$json['precio']` and `const { precio } = $json` each read the field `precio`, and `readCode` says where; a row handed on whole, or a key that is calculated, reads all its fields", () => {
    for (const source of [
      "return $json.precio",
      "return $json['precio']",
      "const { precio } = $json\nreturn precio",
      "return $input.item.precio",
    ]) {
      const r = readCode(source, "code");
      expect(r.input?.fields, source).toEqual(["precio"]);
      const at = r.input?.at[0];
      expect(source.slice(at?.from, at?.to), source).toMatch(/^\$(json|input)$/);
    }
    expect(readCode("return $json.a + $json.b", "code").input?.fields).toEqual(["a", "b"]);
    for (const source of [
      "return $json",
      "return $json[k]",
      "const { ...todo } = $json\nreturn todo",
      "return $input.all()",
    ])
      expect(readCode(source, "code").input?.fields, source).toBe("all");
    expect(readCode("return $('Buscar').first()['precio']", "code").steps[0]?.fields).toEqual([
      "precio",
    ]);
    expect(readCode("return $('Buscar').first()", "code").steps[0]?.fields).toBe("all");
  });
});

describe("what an evaluation receives", () => {
  it("AU-163 · `readCode` lists the steps the code cites and, of each, the fields it reads; a step it does not cite is not in the list, whatever a comment or a text inside the code says", () => {
    const r = readCode(
      [
        "// $('Comentario').first().x",
        "const texto = \"$('Texto').first().y\"",
        "/* $('Otro') */",
        "return [$('Buscar').first().precio, $('Buscar').last().fecha, $(\"Sumar\").all().length, `$('Plantilla')`]",
      ].join("\n"),
      "code",
    );
    expect(r.problems).toEqual([]);
    expect(r.steps.map((s) => ({ name: s.name, fields: s.fields, all: s.all }))).toEqual([
      { name: "Buscar", fields: ["precio", "fecha"], all: false },
      { name: "Sumar", fields: "all", all: true },
    ]);
    expect(r.steps[0]?.at.length).toBe(2);
  });

  it("AU-163 · `$(…)` with anything but a text written there (a variable, a sum of texts, a template with a value) is `code.computed`, and so is `$col(…)`; `$` and `$col` given another name, or reached through the global object (`globalThis`, `self`, a `this` that may be it, or any of them given another name or handed to a function), are `code.computed` too", () => {
    const computed: [string, "step" | "collection"][] = [
      ["return $(nombre).all()", "step"],
      ["return $('Bus' + 'car').all()", "step"],
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the code read holds a template with a value
      ["return $(`${nombre}`).all()", "step"],
      ["return $col(nombre).count()", "collection"],
      ["const paso = $\nreturn paso('Buscar').all()", "step"],
      ["const c = $col\nreturn c('Notas').count()", "collection"],
      ["return globalThis.$('Buscar').all()", "step"],
      ["return globalThis['$col']('Notas').count()", "collection"],
      ["const { $ } = globalThis\nreturn 1", "step"],
      ["const { $col: c } = globalThis\nreturn 1", "collection"],
      ["return this.$('Buscar').all()", "step"],
      ["return this['$col']('Notas').count()", "collection"],
      ["const g = globalThis\nreturn g.$('Buscar').all()", "step"],
      ["const g = this\nreturn g.$('Buscar').all()", "step"],
      ["return globalThis.globalThis.$('Buscar').all()", "step"],
      ["return Reflect.get(self, '$')('Buscar').all()", "step"],
      ["const { ...todo } = globalThis\nreturn todo.$('Buscar').all()", "step"],
      ["function f() { return this }\nreturn f().$('Buscar').all()", "step"],
    ];
    for (const [source, what] of computed) {
      const r = readCode(source, "code");
      expect(
        r.problems.filter((p) => p.code === "code.computed"),
        source,
      ).toMatchObject([{ detail: { what } }]);
      expect(r.steps, source).toEqual([]);
    }
    // A template with no value in it is a text written there.
    expect(readCode("return $(`Buscar`).all()", "code").problems).toEqual([]);
    // Other keys of the global object, and the `this` of a class or a method, are read as any other.
    for (const source of [
      "return globalThis.Math.max(1, 2)",
      "const { Math: m } = globalThis\nreturn m.max(1, 2)",
      "class P { constructor() { this.x = 1 } get y() { return this } }\nreturn new P().x",
      "return { n: 1, doble() { return this.n * 2 } }.doble()",
    ])
      expect(readCode(source, "code").problems, source).toEqual([]);
  });

  it.todo(
    "AU-163 · code that hides a citation from the reader (a name built at run time, `$` inside `eval` or `Function`) gets nothing by it: the job the engine sends holds only the steps `readCode` listed (E3: the job is box.ts' `evaluate`)",
  );

  it("AU-31 · `$col('Name')` of a collection the step has no reading connection to is `code.notConnected` with the collection's key, and of a name no collection has, `code.unknownCollection`: with either, `canRun` is false", () => {
    const notConnected = withCode("return $col('Notas').find({})");
    const p1 = validate(notConnected.a, ctx());
    expect(of(p1, notConnected.id)).toMatchObject([
      {
        code: "code.notConnected",
        param: "source",
        detail: { collection: notes.key, line: 1, column: 8 },
      },
    ]);
    expect(canRun(p1)).toBe(false);
    const unknown = withCode("return $col('Nadie').find({})");
    const p2 = validate(unknown.a, ctx());
    expect(of(p2, unknown.id)).toMatchObject([
      { code: "code.unknownCollection", detail: { name: "Nadie" } },
    ]);
    expect(canRun(p2)).toBe(false);
    const fine = withCode("return $col('Pedidos').find({})");
    expect(of(validate(fine.a, ctx()), fine.id)).toEqual([]);
    // A connection that does not read does not count.
    const off = withCode("return $col('Pedidos').count()", "all", [
      { ...newConnection(orders.key), read: false },
    ]);
    expect(codes(of(validate(off.a, ctx()), off.id))).toEqual(["code.notConnected"]);
  });
});

describe("the editor's model", () => {
  it("AU-36 · the completions at a place of the code are the names of `CODE_GLOBALS`, the steps that always run before this one, after `$('Step').first().` the fields its last test gave (inserted by key, shown by name), after `$json.` or `$input.first().` those of the steps whose rows reach this one, after any other dot nothing, and inside `$col('` the collections connected, never one that is not", () => {
    const { a, id } = withCode("");
    const step = a.steps.find((s) => s.id === id);
    if (!step) throw new Error("no step");
    const at = (
      source: string,
      as: "expression" | "code" = "code",
      over: Partial<CodeContext> = {},
    ) => completions(source, source.length, as, step, a, ctx(over));
    expect(at("return $js").map((c) => c.insert)).toEqual(["$json"]);
    expect(at("return $c").map((c) => c.insert)).toEqual(["$col"]);
    expect(at("$c", "expression")).toEqual([]);
    expect(at("return $").map((c) => c.insert)).toContain("$input");
    expect(at("cons").map((c) => c.insert)).toEqual(["console"]);
    expect(
      at("return $('")
        .map((c) => c.insert)
        .sort(),
    ).toEqual(["Buscar", "Inicio"]);
    expect(at("return $('Bu")).toEqual([{ kind: "step", insert: "Buscar" }]);
    const tested = {
      testedFields: (name: string) =>
        name === "Buscar"
          ? [
              { key: "f_precio", name: "Precio" },
              { key: "f_fecha", name: "Fecha" },
              { key: "solo" },
            ]
          : undefined,
    };
    expect(at("return $('Buscar').first().", "code", tested)).toEqual([
      { kind: "field", insert: "f_precio", label: "Precio" },
      { kind: "field", insert: "f_fecha", label: "Fecha" },
      { kind: "field", insert: "solo" },
    ]);
    expect(at("return $('Buscar').item.f_p", "code", tested)).toEqual([
      { kind: "field", insert: "f_precio", label: "Precio" },
    ]);
    // The step's own input: the rows of «Buscar» reach it.
    expect(at("return $json.", "code", tested).map((c) => c.insert)).toEqual([
      "f_precio",
      "f_fecha",
      "solo",
    ]);
    expect(at("{{ $json.f_f", "expression", tested)).toEqual([
      { kind: "field", insert: "f_fecha", label: "Fecha" },
    ]);
    expect(at("return $input.last().so", "code", tested)).toEqual([
      { kind: "field", insert: "solo" },
    ]);
    expect(at("return $input.item.", "code", tested)).toHaveLength(3);
    // Untested, nothing is known of it; after another dot comes a property, not a global.
    expect(at("return $json.")).toEqual([]);
    expect(at("const fila = 1; fila.")).toEqual([]);
    expect(at("return [1].map((n) => n. ")).toEqual([]);
    expect(at("return $input.").map((c) => c.insert)).toEqual([
      "all()",
      "first()",
      "last()",
      "item",
    ]);
    expect(at("return $col('")).toEqual([{ kind: "collection", insert: "Pedidos" }]);
    expect(at("$col('", "expression")).toEqual([]);
  });

  it("AU-36 · every problem of the code has its place (`from`, `to`, `line`, `column`), and a field read that the cited step's last test did not give is listed with its place, so the editor marks it before any test", () => {
    const source =
      "const x = $nada\nreturn [$('Nadie').all(), $col('Notas').count(), $('Buscar').first().falta]";
    const { a, id } = withCode(source);
    const problems = of(validate(a, ctx({ testedFields: () => [{ key: "precio" }] })), id);
    expect(codes(problems)).toEqual([
      "code.unknownGlobal",
      "expr.unknownStep",
      "code.fieldNotGiven",
      "code.notConnected",
    ]);
    for (const p of problems) {
      const d = p.detail ?? {};
      expect(typeof d.from, p.code).toBe("number");
      const lines = source.slice(0, Number(d.from)).split("\n");
      expect([d.line, d.column], p.code).toEqual([lines.length, (lines.at(-1)?.length ?? 0) + 1]);
      expect(Number(d.to)).toBeGreaterThan(Number(d.from));
    }
    expect(source.slice(Number(problems[2]?.detail?.from), Number(problems[2]?.detail?.to))).toBe(
      "$('Buscar')",
    );
    // In an expression the place counts from the start of the whole value.
    const e = withExpression("Hola\n{{ $nada }}");
    expect(of(validate(e.a, ctx()), e.id)).toMatchObject([
      { code: "code.unknownGlobal", detail: { from: 8, to: 13, line: 2, column: 4 } },
    ]);
  });

  it("AU-36 · a field read that the cited step's last test did not give, or that the steps reaching this one did not, is a warning, not an error: `canRun` stays true and a test is not stopped by it, while a step or a collection that does not exist is an error", () => {
    const given = { testedFields: () => [{ key: "precio" }] };
    const warned = withCode("return [$('Buscar').first().falta]");
    const p1 = validate(warned.a, ctx(given));
    expect(of(p1, warned.id)).toMatchObject([
      {
        code: "code.fieldNotGiven",
        severity: "warning",
        detail: { name: "Buscar", field: "falta" },
      },
    ]);
    expect(canRun(p1)).toBe(true);
    // Untested: nothing to compare with, nothing said.
    expect(of(validate(warned.a, ctx()), warned.id)).toEqual([]);
    // The step's own input is the rows of the steps with an arrow into it: here «Buscar».
    const own = withCode("return [$json.precio, $input.first().falta]", "perRow");
    expect(of(validate(own.a, ctx(given)), own.id)).toMatchObject([
      {
        code: "code.fieldNotGiven",
        severity: "warning",
        detail: { name: "Buscar", field: "falta" },
      },
    ]);
    const untested = { testedFields: (n: string) => (n === "Buscar" ? undefined : [{ key: "x" }]) };
    expect(of(validate(own.a, ctx(untested)), own.id)).toEqual([]);
    const missing = withCode("return [$('Nadie').first().precio]");
    const p2 = validate(missing.a, ctx(given));
    expect(of(p2, missing.id)).toMatchObject([{ code: "expr.unknownStep", severity: "error" }]);
    expect(canRun(p2)).toBe(false);
  });

  it("AU-35 · a «Código» longer than `CODE_LIMITS.sourceChars` and a `{{ }}` whose JavaScript is longer than `CODE_LIMITS.expressionChars` are `code.long` with the limit and what they have, and one that is exactly at the limit validates", () => {
    const body = (n: number) => `return 1${" ".repeat(n - "return 1".length)}`;
    const at = withCode(body(CODE_LIMITS.sourceChars));
    expect(of(validate(at.a, ctx()), at.id)).toEqual([]);
    const over = withCode(body(CODE_LIMITS.sourceChars + 1));
    expect(of(validate(over.a, ctx()), over.id)).toMatchObject([
      {
        code: "code.long",
        param: "source",
        detail: { max: CODE_LIMITS.sourceChars, got: CODE_LIMITS.sourceChars + 1 },
      },
    ]);
    // "11+1+1…": exactly n characters of JavaScript, which the trimming of `{{ }}` does not change.
    const sum = (n: number) => `${"1".repeat(n - 2 * 999)}${"+1".repeat(999)}`;
    expect(sum(CODE_LIMITS.expressionChars)).toHaveLength(CODE_LIMITS.expressionChars);
    const fine = withExpression(`{{ ${sum(CODE_LIMITS.expressionChars)} }}`);
    expect(of(validate(fine.a, ctx()), fine.id)).toEqual([]);
    const long = withExpression(`{{ ${sum(CODE_LIMITS.expressionChars + 1)} }}`);
    expect(of(validate(long.a, ctx()), long.id)).toMatchObject([
      {
        code: "code.long",
        param: "fields.0.value",
        detail: { max: CODE_LIMITS.expressionChars, got: CODE_LIMITS.expressionChars + 1 },
      },
    ]);
  });

  it("AU-02 · renaming a step rewrites `$('Old')` as `$('New')` in every `{{ }}` and every «Código» of the automation, with either kind of quotes, touches no text or comment that only says the same words, and every one of them gives the same value as before the rename", () => {
    const code = [
      "// $('Buscar') is the search",
      "const dicho = '$(\\'Buscar\\')'",
      "return [$(\"Buscar\").first().precio, $(`Buscar`).all().length, $('Buscar').item, dicho]",
    ].join("\n");
    const s = sketch(9)
      .step("Inicio", "manual", { fields: [] })
      .step("Buscar", "collection", { collection: orders.key, action: "find" })
      .step("Código", CODE_TYPE, { mode: "perRow", source: code })
      .step("Editar", "edit", {
        fields: [
          {
            field: "nuevo",
            value: {
              expr: "$('Buscar') dice {{ $('Buscar').first().precio * 2 }} y {{ $('Buscar').item.fecha }}",
            },
          },
        ],
      })
      .arrow("Inicio", "Buscar")
      .arrow("Buscar", "Código")
      .arrow("Código", "Editar");
    const before = s.build();
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a step name may hold what a template would read
    for (const to of ["Encontrar", "Paso 'uno' \"dos\" `tres` ${x} \\"]) {
      const after = renameStep(before, s.id("Buscar"), to);
      const source = String(after.steps.find((x) => x.name === "Código")?.params.source);
      expect(source.split("\n").slice(0, 2)).toEqual(code.split("\n").slice(0, 2));
      // What it cites is the same, under the new name: the same rows, the same fields.
      const was = readCode(code, "code").steps;
      const is = readCode(source, "code");
      expect(is.problems).toEqual([]);
      expect(is.steps.map((x) => ({ ...x, at: [] }))).toEqual(
        was.map((x) => ({ ...x, name: to, at: [] })),
      );
      const value = after.steps.find((x) => x.name === "Editar")?.params.fields;
      const expr = String((value as { value: { expr: string } }[])[0]?.value.expr);
      expect(expr.startsWith("$('Buscar') dice {{ ")).toBe(true);
      const parts = parseExpression(expr);
      const js = parts.find((p) => p.kind === "code");
      expect(js && readCode(js.source, "expression").steps.map((x) => [x.name, x.fields])).toEqual([
        [to, ["precio"]],
      ]);
      expect(parts.find((p) => p.kind === "cite")).toMatchObject({
        cite: { step: to, path: ["fecha"] },
      });
    }
    expect(renameStep(before, s.id("Buscar"), "Encontrar").steps[2]?.params.source).toBe(
      code
        .replace('$("Buscar")', '$("Encontrar")')
        .replace("$(`Buscar`)", "$(`Encontrar`)")
        .replace("$('Buscar').item", "$('Encontrar').item"),
    );
  });
});
