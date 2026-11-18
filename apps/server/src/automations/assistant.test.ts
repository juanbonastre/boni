// What a model may do with an automation (docs/automatizaciones.md §5.12, phase F16): the assistant's proposal in a
// turn and the MCP's four tools, both inert until the person accepts, and both leaving a draft, never a published
// version (AU-140, AU-144).
//
// Pending: the phase's first PR brings one test per rule and its builders make each real, the rule's id kept in its
// name (`make check` reads them, T-10). They will run the real server with a store per test and a scripted model,
// through the routes and the MCP handler a client uses.
import { describe, it } from "vitest";

describe("an automation proposed by a model (F16)", () => {
  it.todo(
    "AU-140 · a proposal from a turn is an inert card, validated and tried dry; accepting it from a personal device leaves a draft with every «Sí» lowered, not published and not on",
  );
  it.todo(
    "AU-140 · a proposed change over a draft that changed since is no longer valid, and running an automation from a turn still asks for confirmation",
  );
  it.todo(
    "AU-144 · `automations_describe` gives the catalogue, the collections by key, the triggers and the published documents, never a draft",
  );
  it.todo(
    "AU-144 · `automations_propose` validates, lowers every «Sí», tries it dry and leaves an inert proposal; `automations_test` writes nothing and returns facts; `automations_runs` returns codes and counts, no texts",
  );
  it.todo(
    "AU-144 · the four `flows_*` tools answer one more version through their twins, and `flows_propose` takes the old trigger and plan through the translator",
  );
});
