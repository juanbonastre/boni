// The engine running JavaScript through the box (docs/automatizaciones.md §5.3, §5.4, §6; box.ts, engine.ts,
// partial.ts). Pending: the first PR of F14c brings one test per rule, and the builder turns each into a real one,
// keeping the rule's id in its name (`make check` reads them). Real tests here use a `Box` that is a fake of the test
// (it answers what a table says, and records every job it was sent) and the fakes of run.test-util.ts: the real
// interpreter is tested in apps/sandbox, and the two together in apps/server/src/automations/box.test.ts.
import { describe, it } from "vitest";

describe("«Código» as a step", () => {
  it.todo(
    "AU-30 · «Código» has two parameters, «Se ejecuta» with «Una vez con todas las filas» by default and «Una vez por fila», and the code; neither may be an expression, and the step has one input and one output",
  );
  it.todo(
    "AU-30 · it gives rows: a list of objects is those rows, one object one row, null or an empty list none; a text, a number or a list of them is `code.result` (`notRows`) and no `return` `code.result` (`nothing`)",
  );
  it.todo(
    "AU-30 · «Una vez por fila» is called once per row that arrives and each row out knows the row it comes from, so `.item` finds its own across it; «Una vez con todas las filas» remakes the rows, runs once with an empty list too, and «Una vez por fila» with an empty list calls nothing",
  );
  it.todo(
    "AU-30 · a row whose code fails in «Una vez por fila» follows the step's «Si falla» like any step's row: dropped with «Seguir», out by «error» with «Salir por error», and the others' rows come out",
  );
  it.todo(
    "AU-32 · nothing code can call writes: `evaluate` never asks the gate for a write, whatever the box answers, and a read the box asks for with an operation that is not find, get, count or sum is `code.read.query`",
  );
  it.todo(
    "AU-32 · a row out of «Código» is no saved row: it has no origin even when it copies one's fields and id, so a «Colección» step after it that takes «Las filas que llegan» fails with `row.notSaved`, and one that creates or modifies asks the policy as for any rows",
  );
});

describe("what the box is sent and what comes back", () => {
  it.todo(
    "AU-160 · the engine runs no JavaScript itself: every `{{ }}` that is not a simple citation and every «Código» goes to `RunDeps.box`, and no source file of the engine, of the catalogue or of the server's automations names `eval`, `Function(` or `node:vm`",
  );
  it.todo(
    "AU-160 · a job carries no label, no origin, no id of the automation or of the run, no collection the code did not read and no step it does not cite: for a table of automations, what the fake box was sent is exactly that",
  );
  it.todo(
    "AU-163 · the job of a step holds, of the steps before it, only the ones its code cites and, where the code names the fields, only those fields; with `.item`, the place of each row's own row",
  );
  it.todo(
    "AU-169 · what an evaluation gives carries the worst label of what it was sent (its rows, the rows of every step cited, the code's own label and every read it made) and is derived: with one row from outside among 3,000 of the user's, the value calculated from all of them is from outside",
  );
  it.todo(
    "AU-169 · in «Una vez por fila» and in an expression the label is per row, never finer: beside a row from outside, a row of the user's that cites no other step and reads nothing gives a value that is the user's, derived",
  );
  it.todo(
    "AU-169 · a value calculated is never a destination: a «Colección» step whose relation or whose row to modify comes from a «Código» or from a `{{ }}` with JavaScript is denied by the policy (P14), while the same value from a simple citation is not",
  );
  it.todo(
    "AU-169 · a `{{ }}` that is a simple citation keeps its field's exact label beside one with JavaScript in the same parameter, and the label of the path (AU-164) passes through a «Código» to the rows it gives",
  );
  it.todo(
    "AU-27 · a value shown under an expression is calculated by `evaluate` with the same box, the same instant, the same seed and the same row as the test that kept the rows: for a table of expressions with dates and chance, the preview of row n is the value the run gave row n",
  );
  it.todo(
    "AU-27 · there is no second interpreter: no file of the web app evaluates code (no `eval`, no `Function(`, no interpreter among its dependencies), and a preview is always asked of the server",
  );
  it.todo(
    "AU-25 · `rowsOf` takes the keys of what the box gave as fields and nothing else: a row with `__proto__`, `constructor` or `toString` as keys comes out with those fields, and no object of the engine gets a prototype or a property from it",
  );
  it.todo(
    "AU-23 · the preview of an expression says its value with a row of the step's kept input and how many there are, for any row asked; with a step before it never tested or stale it says which to test and asks the box for nothing; a failure is said with its code",
  );
});

describe("reading collections from code", () => {
  it.todo(
    "AU-31 · `find` with `where`, `sort` and `limit`, `get`, `count` and `sum` each become one read the engine makes and hands back by the box's key; `where` is the views' filter as a list of rules, and one that is not is `code.read.query`",
  );
  it.todo(
    "AU-161 · every read goes through `narrow` and then the gate: the policy is asked once per read with the step, the collection and the filter's values, which are judged as calculated (derived, with the worst label of what the evaluation had received until then)",
  );
  it.todo(
    "AU-161 · a read of a collection the step is not connected to is `code.read.notConnected` and never reaches the gate; a read the policy denies is `policy.denied`, one it would ask about `policy.waits`, and the code never learns why",
  );
  it.todo(
    "AU-161 · each read is counted in the step's record (collection, operation, rows, bytes, time), its rows come labelled as the collection's rows are, and what was read for one step is never handed to another step's job or another run's",
  );
  it.todo(
    "AU-161 · the engine repeats a job with what was read until no evaluation needs a read: a job that asks again for a read it was handed, or more than `reads` different ones, is `code.limit` and the step ends",
  );
});

describe("the clock, chance and what a test keeps", () => {
  it.todo(
    "AU-34 · every job of a run carries the same instant, taken once when the run starts, and a seed made of the run's seed and the step's id: running the same automation again with the same instant and seed sends the same jobs and gives the same rows",
  );
  it.todo(
    "AU-34 · the chance of a row does not depend on the size of the batch, on the row's retries or on what other rows did: 3,000 rows in batches of 500 and in batches of 7 give the same",
  );
  it.todo(
    "AU-34 · «Probar paso» reuses a kept step that read the clock or chance as it was kept, with what it gave then; when it runs again it gets the new test's instant and seed, its print does not change for that, and its record says that it read them",
  );
  it.todo(
    "AU-33 · what the code wrote with `console` is kept in its step's record with the line that wrote it and, per row, the row: at most `consoleLines` lines of `consoleLineChars` characters, the rest counted; a reused step keeps the console it had",
  );
  it.todo(
    "AU-33 · code that throws fails its step with `code.threw`, the message as the code gave it and the line and column of the source Juan wrote; in an expression, the parameter at fault. The message is in the record and nowhere else: not in `StepError.message`, not in a log",
  );
});

describe("the limits and the cost", () => {
  it.todo(
    "AU-35 · passing a limit fails the step with `code.limit`, the limit's key and the limit; with what was reached where it can be known (bytes sent, bytes and rows given, rows and bytes read, reads) and without it for time, operations and memory",
  );
  it.todo(
    "AU-35 · the engine checks before sending that a job fits `inputBytes` and after it that the rows given fit `outputRows`, a read is stopped at `readBytes` while it is being read, and a step's reads stop at `stepReads` and `stepReadBytes`: nothing over a limit is held in memory to find out",
  );
  it.todo(
    "AU-34 · the run's instant and its seed are kept with it (`Execution.started`, `Execution.seed`) and with each kept step (`Kept.clock`), which is where a preview takes them from, and a step's record says whether its JavaScript read the clock or chance (`StepRecord.uses`)",
  );
  it.todo(
    "AU-38 · a step with a `{{ }}` of JavaScript and 3,000 rows makes one call to the box per `batchRows` rows, never one per row, and «Una vez por fila» the same; a step with only simple citations makes none",
  );
  it.todo(
    "AU-38 · the expressions of a step are evaluated for all its rows before its rows are worked on: a step with three parameters with JavaScript and 3,000 rows makes the calls of one, not of three",
  );
  it.todo(
    "AU-37 · the engine keeps nothing of an evaluation but its values, its console and its count: the same job sent twice to the fake box gives the same record, and no job holds anything the box answered before but the reads of its own step",
  );
});
