/**
 * Questions about events by day: the segments a timed event leaves in each day it touches, which events fall in a
 * range of days and how long they last.
 */
import type { CalEvent } from "./model.ts";
import { type CivilDay, fromLocal, toLocal } from "./time.ts";

export interface DaySegment {
  eventId: string;
  day: CivilDay;
  /** Minutes since local midnight. */
  start: number;
  end: number;
  /** True when the event continues from the previous day / into the next day. */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/** Splits a timed event in one segment per local day it touches. */
export function daySegments(event: CalEvent): DaySegment[] {
  if (event.when.kind !== "timed") return [];
  const { start, end, tz } = event.when;
  const a = toLocal(start, tz);
  let b = toLocal(Math.max(end, start), tz);
  if (b.day > a.day && b.minute === 0) b = { day: b.day - 1, minute: 1440 };
  if (a.day === b.day) {
    return [
      {
        eventId: event.id,
        day: a.day,
        start: a.minute,
        end: Math.max(b.minute, a.minute),
        continuesBefore: false,
        continuesAfter: false,
      },
    ];
  }
  const out: DaySegment[] = [];
  for (let d = a.day; d <= b.day; d++) {
    out.push({
      eventId: event.id,
      day: d,
      start: d === a.day ? a.minute : 0,
      end: d === b.day ? b.minute : 1440,
      continuesBefore: d > a.day,
      continuesAfter: d < b.day,
    });
  }
  return out;
}

export function dayRangeMs(first: CivilDay, last: CivilDay, tz: string): [number, number] {
  return [fromLocal(first, 0, tz), fromLocal(last + 1, 0, tz)];
}

/** Whether the event overlaps the [first, last] local days (inclusive) in `tz`. */
export function overlapsDays(
  event: CalEvent,
  first: CivilDay,
  last: CivilDay,
  tz: string,
): boolean {
  const w = event.when;
  if (w.kind === "allday") return w.endDay >= first && w.startDay <= last;
  const [from, to] = dayRangeMs(first, last, tz);
  return w.end > from && w.start < to;
}

export function eventsInDays(
  events: readonly CalEvent[],
  visibleCalendars: ReadonlySet<string>,
  first: CivilDay,
  last: CivilDay,
  tz: string,
): CalEvent[] {
  return events.filter(
    (e) => visibleCalendars.has(e.calendarId) && overlapsDays(e, first, last, tz),
  );
}

export function eventDurationMinutes(event: CalEvent): number {
  const w = event.when;
  if (w.kind === "allday") return (w.endDay - w.startDay + 1) * 1440;
  return Math.round((w.end - w.start) / 60_000);
}
