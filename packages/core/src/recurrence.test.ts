import { describe, expect, it } from "vitest";
import {
  type CalEvent,
  daysFromCivil,
  editOccurrence,
  expandAll,
  fromLocal,
  occurrenceDays,
  occurrenceId,
  parseOccurrenceId,
  type Recurrence,
  resolveOccurrence,
  toLocal,
  weekday,
} from "./index.ts";

const tz = "Europe/Madrid";
const D = (y: number, m: number, d: number) => daysFromCivil(y, m, d);

function ev(
  id: string,
  day: number,
  from: number,
  to: number,
  r?: Recurrence,
  extra: Partial<CalEvent> = {},
): CalEvent {
  return {
    id,
    calendarId: "c",
    title: id,
    when: { kind: "timed", start: fromLocal(day, from, tz), end: fromLocal(day, to, tz), tz },
    location: "",
    description: "",
    props: {},
    isTask: false,
    done: false,
    created: 0,
    updated: 0,
    recurrence: r ?? null,
    ...extra,
  };
}
const ctx = () => {
  let n = 0;
  return { newId: () => `new${++n}`, now: 99 };
};
const days = (e: CalEvent, a: number, b: number) => occurrenceDays(e, a, b);

describe("occurrence ids", () => {
  it("round trips", () => {
    expect(parseOccurrenceId(occurrenceId("ev-1", 20000))).toEqual({
      seriesId: "ev-1",
      day: 20000,
    });
    expect(parseOccurrenceId("plain")).toBeNull();
  });
});

describe("occurrenceDays", () => {
  const mon = D(2025, 9, 15);
  it("daily with interval", () => {
    const e = ev("a", mon, 600, 660, { freq: "daily", interval: 3 });
    expect(days(e, mon, mon + 9)).toEqual([mon, mon + 3, mon + 6, mon + 9]);
  });
  it("weekly on several weekdays, every 2 weeks", () => {
    const e = ev("a", mon, 600, 660, { freq: "weekly", interval: 2, byWeekday: [1, 3] });
    expect(days(e, mon, mon + 28)).toEqual([mon, mon + 2, mon + 14, mon + 16, mon + 28]);
  });
  it("weekly defaults to the weekday of the start", () => {
    const e = ev("a", mon + 2, 600, 660, { freq: "weekly", interval: 1 });
    const ds = days(e, mon, mon + 21);
    expect(ds).toEqual([mon + 2, mon + 9, mon + 16]);
    expect(ds.every((d) => weekday(d) === 3)).toBe(true);
  });
  it("monthly clamps to the end of short months", () => {
    const e = ev("a", D(2025, 1, 31), 600, 660, { freq: "monthly", interval: 1 });
    expect(days(e, D(2025, 1, 1), D(2025, 4, 30))).toEqual([
      D(2025, 1, 31),
      D(2025, 2, 28),
      D(2025, 3, 31),
      D(2025, 4, 30),
    ]);
  });
  it("yearly handles 29 February", () => {
    const e = ev("a", D(2024, 2, 29), 600, 660, { freq: "yearly", interval: 1 });
    expect(days(e, D(2024, 1, 1), D(2026, 12, 31))).toEqual([
      D(2024, 2, 29),
      D(2025, 2, 28),
      D(2026, 2, 28),
    ]);
  });
  it("stops at until and count; count includes deleted occurrences", () => {
    const u = ev("u", mon, 600, 660, { freq: "daily", interval: 1, until: mon + 2 });
    expect(days(u, mon, mon + 30)).toHaveLength(3);
    const c = ev(
      "c",
      mon,
      600,
      660,
      { freq: "daily", interval: 1, count: 4 },
      { exdates: [mon + 1] },
    );
    expect(days(c, mon, mon + 30)).toEqual([mon, mon + 2, mon + 3]);
  });
  it("includes an occurrence that started before the range but still overlaps it", () => {
    const e = ev("a", mon, 1320, 1320 + 300, { freq: "daily", interval: 1 }); // 22:00 -> 03:00 next day
    expect(days(e, mon + 1, mon + 1)).toEqual([mon, mon + 1]);
  });
});

describe("expandAll", () => {
  it("keeps the wall-clock hour across DST and leaves plain events alone", () => {
    const start = D(2025, 3, 28);
    const master = ev("m", start, 600, 660, { freq: "daily", interval: 1 });
    const plain = ev("p", start, 100, 160);
    const out = expandAll([master, plain], start, start + 5);
    expect(out.filter((e) => e.seriesId === "m")).toHaveLength(6);
    for (const o of out.filter((e) => e.seriesId === "m")) {
      if (o.when.kind !== "timed") throw new Error("timed");
      expect(toLocal(o.when.start, tz).minute).toBe(600);
    }
    expect(out.find((e) => e.id === "p")).toBe(plain);
  });
  it("reuses occurrence objects when given a cache", () => {
    const start = D(2025, 9, 15);
    const master = ev("m", start, 600, 660, { freq: "daily", interval: 1 });
    const cache = new WeakMap();
    const a = expandAll([master], start, start + 3, cache);
    const b = expandAll([master], start + 1, start + 5, cache);
    expect(b.find((e) => e.occurrenceDay === start + 2)).toBe(
      a.find((e) => e.occurrenceDay === start + 2),
    );
  });
  it("resolveOccurrence builds one occurrence on demand", () => {
    const start = D(2025, 9, 15);
    const master = ev("m", start, 600, 660, { freq: "weekly", interval: 1 });
    const occ = resolveOccurrence([master], occurrenceId("m", start + 7));
    expect(occ?.occurrenceDay).toBe(start + 7);
    expect(resolveOccurrence([master], occurrenceId("m", start + 8))).toBeNull();
  });
});

describe("editOccurrence", () => {
  const mon = D(2025, 9, 15);
  const weekly = (extra: Partial<CalEvent> = {}) =>
    ev("m", mon, 600, 660, { freq: "weekly", interval: 1 }, extra);

  it("all: patches the master and shifts it by the dragged delta", () => {
    const m = weekly();
    const occ = occurrenceId("m", mon + 7);
    const out = editOccurrence(
      [m],
      occ,
      "all",
      {
        patch: {
          when: {
            kind: "timed",
            start: fromLocal(mon + 8, 720, tz),
            end: fromLocal(mon + 8, 780, tz),
            tz,
          },
        },
      },
      ctx(),
    );
    const master = out.find((e) => e.id === "m");
    if (master?.when.kind !== "timed") throw new Error("timed");
    expect(toLocal(master.when.start, tz)).toEqual({ day: mon + 1, minute: 720 }); // Monday -> Tuesday, 12:00
    expect(master.recurrence?.freq).toBe("weekly");
    expect(days(master, mon, mon + 14).every((d) => weekday(d) === 2)).toBe(true);
  });

  it("this: removes the day from the series and creates a plain event", () => {
    const out = editOccurrence(
      [weekly()],
      occurrenceId("m", mon + 7),
      "this",
      { patch: { title: "Solo hoy" } },
      ctx(),
    );
    expect(out).toHaveLength(2);
    const master = out.find((e) => e.id === "m");
    expect(master?.exdates).toEqual([mon + 7]);
    const plain = out.find((e) => e.id === "new1");
    expect(plain).toMatchObject({ title: "Solo hoy", recurrence: null });
    expect(plain?.seriesId).toBeUndefined();
    expect(days(master as CalEvent, mon, mon + 21)).toEqual([mon, mon + 14, mon + 21]);
  });

  it("this + remove just hides the day", () => {
    const out = editOccurrence(
      [weekly()],
      occurrenceId("m", mon + 7),
      "this",
      { remove: true },
      ctx(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.exdates).toEqual([mon + 7]);
  });

  it("following: cuts the series and starts a new one with the change", () => {
    const out = editOccurrence(
      [weekly()],
      occurrenceId("m", mon + 14),
      "following",
      { patch: { title: "Nuevo" } },
      ctx(),
    );
    const head = out.find((e) => e.id === "m");
    const tail = out.find((e) => e.id === "new1");
    expect(head?.recurrence?.until).toBe(mon + 13);
    expect(tail?.title).toBe("Nuevo");
    expect(days(head as CalEvent, mon, mon + 60)).toEqual([mon, mon + 7]);
    expect(days(tail as CalEvent, mon, mon + 28)).toEqual([mon + 14, mon + 21, mon + 28]);
  });

  it("following keeps the remaining count", () => {
    const m = ev("m", mon, 600, 660, { freq: "weekly", interval: 1, count: 5 });
    const out = editOccurrence(
      [m],
      occurrenceId("m", mon + 14),
      "following",
      { patch: { title: "x" } },
      ctx(),
    );
    const tail = out.find((e) => e.id === "new1");
    expect(tail?.recurrence?.count).toBe(3); // occurrences 3, 4 and 5
    expect(days(out.find((e) => e.id === "m") as CalEvent, mon, mon + 90)).toHaveLength(2);
  });

  it("following + remove ends the series; on the first occurrence it removes everything", () => {
    const cut = editOccurrence(
      [weekly()],
      occurrenceId("m", mon + 14),
      "following",
      { remove: true },
      ctx(),
    );
    expect(cut).toHaveLength(1);
    expect(days(cut[0] as CalEvent, mon, mon + 60)).toEqual([mon, mon + 7]);
    expect(
      editOccurrence([weekly()], occurrenceId("m", mon), "following", { remove: true }, ctx()),
    ).toHaveLength(0);
  });

  it("plain events are patched or removed directly", () => {
    const p = ev("p", mon, 100, 160);
    expect(editOccurrence([p], "p", "all", { patch: { title: "t" } }, ctx())[0]?.title).toBe("t");
    expect(editOccurrence([p], "p", "all", { remove: true }, ctx())).toHaveLength(0);
  });
});
