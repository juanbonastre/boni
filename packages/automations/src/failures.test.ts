// Why a step failed, as a key (docs/automatizaciones.md AU-67, AU-84). Pending: F14b's first engine PR gives every
// failure of the engine its code and turns these into real tests, the rule's id kept in its name.
import { describe, it } from "vitest";

describe("a step's failure", () => {
  it.todo(
    "AU-84 · every failure of a step of the catalogue carries a code of STEP_FAILURES, and the parameter at fault when it is one parameter's: a citation that gives no value names the parameter it is written in",
  );
  it.todo(
    "AU-67 · a refusal of the policy fails the step with its rule, a row that changed since it was read says so, and «Parar con error» carries what Juan wrote; none of them is said only in English",
  );
});
