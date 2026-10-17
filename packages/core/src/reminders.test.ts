import { describe, expect, it } from "vitest";
import {
  type CalEvent,
  type Collection,
  type CollectionDef,
  daysFromCivil,
  defsToModel,
  eventToRow,
  formatReminderDefaults,
  formatReminders,
  fromLocal,
  makeModel,
  parseCollectionDef,
  parseReminders,
  type ReminderDefaults,
  rowToEvent,
  upcomingAlerts,
} from "./index.ts";

const TZ = "Europe/Madrid";
const D = (y: number, m: number, d: number) => daysFromCivil(y, m, d);
const at = (day: number, h: number, m = 0) => fromLocal(day, h * 60 + m, TZ);
const DAY = D(2026, 10, 19);

function ev(id: string, patch: Partial<CalEvent> = {}): CalEvent {
  return {
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
  };
}

describe("reminders as text", () => {
  it("reads minutes, hours, days and all-day times, and writes them back the same way", () => {
    expect(parseReminders("10m, 1h,2d")).toEqual([
      { kind: "before", minutes: 10 },
      { kind: "before", minutes: 60 },
      { kind: "before", minutes: 2880 },
    ]);
    expect(parseReminders("0d@09:00, 1d@18:30")).toEqual([
      { kind: "day", days: 0, at: 540 },
      { kind: "day", days: 1, at: 1110 },
    ]);
    expect(parseReminders("none")).toEqual([]);
    expect(parseReminders("")).toBeNull();
    expect(parseReminders(null)).toBeNull();
    expect(parseReminders("mañana, 99d")).toBeNull(); // nothing usable: follow the calendar
    expect(formatReminders(parseReminders("1h, 10m, 10m, 0m") ?? [])).toBe("0m, 10m, 1h");
    expect(formatReminders([])).toBe("none");
  });
});

describe("upcoming alerts", () => {
  const defaults: Record<string, ReminderDefaults> = {
    docencia: {
      timed: parseReminders("10m") ?? [],
      allDay: parseReminders("1d@18:00") ?? [],
    },
  };
  const of = (id: string) => defaults[id];

  it("uses the calendar's reminders, the event's own instead, and none for a done task", () => {
    const list = [
      ev("clase"),
      ev("tutoria", { reminders: parseReminders("1h, 0m") }),
      ev("silencio", { reminders: [] }),
      ev("tarea", { isTask: true, done: true }),
      ev("otro", { calendarId: "planes" }), // a calendar without reminders
    ];
    const alerts = upcomingAlerts(list, of, at(DAY, 0), at(DAY + 1, 0), TZ);
    expect(alerts.map((a) => [a.eventId, a.at])).toEqual([
      ["tutoria", at(DAY, 9)],
      ["clase", at(DAY, 9, 50)],
      ["tutoria", at(DAY, 10)],
    ]);
    expect(alerts[1]?.id).toBe(`clase@${at(DAY, 9, 50)}`);
  });

  it("reminds all-day events at a time of day in the app's timezone, and only inside the window", () => {
    const fiesta = ev("fiesta", { when: { kind: "allday", startDay: DAY, endDay: DAY } });
    const alerts = upcomingAlerts([fiesta], of, at(DAY - 1, 0), at(DAY, 0), TZ);
    expect(alerts.map((a) => a.at)).toEqual([at(DAY - 1, 18)]);
    expect(alerts[0]?.allDay).toBe(true);
    expect(upcomingAlerts([fiesta], of, at(DAY - 1, 18, 1), at(DAY + 2, 0), TZ)).toEqual([]);
  });
});

describe("reminders in the vault", () => {
  const columns: Collection["columns"] = [
    { id: "title", name: "Título", type: "text" },
    { id: "date", name: "Fecha", type: "date" },
    { id: "startTime", name: "Inicio", type: "time" },
    { id: "endTime", name: "Fin", type: "time" },
    { id: "avisos", name: "Avisos", type: "text" },
  ];
  const def = parseCollectionDef({
    id: "docencia",
    name: "Docencia",
    folder: "agenda/docencia",
    account: "Agenda",
    color: "#60a5fa",
    columns,
    mapping: {
      title: "title",
      when: { kind: "split", date: "date", startTime: "startTime", endTime: "endTime" },
      reminders: "avisos",
    },
    reminders: { timed: "10m", allDay: "0d@09:00" },
  });

  it("a definition carries the calendar's reminders and the column of an event's own", () => {
    expect(def.ok).toBe(true);
    const d = (def as { def: CollectionDef }).def;
    expect(formatReminderDefaults(d.reminders as ReminderDefaults)).toEqual({
      timed: "10m",
      allDay: "0d@09:00",
    });
    const m = defsToModel([d], { readOnly: false });
    expect(m.views[0]?.reminders?.timed).toEqual([{ kind: "before", minutes: 10 }]);
  });

  it("an event's own reminders round-trip through its note, and empty means the calendar's", () => {
    const d = (def as { def: CollectionDef }).def;
    const { collections, views } = defsToModel([d], { readOnly: false });
    const model = makeModel(collections, views, { defaultTz: TZ });
    const row = {
      id: "agenda/docencia/x.md",
      collectionId: "docencia",
      values: {
        title: "Clase",
        date: "2026-10-19",
        startTime: "10:00",
        endTime: "11:00",
        avisos: "1h",
      },
      created: 0,
      updated: 0,
    };
    const e = rowToEvent(model, row) as CalEvent;
    expect(e.reminders).toEqual([{ kind: "before", minutes: 60 }]);
    expect(e.props.avisos).toBeUndefined();
    expect(eventToRow(model, row, { ...e, reminders: [] }).values.avisos).toBe("none");
    expect(eventToRow(model, row, { ...e, reminders: null }).values.avisos).toBeNull();
    const plain = rowToEvent(model, { ...row, values: { ...row.values, avisos: null } });
    expect(plain?.reminders).toBeUndefined();
  });
});
