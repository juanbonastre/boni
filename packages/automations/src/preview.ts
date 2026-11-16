/**
 * What an expression is worth with one row of its step's input, for the line under it (docs/automatizaciones.md AU-23,
 * AU-27): «= 5 · con la fila 3 de 128». It is the run's own evaluation and not another one: the same `evaluate`, the
 * same box, the rows the step's test kept and that test's instant and seed, so what it shows is what the run gave.
 * It reads no collection (an expression cannot) and writes nothing. Contract of F14c: not built yet.
 */
import type { Box } from "./box.ts";
import type { CodeFailure } from "./code.ts";
import type { StepFailure } from "./failures.ts";
import type { Automation } from "./format.ts";
import type { Kept } from "./partial.ts";
import { notBuilt } from "./pending.ts";
import type { Cell } from "./rows.ts";

export interface PreviewInput {
  /** The draft as it is now, with the expression as it is being written. */
  automation: Automation;
  /** The step's id and, in it, the path to the value (as `Problem.param`). */
  step: string;
  param: string;
  /** Which row of the step's kept input, from 0. */
  row: number;
  /** What the draft's tests kept, by step id (partial.ts). */
  kept: Readonly<Record<string, Kept>>;
  /** The instant, the seed and the zone of the test that kept them. */
  now: number;
  seed: number;
  zone: string;
  locale: string;
}

export type Preview =
  /** `of`: how many rows the step's input has. */
  | { state: "value"; value: Cell; row: number; of: number }
  /** The step's input has no rows: there is nothing to show a value with. */
  | { state: "noRows" }
  /** It cannot be calculated yet: these steps (ids, in the order to test them) were never tested or are stale. */
  | { state: "untested"; steps: string[] }
  | { state: "failed"; failure: StepFailure | CodeFailure; row: number; of: number };

/** Never throws for what the expression does. With no JavaScript in it, it asks the box for nothing. */
export function preview(input: PreviewInput, box: Box): Promise<Preview> {
  return notBuilt(`preview(${input.step}, ${input.param}, ${typeof box})`);
}
