/**
 * A test of a draft and what it keeps (docs/automatizaciones.md §5.8: AU-90, AU-91, AU-92; phase F14b). «Probar» is
 * `run` with `test: true` (engine.ts): the whole draft from one trigger, reading for real and writing nothing.
 * «Probar paso» is `runTest` with `step`: that step and only what it lacks of the steps before it.
 *
 * What makes a step «changed» is its **print**: one digest per step, the same for a step that would do the same with
 * the same input. A step's print is made of
 * - its type, its action, its parameters and its settings but `note` (a setting it does not hold counts as its
 *   default), each citation counted by the id of the step it cites and never by that step's name;
 * - the print of every step an arrow reaches it from, with the arrow's output and input, in the order of
 *   `arrowsInto`, and the print of every step it cites;
 * - for a trigger, the fields it was last tested with (`tested`), or nothing when it never was.
 * Nothing else: not its name, not where its box is (AU-05), not the automation's name, id or version, not the order
 * its steps and arrows were saved in (AU-12), and not what the collections hold now (the output says when it was
 * tested: AU-72).
 *
 * The server keeps, per automation, the last test of each step (`Kept`), and decides with the prints what a test
 * reuses and what is «puede estar vieja» (AU-92). The app never computes a print.
 */
import type { Execution, RunDeps, RunInput, StepRecord } from "./engine.ts";
import type { Automation } from "./format.ts";
import { notBuilt } from "./pending.ts";
import type { Cell } from "./rows.ts";

/** A step's print: a digest, compared only for equality. */
export type Print = string;

/** What is kept of the last test of a step: the record as the engine gave it, rows and lineage included. */
export interface Kept {
  print: Print;
  record: StepRecord;
  /** When that test ran (epoch ms): «probado hace 2 min». */
  at: number;
}

/**
 * The print of every step of an automation, by step id. `tested`: by trigger id, the fields that trigger was last
 * tested with. `digest` turns a text of any length into a short one (the server's SHA-256; the package stays pure).
 * The same automation with its steps and arrows saved in another order, a step moved or renamed (its citations
 * rewritten by `renameStep`), or a note changed, gives the same prints.
 */
export function stepPrints(
  _automation: Automation,
  _tested: Readonly<Record<string, Readonly<Record<string, Cell>>>>,
  _digest: (text: string) => string,
): Record<string, Print> {
  return notBuilt("stepPrints (AU-91)");
}

/** The steps whose kept test no longer stands for them (AU-92): kept with another print than the step has now. */
export function staleSteps(
  _prints: Readonly<Record<string, Print>>,
  _kept: Readonly<Record<string, Kept>>,
): string[] {
  return notBuilt("staleSteps (AU-92)");
}

export interface TestInput extends Omit<RunInput, "test"> {
  /**
   * «Probar paso»: the id of the step to test. Only that step and the steps it hangs from, back to `trigger`, are
   * decided: nothing after it and nothing on another branch has a record. Absent: «Probar», the whole draft
   * from `trigger`, with nothing reused.
   */
  step?: string;
  /** With `step`: the last test of each step, as the server kept it. */
  kept?: Readonly<Record<string, Kept>>;
  /** The prints of the automation as it is now (`stepPrints`). */
  prints: Readonly<Record<string, Print>>;
}

export interface TestExecution extends Execution {
  /** The steps that ran in this test, in order. With `step`, it is always among them: «Probar paso» runs it again. */
  ran: string[];
  /**
   * The steps before `step` that did not run: their kept record was `done` and their print is the one they have
   * now, so their rows (with their lineage: `.item` still finds its own across them) were taken as they were.
   * A step before `step` with no kept record, a stale one or one that did not end `done` runs.
   */
  reused: string[];
}

/**
 * A test (AU-90, AU-91): `run` with `test: true`, so every read asks the policy and no write is done, and with
 * `step` only what «Probar paso» needs. Validation is the same as `run`'s for the steps it decides: a problem in a
 * step after `step`, or on another branch, does not stop it. Throws `CannotRun` like `run`.
 */
export async function runTest(_input: TestInput, _deps: RunDeps): Promise<TestExecution> {
  return notBuilt("runTest (AU-91)");
}
