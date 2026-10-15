import type { CalEvent, DaySegment } from "@boni-calendar/core";
import { useEffect, useMemo, useState } from "react";
import { nowMs } from "./clock.ts";
import { buildDayIndex, type DayIndex } from "./engine/dayIndex.ts";
import { useApp } from "./store.ts";

/** Events with the in-flight drag applied (moved/resized event, or the ghost of a new one). */
export function useEffectiveEvents(): CalEvent[] {
  const events = useApp((s) => s.data.events);
  const drag = useApp((s) => s.drag);
  const calendars = useApp((s) => s.data.calendars);
  return useMemo(() => {
    if (!drag) return events;
    if (drag.kind === "create") {
      const cal = calendars.find((c) => c.visible && !c.readOnly) ?? calendars[0];
      const ghost: CalEvent = {
        id: drag.id,
        calendarId: cal?.id ?? "main",
        title: "",
        when: drag.when,
        location: "",
        description: "",
        props: {},
        isTask: false,
        done: false,
        created: 0,
        updated: 0,
      };
      return [...events, ghost];
    }
    return events.map((e) => {
      if (e.id === drag.id) return { ...e, when: drag.when };
      const w = drag.group?.[e.id];
      return w ? { ...e, when: w } : e;
    });
  }, [events, drag, calendars]);
}

export function useDayIndex(): DayIndex {
  const events = useEffectiveEvents();
  const calendars = useApp((s) => s.data.calendars);
  return useMemo(() => {
    const visible = new Set(calendars.filter((c) => c.visible).map((c) => c.id));
    return buildDayIndex(events, visible);
  }, [events, calendars]);
}

export function useCalendarMap() {
  const calendars = useApp((s) => s.data.calendars);
  return useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);
}

/** Re-renders every `everyMs` with the current clock time. */
export function useNow(everyMs = 20_000): number {
  const [now, setNow] = useState(nowMs());
  useEffect(() => {
    const id = setInterval(() => setNow(nowMs()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

export type { DaySegment };
