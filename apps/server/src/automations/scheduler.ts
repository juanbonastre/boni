/**
 * «Programada» on the server (docs/automatizaciones.md §5.9, AU-114; phase F14d S3): the hours of each published,
 * enabled automation with a schedule trigger, run once each by a tick a minute, with the functions the flows of
 * before already use (`flowScheduler.ts`: `lastSlot`, `graceOf`, the same rules). A version's hours are written to a
 * column when it is published (`scheduleColumn`), so a tick reads one query per account and no document.
 *
 * Each tick, for each automation: the latest hour any of its rules has reached (once, however many rules fall on it),
 * if it is after the version was published, after the switch was turned on and after the last hour that ran. Within
 * the margin of D-44 (half an hour for «Cada hora», three hours the others) it starts a run in the account's lane
 * (`startScheduledRun`, `$run.startedBy` is `schedule`, the trigger gives the hour that was due); past it, the run is
 * kept as «No corrió» (`missRun`). The store refuses a second run with the same hour (a unique index), so two ticks,
 * a restart or two servers never run one hour twice; an interrupted run's hour counts as run (AU-190). While a run of
 * it is under way, it waits for the next tick. What a run writes is decided as for any run of a version (AU-195).
 *
 * Each tick also goes on with the runs whose wait for an answer passed its limit (AU-203: «sin respuesta»), in the
 * account's lane: a restart loses none, since the limit is kept with the wait in the store.
 */

import { type Automation, type Box, SCHEDULE_DAYS, SCHEDULE_EVERY } from "@boni/automations";
import type { UserStore } from "@boni/store";
import { graceOf, lastSlot, type Schedule } from "../flowScheduler.ts";
import { expireWaits, missRun, startScheduledRun } from "./runs.ts";

/** One schedule trigger of a version and its rules, as the column keeps them. */
export interface ScheduleEntry {
  step: string;
  rules: Schedule[];
}

/** Monday 1 … Saturday 6, Sunday 0, as `Schedule.day` counts them. */
const DAY_NUMBER: Record<string, number> = Object.fromEntries(
  SCHEDULE_DAYS.map((d, i) => [d, (i + 1) % 7]),
);

/** A rule of a «Programada» (its `rules` row) as the scheduler reads it, or null when it is not one. */
function ruleOf(row: unknown): Schedule | null {
  const r = row as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  const every = r.every;
  if (typeof every !== "string" || !(SCHEDULE_EVERY as readonly string[]).includes(every))
    return null;
  const at = typeof r.at === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.at) ? r.at : "08:00";
  return {
    every: every as Schedule["every"],
    at,
    ...(every === "week" ? { day: DAY_NUMBER[String(r.day)] ?? 1 } : {}),
  };
}

/** The «Programada» triggers of a version and their rules, as the column keeps them (JSON), or null with none. */
export function scheduleColumn(a: Automation): string | null {
  const entries: ScheduleEntry[] = [];
  for (const s of a.steps) {
    if (s.type !== "schedule") continue;
    const rows = Array.isArray(s.params.rules) ? s.params.rules : [];
    const rules = rows.map(ruleOf).filter((r): r is Schedule => r !== null);
    if (rules.length) entries.push({ step: s.id, rules });
  }
  return entries.length ? JSON.stringify(entries) : null;
}

/** What a tick does with one automation now: start the hour that is due, keep it as «No corrió», or nothing. */
export type DueHour = { step: string; slot: number; missed: boolean } | null;

/**
 * The hour due now (AU-114): the latest that any rule of any of its «Programada» reached, once, if it is after
 * `since` and after `last`; missed when it is past the widest margin of the rules that fall on it.
 */
export function dueHour(
  entries: readonly ScheduleEntry[],
  since: number,
  last: number | null,
  now: number,
  tz: string,
): DueHour {
  let best: { step: string; slot: number; grace: number } | null = null;
  for (const e of entries)
    for (const r of e.rules) {
      const slot = lastSlot(r, now, tz);
      if (slot > now) continue;
      if (!best || slot > best.slot) best = { step: e.step, slot, grace: graceOf(r) };
      else if (slot === best.slot) best.grace = Math.max(best.grace, graceOf(r));
    }
  if (!best || best.slot <= since || (last !== null && last >= best.slot)) return null;
  return { step: best.step, slot: best.slot, missed: now - best.slot > best.grace };
}

export interface AutomationSchedulerOptions {
  accounts: () => number[];
  /** Whether the account has a store already: the scheduler opens none for an account that never used Boni. */
  hasStore(account: number): boolean;
  store(account: number): UserStore;
  /** The account's zone (IANA): its hours are its own. */
  zone(account: number): string;
  now?: () => number;
  log?: (line: string) => void;
  /** Where a «Código» runs; the sandbox when not given (tests give their own). */
  box?: Box;
}

const parse = (text: string): ScheduleEntry[] => {
  try {
    const v = JSON.parse(text) as unknown;
    return Array.isArray(v) ? (v as ScheduleEntry[]) : [];
  } catch {
    return [];
  }
};

export class AutomationScheduler {
  private o: AutomationSchedulerOptions;
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = new Set<Promise<unknown>>();

  constructor(o: AutomationSchedulerOptions) {
    this.o = o;
  }

  /**
   * One tick: for every account and every scheduled automation, what is due now. Gives what it started, each
   * resolving once its run has begun or was refused (the lane runs it); a «No corrió» is kept at once.
   */
  tick(): Promise<unknown>[] {
    const now = this.o.now?.() ?? Date.now();
    const out: Promise<unknown>[] = [];
    for (const account of this.o.accounts()) {
      if (!this.o.hasStore(account)) continue;
      const store = this.o.store(account);
      const tz = this.o.zone(account);
      for (const going of expireWaits(store, {
        now,
        zone: tz,
        ...(this.o.box ? { box: this.o.box } : {}),
      })) {
        const job = going.finally(() => this.started.delete(job));
        this.started.add(job);
        out.push(job);
      }
      for (const a of store.journal.scheduledAutomations()) {
        if (a.busy) continue;
        const due = dueHour(parse(a.schedule), a.since, a.last, now, tz);
        if (!due) continue;
        if (due.missed) {
          if (missRun(store, a.id, due.step, due.slot, now))
            this.o.log?.(
              `automations ${account}: ${a.id} did not run at ${new Date(due.slot).toISOString()}`,
            );
          continue;
        }
        const job = startScheduledRun(
          store,
          a.id,
          due.step,
          due.slot,
          tz,
          this.o.box ? { box: this.o.box } : {},
        )
          .then((r) => {
            if ("refused" in r || "error" in r)
              this.o.log?.(
                `automations ${account}: ${a.id} not started: ${JSON.stringify(r).slice(0, 80)}`,
              );
            return r;
          })
          .catch((e) =>
            this.o.log?.(
              `automations ${account}: ${a.id} failed to start: ${String(e).slice(0, 80)}`,
            ),
          )
          .finally(() => this.started.delete(job));
        this.started.add(job);
        out.push(job);
      }
    }
    return out;
  }

  /** Every minute, the first a little after the server starts (as the flows' scheduler). */
  start(everyMs = 60_000): void {
    const tick = () => void this.tick();
    this.timer = setInterval(tick, everyMs);
    this.timer.unref();
    setTimeout(tick, 15_000).unref();
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled([...this.started]);
  }
}
