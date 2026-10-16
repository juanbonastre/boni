import {
  dayToIso,
  formatInstant,
  formatRule,
  hhmmToMinute,
  isoToDay,
  minuteToHhmm,
  parseInstant,
  parseRule,
} from "./codec.ts";
import {
  type CalendarMapping,
  type CalendarView,
  type Collection,
  type Column,
  type Model,
  mappedColumns,
  type Row,
  type TaskMapping,
} from "./collections.ts";
import type { CalEvent, PropValue, When } from "./model.ts";
import { fromLocal, MS_MIN, toLocal } from "./time.ts";

/** Length given to a timed row that has a start but no end. */
export const DEFAULT_DURATION_MIN = 60;

type Values = Record<string, PropValue>;

const str = (v: PropValue | undefined): string =>
  v === null || v === undefined ? "" : Array.isArray(v) ? v.join(", ") : String(v);

const filled = (v: PropValue | undefined): boolean => v !== null && v !== undefined && v !== "";

const columnOf = (c: Collection, id: string | undefined): Column | undefined =>
  id ? c.columns.find((x) => x.id === id) : undefined;

// ---------------------------------------------------------------- reading

function readWhen(model: Model, view: CalendarView, v: Values): When | null {
  const w = view.mapping.when;
  const fallbackTz = view.tz ?? model.defaultTz;
  const tz = (w.timezone && str(v[w.timezone]).trim()) || fallbackTz;

  if (w.kind === "split") {
    const day = isoToDay(v[w.date]);
    if (day === null) return null;
    const endDay = Math.max(day, (w.endDate ? isoToDay(v[w.endDate]) : null) ?? day);
    const startMin = w.startTime ? hhmmToMinute(v[w.startTime]) : null;
    if (startMin === null || (w.allDay && v[w.allDay] === true)) {
      return { kind: "allday", startDay: day, endDay };
    }
    const endMin = w.endTime ? hhmmToMinute(v[w.endTime]) : null;
    const start = fromLocal(day, startMin, tz);
    const end =
      endMin === null
        ? start + DEFAULT_DURATION_MIN * MS_MIN
        : Math.max(start, fromLocal(endDay, endMin, tz));
    return { kind: "timed", start, end, tz };
  }

  const sDay = isoToDay(v[w.start]);
  const sIsDate =
    typeof v[w.start] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(str(v[w.start]).trim());
  if (sIsDate && sDay !== null) {
    const eDay = w.end ? isoToDay(v[w.end]) : null;
    return { kind: "allday", startDay: sDay, endDay: Math.max(sDay, eDay ?? sDay) };
  }
  const start = parseInstant(v[w.start], tz);
  if (start === null) return null;
  const end = w.end ? parseInstant(v[w.end], tz) : null;
  return {
    kind: "timed",
    start,
    end: end === null ? start + DEFAULT_DURATION_MIN * MS_MIN : Math.max(start, end),
    tz,
  };
}

function readTask(
  t: TaskMapping | undefined,
  col: Column | undefined,
  v: PropValue | undefined,
): { isTask: boolean; done: boolean } {
  const no = { isTask: false, done: false };
  if (!t || !col || !filled(v)) return no;
  if (col.type === "checkbox") {
    return typeof v === "boolean" ? { isTask: true, done: v } : no;
  }
  if (typeof v !== "string") return no;
  return { isTask: true, done: !!t.doneValues?.includes(v) };
}

/** What an event that becomes an open task gets in the task column. */
function openTaskValue(t: TaskMapping, col: Column | undefined): PropValue {
  if (col?.type === "checkbox") return false;
  return t.openValue ?? col?.options?.find((o) => !t.doneValues?.includes(o.id))?.id ?? null;
}

function writeTask(
  t: TaskMapping,
  col: Column | undefined,
  isTask: boolean,
  done: boolean,
): PropValue {
  if (!isTask) return null;
  if (col?.type === "checkbox") return done;
  return done ? (t.doneValues?.[0] ?? null) : openTaskValue(t, col);
}

/** The event a row stands for, or null when the row cannot be placed on a calendar. */
export function rowToEvent(model: Model, row: Row): CalEvent | null {
  const view = model.viewOfCollection.get(row.collectionId);
  const coll = model.collections.get(row.collectionId);
  if (!view || !coll) return null;
  const m = view.mapping;
  const v = row.values;
  const when = readWhen(model, view, v);
  if (!when) return null;

  const mapped = mappedColumns(m);
  const props: Values = {};
  for (const c of coll.columns) {
    const x = v[c.id];
    if (!mapped.has(c.id) && x !== null && x !== undefined) props[c.id] = x;
  }
  const task = readTask(m.task, columnOf(coll, m.task?.column), m.task ? v[m.task.column] : null);
  const ev: CalEvent = {
    id: row.id,
    calendarId: view.id,
    title: str(v[m.title]),
    when,
    location: m.location ? str(v[m.location]) : "",
    description:
      m.description === "$body" ? (row.body ?? "") : m.description ? str(v[m.description]) : "",
    props,
    isTask: task.isTask,
    done: task.done,
    created: row.created,
    updated: row.updated,
  };
  if (m.series) {
    const id = str(v[m.series.id]).trim();
    if (id) ev.series = { id, rule: parseRule(v[m.series.rule]) };
  }
  const rule = m.recurrence ? parseRule(v[m.recurrence]) : null;
  if (rule) {
    ev.recurrence = rule;
    const raw = m.exdates ? v[m.exdates] : null;
    const days = Array.isArray(raw)
      ? raw.map((s) => isoToDay(s)).filter((d): d is number => d !== null)
      : [];
    if (days.length) ev.exdates = days;
  }
  return ev;
}

// ---------------------------------------------------------------- writing

function writeWhen(view: CalendarView, when: When, values: Values): void {
  const w = view.mapping.when;
  const set = (col: string | undefined, value: PropValue) => {
    if (!col) return;
    if (value === null && !(col in values)) return;
    values[col] = value;
  };
  if (w.kind === "split") {
    if (when.kind === "allday") {
      set(w.date, dayToIso(when.startDay));
      set(w.endDate, when.endDay > when.startDay ? dayToIso(when.endDay) : null);
      set(w.startTime, null);
      set(w.endTime, null);
      set(w.allDay, true);
      return;
    }
    const a = toLocal(when.start, when.tz);
    const b = toLocal(Math.max(when.end, when.start), when.tz);
    set(w.date, dayToIso(a.day));
    set(w.startTime, minuteToHhmm(a.minute));
    set(w.endTime, minuteToHhmm(b.minute));
    set(w.endDate, b.day > a.day ? dayToIso(b.day) : null);
    set(w.allDay, null);
    set(w.timezone, when.tz);
    return;
  }
  if (when.kind === "allday") {
    set(w.start, dayToIso(when.startDay));
    set(w.end, dayToIso(when.endDay));
    return;
  }
  set(w.start, formatInstant(when.start));
  set(w.end, formatInstant(when.end));
  set(w.timezone, when.tz);
}

const emptyToNull = (s: string): PropValue => (s === "" ? null : s);

/**
 * The row for an event. Starts from `prev` (so values the mapping does not know about survive)
 * and rewrites every mapped column and every property of the event.
 */
export function eventToRow(model: Model, prev: Row | null, ev: CalEvent): Row {
  const view = model.views.get(ev.calendarId);
  const coll = view && model.collections.get(view.collectionId);
  if (!view || !coll) throw new Error(`Unknown calendar "${ev.calendarId}"`);
  const m: CalendarMapping = view.mapping;
  const sameCollection = prev?.collectionId === view.collectionId;
  const values: Values = sameCollection && prev ? { ...prev.values } : {};
  const set = (col: string | undefined, value: PropValue) => {
    if (!col || col === "$body") return;
    if (value === null && !(col in values)) return;
    values[col] = value;
  };

  set(m.title, ev.title);
  set(m.location, emptyToNull(ev.location));
  if (m.description !== "$body") set(m.description, emptyToNull(ev.description));
  writeWhen(view, ev.when, values);
  if (m.task) {
    set(m.task.column, writeTask(m.task, columnOf(coll, m.task.column), ev.isTask, ev.done));
  }
  if (m.recurrence) {
    set(m.recurrence, ev.recurrence ? formatRule(ev.recurrence) : null);
    set(m.exdates, ev.recurrence && ev.exdates?.length ? ev.exdates.map(dayToIso) : null);
  }
  if (m.series) {
    set(m.series.id, ev.series?.id ?? null);
    set(m.series.rule, ev.series?.rule ? formatRule(ev.series.rule) : null);
  }
  const mapped = mappedColumns(m);
  for (const c of coll.columns) {
    if (mapped.has(c.id)) continue;
    const x = ev.props[c.id];
    if (x === null || x === undefined) set(c.id, null);
    else values[c.id] = x;
  }

  const row: Row = {
    id: ev.id,
    collectionId: view.collectionId,
    values,
    created: ev.created,
    updated: ev.updated,
  };
  const body = m.description === "$body" ? ev.description : sameCollection ? prev?.body : undefined;
  if (body) row.body = body;
  return row;
}

// ---------------------------------------------------------------- whole sets

export interface Projector {
  model: Model;
  /** Events of the rows that can be placed; same row object, same event object. */
  project(rows: readonly Row[]): CalEvent[];
  event(row: Row): CalEvent | null;
}

/**
 * Projects rows into events, memoised on the row object: an untouched row keeps its event
 * (callers cache segments and layouts on event identity). Build a new projector when the model
 * (columns or mappings) changes.
 */
export function makeProjector(model: Model): Projector {
  const cache = new WeakMap<Row, CalEvent | null>();
  const event = (row: Row): CalEvent | null => {
    const hit = cache.get(row);
    if (hit !== undefined) return hit;
    const ev = rowToEvent(model, row);
    cache.set(row, ev);
    return ev;
  };
  return {
    model,
    event,
    project(rows) {
      const out: CalEvent[] = [];
      for (const r of rows) {
        const ev = event(r);
        if (ev) out.push(ev);
      }
      return out;
    },
  };
}

/**
 * Applies an edited event list back onto the rows. `prevEvents` is what `project(prevRows)`
 * returned and `nextEvents` the same list after an edit (events that were not touched must be the
 * same objects). Unchanged rows stay the same objects, changed events produce new rows, removed
 * events drop their row and new events add one. Rows that never became events are kept.
 */
export function reconcileRows(
  model: Model,
  prevRows: readonly Row[],
  prevEvents: readonly CalEvent[],
  nextEvents: readonly CalEvent[],
): Row[] {
  const before = new Map(prevEvents.map((e) => [e.id, e]));
  const after = new Map(nextEvents.map((e) => [e.id, e]));
  const out: Row[] = [];
  const seen = new Set<string>();
  for (const row of prevRows) {
    seen.add(row.id);
    const was = before.get(row.id);
    if (!was) {
      out.push(row); // not an event: nothing to edit
      continue;
    }
    const now = after.get(row.id);
    if (!now) continue;
    out.push(now === was ? row : eventToRow(model, row, now));
  }
  for (const ev of nextEvents) {
    if (!seen.has(ev.id)) out.push(eventToRow(model, null, ev));
  }
  return out;
}
