import {
  type CalEvent,
  civilFromDays,
  expandAll,
  formatMinute,
  isProposalId,
  monthNames,
  type ReminderDefaults,
  todayIn,
  toLocal,
  upcomingAlerts,
  weekday,
  weekdayNames,
} from "@boni/calendar";
import { t } from "./i18n.ts";

/**
 * Reminders as notifications (phase 5): what the host shows, already worded. The host (desktop shell,
 * Android) keeps the list and shows each one at its time; a new list replaces the previous one.
 */
export interface Notice {
  /** Stable for the same event and moment, so a host can tell what is new. */
  id: string;
  eventId: string;
  at: number;
  title: string;
  body: string;
}

/** How far ahead a host is given notices (the app sends a new list long before it runs out). */
export const NOTICE_HOURS = 48;

/** "Today", "Tomorrow" or "Mon 20 Oct". */
function dayWord(day: number, today: number, locale: "es" | "en"): string {
  if (day === today) return t("notice.today", undefined, locale);
  if (day === today + 1) return t("notice.tomorrow", undefined, locale);
  const d = civilFromDays(day);
  const wd = weekdayNames(locale, "short")[weekday(day)] ?? "";
  return `${wd} ${d.d} ${monthNames(locale, "short")[d.m - 1] ?? ""}`;
}

/**
 * The notices due in the next `hours` (48 by default) from `now`, for events (series kept as masters are
 * expanded here). Worded in `locale` (also on the server, which has no page language).
 */
export function noticesFor(
  events: readonly CalEvent[],
  defaultsOf: (calendarId: string) => ReminderDefaults | undefined,
  opts: { now: number; tz: string; h24: boolean; locale: "es" | "en"; hours?: number },
): Notice[] {
  const { now, tz, h24, locale } = opts;
  const hours = opts.hours ?? NOTICE_HOURS;
  const today = todayIn(tz, now);
  const to = now + hours * 3_600_000;
  // Days whose events can remind inside the window (reminders up to a few days before). A proposal waiting in
  // Boni's inbox never reminds: it is not an event until it is accepted.
  const expanded = expandAll(
    events.filter((e) => e.title.trim() !== "" && !isProposalId(e.id)),
    today - 1,
    today + Math.ceil(hours / 24) + 30,
  );
  return upcomingAlerts(expanded, defaultsOf, now, to, tz).map((a) => {
    const ev = expanded.find((e) => e.id === a.eventId);
    const startDay = toLocal(a.start, tz).day;
    let when = dayWord(startDay, today, locale);
    if (ev && ev.when.kind === "timed") {
      const s = toLocal(ev.when.start, tz);
      const e = toLocal(ev.when.end, tz);
      when += `, ${formatMinute(s.minute, h24)}–${formatMinute(e.minute, h24)}`;
    } else when += `, ${t("notice.allDay", undefined, locale)}`;
    return {
      id: a.id,
      eventId: a.eventId,
      at: a.at,
      title: a.title,
      body: a.location ? `${when} · ${a.location}` : when,
    };
  });
}
