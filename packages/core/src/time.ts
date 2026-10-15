/**
 * Calendar math. Dates are "civil days" (integer days since 1970-01-01 in the calendar's own
 * wall-clock, no timezone) and instants are epoch milliseconds. Wall-clock minutes of a day are
 * derived through an IANA timezone with Intl, so DST never leaks into the layout code.
 */

export type CivilDay = number;
export type FirstDay = 0 | 1; // 0 = Sunday, 1 = Monday

export const MS_MIN = 60_000;
export const MS_HOUR = 3_600_000;
export const MS_DAY = 86_400_000;

export interface Ymd {
  y: number;
  m: number; // 1..12
  d: number; // 1..31
}

export function daysFromCivil(y: number, m: number, d: number): CivilDay {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function civilFromDays(day: CivilDay): Ymd {
  const z = day + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

/** 0 = Sunday .. 6 = Saturday. */
export function weekday(day: CivilDay): number {
  return (((day + 4) % 7) + 7) % 7;
}

export function startOfWeek(day: CivilDay, first: FirstDay): CivilDay {
  return day - ((weekday(day) - first + 7) % 7);
}

export function addMonths(day: CivilDay, delta: number): CivilDay {
  const { y, m, d } = civilFromDays(day);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (((total % 12) + 12) % 12) + 1;
  return daysFromCivil(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function daysInMonth(y: number, m: number): number {
  return daysFromCivil(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - daysFromCivil(y, m, 1);
}

export function startOfMonth(day: CivilDay): CivilDay {
  const { y, m } = civilFromDays(day);
  return daysFromCivil(y, m, 1);
}

/** Week start days covering the month: always 6 rows (`fixed`) or only the needed rows. */
export function monthWeeks(day: CivilDay, first: FirstDay, fixed = false): CivilDay[] {
  const { y, m } = civilFromDays(day);
  const monthStart = daysFromCivil(y, m, 1);
  const monthEnd = monthStart + daysInMonth(y, m) - 1;
  const firstWeek = startOfWeek(monthStart, first);
  const rows = fixed ? 6 : Math.ceil((monthEnd - firstWeek + 1) / 7);
  return Array.from({ length: rows }, (_, i) => firstWeek + i * 7);
}

/** ISO 8601 week number (Monday-based, week 1 contains the first Thursday). */
export function isoWeek(day: CivilDay): number {
  const thursday = day - ((weekday(day) + 6) % 7) + 3;
  const { y } = civilFromDays(thursday);
  const jan1 = daysFromCivil(y, 1, 1);
  return Math.floor((thursday - jan1) / 7) + 1;
}

// ---------------------------------------------------------------- timezone

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Offset of `tz` from UTC at instant `ms`, in milliseconds. */
export function tzOffsetMs(ms: number, tz: string): number {
  const p: Record<string, number> = {};
  for (const part of dtf(tz).formatToParts(new Date(ms))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(
    p.year ?? 1970,
    (p.month ?? 1) - 1,
    p.day ?? 1,
    p.hour ?? 0,
    p.minute ?? 0,
    p.second ?? 0,
  );
  return asUtc - Math.floor(ms / 1000) * 1000;
}

export interface LocalTime {
  day: CivilDay;
  /** Wall-clock minutes since local midnight (fractional). */
  minute: number;
}

export function toLocal(ms: number, tz: string): LocalTime {
  const local = ms + tzOffsetMs(ms, tz);
  const day = Math.floor(local / MS_DAY);
  return { day, minute: (local - day * MS_DAY) / MS_MIN };
}

export function fromLocal(day: CivilDay, minute: number, tz: string): number {
  const guess = day * MS_DAY + minute * MS_MIN;
  const first = guess - tzOffsetMs(guess, tz);
  return guess - tzOffsetMs(first, tz);
}

export function todayIn(tz: string, now = Date.now()): CivilDay {
  return toLocal(now, tz).day;
}

/** "GMT+2", "GMT+5:30". */
export function gmtLabel(ms: number, tz: string): string {
  const off = Math.round(tzOffsetMs(ms, tz) / MS_MIN);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `GMT${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

// ---------------------------------------------------------------- formatting

export type Locale = "es" | "en";

const WEEKDAY_CACHE = new Map<string, string[]>();
const MONTH_CACHE = new Map<string, string[]>();

/** Index 0 = Sunday. `style` as in Intl ("narrow" | "short" | "long"). */
export function weekdayNames(locale: Locale, style: "narrow" | "short" | "long"): string[] {
  const key = `${locale}:${style}`;
  let names = WEEKDAY_CACHE.get(key);
  if (!names) {
    const f = new Intl.DateTimeFormat(locale, { weekday: style, timeZone: "UTC" });
    names = Array.from({ length: 7 }, (_, i) => cap(f.format(new Date(Date.UTC(1970, 0, 4 + i)))));
    WEEKDAY_CACHE.set(key, names);
  }
  return names;
}

export function monthNames(locale: Locale, style: "short" | "long"): string[] {
  const key = `${locale}:${style}`;
  let names = MONTH_CACHE.get(key);
  if (!names) {
    const f = new Intl.DateTimeFormat(locale, { month: style, timeZone: "UTC" });
    names = Array.from({ length: 12 }, (_, i) => cap(f.format(new Date(Date.UTC(2000, i, 1)))));
    MONTH_CACHE.set(key, names);
  }
  return names;
}

function cap(s: string): string {
  const t = s.replace(/\.$/, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "07:00" (24 h) or "7 AM" / "7:30 PM" (12 h). */
export function formatMinute(minute: number, h24: boolean): string {
  const total = Math.round(minute) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h24) return `${pad2(h)}:${pad2(m)}`;
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${pad2(m)} ${suffix}`;
}

export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}
