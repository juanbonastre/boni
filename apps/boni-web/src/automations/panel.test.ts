// What the step's view and its card show of a step (docs/automatizaciones.md §5.7, «Contra el mar de opciones»).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACTION,
  type Automation,
  CATALOGUE,
  CONTROLS,
  FORMAT,
  isExpr,
  type ParamValue,
  paramsOf,
  SETTINGS_DEFAULTS,
  STEP_FAILURES,
  type Step,
  stepType,
} from "@boni/automations";
import { describe, expect, it } from "vitest";
import { translator } from "../i18n.ts";
import type { StepTest } from "./client.ts";
import {
  cannotTest,
  conditionFields,
  fieldsOut,
  knownFields,
  labelsOf,
  markedOf,
  missingOf,
  optionsLeft,
  outputSays,
  rowsOf,
  SETTINGS_ROWS,
  settingsChanged,
  summaryOf,
} from "./panel.ts";
import { summaryWords } from "./words.ts";

/**
 * Every step the catalogue can make, as Juan would open it: each type, each action, and each combination of the
 * values of its fixed choices that change its shape (a `when` of another parameter names one of them).
 */
function everyStep(): Step[] {
  const out: Step[] = [];
  for (const spec of CATALOGUE)
    for (const action of spec.actions) {
      const base: Record<string, ParamValue> =
        spec.actions.length > 1 ? { [ACTION]: action.key } : {};
      const all = [...spec.params, ...action.params];
      const shaping = all.filter(
        (p) =>
          p.control === "choice" &&
          Array.isArray(p.options) &&
          all.some((q) => q.when?.param === p.key),
      );
      let combos: Record<string, ParamValue>[] = [base];
      for (const p of shaping)
        combos = combos.flatMap((c) =>
          (p.control === "choice" && Array.isArray(p.options) ? p.options : []).map((o) => ({
            ...c,
            [p.key]: o,
          })),
        );
      for (const params of combos)
        out.push({ id: `s_${out.length}`, name: spec.type, type: spec.type, params });
    }
  return out;
}

describe("«Ajustes»", () => {
  it("AU-78 · «Ajustes» has six rows, the six settings the format has, for every step", () => {
    expect(SETTINGS_ROWS).toHaveLength(6);
    expect([...SETTINGS_ROWS].sort()).toEqual(Object.keys(SETTINGS_DEFAULTS).sort());
  });
  it("AU-79 · every setting not at its default and every added option is a label of the card, in the panel's order, and the tab «Ajustes» counts the settings changed; the three that change the rows say so above the output too", () => {
    const find: Step = {
      id: "s_b",
      name: "Buscar filas",
      type: "collection",
      params: { action: "find", collection: "gastos", related: true },
    };
    expect(labelsOf(find)).toEqual([{ kind: "option", param: "related", changesRows: false }]);
    expect(settingsChanged(find)).toBe(0);
    const all: Step = {
      ...find,
      settings: {
        off: true,
        note: "Para acordarme",
        firstRowOnly: true,
        continueEmpty: true,
        retry: { times: 2, waitMs: 5000 },
        onError: "errorOutput",
      },
    };
    expect(labelsOf(all)).toEqual([
      { kind: "onError", value: "errorOutput", changesRows: false },
      { kind: "retry", times: 2, changesRows: false },
      { kind: "continueEmpty", changesRows: true },
      { kind: "firstRowOnly", changesRows: true },
      { kind: "note", changesRows: false },
      { kind: "off", changesRows: true },
      { kind: "option", param: "related", changesRows: false },
    ]);
    expect(settingsChanged(all)).toBe(6);
    // What is at its default says nothing: a note of spaces, no retries, «Parar».
    const plain: Step = {
      ...find,
      params: { action: "find" },
      settings: { note: "  ", retry: { times: 0, waitMs: 5000 }, onError: "stop", off: false },
    };
    expect(labelsOf(plain)).toEqual([]);
    expect(settingsChanged(plain)).toBe(0);
  });
});

describe("«Parámetros»", () => {
  it("AU-75 · the rows of «Parámetros» of every action of every step, with every combination of its choices, are seven at most before an option is added; an added option is one more row", () => {
    const steps = everyStep();
    // Every type and every action is there, and the choices that shape a step multiply them.
    expect(new Set(steps.map((s) => s.type)).size).toBe(CATALOGUE.length);
    expect(steps.length).toBeGreaterThan(CATALOGUE.flatMap((t) => t.actions).length);
    for (const step of steps) {
      const rows = rowsOf(step);
      expect(rows.length, `${step.type} ${JSON.stringify(step.params)}`).toBeLessThanOrEqual(7);
      expect(rows.every((r) => !r.added)).toBe(true);
      // Each option Juan adds is one row more, and it is his: it has «Quitar».
      const options = optionsLeft(step);
      const withAll: Step = {
        ...step,
        params: { ...step.params, ...Object.fromEntries(options.map((o) => [o.key, true])) },
      };
      expect(rowsOf(withAll).length).toBe(rows.length + options.length);
      expect(rowsOf(withAll).filter((r) => r.added).length).toBe(options.length);
    }
  });
  it("AU-75 · the rows are the catalogue's paramsOf in its order, the shown ones: the type's own first (the collection), then the action, then the action's; the added options come after them, and a hidden parameter is never a row", () => {
    const find: Step = {
      id: "s_b",
      name: "Buscar filas",
      type: "collection",
      // In another order than the catalogue's: the panel follows the catalogue.
      params: { related: true, limit: 5, collection: "gastos", action: "find" },
    };
    expect(rowsOf(find).map((r) => r.param.key)).toEqual([
      "collection",
      "action",
      "where",
      "sort",
      "limit",
      "related",
    ]);
    expect(rowsOf(find).map((r) => r.value)).toEqual([
      "gastos",
      "find",
      undefined,
      undefined,
      5,
      true,
    ]);
    // A parameter whose `when` does not hold is no row: «Las filas que llegan» has no conditions.
    const update: Step = { ...find, params: { action: "update", collection: "gastos" } };
    expect(rowsOf(update).map((r) => r.param.key)).toEqual([
      "collection",
      "action",
      "target",
      "fields",
      "permission",
    ]);
    const matching: Step = { ...update, params: { ...update.params, target: "matching" } };
    expect(rowsOf(matching).map((r) => r.param.key)).toEqual([
      "collection",
      "action",
      "target",
      "where",
      "fields",
      "permission",
    ]);
    for (const step of everyStep()) {
      const shown = paramsOf(step).filter((p) => p.place === "shown");
      expect(rowsOf(step).map((r) => r.param)).toEqual(shown);
      expect(rowsOf(step).some((r) => r.param.place === "hidden")).toBe(false);
    }
  });
  it("AU-75 · a list (conditions, the fields of a row, a list of rows) is one row whatever it holds: what is inside one of its entries is no row of the panel", () => {
    const sort: Step = {
      id: "s_o",
      name: "Ordenar",
      type: "sort",
      params: {
        by: [
          { field: "fecha", direction: "desc" },
          { field: "importe", direction: "asc" },
          { field: "concepto", direction: "asc" },
        ],
      },
    };
    expect(rowsOf(sort).map((r) => r.param.key)).toEqual(["by"]);
    const filter: Step = {
      id: "s_f",
      name: "Filtrar",
      type: "filter",
      params: {
        where: [
          { field: "importe", op: "gt", value: 5 },
          { join: "or", rules: [{ field: "a", op: "is", value: "x" }] },
        ],
      },
    };
    expect(rowsOf(filter)).toHaveLength(1);
    const create: Step = {
      id: "s_c",
      name: "Crear una fila",
      type: "collection",
      params: {
        action: "create",
        collection: "gastos",
        fields: [
          { field: "concepto", value: "Luz" },
          { field: "importe", value: 40 },
        ],
      },
    };
    expect(rowsOf(create).map((r) => r.param.key)).toEqual([
      "collection",
      "action",
      "fields",
      "permission",
    ]);
  });
  it("AU-81 · the fields a condition can name are the collection's in a step of «Colección» and those of the rows that arrive in any other; its operators are the views' for the field's type, and its value is fixed or an expression", () => {
    const gastos = [
      { key: "concepto", name: "Concepto", type: "text" },
      { key: "importe", name: "Importe", type: "money" },
    ];
    const draft: Automation = {
      format: FORMAT,
      id: "a_1",
      version: 1,
      name: "Ejemplo",
      settings: {},
      steps: [
        {
          id: "s_inicio",
          name: "Disparado por el usuario",
          type: "manual",
          params: { fields: [{ key: "minimo", name: "Mínimo", type: "number" }] },
        },
        {
          id: "s_buscar",
          name: "Buscar filas en Gastos",
          type: "collection",
          params: { action: "find", collection: "gastos" },
        },
        { id: "s_filtrar", name: "Filtrar", type: "filter", params: {} },
        { id: "s_si", name: "Si", type: "if", params: {} },
        { id: "s_suelto", name: "Filtrar 2", type: "filter", params: {} },
        {
          id: "s_editar",
          name: "Editar campos",
          type: "edit",
          params: { fields: [{ field: "nota", value: "x" }], keep: "none" },
        },
      ],
      arrows: [
        { from: { step: "s_inicio", output: "main" }, to: { step: "s_buscar", input: "main" } },
        { from: { step: "s_buscar", output: "main" }, to: { step: "s_filtrar", input: "main" } },
        { from: { step: "s_filtrar", output: "main" }, to: { step: "s_si", input: "main" } },
        { from: { step: "s_inicio", output: "main" }, to: { step: "s_editar", input: "main" } },
      ],
    };
    const of = (key: string) => (key === "gastos" ? gastos : undefined);
    const where = (type: string, action?: string) => {
      const step: Step = {
        id: "s",
        name: "",
        type,
        params: action ? { action, target: "matching" } : {},
      };
      const p = paramsOf(step).find((x) => x.key === "where");
      if (!p) throw new Error(`no conditions in ${type}`);
      return p;
    };
    const shapes = (step: string) => ({
      collection: gastos,
      input: { main: knownFields(draft, step, "main", of) },
    });
    // «Colección»: its collection's fields, whatever arrives.
    for (const action of ["find", "update", "trash", "aggregate"])
      expect(conditionFields(where("collection", action), shapes("s_buscar"))).toEqual(gastos);
    // Any other step: the rows that arrive, through the steps that let them pass as they are.
    expect(conditionFields(where("filter"), shapes("s_filtrar"))).toEqual(gastos);
    expect(conditionFields(where("if"), shapes("s_si"))).toEqual(gastos);
    expect(knownFields(draft, "s_buscar", "main", of)).toEqual([
      { key: "minimo", name: "Mínimo", type: "number" },
    ]);
    // With nothing before it, none; after «Editar campos» that keeps none, only what it sets.
    expect(conditionFields(where("filter"), shapes("s_suelto"))).toEqual([]);
    expect(knownFields(draft, "s_editar", "main", of)).toEqual([
      { key: "minimo", name: "Mínimo", type: "number" },
    ]);
    // AU-70: a trigger gives the fields it asks, named, which its «Datos de prueba» lists; a step gives its own.
    expect(fieldsOut(draft, "s_inicio", of)).toEqual([
      { key: "minimo", name: "Mínimo", type: "number" },
    ]);
    expect(fieldsOut(draft, "s_buscar", of)).toEqual(gastos);
    expect(fieldsOut(draft, "s_falta", of)).toEqual([]);
    // Each condition is the views' filter: a rule or a group of one level, and its value fixed or an expression.
    const rule = { field: "importe", op: "gt", value: { expr: "{{ $json.minimo }}" } };
    expect(isExpr(rule.value)).toBe(true);
    const control = where("filter");
    expect(control.control).toBe("conditions");
  });
  it("AU-80 · each control of the catalogue is painted by one component, chosen by the parameter's control alone: no component of the step's view is chosen by a step's type", () => {
    const view = readFileSync(
      join(import.meta.dirname, "..", "components", "AutomationStepView.tsx"),
      "utf8",
    );
    // One component per control, in one table.
    const table = view.match(/const PARAM_CONTROLS[^=]*=\s*\{([^}]*)\}/);
    expect(table, "PARAM_CONTROLS").not.toBeNull();
    const keys = [...(table?.[1] ?? "").matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
    expect(keys.sort()).toEqual([...CONTROLS].sort());
    // Chosen by the parameter's control, and by nothing of the step's type.
    expect(view).toMatch(/PARAM_CONTROLS\[[\w.]*control\]/);
    expect(view).not.toMatch(/\.type\s*===\s*"/);
    expect(view).not.toMatch(
      /case\s+"(manual|collection|filter|sort|limit|dedupe|group|split|join|date|combine|if|switch|stop|edit)"/,
    );
    // Every type the catalogue has paints with those controls alone.
    for (const spec of CATALOGUE)
      for (const p of [...spec.params, ...spec.actions.flatMap((a) => a.params)])
        expect(CONTROLS).toContain(p.control);
  });
  it("AU-76 · «Añadir opción» lists the action's options that are not added, in the catalogue's order, and none when all are", () => {
    const find: Step = {
      id: "s_b",
      name: "Buscar filas",
      type: "collection",
      params: { action: "find", collection: "gastos" },
    };
    expect(optionsLeft(find).map((p) => p.key)).toEqual(["related"]);
    const added: Step = { ...find, params: { ...find.params, related: true } };
    expect(optionsLeft(added)).toEqual([]);
    expect(rowsOf(added).at(-1)).toMatchObject({ added: true, value: true });
    // The options are the action's: another action has its own (here, none).
    expect(optionsLeft({ ...find, params: { action: "get" } })).toEqual([]);
    expect(stepType("collection")?.actions.find((a) => a.key === "find")).toBeDefined();
  });
  it("AU-83 · a required parameter left empty is not marked until Juan leaves it or a test is asked; then the ones he left, or all", () => {
    const step: Step = {
      id: "s_d",
      name: "Sumar o restar",
      type: "date",
      params: { action: "add", amount: 3 },
    };
    // «Unidad» has its default: only «Fecha» and «Guardar en» are missing, in the panel's order.
    expect(missingOf(step).map((p) => p.key)).toEqual(["date", "to"]);
    expect(markedOf(step, [], false)).toEqual([]);
    expect(markedOf(step, ["to"], false).map((p) => p.key)).toEqual(["to"]);
    // A parameter left with a value is no mark.
    expect(markedOf(step, ["amount"], false)).toEqual([]);
    expect(markedOf(step, [], true).map((p) => p.key)).toEqual(["date", "to"]);
    // An empty text, an empty list and an empty expression are empty; an expression is a value.
    expect(missingOf({ ...step, params: { ...step.params, date: "  " } }).length).toBe(2);
    expect(
      missingOf({ ...step, params: { ...step.params, date: { expr: "{{ $json.fecha }}" } } }).map(
        (p) => p.key,
      ),
    ).toEqual(["to"]);
    expect(
      missingOf({ id: "s_o", name: "Ordenar", type: "sort", params: { by: [] } }),
    ).toHaveLength(1);
    // A list under its «min» is missing too, as the server refuses it: a «Programada» with no rule (AU-114).
    const hours = (rules: unknown[]): Step => ({
      id: "s_p",
      name: "Programada",
      type: "schedule",
      params: { rules } as never,
    });
    expect(missingOf(hours([])).map((p) => p.key)).toEqual(["rules"]);
    expect(missingOf(hours([{ key: "r_1", every: "day", at: "08:00" }]))).toEqual([]);
  });
  it("AU-73 · «Probar paso» cannot be pressed with a required parameter empty, naming each, nor while a test runs; otherwise it can", () => {
    const fresh: Step = {
      id: "s_b",
      name: "Buscar filas",
      type: "collection",
      params: { action: "find" },
    };
    expect(cannotTest(fresh, false)).toEqual({
      why: "missing",
      params: [expect.objectContaining({ key: "collection" })],
    });
    const ready: Step = { ...fresh, params: { ...fresh.params, collection: "gastos" } };
    // «Límite» is required and has its default: nothing is missing.
    expect(cannotTest(ready, false)).toBeNull();
    expect(cannotTest(ready, true)).toEqual({ why: "testing" });
    expect(cannotTest(fresh, true)).toEqual({ why: "testing" });
  });
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
  it("AU-248 · «Avisar» and «Preguntar» are one step with «Acción» as its first row: the first view shows only the action, the text, «Por dónde» and, for «Preguntar», its answer and «Días de espera»; the rest is behind «Añadir opción»", () => {
    const notify: Step = { id: "s_a", name: "Avisar", type: "notify", params: {} };
    const ask: Step = { id: "s_p", name: "Preguntar", type: "ask", params: {} };
    expect(rowsOf(notify).map((r) => r.param.key)).toEqual([ACTION, "text", "via"]);
    expect(rowsOf(ask).map((r) => r.param.key)).toEqual([
      ACTION,
      "question",
      "via",
      "answer",
      "waitDays",
    ]);
    // «Acción» is a choice of the two, its value the step's type, never empty.
    for (const s of [notify, ask]) {
      const [first] = rowsOf(s);
      expect(first?.value).toBe(s.type);
      expect(first?.param).toMatchObject({
        control: "choice",
        options: ["notify", "ask"],
        required: true,
        shape: true,
      });
      expect(missingOf(s).map((p) => p.key)).not.toContain(ACTION);
    }
    // «Una opción» shows its options too: still at most seven rows.
    const one: Step = { ...ask, params: { answer: "one" } };
    expect(rowsOf(one).map((r) => r.param.key)).toEqual([
      ACTION,
      "question",
      "via",
      "answer",
      "options",
      "waitDays",
    ]);
    expect(optionsLeft(notify).map((p) => p.key)).toEqual(["mode", "where"]);
    expect(optionsLeft(ask).map((p) => p.key)).toEqual(["mode", "where", "personal"]);
    // «Responder» stays its own step, with no «Acción».
    const reply: Step = { id: "s_r", name: "Responder", type: "reply", params: {} };
    expect(rowsOf(reply).map((r) => r.param.key)).toEqual(["text"]);
  });
});

describe("what the output says in place of rows", () => {
  const step: Step = {
    id: "s_b",
    name: "Buscar filas",
    type: "collection",
    params: { action: "find", collection: "gastos" },
  };
  const test = (over: Partial<StepTest>): StepTest => ({
    state: "done",
    at: 1,
    ms: 20,
    in: { main: 3 },
    out: { main: 3 },
    retries: 0,
    failed: 0,
    wouldWrite: 0,
    stale: false,
    ...over,
  });
  it("AU-72 · a step never tested, one skipped, one that failed and one that gave no rows each say so in the output, and one with rows says nothing in their place", () => {
    expect(outputSays(step, undefined)).toEqual({ kind: "untested" });
    expect(outputSays(step, test({ state: "skipped", out: {} }))).toEqual({ kind: "skipped" });
    // Not reached because the test stopped before it (AU-67): «parado», never «saltado».
    expect(outputSays(step, test({ state: "stopped", out: {} }))).toEqual({ kind: "stopped" });
    expect(outputSays(step, test({ state: "failed", out: {} }))?.kind).toBe("failed");
    expect(outputSays(step, test({ out: { main: 0 } }))).toEqual({ kind: "empty" });
    expect(outputSays(step, test({ out: { yes: 0, no: 0 } }))).toEqual({ kind: "empty" });
    expect(outputSays(step, test({}))).toBeNull();
    // One output with rows is rows to show, even when the other gave none.
    expect(outputSays(step, test({ out: { yes: 0, no: 2 } }))).toBeNull();
  });
  it("AU-84 · a failed step's reason names the parameter at fault when the failure has one, and a failure with no code of its own is said as a general one, never in the engine's English", () => {
    const failed = (error: StepTest["error"]) =>
      outputSays(step, test({ state: "failed", out: {}, ...(error ? { error } : {}) }));
    const said = failed({
      message: "collection gastos has no row r_1",
      failure: { code: "row.missing", param: "collection", detail: { collection: "gastos" } },
    });
    expect(said).toEqual({
      kind: "failed",
      failure: { code: "row.missing", param: "collection", detail: { collection: "gastos" } },
      param: expect.objectContaining({ key: "collection" }),
    });
    // A parameter written with the path inside it is still that parameter.
    expect(
      failed({ message: "x", failure: { code: "value.type", param: "where.0.value" } }),
    ).toMatchObject({ param: { key: "where" } });
    // No code: the general one; the English message is never what is said.
    const general = failed({ message: "TypeError: cannot read properties of undefined" });
    expect(general).toEqual({ kind: "failed", failure: { code: "other" } });
    expect(failed(undefined)).toEqual({ kind: "failed", failure: { code: "other" } });
    // A parameter the step has not: the reason, with nothing to go to.
    expect(failed({ message: "x", failure: { code: "run.limit", param: "nada" } })).toEqual({
      kind: "failed",
      failure: { code: "run.limit", param: "nada" },
    });
    // Every code is worded in both languages, the general one too.
    for (const lang of ["es", "en"] as const) {
      const t = translator(lang);
      for (const code of STEP_FAILURES)
        expect(t(`auto.failure.${code}`)).not.toBe(`auto.failure.${code}`);
    }
  });
});
