// How an expression is read until F14c (docs/automatizaciones.md §5.3): text with simple citations between `{{ }}`,
// and anything else between them is `code`, which validation refuses.
import { describe, expect, it } from "vitest";
import { rng } from "../../entities/src/random.test-util.ts";
import { parseExpression, printCitation, renameInExpression } from "./expression.ts";

describe("simple citations", () => {
  it("reads the current row, a step's row, its first and its last, with dots and brackets", () => {
    expect(parseExpression("{{ $json.total }}")).toEqual([
      { kind: "cite", cite: { step: null, pick: "item", path: ["total"] } },
    ]);
    expect(parseExpression(`{{$json.padre["mi-campo"].nombre}}`)).toEqual([
      { kind: "cite", cite: { step: null, pick: "item", path: ["padre", "mi-campo", "nombre"] } },
    ]);
    expect(
      parseExpression(
        `Hola {{ $( "Buscar filas" ).item.nombre }}, {{ $('Leer \\'una\\'').first().n }}`,
      ),
    ).toEqual([
      { kind: "text", text: "Hola " },
      { kind: "cite", cite: { step: "Buscar filas", pick: "item", path: ["nombre"] } },
      { kind: "text", text: ", " },
      { kind: "cite", cite: { step: "Leer 'una'", pick: "first", path: ["n"] } },
    ]);
    expect(parseExpression("{{ $('Uno').last().año }}")).toEqual([
      { kind: "cite", cite: { step: "Uno", pick: "last", path: ["año"] } },
    ]);
  });

  it("anything else between {{ }} is code, and text with no {{ }} is text", () => {
    for (const code of [
      "$json.total * 2",
      "$('Uno').all()",
      "$json",
      "$jsonx.a",
      "$('Uno').total",
      "$('Uno').item",
      "$json.a.b()",
      "Math.max(1, 2)",
      "",
    ])
      expect(parseExpression(`{{ ${code} }}`)).toEqual([{ kind: "code", source: code }]);
    expect(parseExpression("sin citas")).toEqual([{ kind: "text", text: "sin citas" }]);
    expect(parseExpression("abierta {{ $json.a")).toEqual([
      { kind: "text", text: "abierta {{ $json.a" },
    ]);
    expect(parseExpression("")).toEqual([]);
  });

  it("printing a citation reads back as the same citation, whatever its name and keys", () => {
    const r = rng(7);
    const chars = ["a", "Ñ", " ", "'", '"', "\\", "-", "1", "$", "_", ".", "]"];
    const word = () => Array.from({ length: 1 + r.int(6) }, () => r.pick(chars)).join("");
    for (let i = 0; i < 500; i++) {
      const cite = {
        step: r.int(3) ? word() : null,
        pick: r.pick(["item", "first", "last"] as const),
        path: Array.from({ length: 1 + r.int(3) }, word),
      };
      if (cite.step === null) cite.pick = "item";
      expect(parseExpression(`{{ ${printCitation(cite)} }}`)).toEqual([{ kind: "cite", cite }]);
    }
  });

  it("renaming touches only citations of that step: never text, code, or a step whose name begins the same", () => {
    const expr =
      "Uno: {{ $('Uno').item.a }} {{ $('Uno').all() }} {{ $(\"Uno\").first().b }} {{ $('Uno bis').item.c }}";
    expect(renameInExpression(expr, "Uno", "Dos")).toBe(
      "Uno: {{ $('Dos').item.a }} {{ $('Uno').all() }} {{ $('Dos').first().b }} {{ $('Uno bis').item.c }}",
    );
    expect(renameInExpression(expr, "Tres", "Dos")).toBe(expr);
  });
});
