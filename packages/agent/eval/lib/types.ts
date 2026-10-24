/** One evaluation's result, as the «Modelos» page shows it (Juan, 2026-10-24: a model changes a role only after it). */
export interface EvalResult {
  /** Cases as expected, of all. */
  right: number;
  total: number;
  /** Cases it got wrong outright (for the decider: decided and wrong; asking Juan is not wrong). */
  wrong: number;
  /** What it cost, in dollars, when the provider said so. */
  cost: number;
  tokens: number;
  cases: { name: string; ok: boolean; note: string }[];
}
