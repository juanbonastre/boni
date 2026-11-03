// What the screen shows while the app waits (docs/design-guide.md «Waiting», I-15): the requests in flight, counted, and whether the line at the top shows: after 250 ms, for 500 ms at least, one line for everything.
import { useSyncExternalStore } from "react";

/** Under this an answer feels instant (Material 3: nothing under 200 ms; NN/g: 0.1 s): the line never shows. */
export const SHOW_AFTER = 250;
/** Once shown, the line stays this long: a flash says less than nothing (NN/g, display inertia). */
export const SHOWN_FOR = 500;

let inFlight = 0;
let shown = false;
let shownAt = 0;
let showTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

/** A request starts; what it returns ends it (once: a second call does nothing). */
export function begin(): () => void {
  inFlight++;
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (!shown && !showTimer)
    showTimer = setTimeout(() => {
      showTimer = null;
      if (inFlight === 0) return;
      shown = true;
      shownAt = Date.now();
      emit();
    }, SHOW_AFTER);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    inFlight = Math.max(0, inFlight - 1);
    if (inFlight > 0) return;
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = null;
    }
    if (!shown) return;
    const left = SHOWN_FOR - (Date.now() - shownAt);
    hideTimer = setTimeout(
      () => {
        hideTimer = null;
        if (inFlight > 0) return;
        shown = false;
        emit();
      },
      Math.max(0, left),
    );
  };
}

/** Runs `p` as a request the line counts, whatever it ends in. */
export async function tracked<T>(p: Promise<T>): Promise<T> {
  const end = begin();
  try {
    return await p;
  } finally {
    end();
  }
}

export const waiting = (): boolean => shown;

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Whether the line at the top shows now (a React hook). */
export function useWaiting(): boolean {
  return useSyncExternalStore(subscribe, waiting, () => false);
}

/** Tests only: as if nothing had ever been asked. */
export function resetWaiting(): void {
  inFlight = 0;
  shown = false;
  if (showTimer) clearTimeout(showTimer);
  if (hideTimer) clearTimeout(hideTimer);
  showTimer = null;
  hideTimer = null;
}
