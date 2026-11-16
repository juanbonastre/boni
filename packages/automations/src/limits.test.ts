// The limits of one run (docs/automatizaciones.md §5.2, AU-17; phase F14d): four named numbers, each with its default
// and its ceiling, checked by the engine before a step starts and before a step's change is asked or written. Pending:
// the phase's first PR brings one test per rule and its builders make each real, the rule's id kept in its name
// (`make check` reads them, T-10).
import { describe, it } from "vitest";

describe("the limits of a run (F14d)", () => {
  it.todo(
    "AU-17 · each limit of a run (time, rows written, model calls, steps) is a named number with a default and a ceiling, and a document that asks for more than a ceiling does not validate (`limit.over`): it is never cut down silently",
  );
  it.todo(
    "AU-17 · a step whose change would pass «rows written» fails the run before the policy is asked and before any row is written, counting the rows that would be proposed as well as those that would be saved",
  );
  it.todo(
    "AU-17 · the time and the steps are checked before each step starts, against the run's own clock: a run past its time starts no further step",
  );
  it.todo(
    "AU-17 · a limit stops the whole run whatever the step's «Si falla» says («Seguir», «Salir por error»), and what earlier steps wrote stays, to be undone from the run",
  );
  it.todo(
    "AU-17 · stopping by a limit says which one, its number and the number reached (`run.limit`), in a test as in a real run, and the words name the setting to change",
  );
  it.todo(
    "AU-17 · all four limits hold whether or not the automation's settings show them: one with no step that writes still has its «rows written»",
  );
});
