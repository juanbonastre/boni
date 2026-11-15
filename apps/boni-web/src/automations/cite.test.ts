// Dragging a field into a parameter (docs/automatizaciones.md AU-20, AU-21). Pending: see edit.test.ts.
import { describe, it } from "vitest";

describe("the citation a dragged field writes", () => {
  it.todo(
    "AU-21 · a field of the step it hangs from is written $json.campo, one of an earlier step $('Paso').item.campo, and one with a step that remakes the rows in between $('Paso').first().campo; what is written parses back to the same citation",
  );
  it.todo(
    "AU-21 · a citation is painted as a chip with its field's name, and one of a step or a field that is not there as a broken chip saying which",
  );
  it.todo(
    "AU-21 · a chip knows the step its field is of, for its icon ($json: the step the edited one hangs from), and says the step too only when another step of the path has a field of the same name",
  );
  it.todo(
    "AU-21 · in a step with two inputs a field of either is cited by its step with first(), never as $json",
  );
  it.todo(
    "AU-20 · dropped on text, a field goes in at the caret (at the end with no caret) and the value becomes an expression; dropped on a number, a date or a choice, it replaces the value",
  );
  it.todo(
    "AU-20 · «{ }» to «Expresión» keeps what was written as the expression's text, and back to «Fijo» leaves the value empty",
  );
  it.todo(
    "AU-20 · an expression is previewed with the first row of the last test, saying which row and of how many; with no test there is no preview, and a citation that gives no value says why",
  );
  it.todo(
    "AU-20 · previewing an expression on every keystroke makes no call and stays within its time with a row of 200 fields (A-15)",
  );
});
