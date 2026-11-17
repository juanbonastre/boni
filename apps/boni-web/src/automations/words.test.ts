// The words of «Automatizaciones» (docs/automatizaciones.md AU-25, AU-60, AU-85, AU-86). Pending but the first: the
// builder's PRs bring the words into i18n.ts and turn each into a real test, the rule's id kept in its name.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Automation,
  CODE_FAILURES,
  CODE_LIMITS,
  CODE_PROBLEMS,
  FORMAT,
  HARD_LIMITS,
  RUN_LIMIT_KEYS,
  type Step,
} from "@boni/automations";
import { cpu, under } from "@boni/pace";
import { describe, expect, it } from "vitest";
import { KEYS, type Lang, translator } from "../i18n.ts";
import { fieldsOut } from "./panel.ts";
import {
  catalogueKeys,
  choiceNames,
  DO,
  fieldNames,
  namedCell,
  namedRow,
  namer,
  REASONS,
  ruleWords,
  said,
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
  it("AU-114 · a «Programada»'s rules are said as the flows of before say theirs, on its card the first and how many more", () => {
    const es = translator("es");
    expect(ruleWords(es, { every: "day", at: "08:00" })).toBe("Cada día a las 08:00");
    expect(ruleWords(es, { every: "week", at: "09:00", day: "monday" })).toBe(
      "Cada lunes a las 09:00",
    );
    expect(ruleWords(es, { every: "week", at: "10:30", day: "sunday" })).toBe(
      "Cada domingo a las 10:30",
    );
    expect(ruleWords(es, { every: "hour", at: "00:00" })).toBe("Cada hora");
    expect(ruleWords(es, { every: "hour", at: "00:15" })).toBe("Cada hora a y 15");
    const step = { id: "s_p", name: "Programada", type: "schedule", params: {} } as unknown as Step;
    const say = summaryWords(es, {}, step);
    const rules = { key: "rules", control: "list", place: "shown", columns: [] } as never;
    expect(say(rules, [{ every: "day", at: "08:00" }] as never)).toBe("Cada día a las 08:00");
    expect(
      say(rules, [
        { every: "day", at: "08:00" },
        { every: "week", at: "09:00", day: "monday" },
      ] as never),
    ).toBe("Cada día a las 08:00 y 1 más");
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
  it("AU-23 AU-21 · a value the box worked out says each option by its name, at any row and inside a list or an object", () => {
    const choices = {
      s_01jbuscar: { estado: { opt_01jpend: "Pendiente", opt_01jleido: "Leído" } },
      s_01jotro: { temas: { opt_01jnovela: "Novela" } },
    };
    expect(namedCell("opt_01jleido", choices)).toBe("Leído");
    expect(namedCell(["opt_01jnovela", "otro", 3], choices)).toEqual(["Novela", "otro", 3]);
    expect(namedCell({ a: "opt_01jpend", b: null }, choices)).toEqual({ a: "Pendiente", b: null });
    expect(namedCell(7, choices)).toBe(7);
    expect(namedCell("opt_01jleido", {})).toBe("opt_01jleido");
  });
});

describe("what JavaScript's problems and failures say", () => {
  const es = translator("es");
  const en = translator("en");
  // A collection by its key, generated as Juan's are; a field by its key.
  const names = {
    collection: (k: string) => ({ c_01kx3m9q2a7v: "Pedidos" })[k],
    field: (c: string, k: string) =>
      c === "c_01kx3m9q2a7v" && k === "f_importe" ? "Importe" : undefined,
  };
  it("AU-24 AU-35 AU-183 A-34 · every code of CODE_PROBLEMS and CODE_FAILURES, each reason and each limit is worded in both languages: the screen never shows a key", () => {
    const keys = catalogueKeys();
    for (const code of CODE_PROBLEMS)
      expect(
        keys.some((k) => k === `auto.problem.${code}` || k.startsWith(`auto.problem.${code}.`)),
        code,
      ).toBe(true);
    for (const code of CODE_FAILURES)
      expect(
        keys.some((k) => k === `auto.failure.${code}` || k.startsWith(`auto.failure.${code}.`)),
        code,
      ).toBe(true);
    for (const l of HARD_LIMITS) expect(keys).toContain(`auto.limit.${l}`);
    // The write ones the coordinator named, each with its reasons.
    for (const k of [
      "auto.problem.code.colUse.kept",
      "auto.problem.code.colUse.computed",
      "auto.problem.code.colUse.unknown",
      "auto.problem.code.write.notAllowed",
      "auto.failure.code.write.notAllowed",
      "auto.failure.code.write.unseen.code",
      "auto.failure.code.write.outside.row",
      "auto.failure.code.write.hidden",
      "auto.failure.code.unavailable.busy",
      "auto.failure.code.limit.got",
    ])
      expect(keys).toContain(k);
    for (const k of keys) {
      expect(es(k), k).not.toBe(k);
      expect(en(k), k).not.toBe(k);
    }
    // A reason the engine gives with no key would read as the code: every reason has its own.
    for (const kind of ["problem", "failure"] as const)
      for (const [code, r] of Object.entries(REASONS[kind]))
        for (const reason of r.of) expect(keys).toContain(`auto.${kind}.${code}.${reason}`);
  });
  it("AU-17 · a run stopped at its limit, and a limit set above its ceiling, say which limit in its own words and both numbers, in both languages", () => {
    const stop = (lang: typeof es, locale: string, limit: string, max: number, got: number) =>
      said(lang, "failure", { code: "run.limit", detail: { limit, max, got } }, locale);
    expect(stop(es, "es-ES", "rowsWritten", 1000, 3000)).toBe(
      "Paró: iba a escribir 3000 filas y el límite son 1000",
    );
    expect(stop(en, "en-GB", "rowsWritten", 1000, 3000)).toBe(
      "It stopped: it was going to write 3,000 rows and the limit is 1,000",
    );
    expect(stop(es, "es-ES", "ms", 60_000, 61_500)).toBe(
      "Paró: llevaba 61,5 s y el límite son 60 s",
    );
    expect(stop(es, "es-ES", "steps", 200, 201)).toBe(
      "Paró: iba a dar 201 pasos y el límite son 200",
    );
    expect(
      said(
        es,
        "problem",
        { code: "limit.over", detail: { limit: "rowsWritten", max: 20_000, got: 25_000 } },
        "es-ES",
      ),
    ).toBe("Las filas escritas en una ejecución son 25.000, y como mucho pueden ser 20.000");
    expect(
      said(
        en,
        "problem",
        { code: "limit.over", detail: { limit: "ms", max: 600_000, got: 900_000 } },
        "en-GB",
      ),
    ).toBe("The time of a run is 900 s, and it can be 600 s at most");
    // Every limit of the run has its sentence, in both languages.
    for (const lang of [es, en])
      for (const limit of RUN_LIMIT_KEYS) {
        expect(
          said(lang, "failure", { code: "run.limit", detail: { limit, max: 1, got: 2 } }, "es-ES"),
        ).not.toMatch(/auto\./);
        expect(
          said(lang, "problem", { code: "limit.over", detail: { limit, max: 1, got: 2 } }, "es-ES"),
        ).not.toMatch(/auto\./);
      }
  });
  it("AU-192 · a code that cites a collection by the name it had says the name of today", () => {
    expect(
      said(
        es,
        "problem",
        {
          code: "code.collectionRenamed",
          detail: { name: "Alfa", now: "Delta", collection: "t_1" },
        },
        "es-ES",
        {
          collection: () => "Delta",
        },
      ),
    ).toBe("$col('Alfa'): ahora se llama «Delta»");
  });
  it("AU-35 · a limit says which and by how much, with its unit; time, operations and memory say the limit alone", () => {
    expect(
      said(
        es,
        "failure",
        {
          code: "code.limit",
          detail: { limit: "outputBytes", max: CODE_LIMITS.outputBytes, got: 5 * 1024 * 1024 },
        },
        "es-ES",
      ),
    ).toBe("Se pasó del tope de lo que devuelve el código: 4 MB, y llegó a 5 MB");
    expect(
      said(
        es,
        "failure",
        { code: "code.limit", detail: { limit: "ms", max: CODE_LIMITS.ms } },
        "es-ES",
      ),
    ).toBe("Se pasó del tope de tiempo de una llamada: 5 s");
    expect(
      said(
        es,
        "failure",
        { code: "code.limit", detail: { limit: "readRows", max: 5000, got: 12400 } },
        "es-ES",
      ),
    ).toBe("Se pasó del tope de filas de una lectura: 5000, y llegó a 12.400");
    expect(
      said(
        en,
        "failure",
        { code: "code.limit", detail: { limit: "readRows", max: 5000, got: 12400 } },
        "en-GB",
      ),
    ).toBe("It passed the limit of rows of one read: 5,000, and reached 12,400");
    expect(
      said(es, "problem", { code: "code.long", detail: { max: 2000, got: 2140 } }, "es-ES"),
    ).toBe("Es demasiado largo: 2140 caracteres, y caben 2000");
    expect(
      said(es, "failure", { code: "code.unavailable", detail: { why: "busy" } }, "es-ES"),
    ).toContain("no corrió nada");
  });
  it("AU-176 AU-177 AU-183 · saving's words name the collection and the field by their names and the action by its word; a row that is not there and one the connection leaves out read the same", () => {
    const c = "c_01kx3m9q2a7v";
    expect(
      said(
        es,
        "problem",
        {
          code: "code.write.notAllowed",
          detail: { collection: c, action: "remove", line: 3, column: 1 },
        },
        "es-ES",
        names,
      ),
    ).toBe("La conexión con «Pedidos» no deja eliminar filas");
    expect(
      said(
        es,
        "failure",
        { code: "code.write.hidden", detail: { collection: c, field: "f_importe" } },
        "es-ES",
        names,
      ),
    ).toBe("La conexión no deja ver «Importe» de «Pedidos»: no se guardó nada");
    // One code for both: the engine says them the same, so the screen cannot tell them apart.
    expect(
      said(
        es,
        "failure",
        { code: "code.write.outside", detail: { why: "row", collection: c } },
        "es-ES",
        names,
      ),
    ).toBe("Esa fila de «Pedidos» no existe o la conexión no la deja ver: no se guardó nada");
    expect(
      said(
        es,
        "problem",
        { code: "code.colUse", detail: { why: "computed", name: "Pedidos" } },
        "es-ES",
      ),
    ).toBe("El método va escrito por su nombre: $col('Pedidos').update(…)");
    // A collection as the code wrote it, with no key to name it by, is said as written.
    expect(
      said(
        es,
        "failure",
        {
          code: "code.write.unseen",
          detail: { where: "code", collection: "Pedidos", action: "create" },
        },
        "es-ES",
        names,
      ),
    ).toBe("Pidió crear filas en «Pedidos», y el código guardado no lo hace: no se guardó nada");
  });
  it("AU-23 AU-33 · a value said in a sentence is said as it is: a `{row}` in a code's message or in a cell is never filled in", () => {
    const es = translator("es");
    expect(es("auto.preview", { value: "{row} y {of}", row: 2, of: 3 })).toBe(
      "= {row} y {of} · con la fila 2 de 3",
    );
  });
  it("AU-33 · an error's message is said as the code gave it, with its line when there is one", () => {
    expect(
      said(
        es,
        "failure",
        { code: "code.threw", detail: { message: "<b>x</b> is not defined", line: 4, column: 7 } },
        "es-ES",
      ),
    ).toBe("El código falló en la línea 4: <b>x</b> is not defined");
    expect(said(es, "failure", { code: "code.threw", detail: { message: "nada" } }, "es-ES")).toBe(
      "El código falló: nada",
    );
  });
});
