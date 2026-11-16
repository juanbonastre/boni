// The words of «Automatizaciones» (docs/automatizaciones.md AU-25, AU-60, AU-85, AU-86). Pending but the first: the
// builder's PRs bring the words into i18n.ts and turn each into a real test, the rule's id kept in its name.

import { FORMAT, type Step } from "@boni/automations";
import { describe, expect, it } from "vitest";
import { KEYS, translator } from "../i18n.ts";
import { catalogueKeys, DO, namer, uniqueName } from "./words.ts";

describe("the words of «Automatizaciones»", () => {
  it("AU-85 · each thing the editor does has a key of its own", () => {
    const keys = Object.values(DO);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^auto\.do\.[a-zA-Z]+$/);
  });
  it.todo(
    "AU-85 · the word of each thing the editor does is said by one key of i18n.ts: no other key of auto. says the same in either language, and no component names an auto.do. key but through DO",
  );
  it("AU-86 · every step type, action, parameter, choice, output, setting, measure, problem and failure the catalogue has is worded in i18n.ts in both languages: a name, a card and a panel never show a key", () => {
    const keys = catalogueKeys();
    // Each kind is there: a few of each, so the list is the catalogue's and not an empty one.
    for (const k of [
      "auto.step.filter",
      "auto.action.collection.find",
      "auto.param.collection.collection",
      "auto.output.yes",
      "auto.setting.off",
      "auto.input.b",
    ])
      expect(keys).toContain(k);
    const known = new Set<string>(KEYS);
    expect(keys.filter((k) => !known.has(k))).toEqual([]);
    const es = translator("es");
    const en = translator("en");
    for (const k of keys) {
      expect(es(k), k).not.toBe(k);
      expect(en(k), k).not.toBe(k);
      expect(es(k).trim(), k).not.toBe("");
    }
  });
  it("AU-60 · the section's words say «Automatizaciones» and «automatización» in the sidebar, the collection's page, «Buscar» and the map; «flujo» is left only in «Formato anterior»", () => {
    const es = translator("es");
    const en = translator("en");
    // The sidebar and the collection's page, the conversation, the map, «Buscar».
    expect(es("nav.flows")).toBe("Automatizaciones");
    expect(es("chat.place.flows")).toBe("Automatizaciones");
    expect(es("map.kind.flow")).toBe("Automatización");
    expect(es("map.group.flow")).toBe("Por automatización");
    expect(es("find.action.automations.create")).toContain("Automatizaciones");
    expect(en("nav.flows")).toBe("Automations");
    // No word of the app says «flujo» (nor «flow»): the mark of the editor of before says «Formato anterior».
    expect(KEYS.filter((k) => /flujo/i.test(es(k)))).toEqual([]);
    expect(KEYS.filter((k) => /\bflows?\b/i.test(en(k)))).toEqual([]);
    expect(es("auto.formerFormat")).toBe("Formato anterior");
    expect(en("auto.formerFormat")).toBe("Former format");
  });
  it("AU-86 · a new step is named by its action's phrase and its collection («Buscar filas en Gastos»; with no collection, «Buscar filas»), and a name another step has takes the first free number («Filtrar 2»)", () => {
    const names = namer(translator("es"), { gastos: "Gastos" });
    const step = (type: string, params: Step["params"] = {}): Step => ({
      id: "s_x",
      name: "",
      type,
      params,
    });
    expect(names.auto(step("collection", { action: "find", collection: "gastos" }))).toBe(
      "Buscar filas en Gastos",
    );
    expect(names.auto(step("collection", { action: "find" }))).toBe("Buscar filas");
    // A collection the app does not know is said by its key, never left out.
    expect(names.auto(step("collection", { action: "create", collection: "c_otra" }))).toBe(
      "Crear una fila en c_otra",
    );
    expect(names.auto(step("date", { action: "diff" }))).toBe("Diferencia");
    expect(names.auto(step("filter"))).toBe("Filtrar");
    expect(
      namer(translator("en"), { gastos: "Expenses" }).auto(
        step("collection", { action: "find", collection: "gastos" }),
      ),
    ).toBe("Find rows in Expenses");
    const draft = {
      format: FORMAT,
      id: "a_01jejemplo",
      version: 0,
      name: "Revisar",
      steps: [
        { id: "s_1", name: "Filtrar", type: "filter", params: {} },
        { id: "s_2", name: "Filtrar 2", type: "filter", params: {} },
        { id: "s_3", name: "Ordenar", type: "sort", params: {} },
      ],
      arrows: [],
      settings: {},
    };
    expect(uniqueName(draft, "Filtrar")).toBe("Filtrar 3");
    expect(uniqueName(draft, "Filtrar 2")).toBe("Filtrar 3");
    expect(uniqueName(draft, "Ordenar")).toBe("Ordenar 2");
    expect(uniqueName(draft, "Limitar")).toBe("Limitar");
    // The step being named does not count against itself.
    expect(uniqueName(draft, "Ordenar", "s_3")).toBe("Ordenar");
  });
  it.todo(
    "AU-21 · a result is named by its measure and its field's name («Suma de Importe», «Número de filas»), never by its key, wherever a field's name is read: a chip, «Esquema», a table's header, a summary",
  );
});
