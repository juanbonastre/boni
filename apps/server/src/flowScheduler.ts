/**
 * Flows on a schedule (docs/flujos.md F4): once a minute, each account's flows that are on with a `schedule` trigger
 * run when their time has come since they last ran and since the version that runs was saved, as work of their own
 * (P7: they read, notify and propose; P13: within the month's budget), given `$today`. A time missed while the server
 * was down runs once when it is back, the latest only and within a while of it. Each run is a line in the log.
 */
import { codeLabel, leaf, type TurnResult, type Val } from "@boni/agent";
import { dayToIso, fromLocal, toLocal, weekday } from "@boni/calendar";
import type { FlowRow, UserStore } from "@boni/store";

export interface Schedule {
  every: "day" | "week" | "hour";
  /** "HH:MM" in the server's zone; for `hour`, only its minutes count. 08:00 when not given. */
  at?: string;
  /** For `week`: 0 Sunday … 6 Saturday; Monday when not given. */
  day?: number;
}

/** The schedule a trigger names, or null. */
export function scheduleOf(trigger: unknown): Schedule | null {
  const s = (trigger as { schedule?: unknown } | null)?.schedule as Record<string, unknown> | null;
  if (!s || typeof s !== "object") return null;
  if (s.every !== "day" && s.every !== "week" && s.every !== "hour") return null;
  const at = typeof s.at === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s.at) ? s.at : undefined;
  const day = Number.isInteger(s.day) && (s.day as number) >= 0 && (s.day as number) <= 6;
  return {
    every: s.every,
    ...(at ? { at } : {}),
    ...(day ? { day: s.day as number } : {}),
  };
}

/** The latest instant at or before `now` that the schedule names, in the zone `tz`. */
export function lastSlot(s: Schedule, now: number, tz: string): number {
  const { day, minute } = toLocal(now, tz);
  const [h, m] = (s.at ?? "08:00").split(":").map(Number) as [number, number];
  if (s.every === "hour") {
    let slotDay = day;
    let slot = Math.floor(minute / 60) * 60 + m;
    if (slot > minute) slot -= 60;
    if (slot < 0) {
      slotDay -= 1;
      slot += 1440;
    }
    return fromLocal(slotDay, slot, tz);
  }
  const at = h * 60 + m;
  if (s.every === "day") return fromLocal(minute >= at ? day : day - 1, at, tz);
  let d = day - ((weekday(day) - (s.day ?? 1) + 7) % 7);
  if (d === day && minute < at) d -= 7;
  return fromLocal(d, at, tz);
}

/** How long after its time a run missed (the server was down) still runs: half an hour for hourly, three hours else. */
const graceOf = (s: Schedule) => (s.every === "hour" ? 30 : 180) * 60_000;

/**
 * The time a flow is due for now, or null: its latest time has come, after the version was saved and after its last
 * run, and not too long ago.
 */
export function dueSlot(
  s: Schedule,
  savedAt: number,
  lastRun: number | null,
  now: number,
  tz: string,
): number | null {
  const slot = lastSlot(s, now, tz);
  if (slot > now || slot <= savedAt) return null;
  if (lastRun !== null && lastRun >= slot) return null;
  if (now - slot > graceOf(s)) return null;
  return slot;
}

export interface SchedulerHost {
  hasStore(account: number): boolean;
  onFor(account: number): boolean;
  store(account: number): UserStore;
  agent(account: number): {
    background(
      plan: unknown,
      bind?: Record<string, Val>,
      keep?: readonly string[],
      budget?: undefined,
      flow?: { id: string; version: number; input?: string; by?: string },
    ): Promise<TurnResult>;
  };
}

export interface SchedulerOptions {
  host: SchedulerHost;
  accounts: () => number[];
  tz: string;
  now?: () => number;
  log?: (line: string) => void;
}

export class FlowScheduler {
  private o: SchedulerOptions;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = new Map<string, Promise<void>>();

  constructor(o: SchedulerOptions) {
    this.o = o;
  }

  private now(): number {
    return this.o.now?.() ?? Date.now();
  }

  /** The flows due now in every account, each started once (a flow still running is not started again). */
  tick(): Promise<void>[] {
    const started: Promise<void>[] = [];
    const now = this.now();
    for (const account of this.o.accounts()) {
      if (!this.o.host.hasStore(account) || !this.o.host.onFor(account)) continue;
      const store = this.o.host.store(account);
      for (const f of store.journal.flows()) {
        if (!f.enabled) continue;
        const s = scheduleOf(f.trigger);
        if (!s) continue;
        const key = `${account}:${f.id}`;
        if (this.busy.has(key)) continue;
        const slot = dueSlot(s, f.created, store.journal.flowRuns(f.id).last, now, this.o.tz);
        if (slot === null) continue;
        const job = this.run(account, f, slot).finally(() => this.busy.delete(key));
        this.busy.set(key, job);
        started.push(job);
      }
    }
    return started;
  }

  private async run(account: number, f: FlowRow, slot: number): Promise<void> {
    const local = toLocal(slot, this.o.tz);
    const at = `${dayToIso(local.day)} ${String(Math.floor(local.minute / 60)).padStart(2, "0")}:${String(Math.round(local.minute % 60)).padStart(2, "0")}`;
    try {
      const r = await this.o.host
        .agent(account)
        .background(
          f.plan,
          { today: leaf(dayToIso(local.day), codeLabel("today")) },
          [],
          undefined,
          { id: f.id, version: f.version, by: f.by },
        );
      this.o.log?.(
        `flows ${account}: «${f.name}» v${f.version} (${at}): ${r.status}${r.error ? ` ${r.error}` : ""}${r.proposals.length ? `, ${r.proposals.length} proposed` : ""}`,
      );
    } catch (e) {
      this.o.log?.(
        `flows ${account}: «${f.name}» v${f.version} (${at}): failed ${e instanceof Error ? e.message.slice(0, 80) : "?"}`,
      );
    }
  }

  /** Every minute, the first a little after the server starts. */
  start(everyMs = 60_000): void {
    const tick = () => void this.tick();
    this.timer = setInterval(tick, everyMs);
    this.timer.unref();
    setTimeout(tick, 15_000).unref();
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled([...this.busy.values()]);
  }
}
