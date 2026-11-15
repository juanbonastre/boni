// The catalogue's rules (docs/automatizaciones.md §5.9, §5.10) and the shape of its data: one test per rule, its id
// in the name (`make check` reads them); the ones of «Colección» come with its executors. The tests below without an id hold today: they are what lets
// the canvas paint any step with the same controls and a test count its parameters (AU-75, F14b).
import { describe, expect, it } from "vitest";
import { cite, knowing, sketch } from "./automation.test-util.ts";
import {
  type ActionSpec,
  actionOf,
  CATALOGUE,
  CATEGORIES,
  CONTROLS,
  inputsOf,
  isTrigger,
  type ParamSpec,
  RUN,
  type StepTypeSpec,
  stepType,
} from "./catalogue.ts";
import { CannotRun } from "./engine.ts";
import { ACTION, MAIN, OUT, type Step } from "./format.ts";
import { OUTSIDE, OWN, outOf, start } from "./run.test-util.ts";
import { validate } from "./validate.ts";

describe("the rules of the steps", () => {
  it.todo(
    "AU-19 · what a step reads, writes and destroys comes from its action in the catalogue: the policy's call and touches() say the same, with no other list",
  );
  it("AU-110 · a trigger is a step, the first: «Disparado por el usuario» declares the fields it asks for, and a run starts with them as its one row", async () => {
    const s = sketch()
      .step("Inicio", "manual", {
        fields: [
          { key: "quien", name: "Quién", type: "text" },
          { key: "cuanto", name: "Cuánto", type: "number" },
          { key: "dia", name: "Día", type: "date" },
          { key: "hecho", name: "Hecho", type: "checkbox" },
        ],
      })
      .step("Tras", "limit", { count: 1 })
      .arrow("Inicio", "Tras");
    const a = s.build();
    const e = await start(
      a,
      s.id("Inicio"),
      { quien: "ejemplo", cuanto: 3 },
      {},
      {
        quien: { label: OUTSIDE, derived: false },
      },
    );
    // One row, with every field it asks for (null where none was given), the label of who gave them and no path.
    expect(e.steps[s.id("Inicio")]?.out[MAIN]).toEqual([
      {
        json: { quien: "ejemplo", cuanto: 3, dia: null, hecho: null },
        label: OWN,
        fields: { quien: { label: OUTSIDE, derived: false } },
        path: null,
        parent: null,
      },
    ]);
    expect(e.order[0]).toBe(s.id("Inicio"));
    expect(outOf(e, s.id("Tras"))).toEqual([
      { quien: "ejemplo", cuanto: 3, dia: null, hecho: null },
    ]);

    // What it does not ask for, a value of another type, a step that is not a trigger: refused before anything runs.
    for (const [json, trigger] of [
      [{ otro: 1 }, s.id("Inicio")],
      [{ cuanto: "tres" }, s.id("Inicio")],
      [{ dia: "2 de noviembre" }, s.id("Inicio")],
      [{}, s.id("Tras")],
      [{}, "s_ninguno"],
    ] as const)
      await expect(start(a, trigger, json)).rejects.toBeInstanceOf(CannotRun);
    // An automation with errors does not run, and says why.
    const broken = sketch()
      .step("Inicio", "manual")
      .step("Mal", "limit", {})
      .arrow("Inicio", "Mal");
    const refused = await start(broken.build(), broken.id("Inicio")).catch((x: unknown) => x);
    expect(refused).toBeInstanceOf(CannotRun);
    expect((refused as CannotRun).problems.map((p) => p.code)).toEqual(["param.required"]);
  });
  it.todo(
    "AU-120 · in «Colección» the collection and the action come first and the rest follows: find has its conditions, sort and a limit of 50, and related rows one level as an option",
  );
  it.todo(
    "AU-121 · create and modify write only the fields added; modify and trash act on the rows that arrive or on the ones that match, which without a condition does not validate",
  );
  it.todo(
    "AU-122 · «Eliminar filas» sends rows to the trash: no action of the catalogue and no change of the gate deletes for good",
  );
  it("AU-123 · «Si» sends each row by «sí» or «no»; «Elegir rama» has one output per rule, «otras» when asked, and the first rule that matches or all of them", async () => {
    const rules = [
      { id: "r_bajo", name: "Bajo", where: [{ field: "n", op: "lt", value: 3 }] },
      { id: "r_par", name: "Par", where: [{ field: "par", op: "checked" }] },
    ];
    /** Rows 1 to 4, each saying whether it is even, through «Si» and «Elegir rama». */
    const branches = async (params: Record<string, Step["params"][string]>) => {
      const s = sketch()
        .step("Inicio", "manual")
        .step("Lista", "edit", {
          fields: [{ field: "l", value: [1, 2, 3, 4].map((n) => ({ n, par: n % 2 === 0 })) }],
        })
        .step("Partir", "split", { field: "l" })
        .step("Abrir", "edit", {
          keep: "none",
          fields: [
            { field: "n", value: cite("$json.l.n") },
            { field: "par", value: cite("$json.l.par") },
          ],
        })
        .step("Si", "if", { where: [{ field: "n", op: "gt", value: 2 }] })
        .step("Elegir", "switch", { rules, ...params })
        .arrow("Inicio", "Lista")
        .arrow("Lista", "Partir")
        .arrow("Partir", "Abrir")
        .arrow("Abrir", "Si")
        .arrow("Abrir", "Elegir");
      const e = await start(s.build(), s.id("Inicio"));
      const ns = (step: string) =>
        Object.fromEntries(
          Object.entries(e.steps[s.id(step)]?.out ?? {}).map(([k, rows]) => [
            k,
            rows.map((r) => r.json.n),
          ]),
        );
      return { si: ns("Si"), elegir: ns("Elegir") };
    };
    const first = await branches({});
    expect(first.si).toEqual({ [OUT.yes]: [3, 4], [OUT.no]: [1, 2] });
    // One output per rule, by its id; with no «otras», what matches none goes nowhere; the first rule that matches.
    expect(first.elegir).toEqual({ r_bajo: [1, 2], r_par: [4] });
    expect((await branches({ match: "all" })).elegir).toEqual({ r_bajo: [1, 2], r_par: [2, 4] });
    expect((await branches({ fallback: "other" })).elegir).toEqual({
      r_bajo: [1, 2],
      r_par: [4],
      [OUT.other]: [3],
    });
  });
  it("AU-124 · «Combinar» has two named inputs and joins by a field, by position or all with all; joining branches needs no step", async () => {
    const combined = async (params: Record<string, Step["params"][string]>) => {
      const s = sketch()
        .step("Inicio", "manual")
        .step("Unos", "edit", {
          fields: [
            {
              field: "l",
              value: [
                { k: 1, a: "uno" },
                { k: 2, a: "dos" },
                { k: 3, a: "tres" },
              ],
            },
          ],
        })
        .step("Partir unos", "split", { field: "l" })
        .step("Abrir unos", "edit", {
          keep: "none",
          fields: [
            { field: "k", value: cite("$json.l.k") },
            { field: "a", value: cite("$json.l.a") },
          ],
        })
        .step("Otros", "edit", {
          fields: [
            {
              field: "l",
              value: [
                { k: 2, b: "B2" },
                { k: 4, b: "B4" },
              ],
            },
          ],
        })
        .step("Partir otros", "split", { field: "l" })
        .step("Abrir otros", "edit", {
          keep: "none",
          fields: [
            { field: "k", value: cite("$json.l.k") },
            { field: "b", value: cite("$json.l.b") },
          ],
        })
        .step("Combinar", "combine", params)
        .arrow("Inicio", "Unos")
        .arrow("Unos", "Partir unos")
        .arrow("Partir unos", "Abrir unos")
        .arrow("Inicio", "Otros")
        .arrow("Otros", "Partir otros")
        .arrow("Partir otros", "Abrir otros")
        .arrow("Abrir unos", "Combinar", MAIN, "a")
        .arrow("Abrir otros", "Combinar", MAIN, "b");
      const e = await start(s.build(), s.id("Inicio"));
      expect(e.steps[s.id("Combinar")]?.in).toEqual({ a: 3, b: 2 });
      return outOf(e, s.id("Combinar"));
    };
    const byField = { by: "field", fieldA: "k", fieldB: "k" };
    expect(await combined(byField)).toEqual([{ k: 2, a: "dos", b: "B2" }]);
    expect(await combined({ ...byField, keep: "a" })).toEqual([
      { k: 1, a: "uno" },
      { k: 2, a: "dos", b: "B2" },
      { k: 3, a: "tres" },
    ]);
    expect(await combined({ ...byField, keep: "both" })).toEqual([
      { k: 1, a: "uno" },
      { k: 2, a: "dos", b: "B2" },
      { k: 3, a: "tres" },
      { k: 4, b: "B4" },
    ]);
    // By position, «a»'s fields win where both have one.
    expect(await combined({ by: "position" })).toEqual([
      { k: 1, a: "uno", b: "B2" },
      { k: 2, a: "dos", b: "B4" },
    ]);
    expect(await combined({ by: "all" })).toHaveLength(6);
    // Two branches into one input join with no step (AU-11): «Combinar» is only for crossing.
    expect(stepType("combine")?.inputs).toEqual(["a", "b"]);
    const joined = sketch()
      .step("Inicio", "manual")
      .step("A", "edit", { fields: [{ field: "x", value: 1 }] })
      .step("B", "edit", { fields: [{ field: "x", value: 2 }] })
      .step("Juntas", "limit", { count: 5 })
      .arrow("Inicio", "A")
      .arrow("Inicio", "B")
      .arrow("A", "Juntas")
      .arrow("B", "Juntas");
    expect(validate(joined.build(), knowing())).toEqual([]);
    expect(outOf(await start(joined.build(), joined.id("Inicio")), joined.id("Juntas"))).toEqual([
      { x: 1 },
      { x: 2 },
    ]);
  });
});

const step = (type: string, params: Step["params"] = {}): Step => ({
  id: "s1",
  name: "Step",
  type,
  params,
});

interface ParamList {
  at: string;
  params: readonly ParamSpec[];
  own: StepTypeSpec;
  action?: ActionSpec;
}

/** Every list of parameters of the catalogue, with where it is, a list's columns included. */
function paramLists(): ParamList[] {
  const lists: ParamList[] = [];
  for (const own of CATALOGUE) {
    lists.push({ at: own.type, params: own.params, own });
    for (const action of own.actions) {
      const at = `${own.type}.${action.key}`;
      lists.push({ at, params: action.params, own, action });
      for (const p of action.params)
        if (p.control === "list")
          lists.push({ at: `${at}.${p.key}`, params: p.columns, own, action });
    }
  }
  return lists;
}

describe("the catalogue as data", () => {
  it("has the trigger and the steps of Datos, Transformar and Lógica of F14a, each once", () => {
    const types = CATALOGUE.map((t) => t.type);
    expect(new Set(types).size).toBe(types.length);
    expect(types).toEqual([
      "manual",
      "collection",
      "edit",
      "filter",
      "sort",
      "limit",
      "dedupe",
      "group",
      "split",
      "join",
      "date",
      "combine",
      "if",
      "switch",
      "stop",
    ]);
    expect(stepType("collection")?.actions.map((a) => a.key)).toEqual([
      "find",
      "get",
      "create",
      "update",
      "upsert",
      "trash",
      "aggregate",
    ]);
    for (const t of CATALOGUE) expect(CATEGORIES, t.type).toContain(t.category);
  });

  it("a type has one action called run, or several with their own keys", () => {
    for (const t of CATALOGUE) {
      const keys = t.actions.map((a) => a.key);
      expect(keys.length, t.type).toBeGreaterThan(0);
      expect(new Set(keys).size, t.type).toBe(keys.length);
      if (keys.length === 1) expect(keys, t.type).toEqual([RUN]);
      else expect(keys, t.type).not.toContain(RUN);
    }
  });

  it("only a trigger has no input, and only a data step reads or writes", () => {
    for (const t of CATALOGUE) {
      expect(t.inputs.length === 0, t.type).toBe(t.category === "trigger");
      expect(new Set(t.inputs).size, t.type).toBe(t.inputs.length);
      for (const a of t.actions) {
        if (a.effect !== "none") expect(t.category, `${t.type}.${a.key}`).toBe("data");
        if (a.destroys) expect(a.effect, `${t.type}.${a.key}`).toBe("write");
        if (a.mode === "perRow") expect(a.pairs, `${t.type}.${a.key}`).toBe(true);
      }
    }
  });

  it("every parameter is one of the controls, with a key of its own where it is painted", () => {
    for (const { at, params, own, action } of paramLists()) {
      for (const p of params) expect(CONTROLS, `${at}.${p.key}`).toContain(p.control);
      // Two parameters may share a key only if they are never painted together (their `when` differ).
      const always = [...(action ? own.params : []), ...params].filter((p) => !p.when);
      const keys = always.map((p) => p.key);
      expect(new Set(keys).size, at).toBe(keys.length);
      expect(keys, at).not.toContain(ACTION);
    }
  });

  it("a parameter painted only sometimes depends on a fixed choice of its own step", () => {
    for (const { at, params, own } of paramLists()) {
      for (const p of params) {
        if (!p.when) continue;
        const on = [...own.params, ...params].find((q) => q.key === p.when?.param);
        expect(on, `${at}.${p.key}`).toBeDefined();
        expect(on?.shape, `${at}.${p.key}`).toBe(true);
        expect(on?.control, `${at}.${p.key}`).toBe("choice");
        if (on?.control === "choice" && Array.isArray(on.options))
          for (const v of p.when.in) expect(on.options, `${at}.${p.key}`).toContain(v);
      }
    }
  });

  it("what gives a step its shape or changes which rows come out is never behind «Añadir opción»", () => {
    for (const { at, params } of paramLists())
      for (const p of params)
        if (p.shape || p.changesRows || p.required)
          expect(p.place, `${at}.${p.key}`).not.toBe("option");
  });

  it("a choice with a default offers it", () => {
    for (const { at, params } of paramLists())
      for (const p of params)
        if (p.control === "choice" && Array.isArray(p.options) && p.default !== undefined)
          expect(p.options, `${at}.${p.key}`).toContain(p.default);
  });

  it("a step's action is its type's only one, or the one it names with a fixed value", () => {
    expect(actionOf(step("filter"))?.key).toBe(RUN);
    expect(actionOf(step("collection", { [ACTION]: "find" }))?.effect).toBe("read");
    expect(actionOf(step("collection", { [ACTION]: "trash" }))?.destroys).toBe(true);
    expect(actionOf(step("collection"))).toBeUndefined();
    expect(actionOf(step("collection", { [ACTION]: { expr: "{{ $json.a }}" } }))).toBeUndefined();
    expect(actionOf(step("collection", { [ACTION]: "nothing" }))).toBeUndefined();
    expect(actionOf(step("unknown"))).toBeUndefined();
  });

  it("a trigger is a step of the catalogue with no input", () => {
    expect(isTrigger(step("manual"))).toBe(true);
    expect(isTrigger(step("if"))).toBe(false);
    expect(inputsOf(step("manual"))).toEqual([]);
    expect(inputsOf(step("combine"))).toEqual(["a", "b"]);
    expect(inputsOf(step("unknown"))).toEqual([]);
  });
});
