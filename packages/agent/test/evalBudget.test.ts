import { describe, expect, it } from "vitest";
import { capped, maxCostFlag, newSpend } from "../eval/lib/budget.ts";
import type { ModelProvider, ModelRequest } from "../src/providers.ts";

/** The hard cap of a hand-run evaluation (AGENTS.md: real models by hand, with a budget). */
const req: ModelRequest = { role: "planner", system: "", input: {}, schema: {}, maxTokens: 10 };
const costing = (cost?: number): ModelProvider & { calls: number } => {
  const p = {
    id: "costing",
    privacy: "local" as const,
    calls: 0,
    async complete() {
      p.calls++;
      return {
        json: {},
        usage: { input: 1000, output: 100, ...(cost === undefined ? {} : { cost }) },
        model: "m",
      };
    },
  };
  return p;
};

describe("an evaluation's budget", () => {
  it("makes no call once the spend has reached the cap, and counts every call it made", async () => {
    const real = costing(0.4);
    const spend = newSpend();
    const p = capped(real, 1, spend);
    for (let i = 0; i < 3; i++) await p.complete(req);
    // 1.2 spent: past the cap by one call at most, and no fourth call reaches the model.
    await expect(p.complete(req)).rejects.toMatchObject({ code: "over-budget" });
    expect(real.calls).toBe(3);
    expect(spend).toEqual({ cost: expect.closeTo(1.2), tokens: 3300, calls: 3 });
  });

  it("counts a call with no price at the dearest one, never as free, and the cap is shared", async () => {
    const spend = newSpend();
    const planner = capped(costing(), 0.1, spend);
    const reader = capped(costing(0), 0.1, spend);
    await planner.complete(req);
    // 1000 in and 100 out at $10 and $50 per million.
    expect(spend.cost).toBeCloseTo(0.015);
    for (let i = 0; i < 6; i++) await planner.complete(req);
    await expect(reader.complete(req)).rejects.toMatchObject({ code: "over-budget" });
  });

  it("takes --max-cost in dollars, a default without it, and nothing that is not a positive number", () => {
    expect(maxCostFlag(["--max-cost=2.5"], 1)).toBe(2.5);
    expect(maxCostFlag(["--only=x"], 1)).toBe(1);
    for (const bad of ["--max-cost=0", "--max-cost=-1", "--max-cost=dos", "--max-cost="])
      expect(() => maxCostFlag([bad], 1), bad).toThrow();
  });
});
