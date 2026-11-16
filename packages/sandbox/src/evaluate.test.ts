// Protocol 2 of the box (evaluate.ts; docs/automatizaciones.md §7, AU-160). Pending: the first PR of F14c brings one
// test per rule, and the builder turns each into a real one, keeping the rule's id in its name (`make check` reads
// them). The one that runs holds what lets both protocols share a socket.
import { describe, expect, it } from "vitest";
import { EVALUATE, isEvalRequest } from "./evaluate.ts";
import { requestErrors } from "./protocol.ts";

describe("protocol 2: an evaluation's request", () => {
  it("a line with `v` is an evaluation and one without is a function call: neither is taken for the other", () => {
    expect(isEvalRequest({ id: "a", v: EVALUATE })).toBe(true);
    expect(isEvalRequest({ id: "a", code: "", fn: "f" })).toBe(false);
    expect(isEvalRequest(null)).toBe(false);
    expect(requestErrors({ id: "a", v: EVALUATE }).length).toBeGreaterThan(0);
  });

  it.todo(
    "AU-160 · `evalRequestErrors` says what is wrong with a request, by its member: a kind or a mode that is not one, sources that are not texts, rows that are not objects, a pairing out of range, a zone table that is not ordered, a key of a read over `MAX_READ_KEY`; a request that is one gives none",
  );
  it.todo(
    "AU-160 · a request names nothing of the server but what it holds: no path, no address and no function to call back; expressions are always per row, and a request that says otherwise is refused",
  );
  it.todo(
    "AU-35 · `evalLimitsOf` gives a request's limits where it says them and the defaults where it does not, never over the most the box allows (`MAX_LIMITS`), and a limit of zero or less is not one",
  );
});
