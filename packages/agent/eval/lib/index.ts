/**
 * The evaluations a model passes before it takes a role (Juan, 2026-10-24: «Modelos»): each one invented data
 * only, with the real model, at a cost the page shows. Also run by hand (`eval/*.ts`).
 */
import type { Role } from "../../src/models.ts";
import type { ModelProvider } from "../../src/providers.ts";
import { evalDecider } from "./decider.ts";
import { evalPlanner } from "./planner.ts";
import { evalReader } from "./reader.ts";
import type { EvalResult } from "./types.ts";

export type { EvalResult } from "./types.ts";
export { evalDecider, evalPlanner, evalReader };

/**
 * A role's evaluation with `model` in it (`reader`: the role's current reader, which the planner's cases also
 * call). The reviewer reads like the reader: it takes the reader's cases.
 */
export function evalRole(
  role: Role,
  model: ModelProvider,
  reader: ModelProvider,
): Promise<EvalResult> {
  if (role === "planner") return evalPlanner(model, reader);
  if (role === "decider") return evalDecider(model);
  return evalReader(model);
}
