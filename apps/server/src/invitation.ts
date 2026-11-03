/**
 * A calendar invitation read out of a mail by code (task 45): the event its `text/calendar` part describes, with
 * its day and hours in the user's timezone, its place and its video-call link, and the UID every calendar keeps it
 * under. Nothing here needs a model: an invitation says exactly when and where (2026-11-03: the reader gave no
 * hour for «5pm – 6pm», and the card asked «¿A las 09:00?» for a meeting at five).
 */
import { parseIcal, toLocal } from "@boni/calendar";

export interface Invitation {
  /** The event's id in every calendar that holds it (`ext:<calendar>:<uid>` in Boni Calendar's feeds). */
  uid: string;
  title: string;
  /** REQUEST (an invitation), CANCEL, REPLY or PUBLISH; null when the file does not say. */
  method: string | null;
  /** YYYY-MM-DD in `tz`. */
  day: string;
  /** HH:MM in `tz`; null for an all-day event, and `end` null too when the event ends another day. */
  start: string | null;
  end: string | null;
  tz: string;
  location: string;
  /** The video call's link (Zoom, Meet, Teams, Webex, Jitsi), else the first link in the place, else null. */
  link: string | null;
}

const MS_DAY = 86_400_000;
const CALL =
  /zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|meet\.jit\.si|whereby\.com/i;
const URL_RE = /https?:\/\/[^\s<>"'()]+/g;
const pad2 = (n: number) => String(n).padStart(2, "0");

/** ICS lines, with the folded ones joined (RFC 5545: a continuation line starts with a space or a tab). */
const unfold = (text: string) => text.replace(/\r?\n[ \t]/g, "");

/** The invitation in a mail's calendar part, or null when it holds no event or cannot be read. */
export function invitationOf(text: string, tz: string): Invitation | null {
  if (!/BEGIN:VEVENT/i.test(text)) return null;
  let events: ReturnType<typeof parseIcal>["events"];
  try {
    events = parseIcal(text, { calendarId: "inv", defaultTz: tz }).events;
  } catch {
    return null;
  }
  const flat = unfold(text);
  const method = /^METHOD:([A-Za-z-]+)/m.exec(flat)?.[1]?.toUpperCase() ?? null;
  const uid = /^UID:(.+)$/m.exec(flat)?.[1]?.trim() ?? "";
  const ev = events.find((e) => e.id === `ext:inv:${uid}`) ?? events[0];
  if (!ev) return null;
  const dayOf = (day: number) => {
    const d = new Date(day * MS_DAY);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  };
  const hhmm = (minute: number) => {
    const m = Math.round(minute);
    return `${pad2(Math.floor(m / 60) % 24)}:${pad2(m % 60)}`;
  };
  let day: string;
  let start: string | null = null;
  let end: string | null = null;
  if (ev.when.kind === "timed") {
    const s = toLocal(ev.when.start, tz);
    const e = toLocal(ev.when.end, tz);
    day = dayOf(s.day);
    start = hhmm(s.minute);
    end = e.day === s.day && ev.when.end > ev.when.start ? hhmm(e.minute) : null;
  } else day = dayOf(ev.when.startDay);
  const clean = (u: string) => u.replace(/[.,;:]+$/, "");
  const links = [...`${ev.location}\n${ev.description}`.matchAll(URL_RE)].map((m) => clean(m[0]));
  const inPlace = [...ev.location.matchAll(URL_RE)].map((m) => clean(m[0]));
  return {
    uid: uid || ev.id.slice("ext:inv:".length),
    title: ev.title.replace(/\s+/g, " ").trim().slice(0, 200),
    method,
    day,
    start,
    end,
    tz,
    location: ev.location.replace(/\s+/g, " ").trim().slice(0, 500),
    link: links.find((u) => CALL.test(u)) ?? inPlace[0] ?? null,
  };
}

/** Whether a calendar's feed (its .ics text) holds the event with `uid`. */
export function feedHas(feed: string, uid: string): boolean {
  if (!uid) return false;
  const re = new RegExp(`^UID:${uid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
  return re.test(unfold(feed));
}

/** One line that says what the invitation is, for the card's «why» and the log: the title, the day and the hours. */
export function invitationLine(i: Invitation): string {
  const when = i.start ? `${i.day} ${i.start}${i.end ? `–${i.end}` : ""}` : i.day;
  return `Invitación: ${i.title} · ${when}${i.location ? ` · ${i.location}` : ""}`.slice(0, 500);
}
