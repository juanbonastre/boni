/**
 * The engine's `Dates` for «Fecha» (docs/automatizaciones.md §5.2; phase F14b): the core may not do wall-clock math
 * (A-02), so the server passes this in, over `packages/calendar/src/time.ts`, the one place that does it. A date is a
 * civil day ("YYYY-MM-DD"), which stays a civil day, or an instant (epoch ms, or the ISO text a «Fecha y hora» field
 * keeps), which is given back as epoch ms. Anything else throws, and the step fails with it.
 */

import type { Cell, Dates, DateUnit } from "@boni/automations";
import {
  addMonths,
  type CivilDay,
  civilFromDays,
  daysFromCivil,
  fromLocal,
  isoWeek,
  MS_DAY,
  MS_HOUR,
  MS_MIN,
  pad2,
  toLocal,
  weekday,
} from "@boni/calendar";

const CIVIL = /^(\d{4})-(\d{2})-(\d{2})$/;

type When = { civil: CivilDay } | { instant: number };

function when(date: Cell): When {
  if (typeof date === "number" && Number.isFinite(date)) return { instant: date };
  if (typeof date === "string") {
    const m = CIVIL.exec(date);
    if (m) return { civil: daysFromCivil(Number(m[1]), Number(m[2]), Number(m[3])) };
    const t = Date.parse(date);
    if (Number.isFinite(t) && /^\d{4}-\d{2}-\d{2}T/.test(date)) return { instant: t };
  }
  throw new Error("not a date");
}

const civilText = (day: CivilDay) => {
  const { y, m, d } = civilFromDays(day);
  return `${y}-${pad2(m)}-${pad2(d)}`;
};

/** The wall clock of a date in `zone`: its civil day and minute (a civil day at its midnight). */
function local(w: When, zone: string): { day: CivilDay; minute: number } {
  return "civil" in w ? { day: w.civil, minute: 0 } : toLocal(w.instant, zone);
}

const FIXED: Partial<Record<DateUnit, number>> = { minutes: MS_MIN, hours: MS_HOUR };

export const serverDates: Dates = {
  day: (instant, zone) => civilText(toLocal(instant, zone).day),
  add(date, amount, unit, zone) {
    const w = when(date);
    const fixed = FIXED[unit];
    if (fixed !== undefined) {
      const at = "civil" in w ? fromLocal(w.civil, 0, zone) : w.instant;
      return "civil" in w ? civilText(toLocal(at + amount * fixed, zone).day) : at + amount * fixed;
    }
    const { day, minute } = local(w, zone);
    const moved =
      unit === "days"
        ? day + amount
        : unit === "weeks"
          ? day + amount * 7
          : addMonths(day, unit === "months" ? amount : amount * 12);
    return "civil" in w ? civilText(moved) : fromLocal(moved, minute, zone);
  },
  diff(date, until, unit, zone) {
    const a = when(date);
    const b = when(until);
    const fixed = FIXED[unit];
    if (fixed !== undefined) {
      const ms = (w: When) => ("civil" in w ? fromLocal(w.civil, 0, zone) : w.instant);
      return Math.trunc((ms(b) - ms(a)) / fixed);
    }
    const la = local(a, zone);
    const lb = local(b, zone);
    if (unit === "days" || unit === "weeks") {
      let days = lb.day - la.day;
      if (days > 0 && lb.minute < la.minute) days -= 1;
      if (days < 0 && lb.minute > la.minute) days += 1;
      return Math.trunc(unit === "days" ? days : days / 7);
    }
    const ya = civilFromDays(la.day);
    const yb = civilFromDays(lb.day);
    let months = (yb.y - ya.y) * 12 + (yb.m - ya.m);
    // A month is whole only once its day (and minute) is reached again, going forward or back.
    const cmp = yb.d - ya.d || lb.minute - la.minute;
    if (months > 0 && cmp < 0) months -= 1;
    if (months < 0 && cmp > 0) months += 1;
    return Math.trunc(unit === "months" ? months : months / 12);
  },
  startOf(date, unit, zone) {
    const w = when(date);
    const { day } = local(w, zone);
    const { y, m } = civilFromDays(day);
    const start =
      unit === "day"
        ? day
        : unit === "week"
          ? day - ((weekday(day) + 6) % 7)
          : unit === "month"
            ? daysFromCivil(y, m, 1)
            : daysFromCivil(y, 1, 1);
    return "civil" in w ? civilText(start) : fromLocal(start, 0, zone);
  },
  part(date, part, zone) {
    const { day, minute } = local(when(date), zone);
    const { y, m, d } = civilFromDays(day);
    if (part === "year") return y;
    if (part === "month") return m;
    if (part === "day") return d;
    if (part === "weekday") return weekday(day);
    if (part === "week") return isoWeek(day);
    if (part === "hour") return Math.floor(minute / 60);
    return Math.floor(minute % 60);
  },
  format(date, format, zone, locale) {
    const w = when(date);
    if (format === "iso")
      return "civil" in w ? civilText(w.civil) : new Date(w.instant).toISOString();
    // A civil day is shown as that day wherever Juan is: formatted at its UTC midnight, in UTC.
    const at = "civil" in w ? w.civil * MS_DAY : w.instant;
    const timeZone = "civil" in w ? "UTC" : zone;
    const options: Record<string, Intl.DateTimeFormatOptions> = {
      date: { dateStyle: "short" },
      dateLong: { dateStyle: "long" },
      time: { timeStyle: "short" },
      dateTime: { dateStyle: "short", timeStyle: "short" },
      weekday: { weekday: "long" },
      month: { month: "long", year: "numeric" },
    };
    const o = options[format];
    if (!o) throw new Error(`no format ${format}`);
    return new Intl.DateTimeFormat(locale, { ...o, timeZone }).format(at);
  },
};
