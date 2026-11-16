// What a run saves alone and what it proposes, over the real store and the real policy (docs/automatizaciones.md §6:
// AU-167, AU-186, AU-193, AU-170, AU-195, and what was left of AU-185; phase F14d): the rule of the background row by
// row with a scheduled run, the one proposal of a run in the inbox of always, and accepting it with each value's
// label. Pending: the phase's first PR brings one test per rule and its builders make each real, the rule's id kept
// in its name (`make check` reads them, T-10). When they run: a store per test with data shaped like the user's
// (seed.test-util.ts), a scheduled run started by the test's clock, and no model call.
import { describe, it } from "vitest";

describe("what a scheduled run writes alone (F14d)", () => {
  it.todo(
    "AU-167 · a scheduled run of a published version that creates and modifies with values all its own saves them, each operation with the run, and proposes nothing",
  );
  it.todo(
    "AU-167 AU-185 · a scheduled run whose value was computed from something from outside saves nothing and leaves one proposal (P4); the same with a path that depends on something from outside (P15)",
  );
  it.todo("AU-167 · a scheduled run that would write a value a model wrote proposes it");
  it.todo(
    "AU-167 · no step of an automation can name a collection of the system, so nothing an automation writes reaches what the app knows of the person, whatever its values carry",
  );
  it.todo(
    "AU-186 · a removal with «Sí», of a «Código» and of a «Colección» of a published version, goes to the trash with no proposal in a scheduled run and comes back when the run is undone",
  );
  it.todo(
    "AU-186 · the same removal with something from outside in its values or its path is proposed, and with «Preguntar» it waits in the run's proposal",
  );
});

describe("who starts the run (F14d)", () => {
  it.todo(
    "AU-195 · the same step with the same value from outside: «Probar» writes nothing, «Ejecutar» by hand saves it with its outside label, a scheduled run proposes it, and accepting that proposal saves it",
  );
  it.todo(
    "AU-195 · the test of an automation that starts alone asks the policy as the origin that will start it: «Haría esto» says it would propose what a by-hand test of a «Disparado por el usuario» says it would save",
  );
});

describe("the proposal of a run (F14d)", () => {
  it.todo(
    "AU-193 · a run with two steps that wait leaves one proposal in the inbox, with each step's whole change, and goes on: a step that waits gives no rows to those after it",
  );
  it.todo(
    "AU-193 · the proposal is painted by code: the automation and its version, how many rows it creates, modifies and sends to the trash in each collection, and each row with its before, its after and the mark of what came from outside",
  );
  it.todo(
    "AU-193 · accepting it passes through the policy again as accepted, from a personal device only, and saves every change in one transaction with the run in the log; with one change that cannot be saved, none is",
  );
  it.todo(
    "AU-193 · accepting is the confirmation of the removals the proposal names: they go to the trash with the run and are not asked again",
  );
  it.todo(
    "AU-193 · with a row changed since it was proposed, accepting saves nothing and the proposal is left as no longer valid; rejecting saves nothing and the run says it was rejected",
  );
  it.todo(
    "AU-170 · a value from outside that was proposed, accepted and read again by another run is still from outside, and what that run writes with it is proposed",
  );
});
