/**
 * Selecting events with the mouse and keys: a click, Shift for a chronological range, Ctrl+Shift to add or remove one.
 */
import { type CalEvent, fromLocal } from "@boni/calendar";

export interface ClickInput {
  /** Currently selected ids. */
  current: string[];
  /** The id the next Shift range starts from (the last plainly or Ctrl+Shift-clicked event). */
  anchor: string | null;
  clicked: string;
  /** Visible events in reading (chronological) order. */
  ordered: string[];
  ctrl: boolean;
  shift: boolean;
}

export interface ClickResult {
  ids: string[];
  anchor: string | null;
  /** True for a plain click: the detail popover opens. */
  popover: boolean;
}

const unique = (ids: string[]): string[] => [...new Set(ids)];

/**
 * Selection rules for clicking an event (Ctrl+click alone opens the event's note: see the store):
 *  - plain click (or Ctrl+click on an event without a note): select only it and open its details;
 *  - Shift+click: add it and every visible event between the anchor and it;
 *  - Ctrl+Shift+click: add it, or remove it when already selected.
 */
export function clickSelection(i: ClickInput): ClickResult {
  if (!i.shift) return { ids: [i.clicked], anchor: i.clicked, popover: true };

  if (!i.ctrl) {
    const a = i.anchor ? i.ordered.indexOf(i.anchor) : -1;
    const b = i.ordered.indexOf(i.clicked);
    if (a < 0 || b < 0)
      return { ids: unique([...i.current, i.clicked]), anchor: i.clicked, popover: false };
    const range = i.ordered.slice(Math.min(a, b), Math.max(a, b) + 1);
    return { ids: unique([...i.current, ...range, i.clicked]), anchor: i.anchor, popover: false };
  }

  const has = i.current.includes(i.clicked);
  return {
    ids: has ? i.current.filter((id) => id !== i.clicked) : [...i.current, i.clicked],
    anchor: i.clicked,
    popover: false,
  };
}

/** Visible events in chronological order (all-day events first within their day). */
export function orderedVisibleIds(
  events: readonly CalEvent[],
  visible: ReadonlySet<string>,
  tz: string,
): string[] {
  const key = (e: CalEvent) =>
    e.when.kind === "timed" ? e.when.start : fromLocal(e.when.startDay, 0, tz) - 1;
  return events
    .filter((e) => visible.has(e.calendarId))
    .map((e) => ({ id: e.id, k: key(e) }))
    .sort((a, b) => a.k - b.k || a.id.localeCompare(b.id))
    .map((x) => x.id);
}
