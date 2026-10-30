import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIMITS,
  limitsOf,
  MAX_LIMITS,
  requestErrors,
  type Schema,
  schemaErrors,
  schemaShapeErrors,
} from "./index.ts";

const request = {
  id: "r1",
  code: "function suma(i) { return i.a + i.b }",
  hash: "a".repeat(64),
  fn: "suma",
  input: { a: 1, b: 2 },
  day: "2026-10-30",
  seed: 7,
};

describe("a request to the box", () => {
  it("is checked field by field", () => {
    expect(requestErrors(request)).toEqual([]);
    expect(requestErrors({ ...request, fn: "no vale", hash: "x", day: "hoy" })).toEqual([
      "hash",
      "fn",
      "day",
    ]);
    expect(requestErrors({ ...request, limits: { steps: -1, red: 1 } })).toEqual([
      "limits.steps",
      "limits.red",
    ]);
    expect(requestErrors([])).toEqual(["no es un objeto"]);
  });

  it("asks for its own limits, never past the most allowed", () => {
    expect(limitsOf({})).toEqual(DEFAULT_LIMITS);
    expect(limitsOf({ limits: { steps: 5, ms: 10 ** 9 } })).toEqual({
      ...DEFAULT_LIMITS,
      steps: 5,
      ms: MAX_LIMITS.ms,
    });
  });
});

describe("the schema subset", () => {
  const movement: Schema = {
    type: "object",
    required: ["fecha", "importe"],
    additionalProperties: false,
    properties: {
      fecha: { type: "string", minLength: 10, maxLength: 10 },
      importe: { type: "number" },
      dudosa: { type: "boolean" },
      etiquetas: { type: "array", items: { type: "string" }, maxItems: 3 },
      tipo: { enum: ["gasto", "ingreso"] },
    },
  };

  it("says where a value does not fit", () => {
    expect(schemaErrors(movement, { fecha: "2026-10-30", importe: -12.5 })).toEqual([]);
    expect(
      schemaErrors(movement, {
        fecha: "ayer",
        etiquetas: ["a", 2, "c", "d"],
        tipo: "otro",
        extra: 1,
      }),
    ).toEqual([
      "$.importe: falta",
      "$.fecha: demasiado corto",
      "$.etiquetas: demasiados elementos",
      "$.etiquetas[1]: se esperaba string",
      "$.tipo: valor no admitido",
      "$.extra: no se admite",
    ]);
    expect(schemaErrors({ type: "integer" }, 1.5)).toEqual(["$: se esperaba integer"]);
    expect(schemaErrors({ anyOf: [{ type: "string" }, { type: "null" }] }, 3)).toEqual([
      "$: no encaja en ninguna de las opciones",
    ]);
  });

  it("reads only the schemas it knows (no patterns: they would run on Boni's side)", () => {
    expect(schemaShapeErrors(movement)).toEqual([]);
    expect(schemaShapeErrors({ type: "string", pattern: "(a+)+$" })).toEqual([
      "$: «pattern» no se admite",
    ]);
    expect(schemaShapeErrors({ type: "fecha" })).toEqual(["$: tipo «fecha»"]);
  });
});
