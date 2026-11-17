// The translator from the plan language to an automation (docs/automatizaciones.md §5.12 and §5.13, phase F16):
// one function with three uses (the conversion of the saved flows, a turn's plan, «Guardar como automatización»),
// its table with a row for everything the language can say, and the proof that what it makes does the same
// (AU-143, AU-223, AU-224).
//
// Pending: the phase's first PR brings one test per rule and its builders make each real, the rule's id kept in its
// name (`make check` reads them, T-10). They will walk the language itself (the four operations, `READERS`, the ask
// controls, `REPLY_COMPONENTS`, `FNS`), so a new piece of it cannot arrive without its row, and compare the old
// engine's dry run with the new one's «Probar» over invented flows shaped like a user's, with a scripted model.
import { describe, it } from "vitest";

describe("a plan translated to an automation (F16)", () => {
  it.todo(
    "AU-223 · every operation, reader, ask control, reply component, function, trigger and action of the plan language has its row: a step, or a name for what has none",
  );
  it.todo(
    "AU-223 · a step that ran once still runs once whatever rows reach it, a `when` hangs from a «Si», an `each` is the work per row and a `zip` a «Combinar» by position",
  );
  it.todo(
    "AU-224 · with the same inputs and the same scripted model answers, the converted automation makes the same reader calls, the same reads and asks the policy for the same writes, in the same order and with the same labels",
  );
  it.todo(
    "AU-224 · where the new step is tighter or behaves differently, the conversion says it as «Lo que cambia», from a closed list of sentences",
  );
  it.todo(
    "AU-143 · a turn's plan is validated as today, translated by the same function and saved as a draft by «Guardar como automatización», every «Sí» lowered",
  );
});
