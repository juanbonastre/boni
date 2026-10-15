import { type CalEvent, type CivilDay, type DaySegment, daySegments } from "@boni-calendar/core";

/** Per-event cache: immutable updates give new objects, so unchanged events cost nothing. */
const segCache = new WeakMap<CalEvent, DaySegment[]>();

function segmentsOf(e: CalEvent): DaySegment[] {
  let s = segCache.get(e);
  if (!s) {
    s = daySegments(e);
    segCache.set(e, s);
  }
  return s;
}

export interface DayIndex {
  /** Timed segments per local day. */
  timed: Map<CivilDay, DaySegment[]>;
  /** All-day events plus timed ones crossing several days are shown as bars in month view. */
  allDay: CalEvent[];
  byId: Map<string, CalEvent>;
}

export function buildDayIndex(events: readonly CalEvent[], visible: ReadonlySet<string>): DayIndex {
  const timed = new Map<CivilDay, DaySegment[]>();
  const allDay: CalEvent[] = [];
  const byId = new Map<string, CalEvent>();
  for (const e of events) {
    byId.set(e.id, e);
    if (!visible.has(e.calendarId)) continue;
    if (e.when.kind === "allday") {
      allDay.push(e);
      continue;
    }
    for (const s of segmentsOf(e)) {
      let list = timed.get(s.day);
      if (!list) {
        list = [];
        timed.set(s.day, list);
      }
      list.push(s);
    }
  }
  return { timed, allDay, byId };
}
