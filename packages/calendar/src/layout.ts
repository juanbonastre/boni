/**
 * Where the timed events of one day sit side by side: clusters of overlapping events, a column each and the free
 * columns to the right they may span.
 */
import type { CivilDay } from "./time.ts";

export interface TimedItem {
  id: string;
  /** Minutes since the day's local midnight. */
  start: number;
  end: number;
}

export interface Placed {
  id: string;
  /** Column index inside its overlap cluster. */
  col: number;
  /** Number of columns of the cluster. */
  cols: number;
  /** Columns this item spans to the right (>= 1), using free space. */
  span: number;
}

/** Events shorter than this are laid out as if they were this long (it is their minimum height). */
export const MIN_LAYOUT_MINUTES = 20;

/**
 * Side-by-side layout of overlapping timed items of one day. Items are grouped in clusters of
 * transitively overlapping events; inside a cluster each gets the first free column, and then
 * expands to the right while the next columns are free during its span.
 */
export function layoutColumns(items: TimedItem[]): Placed[] {
  const sorted = [...items]
    .map((it) => ({ ...it, end: Math.max(it.end, it.start + MIN_LAYOUT_MINUTES) }))
    .sort((a, b) => a.start - b.start || b.end - a.end || a.id.localeCompare(b.id));

  const out: Placed[] = [];
  let i = 0;
  while (i < sorted.length) {
    const cluster: (typeof sorted)[number][] = [];
    let clusterEnd = -Infinity;
    while (i < sorted.length) {
      const it = sorted[i];
      if (!it || (cluster.length > 0 && it.start >= clusterEnd)) break;
      cluster.push(it);
      clusterEnd = Math.max(clusterEnd, it.end);
      i++;
    }
    const colEnds: number[] = [];
    const cols: number[] = [];
    for (const it of cluster) {
      let c = colEnds.findIndex((e) => e <= it.start);
      if (c < 0) {
        c = colEnds.length;
        colEnds.push(it.end);
      } else {
        colEnds[c] = it.end;
      }
      cols.push(c);
    }
    cluster.forEach((it, idx) => {
      const col = cols[idx] ?? 0;
      let span = 1;
      for (let c = col + 1; c < colEnds.length; c++) {
        const blocked = cluster.some(
          (o, oi) => cols[oi] === c && o.start < it.end && o.end > it.start,
        );
        if (blocked) break;
        span++;
      }
      out.push({ id: it.id, col, cols: colEnds.length, span });
    });
  }
  return out;
}

export interface SpanItem {
  id: string;
  startDay: CivilDay;
  endDay: CivilDay; // inclusive
}

export interface PlacedSpan {
  id: string;
  lane: number;
  /** Clipped to the range. */
  startDay: CivilDay;
  endDay: CivilDay;
  clippedStart: boolean;
  clippedEnd: boolean;
}

/** Lane assignment for multi-day bars (all-day row, month rows) inside [rangeStart, rangeEnd]. */
export function layoutSpans(
  items: SpanItem[],
  rangeStart: CivilDay,
  rangeEnd: CivilDay,
): PlacedSpan[] {
  const inRange = items
    .filter((it) => it.endDay >= rangeStart && it.startDay <= rangeEnd)
    .sort(
      (a, b) =>
        a.startDay - b.startDay ||
        b.endDay - b.startDay - (a.endDay - a.startDay) ||
        a.id.localeCompare(b.id),
    );
  const laneEnds: number[] = [];
  return inRange.map((it) => {
    const startDay = Math.max(it.startDay, rangeStart);
    const endDay = Math.min(it.endDay, rangeEnd);
    let lane = laneEnds.findIndex((e) => e < startDay);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(endDay);
    } else {
      laneEnds[lane] = endDay;
    }
    return {
      id: it.id,
      lane,
      startDay,
      endDay,
      clippedStart: it.startDay < rangeStart,
      clippedEnd: it.endDay > rangeEnd,
    };
  });
}
