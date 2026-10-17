import type { Account, PropValue, SelectOption } from "./model.ts";
import type { ReminderDefaults } from "./reminders.ts";

/**
 * Collections: typed tables of rows. They are plain, serialisable data (no functions) because
 * their definitions will live in the user's vault and be edited by hand.
 *
 * A calendar is a *view* of a collection: a mapping from the collection's columns to what a
 * calendar needs (title, when, task state, repetition). The rows are the only truth; `CalEvent`
 * is derived from them (see `projection.ts`).
 */

export type ColumnType =
  | "text"
  | "number"
  | "select"
  | "multiselect"
  | "checkbox"
  | "date" // "YYYY-MM-DD"
  | "time" // "HH:MM"
  | "datetime" // ISO 8601 instant ("2026-10-15T07:00:00Z")
  | "dates" // list of "YYYY-MM-DD"
  | "url"
  | "relation"; // id of a row of the `target` collection

export interface Column {
  id: string;
  name: string;
  type: ColumnType;
  options?: SelectOption[];
  /** `relation` only: id of the collection the value points into. */
  target?: string;
}

export interface Collection {
  id: string;
  name: string;
  columns: Column[];
}

/** `null` and a missing key both mean "not set". */
export interface Row {
  id: string;
  collectionId: string;
  values: Record<string, PropValue>;
  /** Free text after the properties (the body of a note). Mapped with `description: "$body"`. */
  body?: string;
  created: number;
  updated: number;
}

/**
 * When a row happens.
 *  - `split`: separate date and time columns (what `agenda/` notes use). A row without a start
 *    time (or with `allDay` set) is an all-day event; `endDate` is inclusive.
 *  - `range`: start and end columns holding either "YYYY-MM-DD" (all-day, end inclusive) or an
 *    ISO instant (timed). The row's timezone only matters for instants without an offset.
 */
export type WhenMapping =
  | {
      kind: "split";
      date: string;
      startTime?: string;
      endTime?: string;
      endDate?: string;
      allDay?: string;
      timezone?: string;
    }
  | { kind: "range"; start: string; end?: string; timezone?: string };

/**
 * Which column makes a row a task. A row whose column is empty is a plain event.
 *  - checkbox column: `false` = open task, `true` = done task.
 *  - select column: any value is a task; it is done when the value is in `doneValues`.
 *    `openValue` is written when an event becomes an open task (defaults to the first option
 *    that is not a done value).
 */
export interface TaskMapping {
  column: string;
  doneValues?: string[];
  openValue?: string;
}

/** Column id, or `"$body"` for the row's body text. */
export type TextRef = string;

export interface CalendarMapping {
  title: string;
  location?: string;
  description?: TextRef;
  when: WhenMapping;
  task?: TaskMapping;
  /** Text column holding an RRULE-subset string, e.g. "FREQ=WEEKLY;BYDAY=MO,WE". */
  recurrence?: string;
  /** `dates` column with the days of the series that were deleted or detached. */
  exdates?: string;
  /**
   * A series kept as one note per occurrence: the text column shared by the notes of a series, and the
   * text column with its repetition rule. Mutually exclusive with `recurrence` (one master that expands).
   */
  series?: { id: string; rule: string };
  /** Text column with the event's own reminders ("10m, 1h"; "none"; empty: the calendar's). */
  reminders?: string;
}

export interface CalendarView {
  /** Also the `calendarId` of the events it produces. */
  id: string;
  collectionId: string;
  accountId: string;
  color: string;
  visible: boolean;
  readOnly?: boolean;
  /** Timezone for rows that do not carry their own. Falls back to the model default. */
  tz?: string;
  mapping: CalendarMapping;
  /** Reminders of its events unless an event has its own (none when missing). */
  reminders?: ReminderDefaults;
}

export interface CollectionSnapshot {
  accounts: Account[];
  collections: Collection[];
  views: CalendarView[];
  rows: Row[];
}

/** Lookup tables over a set of collections and views. Rebuild it when either changes. */
export interface Model {
  collections: ReadonlyMap<string, Collection>;
  /** By view id (= calendar id). */
  views: ReadonlyMap<string, CalendarView>;
  /** By collection id: a collection has at most one calendar view for now. */
  viewOfCollection: ReadonlyMap<string, CalendarView>;
  defaultTz: string;
}

export function makeModel(
  collections: readonly Collection[],
  views: readonly CalendarView[],
  opts: { defaultTz?: string } = {},
): Model {
  return {
    collections: new Map(collections.map((c) => [c.id, c])),
    views: new Map(views.map((v) => [v.id, v])),
    viewOfCollection: new Map(views.map((v) => [v.collectionId, v])),
    defaultTz: opts.defaultTz ?? "UTC",
  };
}

/** Whether events of this calendar can be tasks (the view maps a task column). */
export function supportsTasks(model: Model, calendarId: string): boolean {
  return !!model.views.get(calendarId)?.mapping.task;
}

/** Column ids the mapping consumes; the rest are the event's free `props`. */
export function mappedColumns(m: CalendarMapping): Set<string> {
  const out = new Set<string>([m.title]);
  const add = (id: string | undefined) => {
    if (id && id !== "$body") out.add(id);
  };
  add(m.location);
  add(m.description);
  add(m.task?.column);
  add(m.recurrence);
  add(m.exdates);
  add(m.series?.id);
  add(m.series?.rule);
  add(m.reminders);
  const w = m.when;
  if (w.kind === "split") {
    add(w.date);
    add(w.startTime);
    add(w.endTime);
    add(w.endDate);
    add(w.allDay);
    add(w.timezone);
  } else {
    add(w.start);
    add(w.end);
    add(w.timezone);
  }
  return out;
}
