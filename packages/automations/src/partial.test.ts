// A test of a draft and what it keeps (docs/automatizaciones.md §5.8; partial.ts). Pending: the first PR of F14b
// brings one test per rule, and the builder turns each into a real one, keeping the rule's id in its name (`make
// check` reads them). Real tests use the fakes of run.test-util.ts and a digest that is the text itself or a short
// hash of it: never a store.
import { describe, it } from "vitest";

describe("«Probar paso» and what a test keeps", () => {
  it.todo(
    "AU-91 · «Probar paso» runs that step and only what it lacks of the steps before it: a step before it whose kept test ended well and has the print it has now is not run again, and its rows are taken as they were",
  );
  it.todo(
    "AU-91 · «Probar paso» always runs the step itself again, decides nothing after it or on another branch, and a step before it that was never tested, is stale or did not end well runs",
  );
  it.todo(
    "AU-91 · a citation with .item finds its own row across a step that was reused: the kept rows keep their lineage",
  );
  it.todo(
    "AU-91 · a step's print changes with its type, its action, a parameter or a setting other than the note, with a change in a step it hangs from or cites, and with the fields its trigger was tested with",
  );
  it.todo(
    "AU-91 · a step's print does not change when a step is moved or renamed (its citations rewritten), a note changes, or the steps and arrows are saved in another order",
  );
  it.todo(
    "AU-92 · a step changed after its test is stale, and so is every step that hangs from it or cites it; a step never tested is not stale: it has nothing kept",
  );
  it.todo(
    "AU-90 · a whole test reuses nothing: every step the trigger reaches runs, and a step that would write gives the row it would make so that what follows goes on",
  );
  it.todo(
    "AU-115 · every trigger of the catalogue can start a test by hand with the fields it declares: no type of trigger is refused by runTest",
  );
});
