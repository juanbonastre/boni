// The learners on the procedure (docs/fiabilidad.md F4, docs/preferencias.md P3): the «Aprender» switch, how often a learner may suggest without Juan asking, and the area its suggestions are judged in.
import type { CostClass } from "@boni/agent";
import type { UserStore } from "@boni/store";

/** The switch that pauses every learner (docs/preferencias.md §5): on until Juan turns it off. */
const SETTING = "learning";
export const DAY = 24 * 60 * 60 * 1000;

/** The suggestions of the mail reviewer, as decisions of the procedure: class B (they touch his guide), always asked. */
export const GUIDE_AREA = "mail.guide";
export const GUIDE_COST: CostClass = "B";

export const learningOn = (store: UserStore): boolean => store.setting(SETTING) !== "off";

export function setLearning(store: UserStore, on: boolean): void {
  store.setSetting(SETTING, on ? null : "off");
}

/** A candidate tried and dropped (it measured no better) is not tried again for this long. */
export const TRIED_FOR = 7 * DAY;

/**
 * Whether a learner may look now without Juan asking (docs/preferencias.md §5, A-14): never with «Aprender» off,
 * nor while a suggestion waits for him, nor within a day of the last one made; then when his decisions since the
 * last look add up to the extension's `every`, or, at most once a day whatever the last look gave, when a
 * correction of his, repeated, already shows a rule (a candidate found by code). On demand («Revisar ahora») none
 * of this applies. (2026-11-03: a candidate that measured no better made it look again, forty reads of a model
 * each time, on every check of the mailbox; the server crawled for hours.)
 */
export function mayReview(x: {
  learning: boolean;
  waiting: boolean;
  suggestedAt: number | null;
  /** When it last looked on its own or on demand (null: never). */
  lookedAt: number | null;
  now: number;
  /** Counted only once the cheap gates pass (they read his proposals and decisions). */
  fresh: () => number;
  every: number;
  candidates: () => number;
}): boolean {
  if (!x.learning || x.waiting) return false;
  if (x.suggestedAt !== null && x.now - x.suggestedAt < DAY) return false;
  if (x.fresh() >= x.every) return true;
  if (x.lookedAt !== null && x.now - x.lookedAt < DAY) return false;
  return x.candidates() > 0;
}
