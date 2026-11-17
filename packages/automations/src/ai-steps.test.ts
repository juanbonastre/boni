// The four reader steps in the engine (docs/automatizaciones.md §5.6 and §6, phase F15): «Extraer datos»,
// «Clasificar», «Resumir» and «Escribir texto», and what never reaches a model (AU-57, AU-166).
//
// Pending: the phase's first PR brings one test per rule and its builders make each real, the rule's id kept in its
// name (`make check` reads them, T-10). They will run the engine with a scripted reader behind the port it receives
// (no model call), with rows shaped like the user's (`seed.test-util.ts`) and enough of them to cross a batch.
import { describe, it } from "vitest";

describe("the reader steps (F15)", () => {
  it.todo(
    "AU-57 · each of the four shows its parameters and no more, takes no connection, and uses the reader role",
  );
  it.todo(
    "AU-57 · a reader's output carries its input's label: what comes out of a text from outside is from outside",
  );
  it.todo(
    "AU-57 · a reader receives its text and its options only, never the user's own data next to a text from outside",
  );
  it.todo(
    "AU-57 · 120 rows go to a list reader in batches of 50, and a text over 4,000 characters is cut and the output says so",
  );
  it.todo(
    "AU-57 · «Clasificar» returns one of its options or nothing; an output outside the shape is retried once and then fails the step",
  );
  it.todo(
    "AU-166 · a value that no model may receive, arriving at a reader's text, fails that row (`ai.private`) by the step's «Si falla», naming the field and never the value",
  );
});
