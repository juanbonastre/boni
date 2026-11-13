/**
 * A hard cap on what a hand-run evaluation spends (AGENTS.md: real models by hand, with a budget). Before each call
 * the spend so far is checked, and once it has reached the cap no call is made: the call fails with `over-budget`.
 * One call can take the spend past the cap by at most its own cost, so the cap is the budget less one call.
 */

import type { ModelProvider } from "../../src/providers.ts";

/** What a run has spent so far, shared by every model it calls. */
export interface Spend {
  cost: number;
  tokens: number;
  calls: number;
}

/** A call whose provider says no price is counted at the dearest known (anthropicCost's fallback): never as free. */
const DEAREST: [number, number] = [10, 50];

export function newSpend(): Spend {
  return { cost: 0, tokens: 0, calls: 0 };
}

export function capped(p: ModelProvider, max: number, spend: Spend): ModelProvider {
  return {
    id: p.id,
    privacy: p.privacy,
    async complete(req, o) {
      if (spend.cost >= max) throw Object.assign(new Error("over-budget"), { code: "over-budget" });
      const r = await p.complete(req, o);
      spend.calls++;
      spend.tokens += r.usage.input + r.usage.output;
      spend.cost +=
        r.usage.cost ?? (r.usage.input * DEAREST[0] + r.usage.output * DEAREST[1]) / 1_000_000;
      return r;
    },
  };
}

/** `--max-cost=<dollars>`, or `fallback` without it; a cap that is not a positive number stops the run. */
export function maxCostFlag(argv: readonly string[], fallback: number): number {
  const raw = argv.find((a) => a.startsWith("--max-cost="))?.slice("--max-cost=".length);
  const max = raw === undefined ? fallback : Number(raw);
  if (!(max > 0)) throw new Error(`--max-cost must be a positive number of dollars, not ${raw}`);
  return max;
}
