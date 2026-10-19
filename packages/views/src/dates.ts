/** Civil dates as "YYYY-MM-DD" (UTC arithmetic only: no time zones, no local getters). */

export type Day = string;

const parts = (d: Day) => d.split("-").map(Number) as [number, number, number];
const fmt = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const toUtc = (d: Day) => {
  const [y, m, dd] = parts(d);
  return Date.UTC(y, m - 1, dd);
};
const fromUtc = (ms: number) => {
  const t = new Date(ms);
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
};

export const year = (d: Day) => parts(d)[0];
export const month = (d: Day) => parts(d)[1];
export const dayOf = (d: Day) => parts(d)[2];
export const make = fmt;

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export const lastDay = (y: number, m: number) => fmt(y, m, daysInMonth(y, m));
export const addDays = (d: Day, n: number) => fromUtc(toUtc(d) + n * 86_400_000);
export const diffDays = (a: Day, b: Day) => Math.round((toUtc(a) - toUtc(b)) / 86_400_000);

/** Python's shift_months: the same day n months later, clamped to the month's length. */
export function shiftMonths(d: Day, n: number): Day {
  const [y0, m0, dd] = parts(d);
  const total = y0 * 12 + m0 - 1 + n;
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  return fmt(y, m, Math.min(dd, daysInMonth(y, m)));
}

/** Monday = 1 … Sunday = 7 (Python's isoweekday). */
export function isoWeekday(d: Day): number {
  const wd = new Date(toUtc(d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/** ISO year and week (Python's isocalendar). */
export function isoWeek(d: Day): [number, number] {
  const thursday = addDays(d, 4 - isoWeekday(d));
  const y = year(thursday);
  const week = Math.floor(diffDays(thursday, fmt(y, 1, 1)) / 7) + 1;
  return [y, week];
}

export function monthsBetween(start: Day, end: Day): [number, number][] {
  const out: [number, number][] = [];
  let [y, m] = [year(start), month(start)];
  const [ey, em] = [year(end), month(end)];
  while (y < ey || (y === ey && m <= em)) {
    out.push([y, m]);
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  }
  return out;
}
