// What the step's view and its card show of a step (docs/automatizaciones.md §5.7, «Contra el mar de opciones»).
// Pending but the first: see edit.test.ts.
import { SETTINGS_DEFAULTS, type Step } from "@boni/automations";
import { describe, expect, it } from "vitest";
import { translator } from "../i18n.ts";
import { SETTINGS_ROWS, summaryOf } from "./panel.ts";
import { summaryWords } from "./words.ts";

describe("«Ajustes»", () => {
  it("AU-78 · «Ajustes» has six rows, the six settings the format has, for every step", () => {
    expect(SETTINGS_ROWS).toHaveLength(6);
    expect([...SETTINGS_ROWS].sort()).toEqual(Object.keys(SETTINGS_DEFAULTS).sort());
  });
  it.todo(
    "AU-79 · every setting not at its default and every added option is a label of the card, in the panel's order, and the tab «Ajustes» counts the settings changed; the three that change the rows say so above the output too",
  );
});

describe("«Parámetros»", () => {
  it.todo(
    "AU-75 · the rows of «Parámetros» of every action of every step, with every combination of its choices, are seven at most before an option is added; an added option is one more row",
  );
  it.todo(
    "AU-75 · the rows are the catalogue's paramsOf in its order, the shown ones: the type's own first (the collection), then the action, then the action's; the added options come after them, and a hidden parameter is never a row",
  );
  it.todo(
    "AU-75 · a list (conditions, the fields of a row, a list of rows) is one row whatever it holds: what is inside one of its entries is no row of the panel",
  );
  it.todo(
    "AU-81 · the fields a condition can name are the collection's in a step of «Colección» and those of the rows that arrive in any other; its operators are the views' for the field's type, and its value is fixed or an expression",
  );
  it.todo(
    "AU-80 · each control of the catalogue is painted by one component, chosen by the parameter's control alone: no component of the step's view is chosen by a step's type",
  );
  it.todo(
    "AU-76 · «Añadir opción» lists the action's options that are not added, in the catalogue's order, and none when all are",
  );
  it.todo(
    "AU-83 · a required parameter left empty is not marked until Juan leaves it or a test is asked; then the ones he left, or all",
  );
  it.todo(
    "AU-73 · «Probar paso» cannot be pressed with a required parameter empty, naming each, nor while a test runs; otherwise it can",
  );
  it("AU-63 · the card's summary is made of the shown parameters that have a value, in their order; a citation is read by its field's name and an empty step has no summary", () => {
    const t = translator("es");
    const summary = (step: Step) => summaryOf(step, summaryWords(t, { gastos: "Gastos" }, step));
    const find: Step = {
      id: "s_buscar",
      name: "Buscar filas en Gastos",
      type: "collection",
      // Written in another order than the panel's: the summary follows the panel.
      params: {
        limit: 10,
        sort: [{ field: "fecha", direction: "desc" }],
        where: [
          { field: "importe", op: "gt", value: 50 },
          {
            join: "or",
            rules: [
              { field: "concepto", op: "contains", value: "luz" },
              { field: "concepto", op: "contains", value: "agua" },
            ],
          },
        ],
        action: "find",
        collection: "gastos",
      },
    };
    expect(summary(find)).toEqual(["Gastos", "3 condiciones", "Ordenar por: 1", "Límite 10"]);
    // A citation by its field; an option (not shown) and an empty value say nothing.
    const cited: Step = {
      ...find,
      params: {
        action: "find",
        collection: "gastos",
        where: [],
        limit: { expr: "{{ $json.cuantos }}" },
        related: true,
      },
    };
    expect(summary(cited)).toEqual(["Gastos", "cuantos"]);
    // A list by how many it holds.
    const sort: Step = {
      id: "s_o",
      name: "Ordenar",
      type: "sort",
      params: { by: [{ field: "fecha", direction: "asc" }] },
    };
    expect(summary(sort)).toEqual(["Ordenar por: 1"]);
    // A new step, with its action alone: no summary.
    expect(
      summary({ id: "s_n", name: "Buscar filas", type: "collection", params: { action: "find" } }),
    ).toEqual([]);
    expect(summary({ id: "s_f", name: "Filtrar", type: "filter", params: {} })).toEqual([]);
  });
});

describe("what the output says in place of rows", () => {
  it.todo(
    "AU-72 · a step never tested, one skipped, one that failed and one that gave no rows each say so in the output, and one with rows says nothing in their place",
  );
  it.todo(
    "AU-84 · a failed step's reason names the parameter at fault when the failure has one, and a failure with no code of its own is said as a general one, never in the engine's English",
  );
});
