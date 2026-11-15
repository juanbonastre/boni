// The server's `Dates` for «Fecha» (dates.ts): civil days stay civil days, instants move by Juan's wall clock in his
// zone, and a month or a day is whole only once it is reached again.
import { describe, expect, it } from "vitest";
import { serverDates as d } from "./dates.ts";

const ZONE = "Europe/Madrid";
// 2026-03-28 12:00 in Madrid, the day before the clocks go forward (02:00 → 03:00 on the 29th).
const SATURDAY_NOON = Date.UTC(2026, 2, 28, 11, 0);

describe("serverDates", () => {
  it("a civil day stays a civil day, and a month's end is kept as the last day of a shorter month", () => {
    expect(d.add("2026-01-31", 1, "months", ZONE)).toBe("2026-02-28");
    expect(d.add("2026-02-28", 1, "years", ZONE)).toBe("2027-02-28");
    expect(d.add("2026-11-15", -3, "weeks", ZONE)).toBe("2026-10-25");
    expect(d.add("2026-11-15", 26, "hours", ZONE)).toBe("2026-11-16");
  });

  it("an instant moves by the wall clock: a day across the change of hour is 23 hours, 24 hours is not a day", () => {
    expect(d.add(SATURDAY_NOON, 1, "days", ZONE)).toBe(Date.UTC(2026, 2, 29, 10, 0));
    expect(d.add(SATURDAY_NOON, 24, "hours", ZONE)).toBe(Date.UTC(2026, 2, 29, 11, 0));
    expect(d.add("2026-03-28T11:00:00.000Z", 1, "days", ZONE)).toBe(Date.UTC(2026, 2, 29, 10, 0));
    expect(d.day(Date.UTC(2026, 10, 15, 23, 30), ZONE)).toBe("2026-11-16");
  });

  it("a month or a day is whole only once it is reached again, going forward or back", () => {
    expect(d.diff("2026-01-31", "2026-02-28", "months", ZONE)).toBe(0);
    expect(d.diff("2026-01-15", "2026-03-15", "months", ZONE)).toBe(2);
    expect(d.diff("2026-03-15", "2026-01-16", "months", ZONE)).toBe(-1);
    expect(d.diff("2024-02-29", "2026-02-28", "years", ZONE)).toBe(1);
    expect(d.diff(SATURDAY_NOON, Date.UTC(2026, 2, 29, 9, 59), "days", ZONE)).toBe(0);
    expect(d.diff(SATURDAY_NOON, Date.UTC(2026, 2, 29, 10, 0), "days", ZONE)).toBe(1);
    expect(d.diff("2026-11-01", "2026-11-15", "weeks", ZONE)).toBe(2);
    expect(d.diff(SATURDAY_NOON, Date.UTC(2026, 2, 28, 13, 30), "minutes", ZONE)).toBe(150);
  });

  it("a week starts on Monday, and the parts are read on the wall clock", () => {
    expect(d.startOf("2026-11-15", "week", ZONE)).toBe("2026-11-09");
    expect(d.startOf("2026-11-15", "month", ZONE)).toBe("2026-11-01");
    expect(d.startOf("2026-11-15", "year", ZONE)).toBe("2026-01-01");
    expect(d.startOf(SATURDAY_NOON, "day", ZONE)).toBe(Date.UTC(2026, 2, 27, 23, 0));
    expect(d.part(SATURDAY_NOON, "hour", ZONE)).toBe(12);
    expect(d.part("2026-11-15", "week", ZONE)).toBe(46);
    expect(d.part("2026-11-15", "month", ZONE)).toBe(11);
  });

  it("a civil day is shown as that day wherever Juan is, and anything that is not a date throws", () => {
    expect(d.format("2026-11-15", "iso", ZONE, "es")).toBe("2026-11-15");
    expect(d.format("2026-11-15", "dateLong", "Pacific/Honolulu", "es")).toBe(
      "15 de noviembre de 2026",
    );
    expect(d.format(SATURDAY_NOON, "time", ZONE, "es")).toBe("12:00");
    expect(() => d.add("mañana", 1, "days", ZONE)).toThrow();
    expect(() => d.part(true, "year", ZONE)).toThrow();
  });
});
