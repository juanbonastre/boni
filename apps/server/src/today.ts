// Inicio's «Hoy» on the phone (docs/design-guide.md, «El móvil»): what the calendars hold today, read as Boni Calendar reads them.
import {
  type CalEvent,
  type CivilDay,
  civilFromDays,
  expandAll,
  isProposalId,
  makeModel,
  overlapsDays,
  pad2,
  rowToEvent,
  todayIn,
  toLocal,
} from "@boni/calendar";
import type { UserStore } from "@boni/store";
import { recordUserRead } from "./audit.ts";
import { type CalendarSource, taskDoneField } from "./calendarStore.ts";

/**
 * Inicio's «Hoy» on the phone (docs/design-guide.md, «El móvil»): what Juan's calendars hold today, read as Boni
 * Calendar reads them (the same model: times in the device's timezone, all-day items as civil days, series
 * expanded), with what a tap needs: the record's collection and, for a task, its done box. Today's few, never a
 * whole collection; what is shown is recorded as read, like any list of rows.
 */
export interface TodayItem {
  /** The record (a series' own record for each of its days). */
  id: string;
  type: string;
  /** The collection's name. */
  collection: string;
  title: string;
  /** "HH:MM" when it starts today at a time; null for all day (or one that began before today). */
  start: string | null;
  task: boolean;
  done: boolean;
  /** The checkbox that marks it done (a task's), by its id. */
  doneField: string | null;
}

/** At most this many: Inicio shows today, not an agenda. */
const MAX = 30;

const dayText = (d: CivilDay) => {
  const { y, m, d: n } = civilFromDays(d);
  return `${y}-${pad2(m)}-${pad2(n)}`;
};

export async function todayOf(
  store: UserStore,
  calendar: Pick<CalendarSource, "snapshot">,
  opts: { tz: string; now: number; device: string },
): Promise<{ day: string; items: TodayItem[] }> {
  const day = todayIn(opts.tz, opts.now);
  const snap = await calendar.snapshot();
  const model = makeModel(snap.collections, snap.views, { defaultTz: opts.tz });
  const events: CalEvent[] = [];
  for (const row of snap.rows) {
    if (isProposalId(row.id)) continue;
    const ev = rowToEvent(model, row);
    if (ev) events.push(ev);
  }
  const types = store.schema().types;
  const items: (TodayItem & { at: number })[] = [];
  for (const e of expandAll(events, day, day)) {
    if (!overlapsDays(e, day, day, opts.tz)) continue;
    const id = e.seriesId ?? e.id;
    const s = store.get(id);
    const def = s && s.entity.deleted === undefined ? types[s.entity.type] : undefined;
    if (!s || !def) continue;
    const local = e.when.kind === "timed" ? toLocal(e.when.start, opts.tz) : null;
    const timed = local !== null && local.day === day;
    const minute = local ? Math.floor(local.minute) : 0;
    items.push({
      id,
      type: def.id,
      collection: def.name,
      title: e.title,
      start: timed ? `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}` : null,
      task: e.isTask,
      done: e.done,
      doneField: e.isTask ? (taskDoneField(store, def.id)?.id ?? null) : null,
      at: timed ? minute : -1,
    });
  }
  // All day first, then by the hour; what is done after what is not.
  items.sort((a, b) => Number(a.done) - Number(b.done) || a.at - b.at);
  const kept = items.slice(0, MAX);
  const byType = new Map<string, TodayItem[]>();
  for (const it of kept) byType.set(it.type, [...(byType.get(it.type) ?? []), it]);
  for (const [type, list] of byType) {
    const def = types[type];
    if (!def) continue;
    recordUserRead(
      store,
      opts.device,
      "data.rows",
      type,
      list.map((x) => x.id),
      false,
      opts.now,
      [def.titleField, ...list.flatMap((x) => (x.doneField ? [x.doneField] : []))],
    );
  }
  return { day: dayText(day), items: kept.map(({ at: _, ...it }) => it) };
}
