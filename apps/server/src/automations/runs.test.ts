// A real run over the real store (docs/automatizaciones.md §5.2, §5.8: AU-97, AU-99, AU-18, AU-100, AU-93, AU-103,
// AU-190, AU-192, and AU-17 at the user's volume; phase F14d): «Ejecutar», the record kept step by step, undoing a
// run whole, retrying it, what is pinned, what is kept of old runs and a run a restart left half done. Pending: the
// phase's first PR brings one test per rule and its builders make each real, the rule's id kept in its name
// (`make check` reads them, T-10). When they run: a store per test with data shaped like the user's
// (seed.test-util.ts) and its volume, every bound read from `@boni/pace` (T-11), and those that load the machine on
// purpose hold the shared queue of tests.
import { describe, it } from "vitest";

describe("«Ejecutar» (F14d)", () => {
  it.todo(
    "AU-97 · «Ejecutar» runs the published version and answers at once with the run, which goes on in the server; the fields the trigger asks for arrive as its row",
  );
  it.todo(
    "AU-97 · an automation runs one run at a time: a second «Ejecutar» while one runs is refused saying so, and the runs of one account go one after another in the order they arrived",
  );
  it.todo(
    "AU-97 · a «Código» of a real run runs in the box as in a test, and with no box the step fails saying so and nothing is written",
  );
});

describe("the record of a run (F14d)", () => {
  it.todo(
    "AU-99 · what is kept of a run is what the engine gave: per step its state, the rows in and out by each output, how long it took and what came out, written as each step ends, so a run in progress is read up to its last finished step",
  );
  it.todo(
    "AU-99 · the list of runs is asked fifty at a time by the index and reads no step and no row; «Fallos» and «Pruebas» filter it; a whole «Probar» is kept as a run marked as a test and «Probar paso» is not",
  );
  it.todo(
    "AU-99 · the line of what a run did comes from its record («created 1 row in …», «proposed …», «failed at …», «did nothing»), and a run shows the canvas of the version it ran, not the draft",
  );
  it.todo(
    "AU-99 · with a year of hourly runs of one automation, the list, one run and the counts of the list of automations answer within the time written here",
  );
});

describe("undoing a run (F14d)", () => {
  it.todo(
    "AU-18 · a run of three steps that write (one creates, one modifies, one sends to the trash) is undone whole from the run: the store is as it was before, in one transaction, and the run says it was undone and when",
  );
  it.todo(
    "AU-18 · with one row changed after the run, undoing it undoes nothing, overwrites nothing and says which row",
  );
  it.todo(
    "AU-18 · what the user accepted of a run's proposal was written with the same run and is undone with it; a run of which only the summary is left is undone the same",
  );
});

describe("retrying and opening in the editor (F14d)", () => {
  it.todo(
    "AU-100 · «Reintentar» starts a new run by hand with the trigger's data of that run and the version published now, and says so when it is not the version of then",
  );
  it.todo(
    "AU-100 · retrying a run that wrote before it failed offers to undo it first: with «Deshacer y reintentar» nothing is left written twice",
  );
  it.todo(
    "AU-100 · «Abrir en el editor con estos datos» pins the output the trigger gave in that run on the draft, and the next «Probar» starts from it",
  );
});

describe("«Fijar» (F14d)", () => {
  it.todo(
    "AU-93 · a step with a pinned output is not run by «Probar» or «Probar paso» (no box, no read, no model): its pinned rows are its output, with the label each row had",
  );
  it.todo(
    "AU-93 · a pin is never part of a version: a real run of an automation whose step is pinned runs that step, and releasing the pin makes the test run it again",
  );
});

describe("what is kept of old runs (F14d)", () => {
  it.todo(
    "AU-103 · a run is kept whole while it is among the last 100 of its automation and younger than 30 days; of the others its summary stays and its steps and rows go; of the tests the last 20 stay and older ones go entirely",
  );
  it.todo(
    "AU-103 · a year of hourly runs of one automation leaves 100 whole, and pruning them, at the end of a run and at start-up, stays within the time written here",
  );
});

describe("a run a restart left half done (F14d)", () => {
  it.todo(
    "AU-190 · a server that starts with a run still marked as running closes it as interrupted, naming the step it was in, and does not run it again; what its finished steps wrote stays and is undone from it",
  );
  it.todo(
    "AU-190 · the hour of an interrupted scheduled run counts as run: the scheduler does not start it again on the next tick",
  );
});

describe("a renamed collection (F14d)", () => {
  it.todo(
    "AU-192 · after a collection is renamed, the published version whose code cites it by its old name still reads and saves in that same collection",
  );
  it.todo(
    "AU-192 · the name a version kept never widens what it reaches: without that collection among the step's connections the step fails, and with the collection archived it fails saying which",
  );
});

describe("the limits of a run at the user's volume (F14d)", () => {
  it.todo(
    "AU-17 · «Las que cumplan…» matching 3,000 rows in a store of 12,000 records stops at the default limit of rows written with no operation in the log; with the limit raised it saves them in one transaction within the time written here, and undoing the run brings them back",
  );
});

describe("what a failure tells (F14d)", () => {
  it.todo(
    "AU-182 · the line of a run that saved something from outside without asking ends in «con datos de fuera», from the labels of what it wrote; one that saved only its own does not",
  );
  it.todo(
    "AU-188 AU-192 · a «Sí» belongs to its collection by key: after a rename the run still saves in the same one, and a new collection given the name of a deleted one gets no «Sí»",
  );
  it.todo(
    "AU-102 · the kept record and the notice of a write outside its connection's filter (`code.write.outside`) are the same whether or not that row exists",
  );
});
