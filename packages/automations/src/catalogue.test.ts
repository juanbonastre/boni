// The catalogue's rules (docs/automatizaciones.md §5.9, §5.10) and the shape of its data. Pending: one test per
// rule, its id in the name (`make check` reads them). The tests below without an id hold today: they are what lets
// the canvas paint any step with the same controls and a test count its parameters (AU-75, F14b).
import { describe, expect, it } from "vitest";
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
import { ACTION, type Step } from "./format.ts";

describe("the rules of the steps", () => {
  it.todo(
    "AU-19 · what a step reads, writes and destroys comes from its action in the catalogue: the policy's call and touches() say the same, with no other list",
  );
  it.todo(
    "AU-110 · a trigger is a step, the first: «Disparado por el usuario» declares the fields it asks for, and a run starts with them as its one row",
  );
  it.todo(
    "AU-120 · in «Colección» the collection and the action come first and the rest follows: find has its conditions, sort and a limit of 50, and related rows one level as an option",
  );
  it.todo(
    "AU-121 · create and modify write only the fields added; modify and trash act on the rows that arrive or on the ones that match, which without a condition does not validate",
  );
  it.todo(
    "AU-122 · «Eliminar filas» sends rows to the trash: no action of the catalogue and no change of the gate deletes for good",
  );
  it.todo(
    "AU-123 · «Si» sends each row by «sí» or «no»; «Elegir rama» has one output per rule, «otras» when asked, and the first rule that matches or all of them",
  );
  it.todo(
    "AU-124 · «Combinar» has two named inputs and joins by a field, by position or all with all; joining branches needs no step",
  );
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
