// What Boni learns from the person's answers to an automation, outside the automation
// (docs/automatizaciones.md §5.15, decision 10 of §10, phase F15): the signals, the suggestion, the pause and their
// limits (AU-207, AU-209, AU-210, AU-212).
//
// Pending: the phase's first PR brings one test per rule and its builders make each real, the rule's id kept in its
// name (`make check` reads them, T-10). They will run the real server with a store per test and a year of runs
// (A-15: the daily pass over the operation log is timed with it, its clock from `@boni/pace`), and no model.
import { describe, it } from "vitest";

describe("what Boni learns from the answers to an automation (F15)", () => {
  it.todo(
    "AU-207 · one decision per cell and run: accepted, rejected, undone, or corrected by hand within 7 days; only acts from a personal device count",
  );
  it.todo(
    "AU-207 · a step whose instructions, code or connections changed starts another count, and the daily pass over a year of runs stays within its time",
  );
  it.todo(
    "AU-209 · at 20 decisions with 95 % accepted there is one suggestion; the published version and the draft stay as they were, and a «No» is not repeated",
  );
  it.todo("AU-209 · there is never a suggestion for the action that trashes rows");
  it.todo(
    "AU-210 · three failures in a row, or 4 of the last 20, pause the cell: runs propose, the published version is unchanged, and only his hand on a personal device lifts it",
  );
  it.todo(
    "AU-210 · a pause can only lower a «Sí»: nothing it stores makes a run save what the cell would ask",
  );
  it.todo(
    "AU-212 · with «Aprender» off there is no suggestion and no new pause; at most one suggestion a day; no count reaches a model",
  );
});
