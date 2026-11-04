/**
 * The events of an account's external calendars by day, for the inbox's cards (task 51, phase A): what the day
 * already holds besides the user's own records, so a proposal that is already there says so and offers «Enlazar»
 * (task 50), an overlap is marked, and a task's free hour counts them. Read from the server's copy of each feed
 * (`feeds.ts`), parsed once per download and expanded only for the days asked; a calendar not downloaded yet is
 * asked for in the background and counts the next time.
 */
import {
  type CalEvent,
  civilFromDays,
  expandAll,
  MS_DAY,
  parseIcal,
  toLocal,
} from "@boni/calendar";
import type { Feeds } from "./feeds.ts";

/** An external calendar as the account keeps it (account.ts): what the cards need of it. */
export interface ExternalRef {
  id: string;
  name: string;
  url: string;
}

/** An entry of a day from an external calendar: the card's item, plus whose it is and its event's id (to link). */
export interface ExternalItem {
  title: string;
  start: string | null;
  end: string | null;
  /** The event's id in the calendar app (`ext:<calendar>:<uid>`, `~<day>` for one occurrence). */
  external: string;
  /** The external calendar's name. */
  calendar: string;
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A civil day (days since the epoch) from "YYYY-MM-DD", or null. */
export function dayOf(iso: string): number | null {
  const m = DAY_RE.exec(iso);
  if (!m) return null;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_DAY);
}
const hhmm = (minute: number) => {
  const m = Math.max(0, Math.min(1439, Math.round(minute)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const isoOf = (day: number) => {
  const { y, m, d } = civilFromDays(day);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

/** An event's item on `day` (its start day; an all-day one on each of its days), or null when it is not that day's. */
export function itemOn(
  e: CalEvent,
  day: number,
  tz: string,
  calendar: string,
): ExternalItem | null {
  if (e.when.kind === "allday") {
    if (day < e.when.startDay || day >= Math.max(e.when.endDay, e.when.startDay + 1)) return null;
    return { title: e.title, start: null, end: null, external: e.id, calendar };
  }
  const s = toLocal(e.when.start, e.when.tz || tz);
  if (s.day !== day) return null;
  const en = toLocal(e.when.end, e.when.tz || tz);
  return {
    title: e.title,
    start: hhmm(s.minute),
    end: en.day === day ? hhmm(en.minute) : "23:59",
    external: e.id,
    calendar,
  };
}

export class ExternalItems {
  /** Each calendar's events as last parsed, by the copy's time: parsed again only after a new download. */
  private parsed = new Map<string, { at: number; events: CalEvent[] }>();
  private readonly feeds: Feeds;
  private readonly tz: string;

  // No parameter properties: the server runs with Node's type stripping (write.test.ts).
  constructor(feeds: Feeds, tz: string) {
    this.feeds = feeds;
    this.tz = tz;
  }

  /** The items of `days` ("YYYY-MM-DD") from the account's calendars, in time order within each day. */
  items(
    account: number,
    calendars: readonly ExternalRef[],
    days: readonly string[],
  ): ExternalItem[] {
    const wanted = days.map(dayOf).filter((d): d is number => d !== null);
    if (!wanted.length || !calendars.length) return [];
    const from = Math.min(...wanted);
    const to = Math.max(...wanted);
    const out: ExternalItem[] = [];
    for (const c of calendars) {
      const events = this.eventsOf(account, c);
      if (!events) continue;
      for (const e of expandAll(events, from - 1, to + 1))
        for (const day of wanted) {
          const it = itemOn(e, day, this.tz, c.name);
          if (it) out.push(it);
        }
    }
    return out.sort(
      (a, b) => (a.start ?? "").localeCompare(b.start ?? "") || a.title.localeCompare(b.title),
    );
  }

  /** The calendar's events from the copy the server has; none yet: asked for now, for the next time. */
  private eventsOf(account: number, c: ExternalRef): CalEvent[] | null {
    const key = `${account}:${c.id}`;
    const copy = this.feeds.peek(account, c.id, c.url);
    if (!copy) {
      this.feeds.get(account, c.id, c.url).catch(() => {});
      return null;
    }
    const was = this.parsed.get(key);
    if (was && was.at === copy.at) return was.events;
    const events = parseIcal(copy.text, { calendarId: c.id, defaultTz: this.tz }).events;
    this.parsed.set(key, { at: copy.at, events });
    return events;
  }
}

export { isoOf as isoDayOf };
