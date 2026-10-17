import type { Transport, TransportAnswer } from "./core/api.ts";
import type { Widget } from "./core/contract.ts";
import type { TextStore } from "./core/storage.ts";
import type { Lang } from "./i18n.ts";

/**
 * Everything the interface needs from where it runs (as `host.ts` in Boni Calendar). The desktop app (Electron)
 * provides it through `window.boniDesktop` (preload.cjs): requests go through the main process (the server has no
 * CORS and the token never reaches the page), files live in the user's folders. A plain browser (development, e2e
 * tests) talks to the same origin and keeps everything in localStorage.
 */

export type Theme = "system" | "dark" | "light";

/** What the page may know of the settings: never the token itself. */
export interface ClientSettings {
  serverUrl: string;
  hasToken: boolean;
  theme: Theme;
  language: Lang;
  showWidgets: boolean;
  autostart: boolean;
  /** Desktop only: whether widgets can be kept below the windows (X11 with wmctrl). */
  layerAvailable: boolean;
}

export interface SettingsPatch {
  serverUrl?: string;
  /** A new token (never read back). */
  token?: string;
  theme?: Theme;
  language?: Lang;
  showWidgets?: boolean;
  autostart?: boolean;
  /** Forget where the widgets were moved and show the hidden ones again. */
  resetWidgets?: boolean;
}

/** Messages the desktop shell sends to a page. */
export type ShellEvent =
  /** Every minute to one page (the coordinator): send the offline queue; every 15th also reload. */
  | { type: "tick"; minute: number }
  /** Reload charts and lists (tray "Refresh", a chart or widget changed in another window). */
  | { type: "refresh" }
  /** Open a screen of the main window (tray, widget menu). */
  | { type: "navigate"; screen: string }
  /** The settings changed in another window. */
  | { type: "settings"; settings: ClientSettings };

export interface DesktopHost {
  /** This device's widget list changed (from the server): the shell opens, closes and resizes their windows. */
  setWidgets(widgets: Widget[]): void;
  /** Ask the other windows to reload (after a change made here). */
  broadcastRefresh(): void;
  /** Bring up the main window, optionally on a screen. */
  openMain(screen?: string): void;
  /** The tray menu speaks the app's language. */
  setLabels(labels: Record<string, string>): void;
  /** Widget windows: moved or resized by the user (the shell follows the real pointer), hidden from the menu. */
  widget: {
    dragStart(kind: "move" | "resize"): void;
    dragMove(): void;
    dragEnd(): void;
    hide(): void;
  };
}

export interface Host {
  transport: Transport;
  store: TextStore;
  getSettings(): Promise<ClientSettings>;
  setSettings(patch: SettingsPatch): Promise<ClientSettings>;
  onEvent(cb: (e: ShellEvent) => void): () => void;
  desktop: DesktopHost | null;
}

declare global {
  interface Window {
    boniDesktop?: {
      request(method: string, path: string, body?: unknown): Promise<TransportAnswer>;
      storeRead(name: string): Promise<string | null>;
      storeWrite(name: string, text: string): Promise<void>;
      storeRemove(name: string): Promise<void>;
      getSettings(): Promise<ClientSettings>;
      setSettings(patch: SettingsPatch): Promise<ClientSettings>;
      onEvent(cb: (e: ShellEvent) => void): () => void;
      setWidgets(widgets: Widget[]): void;
      broadcastRefresh(): void;
      openMain(screen?: string): void;
      setLabels(labels: Record<string, string>): void;
      widgetDragStart(kind: "move" | "resize"): void;
      widgetDragMove(): void;
      widgetDragEnd(): void;
      widgetHide(): void;
    };
  }
}

function desktopHost(b: NonNullable<Window["boniDesktop"]>): Host {
  return {
    transport: { request: (method, path, body) => b.request(method, path, body) },
    store: {
      read: (name) => b.storeRead(name),
      write: (name, text) => b.storeWrite(name, text),
      remove: (name) => b.storeRemove(name),
    },
    getSettings: () => b.getSettings(),
    setSettings: (patch) => b.setSettings(patch),
    onEvent: (cb) => b.onEvent(cb),
    desktop: {
      setWidgets: (w) => b.setWidgets(w),
      broadcastRefresh: () => b.broadcastRefresh(),
      openMain: (screen) => b.openMain(screen),
      setLabels: (labels) => b.setLabels(labels),
      widget: {
        dragStart: (kind) => b.widgetDragStart(kind),
        dragMove: () => b.widgetDragMove(),
        dragEnd: () => b.widgetDragEnd(),
        hide: () => b.widgetHide(),
      },
    },
  };
}

const PREFIX = "boni:";
const SETTINGS_KEY = `${PREFIX}settings`;
const TOKEN_KEY = `${PREFIX}token`;

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // private window: nothing is kept
  }
}

const DEFAULTS: ClientSettings = {
  serverUrl: "",
  hasToken: false,
  theme: "system",
  language: "es",
  showWidgets: false,
  autostart: false,
  layerAvailable: false,
};

/** A plain browser: same-origin requests (the dev server proxies /api), localStorage for the rest. */
export function browserHost(): Host {
  const listeners = new Set<(e: ShellEvent) => void>();
  const read = (): ClientSettings => {
    let saved: Partial<ClientSettings> = {};
    try {
      saved = JSON.parse(safeGet(SETTINGS_KEY) ?? "{}");
    } catch {
      saved = {};
    }
    return { ...DEFAULTS, ...saved, hasToken: Boolean(safeGet(TOKEN_KEY)) };
  };
  return {
    transport: {
      async request(method, path, body): Promise<TransportAnswer> {
        const s = read();
        const token = safeGet(TOKEN_KEY);
        if (!s.serverUrl || !token) return { ok: false, offline: false, notConfigured: true };
        try {
          const r = await fetch(`/${path}`, {
            method,
            headers: {
              Authorization: `Bearer ${token}`,
              "X-Boni-Client": "boni-web",
              ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(30_000),
          });
          return { ok: true, status: r.status, body: await r.text() };
        } catch (e) {
          return { ok: false, offline: true, message: String((e as Error).message ?? e) };
        }
      },
    },
    store: {
      read: async (name) => safeGet(`${PREFIX}store:${name}`),
      write: async (name, text) => safeSet(`${PREFIX}store:${name}`, text),
      remove: async (name) => safeSet(`${PREFIX}store:${name}`, null),
    },
    getSettings: async () => read(),
    async setSettings(patch) {
      const { token, resetWidgets: _reset, ...rest } = patch;
      if (token !== undefined) safeSet(TOKEN_KEY, token.trim() || null);
      const { hasToken: _h, ...current } = read();
      safeSet(SETTINGS_KEY, JSON.stringify({ ...current, ...rest }));
      const next = read();
      for (const l of listeners) l({ type: "settings", settings: next });
      return next;
    },
    onEvent(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    desktop: null,
  };
}

export const host: Host =
  typeof window !== "undefined" && window.boniDesktop
    ? desktopHost(window.boniDesktop)
    : browserHost();
