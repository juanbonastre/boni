/** One evaluation's result, as the «Modelos» page shows it (Juan, 2026-10-24: a model changes a role only after it). */
export interface EvalResult {
  /** Cases as expected, of all. */
  right: number;
  total: number;
  /** Cases it got wrong outright (for the decider: decided and wrong; asking Juan is not wrong). */
  wrong: number;
  /** Cases whose answer is shown as it helps most (a list for several mails, a chart for numbers to compare). */
  shown?: number;
  /** What it cost, in dollars, when the provider said so. */
  cost: number;
  tokens: number;
  cases: {
    name: string;
    ok: boolean;
    note: string;
    /** For a case not as expected: how its run ended and its plan, step by step (printed by eval.ts). */
    detail?: string;
    /** How its answer is shown, when it could be shown better ("" or absent: well shown). */
    format?: string;
  }[];
}
