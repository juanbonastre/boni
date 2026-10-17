import {
  type CalEvent,
  daysFromCivil,
  fromLocal,
  parseReminders,
  type ReminderDefaults,
} from "@boni-calendar/core";
import { describe, expect, it } from "vitest";
import { setLocale } from "./i18n.ts";
import { noticesFor } from "./notifications.ts";

const TZ = "Europe/Madrid";
const DAY = daysFromCivil(2026, 10, 19);
const at = (day: number, h: number, m = 0) => fromLocal(day, h * 60 + m, TZ);

const ev = (id: string, patch: Partial<CalEvent>): CalEvent => ({
  id,
  calendarId: "docencia",
  title: id,
  when: { kind: "timed", start: at(DAY, 10), end: at(DAY, 11), tz: TZ },
  location: "",
  description: "",
  props: {},
  isTask: false,
  done: false,
  created: 0,
  updated: 0,
  ...patch,
});

describe("noticesFor", () => {
  const d: ReminderDefaults = {
    timed: parseReminders("10m") ?? [],
    allDay: parseReminders("1d@18:00") ?? [],
  };
  it("words each reminder of the next hours: day, times and place", () => {
    setLocale("es");
    const list = noticesFor(
      [
        ev("Clase de ejemplo", { location: "Aula 1" }),
        ev("Mañana", {
          when: { kind: "timed", start: at(DAY + 1, 9), end: at(DAY + 1, 9, 30), tz: TZ },
        }),
        ev("Fiesta", { when: { kind: "allday", startDay: DAY + 1, endDay: DAY + 1 } }),
        ev("", {}), // untitled (a draft): never reminds
      ],
      () => d,
      { now: at(DAY, 8), tz: TZ, h24: true, locale: "es" },
    );
    expect(list.map((n) => [n.title, n.body, n.at])).toEqual([
      ["Clase de ejemplo", "Hoy, 10:00–11:00 · Aula 1", at(DAY, 9, 50)],
      ["Fiesta", "Mañana, todo el día", at(DAY, 18)],
      ["Mañana", "Mañana, 09:00–09:30", at(DAY + 1, 8, 50)],
    ]);
  });
});
