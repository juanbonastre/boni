// A-13: a decision by confidence and cost — do, ask or nothing — never alone for what is irreversible or leaves.
import { describe, expect, it } from "vitest";
import {
  backOff,
  calibrate,
  earned,
  historyConfidence,
  levelsOf,
  resolve,
} from "../src/decisions.ts";

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

  it("counts what was right at each level, and calibrates a confidence with enough judged decisions", () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => ({
        p: 0.85,
        outcome: "do" as const,
        result: i < 6 ? ("right" as const) : ("wrong" as const),
      })),
      { p: 0.95, outcome: "do" as const, result: "right" as const },
      { p: 0.95, outcome: "do" as const, result: null },
      { p: 0.3, outcome: "ask" as const, result: null },
    ];
    const levels = levelsOf(rows);
    expect(levels.map((l) => [l.from, l.judged, l.right])).toEqual([
      [0, 0, 0],
      [0.5, 0, 0],
      [0.6, 0, 0],
      [0.7, 0, 0],
      [0.8, 10, 6],
      [0.9, 1, 1],
    ]);
    // A model that says 0.85 and is right 6 times in 10 counts as 0.6; a level with few judged keeps its word.
    expect(calibrate(0.85, levels)).toBe(0.6);
    expect(calibrate(0.95, levels)).toBe(0.95);
    expect(calibrate(0.65, levels)).toBe(0.65);
    expect(calibrate(1, levels)).toBe(1);
  });
});
