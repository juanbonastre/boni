import type { When } from "./model.ts";
import { type CivilDay, fromLocal, toLocal } from "./time.ts";

/** Moves an event by whole days keeping its wall-clock times (so DST never shifts the hour). */
export function shiftWhenByDays(when: When, dayDelta: number): When {
  if (dayDelta === 0) return when;
  if (when.kind === "allday") {
    return { kind: "allday", startDay: when.startDay + dayDelta, endDay: when.endDay + dayDelta };
  }
  const a = toLocal(when.start, when.tz);
  const b = toLocal(when.end, when.tz);
  return {
    kind: "timed",
    start: fromLocal(a.day + dayDelta, a.minute, when.tz),
    end: fromLocal(b.day + dayDelta, b.minute, when.tz),
    tz: when.tz,
  };
}

/** First local day of an event. */
export function whenStartDay(when: When): CivilDay {
  return when.kind === "allday" ? when.startDay : toLocal(when.start, when.tz).day;
}

/**
 * Last local day of an event (inclusive). A timed event ending exactly at midnight does not
 * touch the next day.
 */
export function whenEndDay(when: When): CivilDay {
  if (when.kind === "allday") return when.endDay;
  const a = toLocal(when.start, when.tz);
  const b = toLocal(Math.max(when.end, when.start), when.tz);
  return b.day > a.day && b.minute === 0 ? b.day - 1 : b.day;
}

/** Changes one edge of an all-day span, never letting the end go before the start. */
export function resizeAllDay(
  when: Extract<When, { kind: "allday" }>,
  edge: "start" | "end",
  day: CivilDay,
): When {
  return edge === "start"
    ? { kind: "allday", startDay: Math.min(day, when.endDay), endDay: when.endDay }
    : { kind: "allday", startDay: when.startDay, endDay: Math.max(day, when.startDay) };
}

/** An all-day span between two days picked in any order. */
export function allDaySpan(a: CivilDay, b: CivilDay): When {
  return { kind: "allday", startDay: Math.min(a, b), endDay: Math.max(a, b) };
}
