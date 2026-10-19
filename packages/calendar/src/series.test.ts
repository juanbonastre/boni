import { describe, expect, it } from "vitest";
import {
  addMonths,
  type CalEvent,
  daysFromCivil,
  editSeries,
  extendSeries,
  fromLocal,
  inSeries,
  makeSeries,
  type Recurrence,
  type SeriesContext,
  seriesGroups,
  setSeriesRule,
  toLocal,
  whenStartDay,
} from "./index.ts";

const tz = "Europe/Madrid";
const D = (y: number, m: number, d: number) => daysFromCivil(y, m, d);
const today = D(2026, 10, 16);
let n = 0;
const ctx = (over: Partial<SeriesContext> = {}): SeriesContext => ({
  newId: () => `n${++n}`,
  now: 1_800_000_000_000,
  today,
  ...over,
});

const monday = D(2026, 10, 19);
const base = (over: Partial<CalEvent> = {}): CalEvent => ({
  id: "a0",
  calendarId: "c",
  title: "Clase",
  when: {
    kind: "timed",
    start: fromLocal(monday, 9 * 60, tz),
    end: fromLocal(monday, 10 * 60, tz),
    tz,
  },
  location: "Aula 8",
  description: "",
  props: { room: "A" },
  isTask: true,
  done: true,
  created: 1,
  updated: 1,
  ...over,
});

const weekly: Recurrence = { freq: "weekly", interval: 1 };
const dayOf = (e: CalEvent) => whenStartDay(e.when);
const days = (events: CalEvent[]) => events.map(dayOf);
const minutes = (e: CalEvent) =>
  e.when.kind === "timed" ? toLocal(e.when.start, e.when.tz).minute : -1;

describe("makeSeries", () => {
  it("returns the base note and one copy per occurrence up to twelve months ahead", () => {
    const made = makeSeries(base(), weekly, "s1", ctx());
    expect(made[0]?.id).toBe("a0");
    expect(made[0]?.series).toEqual({ id: "s1", rule: weekly });
    expect(days(made).slice(0, 3)).toEqual([monday, monday + 7, monday + 14]);
    const last = days(made).at(-1) as number;
    expect(last).toBeLessThanOrEqual(addMonths(today, 12));
    expect(last).toBeGreaterThan(addMonths(today, 12) - 7);
    expect(made.every((e) => e.series?.id === "s1")).toBe(true);
    expect(new Set(made.map((e) => e.id)).size).toBe(made.length);
  });

  it("copies the note with the same hours and properties, as an open task", () => {
    const [, second] = makeSeries(base(), weekly, "s1", ctx());
    expect(second).toMatchObject({
      title: "Clase",
      location: "Aula 8",
      props: { room: "A" },
      isTask: true,
      done: false,
    });
    expect(minutes(second as CalEvent)).toBe(9 * 60);
  });

  it("stops at the end of the rule", () => {
    const counted = makeSeries(base(), { ...weekly, count: 4 }, "s", ctx());
    expect(days(counted)).toEqual([monday, monday + 7, monday + 14, monday + 21]);
    const until = makeSeries(base(), { ...weekly, until: monday + 15 }, "s", ctx());
    expect(days(until)).toEqual([monday, monday + 7, monday + 14]);
  });

  it("keeps the wall-clock time across a daylight-saving change", () => {
    const made = makeSeries(base(), weekly, "s", ctx());
    for (const e of made) expect(minutes(e)).toBe(9 * 60);
  });

  it("includes the base even when its day is not one the rule picks", () => {
    const tuesdayOnly: Recurrence = { freq: "weekly", interval: 1, byWeekday: [2], count: 3 };
    const made = makeSeries(base(), tuesdayOnly, "s", ctx());
    expect(days(made)[0]).toBe(monday);
    expect(days(made).slice(1)).toEqual([monday + 1, monday + 8, monday + 15]);
  });
});

describe("extendSeries", () => {
  const series = () => makeSeries(base(), weekly, "s1", ctx({ today: D(2026, 6, 1) }));

  it("adds the notes missing after the last one, as time passes", () => {
    const old = series();
    const more = extendSeries(old, ctx());
    expect(more.length).toBeGreaterThan(0);
    expect(days(more)[0]).toBe((days(old).at(-1) as number) + 7);
    expect(more.every((e) => e.series?.id === "s1" && !e.done)).toBe(true);
    expect(extendSeries([...old, ...more], ctx())).toEqual([]);
  });

  it("never refills a gap in the middle (that note was deleted on purpose)", () => {
    const old = series();
    const hole = old.filter((e) => dayOf(e) !== monday + 14);
    const more = extendSeries(hole, ctx());
    expect(days(more).includes(monday + 14)).toBe(false);
  });

  it("does nothing for finished series, series without a rule, or plain events", () => {
    const counted = makeSeries(base(), { ...weekly, count: 3 }, "s", ctx());
    expect(extendSeries(counted, ctx())).toEqual([]);
    const noRule = counted.map((e) => ({ ...e, series: { id: "s", rule: null } }));
    expect(extendSeries(noRule, ctx())).toEqual([]);
    expect(extendSeries([base()], ctx())).toEqual([]);
  });

  it("respects a count that reaches beyond the horizon", () => {
    const long = makeSeries(
      base(),
      { freq: "weekly", interval: 1, count: 100 },
      "s",
      ctx({ today: D(2026, 10, 16) }),
    );
    expect(long.length).toBeLessThan(100);
    const later = extendSeries(long, ctx({ today: D(2027, 6, 1) }));
    expect(long.length + later.length).toBeLessThanOrEqual(100);
    expect(later.length).toBeGreaterThan(0);
  });
});

describe("editSeries: changes", () => {
  const all = () => makeSeries(base(), { ...weekly, count: 5 }, "s1", ctx());
  const third = (events: CalEvent[]) => events[2] as CalEvent;

  it("this: only that note", () => {
    const events = all();
    const out = editSeries(events, third(events).id, "this", { patch: { title: "Otra" } }, ctx());
    expect(out.map((e) => e.title)).toEqual(["Clase", "Clase", "Otra", "Clase", "Clase"]);
  });

  it("following: it and the later notes; all: every note", () => {
    const events = all();
    const f = editSeries(events, third(events).id, "following", { patch: { title: "X" } }, ctx());
    expect(f.map((e) => e.title)).toEqual(["Clase", "Clase", "X", "X", "X"]);
    const a = editSeries(
      events,
      third(events).id,
      "all",
      { patch: { title: "X", location: "Aula 9" } },
      ctx(),
    );
    expect(a.every((e) => e.title === "X" && e.location === "Aula 9")).toBe(true);
  });

  it("moves the whole scope by the same offset and keeps each note's own day", () => {
    const events = all();
    const t = third(events);
    const moved = {
      kind: "timed" as const,
      tz,
      start: fromLocal(dayOf(t), 11 * 60, tz),
      end: fromLocal(dayOf(t), 12 * 60 + 30, tz),
    };
    const out = editSeries(events, t.id, "all", { patch: { when: moved } }, ctx());
    expect(out.map(minutes)).toEqual([660, 660, 660, 660, 660]);
    expect(days(out)).toEqual(days(events));
    const e = out[0] as CalEvent;
    expect(e.when.kind === "timed" && (e.when.end - e.when.start) / 60000).toBe(90);
  });

  it("a day move shifts every note in scope by the same number of days", () => {
    const events = all();
    const t = third(events);
    const out = editSeries(
      events,
      t.id,
      "following",
      {
        patch: {
          when: {
            ...(t.when as Extract<CalEvent["when"], { kind: "timed" }>),
            start: (t.when as { start: number }).start + 86_400_000,
            end: (t.when as { end: number }).end + 86_400_000,
          },
        },
      },
      ctx(),
    );
    expect(days(out)).toEqual([monday, monday + 7, monday + 15, monday + 22, monday + 29]);
  });

  it("changes only the properties that changed, and done stays on the note itself", () => {
    const events = all().map((e, i) => ({
      ...e,
      done: false,
      ...(i === 3 ? { props: { room: "Z", extra: "x" } } : {}),
    }));
    const t = third(events);
    const out = editSeries(
      events,
      t.id,
      "all",
      { patch: { props: { room: "B" }, done: true } },
      ctx(),
    );
    expect(out.map((e) => e.props.room)).toEqual(["B", "B", "B", "B", "B"]);
    expect(out[3]?.props.extra).toBe("x"); // untouched keys survive
    expect(out.map((e) => e.done)).toEqual([false, false, true, false, false]);
  });
});

describe("editSeries: deletions", () => {
  const all = () =>
    makeSeries(
      base({ done: false }),
      { ...weekly, count: 5 },
      "s1",
      ctx({ today: D(2026, 10, 16) }),
    );

  it("this: removes one note and leaves the series going", () => {
    const events = all();
    const out = editSeries(events, (events[1] as CalEvent).id, "this", { remove: true }, ctx());
    expect(out).toHaveLength(4);
    expect(out.every((e) => e.series?.rule?.until === undefined)).toBe(true);
  });

  it("this on the last note ends the series (it must not come back at the next top-up)", () => {
    const events = all();
    const last = events.at(-1) as CalEvent;
    const out = editSeries(events, last.id, "this", { remove: true }, ctx());
    expect(out).toHaveLength(4);
    expect(out.every((e) => e.series?.rule?.until === monday + 28 - 1)).toBe(true);
    expect(extendSeries(out, ctx({ today: D(2027, 12, 1) }))).toEqual([]);
  });

  it("following: removes it and the later notes and ends the series before it", () => {
    const events = all();
    const out = editSeries(
      events,
      (events[2] as CalEvent).id,
      "following",
      { remove: true },
      ctx(),
    );
    expect(days(out)).toEqual([monday, monday + 7]);
    expect(
      out.every((e) => e.series?.rule?.until === monday + 14 - 1 && e.series.rule.count === null),
    ).toBe(true);
  });

  it("all: removes the notes from today on and keeps the past", () => {
    const events = makeSeries(base({ done: false }), weekly, "s1", ctx({ today: D(2026, 10, 16) }));
    const todayCtx = ctx({ today: monday + 15 }); // two notes lie in the past
    const out = editSeries(events, (events[3] as CalEvent).id, "all", { remove: true }, todayCtx);
    expect(days(out)).toEqual([monday, monday + 7, monday + 14]);
    expect(out.every((e) => e.series?.rule?.until === monday + 21 - 1)).toBe(true);
  });

  it("ignores events that are not in a series, and other series", () => {
    const loose = base({ id: "x" });
    const events = [...all(), loose];
    expect(editSeries(events, "x", "all", { remove: true }, ctx())).toEqual(events);
    const other = makeSeries(base({ id: "b0" }), { ...weekly, count: 2 }, "s2", ctx());
    const mixed = [...all(), ...other];
    const out = editSeries(mixed, (all()[0] as CalEvent).id, "all", { remove: true }, ctx());
    expect(out.filter((e) => e.series?.id === "s2")).toHaveLength(2);
  });
});

describe("setSeriesRule", () => {
  it("starts a series on a plain note", () => {
    const events = [base()];
    const out = setSeriesRule(events, "a0", { ...weekly, count: 3 }, "s9", ctx());
    expect(out).toHaveLength(3);
    expect(out[0]?.series?.id).toBe("s9");
  });

  it("replaces the later notes with the ones of the new rule and keeps the earlier ones", () => {
    const events = makeSeries(base(), { ...weekly, count: 6 }, "s1", ctx());
    const t = events[2] as CalEvent;
    const out = setSeriesRule(
      events,
      t.id,
      { freq: "daily", interval: 1, count: 3 },
      "ignored",
      ctx(),
    );
    expect(days(out)).toEqual([monday, monday + 7, monday + 14, monday + 15, monday + 16]);
    expect(out.filter((e) => e.series?.id === "s1")).toHaveLength(5);
  });

  it("no rule ends the series at that note and makes it a plain event", () => {
    const events = makeSeries(base(), { ...weekly, count: 4 }, "s1", ctx());
    const t = events[1] as CalEvent;
    const out = setSeriesRule(events, t.id, null, "s", ctx());
    expect(days(out)).toEqual([monday, monday + 7]);
    expect(out[1]?.series).toBeUndefined();
    expect(inSeries(out, "a0")).toBe(false);
  });
});

describe("seriesGroups and inSeries", () => {
  it("groups notes by series, earliest first, and asks about scope only for real series", () => {
    const events = makeSeries(base(), { ...weekly, count: 3 }, "s1", ctx());
    const g = seriesGroups([...events].reverse());
    expect(days(g.get("s1") as CalEvent[])).toEqual(days(events));
    expect(inSeries(events, "a0")).toBe(true);
    expect(inSeries([events[0] as CalEvent], "a0")).toBe(false);
    expect(inSeries([base()], "a0")).toBe(false);
  });
});
