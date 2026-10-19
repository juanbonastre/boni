import type { CalEvent, Recurrence } from "./model.ts";
import { occurrenceDays } from "./recurrence.ts";
import { moveSeriesWhen, type Scope } from "./recurrenceEdit.ts";
import { shiftWhenByDays, whenStartDay } from "./shift.ts";
import { addMonths, type CivilDay } from "./time.ts";

/**
 * Series kept as separate notes. Every note of a series is a plain event with the same `series.id`
 * and the rule it was made with; nothing expands. The functions here create the notes of a series,
 * keep an open-ended series going as time passes, and apply edits and deletions to the notes of a
 * series by scope. They take and return plain event lists (like `editOccurrence`).
 */

/** How far ahead the notes of a series are created: twelve months. */
export const SERIES_HORIZON_MONTHS = 12;

export const seriesHorizon = (today: CivilDay): CivilDay => addMonths(today, SERIES_HORIZON_MONTHS);

export interface SeriesContext {
  newId: () => string;
  now: number;
  today: CivilDay;
}

const startDay = (e: CalEvent): CivilDay => whenStartDay(e.when);

/** The notes of each series, earliest first. */
export function seriesGroups(events: readonly CalEvent[]): Map<string, CalEvent[]> {
  const groups = new Map<string, CalEvent[]>();
  for (const e of events) {
    if (!e.series) continue;
    const list = groups.get(e.series.id);
    if (list) list.push(e);
    else groups.set(e.series.id, [e]);
  }
  for (const list of groups.values()) list.sort((a, b) => startDay(a) - startDay(b));
  return groups;
}

/** Whether the event belongs to a series with more than one note (editing it is a question of scope). */
export function inSeries(events: readonly CalEvent[], id: string): boolean {
  const e = events.find((x) => x.id === id);
  if (!e?.series) return false;
  let n = 0;
  for (const x of events) if (x.series?.id === e.series.id && ++n > 1) return true;
  return false;
}

const copyOf = (
  from: CalEvent,
  day: CivilDay,
  series: NonNullable<CalEvent["series"]>,
  ctx: SeriesContext,
): CalEvent => ({
  ...from,
  id: ctx.newId(),
  when: shiftWhenByDays(from.when, day - startDay(from)),
  done: false,
  created: ctx.now,
  updated: ctx.now,
  series,
});

/** Days (after `after`) on which `rule`, counted from `first`, has an occurrence up to `horizon`. */
function daysAfter(
  first: CalEvent,
  rule: Recurrence,
  after: CivilDay,
  horizon: CivilDay,
): CivilDay[] {
  const master: CalEvent = { ...first, recurrence: rule, exdates: undefined, series: undefined };
  return occurrenceDays(master, after + 1, horizon);
}

/** `base` and the notes that follow it, up to the horizon (and the rule's own end). Returns them, base first. */
export function makeSeries(
  base: CalEvent,
  rule: Recurrence,
  seriesId: string,
  ctx: SeriesContext,
): CalEvent[] {
  const series = { id: seriesId, rule };
  const first: CalEvent = { ...base, series, updated: ctx.now };
  const days = daysAfter(base, rule, startDay(base), seriesHorizon(ctx.today));
  return [first, ...days.map((d) => copyOf(base, d, series, ctx))];
}

/**
 * The notes that open-ended series are missing up to the horizon. Only the stretch after the last
 * note is filled: a gap in the middle is a note somebody deleted, not one that was never made.
 */
export function extendSeries(events: readonly CalEvent[], ctx: SeriesContext): CalEvent[] {
  const out: CalEvent[] = [];
  for (const list of seriesGroups(events).values()) {
    const first = list[0];
    const last = list[list.length - 1];
    const rule = last?.series?.rule;
    if (!first || !last || !rule) continue;
    for (const d of daysAfter(first, rule, startDay(last), seriesHorizon(ctx.today))) {
      out.push(copyOf(last, d, last.series as NonNullable<CalEvent["series"]>, ctx));
    }
  }
  return out;
}

const withEnd = (e: CalEvent, until: CivilDay): CalEvent =>
  e.series?.rule
    ? { ...e, series: { ...e.series, rule: { ...e.series.rule, until, count: null } } }
    : e;

const jsonEq = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Applies an edit or a deletion of event `id` to the notes of its series.
 *  - this: only that note; following: it and the later ones; all: every note (for a deletion, those
 *    from today on, plus the one asked for: past notes are history).
 * A deletion that takes the end of the series also ends the series (the remaining notes get an
 * `until`), so the next top-up does not bring the notes back. An edit moves the whole scope by the same
 * change: same wall-clock offset, same day offset, new duration (like a master). Marking a task done
 * only ever touches the note itself.
 */
export function editSeries(
  events: readonly CalEvent[],
  id: string,
  scope: Scope,
  change: { patch?: Partial<CalEvent>; remove?: boolean },
  ctx: SeriesContext,
): CalEvent[] {
  const target = events.find((e) => e.id === id);
  if (!target?.series) return [...events];
  const sid = target.series.id;
  const day = startDay(target);
  const siblings = events.filter((e) => e.series?.id === sid);
  const inScope = (e: CalEvent): boolean =>
    e === target ||
    (scope === "following" && startDay(e) >= day) ||
    (scope === "all" && (change.remove ? startDay(e) >= ctx.today : true));

  if (change.remove) {
    const gone = new Set(siblings.filter(inScope));
    const rest = events.filter((e) => !gone.has(e));
    const survivors = siblings.filter((e) => !gone.has(e));
    const cut = Math.min(...[...gone].map(startDay));
    const endsSeries = scope !== "this" || survivors.every((e) => startDay(e) < day);
    if (!endsSeries) return rest;
    return rest.map((e) => (survivors.includes(e) ? withEnd(e, cut - 1) : e));
  }

  const { when: newWhen, done, series: _s, ...rest } = change.patch ?? {};
  const changedProps = rest.props
    ? Object.fromEntries(Object.entries(rest.props).filter(([k, v]) => !jsonEq(v, target.props[k])))
    : null;
  const removedProps = rest.props
    ? Object.keys(target.props).filter((k) => !(k in (rest.props ?? {})))
    : [];
  return events.map((e) => {
    if (!inScope(e)) return e;
    const { props: _p, ...generic } = rest;
    const next: CalEvent = { ...e, ...generic, updated: ctx.now };
    if (newWhen) next.when = e === target ? newWhen : moveSeriesWhen(e.when, target.when, newWhen);
    if (changedProps) {
      const props = { ...e.props, ...changedProps };
      for (const k of removedProps) delete props[k];
      next.props = props;
    }
    if (e === target && done !== undefined) next.done = done;
    return next;
  });
}

/**
 * Gives the series of `id` a new rule from that note on: the later notes are replaced by the ones the
 * new rule makes (so edits made to them are lost), earlier ones stay. A null rule ends the series at
 * this note, which stops being part of it. Without a series yet, `rule` starts one.
 */
export function setSeriesRule(
  events: readonly CalEvent[],
  id: string,
  rule: Recurrence | null,
  seriesId: string,
  ctx: SeriesContext,
): CalEvent[] {
  const target = events.find((e) => e.id === id);
  if (!target) return [...events];
  const day = startDay(target);
  const sid = target.series?.id;
  const later = (e: CalEvent) => !!sid && e.series?.id === sid && startDay(e) > day;
  const kept = events.filter((e) => !later(e));
  if (rule === null) {
    return kept.map((e) => (e === target ? { ...e, series: undefined, updated: ctx.now } : e));
  }
  const made = makeSeries(target, rule, sid ?? seriesId, ctx);
  const replaced = kept.map((e) => (e === target ? (made[0] as CalEvent) : e));
  return [...replaced, ...made.slice(1)];
}
