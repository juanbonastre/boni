/**
 * The links an event carries (task 49): the http(s) addresses in its place and its description, and among them the
 * video call's (Zoom, Meet, Teams, Webex, Jitsi, Whereby…), which the apps offer to join from ten minutes before
 * the start until the end. Text in, addresses out: the apps open them through their host, never as markup.
 */
import type { CalEvent } from "./model.ts";

const URL_RE = /https?:\/\/[^\s<>"'()]+/g;
/** Hosts of video calls, by the end of the address's host name. */
const CALL_HOSTS =
  /(?:^|\.)(?:zoom\.us|zoom\.com|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|meet\.jit\.si|whereby\.com|gotomeeting\.com|bluejeans\.com)$/i;
/** Ten minutes before a call starts, the apps offer to join. */
export const JOIN_BEFORE_MS = 10 * 60_000;

/** The http(s) addresses in an event's place and description, in that order, each once, at most eight. */
export function linksOf(ev: Pick<CalEvent, "location" | "description">): string[] {
  const out: string[] = [];
  for (const text of [ev.location, ev.description]) {
    for (const m of text.matchAll(URL_RE)) {
      const url = m[0].replace(/[.,;:!?]+$/, "");
      try {
        const u = new URL(url);
        if ((u.protocol === "https:" || u.protocol === "http:") && !out.includes(url))
          out.push(url);
      } catch {
        // not an address after all
      }
      if (out.length >= 8) return out;
    }
  }
  return out;
}

/** The host name an address is shown by («example.zoom.us»). */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The event's video call, when one of its links is one. */
export function videoLink(ev: Pick<CalEvent, "location" | "description">): string | null {
  return linksOf(ev).find((u) => CALL_HOSTS.test(hostOf(u))) ?? null;
}

/** Whether `now` is when the apps offer to join: a timed event, from ten minutes before it starts until it ends. */
export function joinWindow(ev: Pick<CalEvent, "when">, now: number): boolean {
  return ev.when.kind === "timed" && now >= ev.when.start - JOIN_BEFORE_MS && now <= ev.when.end;
}
