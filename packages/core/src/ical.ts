import { parseRule } from "./codec.ts";
import type { CalEvent, When } from "./model.ts";
import { type CivilDay, daysFromCivil, fromLocal, MS_DAY, toLocal } from "./time.ts";

/**
 * Reads an iCalendar feed (RFC 5545, as Google Calendar and others publish it at an "iCal address")
 * into read-only calendar events. Supported: VEVENT with DTSTART / DTEND or DURATION (date, local time
 * with TZID, floating or UTC), SUMMARY, LOCATION, DESCRIPTION, RRULE (the subset `parseRule` knows),
 * EXDATE, RECURRENCE-ID (a changed occurrence becomes its own event) and STATUS:CANCELLED. A rule
 * outside the subset (e.g. "the second Tuesday") keeps only its first occurrence and is counted in
 * `unsupported`, so nothing is silently wrong.
 */
export interface IcalResult {
  /** X-WR-CALNAME, when the feed has one. */
  name: string | null;
  events: CalEvent[];
  /** Repeating events whose rule could not be repeated (shown once). */
  unsupported: number;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Joins folded lines (a line starting with a space or tab continues the previous one). */
function unfold(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += raw.slice(1);
    } else if (raw !== "") {
      out.push(raw);
    }
  }
  return out;
}

/** `NAME;PARAM=a;Q="x:y":value` (a colon inside a quoted parameter is not the separator). */
function parseLine(line: string): Prop | null {
  let i = 0;
  let quoted = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ":" && !quoted) break;
  }
  if (i >= line.length) return null;
  const [name = "", ...rawParams] = line.slice(0, i).split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
}

const unescapeText = (s: string): string =>
  s.replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));

const validTz = new Map<string, boolean>();
function isTz(tz: string): boolean {
  let ok = validTz.get(tz);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      ok = true;
    } catch {
      ok = false;
    }
    validTz.set(tz, ok);
  }
  return ok;
}

type Stamp = { kind: "date"; day: CivilDay } | { kind: "time"; ms: number; tz: string };

/** A DATE or DATE-TIME value. Times keep the zone they are written in (or `defaultTz`). */
function parseStamp(
  value: string,
  params: Record<string, string>,
  defaultTz: string,
): Stamp | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const day = daysFromCivil(Number(m[1]), Number(m[2]), Number(m[3]));
  if (params.VALUE === "DATE" || m[4] === undefined) return { kind: "date", day };
  const minute = Number(m[4]) * 60 + Number(m[5]) + Number(m[6] ?? 0) / 60;
  const tzid = params.TZID?.replace(/^\//, "");
  const tz = tzid && isTz(tzid) ? tzid : defaultTz;
  if (m[7] === "Z") return { kind: "time", ms: day * MS_DAY + minute * 60_000, tz };
  return { kind: "time", ms: fromLocal(day, minute, tz), tz };
}

/** "PT1H30M", "P1D", "P1W" (and a leading minus) in milliseconds. */
function parseDuration(value: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    value.trim(),
  );
  if (!m) return null;
  const n = (i: number) => Number(m[i] ?? 0);
  const ms = (((n(2) * 7 + n(3)) * 24 + n(4)) * 60 + n(5)) * 60_000 + n(6) * 1000;
  return m[1] === "-" ? -ms : ms;
}

/** The day an EXDATE or RECURRENCE-ID points at, in the event's own zone. */
function stampDay(s: Stamp, tz: string): CivilDay {
  return s.kind === "date" ? s.day : toLocal(s.ms, tz).day;
}

interface RawEvent {
  props: Prop[];
}

function get(e: RawEvent, name: string): Prop | undefined {
  return e.props.find((p) => p.name === name);
}

function whenOf(e: RawEvent, defaultTz: string): When | null {
  const dtstart = get(e, "DTSTART");
  if (!dtstart) return null;
  const start = parseStamp(dtstart.value, dtstart.params, defaultTz);
  if (!start) return null;
  const dtend = get(e, "DTEND");
  const end = dtend ? parseStamp(dtend.value, dtend.params, defaultTz) : null;
  const durProp = get(e, "DURATION");
  const dur = durProp ? parseDuration(durProp.value) : null;
  if (start.kind === "date") {
    // DTEND of an all-day event is exclusive; without it the event lasts one day.
    let last = start.day;
    if (end?.kind === "date") last = Math.max(start.day, end.day - 1);
    else if (dur !== null) last = start.day + Math.max(1, Math.round(dur / MS_DAY)) - 1;
    return { kind: "allday", startDay: start.day, endDay: last };
  }
  let endMs = start.ms;
  if (end?.kind === "time") endMs = end.ms;
  else if (dur !== null) endMs = start.ms + dur;
  return { kind: "timed", start: start.ms, end: Math.max(endMs, start.ms), tz: start.tz };
}

const stampMs = (v: string | undefined): number => {
  const m = v && /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(v);
  if (!m) return 0;
  const [y, mo, d, h, mi, sec] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return Date.UTC(y, mo - 1, d, h, mi, sec);
};

/**
 * Parses `text` into events of calendar `calendarId`. Ids are `ext:<calendarId>:<UID>` (a changed
 * occurrence adds `:<day>`), stable across refreshes so selection and caches survive them.
 */
export function parseIcal(
  text: string,
  opts: { calendarId: string; defaultTz: string },
): IcalResult {
  const { calendarId, defaultTz } = opts;
  let name: string | null = null;
  let calTz = defaultTz;
  const raw: RawEvent[] = [];
  let current: RawEvent | null = null;
  let depth = 0; // nesting inside the current VEVENT (VALARM...)
  for (const line of unfold(text)) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === "BEGIN") {
      if (p.value.toUpperCase() === "VEVENT" && !current) {
        current = { props: [] };
        depth = 0;
      } else if (current) depth++;
      continue;
    }
    if (p.name === "END") {
      if (current && depth > 0) depth--;
      else if (current && p.value.toUpperCase() === "VEVENT") {
        raw.push(current);
        current = null;
      }
      continue;
    }
    if (current) {
      if (depth === 0) current.props.push(p);
    } else if (p.name === "X-WR-CALNAME") name = unescapeText(p.value);
    else if (p.name === "X-WR-TIMEZONE" && isTz(p.value.trim())) calTz = p.value.trim();
  }

  const masters = new Map<string, CalEvent>();
  const overrides: { uid: string; day: CivilDay | null; ev: CalEvent | null }[] = [];
  const events: CalEvent[] = [];
  let unsupported = 0;
  let anon = 0;

  for (const e of raw) {
    const when = whenOf(e, calTz);
    if (!when) continue;
    const uid = get(e, "UID")?.value.trim() || `anon-${anon++}`;
    const cancelled = get(e, "STATUS")?.value.trim().toUpperCase() === "CANCELLED";
    const tz = when.kind === "timed" ? when.tz : calTz;
    const recId = get(e, "RECURRENCE-ID");
    const base: CalEvent = {
      id: `ext:${calendarId}:${uid}`,
      calendarId,
      title: unescapeText(get(e, "SUMMARY")?.value ?? ""),
      when,
      location: unescapeText(get(e, "LOCATION")?.value ?? ""),
      description: unescapeText(get(e, "DESCRIPTION")?.value ?? ""),
      props: {},
      isTask: false,
      done: false,
      created: stampMs(get(e, "CREATED")?.value),
      updated: stampMs(get(e, "LAST-MODIFIED")?.value ?? get(e, "DTSTAMP")?.value),
    };
    if (recId) {
      const s = parseStamp(recId.value, recId.params, calTz);
      const day = s ? stampDay(s, tz) : null;
      overrides.push({
        uid,
        day,
        ev: cancelled ? null : { ...base, id: `${base.id}:${day ?? anon++}` },
      });
      continue;
    }
    if (cancelled) continue;
    const rrule = get(e, "RRULE");
    if (rrule) {
      const rule = parseRule(rrule.value);
      if (rule) {
        const exdates: CivilDay[] = [];
        for (const ex of e.props.filter((p) => p.name === "EXDATE")) {
          for (const v of ex.value.split(",")) {
            const s = parseStamp(v, ex.params, calTz);
            if (s) exdates.push(stampDay(s, tz));
          }
        }
        const master: CalEvent = { ...base, recurrence: rule, exdates };
        masters.set(uid, master);
        events.push(master);
        continue;
      }
      unsupported++;
    }
    events.push(base);
  }

  // A changed or cancelled occurrence takes its day out of the series; a changed one shows on its own.
  for (const o of overrides) {
    const master = masters.get(o.uid);
    if (master && o.day !== null && !master.exdates?.includes(o.day)) {
      const i = events.indexOf(master);
      const next = { ...master, exdates: [...(master.exdates ?? []), o.day] };
      masters.set(o.uid, next);
      events[i] = next;
    }
    if (o.ev) events.push(o.ev);
  }
  return { name, events, unsupported };
}
