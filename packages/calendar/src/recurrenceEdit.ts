import type { CalEvent, Recurrence, When } from "./model.ts";
import { makeOccurrence, occurrencesBefore, parseOccurrenceId } from "./recurrence.ts";
import { whenStartDay } from "./shift.ts";
import { type CivilDay, fromLocal, toLocal } from "./time.ts";

export type Scope = "this" | "following" | "all";

export interface EditContext {
  newId: () => string;
  now: number;
}

/**
 * Where the master (series start) must go so that the dragged occurrence lands on `to`:
 * same wall-clock offset, same day offset, and the new duration.
 */
export function moveSeriesWhen(master: When, from: When, to: When): When {
  if (master.kind === "allday" && from.kind === "allday" && to.kind === "allday") {
    const startDay = master.startDay + (to.startDay - from.startDay);
    return { kind: "allday", startDay, endDay: startDay + (to.endDay - to.startDay) };
  }
  if (master.kind === "timed" && from.kind === "timed" && to.kind === "timed") {
    const o = toLocal(from.start, from.tz);
    const n = toLocal(to.start, to.tz);
    const m = toLocal(master.start, master.tz);
    const start = fromLocal(m.day + (n.day - o.day), m.minute + (n.minute - o.minute), master.tz);
    return { kind: "timed", start, end: start + (to.end - to.start), tz: master.tz };
  }
  return to; // the kind changed (timed <-> all-day): take the new shape as is
}

const shiftWeekdays = (r: Recurrence, dayDelta: number): Recurrence =>
  r.byWeekday?.length
    ? { ...r, byWeekday: r.byWeekday.map((w) => (((w + dayDelta) % 7) + 7) % 7) }
    : r;

const detach = (occ: CalEvent): CalEvent => {
  const { seriesId: _s, occurrenceDay: _d, exdates: _x, ...rest } = occ;
  return { ...rest, recurrence: null };
};

/**
 * Applies a change (or a deletion) to one occurrence of a series.
 *  - all: the change goes to the series' master;
 *  - this: the occurrence is removed from the series and, unless deleting, re-created as a plain event;
 *  - following: the series is cut before the occurrence and, unless deleting, a new series starts there.
 * `id` may also be a plain event id: then it is just patched or removed.
 */
export function editOccurrence(
  events: readonly CalEvent[],
  id: string,
  scope: Scope,
  change: { patch?: Partial<CalEvent>; remove?: boolean },
  ctx: EditContext,
): CalEvent[] {
  const p = parseOccurrenceId(id);
  const master = p ? events.find((e) => e.id === p.seriesId) : undefined;
  if (!p || !master?.recurrence) {
    return change.remove
      ? events.filter((e) => e.id !== id)
      : events.map((e) => (e.id === id ? { ...e, ...change.patch, updated: ctx.now } : e));
  }

  const day = p.day;
  const occ = makeOccurrence(master, day);
  const r = master.recurrence;
  const startDay = whenStartDay(master.when);
  const { when: newWhen, ...rest } = change.patch ?? {};
  const target = newWhen ?? occ.when;
  const dayDelta = whenStartDay(target) - whenStartDay(occ.when);
  const replace = (next: CalEvent[]) => events.filter((e) => e.id !== master.id).concat(next);

  const asAll = (): CalEvent[] => {
    if (change.remove) return events.filter((e) => e.id !== master.id);
    return events.map((e) =>
      e.id !== master.id
        ? e
        : {
            ...e,
            ...rest,
            when: newWhen ? moveSeriesWhen(e.when, occ.when, newWhen) : e.when,
            recurrence:
              "recurrence" in rest ? (rest.recurrence ?? null) : shiftWeekdays(r, dayDelta),
            updated: ctx.now,
          },
    );
  };

  if (scope === "all" || (scope === "following" && day === startDay)) return asAll();

  if (scope === "this") {
    const cut: CalEvent = {
      ...master,
      exdates: [...(master.exdates ?? []), day],
      updated: ctx.now,
    };
    if (change.remove) return replace([cut]);
    const plain: CalEvent = {
      ...detach(occ),
      ...rest,
      when: target,
      id: ctx.newId(),
      recurrence: null,
      created: ctx.now,
      updated: ctx.now,
    };
    return replace([cut, plain]);
  }

  // following
  const before = occurrencesBefore(master, day);
  const remaining = r.count != null ? Math.max(1, r.count - before) : null;
  const head: CalEvent = {
    ...master,
    recurrence: { ...r, until: day - 1, count: null },
    updated: ctx.now,
  };
  if (change.remove) return replace([head]);
  const { seriesId: _s, occurrenceDay: _d, ...occRest } = occ;
  const tail: CalEvent = {
    ...occRest,
    ...rest,
    id: ctx.newId(),
    when: target,
    recurrence: shiftWeekdays({ ...r, count: remaining }, dayDelta),
    exdates: (master.exdates ?? []).filter((d) => d >= day).map((d) => d + dayDelta),
    created: ctx.now,
    updated: ctx.now,
  };
  return replace([head, tail]);
}

export type { CivilDay };
