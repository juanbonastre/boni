// The security floor across F16 (docs/automatizaciones.md §6, phase F16): moving the saved flows, Boni's own and the
// conversation's turn to the new engine changes who interprets, never who decides (AU-230, with AU-143's turn).
//
// Pending: the phase's first PR brings one test per rule and its builders make each real, the rule's id kept in its
// name (`make check` reads them, T-10). One test per row of AU-230's table, as `automation-origin.test.ts` does for
// P28: the same plans run in both engines and every call to `decide`, with its answer, is compared.
import { describe, it } from "vitest";

describe("the policy for what came from before (F16)", () => {
  it.todo(
    "AU-230 · a converted flow that writes is born with «Preguntar» in every write cell, in each of its versions, and its run proposes",
  );
  it.todo(
    "AU-230 · a piece of Boni, «Acción de Boni» and «Lector de Boni» are decided as the old background was: reads run, changes are proposed, egress is denied, and none has a «Sí»",
  );
  it.todo(
    "AU-230 · the same turn plans in both engines get the same answer from `decide` for every act, and the turn's origin is never `automation`",
  );
  it.todo(
    "AU-143 · a turn on the new engine keeps the turn's limits and its record in the turn's own tables, not in an automation's runs",
  );
});
