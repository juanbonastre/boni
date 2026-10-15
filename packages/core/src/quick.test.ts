import { describe, expect, it } from "vitest";
import { daysFromCivil, parseQuickEvent } from "./index.ts";

const today = daysFromCivil(2025, 9, 17); // Wednesday
const ctx = {
  today,
  defaultDuration: 60,
  calendars: [
    { id: "teaching", name: "Docencia" },
    { id: "sport", name: "Deporte" },
  ],
};

describe("parseQuickEvent", () => {
  it("reads title, tomorrow, range and calendar", () => {
    const q = parseQuickEvent("clase FUP mañana 10-12 #docencia", ctx);
    expect(q).toMatchObject({
      title: "clase FUP",
      day: today + 1,
      start: 600,
      end: 720,
      calendarId: "teaching",
    });
  });
  it("reads minutes, 'de X a Y' and weekdays", () => {
    const q = parseQuickEvent("reunion viernes de 9:30 a 10:45", ctx);
    expect(q).toMatchObject({ title: "reunion", day: today + 2, start: 570, end: 645 });
  });
  it("keeps bare numbers in the title", () => {
    const q = parseQuickEvent("estudiar tema 3", ctx);
    expect(q).toMatchObject({ title: "estudiar tema 3", start: null, day: today });
  });
  it("single times get the default duration", () => {
    expect(parseQuickEvent("dentista a las 17:30", ctx)).toMatchObject({
      title: "dentista",
      start: 1050,
      end: 1110,
    });
    expect(parseQuickEvent("call at 5pm tomorrow", ctx)).toMatchObject({
      title: "call",
      start: 1020,
      end: 1080,
      day: today + 1,
    });
  });
  it("reads dates and all-day", () => {
    expect(parseQuickEvent("viaje 3/11 todo el dia", ctx)).toMatchObject({
      title: "viaje",
      allDay: true,
      day: daysFromCivil(2025, 11, 3),
    });
    expect(parseQuickEvent("cumple 24 de diciembre", ctx).day).toBe(daysFromCivil(2025, 12, 24));
  });
  it("reports whether a date was found", () => {
    expect(parseQuickEvent("viernes", ctx).hasDate).toBe(true);
    expect(parseQuickEvent("estudiar", ctx).hasDate).toBe(false);
  });
  it("weekday means the next one, strictly after today", () => {
    expect(parseQuickEvent("correr miercoles", ctx).day).toBe(today + 7);
  });
  it("matches a calendar by prefix and ignores unknown ones", () => {
    expect(parseQuickEvent("nadar #dep", ctx).calendarId).toBe("sport");
    expect(parseQuickEvent("nadar #zzz", ctx).calendarId).toBeNull();
  });
});
