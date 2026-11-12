import { describe, expect, it } from "vitest";
import { type PlanCatalog, validatePlan } from "./plan.ts";

const SCREEN: Record<string, { names: string[]; required: string[]; objects?: string[] }> = {
  "screen.open": {
    names: ["collection", "record", "place", "run", "flow", "map", "caption"],
    required: [],
  },
  "screen.highlight": { names: ["target"], required: ["target"] },
  "screen.scroll": { names: ["target"], required: ["target"] },
  "screen.filter": {
    names: ["collection", "where", "caption"],
    required: ["collection", "where"],
    objects: ["where"],
  },
};
const catalog: PlanCatalog = {
  args: (tool) =>
    tool === "entities.create"
      ? { names: ["type", "values"], required: ["type"] }
      : (SCREEN[tool] ?? null),
};
const plan = (values: unknown) => ({
  version: 1,
  steps: [{ id: "a", op: "call", tool: "entities.create", args: { type: { lit: "x" }, values } }],
});
const first = (args: unknown[]) => ({ fn: "first", args });
const errorsOf = (values: unknown, bound: string[] = []) => {
  const r = validatePlan(plan(values), catalog, "", bound);
  return r.ok ? [] : r.errors;
};

describe("a plan's expressions", () => {
  it("a function may take another's result, a few levels deep, over bound names (task 51)", () => {
    const nested = { fn: "obj", args: [{ lit: "k" }, first([{ ref: "$pre.k" }, { lit: "e_1" }])] };
    expect(errorsOf(nested, ["pre"])).toEqual([]);
    // Three levels are the most; deeper is refused, as is an unknown function inside another.
    expect(errorsOf(first([first([first([first([{ lit: 1 }])])])]))).toEqual([
      "step 1.args.values.args[0].args[0].args[0]: too-deep",
    ]);
    expect(errorsOf(first([{ fn: "nope", args: [] }]))).toEqual([
      "step 1.args.values.args[0]: unknown-function",
    ]);
    expect(errorsOf(first([{ ref: "$none" }]))).toEqual([
      "step 1.args.values.args[0]: ref-to-unknown-step",
    ]);
  });

  it("a «run» reply draws a run a tool gave: a reference, never a model's own id (task 92, I-29)", () => {
    const drawn = (run: unknown) => ({
      version: 1,
      steps: [
        { id: "o", op: "call", tool: "entities.create", args: { type: { lit: "x" } } },
        { id: "w", op: "reply", component: "run", data: { run } },
      ],
    });
    expect(validatePlan(drawn({ ref: "$o.run" }), catalog, "¿de dónde viene?").ok).toBe(true);
    const lit = validatePlan(drawn({ lit: "run-3" }), catalog, "¿de dónde viene?");
    expect(lit.ok).toBe(false);
    expect(lit.ok ? [] : lit.errors).toContain("step 2.data: run-not-from-a-tool");
  });

  it("an «open» reply opens one thing: a collection, a record a tool gave, or a place of the app by its name (F9)", () => {
    const opened = (data: Record<string, unknown>) => ({
      version: 1,
      steps: [
        { id: "o", op: "call", tool: "entities.create", args: { type: { lit: "x" } } },
        { id: "w", op: "reply", component: "open", data },
      ],
    });
    const errors = (data: Record<string, unknown>) => {
      const v = validatePlan(opened(data), catalog, "ábreme Agenda");
      return v.ok ? [] : v.errors;
    };
    expect(errors({ collection: { lit: "agenda" } })).toEqual([]);
    expect(errors({ record: { ref: "$o" } })).toEqual([]);
    expect(errors({ place: { lit: "inbox" } })).toEqual([]);
    expect(errors({ record: { lit: "e_123" } })).toContain("step 2.args: record-not-from-a-tool");
    expect(errors({ run: { lit: "r_1" } })).toContain("step 2.args: run-not-from-a-tool");
    expect(errors({ place: { lit: "ajustes" } })).toContain("step 2.args: unknown-place");
    expect(errors({ collection: { lit: "agenda" }, place: { lit: "inbox" } })).toContain(
      "step 2.args: open-one-thing",
    );
    expect(errors({ caption: { lit: "nada" } })).toContain("step 2.args: open-one-thing");
    // The «open» reply of before is the action `screen.open` now (task 85, part five): it validates as that call.
    const old = validatePlan(opened({ collection: { lit: "agenda" } }), catalog, "ábreme Agenda");
    expect(old.ok && old.plan.steps[1]).toMatchObject({
      op: "call",
      tool: "screen.open",
      args: { collection: { lit: "agenda" } },
    });
    // One opening per answer, never once per item: what the conversation says it opened is what it opened.
    const twice = validatePlan(
      {
        version: 1,
        steps: [
          { id: "a", op: "reply", component: "open", data: { place: { lit: "inbox" } } },
          { id: "b", op: "reply", component: "open", data: { place: { lit: "log" } } },
        ],
      },
      catalog,
      "ábreme la Bandeja y el Registro",
    );
    expect(twice.ok ? [] : twice.errors).toContain("step 2: open-once");
    const each = validatePlan(
      {
        version: 1,
        steps: [
          { id: "o", op: "call", tool: "entities.create", args: { type: { lit: "x" } } },
          {
            id: "w",
            op: "reply",
            component: "open",
            each: { ref: "$o" },
            data: { record: { ref: "$item" } },
          },
        ],
      },
      catalog,
      "ábrelas todas",
    );
    expect(each.ok ? [] : each.errors).toContain("step 2: screen-in-each");
  });

  it("the screen's actions (F9, part five): a filter once, what is lit as a tool or the screen gave it, never in each", () => {
    const steps = (...more: unknown[]) => ({
      version: 1,
      steps: [
        { id: "o", op: "call", tool: "entities.create", args: { type: { lit: "x" } } },
        ...more,
      ],
    });
    const errors = (...more: unknown[]) => {
      const v = validatePlan(steps(...more), catalog, "enséñame los de octubre");
      return v.ok ? [] : v.errors;
    };
    const filter = (id: string) => ({
      id,
      op: "call",
      tool: "screen.filter",
      args: {
        collection: { lit: "movimiento" },
        where: { lit: { fecha: { after: "2026-09-30" } } },
      },
    });
    expect(errors(filter("f"))).toEqual([]);
    expect(errors(filter("f"), filter("g"))).toContain("step 3: filter-once");
    const light = (target: unknown, each?: unknown) => ({
      id: "h",
      op: "call",
      tool: "screen.highlight",
      args: { target },
      ...(each ? { each } : {}),
    });
    expect(errors(light({ ref: "$o" }))).toEqual([]);
    expect(errors(light({ fn: "list", args: [{ ref: "$o" }, { ref: "$o" }] }))).toEqual([]);
    expect(errors(light({ lit: "row:e_1" }))).toContain("step 2.args: target-not-from-a-tool");
    expect(errors(light({ ref: "$item" }, { ref: "$o" }))).toContain("step 2: screen-in-each");
  });
});
