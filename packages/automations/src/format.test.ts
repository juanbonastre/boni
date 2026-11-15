// The format's rules (docs/automatizaciones.md §5.1, §5.3). Pending: the first PR of F14a brings one test per rule,
// and the builder turns each into a real one, keeping the rule's id in its name (`make check` reads them).
import { describe, expect, it } from "vitest";
import { isExpr, OUT, SETTINGS_DEFAULTS } from "./format.ts";

describe("the format of an automation", () => {
  it.todo(
    "AU-01 · an automation is steps and arrows as data: what parseAutomation gives survives JSON and reads back equal, with its version",
  );
  it.todo(
    "AU-02 · arrows use the step's fixed id and expressions its name: renameStep rewrites every citation of it and nothing else changes",
  );
  it.todo(
    "AU-03 · a step has its inputs and one or more named outputs, «error» when asked; several arrows may reach an input and leave an output, and an arrow to a name the step lacks does not validate",
  );
  it.todo(
    "AU-08 · a step carries no version of its type: a saved automation of an older format is migrated when read, and an unknown type does not validate",
  );
  it.todo(
    "AU-26 · a parameter that gives the step its shape (the collection, the action, the mode) holding an expression does not validate",
  );
  it.todo(
    "AU-126 · a step is a closed shape: a saved step with «when», «each» or «with», or any other key, is refused",
  );

  it("an expression is an object whose only key is expr", () => {
    expect(isExpr({ expr: "{{ $json.total }}" })).toBe(true);
    expect(isExpr({ expr: "x", other: 1 })).toBe(false);
    expect(isExpr({ expr: 3 })).toBe(false);
    expect(isExpr("{{ $json.total }}")).toBe(false);
    expect(isExpr(null)).toBe(false);
  });

  it("a step with no settings stops on a failure, tries once and does not go on without rows", () => {
    expect(SETTINGS_DEFAULTS).toMatchObject({ onError: "stop", continueEmpty: false, off: false });
    expect(SETTINGS_DEFAULTS.retry.times).toBe(0);
    expect(OUT.error).toBe("error");
  });
});
