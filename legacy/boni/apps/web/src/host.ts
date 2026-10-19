import { type AndroidNative, androidHost } from "./android.ts";
import type { Transport, TransportAnswer } from "./core/api.ts";
import type { Widget } from "./core/contract.ts";
import type { TextStore } from "./core/storage.ts";
import type { Lang } from "./i18n.ts";

/**
 * Everything the interface needs from where it runs (as `host.ts` in Boni Calendar). The desktop app (Electron)
 * provides it through `window.boniDesktop` (preload.cjs): the login, every request and the live changes go through
 * the main process (the server has no CORS, and the password and the token never reach the page), files live in the
 * user's folders. The Android app does the same through `window.boniAndroid` (android.ts). A plain browser
 * (development, e2e tests) talks to the same origin and keeps everything in localStorage.
 */

export type Theme = "system" | "dark" | "light";

/** What the page may know of the settings: never the token itself. */
export interface ClientSettings {
  serverUrl: string;
  hasToken: boolean;
  /** Who is logged in, and this device's name (widgets and preferences are per device). */
  user: string;
  device: string;
  /** A device token of the first clients (from before accounts): it works, but the page asks to log in. */
  legacyToken: boolean;
  /** The server said the session is over (90 idle days, a new password): log in again. */
  sessionEnded: boolean;
  /** The live connection to the server is open (changes arrive at once; no polling). */
  live: boolean;
  /** The server is from before live changes: no live connection, but not offline either. */
  liveUnsupported?: boolean;
  theme: Theme;
  language: Lang;
  showWidgets: boolean;
  /** Widgets hidden on this computer (they stay on the server for the others). */
  hiddenWidgets: string[];
  autostart: boolean;
  /** Desktop only: whether widgets can be kept below the windows (X11 with wmctrl). */
  layerAvailable: boolean;
}

export interface SettingsPatch {
  theme?: Theme;
  language?: Lang;
  showWidgets?: boolean;
  autostart?: boolean;
  /** Hide or show one widget on this computer. */
  widgetHidden?: { id: string; hidden: boolean };
  /** Forget where the widgets were moved and show the hidden ones again. */
  resetWidgets?: boolean;
}

export interface LoginForm {
  serverUrl: string;
  user: string;
  password: string;
  device: string;
}

export type LoginAnswer =
  | { ok: true; settings: ClientSettings }
  | {
      ok: false;
      code: "bad-url" | "missing" | "offline" | "bad-login" | "too-many" | "old-server" | "server";
    };

/** Messages the desktop shell sends to a page. */
export type ShellEvent =
  /** Every minute to one page (the coordinator): send the offline queue; reload when there is no live connection. */
  | { type: "tick"; minute: number }
  /** The server changed something (live): load that again. "all" after a (re)connection or a login. */
  | { type: "changed"; what: "charts" | "widgets" | "data" | "shortcuts" | "all" }
  /** Reload charts and lists (tray "Refresh", a change made in another window). */
  | { type: "refresh" }
  /** Open something in the main window (tray, widget menu): "capture", "settings", "chart:<id>", "edit:<id>". */
  | { type: "navigate"; screen: string }
  /** The settings changed (another window, the live connection, a login). */
  | { type: "settings"; settings: ClientSettings };

export interface DesktopHost {
  /** This device's widget list changed (from the server): the shell opens, closes and resizes their windows. */
  setWidgets(widgets: Widget[]): void;
  /** Ask the other windows to reload (after a change made here). */
  broadcastRefresh(): void;
  /** Bring up the main window, optionally on something (see ShellEvent "navigate"). */
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

/** A launcher entry: what it opens ("shortcut:<id>", "chart:<id>"), its name and colour. */
export interface LaunchTarget {
  target: string;
  label: string;
  color: string | null;
}

/** What only a phone has (the Android app): home-screen shortcuts. */
export interface PhoneHost {
  /** Asks the launcher to pin a shortcut to `target` on the home screen; false if it cannot. */
  pin(entry: LaunchTarget): Promise<boolean>;
  /**
   * Every shortcut and chart, so pinned entries keep their names and those whose target is gone stop working;
   * the first `menu` of them also show when the app's icon is held.
   */
  setTargets(entries: LaunchTarget[], menu: number): void;
  /** What a launcher entry opened when it started the app (once). Later ones arrive as "navigate" events. */
  takeLaunch(): Promise<string | null>;
  /** A picture page (a home-screen widget) has drawn its chart: the app takes the picture now. */
  pictureReady(): void;
}

export interface Host {
  transport: Transport;
  store: TextStore;
  getSettings(): Promise<ClientSettings>;
  setSettings(patch: SettingsPatch): Promise<ClientSettings>;
  login(form: LoginForm): Promise<LoginAnswer>;
  logout(): Promise<ClientSettings>;
  /** The device name offered at the first login (an old token's device, or the computer's name). */
  suggestedDevice(): Promise<string>;
  onEvent(cb: (e: ShellEvent) => void): () => void;
  desktop: DesktopHost | null;
  phone: PhoneHost | null;
  /** The host holds a live connection to the server (desktop, Android): without it, "offline" means nothing. */
  live: boolean;
}

declare global {
  interface Window {
    boniAndroid?: AndroidNative;
    boniDesktop?: {
      request(method: string, path: string, body?: unknown): Promise<TransportAnswer>;
      storeRead(name: string): Promise<string | null>;
      storeWrite(name: string, text: string): Promise<void>;
      storeRemove(name: string): Promise<void>;
      getSettings(): Promise<ClientSettings>;
      setSettings(patch: SettingsPatch): Promise<ClientSettings>;
      login(form: LoginForm): Promise<LoginAnswer>;
      logout(): Promise<ClientSettings>;
      suggestedDevice(): Promise<string>;
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
    login: (form) => b.login(form),
    logout: () => b.logout(),
    suggestedDevice: () => b.suggestedDevice(),
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
    phone: null,
    live: true,
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
  user: "",
  device: "",
  legacyToken: false,
  sessionEnded: false,
  live: false,
  theme: "dark",
  language: "es",
  showWidgets: false,
  hiddenWidgets: [],
  autostart: false,
  layerAvailable: false,
};

/**
 * A plain browser (development with `make dev`, which proxies /api to BONI_SERVER): same-origin requests,
 * localStorage for the rest, no live connection (the minute ticks reload).
 */
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
  const write = (next: Partial<ClientSettings>) => {
    const { hasToken: _h, ...current } = read();
    safeSet(SETTINGS_KEY, JSON.stringify({ ...current, ...next }));
    const s = read();
    for (const l of listeners) l({ type: "settings", settings: s });
    return s;
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
      const { resetWidgets: _reset, widgetHidden, ...rest } = patch;
      const hidden = new Set(read().hiddenWidgets);
      if (widgetHidden) {
        if (widgetHidden.hidden) hidden.add(widgetHidden.id);
        else hidden.delete(widgetHidden.id);
      }
      return write({ ...rest, hiddenWidgets: [...hidden] });
    },
    async login(form) {
      try {
        const r = await fetch("/api/v1/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user: form.user, password: form.password, device: form.device }),
        });
        if (r.status === 401) return { ok: false, code: "bad-login" };
        if (r.status === 429) return { ok: false, code: "too-many" };
        if (!r.ok) return { ok: false, code: "server" };
        const j = await r.json();
        safeSet(TOKEN_KEY, j.token);
        return {
          ok: true,
          settings: write({
            serverUrl: form.serverUrl,
            user: j.user,
            device: j.device,
            sessionEnded: false,
          }),
        };
      } catch {
        return { ok: false, code: "offline" };
      }
    },
    async logout() {
      safeSet(TOKEN_KEY, null);
      return write({ user: "" });
    },
    suggestedDevice: async () => "navegador",
    onEvent(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    desktop: null,
    phone: null,
    live: false,
  };
}

export const host: Host =
  typeof window === "undefined"
    ? browserHost()
    : window.boniDesktop
      ? desktopHost(window.boniDesktop)
      : window.boniAndroid
        ? androidHost(window.boniAndroid)
        : browserHost();
