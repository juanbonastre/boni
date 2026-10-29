import type { Host } from "./host.ts";
import type { NotesBridge, NotesResult } from "./notesBridge.ts";

/**
 * The Android app's side of the page (`window.boniAndroid`, apps/calendar-android/AndroidBridge.kt). A call
 * starts work on the phone and returns at once; when the answer is ready the app calls
 * `window.__boniReply(id)` and the page fetches it with `take(id)` (a JSON text).
 */
export interface AndroidNative {
  call(id: string, method: string, args: string): void;
  take(id: string): string;
}

type Answer = NotesResult<unknown>;

/**
 * The downloader, the network, the reminders and «Abrir en Boni» over the Android app: a record opens in Boni's own
 * Android app (a `boni://note?id=` link; no peek on a phone).
 */
export function androidHost(native: AndroidNative): {
  notes: NotesBridge | null;
  fetchText: NonNullable<Host["fetchText"]>;
  network: NonNullable<Host["network"]>;
  notify: NonNullable<Host["notify"]>;
} {
  let seq = 0;
  const pending = new Map<string, (a: Answer) => void>();
  (window as unknown as { __boniReply: (id: string) => void }).__boniReply = (id) => {
    const done = pending.get(id);
    if (!done) return;
    pending.delete(id);
    let answer: Answer;
    try {
      answer = JSON.parse(native.take(id)) as Answer;
    } catch (e) {
      answer = { ok: false, code: "bad-answer", message: String(e) };
    }
    done(answer);
  };
  const call = <T>(method: string, ...args: unknown[]): Promise<NotesResult<T>> =>
    new Promise((resolve) => {
      const id = String(++seq);
      pending.set(id, resolve as (a: Answer) => void);
      native.call(id, method, JSON.stringify(args));
    });

  return {
    notes: {
      noteApp: "boni",
      peek: false,
      openNote: (id) => call<null>("openBoniNote", id),
    },
    fetchText: (url) => call<string>("fetchText", url),
    network: {
      allowed: async () => {
        const r = await call<boolean>("networkAllowed");
        return !r.ok || r.value !== false;
      },
      openSettings: () => void call("openAppSettings"),
    },
    // Reminders become system alarms and notifications, also with the app closed.
    notify: {
      schedule: (list) => void call("scheduleNotices", JSON.stringify(list)),
      server: (cfg) => void call("serverSync", cfg ? JSON.stringify(cfg) : null),
      onOpen: (cb) => {
        // A tapped notification: now (the app was running) or the one that started the app.
        (window as unknown as { __boniOpenNotice: (id: string) => void }).__boniOpenNotice = cb;
        void call<string | null>("takeOpenEvent").then((r) => {
          if (r.ok && r.value) cb(r.value);
        });
      },
    },
  };
}
