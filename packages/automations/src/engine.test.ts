// The engine's rules (docs/automatizaciones.md §5.2). Pending: the first PR of F14a brings one test per rule, and
// the builder turns each into a real one, keeping the rule's id in its name (`make check` reads them). Real tests
// use the repo's invented seeds and fakes of `Policy`, `Collections`, `Clock` and `Dates`: never a store.
import { describe, expect, it } from "vitest";
import { CATALOGUE } from "./catalogue.ts";
import { EXECUTORS, executorKey, STEP_STATES } from "./engine.ts";

describe("how an automation runs", () => {
  it.todo(
    "AU-04 · rows pass along the arrows, and a row read from a collection still knows its saved row: a later step modifies it without searching again",
  );
  it.todo(
    "AU-06 · with two triggers a run starts in one: the steps that hang only from the other have no record and do not hold back a step both reach",
  );
  it.todo(
    "AU-07 · an arrow that goes back is a cycle: wouldCycle says so before it is added and validation refuses the automation",
  );
  it.todo(
    "AU-10 · a step is decided when every step that reaches it has finished: it runs if some arrow brings rows, and if none does it is skipped with what hangs only from it",
  );
  it.todo(
    "AU-11 · rows that reach a step by several arrows are put together in a fixed order and the step runs once",
  );
  it.todo(
    "AU-12 · the same automation with its steps and arrows saved in another order runs the same steps in the same order with the same rows",
  );
  it.todo(
    "AU-13 · the engine loops for a step that works per row, and each row out finds its own with .item; after a step that remakes the rows .item says it cannot and names .first()",
  );
  it.todo(
    "AU-14 · an arrow with no rows does not start what follows; with «Seguir sin filas» what follows runs with an empty list, never with an invented row: a step that writes runs once with no current row",
  );
  it.todo(
    "AU-15 · a run records, per step, its state, the rows in and the rows out by each output, how long it took and what came out",
  );
  it.todo(
    "AU-16 · a failing step stops the run by default, drops its rows with «Seguir» or sends them out by «error» with the reason; it is retried up to 5 times with a wait",
  );

  // The criterion of done of the phase (§8). Its timings are printed, not asserted against the machine's speed.
  it.todo(
    "F14a criterion · trigger → find → group → if → create over 3,000 rows runs twice with the same result, timed",
  );

  // The engine finds an action's executor by this key: the builder fills EXECUTORS, and this then holds for all.
  it.todo("every action of the catalogue that is not a trigger's has an executor of its mode");

  it("the states of a step are the seven of the design", () => {
    expect(STEP_STATES).toHaveLength(7);
    expect(new Set(STEP_STATES).size).toBe(7);
  });

  it("an executor registered is one of the catalogue's actions", () => {
    const known = new Set(
      CATALOGUE.flatMap((t) => t.actions.map((a) => executorKey(t.type, a.key))),
    );
    for (const key of Object.keys(EXECUTORS)) expect(known.has(key), key).toBe(true);
  });
});
