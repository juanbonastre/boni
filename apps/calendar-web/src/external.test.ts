/** (test) When an external calendar is downloaded again (task 60). */
import { describe, expect, it } from "vitest";
import { needsRefresh } from "./external.ts";

describe("needsRefresh", () => {
  const now = 1_000_000;
  it("a calendar never downloaded, or whose copy is old, is due; a recent one or one on its way is not", () => {
    expect(needsRefresh({}, ["a"], now)).toBe(true);
    expect(needsRefresh({ a: { state: "ok", at: now - 6 * 60_000 } }, ["a"], now)).toBe(true);
    expect(needsRefresh({ a: { state: "ok", at: now - 60_000 } }, ["a"], now)).toBe(false);
    expect(needsRefresh({ a: { state: "loading" } }, ["a"], now)).toBe(false);
    expect(needsRefresh({ a: { state: "error", at: now - 60_000 } }, ["a"], now)).toBe(false);
    expect(needsRefresh({ a: { state: "ok", at: now - 60_000 } }, ["a", "b"], now)).toBe(true);
    expect(needsRefresh({}, [], now)).toBe(false);
  });
});
