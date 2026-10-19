import { describe, expect, it } from "vitest";
import {
  allDaySpan,
  daysFromCivil,
  fromLocal,
  resizeAllDay,
  shiftWhenByDays,
  toLocal,
  whenEndDay,
  whenStartDay,
} from "./index.ts";

const tz = "Europe/Madrid";

describe("shiftWhenByDays", () => {
  it("moves all-day spans", () => {
    expect(shiftWhenByDays({ kind: "allday", startDay: 10, endDay: 12 }, 3)).toEqual({
      kind: "allday",
      startDay: 13,
      endDay: 15,
    });
  });
  it("keeps the wall-clock time across a DST change", () => {
    const day = daysFromCivil(2025, 3, 28);
    const when = {
      kind: "timed" as const,
      start: fromLocal(day, 600, tz),
      end: fromLocal(day, 660, tz),
      tz,
    };
    const moved = shiftWhenByDays(when, 4); // crosses the 30 March switch
    if (moved.kind !== "timed") throw new Error("timed expected");
    expect(toLocal(moved.start, tz)).toEqual({ day: day + 4, minute: 600 });
    expect(toLocal(moved.end, tz)).toEqual({ day: day + 4, minute: 660 });
  });
});

describe("day helpers", () => {
  it("finds first and last day", () => {
    const d = daysFromCivil(2025, 9, 17);
    const night = {
      kind: "timed" as const,
      start: fromLocal(d, 1320, tz),
      end: fromLocal(d + 1, 150, tz),
      tz,
    };
    expect(whenStartDay(night)).toBe(d);
    expect(whenEndDay(night)).toBe(d + 1);
    const toMidnight = {
      kind: "timed" as const,
      start: fromLocal(d, 1200, tz),
      end: fromLocal(d + 1, 0, tz),
      tz,
    };
    expect(whenEndDay(toMidnight)).toBe(d);
  });
  it("resizes all-day spans without inverting them", () => {
    const w = { kind: "allday" as const, startDay: 10, endDay: 12 };
    expect(resizeAllDay(w, "end", 15)).toEqual({ kind: "allday", startDay: 10, endDay: 15 });
    expect(resizeAllDay(w, "end", 5)).toEqual({ kind: "allday", startDay: 10, endDay: 10 });
    expect(resizeAllDay(w, "start", 8)).toEqual({ kind: "allday", startDay: 8, endDay: 12 });
    expect(resizeAllDay(w, "start", 20)).toEqual({ kind: "allday", startDay: 12, endDay: 12 });
    expect(allDaySpan(9, 4)).toEqual({ kind: "allday", startDay: 4, endDay: 9 });
  });
});
