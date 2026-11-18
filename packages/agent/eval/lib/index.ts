/**
 * The evaluations a model passes before it takes a role (Juan, 2026-10-24: «Modelos»): each one invented data
 * only, with the real model, at a cost the page shows. Also run by hand (`eval/*.ts`).
 */
import type { Kind, Role } from "../../src/models.ts";
import type { ModelProvider } from "../../src/providers.ts";
import { evalDecider } from "./decider.ts";
import { EVAL_NOW, evalPlanner, seedEval } from "./planner.ts";
import { evalReader } from "./reader.ts";
import type { EvalResult } from "./types.ts";

export { capped, maxCostFlag, newSpend, type Spend } from "./budget.ts";
export { type EvalKeys, evalKeys, evalProvider } from "./providers.ts";
export type { EvalResult } from "./types.ts";
export { EVAL_NOW, evalDecider, evalPlanner, evalReader, seedEval };

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
  return evalReader(model, { who: role });
}

/** One evaluation of a model (AU-234): a part per kind of call it answers, each with its own result. */
export interface ModelEvalResult {
  parts: Partial<Record<Kind, EvalResult>>;
  right: number;
  total: number;
  cost: number;
  tokens: number;
}

/**
 * A model's one evaluation (AU-234, decision 25): every case it can answer, once. A model that answers the «Agente»
 * and the reading runs the planner's cases (itself reading inside them: one model, no other) and the reader's; a
 * decision model the decider's. `kinds` comes from what the model is (`kindsOf`), never from a person or a tag;
 * `providerFor` gives the same model as each kind calls it. A part that throws throws the whole: an evaluation that
 * does not finish keeps nothing.
 */
export async function evalModel(
  providerFor: (kind: Kind) => ModelProvider,
  kinds: readonly Kind[],
): Promise<ModelEvalResult> {
  const parts: Partial<Record<Kind, EvalResult>> = {};
  if (kinds.includes("decision")) parts.decision = await evalDecider(providerFor("decision"));
  if (kinds.includes("agent"))
    parts.agent = await evalPlanner(
      providerFor("agent"),
      kinds.includes("reading") ? providerFor("reading") : providerFor("agent"),
    );
  if (kinds.includes("reading")) parts.reading = await evalReader(providerFor("reading"));
  const all = Object.values(parts);
  return {
    parts,
    right: all.reduce((a, r) => a + r.right, 0),
    total: all.reduce((a, r) => a + r.total, 0),
    cost: all.reduce((a, r) => a + r.cost, 0),
    tokens: all.reduce((a, r) => a + r.tokens, 0),
  };
}
