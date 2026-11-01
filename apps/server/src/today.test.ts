import { openUserStore } from "@boni/store";
import { afterEach, describe, expect, it } from "vitest";
import { StoreCalendar, taskDoneField } from "./calendarStore.ts";
import { seed } from "./seed.test-util.ts";
import { todayOf } from "./today.ts";

/** Invented notes only: a calendar with something today, something tomorrow, and a task already done. */
const RAW = {
  id: "agenda",
  name: "Agenda",
  folder: "agenda/",
  account: "Agenda",
  color: "#60a5fa",
  columns: [
    { id: "title", name: "Título", type: "text" },
    { id: "date", name: "Fecha", type: "date" },
    { id: "startTime", name: "Hora de inicio", type: "time" },
    { id: "endTime", name: "Hora de fin", type: "time" },
    { id: "completed", name: "Hecha", type: "checkbox" },
  ],
  mapping: {
    title: "title",
    when: { kind: "split", date: "date", startTime: "startTime", endTime: "endTime" },
    task: { column: "completed" },
  },
};
const NOTES: Record<string, string> = {
  "agenda/a.md":
    '---\ntitle: "Clase de ejemplo"\ndate: "2026-10-22"\nstartTime: "10:00"\nendTime: "11:30"\ncompleted: false\n---\n',
  "agenda/b.md": '---\ntitle: "Entregar las notas"\ndate: "2026-10-22"\ncompleted: true\n---\n',
  "agenda/c.md": '---\ntitle: "Día del libro inventado"\ndate: "2026-10-22"\n---\n',
  "agenda/d.md": '---\ntitle: "Tutoría"\ndate: "2026-10-23"\ncompleted: false\n---\n',
};

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

describe("Inicio's «Hoy»", () => {
  it("is what the calendars hold today, in the device's timezone: all day first, by the hour, what is done last", async () => {
    const store = openUserStore(":memory:");
    seed(store, [{ key: "agenda", name: "Agenda", folder: "agenda/", calendar: RAW }], NOTES);
    const cal = new StoreCalendar(store, { write: true, pollMs: 60_000 });
    cleanups.push(() => {
      cal.close();
      store.close();
    });
    // 08:00 in Madrid on the 22nd (06:00 UTC).
    const r = await todayOf(store, cal, {
      tz: "Europe/Madrid",
      now: Date.UTC(2026, 9, 22, 6),
      device: "movil",
    });
    expect(r.day).toBe("2026-10-22");
    expect(r.items.map((x) => [x.title, x.start, x.done])).toEqual([
      ["Día del libro inventado", null, false],
      ["Clase de ejemplo", "10:00", false],
      ["Entregar las notas", null, true],
    ]);
    // A task brings the box that marks it done, so a tap can tick it.
    const done = taskDoneField(store, "t_agenda");
    expect(r.items[1]).toMatchObject({ type: "t_agenda", collection: "Agenda", task: true });
    expect(r.items[1]?.doneField).toBe(done?.id);
    // Late at night in Madrid it is already the 23rd.
    const late = await todayOf(store, cal, {
      tz: "Europe/Madrid",
      now: Date.UTC(2026, 9, 22, 22, 30),
      device: "movil",
    });
    expect(late.items.map((x) => x.title)).toEqual(["Tutoría"]);
  });
});
