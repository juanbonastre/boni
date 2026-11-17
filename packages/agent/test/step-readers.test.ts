// The shapes the automation steps' readers add to READER_SCHEMAS (docs/automatizaciones.md AU-53, AU-57, F15 E2):
// «Extraer datos»'s typed fields, which `fill` (choice and check) cannot hold, and «Clasificar»'s «nothing fits»,
// which the readers of mail never answer. The engine checks every answer again against the step (automations'
// ai.ts); these are what the provider holds the model to, and the server's port checks with them.
import { describe, expect, it } from "vitest";
import {
  checkExtract,
  checkReader,
  classifySchema,
  type ExtractField,
  extractSchema,
  labelEachSchema,
} from "../src/readers.ts";

const FIELDS: ExtractField[] = [
  { key: "importe", type: "number", line: "lo que se paga" },
  { key: "dia", type: "date", line: "el día del pago" },
  { key: "concepto", type: "text", line: "en pocas palabras" },
  { key: "pagado", type: "boolean", line: "" },
  { key: "tipo", type: "options", line: "", options: ["recibo", "factura"] },
];

describe("the automation steps' reader shapes (F15)", () => {
  it("AU-57 · «Extraer datos» has a closed shape per call: every field, of its type or null, and nothing else", () => {
    const schema = extractSchema(FIELDS) as {
      properties: Record<string, { anyOf: object[]; description: string }>;
      required: string[];
      additionalProperties: boolean;
    };
    expect(schema.required).toEqual(FIELDS.map((f) => f.key));
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.importe?.anyOf).toEqual([{ type: "number" }, { type: "null" }]);
    expect(schema.properties.tipo?.anyOf[0]).toEqual({
      type: "string",
      enum: ["recibo", "factura"],
    });
    expect(schema.properties.importe?.description).toBe("lo que se paga");

    const ok = { importe: 12.5, dia: "2026-11-17", concepto: "agua", pagado: false, tipo: null };
    expect(checkExtract(ok, FIELDS)).toEqual({ ok });
    expect(checkExtract({ ...ok, extra: 1 }, FIELDS)).toEqual({ fault: "keys" });
    expect(checkExtract({ ...ok, importe: "12" }, FIELDS)).toEqual({ fault: "field-number" });
    expect(checkExtract({ ...ok, dia: "17/11/2026" }, FIELDS)).toEqual({ fault: "field-date" });
    expect(checkExtract({ ...ok, tipo: "otro" }, FIELDS)).toEqual({ fault: "field-options" });
    // Plain text: a link or HTML in what a model wrote is refused, as every reader's text.
    expect(checkExtract({ ...ok, concepto: "mira https://ejemplo.example" }, FIELDS)).toEqual({
      fault: "field-text",
    });
  });

  it("AU-57 · «Clasificar» may answer «nothing fits» (null) only when the step asks for it; the readers of mail always choose", () => {
    const options = ["factura", "aviso"];
    expect(classifySchema(options, true)).toMatchObject({
      properties: { choice: { anyOf: [{ type: "string", enum: options }, { type: "null" }] } },
    });
    expect(labelEachSchema(options)).toMatchObject({
      properties: { choices: { items: { type: "string", enum: options } } },
    });
    expect(checkReader("classify", { choice: null }, options)).toEqual({ fault: "choice" });
    expect(checkReader("classify", { choice: null }, options, 0, true)).toEqual({
      ok: { choice: null },
    });
    expect(checkReader("label_each", { choices: ["aviso", null] }, options, 2)).toEqual({
      fault: "choice",
    });
    expect(checkReader("label_each", { choices: ["aviso", null] }, options, 2, true)).toMatchObject(
      {
        ok: {
          choices: ["aviso", null],
          counts: [
            { option: "factura", n: 0 },
            { option: "aviso", n: 1 },
          ],
        },
      },
    );
  });
});
