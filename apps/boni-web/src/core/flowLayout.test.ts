/** (test) The flow's layout: every node placed, arrows going right, the same every time (task 59b). */
import { describe, expect, it } from "vitest";
import { flowLayout } from "./flowLayout.ts";

describe("flowLayout", () => {
  it("places every node, a target below its source, deterministically", () => {
    const boxes = ["a", "b", "c", "d"].map((id) => ({ id, width: 200, height: 60 }));
    const edges = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "b", to: "d" },
      { from: "c", to: "a" },
    ];
    const l = flowLayout(boxes, edges);
    expect([...l.keys()].sort()).toEqual(["a", "b", "c", "d"]);
    const at = (id: string) => l.get(id) as { x: number; y: number };
    expect(at("b").y).toBeGreaterThan(at("a").y);
    expect(at("c").y).toBeGreaterThan(at("b").y);
    expect(at("d").y).toBeGreaterThan(at("b").y);
    expect(flowLayout(boxes, edges)).toEqual(l);
  });
});
