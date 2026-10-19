import { describe, expect, it } from "vitest";
import { parseIcal } from "./ical.ts";
import { expandAll } from "./recurrence.ts";
import { daysFromCivil, fromLocal, toLocal } from "./time.ts";

const TZ = "Europe/Madrid";
const day = (y: number, m: number, d: number) => daysFromCivil(y, m, d);

/** An invented feed shaped like Google Calendar's export. */
const FEED = [
  "BEGIN:VCALENDAR",
  "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "VERSION:2.0",
  "X-WR-CALNAME:Calendario de ejemplo",
  "X-WR-TIMEZONE:Europe/Madrid",
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Madrid",
  "BEGIN:DAYLIGHT",
  "DTSTART:19700329T020000",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
  // an all-day holiday
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261012",
  "DTEND;VALUE=DATE:20261013",
  "UID:fiesta-1@example.com",
  "SUMMARY:Fiesta de ejemplo",
  "END:VEVENT",
  // a weekly class with an exception, a changed occurrence and a cancelled one
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Madrid:20261005T093000",
  "DTEND;TZID=Europe/Madrid:20261005T113000",
  "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T225959Z",
  "EXDATE;TZID=Europe/Madrid:20261007T093000",
  "UID:clase-1@example.com",
  "SUMMARY:Clase de ejemplo\\, grupo A",
  "LOCATION:Aula 1",
  "DESCRIPTION:Primera línea\\nSegunda línea",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "DESCRIPTION:Recordatorio",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Madrid:20261014T120000",
  "DTEND;TZID=Europe/Madrid:20261014T140000",
  "RECURRENCE-ID;TZID=Europe/Madrid:20261014T093000",
  "UID:clase-1@example.com",
  "SUMMARY:Clase de ejemplo (cambiada)",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Madrid:20261019T093000",
  "DTEND;TZID=Europe/Madrid:20261019T113000",
  "RECURRENCE-ID;TZID=Europe/Madrid:20261019T093000",
  "UID:clase-1@example.com",
  "STATUS:CANCELLED",
  "SUMMARY:Clase de ejemplo",
  "END:VEVENT",
  // UTC times and a folded line
  "BEGIN:VEVENT",
  "DTSTART:20261020T160000Z",
  "DURATION:PT45M",
  "UID:reunion-1@example.com",
  "SUMMARY:Reunión con un título muy largo que Google parte en dos líneas al exportarlo al",
  "  formato iCal",
  "END:VEVENT",
  // cancelled on its own, and a rule we cannot repeat
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261101",
  "UID:cancelada@example.com",
  "STATUS:CANCELLED",
  "SUMMARY:Cancelada",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Madrid:20261013T180000",
  "DTEND;TZID=Europe/Madrid:20261013T190000",
  "RRULE:FREQ=MONTHLY;BYDAY=2TU",
  "UID:mensual@example.com",
  "SUMMARY:Segundo martes",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("parseIcal", () => {
  const r = parseIcal(FEED, { calendarId: "ejemplo", defaultTz: "UTC" });
  const byTitle = (t: string) => r.events.find((e) => e.title === t);

  it("reads the calendar's name and every event, skipping cancelled ones", () => {
    expect(r.name).toBe("Calendario de ejemplo");
    expect(r.events.map((e) => e.title).sort()).toEqual([
      "Clase de ejemplo (cambiada)",
      "Clase de ejemplo, grupo A",
      "Fiesta de ejemplo",
      "Reunión con un título muy largo que Google parte en dos líneas al exportarlo al formato iCal",
      "Segundo martes",
    ]);
    expect(r.events.every((e) => e.calendarId === "ejemplo" && !e.isTask)).toBe(true);
    expect(byTitle("Fiesta de ejemplo")?.id).toBe("ext:ejemplo:fiesta-1@example.com");
  });

  it("keeps all-day events as civil days (DTEND is exclusive)", () => {
    expect(byTitle("Fiesta de ejemplo")?.when).toEqual({
      kind: "allday",
      startDay: day(2026, 10, 12),
      endDay: day(2026, 10, 12),
    });
  });

  it("reads local times in their zone, text escapes and nested alarms", () => {
    const c = byTitle("Clase de ejemplo, grupo A");
    expect(c?.when).toEqual({
      kind: "timed",
      start: fromLocal(day(2026, 10, 5), 9 * 60 + 30, TZ),
      end: fromLocal(day(2026, 10, 5), 11 * 60 + 30, TZ),
      tz: TZ,
    });
    expect(c?.location).toBe("Aula 1");
    expect(c?.description).toBe("Primera línea\nSegunda línea");
  });

  it("repeats a series, without its exceptions, changed and cancelled occurrences", () => {
    const c = byTitle("Clase de ejemplo, grupo A");
    expect(c?.recurrence).toEqual({
      freq: "weekly",
      interval: 1,
      byWeekday: [1, 3],
      until: day(2026, 12, 31),
    });
    expect([...(c?.exdates ?? [])].sort()).toEqual(
      [day(2026, 10, 7), day(2026, 10, 14), day(2026, 10, 19)].sort(),
    );
    const days = expandAll(r.events, day(2026, 10, 5), day(2026, 10, 21))
      .filter((e) => e.seriesId === c?.id)
      .map((e) => toLocal((e.when as { start: number }).start, TZ).day);
    expect(days).toEqual([day(2026, 10, 5), day(2026, 10, 12), day(2026, 10, 21)]);
    const moved = byTitle("Clase de ejemplo (cambiada)");
    expect(moved?.id).toBe(`ext:ejemplo:clase-1@example.com:${day(2026, 10, 14)}`);
    expect(moved?.recurrence).toBeUndefined();
  });

  it("reads UTC times and durations, shown in the calendar's zone", () => {
    const m = r.events.find((e) => e.id === "ext:ejemplo:reunion-1@example.com");
    expect(m?.when).toEqual({
      kind: "timed",
      start: Date.UTC(2026, 9, 20, 16, 0),
      end: Date.UTC(2026, 9, 20, 16, 45),
      tz: TZ,
    });
  });

  it("shows a rule it cannot repeat once, and says so", () => {
    expect(r.unsupported).toBe(1);
    expect(byTitle("Segundo martes")?.recurrence).toBeUndefined();
  });

  it("gives the same ids on every read, and survives an empty or broken feed", () => {
    const again = parseIcal(FEED, { calendarId: "ejemplo", defaultTz: "UTC" });
    expect(again.events.map((e) => e.id)).toEqual(r.events.map((e) => e.id));
    expect(parseIcal("", { calendarId: "x", defaultTz: TZ })).toEqual({
      name: null,
      events: [],
      unsupported: 0,
    });
    expect(
      parseIcal("<html>not a calendar</html>", { calendarId: "x", defaultTz: TZ }).events,
    ).toEqual([]);
  });
});
