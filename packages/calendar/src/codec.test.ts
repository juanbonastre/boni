import { describe, expect, it } from "vitest";
import {
  daysFromCivil,
  dayToIso,
  formatInstant,
  formatRule,
  fromLocal,
  hhmmToMinute,
  isoToDay,
  minuteToHhmm,
  parseInstant,
  parseRule,
  type Recurrence,
} from "./index.ts";

describe("days and times as text", () => {
  it("round-trips days and rejects impossible dates", () => {
    const d = daysFromCivil(2026, 10, 15);
    expect(dayToIso(d)).toBe("2026-10-15");
    expect(isoToDay("2026-10-15")).toBe(d);
    expect(isoToDay("2026-10-15T09:00:00Z")).toBe(d);
    expect(isoToDay("2026-02-30")).toBeNull();
    expect(isoToDay("2026-13-01")).toBeNull();
    expect(isoToDay("15/10/2026")).toBeNull();
    expect(isoToDay(null)).toBeNull();
    expect(isoToDay(20261015)).toBeNull();
  });

  it("reads and writes HH:MM", () => {
    expect(hhmmToMinute("09:30")).toBe(570);
    expect(hhmmToMinute("9:05")).toBe(545);
    expect(hhmmToMinute("24:00")).toBe(1440);
    expect(hhmmToMinute("24:01")).toBeNull();
    expect(hhmmToMinute("12:60")).toBeNull();
    expect(hhmmToMinute("noon")).toBeNull();
    expect(minuteToHhmm(570)).toBe("09:30");
    expect(minuteToHhmm(0)).toBe("00:00");
  });

  it("reads instants with an offset, with Z and as wall-clock time in a zone", () => {
    const tz = "Europe/Madrid";
    const expected = fromLocal(daysFromCivil(2026, 10, 15), 9 * 60, tz); // 07:00Z (CEST)
    expect(parseInstant("2026-10-15T07:00:00Z", tz)).toBe(expected);
    expect(parseInstant("2026-10-15T09:00:00+02:00", "UTC")).toBe(expected);
    expect(parseInstant("2026-10-15T09:00", tz)).toBe(expected);
    expect(parseInstant("2026-10-15 09:00:00", tz)).toBe(expected);
    expect(parseInstant("2026-10-15", tz)).toBeNull();
    expect(parseInstant("2026-10-15T25:00", tz)).toBeNull();
    expect(formatInstant(expected)).toBe("2026-10-15T07:00:00.000Z");
    expect(parseInstant(formatInstant(expected), "UTC")).toBe(expected);
  });
});

describe("repetition rule text", () => {
  const D = (y: number, m: number, d: number) => daysFromCivil(y, m, d);
  const cases: Recurrence[] = [
    { freq: "daily", interval: 1 },
    { freq: "weekly", interval: 1 },
    { freq: "weekly", interval: 2, byWeekday: [1, 3] },
    { freq: "weekly", interval: 1, byWeekday: [6, 0], count: 8 },
    { freq: "monthly", interval: 3, until: D(2027, 1, 31) },
    { freq: "yearly", interval: 1, count: 5, until: D(2030, 6, 1) },
  ];

  it("round-trips every shape", () => {
    for (const r of cases) expect(parseRule(formatRule(r))).toEqual(r);
  });

  it("writes a readable, canonical string", () => {
    expect(formatRule({ freq: "weekly", interval: 1 })).toBe("FREQ=WEEKLY");
    expect(formatRule({ freq: "weekly", interval: 2, byWeekday: [3, 1, 0] })).toBe(
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,SU",
    );
    expect(formatRule({ freq: "daily", interval: 1, count: 3, until: D(2026, 12, 24) })).toBe(
      "FREQ=DAILY;COUNT=3;UNTIL=2026-12-24",
    );
  });

  it("reads RRULE spellings from other tools and rejects what it cannot represent", () => {
    expect(parseRule("RRULE:FREQ=WEEKLY;BYDAY=mo,fr;UNTIL=20261231T000000Z")).toEqual({
      freq: "weekly",
      interval: 1,
      byWeekday: [1, 5],
      until: D(2026, 12, 31),
    });
    expect(parseRule("FREQ=MONTHLY;BYDAY=2TU")).toBeNull();
    expect(parseRule("FREQ=HOURLY")).toBeNull();
    expect(parseRule("INTERVAL=2")).toBeNull();
    expect(parseRule("FREQ=DAILY;INTERVAL=0")).toBeNull();
    expect(parseRule("")).toBeNull();
    expect(parseRule(undefined)).toBeNull();
  });
});
