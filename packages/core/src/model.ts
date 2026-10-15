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
}

export interface CalendarData {
  accounts: Account[];
  calendars: CalendarDef[];
  projects: Project[];
  events: CalEvent[];
}
