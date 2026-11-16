// The lists F14c brings (code.ts): its limits, its failures and its problems. These run already: they hold what the
// builders and the screen count on while the lists are apart from the catalogue's and validation's own.
import { describe, expect, it } from "vitest";
import { CONTROLS } from "./catalogue.ts";
import {
  CODE_CONTROLS,
  CODE_FAILURES,
  CODE_LIMITS,
  CODE_PROBLEMS,
  CodeFault,
  HARD_LIMITS,
} from "./code.ts";
import { STEP_FAILURES, StepFault } from "./failures.ts";
import { PROBLEMS } from "./validate.ts";

describe("F14c's lists", () => {
  it("every limit of JavaScript is a whole number over zero, and all but the console's two stop the step", () => {
    for (const [key, value] of Object.entries(CODE_LIMITS)) {
      expect(Number.isInteger(value), key).toBe(true);
      expect(value, key).toBeGreaterThan(0);
    }
    expect(HARD_LIMITS).not.toContain("consoleLines");
    expect(HARD_LIMITS).not.toContain("consoleLineChars");
    expect(HARD_LIMITS.length).toBe(Object.keys(CODE_LIMITS).length - 2);
  });

  it("what a step may read and be sent fits what it may hold: a read fits the step's reads, and they fit a job", () => {
    expect(CODE_LIMITS.readBytes).toBeLessThanOrEqual(CODE_LIMITS.stepReadBytes);
    expect(CODE_LIMITS.stepReadBytes).toBeLessThan(CODE_LIMITS.inputBytes);
    expect(CODE_LIMITS.reads).toBeLessThanOrEqual(CODE_LIMITS.stepReads);
    expect(CODE_LIMITS.inputBytes).toBeLessThan(CODE_LIMITS.memoryBytes);
  });

  it("no code of F14c is one the engine already has, so the lists can be joined", () => {
    const failures = new Set<string>([...STEP_FAILURES, ...CODE_FAILURES]);
    expect(failures.size).toBe(STEP_FAILURES.length + CODE_FAILURES.length);
    const problems = new Set<string>([...PROBLEMS, ...CODE_PROBLEMS]);
    expect(problems.size).toBe(PROBLEMS.length + CODE_PROBLEMS.length);
    const controls = new Set<string>([...CONTROLS, ...CODE_CONTROLS]);
    expect(controls.size).toBe(CONTROLS.length + CODE_CONTROLS.length);
  });

  it("a failure of JavaScript is a `StepFault` that says which, and the parameter at fault", () => {
    const fault = new CodeFault("the code threw", {
      code: "code.threw",
      param: "source",
      detail: { message: "x is not defined", line: 3, column: 1 },
    });
    expect(fault).toBeInstanceOf(StepFault);
    expect(fault.failure).toEqual({ code: "other", param: "source" });
    expect(fault.why.code).toBe("code.threw");
    expect(fault.why.detail?.line).toBe(3);
  });
});
