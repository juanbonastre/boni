import type { CalEvent } from "./model.ts";
import { fromLocal, toLocal } from "./time.ts";

/**
 * Reminders (phase 5). A calendar has default reminders, one list for timed events and one for all-day
 * events; an event may have its own list instead. They are written as short text, so they read well in
 * a note's properties and in a definition:
 *   timed:   "10m", "1h", "2d"  (minutes, hours or days before it starts; "0m" when it starts)
 *   all-day: "0d@09:00", "1d@18:00"  (that day, or days before, at a time of day)
 *   "none":  no reminders (an event that should not remind even if its calendar does)
 * Several are separated by commas: "10m, 1h".
 */
export type Reminder =
  | { kind: "before"; minutes: number }
  | { kind: "day"; days: number; at: number };

/** A calendar's defaults. Empty lists: the calendar does not remind (the default for every calendar). */
export interface ReminderDefaults {
  timed: Reminder[];
  allDay: Reminder[];
}

export const NO_REMINDERS: ReminderDefaults = { timed: [], allDay: [] };

const MAX_MINUTES = 28 * 1440;

/** One reminder from its text, or null when it is not one. */
export function parseReminder(text: string): Reminder | null {
  const s = text.trim().toLowerCase();
  const before = /^(\d{1,5})\s*([mhd])$/.exec(s);
  if (before) {
    const n = Number(before[1]);
    const minutes = before[2] === "m" ? n : before[2] === "h" ? n * 60 : n * 1440;
    return minutes <= MAX_MINUTES ? { kind: "before", minutes } : null;
  }
  const day = /^(\d{1,2})\s*d\s*@\s*(\d{1,2}):(\d{2})$/.exec(s);
  if (day) {
    const h = Number(day[2]);
    const m = Number(day[3]);
    if (h > 23 || m > 59) return null;
    return { kind: "day", days: Number(day[1]), at: h * 60 + m };
  }
  return null;
}

/**
 * A list from its text. `null` for an empty or missing value (follow the calendar); `[]` for "none".
 * Parts that are not reminders are skipped.
 */
export function parseReminders(text: unknown): Reminder[] | null {
  if (typeof text !== "string" || text.trim() === "") return null;
  if (text.trim().toLowerCase() === "none") return [];
  const out: Reminder[] = [];
  for (const part of text.split(",")) {
    const r = parseReminder(part);
    if (r && !out.some((x) => sameReminder(x, r))) out.push(r);
  }
  return out.length > 0 ? sortReminders(out) : null;
}

export function sameReminder(a: Reminder, b: Reminder): boolean {
  return a.kind === "before"
    ? b.kind === "before" && a.minutes === b.minutes
    : b.kind === "day" && a.days === b.days && a.at === b.at;
}

/** Nearest to the event first. */
export function sortReminders(list: readonly Reminder[]): Reminder[] {
  const key = (r: Reminder) => (r.kind === "before" ? r.minutes : r.days * 1440 - r.at);
  return [...list].sort((a, b) => key(a) - key(b));
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatReminder(r: Reminder): string {
  if (r.kind === "day") return `${r.days}d@${pad(Math.floor(r.at / 60))}:${pad(r.at % 60)}`;
  if (r.minutes > 0 && r.minutes % 1440 === 0) return `${r.minutes / 1440}d`;
  if (r.minutes > 0 && r.minutes % 60 === 0) return `${r.minutes / 60}h`;
  return `${r.minutes}m`;
}

/** The text of a list: "none" for an empty one. */
export function formatReminders(list: readonly Reminder[]): string {
  return list.length === 0 ? "none" : sortReminders(list).map(formatReminder).join(", ");
}

/** Defaults from a definition's `reminders: { timed, allDay }` (text lists); missing parts are empty. */
export function parseReminderDefaults(data: unknown): ReminderDefaults {
  if (!data || typeof data !== "object") return NO_REMINDERS;
  const d = data as Record<string, unknown>;
  const only = (v: unknown, kind: Reminder["kind"]) =>
    (parseReminders(v) ?? []).filter((r) => r.kind === kind);
  return { timed: only(d.timed, "before"), allDay: only(d.allDay, "day") };
}

export function formatReminderDefaults(d: ReminderDefaults): { timed: string; allDay: string } {
  return { timed: formatReminders(d.timed), allDay: formatReminders(d.allDay) };
}

export const hasReminders = (d: ReminderDefaults | undefined): boolean =>
  !!d && (d.timed.length > 0 || d.allDay.length > 0);

/** One notification to show. `id` is stable for the same event and moment (to replace or cancel it). */
export interface Alert {
  id: string;
  eventId: string;
  calendarId: string;
  title: string;
  location: string;
  /** When to show it (ms). */
  at: number;
  /** Start of the event: an instant for timed events, the start of its first day (in `tz`) for all-day ones. */
  start: number;
  allDay: boolean;
}

/** The reminders that apply to an event: its own, or its calendar's for its kind. */
export function remindersOf(ev: CalEvent, defaults: ReminderDefaults | undefined): Reminder[] {
  const kind: Reminder["kind"] = ev.when.kind === "timed" ? "before" : "day";
  const own = ev.reminders;
  const list = own ?? (ev.when.kind === "timed" ? defaults?.timed : defaults?.allDay) ?? [];
  return list.filter((r) => r.kind === kind);
}

/**
 * The notifications due in [from, to): every reminder of every event (recurring events already expanded
 * into occurrences), but none for a task that is done. All-day reminders are at a time of day in `tz`.
 */
export function upcomingAlerts(
  events: readonly CalEvent[],
  defaultsOf: (calendarId: string) => ReminderDefaults | undefined,
  from: number,
  to: number,
  tz: string,
): Alert[] {
  const out: Alert[] = [];
  for (const ev of events) {
    if (ev.isTask && ev.done) continue;
    if (ev.recurrence && ev.seriesId === undefined) continue; // a master is only its occurrences
    const list = remindersOf(ev, defaultsOf(ev.calendarId));
    if (list.length === 0) continue;
    const start = ev.when.kind === "timed" ? ev.when.start : fromLocal(ev.when.startDay, 0, tz);
    if (start + 28 * 86_400_000 < from) continue;
    for (const r of list) {
      const at =
        r.kind === "before"
          ? start - r.minutes * 60_000
          : ev.when.kind === "allday"
            ? fromLocal(ev.when.startDay - r.days, r.at, tz)
            : start;
      if (at < from || at >= to) continue;
      out.push({
        id: `${ev.id}@${at}`,
        eventId: ev.id,
        calendarId: ev.calendarId,
        title: ev.title,
        location: ev.location,
        at,
        start,
        allDay: ev.when.kind === "allday",
      });
    }
  }
  return out.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

/** The local day an alert's event starts on (for texts like "today at 10:00"). */
export const alertDay = (a: Alert, tz: string) => toLocal(a.start, tz).day;
