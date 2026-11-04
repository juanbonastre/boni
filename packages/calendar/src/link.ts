/**
 * A record of the user's linked to an event of an external calendar (task 50; Juan, 2026-11-03: «estos dos ítems
 * son lo mismo»). The record keeps the external event's id in a text column mapped as `external`; shown together,
 * the calendar paints one item: the record, with its own title, colour and note, at the external event's time (the
 * calendar it comes from rules the when), and the external event itself is absorbed. Nothing here writes: rows stay
 * the truth and the external calendars stay read-only; this is how the merged view reads.
 */
import type { CalEvent, LinkedExternal } from "./model.ts";
import { resolveOccurrence } from "./recurrence.ts";
import { likeTitle } from "./text.ts";
import { MS_DAY, toLocal } from "./time.ts";

/** An external calendar's event (`ext:<calendar>:<uid>`, maybe `~<day>` for an occurrence). */
export const isExternalId = (id: string): boolean => id.startsWith("ext:");

/** The external calendar an event id belongs to, or null for the user's own events. */
export function externalCalendarOf(id: string): string | null {
  const m = /^ext:([^:]+):/.exec(id);
  return m?.[1] ?? null;
}

/** The civil day an event starts, in its own zone. */
export function startDayOf(ev: Pick<CalEvent, "when">): number {
  return ev.when.kind === "timed" ? toLocal(ev.when.start, ev.when.tz).day : ev.when.startDay;
}

const startMs = (ev: Pick<CalEvent, "when">): number =>
  ev.when.kind === "timed" ? ev.when.start : ev.when.startDay * MS_DAY;

/**
 * `events` (the user's own and the external calendars') with every link applied: a linked record takes the external
 * event's when and carries it as `linked`; the external event is absorbed (a plain one goes, an occurrence of a
 * repeating one becomes an exception of its master). A link to an event its calendar no longer has is `linkLost`;
 * one to a calendar that is not here (another device without the subscription) is left as it is.
 */
export function linkExternals(
  events: readonly CalEvent[],
  presentCalendars: ReadonlySet<string>,
): readonly CalEvent[] {
  if (!events.some((e) => e.external && !isExternalId(e.id))) return events;
  const externals = events.filter((e) => isExternalId(e.id));
  const replaced = new Map<string, CalEvent>();
  const absorbed = new Set<string>();
  const exceptions = new Map<string, number[]>();
  for (const ev of events) {
    if (isExternalId(ev.id) || !ev.external) continue;
    const target = resolveOccurrence(externals, ev.external);
    if (target) {
      const linked: LinkedExternal = {
        id: target.id,
        calendarId: target.calendarId,
        title: target.title,
        location: target.location,
        description: target.description,
      };
      replaced.set(ev.id, { ...ev, when: target.when, linked });
      if (target.seriesId && target.occurrenceDay !== undefined) {
        const days = exceptions.get(target.seriesId) ?? [];
        days.push(target.occurrenceDay);
        exceptions.set(target.seriesId, days);
      } else absorbed.add(target.id);
    } else {
      const cal = externalCalendarOf(ev.external);
      if (cal && presentCalendars.has(cal)) replaced.set(ev.id, { ...ev, linkLost: true });
    }
  }
  if (!replaced.size) return events;
  const out: CalEvent[] = [];
  for (const ev of events) {
    if (absorbed.has(ev.id)) continue;
    const days = exceptions.get(ev.id);
    if (days) out.push({ ...ev, exdates: [...(ev.exdates ?? []), ...days] });
    else out.push(replaced.get(ev.id) ?? ev);
  }
  return out;
}

/** Whether two events share a moment: timed ones overlap; an all-day one shares a day with the other. */
export function overlaps(a: Pick<CalEvent, "when">, b: Pick<CalEvent, "when">): boolean {
  if (a.when.kind === "timed" && b.when.kind === "timed")
    return a.when.start < b.when.end && b.when.start < a.when.end;
  return startDayOf(a) === startDayOf(b);
}

/**
 * The user's own events near an external one (its day and a day either side), those with a like title first and
 * then the closest, never one already linked or itself external: what «Enlazar» offers.
 */
export function candidatesFor(ext: CalEvent, events: readonly CalEvent[], around = 1): CalEvent[] {
  const day = startDayOf(ext);
  const rank = (e: CalEvent) =>
    (likeTitle(e.title, ext.title) ? 0 : MS_DAY * 3) + Math.abs(startMs(e) - startMs(ext));
  return events
    .filter(
      (e) =>
        !isExternalId(e.id) && !e.external && !e.linked && Math.abs(startDayOf(e) - day) <= around,
    )
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 12);
}

/** The user's own event an external one most likely is: the same moment and a like title; null when none is clear. */
export function suggestLink(ext: CalEvent, events: readonly CalEvent[]): CalEvent | null {
  return (
    candidatesFor(ext, events, 0).find((e) => overlaps(e, ext) && likeTitle(e.title, ext.title)) ??
    null
  );
}
