import type { CalEvent, Recurrence } from "./model.ts";
import { shiftWhenByDays, whenEndDay, whenStartDay } from "./shift.ts";
import {
  type CivilDay,
  civilFromDays,
  daysFromCivil,
  daysInMonth,
  startOfWeek,
  weekday,
} from "./time.ts";

const MAX_STEPS = 60_000;

export const occurrenceId = (seriesId: string, day: CivilDay): string => `${seriesId}~${day}`;

export function parseOccurrenceId(id: string): { seriesId: string; day: CivilDay } | null {
  const i = id.lastIndexOf("~");
  if (i < 0) return null;
  const day = Number(id.slice(i + 1));
  return Number.isInteger(day) ? { seriesId: id.slice(0, i), day } : null;
}

/** Start days of a series in order, honouring `until` and `count` (not the exdates). */
function* seriesDays(start: CivilDay, r: Recurrence): Generator<CivilDay> {
  const interval = Math.max(1, Math.floor(r.interval || 1));
  const { y, m, d } = civilFromDays(start);
  let emitted = 0;
  const ok = (day: CivilDay) =>
    (r.until == null || day <= r.until) && (r.count == null || emitted < r.count);

  if (r.freq === "daily") {
    for (let i = 0; i < MAX_STEPS; i++) {
      const day = start + i * interval;
      if (!ok(day)) return;
      emitted++;
      yield day;
    }
  } else if (r.freq === "weekly") {
    const wds = [...new Set(r.byWeekday?.length ? r.byWeekday : [weekday(start)])]
      .map((w) => (w + 6) % 7) // Monday-first offsets
      .sort((a, b) => a - b);
    const week0 = startOfWeek(start, 1);
    for (let w = 0; w < MAX_STEPS; w++) {
      for (const off of wds) {
        const day = week0 + w * 7 * interval + off;
        if (day < start) continue;
        if (!ok(day)) return;
        emitted++;
        yield day;
      }
    }
  } else if (r.freq === "monthly") {
    for (let k = 0; k < MAX_STEPS; k++) {
      const total = y * 12 + (m - 1) + k * interval;
      const ny = Math.floor(total / 12);
      const nm = (total % 12) + 1;
      const day = daysFromCivil(ny, nm, Math.min(d, daysInMonth(ny, nm)));
      if (!ok(day)) return;
      emitted++;
      yield day;
    }
  } else {
    for (let k = 0; k < MAX_STEPS; k++) {
      const ny = y + k * interval;
      const day = daysFromCivil(ny, m, Math.min(d, daysInMonth(ny, m)));
      if (!ok(day)) return;
      emitted++;
      yield day;
    }
  }
}

/** Days (of occurrence starts) of `e` that touch [from, to], without the deleted ones. */
export function occurrenceDays(e: CalEvent, from: CivilDay, to: CivilDay): CivilDay[] {
  const r = e.recurrence;
  if (!r) return [];
  const start = whenStartDay(e.when);
  const span = whenEndDay(e.when) - start;
  const skip = new Set(e.exdates ?? []);
  const out: CivilDay[] = [];
  for (const day of seriesDays(start, r)) {
    if (day > to) break;
    if (day + span < from || skip.has(day)) continue;
    out.push(day);
  }
  return out;
}

/** Number of occurrences that start before `day`, deleted ones included (what `count` counts). */
export function occurrencesBefore(e: CalEvent, day: CivilDay): number {
  const r = e.recurrence;
  if (!r) return 0;
  let n = 0;
  for (const d of seriesDays(whenStartDay(e.when), r)) {
    if (d >= day) break;
    n++;
  }
  return n;
}

export function makeOccurrence(master: CalEvent, day: CivilDay): CalEvent {
  const start = whenStartDay(master.when);
  return {
    ...master,
    id: occurrenceId(master.id, day),
    seriesId: master.id,
    occurrenceDay: day,
    when: shiftWhenByDays(master.when, day - start),
  };
}

/** Occurrence objects per master, so repeated expansions return the same objects (and callers can cache on them). */
export type OccurrenceCache = WeakMap<CalEvent, Map<CivilDay, CalEvent>>;

/**
 * Replaces every recurring event by its occurrences touching [from, to]. Plain events pass
 * through untouched (the caller filters them by range as it always did).
 */
export function expandAll(
  events: readonly CalEvent[],
  from: CivilDay,
  to: CivilDay,
  cache?: OccurrenceCache,
): CalEvent[] {
  const out: CalEvent[] = [];
  for (const e of events) {
    if (!e.recurrence) {
      out.push(e);
      continue;
    }
    let byDay = cache?.get(e);
    if (cache && !byDay) {
      byDay = new Map();
      cache.set(e, byDay);
    }
    for (const day of occurrenceDays(e, from, to)) {
      let occ = byDay?.get(day);
      if (!occ) {
        occ = makeOccurrence(e, day);
        byDay?.set(day, occ);
      }
      out.push(occ);
    }
  }
  return out;
}

/** The occurrence `id` points to, built on demand (no range needed). */
export function resolveOccurrence(events: readonly CalEvent[], id: string): CalEvent | null {
  const direct = events.find((e) => e.id === id);
  if (direct && !direct.recurrence) return direct;
  const p = parseOccurrenceId(id);
  if (!p) return direct ?? null;
  const master = events.find((e) => e.id === p.seriesId);
  if (!master?.recurrence) return null;
  const days = occurrenceDays(master, p.day, p.day);
  return days.includes(p.day) ? makeOccurrence(master, p.day) : null;
}

export function describeRecurrence(r: Recurrence | null | undefined): string {
  if (!r) return "";
  const n = r.interval > 1 ? `${r.interval}` : "";
  return `${r.freq}${n}${r.byWeekday?.length ? `:${[...r.byWeekday].sort().join("")}` : ""}`;
}
