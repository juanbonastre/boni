/**
 * Boni's window as this device keeps it (docs/sistema.md §4.7, F9; task 85, sixth part; I-35): where Juan dragged it,
 * how it was (closed, floating, docked), the last conversation and what was being written to each. A preference of
 * the device (`boni-window.json`, docs/preferencias.md: neither his data nor the account's), read back after a
 * restart; what the file holds is checked here, so a broken or old one opens the window as it always did.
 */
import type { Draft, Drafts } from "./drafts.ts";
import { MAX_POINTED, type Pointed, readRef } from "./pointing.ts";

export type WindowMode = "closed" | "float" | "right";
/** Where the floating window is: its distance, in CSS pixels, from the right and the bottom of the app's window. */
export interface Place {
  right: number;
  bottom: number;
}
export interface KeptWindow {
  mode: WindowMode;
  place: Place | null;
  conversation: string | null;
  drafts: Drafts;
}

/** The device file it lives in. */
export const WINDOW_FILE = "boni-window.json";
/** The least it keeps from each edge of the app's window: always inside it, its bar always within reach. */
export const EDGE = 8;
/** How many conversations' drafts it keeps (the last ones written to), and how long each text may be. */
const MAX_DRAFTS = 20;
const MAX_TEXT = 20_000;

const id = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 80;
const px = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x) && x >= 0 && x < 100_000;

/**
 * A place kept inside the app's window: the window `box` wide and high, in a `view` of that size, at least `EDGE` from
 * each side (when the view is smaller than the window, its top left corner wins: the bar stays reachable).
 */
export function clampPlace(
  place: Place,
  box: { width: number; height: number },
  view: { width: number; height: number },
): Place {
  const within = (v: number, max: number) => Math.round(Math.max(EDGE, Math.min(v, max)));
  return {
    right: within(place.right, view.width - box.width - EDGE),
    bottom: within(place.bottom, view.height - box.height - EDGE),
  };
}

function readDraft(v: unknown): Draft | null {
  if (!v || typeof v !== "object") return null;
  const d = v as Record<string, unknown>;
  const text = typeof d.text === "string" ? d.text.slice(0, MAX_TEXT) : "";
  const pointed: Pointed[] = [];
  for (const p of Array.isArray(d.pointed) ? d.pointed.slice(0, MAX_POINTED) : []) {
    const o = p as Record<string, unknown> | null;
    const ref = o && typeof o.title === "string" ? readRef(JSON.stringify(o.ref)) : null;
    if (ref && o) pointed.push({ ref, title: (o.title as string).slice(0, 120) });
  }
  return text || pointed.length ? { text, pointed } : null;
}

/** What the device file says, checked: anything off is left out, never the whole thing in doubt. */
export function readKept(raw: unknown): KeptWindow {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const mode: WindowMode = o.mode === "float" || o.mode === "right" ? o.mode : "closed";
  const p = o.place as Record<string, unknown> | null | undefined;
  const place = p && px(p.right) && px(p.bottom) ? { right: p.right, bottom: p.bottom } : null;
  const conversation = id(o.conversation) ? o.conversation : null;
  const drafts: Record<string, Draft> = {};
  const given = o.drafts && typeof o.drafts === "object" ? Object.entries(o.drafts) : [];
  for (const [k, v] of given.slice(-MAX_DRAFTS)) {
    const d = id(k) ? readDraft(v) : null;
    if (d) drafts[k] = d;
  }
  return { mode, place, conversation, drafts };
}

/**
 * What the window is after a restart: what was kept, except what Juan did while the file was read (`Ctrl+E` at
 * once, a conversation opened, something typed), which wins. `onChat`: the Conversación screen is open, so the window
 * stays closed under it.
 */
export function restored(now: KeptWindow, kept: KeptWindow, onChat: boolean): KeptWindow {
  return {
    mode: now.mode !== "closed" || onChat ? now.mode : kept.mode,
    place: now.place ?? kept.place,
    // Something already typed to a new conversation stays in view: the kept one is in «Recientes».
    conversation: now.conversation ?? (now.drafts.new ? null : kept.conversation),
    drafts: { ...kept.drafts, ...now.drafts },
  };
}

/** What goes to the device file: the drafts of the last conversations written to, no more. */
export function toKept(k: KeptWindow): KeptWindow {
  const drafts = Object.fromEntries(Object.entries(k.drafts).slice(-MAX_DRAFTS));
  return { ...k, drafts };
}
