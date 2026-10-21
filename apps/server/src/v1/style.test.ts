import { describe, expect, it } from "vitest";
import { normalizeSpec } from "./contract.ts";

const base = {
  title: "Gasto por mes",
  kind: "bar",
  period: { kind: "last_months", months: 12 },
};

describe("a chart's style in the v1 definition", () => {
  it("is kept closed and only when it differs from the defaults", () => {
    expect(normalizeSpec(base)).not.toHaveProperty("style");
    expect(
      normalizeSpec({ ...base, style: { height: "l", labels: false, grid: "h", script: "x" } })
        .style,
    ).toEqual({ height: "l", labels: false });
    expect(normalizeSpec({ ...base, style: { height: "enorme" } })).not.toHaveProperty("style");
  });
});
