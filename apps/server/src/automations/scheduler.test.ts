// «Programada» and what a run that started alone tells the user (docs/automatizaciones.md §5.9, §5.8, §6: AU-114,
// AU-102, and the notice of AU-167; phase F14d): the hours of a published automation, run once each by the scheduler
// the flows of before already have, and one notice per run that wrote and per streak of failures. Pending: the
// phase's first PR brings one test per rule and its builders make each real, the rule's id kept in its name
// (`make check` reads them, T-10). When they run: the clock is the test's, never the machine's, and a bound of time
// is read from `@boni/pace` (T-11).
import { describe, it } from "vitest";

describe("«Programada» (F14d)", () => {
  it.todo(
    "AU-114 · a «Programada» has one rule or more («every hour», «every day at», «every week on a day at») and none does not validate; its hours are those of the account's zone",
  );
  it.todo(
    "AU-114 · it runs at its hour and once: two ticks, or a restart, never start the same hour twice, and two rules due at the same minute start one run",
  );
  it.todo("AU-114 · the trigger gives one row with the hour that was due, not the hour it ran at");
  it.todo(
    "AU-195 · `$run.startedBy` is `schedule` in a run that started at its hour, in the test of a «Programada» and in a «Reintentar» of one that started at its hour, and `user` in «Ejecutar», in the test of one started by hand and in a retry of one: a closed list, never a name or an id",
  );
  it.todo(
    "AU-195 · a «Si» over `$run.startedBy` sends a run started by hand down one branch and one that started alone down the other, and each branch's write gets the decision of its own cell",
  );
  it.todo(
    "AU-114 · a server off for three hours with «every hour» runs once on coming back, for the last hour only, and only within the margin (30 minutes hourly, 3 hours the others)",
  );
  it.todo(
    "AU-114 · an hour missed past its margin does not run: it is kept as a line of «Ejecuciones» saying the server was off at its hour",
  );
  it.todo(
    "AU-114 · no hour runs that is earlier than the publishing of the version that runs or than the switch being turned on",
  );
  it.todo("AU-114 · across the change of hour, an hour the clock skips or repeats runs once");
  it.todo(
    "AU-114 · while the previous run still runs at the next hour, the scheduler waits for the next tick and starts no second run",
  );
  it.todo(
    "AU-114 · a tick over 200 scheduled automations reads their hours from a column, no document, and stays within the time written here",
  );
});

describe("a failure that started alone (F14d)", () => {
  it.todo(
    "AU-102 · a run that started alone and failed notifies once, with the automation's name, the step's and the reason in the app's words, and the notice opens that run; one started by hand notifies nothing",
  );
  it.todo(
    "AU-102 · three failures in a row give one notice; after a run that ends well, or a new published version, the next failure notifies again",
  );
  it.todo(
    "AU-102 · the notice is written by code from closed lists: a code that throws a text with HTML or a link, or a row's value, leaves nothing of it in the notice",
  );
  it.todo(
    "AU-102 · an interrupted run and an hour that did not run count as failures of the streak: the one that opens it notifies, and the next ones do not",
  );
});

describe("the notice of what it wrote alone (F14d)", () => {
  it.todo(
    "AU-167 · a run that started alone and wrote gives one notice for the whole run, with counts and collection names and no value of any row, and its «Deshacer» undoes the run; a run that wrote nothing gives none",
  );
});
