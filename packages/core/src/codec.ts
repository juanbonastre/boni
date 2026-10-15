import type { Freq, Recurrence } from "./model.ts";
import {
  type CivilDay,
  civilFromDays,
  daysFromCivil,
  daysInMonth,
  fromLocal,
  pad2,
} from "./time.ts";

/** Text forms of days, times, instants and repetition rules, as they appear in note properties. */

export function dayToIso(day: CivilDay): string {
  const { y, m, d } = civilFromDays(day);
  return `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}`;
}

/** "2026-10-15" (a longer ISO string is accepted, its date part is used). Null when not a date. */
export function isoToDay(s: unknown): CivilDay | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?![0-9])/.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return daysFromCivil(y, mo, d);
}

/** Whole minutes since midnight as "HH:MM". */
export function minuteToHhmm(minute: number): string {
  const total = Math.round(minute);
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

/** "9:05", "09:05" or "09:05:30" to minutes since midnight ("24:00" is allowed). Null when invalid. */
export function hhmmToMinute(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

export function formatInstant(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * An ISO instant to epoch ms. A string with "Z" or an offset is absolute; one without is read as
 * wall-clock time in `tz` (never in the machine's zone). Null when invalid.
 */
export function parseInstant(s: unknown, tz: string): number | null {
  if (typeof s !== "string") return null;
  const m =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(
      s.trim(),
    );
  if (!m) return null;
  const day = isoToDay(`${m[1]}-${m[2]}-${m[3]}`);
  const h = Number(m[4]);
  const min = Number(m[5]);
  if (day === null || h > 23 || min > 59) return null;
  const sec = Number(m[6] ?? 0);
  const zone = m[7];
  if (!zone) return fromLocal(day, h * 60 + min, tz) + sec * 1000;
  let offset = 0;
  if (zone !== "Z") {
    const sign = zone.startsWith("-") ? -1 : 1;
    const digits = zone.slice(1).replace(":", "");
    offset = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
  }
  return day * 86_400_000 + (h * 60 + min - offset) * 60_000 + sec * 1000;
}

// ---------------------------------------------------------------- repetition rule

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const FREQ_CODES: Record<Freq, string> = {
  daily: "DAILY",
  weekly: "WEEKLY",
  monthly: "MONTHLY",
  yearly: "YEARLY",
};

/** "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10;UNTIL=2027-01-31" (the subset of RRULE we support). */
export function formatRule(r: Recurrence): string {
  const parts = [`FREQ=${FREQ_CODES[r.freq]}`];
  if (r.interval > 1) parts.push(`INTERVAL=${Math.floor(r.interval)}`);
  if (r.byWeekday?.length) {
    const days = [...new Set(r.byWeekday)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    parts.push(`BYDAY=${days.map((d) => DAY_CODES[d]).join(",")}`);
  }
  if (r.count != null) parts.push(`COUNT=${r.count}`);
  if (r.until != null) parts.push(`UNTIL=${dayToIso(r.until)}`);
  return parts.join(";");
}

/** Inverse of `formatRule`. Null for anything outside the supported subset (e.g. "BYDAY=2TU"). */
export function parseRule(s: unknown): Recurrence | null {
  if (typeof s !== "string") return null;
  const body = s.trim().replace(/^RRULE:/i, "");
  if (!body) return null;
  const kv = new Map<string, string>();
  for (const part of body.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) return null;
    kv.set(part.slice(0, i).trim().toUpperCase(), part.slice(i + 1).trim());
  }
  const freq = (Object.keys(FREQ_CODES) as Freq[]).find(
    (f) => FREQ_CODES[f] === kv.get("FREQ")?.toUpperCase(),
  );
  if (!freq) return null;
  const interval = kv.has("INTERVAL") ? Number(kv.get("INTERVAL")) : 1;
  if (!Number.isInteger(interval) || interval < 1) return null;
  const out: Recurrence = { freq, interval };
  const byday = kv.get("BYDAY");
  if (byday) {
    const days: number[] = [];
    for (const code of byday.split(",")) {
      const i = DAY_CODES.indexOf(code.trim().toUpperCase());
      if (i < 0) return null;
      days.push(i);
    }
    out.byWeekday = days;
  }
  const count = kv.get("COUNT");
  if (count !== undefined) {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1) return null;
    out.count = n;
  }
  const until = kv.get("UNTIL");
  if (until !== undefined) {
    const compact = /^(\d{4})(\d{2})(\d{2})/.exec(until);
    const day = isoToDay(compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : until);
    if (day === null) return null;
    out.until = day;
  }
  return out;
}
