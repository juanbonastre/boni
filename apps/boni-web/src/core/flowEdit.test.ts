/** (test) What the flow editor does to a plan (docs/flujos.md, F2), on an invented flow like «Leer correo». */
import { describe, expect, it } from "vitest";
import type { FlowCatalog, FlowPlan } from "./agent.ts";
import {
  addStep,
  changeCollection,
  depsOf,
  duplicateStep,
  exprText,
  moveAfter,
  newStep,
  newStepId,
  planUpTo,
  refsUsed,
  removeStep,
  setAt,
  slotsOf,
  takeValue,
} from "./flowEdit.ts";

const field = (key: string, roles: string[] = [], type = "text") => ({
  key,
  name: key,
  type,
  roles,
  relation: null,
});
const CATALOG: FlowCatalog = {
  tools: [
    {
      name: "entities.create",
      title: "Crear",
      effect: "write",
      args: [
        { name: "type", role: "type", required: true },
        { name: "values", role: "content", required: true },
      ],
    },
    {
      name: "notify",
      title: "Avisar",
      effect: "notify",
      args: [{ name: "text", role: "content", required: true }],
    },
  ],
  readers: {
    fill: { params: ["fields"], required: ["fields"], out: ["values", "note"] },
    summarize: { params: [], required: [], out: ["text"] },
  },
  asks: ["choice", "text"],
  replies: { text: ["template", "a"] },
  fns: { obj: [2, 40], merge: [2, 8] },
  limits: { steps: 40, each: 50, nesting: 3 },
  collections: [
    {
      key: "gestiones",
      name: "Gestiones",
      parent: null,
      fields: [field("titulo", ["title"]), field("fecha", ["date"], "date"), field("prioridad")],
    },
    {
      key: "docencia",
      name: "Docencia",
      parent: null,
      fields: [
        field("nombre", ["title"]),
        field("dia", ["date"], "date"),
        field("hora", ["time"], "time"),
      ],
    },
  ],
  modules: ["tasks", "events"],
};
const PLAN: FlowPlan = {
  version: 1,
  steps: [
    { id: "r", op: "read", reader: "read_message", input: { ref: "$text" }, params: {} },
    {
      id: "n0_tasks_f",
      op: "read",
      reader: "fill",
      each: { ref: "$r.tasks" },
      input: { ref: "$text" },
      params: { fields: { ref: "$fill.gestiones" } },
    },
    {
      id: "n0_tasks",
      op: "call",
      tool: "entities.create",
      each: { ref: "$r.tasks" },
      zip: { ref: "$n0_tasks_f" },
      args: {
        type: { lit: "gestiones" },
        values: {
          fn: "merge",
          args: [
            { ref: "$prefill.gestiones" },
            { ref: "$zip.values" },
            {
              fn: "obj",
              args: [
                { lit: "title" },
                { ref: "$item.title" },
                { lit: "fecha" },
                { ref: "$item.due" },
                { lit: "prioridad" },
                { lit: "Alta" },
                { lit: "body" },
                { ref: "$zip.note" },
              ],
            },
          ],
        },
      },
    },
  ],
};

describe("the flow editor's changes (docs/flujos.md, F2)", () => {
  it("adds a step of a kind, with a fresh id, after another; removes and moves one", () => {
    expect(newStepId(PLAN, "r")).toBe("r_2");
    expect(newStepId(PLAN, "Avisar!")).toBe("avisar");
    const notify = newStep(PLAN, { op: "call", tool: "notify" });
    expect(notify).toEqual({ id: "notify", op: "call", tool: "notify", args: {} });
    const added = addStep(PLAN, notify, "r");
    expect(added.steps.map((s) => s.id)).toEqual(["r", "notify", "n0_tasks_f", "n0_tasks"]);
    expect(addStep(PLAN, notify).steps.at(-1)?.id).toBe("notify");
    expect(removeStep(added, "notify").steps.map((s) => s.id)).toEqual([
      "r",
      "n0_tasks_f",
      "n0_tasks",
    ]);
    expect(moveAfter(added, "notify", "n0_tasks").steps.map((s) => s.id)).toEqual([
      "r",
      "n0_tasks_f",
      "n0_tasks",
      "notify",
    ]);
    expect(newStep(PLAN, { op: "read", reader: "summarize" })).toMatchObject({
      op: "read",
      input: { lit: "" },
      params: {},
    });
  });

  it("a node's menu (task 70): duplicated right after it under an id of its own; tried as far as it; what it reads", () => {
    const copy = duplicateStep(PLAN, "n0_tasks_f");
    expect(copy.id).toBe("n0_tasks_f_2");
    expect(copy.plan.steps.map((s) => s.id)).toEqual([
      "r",
      "n0_tasks_f",
      "n0_tasks_f_2",
      "n0_tasks",
    ]);
    const [orig, dup] = [copy.plan.steps[1], copy.plan.steps[2]];
    expect({ ...dup, id: orig?.id }).toEqual(orig);
    // A copy is its own: changing it leaves the original as it was.
    const changed = setAt(copy.plan, "n0_tasks_f_2", ["when"], { lit: true });
    expect(changed.steps[1]?.when).toBeUndefined();
    expect(duplicateStep(PLAN, "nadie")).toEqual({ plan: PLAN, id: null });
    expect(planUpTo(PLAN, "n0_tasks_f").steps.map((s) => s.id)).toEqual(["r", "n0_tasks_f"]);
    expect(planUpTo(PLAN, "nadie")).toBe(PLAN);
    const create = PLAN.steps.find((s) => s.id === "n0_tasks");
    if (!create) throw new Error("no create step");
    expect(refsUsed(create)).toEqual(
      expect.arrayContaining(["$r.tasks", "$item.title", "$item.due", "$zip.note"]),
    );
    expect(new Set(refsUsed(create)).size).toBe(refsUsed(create).length);
  });

  it("sets and takes out an argument; an arrow uses one step's value in another, which then runs after it", () => {
    const notify = newStep(PLAN, { op: "call", tool: "notify" });
    const plan = addStep(PLAN, notify, null);
    const set = setAt(plan, "notify", ["args", "text"], { lit: "Hola" });
    expect(set.steps.at(-1)).toMatchObject({ args: { text: { lit: "Hola" } } });
    expect(setAt(set, "notify", ["args", "text"], undefined).steps.at(-1)).toMatchObject({
      args: {},
    });
    expect(slotsOf(notify, CATALOG)).toEqual([["args", "text"]]);
    expect(slotsOf(PLAN.steps[1] as never, CATALOG)).toEqual([["input"], ["params", "fields"]]);
    // The notice placed first, then given the reading's value: it moves after the reading.
    const early = addStep(PLAN, notify, null);
    const first = { ...early, steps: [notify, ...PLAN.steps] };
    const used = takeValue(first, "r", "notify", ["args", "text"]);
    expect(used.steps.map((s) => s.id)).toEqual(["r", "notify", "n0_tasks_f", "n0_tasks"]);
    expect(depsOf(used.steps[1] as never)).toEqual(["r"]);
    expect(depsOf(PLAN.steps[2] as never).sort()).toEqual(["n0_tasks_f", "prefill", "r"]);
  });

  it("another collection: the type, the fields by their roles, the per-collection inputs of the step and of the reader it walks with", () => {
    const moved = changeCollection(PLAN, "n0_tasks", "docencia", CATALOG);
    const step = moved.steps.find((s) => s.id === "n0_tasks");
    expect(exprText(((step?.args ?? {}) as Record<string, unknown>).type)).toBe('"docencia"');
    // title stays title; the date goes to Docencia's date field; a field Docencia lacks goes; body stays.
    expect(exprText(((step?.args ?? {}) as Record<string, unknown>).values)).toBe(
      'merge($prefill.docencia, $zip.values, obj("title", $item.title, "dia", $item.due, "body", $zip.note))',
    );
    expect(moved.steps.find((s) => s.id === "n0_tasks_f")).toMatchObject({
      params: { fields: { ref: "$fill.docencia" } },
    });
    // The rest of the plan is untouched; a step that is not a call is left as it is.
    expect(moved.steps[0]).toBe(PLAN.steps[0]);
    expect(changeCollection(PLAN, "r", "docencia", CATALOG)).toBe(PLAN);
    // And back: the same plan as before but for the field that had no place.
    const back = changeCollection(moved, "n0_tasks", "gestiones", CATALOG);
    expect(
      exprText(
        ((back.steps.find((s) => s.id === "n0_tasks")?.args ?? {}) as Record<string, unknown>)
          .values,
      ),
    ).toBe(
      'merge($prefill.gestiones, $zip.values, obj("title", $item.title, "fecha", $item.due, "body", $zip.note))',
    );
  });
});
