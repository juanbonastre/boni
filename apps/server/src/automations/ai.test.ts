// The AI steps of an automation on the real server (docs/automatizaciones.md §5.5, §5.6, §5.10 and §6, phase F15):
// which model a step may use, what its writes save on the real store, its connection read from the stored version,
// a run that waits for an answer, and what is private (AU-42, AU-166, AU-199, AU-203, AU-204, AU-205).
//
// Pending: the phase's first PR brings one test per rule and its builders make each real, the rule's id kept in its
// name (`make check` reads them, T-10). They will run the real server with a store per test, data shaped like the
// user's (`seed.test-util.ts`: generated ids, 3,000 rows) and a scripted provider: no model is ever called.
import { describe, it } from "vitest";

describe("an automation's AI steps on the server (F15)", () => {
  it.todo(
    "AU-42 · what an AI step asks to write with «Preguntar» joins the run's one proposal, each change saying which step asks and that an AI decided it",
  );
  it.todo(
    "AU-166 · a collection no model may read cannot be connected to an «Agente», is a problem at publish, and its read is denied in a run",
  );
  it.todo(
    "AU-199 · `modelChoices` gives the account's model for the step's role and every model evaluated lately for it with its key; a step stores a choice's id or nothing",
  );
  it.todo(
    "AU-199 · a step whose model is no longer a choice does not publish; a published one whose key is gone fails saying so; the month's budget stops the AI steps of any run",
  );
  it.todo(
    "AU-203 · a waiting run lets the automation's next run start, survives a restart, and is answered only from a personal device",
  );
  it.todo(
    "AU-203 · the 21st waiting run of an automation fails at its question; turning the automation off cancels its waits and their cards no longer hold",
  );
  it.todo(
    "AU-204 · the rows of the table on the real store: what is saved keeps its label and is undone with the run, and what is proposed waits in the run's proposal",
  );
  it.todo(
    "AU-205 · the connection `decide` checks is the stored version's: a request for a collection the step has not connected is denied whatever the model, the box or a browser sends",
  );
  it.todo(
    "AU-205 · the policy denies a read made by the code of «Las hace este código» on the real server, the unit follows the step's «Si falla», and nothing says what it could not read (task 144)",
  );
});
