// A-13: a decision by confidence and cost — do, ask or nothing — never alone for what is irreversible or leaves.
import { describe, expect, it } from "vitest";
import { backOff, earned, historyConfidence, resolve } from "../src/decisions.ts";

describe("decisions by confidence and cost (docs/fiabilidad.md, A-13)", () => {
  it("does alone only below class C, with «Solo» on and enough confidence; asks in the middle; nothing below", () => {
    expect(resolve(0.95, "A", true)).toBe("do");
    expect(resolve(0.95, "A", false)).toBe("ask");
    expect(resolve(0.7, "A", true)).toBe("ask");
    expect(resolve(0.5, "A", true)).toBe("nothing");
    expect(resolve(0.93, "B", true)).toBe("ask");
    expect(resolve(0.96, "B", true)).toBe("do");
    // Irreversible, or outward: never alone, whatever the confidence or the switch.
    expect(resolve(1, "C", true)).toBe("ask");
    expect(resolve(0.3, "C", true)).toBe("nothing");
    // An area's own thresholds, once earned.
    expect(resolve(0.8, "A", true, { ask: 0.5, do: 0.75 })).toBe("do");
  });

  it("confidence from Juan's history is cautious: few cases never say sure", () => {
    expect(historyConfidence(0, 0)).toBe(0);
    expect(historyConfidence(3, 3)).toBeCloseTo(0.44, 2);
    expect(historyConfidence(5, 5)).toBeCloseTo(0.57, 2);
    expect(historyConfidence(19, 20)).toBeCloseTo(0.76, 2);
    expect(historyConfidence(95, 100)).toBeCloseTo(0.89, 2);
    expect(historyConfidence(1, 4)).toBeLessThan(historyConfidence(2, 4));
  });

  it("autonomy is earned with 20 decisions at 95 %, and lost after three wrong in a row or a fifth of the last", () => {
    expect(earned(19, 19)).toBe(false);
    expect(earned(20, 19)).toBe(true);
    expect(earned(20, 18)).toBe(false);
    const right = (n: number) => Array.from({ length: n }, () => true);
    expect(backOff([...right(10), false, false, false])).toBe(true);
    expect(backOff([...right(10), false, false, true])).toBe(false);
    expect(backOff([...right(16), false, true, false, true, false, true])).toBe(false);
    expect(backOff([...right(12), false, true, false, true, false, true, false, true])).toBe(true);
    expect(backOff([false, false])).toBe(false);
  });
});
