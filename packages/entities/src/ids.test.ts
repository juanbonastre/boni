import { describe, expect, it } from "vitest";
import { newId } from "./ids.ts";

describe("newId", () => {
  it("is a prefix and a ULID that sorts by time", () => {
    const a = newId("e", 1_700_000_000_000);
    const b = newId("e", 1_700_000_000_001);
    expect(a).toMatch(/^e_[0-9a-hjkmnp-tv-z]{26}$/);
    expect(a < b).toBe(true);
    expect(newId("t")).not.toBe(newId("t"));
    const fixed = (n: number) => new Uint8Array(n).fill(1);
    expect(newId("f", 0, fixed)).toBe(`f_${"0".repeat(10)}${"1".repeat(16)}`);
  });
});
