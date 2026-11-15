// Where the boxes go when nobody has put them anywhere (docs/automatizaciones.md AU-05). Pending: see edit.test.ts.
import { describe, it } from "vitest";

describe("the places of the boxes", () => {
  it.todo(
    "AU-05 · a step with no place goes to the right of the one it hangs from, and below when that place is taken; a new trigger goes below the last trigger; one that hangs from nothing goes to the right of the rightmost box of the first row; a step with a place is never moved",
  );
  it.todo(
    "AU-05 · the same draft and the same places give the same answer twice, and no two boxes end on each other",
  );
  it.todo(
    "AU-64 · «Ordenar» places every box left to right from each trigger, one column per step of distance, with no arrow going backwards; 300 steps are placed within its time (A-15)",
  );
});
