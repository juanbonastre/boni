// What the editor of a «Código» step reads from the core (docs/automatizaciones.md §5.4), each test with its rule's
// id in its name (`make check` reads them).
import { type Automation, CODE_LIMITS, FORMAT, type Step, validate } from "@boni/automations";
import { describe, expect, it } from "vitest";
import { lineSpan } from "../components/AutomationCode.tsx";
import type { DataType } from "../core/agent.ts";
import type { StepTest } from "./client.ts";
import { codeBlocked, codeContextOf, consoleOf, sourceProblems } from "./code.ts";
import { connectCollection } from "./edit.ts";

const libros = {
  id: "c_libros",
  key: "libros",
  name: "Libros",
  icon: "book",
  titleField: "titulo",
  fields: [
    { id: "f_titulo", key: "titulo", name: "Título", type: "text" },
    { id: "f_paginas", key: "paginas", name: "Páginas", type: "number" },
  ],
  count: 3000,
  level: "full",
} as unknown as DataType;
const tareas = { ...libros, id: "c_tareas", key: "tareas", name: "Tareas" } as DataType;
const step = (id: string, type: string, name: string, params: Step["params"] = {}): Step => ({
  id,
  name,
  type,
  params,
});
const withCode = (source: string, more: Partial<Step> = {}): Automation => ({
  format: FORMAT,
  id: "a_01jejemplo",
  version: 0,
  name: "Calcular con código",
  steps: [
    step("s_inicio", "manual", "Disparado por el usuario"),
    step("s_buscar", "collection", "Buscar filas en Libros", {
      action: "find",
      collection: "libros",
    }),
    { ...step("s_codigo", "code", "Código", { source }), ...more },
  ],
  arrows: [
    { from: { step: "s_inicio", output: "main" }, to: { step: "s_buscar", input: "main" } },
    { from: { step: "s_buscar", output: "main" }, to: { step: "s_codigo", input: "main" } },
  ],
  settings: {},
});
const done = { state: "done", at: 1, ms: 5, in: {}, out: { main: 3 } } as unknown as StepTest;
const fields = [
  { key: "titulo", name: "Título", type: "text" },
  { key: "paginas", name: "Páginas", type: "number" },
];
const contextOf = (a: Automation, tests: Record<string, StepTest> = { s_buscar: done }) =>
  codeContextOf([libros, tareas], a, tests, (id) => (id === "s_buscar" ? fields : []));
const code = (a: Automation) => a.steps.find((s) => s.id === "s_codigo") as Step;

describe("the editor of «Código»", () => {
  it("AU-36 · a step that does not exist is an error marked at its place; a field the cited step's last test did not give is a warning that lets it be tested; untested, nothing is said of its fields", () => {
    const source =
      "const x = $('Nadie').first();\nreturn [{ n: $('Buscar filas en Libros').first().nada }];";
    const a = withCode(source);
    const { marks, whole } = sourceProblems(code(a), a, contextOf(a));
    expect(whole).toEqual([]);
    expect(marks.map((m) => [m.code, m.severity, source.slice(m.from, m.to)])).toEqual([
      ["expr.unknownStep", "error", "$('Nadie')"],
      ["code.fieldNotGiven", "warning", "$('Buscar filas en Libros')"],
    ]);
    expect(codeBlocked(code(a), a, contextOf(a))).toBe("errors");
    const warned = withCode("return [{ n: $('Buscar filas en Libros').first().nada }];");
    expect(codeBlocked(code(warned), warned, contextOf(warned))).toBeNull();
    // The step before not tested: nothing to compare its fields with.
    expect(sourceProblems(code(warned), warned, contextOf(warned, {})).marks).toEqual([]);
    expect(codeBlocked(code(withCode("  \n")), withCode("  \n"), contextOf(withCode("")))).toBe(
      "empty",
    );
  });

  it("AU-36 · what the editor underlines is what validation says, no more and no less: the problems the server's validation gives for the same draft are the marks, each at its place", () => {
    const sources = [
      "return [];",
      "const x = $('Nadie').first();\nreturn [{ n: $('Buscar filas en Libros').first().nada }];",
      "return [{ n: $json.titulo }];",
      "return [$col('Tareas').count(), $col('Otra').count()];",
      "const t = await algo();\nreturn [];",
      "return [{ n: fetch('x') }];",
      "for (const l of $input.all()) l.n = $('Buscar filas en Libros').first().paginas;\nreturn $input.all();",
    ];
    for (const source of sources) {
      const a = withCode(source);
      const ctx = contextOf(a);
      const said = validate(a, ctx)
        .filter((p) => p.step === "s_codigo" && p.param === "source")
        .filter((p) => typeof (p.detail as { from?: unknown } | undefined)?.from === "number")
        .map((p) => {
          const d = p.detail as { from: number; to: number };
          return [p.code, p.severity, d.from, d.to];
        });
      const marked = sourceProblems(code(a), a, ctx).marks.map((m) => [
        m.code,
        m.severity,
        m.from,
        m.to,
      ]);
      expect(marked, source).toEqual(said);
    }
    // Not a vacuous table: most of its sources are marked.
    const marked = sources.filter(
      (s) => sourceProblems(code(withCode(s)), withCode(s), contextOf(withCode(s))).marks.length,
    );
    expect(marked.length).toBeGreaterThanOrEqual(4);
  });

  it("AU-35 · a source over its limit is said whole, not marked, and stops «Probar paso»", () => {
    const a = withCode(`return [];\n${"//".repeat(CODE_LIMITS.sourceChars)}`);
    const { marks, whole } = sourceProblems(code(a), a, contextOf(a));
    expect(marks).toEqual([]);
    expect(whole).toMatchObject([
      {
        code: "code.long",
        detail: { max: CODE_LIMITS.sourceChars, got: CODE_LIMITS.sourceChars * 2 + 11 },
      },
    ]);
    expect(codeBlocked(code(a), a, contextOf(a))).toBe("errors");
  });

  it("AU-31 · a collection cited and not connected is named once to connect; connecting it reads it with no limits and nothing more, and the problem goes", () => {
    const a = withCode(
      "return [$col('Tareas').count(), $col('Tareas').count(), $col('Libros').count()];",
      {
        connections: [
          { collection: "libros", read: {}, create: false, update: false, remove: false },
        ],
      },
    );
    const before = sourceProblems(code(a), a, contextOf(a));
    expect(before.notConnected).toEqual(["tareas"]);
    expect(before.marks.filter((m) => m.code === "code.notConnected")).toHaveLength(1);
    const after = connectCollection(a, "s_codigo", "tareas");
    expect(code(after).connections).toEqual([
      { collection: "libros", read: {}, create: false, update: false, remove: false },
      { collection: "tareas", read: {}, create: false, update: false, remove: false },
    ]);
    expect(sourceProblems(code(after), after, contextOf(after)).notConnected).toEqual([]);
    expect(codeBlocked(code(after), after, contextOf(after))).toBeNull();
    // Connected already: the draft as it was.
    expect(connectCollection(after, "s_codigo", "libros")).toBe(after);
  });

  it("AU-33 · «Consola» paints only lines of text: anything else is left out, a level it does not know is a plain line, and what was dropped is counted", () => {
    const test = {
      ...done,
      console: {
        lines: [
          { level: "log", text: "fila <b>1</b>", line: 3, row: 0 },
          { level: "script", text: "nivel raro" },
          { level: "warn", text: { html: "<i>no</i>" } },
          "suelta",
        ],
        dropped: 340,
      },
    } as unknown as StepTest;
    expect(consoleOf(test)).toEqual({
      lines: [
        { level: "log", text: "fila <b>1</b>", line: 3, row: 0 },
        { level: "log", text: "nivel raro" },
      ],
      dropped: 340,
    });
    expect(
      consoleOf({ ...done, console: { lines: "x", dropped: -1 } } as unknown as StepTest),
    ).toEqual({
      lines: [],
      dropped: 0,
    });
    expect(consoleOf(undefined)).toEqual({ lines: [], dropped: 0 });
  });

  it("AU-33 · the line a failure names is found in the source to be marked, and one past its end is not", () => {
    const source = "const a = 1;\nconst b = 2;\nthrow new Error('x');";
    expect(lineSpan(source, 1)).toEqual({ from: 0, to: 12 });
    const third = lineSpan(source, 3);
    expect(third && source.slice(third.from, third.to)).toBe("throw new Error('x');");
    expect(lineSpan(source, 4)).toBeUndefined();
  });

  it("AU-25 · the context gives a collection by its key with each field's key, by its name only when one collection has it, and a step's fields only after a test of it that ended well", () => {
    const a = withCode("return [];");
    const ctx = codeContextOf(
      [libros, tareas, { ...tareas, id: "c_otra", key: "otra" } as DataType],
      a,
      { s_buscar: done },
      () => fields,
    );
    expect(ctx.collection("libros")?.fields.map((f) => f.key)).toEqual(["titulo", "paginas"]);
    expect(ctx.collectionNamed("Libros")).toBe("libros");
    expect(ctx.collectionNamed("Tareas")).toBeUndefined();
    expect(ctx.collectionName?.("libros")).toBe("Libros");
    expect(ctx.testedFields?.("Buscar filas en Libros")).toEqual([
      { key: "titulo", name: "Título" },
      { key: "paginas", name: "Páginas" },
    ]);
    const failed = { ...done, state: "failed" } as StepTest;
    const none = codeContextOf([libros], a, { s_buscar: failed }, () => fields);
    expect(none.testedFields?.("Buscar filas en Libros")).toBeUndefined();
  });
});
