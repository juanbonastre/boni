/**
 * What is kept of an automation's runs (docs/automatizaciones.md AU-103). A real run stays whole while it is among the
 * last 100 of its automation and younger than 30 days; of the rest only its row stays (when, how it ended, how long,
 * what started it, which version, its line), and its steps and rows go. Its «Deshacer lo que hizo» still works (AU-18):
 * undoing reads the operation log, not the run's record. Of the tests, the last 20 stay and the older ones go whole:
 * a test did nothing. One whose proposal waits in the inbox stays whole until it is answered.
 *
 * It prunes as each run ends (that automation, one short write) and at start-up (every automation, in short writes
 * with the event loop free between them: task 137, the server answers nothing while a write runs).
 */

import type { UserStore } from "@boni/store";

/** The rule's numbers (AU-103). */
export const KEEP_WHOLE = 100;
export const KEEP_DAYS = 30;
export const KEEP_TESTS = 20;
/** Runs one write lets go at most: a few milliseconds each (`runs.test.ts`, AU-103). */
export const PRUNE_BATCH = 200;

const DAY = 86_400_000;

const keepOf = (now: number) => ({
  keep: KEEP_WHOLE,
  since: now - KEEP_DAYS * DAY,
  tests: KEEP_TESTS,
  now,
  batch: PRUNE_BATCH,
});

/** One short write for an automation, as a run of it ends; gives how many runs it let go. */
export function pruneRuns(store: UserStore, automation: string, now = Date.now()): number {
  return store.journal.pruneAutomationRuns(automation, keepOf(now));
}

const free = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * At start-up: every automation, in short writes with the event loop free between them; gives how many it let go.
 * `open` says whether the store is still open: one closed meanwhile is left as it is.
 */
export async function pruneAllRuns(
  store: UserStore,
  now = Date.now(),
  open: () => boolean = () => true,
): Promise<number> {
  let total = 0;
  if (!open()) return total;
  for (const a of store.journal.automations()) {
    for (;;) {
      if (!open()) return total;
      const n = store.journal.pruneAutomationRuns(a.id, keepOf(now));
      total += n;
      await free();
      if (n < PRUNE_BATCH) break;
    }
  }
  return total;
}
