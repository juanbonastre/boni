import { describe, expect, it } from "vitest";
import { chartStyle, fullStyle } from "./chartStyle.ts";

describe("a chart's style", () => {
  it("keeps only known settings with allowed values, and leaves the defaults out", () => {
    expect(chartStyle({ height: "l", labels: false, grid: "h", colors: "colorful" })).toEqual({
      height: "l",
      labels: false,
      colors: "colorful",
    });
    expect(chartStyle({ height: "huge", onclick: "x", grid: "none" })).toEqual({ grid: "none" });
    expect(chartStyle({ height: "m" })).toBeNull();
    expect(chartStyle("l")).toBeNull();
    expect(fullStyle({ axes: "both" })).toMatchObject({ axes: "both", height: "m", labels: true });
  });
});
