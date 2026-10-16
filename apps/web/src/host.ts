import type { Settings } from "./store.ts";
import type { VaultBridge } from "./vaultBridge.ts";

/** Small per-device key-value storage for settings and UI state. */
export interface HostStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/**
 * What the app needs from the place it runs in. The standalone app (a browser tab or the desktop
 * shell) owns the whole window, keeps its settings in localStorage and finds the vault bridge on
 * `window.boniVault`. Another host (the Obsidian plugin) mounts it inside one of its own elements
 * and hands over its own bridge and storage.
 */
export interface Host {
  /** Notes of the vault, or null when there is none (plain browser: sample data only). */
  vault: VaultBridge | null;
  storage: HostStorage;
  /**
   * "window": the app is the whole page and its shortcuts work wherever the focus is. "root": the
   * app shares the window with others, so shortcuts work only while the focus is inside the app.
   */
  keys: "window" | "root";
  /** Settings the app starts with until the user changes them. */
  settings?: Partial<Settings>;
  /** The host always shows the vault it runs in (the Obsidian plugin): there is no folder to choose. */
  fixedVault?: boolean;
}

export const localStorageStore: HostStorage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage can be unavailable (private windows, previews); the app works without it.
    }
  },
};

let host: Host = { vault: null, storage: localStorageStore, keys: "window" };
let root: HTMLElement | null = null;

/** Set before the store is first imported: the store reads the host when it is created. */
export function setHost(next: Host): void {
  host = next;
}

export const getHost = (): Host => host;

/** The element the app is mounted in (it carries the theme and scopes the CSS). */
export function setAppRoot(el: HTMLElement | null): void {
  root = el;
}

export const appRoot = (): HTMLElement | null => root;

/** The first element inside the app that matches `selector`. */
export function findInApp<T extends Element = HTMLElement>(selector: string): T | null {
  return (root ?? document).querySelector<T>(selector);
}

/** The app's box in viewport coordinates: overlays are placed and kept inside it. */
export function appRect(): { left: number; top: number; right: number; bottom: number } {
  if (root) return root.getBoundingClientRect();
  return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
}

/** Elements under a viewport point, topmost first (also when the app lives in a shadow root). */
export function elementsAt(x: number, y: number): Element[] {
  const node = root?.getRootNode();
  return (node instanceof ShadowRoot ? node : document).elementsFromPoint(x, y);
}

/**
 * The element an event started on. Inside a shadow root `event.target` is the shadow host for
 * listeners outside it (on the window), so read the composed path instead.
 */
export function eventTarget(e: Event): HTMLElement | null {
  const t = e.composedPath()[0] ?? e.target;
  if (t instanceof Element) return t as HTMLElement;
  return t instanceof Node ? t.parentElement : null;
}

/** Where keyboard listeners go: the window, or the app's root when it shares the window. */
export function keyTarget(): HTMLElement | Window {
  return host.keys === "root" && root ? root : window;
}

/** Listens for key presses where the app's shortcuts live; returns the function that stops it. */
export function onKeys(handler: (e: KeyboardEvent) => void, capture = false): () => void {
  const target = keyTarget();
  const h = handler as EventListener;
  target.addEventListener("keydown", h, capture);
  return () => target.removeEventListener("keydown", h, capture);
}

/**
 * Takes the focus off whatever control has it. When the app shares the window the focus stays in
 * the app (on its root), so its shortcuts keep working.
 */
export function releaseFocus(): void {
  const node = root?.getRootNode() as Document | ShadowRoot | undefined;
  ((node ?? document).activeElement as HTMLElement | null)?.blur?.();
  if (host.keys === "root") root?.focus({ preventScroll: true });
}
