/** (test) What the flow editor does to a plan (docs/flujos.md, F2), on an invented flow like «Leer correo». */
import { describe, expect, it } from "vitest";
import type { FlowCatalog, FlowPlan } from "./agent.ts";
import {
  addStep,
  changeCollection,
  DRAFT_PAUSE_MS,
  decidesAmong,
  depsOf,
  draftRetryMs,
  draftState,
  duplicateStep,
  exprText,
  guideRulesFor,
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
  functions: [],
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

describe("the decider's panel (task 83)", () => {
  it("says the collections its choice sends things to, from the `case` over it, in their order and once", () => {
    const chosen = {
      fn: "case",
      args: [
        { ref: "$c.choice" },
        { lit: "Tarea (p. ej.: Llamar al taller)" },
        { lit: "tarea" },
        { lit: "Evento (p. ej.: Cena de empresa)" },
        { lit: "evento" },
      ],
    };
    const plan = {
      version: 1,
      steps: [
        { id: "r", op: "read", reader: "read_message", input: { ref: "$text" } },
        { id: "c", op: "read", reader: "classify", input: { ref: "$text" }, params: {} },
        {
          id: "n_f",
          op: "read",
          reader: "fill",
          each: { ref: "$r.all" },
          input: { ref: "$text" },
          params: { collection: chosen },
        },
        {
          id: "n",
          op: "call",
          tool: "entities.create",
          each: { ref: "$r.all" },
          args: { type: chosen, values: { ref: "$item" } },
        },
        // Another decider's choice is not this one's.
        {
          id: "x",
          op: "call",
          tool: "entities.create",
          args: {
            type: { fn: "case", args: [{ ref: "$d.choice" }, { lit: "Otra" }, { lit: "persona" }] },
            values: { ref: "$item" },
          },
        },
      ],
    } as unknown as FlowPlan;
    expect(decidesAmong(plan, "c")).toEqual(["tarea", "evento"]);
    expect(decidesAmong(plan, "d")).toEqual(["persona"]);
    expect(decidesAmong(plan, "r")).toEqual([]);
  });
});

describe("the decider's panel over an older version (a lane per collection)", () => {
  it("says the collection of each step that runs only for one of its options", () => {
    const choose = (v: string) => ({ fn: "eq", args: [{ ref: "$c.choice" }, { lit: v }] });
    const plan = {
      version: 1,
      steps: [
        { id: "c", op: "read", reader: "classify", input: { ref: "$text" } },
        {
          id: "n0_tasks",
          op: "call",
          tool: "entities.create",
          when: choose("Docencia"),
          args: { type: { lit: "docencia" }, values: { ref: "$item" } },
        },
        {
          id: "n1_tasks",
          op: "call",
          tool: "entities.create",
          when: { fn: "and", args: [{ ref: "$inv.uid" }, choose("Gestiones")] },
          args: { type: { lit: "gestiones" }, values: { ref: "$item" } },
        },
        // A step for every choice is no lane's.
        { id: "fold", op: "call", tool: "inbox.fold", args: { mail: { ref: "$mail" } } },
      ],
    } as unknown as FlowPlan;
    expect(decidesAmong(plan, "c")).toEqual(["docencia", "gestiones"]);
  });
});

describe("what the decider's panel says (the review of task 83)", () => {
  const chosen = (keys: [string, string][]) => ({
    fn: "case",
    args: [{ ref: "$c.choice" }, ...keys.flatMap(([o, k]) => [{ lit: o }, { lit: k }])],
  });
  it("names the collections a step writes in or reads for, never a `case` that gives a field's key", () => {
    const plan = {
      version: 1,
      steps: [
        { id: "c", op: "read", reader: "classify", input: { ref: "$text" } },
        {
          id: "n",
          op: "call",
          tool: "entities.create",
          args: {
            type: chosen([
              ["Tarea", "tarea"],
              ["Evento", "evento"],
            ]),
            // The day goes to each collection's own date field: keys of fields, not collections.
            values: {
              fn: "obj",
              args: [
                chosen([
                  ["Tarea", "dia"],
                  ["Evento", "fecha"],
                ]),
                { ref: "$item.due" },
              ],
            },
          },
        },
      ],
    } as unknown as FlowPlan;
    expect(decidesAmong(plan, "c")).toEqual(["tarea", "evento"]);
  });

  it("lists the guide's rules that choose one of its collections and that no earlier rule takes first", () => {
    const guide = {
      instructions: "",
      examples: [],
      rules: [
        { id: "r1", from: "@lista.example.com", action: "skip" as const },
        // Taken first by the list's rule: never applies.
        {
          id: "r2",
          from: "boletin@lista.example.com",
          action: "collection" as const,
          collection: "t_tarea",
        },
        { id: "r3", from: "Ana@Example.com", action: "collection" as const, collection: "t_tarea" },
        // The same sender again: the first one wins.
        {
          id: "r4",
          from: "ana@example.com",
          action: "collection" as const,
          collection: "t_evento",
        },
        // A collection it does not choose among.
        {
          id: "r5",
          from: "jefe@example.com",
          action: "collection" as const,
          collection: "t_agenda",
        },
        {
          id: "r6",
          from: "@colegio.example",
          action: "collection" as const,
          collection: "t_evento",
        },
      ],
    };
    const keyOf = (id: string) => ({ t_tarea: "tarea", t_evento: "evento" })[id] ?? null;
    expect(guideRulesFor(guide, ["tarea", "evento"], keyOf).map((r) => r.id)).toEqual(["r3", "r6"]);
  });
});

describe("the flow's draft as the editor keeps it (task 80)", () => {
  it("waits for a pause, tries again later and later after a failure, and says its state with a word", () => {
    expect(DRAFT_PAUSE_MS).toBeGreaterThanOrEqual(500);
    expect([0, 1, 2, 3, 10].map(draftRetryMs)).toEqual([2_000, 4_000, 8_000, 16_000, 60_000]);
    expect(draftState(false, "idle")).toBeNull();
    expect(draftState(true, "idle")).toBe("draft");
    expect(draftState(true, "saving")).toBe("saving");
    expect(draftState(true, "failed")).toBe("failed");
  });
});
