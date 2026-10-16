import type { CivilDay } from "./time.ts";

export type PropertyType =
  | "text"
  | "number"
  | "select"
  | "multiselect"
  | "checkbox"
  | "date"
  | "url"
  | "project";

export interface SelectOption {
  id: string;
  label: string;
  color: string;
}

export interface PropertyDef {
  id: string;
  name: string;
  type: PropertyType;
  options?: SelectOption[];
}

export type PropValue = string | number | boolean | string[] | null;

export interface Account {
  id: string;
  name: string;
  email: string;
}

export interface CalendarDef {
  id: string;
  accountId: string;
  name: string;
  color: string;
  visible: boolean;
  readOnly?: boolean;
  /** Properties every event of this calendar can carry (like a Notion database schema). */
  schema: PropertyDef[];
}

export interface Project {
  id: string;
  name: string;
}

export type When =
  | { kind: "timed"; start: number; end: number; tz: string }
  | { kind: "allday"; startDay: CivilDay; endDay: CivilDay }; // endDay inclusive

export type Freq = "daily" | "weekly" | "monthly" | "yearly";

export interface Recurrence {
  freq: Freq;
  /** Every N days/weeks/months/years (>= 1). */
  interval: number;
  /** Weekly only: weekdays (0 = Sunday .. 6 = Saturday). Defaults to the start day's weekday. */
  byWeekday?: number[];
  /** Last day (inclusive) an occurrence may start on. */
  until?: CivilDay | null;
  /** Total number of occurrences, deleted ones included. */
  count?: number | null;
}

export interface CalEvent {
  id: string;
  calendarId: string;
  title: string;
  when: When;
  location: string;
  description: string;
  props: Record<string, PropValue>;
  /** Tasks show a checkbox instead of looking like a plain event. */
  isTask: boolean;
  done: boolean;
  created: number;
  updated: number;
  /** Present on a series master and on every occurrence expanded from it. */
  recurrence?: Recurrence | null;
  /** Days of the series that were deleted or detached (only on the master). */
  exdates?: CivilDay[];
  /** Occurrences only: id of the master this one was expanded from. */
  seriesId?: string;
  /** Occurrences only: the day (of the series' start) this occurrence belongs to. */
  occurrenceDay?: CivilDay;
  /**
   * A series stored as separate notes: every note of the series is a plain event carrying the same
   * `id` and the rule it was made with (unlike `recurrence`, which is one master that expands).
   */
  series?: { id: string; rule: Recurrence | null };
}

export interface CalendarData {
  accounts: Account[];
  calendars: CalendarDef[];
  projects: Project[];
  events: CalEvent[];
}
