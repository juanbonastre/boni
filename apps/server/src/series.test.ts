import { systemTimeZone, todayIn } from "@boni/calendar";
import { openUserStore, type UserStore } from "@boni/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StoreCalendar } from "./calendarStore.ts";
import { calendarDef, seed } from "./seed.test-util.ts";

/** The server keeps open-ended series going (phase 5 follow-up), so devices in server mode need not. */
let store: UserStore;
const iso = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
const weekly = (day: string) =>
  `---\ntitle: "Revisión semanal"\ndate: "${day}"\nstartTime: "09:00"\nendTime: "09:30"\nseries: "s-prueba"\nseries_rule: "FREQ=WEEKLY"\ncompleted:\n---\n`;
const entries = () =>
  store.list("t_docencia").filter((s) => s.entity.values.f_title === "Revisión semanal");

beforeAll(() => {
  store = openUserStore(":memory:");
  const today = todayIn(systemTimeZone());
  seed(
    store,
    [
      {
        key: "docencia",
        name: "Docencia",
        folder: "agenda/docencia/",
        calendar: calendarDef("docencia", "Docencia", "agenda/docencia"),
      },
    ],
    Object.fromEntries(
      [today - 14, today - 7].map((d) => [
        `agenda/docencia/${iso(d)} Revisión semanal.md`,
        weekly(iso(d)),
      ]),
    ),
  );
});

afterAll(() => store.close());

describe("series on the server", () => {
  it("get the entries they are missing, about a year ahead, once", async () => {
    const cal = new StoreCalendar(store, { write: true, pollMs: 60_000 });
    try {
      expect(await cal.topUpSeries()).toBeGreaterThan(50);
      const n = entries().length;
      expect(n).toBeGreaterThan(50);
      expect(await cal.topUpSeries()).toBe(0); // nothing more to do
      expect(entries().length).toBe(n);
    } finally {
      cal.close();
    }
  });

  it("a read-only server never writes", async () => {
    const ro = new StoreCalendar(store, { pollMs: 60_000 });
    expect(await ro.topUpSeries()).toBe(0);
    ro.close();
  });
});
