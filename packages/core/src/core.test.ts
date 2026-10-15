import { describe, expect, it } from "vitest";
import {
  addMonths,
  civilFromDays,
  daySegments,
  daysFromCivil,
  formatMinute,
  fromLocal,
  generateSample,
  gmtLabel,
  isoWeek,
  layoutColumns,
  layoutSpans,
  monthWeeks,
  startOfWeek,
  toLocal,
  weekday,
} from "./index.ts";

describe("civil days", () => {
  it("round trips and knows weekdays", () => {
    expect(daysFromCivil(1970, 1, 1)).toBe(0);
    expect(civilFromDays(daysFromCivil(2025, 9, 17))).toEqual({ y: 2025, m: 9, d: 17 });
    expect(weekday(daysFromCivil(2025, 9, 17))).toBe(3); // Wednesday
    for (let d = -800; d < 800; d += 37)
      expect(daysFromCivil(civilFromDays(d).y, civilFromDays(d).m, civilFromDays(d).d)).toBe(d);
  });
  it("starts weeks on Monday or Sunday", () => {
    const wed = daysFromCivil(2025, 9, 17);
    expect(civilFromDays(startOfWeek(wed, 1)).d).toBe(15);
    expect(civilFromDays(startOfWeek(wed, 0)).d).toBe(14);
  });
  it("builds month grids", () => {
    const sep = daysFromCivil(2025, 9, 10);
    expect(monthWeeks(sep, 1, true)).toHaveLength(6);
    expect(monthWeeks(sep, 1)).toHaveLength(5);
    expect(civilFromDays(monthWeeks(sep, 1)[0] ?? 0).d).toBe(1);
    expect(civilFromDays(addMonths(daysFromCivil(2025, 1, 31), 1))).toEqual({
      y: 2025,
      m: 2,
      d: 28,
    });
  });
  it("computes ISO weeks", () => {
    expect(isoWeek(daysFromCivil(2025, 9, 17))).toBe(38);
    expect(isoWeek(daysFromCivil(2026, 1, 1))).toBe(1);
  });
});

describe("timezones", () => {
  const tz = "Europe/Madrid";
  it("converts wall clock <-> instant", () => {
    const day = daysFromCivil(2025, 9, 17);
    const ms = fromLocal(day, 11 * 60, tz);
    expect(new Date(ms).toISOString()).toBe("2025-09-17T09:00:00.000Z");
    expect(toLocal(ms, tz)).toEqual({ day, minute: 660 });
    expect(gmtLabel(ms, tz)).toBe("GMT+2");
  });
  it("handles DST changes", () => {
    const day = daysFromCivil(2025, 3, 30); // spring forward, 02:00 -> 03:00
    const ms = fromLocal(day, 4 * 60, tz);
    expect(toLocal(ms, tz).minute).toBe(240);
    expect(gmtLabel(fromLocal(daysFromCivil(2025, 12, 1), 0, tz), tz)).toBe("GMT+1");
  });
  it("formats minutes", () => {
    expect(formatMinute(7 * 60, true)).toBe("07:00");
    expect(formatMinute(15 * 60 + 30, false)).toBe("3:30 PM");
  });
});

describe("layoutColumns", () => {
  it("puts overlapping events side by side and lets others expand", () => {
    const placed = layoutColumns([
      { id: "a", start: 600, end: 750 },
      { id: "b", start: 630, end: 660 },
      { id: "c", start: 660, end: 705 },
      { id: "d", start: 900, end: 960 },
    ]);
    const by = Object.fromEntries(placed.map((p) => [p.id, p]));
    expect(by.a).toMatchObject({ col: 0, cols: 2, span: 1 });
    expect(by.b).toMatchObject({ col: 1, cols: 2 });
    expect(by.c).toMatchObject({ col: 1, cols: 2 });
    expect(by.d).toMatchObject({ col: 0, cols: 1, span: 1 });
  });
  it("expands into free columns", () => {
    const placed = layoutColumns([
      { id: "a", start: 600, end: 700 },
      { id: "b", start: 600, end: 620 },
      { id: "c", start: 600, end: 620 },
    ]);
    expect(placed.find((p) => p.id === "a")?.cols).toBe(3);
    const late = layoutColumns([
      { id: "a", start: 600, end: 700 },
      { id: "b", start: 600, end: 620 },
      { id: "c", start: 640, end: 700 },
    ]);
    expect(late.find((p) => p.id === "b")?.span).toBe(1);
  });
});

describe("layoutSpans", () => {
  it("assigns lanes and clips to the range", () => {
    const out = layoutSpans(
      [
        { id: "long", startDay: 0, endDay: 10 },
        { id: "short", startDay: 2, endDay: 3 },
        { id: "later", startDay: 5, endDay: 6 },
        { id: "out", startDay: 20, endDay: 21 },
      ],
      3,
      8,
    );
    const by = Object.fromEntries(out.map((s) => [s.id, s]));
    expect(out).toHaveLength(3);
    expect(by.long).toMatchObject({
      lane: 0,
      startDay: 3,
      endDay: 8,
      clippedStart: true,
      clippedEnd: true,
    });
    expect(by.short?.lane).toBe(1);
    expect(by.later?.lane).toBe(1);
  });
});

describe("sample data and segments", () => {
  const anchor = daysFromCivil(2025, 9, 17);
  const data = generateSample({ anchorDay: anchor });
  it("is deterministic and has plenty of events", () => {
    const again = generateSample({ anchorDay: anchor });
    expect(again.events).toEqual(data.events);
    expect(data.events.length).toBeGreaterThan(100);
    expect(data.events.filter((e) => e.recurrence).length).toBeGreaterThan(8);
    expect(new Set(data.events.map((e) => e.id)).size).toBe(data.events.length);
  });
  it("splits events that cross midnight", () => {
    const party = data.events.find((e) => e.title === "Fiesta de cumpleaños");
    expect(party).toBeDefined();
    if (!party) return;
    const segs = daySegments(party);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ start: 1320, end: 1440, continuesAfter: true });
    expect(segs[1]).toMatchObject({ start: 0, end: 150, continuesBefore: true });
  });
  it("only uses existing calendars", () => {
    const ids = new Set(data.calendars.map((c) => c.id));
    expect(data.events.every((e) => ids.has(e.calendarId))).toBe(true);
  });
});
