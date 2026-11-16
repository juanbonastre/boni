// The words of «Automatizaciones» (docs/automatizaciones.md AU-25, AU-60, AU-85, AU-86). Pending but the first: the
// builder's PRs bring the words into i18n.ts and turn each into a real test, the rule's id kept in its name.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Automation, FORMAT, type Step } from "@boni/automations";
import { cpu, under } from "@boni/pace";
import { describe, expect, it } from "vitest";
import { KEYS, type Lang, translator } from "../i18n.ts";
import { fieldsOut } from "./panel.ts";
import {
  catalogueKeys,
  choiceNames,
  DO,
  fieldNames,
  namedRow,
  namer,
  summaryWords,
  uniqueName,
} from "./words.ts";

describe("the words of «Automatizaciones»", () => {
  it("AU-85 · each thing the editor does has a key of its own", () => {
    const keys = Object.values(DO);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^auto\.do\.[a-zA-Z]+$/);
  });
  it("AU-85 · the word of each thing the editor does is said by one key of i18n.ts: no other key of auto. says the same in either language, and no component names an auto.do. key but through DO", () => {
    const own = new Set<string>(Object.values(DO));
    for (const lang of ["es", "en"] as Lang[]) {
      const t = translator(lang);
      const others = new Map<string, string>();
      for (const k of KEYS)
        if (k.startsWith("auto.") && !own.has(k)) others.set(t(k).toLowerCase(), k);
      for (const k of own) {
        const word = t(k);
        expect(word, `${k} (${lang})`).not.toBe(k);
        expect(others.get(word.toLowerCase()), `${k} «${word}» (${lang})`).toBeUndefined();
      }
    }
    // The components and the rest of the app say them through DO: no `auto.do.` written anywhere but words.ts.
    const src = join(import.meta.dirname, "..");
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? files(join(dir, e.name))
          : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)
            ? [join(dir, e.name)]
            : [],
      );
    const named = files(src).filter(
      (f) =>
        !f.endsWith("/i18n.ts") &&
        !f.endsWith("/automations/words.ts") &&
        readFileSync(f, "utf8").includes('"auto.do.'),
    );
    expect(named).toEqual([]);
  });
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
  it("AU-21 · a result is named by its measure and its field's name («Suma de Importe», «Número de filas»), never by its key, wherever a field's name is read: a chip, «Esquema», a table's header, a summary", () => {
    const t = translator("es");
    const gastos = [
      { key: "importe", name: "Importe", type: "money" },
      {
        key: "categoria",
        name: "Categoría",
        type: "select",
        options: [{ id: "opt_comida", name: "Comida" }],
      },
    ];
    const draft = {
      format: FORMAT,
      id: "a_01jresultados",
      name: "Resultados",
      steps: [
        {
          id: "s_buscar",
          name: "Buscar gastos",
          type: "collection",
          params: { action: "find", collection: "gastos" },
        },
        {
          id: "s_agrupar",
          name: "Agrupar",
          type: "group",
          params: {
            by: [{ field: "categoria" }],
            measures: [{ measure: "sum", field: "importe" }, { measure: "count" }],
          },
        },
        {
          id: "s_contar",
          name: "Contar o sumar",
          type: "collection",
          params: {
            action: "aggregate",
            collection: "gastos",
            measure: "max",
            field: "importe",
            groupBy: "categoria",
          },
        },
      ],
      arrows: [
        { from: { step: "s_buscar", output: "main" }, to: { step: "s_agrupar", input: "main" } },
      ],
      settings: {},
    } as unknown as Automation;
    const of = (key: string) => (key === "gastos" ? gastos : undefined);
    // What chips (`paint`'s names), «Esquema» and the tables' headers read: one map by key.
    expect(fieldNames(t, fieldsOut(draft, "s_agrupar", of))).toEqual({
      categoria: "Categoría",
      sum_importe: "Suma de Importe",
      count: "Número de filas",
    });
    expect(fieldNames(t, fieldsOut(draft, "s_contar", of))).toEqual({
      categoria: "Categoría",
      max_importe: "Máximo de Importe",
    });
    // A choice's options by their names, for a row's values.
    expect(choiceNames(fieldsOut(draft, "s_agrupar", of))).toEqual({
      categoria: { opt_comida: "Comida" },
    });
    // The card's summary says a citation of a result by the same name.
    const names = fieldNames(t, fieldsOut(draft, "s_agrupar", of));
    const limit = {
      id: "s_l",
      name: "Limitar",
      type: "limit",
      params: { count: { expr: "{{ $json.sum_importe }}" } },
    } as unknown as Step;
    const say = summaryWords(t, {}, limit, (c) =>
      c.step === null ? names[c.path[0] ?? ""] : undefined,
    );
    expect(
      say({ key: "count", control: "value", of: "number", place: "shown" } as never, {
        expr: "{{ $json.sum_importe }}",
      }),
    ).toBe("Suma de Importe");
  });
  it("AU-21 · wherever a row's value is shown, a choice is said by its option's name, also inside a list and in the value before of «Haría esto»; naming 3,000 rows of 40 fields stays within a frame a page, and a row with no choice is the same row (A-15)", () => {
    const label = {
      integrity: "user",
      sensitivity: "personal",
      thirdParty: false,
      sources: [],
    } as const;
    const choices = {
      estado: { opt_01jpend: "Pendiente", opt_01jleido: "Leído" },
      temas: { opt_01jnovela: "Novela", opt_01jensayo: "Ensayo" },
    };
    const one = namedRow(
      {
        json: { titulo: "Rayuela", estado: "opt_01jleido", temas: ["opt_01jnovela", "otro"] },
        label,
        before: { estado: "opt_01jpend" },
        would: "update",
      },
      choices,
    );
    expect(one.json).toEqual({ titulo: "Rayuela", estado: "Leído", temas: ["Novela", "otro"] });
    expect(one.before).toEqual({ estado: "Pendiente" });
    const plain = { json: { titulo: "Rayuela" }, label };
    expect(namedRow(plain, choices)).toEqual(plain);
    expect(namedRow(plain, choices).json).toBe(plain.json);
    // His volume: a test's 3,000 rows of 40 fields, three of them choices, named in one go.
    const rows = Array.from({ length: 3000 }, (_, i) => ({
      json: Object.fromEntries(
        Array.from({ length: 40 }, (_, f) => [
          `campo_${f}`,
          f === 0 ? "opt_01jpend" : f === 1 ? ["opt_01jnovela"] : `valor ${i}-${f}`,
        ]),
      ),
      label,
    }));
    const many = {
      campo_0: choices.estado,
      campo_1: choices.temas,
      campo_2: { opt_01jx: "X" },
    };
    const start = cpu();
    const named = rows.map((r) => namedRow(r, many));
    const ms = cpu() - start;
    expect(named[2999]?.json.campo_0).toBe("Pendiente");
    expect(named[2999]?.json.campo_1).toEqual(["Novela"]);
    // A table names a page of 50 rows when it comes: a frame (16 ms) a page is the bound. Measured here (2026-11-16,
    // its CPU time, load 5 to 7 on 8 cores): 0.10 to 0.12 ms a page.
    under(ms / (rows.length / 50), 16, "cpu", "naming a page of 50 rows");
  });
});
