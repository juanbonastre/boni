import { type CalEvent, type CalendarDef, parseIcal } from "@boni-calendar/core";
import { getHost } from "./host.ts";

/**
 * Calendars of other services (Google Calendar...) subscribed by their iCal address, read-only.
 * The address of a private calendar is a secret: it lives only in this device's settings, never in
 * the vault or the repo. The last copy read is kept per device (IndexedDB) so the calendar still
 * shows without a connection.
 */
export interface ExternalCal {
  id: string;
  name: string;
  url: string;
  color: string;
}

export interface ExternalStatus {
  state: "loading" | "ok" | "error";
  /** When the copy shown was downloaded. */
  at?: number;
  events?: number;
  /** Repeating events whose rule could not be repeated (shown once). */
  unsupported?: number;
  message?: string;
}

/** The sidebar group of external calendars. */
export const EXTERNAL_ACCOUNT = "external";

export const isExternalCalendar = (id: string): boolean => id.startsWith("ext-");
/** Events of external calendars (and their occurrences) never become rows or notes. */
export const isExternalEvent = (e: CalEvent): boolean => e.id.startsWith("ext:");

export const newExternalId = (): string => `ext-${Math.random().toString(36).slice(2, 10)}`;

export function externalDef(c: ExternalCal, visible: boolean): CalendarDef {
  return {
    id: c.id,
    accountId: EXTERNAL_ACCOUNT,
    name: c.name,
    color: c.color,
    visible,
    readOnly: true,
    schema: [],
  };
}

const DB = "boni-calendar-external";
const STORE = "feeds";

function withStore<T>(
  mode: IDBTransactionMode,
  op: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB, 1);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction(STORE, mode);
        const r = op(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(r.result);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          resolve(null);
        };
      } catch {
        db.close();
        resolve(null);
      }
    };
  });
}

interface Cached {
  text: string;
  at: number;
}

/** The last copy downloaded for a calendar, or null. */
export async function cachedFeed(id: string): Promise<Cached | null> {
  const v = await withStore("readonly", (s) => s.get(id) as IDBRequest<Cached | undefined>);
  return v && typeof v.text === "string" ? v : null;
}

export async function saveFeed(id: string, text: string, at: number): Promise<void> {
  await withStore("readwrite", (s) => s.put({ text, at } satisfies Cached, id));
}

export async function forgetFeed(id: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(id));
}

/** Downloads a feed through the host (the desktop shell or Obsidian: no browser CORS rules). */
export async function downloadFeed(url: string): Promise<string> {
  const fetchText = getHost().fetchText;
  if (!fetchText) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  }
  const r = await fetchText(url);
  if (!r.ok) throw new Error(r.message);
  return r.value;
}

/** Events of a feed, or an error when the text is not a calendar at all. */
export function readFeed(c: ExternalCal, text: string, tz: string) {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("not-ical");
  return parseIcal(text, { calendarId: c.id, defaultTz: tz });
}
