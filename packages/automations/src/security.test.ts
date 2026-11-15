// The security rules of F14a (docs/automatizaciones.md §6): labels through citations, the label of the path, and the
// policy on every read and write. Pending: one test per rule, its id in the name (`make check` reads them).
import { describe, it } from "vitest";

describe("labels and the policy", () => {
  it.todo(
    "AU-162 · a value that is one simple citation keeps the type and the exact label of the field it cites, with no sandbox; text around it makes it derived",
  );
  it.todo(
    "AU-164 · a row carries the label of its path: what comes out of a condition over something from outside, or of rows searched with it, is written as from outside",
  );
  it.todo(
    "AU-168 · every read and every write of a run asks the policy first, in a test too: a denied one never reaches the collections, and an executor has no way to them but the gate",
  );
});
