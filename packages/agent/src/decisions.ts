// A decision Boni takes for Juan, with its confidence and its cost: do it and tell him, ask him, or nothing (docs/fiabilidad.md).
/**
 * One procedure for every decision Boni takes for Juan without his asking it right then (docs/fiabilidad.md, Juan
 * 2026-11-01): the confidence `p` (from Jev for a choice about a text, from Juan's own history for «would he want
 * this», never from what the planner says of itself), the cost of being wrong, and three ways out. The policy is the
 * floor: what it makes Boni confirm or propose stays so whatever `p` says (A-13).
 */

/** What being wrong costs: A is undone at once; B touches Juan's data; C is irreversible or leaves (never alone). */
export type CostClass = "A" | "B" | "C";
export type Outcome = "do" | "ask" | "nothing";
/** From `ask` up, Boni asks; from `do` up, it acts alone when the area's «Solo» is on. */
export interface Thresholds {
  ask: number;
  do: number;
}

/** Today's numbers, until an area's own are earned (docs/fiabilidad.md §3.3). */
export const DEFAULT_THRESHOLDS: Readonly<Record<CostClass, Thresholds>> = {
  A: { ask: 0.6, do: 0.9 },
  B: { ask: 0.6, do: 0.95 },
  C: { ask: 0.6, do: 2 },
};

/** When an area may be offered «Solo»: this many decisions with this share right. */
export const AUTONOMY = { decisions: 20, accuracy: 0.95 } as const;
/** When an area goes back to asking on its own: this many undone or corrected in a row, or this share of the last. */
export const BACK_OFF = { inARow: 3, share: 0.2, last: 20 } as const;

/** The way out of a decision: alone only below class C, with «Solo» on and `p` at the area's `do`. */
export function resolve(
  p: number,
  cost: CostClass,
  auto: boolean,
  t: Thresholds = DEFAULT_THRESHOLDS[cost],
): Outcome {
  if (cost !== "C" && auto && p >= t.do) return "do";
  return p >= t.ask ? "ask" : "nothing";
}

/**
 * Confidence from Juan's own history, with caution: the lower bound of Wilson's interval at 95 %, so 3 right of 3 is
 * 0.44 and 5 of 5 is 0.57, not 1; none decided is 0.
 */
export function historyConfidence(right: number, total: number): number {
  if (total <= 0 || right < 0 || right > total) return 0;
  const z = 1.96;
  const n = total;
  const phat = right / n;
  const denominator = 1 + (z * z) / n;
  const centre = phat + (z * z) / (2 * n);
  const margin = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * n)) / n);
  return Math.max(0, (centre - margin) / denominator);
}

/** Whether an area has earned «Solo»: enough decisions, enough of them right. */
export function earned(decided: number, right: number): boolean {
  return decided >= AUTONOMY.decisions && right / decided >= AUTONOMY.accuracy;
}

/** Whether an area should go back to asking, from its last results (true = right), newest last. */
export function backOff(results: readonly boolean[]): boolean {
  const last = results.slice(-BACK_OFF.last);
  if (last.length >= BACK_OFF.inARow && last.slice(-BACK_OFF.inARow).every((r) => !r)) return true;
  const wrong = last.filter((r) => !r).length;
  return last.length >= BACK_OFF.inARow && wrong / last.length >= BACK_OFF.share;
}

/** The levels of confidence the Registro counts by, and calibration uses: the edges of each band. */
export const LEVELS = [0, 0.5, 0.6, 0.7, 0.8, 0.9, 1.000001] as const;
export interface Level {
  from: number;
  to: number;
  /** Decisions taken alone at this level and judged by Juan since, and how many were right. */
  judged: number;
  right: number;
}
/** From this many judged decisions a level's own accuracy replaces what the model said (docs/fiabilidad.md §3.3). */
export const CALIBRATION_MIN = 10;

/** What was right at each level, out of the decisions taken alone and judged. */
export function levelsOf(
  rows: readonly { p: number; outcome: Outcome; result: "right" | "wrong" | null }[],
): Level[] {
  const out: Level[] = [];
  for (let i = 0; i + 1 < LEVELS.length; i++) {
    const from = LEVELS[i] as number;
    const to = LEVELS[i + 1] as number;
    const mine = rows.filter((r) => r.outcome === "do" && r.result && r.p >= from && r.p < to);
    out.push({
      from,
      to: Math.min(to, 1),
      judged: mine.length,
      right: mine.filter((r) => r.result === "right").length,
    });
  }
  return out;
}

/**
 * The confidence as Juan's decisions say it is: at a level judged often enough, the share that was right replaces
 * what the model said (a model that says 0.8 and is right 6 times in 10 counts as 0.6); elsewhere, what it said.
 */
export function calibrate(p: number, levels: readonly Level[]): number {
  const l = levels.find((x) => p >= x.from && p < (x.to >= 1 ? 1.000001 : x.to));
  return l && l.judged >= CALIBRATION_MIN ? l.right / l.judged : p;
}
