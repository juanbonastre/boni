import { describe, expect, it } from "vitest";
import { type PlanCatalog, validatePlan } from "./plan.ts";

const catalog: PlanCatalog = {
  args: (tool) =>
    tool === "entities.create" ? { names: ["type", "values"], required: ["type"] } : null,
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
});
