import type { Host } from "./host.ts";
import type { VaultBridge, VaultResult } from "./vaultBridge.ts";

/**
 * The Android app's side of the page (`window.boniAndroid`, apps/android/AndroidBridge.kt). A call
 * starts work on the phone and returns at once; when the answer is ready the app calls
 * `window.__boniReply(id)` and the page fetches it with `take(id)` (a JSON text).
 */
export interface AndroidNative {
  call(id: string, method: string, args: string): void;
  take(id: string): string;
}

type Answer = VaultResult<unknown>;

/** The vault bridge and the downloader over the Android app (same contract as the desktop shell). */
export function androidHost(native: AndroidNative): {
  vault: VaultBridge;
  fetchText: NonNullable<Host["fetchText"]>;
  network: NonNullable<Host["network"]>;
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
  const call = <T>(method: string, ...args: unknown[]): Promise<VaultResult<T>> =>
    new Promise((resolve) => {
      const id = String(++seq);
      pending.set(id, resolve as (a: Answer) => void);
      native.call(id, method, JSON.stringify(args));
    });

  const vault: VaultBridge = {
    getRoot: () => call("getRoot"),
    chooseRoot: () => call("chooseRoot"),
    scan: (dir) => call("scan", dir),
    read: (path) => call("read", path),
    write: (path, text, expected) => call("write", path, text, expected),
    create: (path, text) => call("create", path, text),
    rename: (from, to) => call("rename", from, to),
    trash: (path) => call("trash", path),
    openNote: (path) => call("openNote", path),
    cacheRead: () => call("cacheRead"),
    cacheWrite: (text) => call("cacheWrite", text),
  };
  return {
    vault,
    fetchText: (url) => call<string>("fetchText", url),
    network: {
      allowed: async () => {
        const r = await call<boolean>("networkAllowed");
        return !r.ok || r.value !== false;
      },
      openSettings: () => void call("openAppSettings"),
    },
  };
}
