import type { TransportAnswer } from "./core/api.ts";
import type { ClientSettings, Host, LoginAnswer, ShellEvent } from "./host.ts";

/**
 * The Android app's side of the page (`window.boniAndroid`, apps/android/AndroidBridge.kt), as Boni Calendar's.
 * A call starts work on the phone and returns at once; when the answer is ready the app calls
 * `window.__boniReply(id)` and the page fetches it with `take(id)` (a JSON text, so large answers are never pasted
 * into JavaScript). Every answer is `{ ok: true, value }` or `{ ok: false, code, message }`.
 *
 * The app owns what the desktop shell owns: the login (the token is kept encrypted by the Android Keystore and
 * never reaches the page), every request to the server (it has no CORS), the live changes while the app is open,
 * the minute ticks, the small files (offline queue, last answers) and the settings. It sends events with
 * `window.__boniEvent(json)`, and asks `window.__boniBack()` what Back should close.
 */
export interface AndroidNative {
  call(id: string, method: string, args: string): void;
  take(id: string): string;
}

type Answer = { ok: true; value: unknown } | { ok: false; code: string; message: string };

export function androidHost(native: AndroidNative): Host {
  let seq = 0;
  const pending = new Map<string, (a: Answer) => void>();
  const listeners = new Set<(e: ShellEvent) => void>();
  const w = window as unknown as Record<string, unknown>;
  w.__boniReply = (id: string) => {
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
  w.__boniEvent = (json: string) => {
    let e: ShellEvent;
    try {
      e = JSON.parse(json) as ShellEvent;
    } catch {
      return;
    }
    for (const l of listeners) l(e);
  };
  const call = <T>(method: string, ...args: unknown[]): Promise<T> =>
    new Promise((resolve, reject) => {
      const id = `a${++seq}`;
      pending.set(id, (a) => (a.ok ? resolve(a.value as T) : reject(new Error(a.message))));
      native.call(id, method, JSON.stringify(args));
    });

  return {
    transport: {
      async request(method, path, body): Promise<TransportAnswer> {
        try {
          return await call<TransportAnswer>(
            "request",
            method,
            path,
            body === undefined ? null : JSON.stringify(body),
          );
        } catch (e) {
          return { ok: false, offline: true, message: (e as Error).message };
        }
      },
    },
    store: {
      read: (name) => call<string | null>("storeRead", name),
      write: (name, text) => call<null>("storeWrite", name, text).then(() => undefined),
      remove: (name) => call<null>("storeRemove", name).then(() => undefined),
    },
    getSettings: () => call<ClientSettings>("getSettings"),
    setSettings: (patch) => call<ClientSettings>("setSettings", JSON.stringify(patch)),
    async login(form) {
      try {
        return await call<LoginAnswer>("login", JSON.stringify(form));
      } catch {
        return { ok: false, code: "server" };
      }
    },
    logout: () => call<ClientSettings>("logout"),
    suggestedDevice: () => call<string>("suggestedDevice"),
    onEvent(cb) {
      listeners.add(cb);
      // The live connection may have come up before the page listened: start from the app's current settings.
      void call<ClientSettings>("getSettings")
        .then((settings) => cb({ type: "settings", settings }))
        .catch(() => undefined);
      return () => listeners.delete(cb);
    },
    desktop: null,
    live: true,
  };
}
