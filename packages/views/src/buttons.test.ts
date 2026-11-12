import { label, type TypeDef } from "@boni/entities";
import { describe, expect, it } from "vitest";
import { catalogueData } from "./blockData.ts";
import { buttonArgsOk, buttonDoes, buttonRefs, buttonValues } from "./buttons.ts";
import {
  catalogueErrors,
  catalogueForAI,
  fitAfter,
  kindOf,
  newBlock,
  optionsOf,
} from "./catalogue.ts";
import { type PageSpec, pageErrors } from "./page.ts";
import type { ControlBlock } from "./pageValues.ts";

/**
 * A page's buttons (docs/sistema.md §4.6 points 4 and 5, D-60), with collections shaped like a user's
 * (e2e/server-data.ts): movements whose category is a relation to a collection of categories, generated ids.
 * Invented data.
 */

const L = label("user", "personal", []);
const CAT = "t_01kcat0000000000000000000a";
const MOV = "t_01kmov0000000000000000000b";
const types = [
  {
    id: CAT,
    key: "categoria",
    name: "Categorías",
    titleField: "f_cat_titulo",
    fields: [
      { id: "f_cat_titulo", key: "title", name: "Nombre", type: "text", label: L },
      { id: "f_cat_tope", key: "budget", name: "Tope", type: "money", label: L },
    ],
    sensitivity: "personal",
    schemaVersion: 1,
    label: L,
  },
  {
    id: MOV,
    key: "movimiento",
    name: "Movimientos",
    titleField: "f_mov_concepto",
    fields: [
      { id: "f_mov_concepto", key: "title", name: "Concepto", type: "text", label: L },
      { id: "f_mov_importe", key: "amount", name: "Importe", type: "money", label: L },
      {
        id: "f_mov_categoria",
        key: "category",
        name: "Categoría",
        type: "relation",
        relation: { target: CAT, many: false },
        label: L,
      },
    ],
    sensitivity: "personal",
    schemaVersion: 1,
    label: L,
  },
] as unknown as TypeDef[];

const control: ControlBlock = {
  id: "b_cat",
  type: "control",
  name: "Categoría",
  kind: "option",
  collection: MOV,
  field: "f_mov_categoria",
  value: "e_01kcafe00000000000000000000",
};
const month: ControlBlock = { id: "b_mes", type: "control", name: "Mes", kind: "month" };
const data = {
  ...catalogueData(types, [control, month]),
  flows: [{ value: "resumen-del-mes-3fa9c1", label: "Resumen del mes", inputs: ["mes", "nota"] }],
  pages: [{ value: "p_01kotra000000000000000000", label: "Otra" }],
};
const page = (blocks: unknown[]): PageSpec => ({ version: 1, blocks }) as unknown as PageSpec;

describe("a page's buttons (D-60)", () => {
  it("the first buttons stay as they were: no «does» is a form's button", () => {
    const v1 = {
      id: "b_gasto",
      type: "action",
      label: "Apuntar gasto",
      screen: "capture-expense",
      mode: "save",
      values: { amount: 1.6, category: "Cafés" },
    };
    expect(buttonDoes(v1 as { does?: undefined })).toBe("screen");
    expect(catalogueErrors(v1)).toEqual([]);
    expect(pageErrors(page([v1]))).toEqual([]);
    // A form's settings do not belong to the other buttons, nor theirs to it.
    expect(catalogueErrors({ ...v1, flow: "x" }).map((p) => p.key)).toEqual(["flow"]);
    expect(
      catalogueErrors({
        id: "b",
        type: "action",
        label: "X",
        does: "flow",
        flow: "x",
        screen: "capture-expense",
      }).map((p) => p.key),
    ).toEqual(["screen"]);
  });

  it("an action's button names the action, the collection, the record and its values", () => {
    const update = {
      id: "b_tope",
      type: "action",
      label: "Subir tope",
      does: "action",
      action: "entities.update",
      collection: CAT,
      record: "$b_cat",
      set: { f_cat_tope: 120 },
    };
    expect(catalogueErrors(update, data)).toEqual([]);
    expect(pageErrors(page([control, update]))).toEqual([]);
    // Its record is what an option control over a relation to its collection holds.
    const record = kindOf("action")?.settings.find((s) => s.key === "record");
    expect(record && optionsOf(record, update, data)).toEqual([
      { value: "$b_cat", label: "Categoría" },
    ]);
    expect(record && optionsOf(record, { ...update, collection: MOV }, data)).toEqual([]);
    expect(pageErrors(page([update]))).toEqual([
      "blocks[0]: record names no option control of the page",
    ]);
    expect(pageErrors(page([month, { ...update, record: "$b_mes" }]))).toEqual([
      "blocks[1]: record names no option control of the page",
    ]);
    // Creating takes no record; deleting takes no values; a field the collection does not have is not in its data.
    const create = {
      ...update,
      action: "entities.create",
      record: undefined,
      set: { f_cat_titulo: "$b_mes" },
    };
    delete create.record;
    expect(catalogueErrors(create, data)).toEqual([]);
    expect(catalogueErrors({ ...create, record: "$b_cat" }).map((p) => p.key)).toEqual(["record"]);
    const del = { ...update, action: "entities.delete" };
    expect(catalogueErrors(del).map((p) => p.key)).toEqual(["set"]);
    expect(catalogueErrors({ ...update, set: { f_no: 1 } }, data)).toEqual([
      { block: "b_tope", key: "set", code: "not-in-data", value: "f_no" },
    ]);
    // Only the actions of the list a button may run.
    expect(
      catalogueErrors({ ...update, action: "schema.delete_type" }).some((p) => p.key === "action"),
    ).toBe(true);
    expect(pageErrors(page([control, { ...update, action: "schema.delete_type" }]))).not.toEqual(
      [],
    );
  });

  it("a flow's button names the flow and fills its form", () => {
    const run = {
      id: "b_resumen",
      type: "action",
      label: "Resumir",
      does: "flow",
      flow: "resumen-del-mes-3fa9c1",
      inputs: { mes: "$b_mes", nota: "de la página" },
    };
    expect(catalogueErrors(run, data)).toEqual([]);
    expect(pageErrors(page([month, run]))).toEqual([]);
    expect(pageErrors(page([run]))).toEqual(["blocks[0]: inputs names no control of the page"]);
    expect(catalogueErrors({ ...run, inputs: { otra: 1 } }, data)).toEqual([
      { block: "b_resumen", key: "inputs", code: "not-in-data", value: "otra" },
    ]);
    expect(catalogueErrors({ ...run, flow: "no-esta" }, data).map((p) => p.code)).toEqual([
      "not-in-data",
    ]);
  });

  it("a page's button opens a page with values, as a link does", () => {
    const go = {
      id: "b_ir",
      type: "action",
      label: "Ver",
      does: "page",
      to: "p_01kotra000000000000000000",
      pass: { b_cat: "$b_cat" },
    };
    expect(catalogueErrors(go, data)).toEqual([]);
    expect(pageErrors(page([control, go]))).toEqual([]);
    expect(pageErrors(page([go]))).toEqual(["blocks[0]: pass names no control of the page"]);
  });

  it("its values are a few literals or controls, read when it is pressed", () => {
    expect(buttonArgsOk({ a: "x", b: 2, c: true, d: "$b_cat" })).toBe(true);
    expect(buttonArgsOk({ a: { lit: 1 } })).toBe(false);
    expect(buttonArgsOk({ a: "x".repeat(201) })).toBe(false);
    expect(
      buttonArgsOk(Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, i]))),
    ).toBe(false);
    expect(buttonArgsOk({ "no vale": 1 })).toBe(false);
    const b = {
      id: "b",
      type: "action" as const,
      label: "X",
      does: "action" as const,
      record: "$b_cat",
      set: { f_cat_tope: 5, f_cat_titulo: "$b_mes" },
    };
    expect(buttonRefs(b)).toEqual(["b_cat", "b_mes"]);
    expect(buttonValues(b.set, [control, { ...month, value: "2026-11" }])).toEqual({
      values: { f_cat_tope: 5, f_cat_titulo: "2026-11" },
      from: { f_cat_titulo: "b_mes" },
    });
    expect(buttonValues(b.set, [control, month]).values.f_cat_titulo).toBeNull();
  });

  it("the panel fits a button to what it now does, and a new one is a form's", () => {
    const b = {
      id: "b",
      type: "action",
      label: "X",
      screen: "capture-expense",
      mode: "save",
      values: { amount: 1 },
    };
    const asAction = fitAfter({ ...b, does: "action" }, "does", data);
    expect(asAction).toEqual({
      id: "b",
      type: "action",
      label: "X",
      does: "action",
      action: "entities.create",
      collection: CAT,
    });
    const toMov = fitAfter(
      { ...asAction, collection: MOV, set: { f_cat_tope: 1, f_mov_importe: 2 } },
      "collection",
      data,
    );
    expect(toMov.set).toEqual({ f_mov_importe: 2 });
    expect(fitAfter({ ...asAction, does: "flow" }, "does", data)).toEqual({
      id: "b",
      type: "action",
      label: "X",
      does: "flow",
      flow: "resumen-del-mes-3fa9c1",
    });
    expect(newBlock("action", "b_n", data)).toEqual({
      id: "b_n",
      type: "action",
      label: "Apuntar gasto",
      screen: "capture-expense",
    });
    expect(catalogueForAI(data)).toContain("starts a flow");
    // The AI is told it cannot write one: a page's button is the user's (pageActions.ts `blockFrom`).
    expect(catalogueForAI(data)).toContain("never by you");
  });
});
