// The editor's own state (docs/automatizaciones.md §5.7). Pending: see edit.test.ts.
import { describe, it } from "vitest";

describe("the draft saves itself", () => {
  it.todo(
    "AU-62 · «Nueva» owes the server nothing until its first step; every change after it is owed, and «Guardado» says saving, saved or failed",
  );
  it.todo(
    "AU-62 · a save that fails leaves what is owed owed, and a change made while a save is out is sent after it, never lost and never before it",
  );
  it.todo(
    "AU-05 · moving a box is owed as its place and not as a draft: the draft's rev does not change and no test becomes stale",
  );
  it.todo(
    "AU-05 · a step added has its place from then on, owed to the server like one Juan dropped: where the right click was, or where placeFor says; a later step never moves it",
  );
});

describe("undo", () => {
  it.todo(
    "AU-68 · Deshacer walks back every change since the editor opened (a step added or removed, an arrow, a box moved, a name, a parameter, a setting) and Rehacer forward; a new change empties what could be redone",
  );
  it.todo(
    "AU-68 · what Deshacer brings back is owed to the server like any other change, and opening a step or selecting one is not a change",
  );
  it.todo(
    "AU-82 · the notice of what a change of action took away undoes it in one step, parameters and name together",
  );
});

describe("after a test", () => {
  it.todo(
    "AU-64 · «Registro» says untested, then the last test in one line (when, how it ended, how many steps, how long, that it wrote nothing) or the step it failed in; with problems it says how many and tests nothing",
  );
  it.todo(
    "AU-67 · every arrow has the rows that passed by it and every output with no arrow its count; a failed step's dependants are skipped",
  );
  it.todo(
    "AU-92 · the steps the server says are stale after a save keep their counts, marked; a test of them clears the mark",
  );
  it.todo(
    "AU-83 · the problems shown after a test was asked leave a step as soon as it changes, and none is shown before one is asked",
  );
});
