import { describe, expect, it } from "vitest";
import { callFn } from "./fns.ts";
import { codeLabel, leaf, plain } from "./values.ts";

describe("the plan's functions", () => {
  it("first: the first value that is not empty, keeping its own label; none: null (task 51)", () => {
    const reader = leaf("e_reader", codeLabel("reader"));
    const code = leaf("e_code", codeLabel("prefill"));
    expect(plain(callFn("first", [leaf(null, codeLabel("x")), code], "2026-11-04"))).toBe("e_code");
    expect(plain(callFn("first", [reader, code], "2026-11-04"))).toBe("e_reader");
    expect(
      plain(callFn("first", [leaf("", codeLabel("x")), leaf(false, codeLabel("y"))], "2026-11-04")),
    ).toBeNull();
  });
});
