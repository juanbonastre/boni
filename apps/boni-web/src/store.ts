import type { PageSpec } from "@boni/views";
import { useMemo } from "react";
import { create } from "zustand";
import {
  AgentApi,
  type AiLevel,
  type ExtensionView,
  type MailGuide,
  type MailInput,
  type MailView,
  type Page,
  type PageInfo,
  type Proposal,
  type RunDetail,
  type RunSummary,
  type TurnResult,
  type Visibility,
} from "./core/agent.ts";
import { ApiError, BoniApi, NotConfiguredError, OfflineError } from "./core/api.ts";
import { normalize } from "./core/chartBuilder.ts";
import { ChartRepository, type ChartState } from "./core/charts.ts";
import { newId, nowIso, today } from "./core/clock.ts";
import {
  type ChartCatalog,
  type ChartSpec,
  type FormComponent,
  type Json,
  type Option,
  parseScreen,
  parseShortcut,
  parseSpec,
  type Screen,
  type Shortcut,
  type Widget,
} from "./core/contract.ts";
import * as F from "./core/formLogic.ts";
import { isPending, OfflineQueue, type QueuedAction } from "./core/queue.ts";
import { canSaveDirectly, filledValues, formOf } from "./core/shortcuts.ts";
import { readJson, type TextStore } from "./core/storage.ts";
import {
  type ClientSettings,
  host as defaultHost,
  type Host,
  type LoginAnswer,
  type LoginForm,
  type SettingsPatch,
} from "./host.ts";
import { type T, translator } from "./i18n.ts";

/**
 * App state, one store per page (the main window, each widget). No business logic: the server decides; this moves
 * data, keeps the offline queue and the last answers on the device (the app opens on them, also without network),
 * and follows the server's live changes.
 */

export const CAPTURE_SCREEN = "capture-expense";
const FILES = {
  widgets: "widgets.json",
  charts: "charts.json",
  catalog: "catalog.json",
  home: "home.json",
  screens: "screens.json",
  shortcuts: "shortcuts.json",
  pages: "pages.json",
  lastPage: "last-page.json",
};
const OPTION_LIST_LIMIT = 500;
const RELOAD_EVERY_MINUTES = 15;
const DELETE_AFTER_MS = 6000;

export type View =
  | { kind: "home" }
  | { kind: "chart"; id: string; drill?: string | null }
  | { kind: "chat" }
  | { kind: "inbox" }
  | { kind: "log" }
  | { kind: "page"; id: string };
/**
 * The right side panel (on the phone, a sheet over the whole screen): a server screen (the capture form, maybe
 * filled in by a shortcut), the chart editor or the shortcut editor.
 */
export type Panel =
  | null
  | { kind: "screen"; id: string; values?: F.Values; shortcut?: string }
  | { kind: "edit"; spec: ChartSpec; isNew: boolean }
  | { kind: "shortcut"; shortcut: Shortcut; isNew: boolean };
/** The phone's tabs: capturing (shortcuts), the charts and the conversation with Boni. */
export type Tab = "capture" | "charts" | "boni";

/** One turn of the conversation: what Juan asked and what the agent answered (painted by the code). */
export interface ChatEntry {
  id: string;
  request: string;
  result: TurnResult | null;
  error: string | null;
}

export type SubmitOutcome =
  | { kind: "done" | "queued"; message: string }
  | { kind: "invalid"; message: string; fieldErrors: Record<string, string> }
  | { kind: "failed"; message: string };

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

interface State {
  ready: boolean;
  settings: ClientSettings;
  t: T;
  view: View;
  panel: Panel;
  /** Something was typed or chosen in the open panel: closing it by hand asks first (`dismissPanel`). */
  panelEdited: boolean;
  /** The phone asks whether to discard what the open panel holds. */
  discardAsk: boolean;
  tab: Tab;
  sidebarOpen: boolean;
  settingsOpen: boolean;
  /** The server's home screen (its buttons: what can be captured) and the screens it opens (forms). */
  home: Screen | null;
  screens: Record<string, Screen>;
  /** The editor's live preview: the card being edited shows it ("" for a new chart). */
  editPreview: { id: string; state: ChartState } | null;
  options: Record<string, Option[]>;
  chartSpecs: ChartSpec[];
  /** Charts deleted a moment ago: hidden while their toast offers Undo. */
  deleting: string[];
  /** Saved captures to repeat with one tap (shared by every device). */
  shortcuts: Shortcut[];
  /** Shortcuts deleted a moment ago: hidden while their toast offers Undo. */
  deletingShortcuts: string[];
  catalog: ChartCatalog | null;
  widgets: Widget[];
  /** Incremented to make every chart card reload (one request per chart per tick). */
  refreshTick: number;
  pending: number;
  rejected: QueuedAction[];
  loadError: string | null;
  toast: Toast | null;
  /** The conversation with the agent (this device's, kept for the session). */
  chat: ChatEntry[];
  chatBusy: boolean;
  /** The user's pages (docs/extensiones.md 6): null while unknown (no server, agent store off). */
  pages: PageInfo[] | null;
  /** The open page with its blocks. */
  page: Page | null;
  /** Where the caret goes next on the open page: a block (start or end of its text), or the title. */
  pageFocus: { block: string; at: "start" | "end" | number } | { title: true } | null;
  /** A chart being created from a block of this page: saved, it takes that block's place. */
  chartForPage: { page: string; block: string } | null;
  /** Proposals waiting in the inbox, and the agent's latest runs (the log). */
  inbox: Proposal[];
  runs: RunSummary[];
  /** Flips with every confirmation, so its button is never where the last one was. */
  confirmFlip: boolean;
}

export const configured = (s: ClientSettings) => Boolean(s.serverUrl && s.hasToken);

let hostRef: Host = defaultHost;
const store: TextStore = {
  read: (n) => hostRef.store.read(n),
  write: (n, t) => hostRef.store.write(n, t),
  remove: (n) => hostRef.store.remove(n),
};
const api = new BoniApi({ request: (m, p, b) => hostRef.transport.request(m, p, b) });
const agent = new AgentApi({ request: (m, p, b) => hostRef.transport.request(m, p, b) });
/** This page's conversation (the server keeps its history per conversation). */
const CONVERSATION = newId();
const queue = new OfflineQueue(store);
export const charts = new ChartRepository(
  () => (configured(useStore.getState().settings) ? api : null),
  store,
);

export function errorText(t: T, e: unknown): string {
  if (e instanceof OfflineError) return t("error.offline");
  if (e instanceof NotConfiguredError) return t("error.notConfigured");
  if (e instanceof ApiError) {
    if (e.status === 401) return t("error.session");
    // A route the server does not have (its own errors carry a code): it is older than this app.
    if (e.status === 404 && e.code === "http_404") return t("error.serverOld");
    return e.message;
  }
  return (e as Error)?.message || t("error.generic");
}

export const useStore = create<State>(() => ({
  ready: false,
  settings: {
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
  },
  t: translator("es"),
  view: { kind: "home" },
  panel: null,
  panelEdited: false,
  discardAsk: false,
  tab: "capture",
  sidebarOpen: true,
  settingsOpen: false,
  home: null,
  screens: {},
  editPreview: null,
  options: {},
  chartSpecs: [],
  deleting: [],
  shortcuts: [],
  deletingShortcuts: [],
  catalog: null,
  widgets: [],
  refreshTick: 0,
  pending: 0,
  rejected: [],
  loadError: null,
  toast: null,
  chat: [],
  chatBusy: false,
  pages: null,
  page: null,
  pageFocus: null,
  chartForPage: null,
  inbox: [],
  runs: [],
  confirmFlip: false,
}));

const set = useStore.setState;
const get = useStore.getState;

// ---------- toasts (bottom centre, with Undo, as Boni Calendar) ----------
let toastSeq = 0;
export function toast(text: string, action?: Toast["action"]) {
  const id = ++toastSeq;
  set({ toast: { id, text, action } });
  setTimeout(() => {
    if (get().toast?.id === id) set({ toast: null });
  }, DELETE_AFTER_MS);
}
export const dismissToast = () => set({ toast: null });

// ---------- start ----------
function applySettings(settings: ClientSettings) {
  set({ settings, t: translator(settings.language) });
  const t = get().t;
  hostRef.desktop?.setLabels(
    Object.fromEntries(
      ["open", "capture", "widgets", "autostart", "refresh", "settings", "quit"].map((k) => [
        k,
        t(`tray.${k}`),
      ]),
    ),
  );
}

async function countQueue() {
  const items = await queue.items();
  set({
    pending: items.filter((i) => isPending(i)).length,
    rejected: items.filter((i) => i.error),
  });
}

/** Starts the page: settings, what the device kept, shell events. Widget pages load less. */
export async function init(role: "main" | "widget", h: Host = defaultHost) {
  hostRef = h;
  applySettings(await h.getSettings());
  const [widgets, specs, catalog, home, screens, shortcuts, pages, last] = await Promise.all([
    readJson<{ widgets: Widget[] }>(h.store, FILES.widgets),
    readJson<{ charts: unknown[] }>(h.store, FILES.charts),
    readJson<ChartCatalog>(h.store, FILES.catalog),
    readJson<unknown>(h.store, FILES.home),
    readJson<Record<string, unknown>>(h.store, FILES.screens),
    readJson<{ shortcuts: unknown[] }>(h.store, FILES.shortcuts),
    readJson<{ pages: PageInfo[] }>(h.store, FILES.pages),
    readJson<{ page: Page }>(h.store, FILES.lastPage),
  ]);
  // The device's copy of the pages and of the last one opened: the window opens on it without network.
  const cachedPages = Array.isArray(pages?.pages) ? pages.pages : null;
  const lastPage = last?.page && cachedPages?.some((p) => p.id === last.page.id) ? last.page : null;
  set({
    widgets: widgets?.widgets ?? [],
    chartSpecs: (specs?.charts ?? []).map(parseSpec),
    shortcuts: (shortcuts?.shortcuts ?? []).map(parseShortcut),
    catalog,
    home: home ? parseScreen(home) : null,
    screens: Object.fromEntries(Object.entries(screens ?? {}).map(([k, v]) => [k, parseScreen(v)])),
    pages: cachedPages,
    ...(role === "main" && lastPage
      ? { page: lastPage, view: { kind: "page" as const, id: lastPage.id } }
      : {}),
    ready: true,
  });
  h.onEvent((e) => {
    if (e.type === "tick") void onTick(e.minute, role);
    else if (e.type === "changed") void onChanged(e.what, role);
    else if (e.type === "refresh") void onChanged("all", role);
    else if (e.type === "navigate") navigate(e.screen);
    else if (e.type === "settings") onSettingsChanged(e.settings);
  });
  if (role === "main") {
    // What was typed on a page in the last moment is sent before the window goes.
    window.addEventListener("pagehide", () => void flushPage());
    void countQueue();
    void reloadAll();
    void h.phone?.takeLaunch().then((target) => target && navigate(target));
    publishTargets();
    if (!h.desktop && !h.phone) {
      // A plain browser has no shell sending ticks: keep its own minute.
      let minute = 0;
      setInterval(() => void onTick(++minute, role), 60_000);
    }
  } else {
    void loadCharts().catch(() => undefined);
  }
}

/** What the tray, a widget or a phone's launcher shortcut asks the main window to show. */
export function navigate(screen: string) {
  if (screen === "settings") openSettings();
  else if (screen === "capture") openScreen(CAPTURE_SCREEN);
  else if (screen.startsWith("shortcut:")) {
    const sc = get().shortcuts.find((x) => x.id === screen.slice(9));
    set({ panel: null, tab: "capture" });
    if (sc) void runShortcut(sc);
    else toast(get().t("shortcut.gone"));
  } else if (screen.startsWith("chart:")) {
    const id = screen.slice(6);
    set({ panel: null, tab: "charts" });
    if (get().chartSpecs.some((c) => c.id === id)) showChart(id);
    else toast(get().t("shortcut.chartGone"));
  } else if (screen.startsWith("edit:")) {
    const spec = get().chartSpecs.find((c) => c.id === screen.slice(5));
    if (spec) openEditor(spec);
  } else showStart();
}

function onSettingsChanged(s: ClientSettings) {
  const before = get().settings;
  applySettings(s);
  if (
    before.serverUrl !== s.serverUrl ||
    before.user !== s.user ||
    before.hasToken !== s.hasToken
  ) {
    charts.invalidate();
    set({ options: {} });
    if (configured(s)) void reloadAll();
  }
}

async function reloadAll() {
  if (!configured(get().settings)) return;
  set({ loadError: null });
  await Promise.all([
    loadCharts().catch((e) => set({ loadError: errorText(get().t, e) })),
    loadWidgets().catch(() => undefined),
    loadCatalog(true).catch(() => undefined),
    loadShortcuts().catch(() => undefined),
    prefetch(),
    startPages(),
  ]);
  charts.invalidate();
  refresh();
}

/** The server said something changed (live), or everything after a (re)connection. */
async function onChanged(what: string, role: "main" | "widget") {
  if (!configured(get().settings)) return;
  if (what === "charts") {
    await loadCharts().catch(() => undefined);
    charts.invalidate();
    refresh();
  } else if (what === "widgets") {
    if (role === "main") await loadWidgets().catch(() => undefined);
  } else if (what === "data") {
    charts.invalidate();
    refresh();
  } else if (what === "shortcuts") {
    if (role === "main") await loadShortcuts().catch(() => undefined);
  } else if (role === "main") {
    await reloadAll();
  } else {
    await loadCharts().catch(() => undefined);
    charts.invalidate();
    refresh();
  }
}

/**
 * The coordinator's minute (one page gets ticks): the offline queue; and, only while there is no live connection,
 * everything again every 15 minutes (with it, changes arrive by themselves).
 */
async function onTick(minute: number, role: "main" | "widget") {
  await sync().catch(() => 0);
  if (!get().settings.live && minute % RELOAD_EVERY_MINUTES === 0) {
    await onChanged("all", role);
    if (role === "widget") await loadWidgets().catch(() => undefined);
  }
}

export function refresh() {
  set((s) => ({ refreshTick: s.refreshTick + 1 }));
}

// ---------- navigation ----------
const FRESH_PANEL = { editPreview: null, panelEdited: false, discardAsk: false };
export const showHome = () => set({ view: { kind: "home" } });
/** Back from a chart or the conversation's screens: to the page open before, else the start. */
export const showStart = () => {
  const page = get().page;
  if (page) set({ view: { kind: "page", id: page.id } });
  else void openStart();
};
export const showChart = (id: string) => set({ view: { kind: "chart", id } });
/** The detail of one bar or slice of the chart on its own: navigation, so Back leaves it before the chart. */
export const setChartDrill = (drill: string | null) =>
  set((s) => (s.view.kind === "chart" ? { view: { ...s.view, drill } } : {}));
/** A server screen in the panel; `values` fill its form (a shortcut's), `shortcut` names the one that did. */
export const openScreen = (id: string, values?: F.Values, shortcut?: string) => {
  set({ panel: { kind: "screen", id, values, shortcut }, ...FRESH_PANEL });
  if (!get().screens[id]) void loadScreen(id);
};
export const showTab = (tab: Tab) => set({ tab, view: { kind: "home" } });
export const openEditor = (spec: ChartSpec, isNew = false) =>
  set({ panel: { kind: "edit", spec: normalize(spec), isNew }, ...FRESH_PANEL });
export const closePanel = () => set({ panel: null, chartForPage: null, ...FRESH_PANEL });
export const markPanelEdited = () => {
  if (get().panel && !get().panelEdited) set({ panelEdited: true });
};
/** The user closes the panel (its close button, Back): with something typed in it the phone asks first. */
export const dismissPanel = () => {
  if (get().panelEdited) set({ discardAsk: true });
  else closePanel();
};
export const keepEditing = () => set({ discardAsk: false });
export const setEditPreview = (p: State["editPreview"]) => set({ editPreview: p });
/** The editor's draft as it is typed: the card being edited shows its title and colour at once. */
export const setEditDraft = (spec: ChartSpec) =>
  set((s) => (s.panel?.kind === "edit" ? { panel: { ...s.panel, spec } } : {}));
export const openSettings = (open = true) => set({ settingsOpen: open });

/**
 * The phone's Back (Esc): closes the top thing, one at a time: settings, the panel (asking first when something was
 * typed in it), a chart's detail, a chart on its own, then the charts tab. False when there was nothing to close.
 * Menus and lists that components open close on Esc before this runs; Android's button is Esc too (`androidBack`).
 */
export function goBack(): boolean {
  const s = get();
  if (s.settingsOpen) openSettings(false);
  else if (s.discardAsk) keepEditing();
  else if (s.panel) dismissPanel();
  else if (s.view.kind === "chart" && s.view.drill) setChartDrill(null);
  else if (s.view.kind === "chart") showHome();
  else if (s.view.kind === "inbox" || s.view.kind === "log") showChat();
  else if (s.tab !== "capture") showTab("capture");
  else return false;
  return true;
}
/**
 * Android's Back button: the same as Esc, so whatever a component opened (a menu, a list of options) closes first,
 * then `goBack`. False when nothing took it (the app then goes to the background).
 */
export function androidBack(): boolean {
  const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(e);
  return e.defaultPrevented;
}
export const toggleSidebar = () => set((s) => ({ sidebarOpen: !s.sidebarOpen }));

// ---------- the server's screens and lists ----------
async function keep(file: string, value: unknown) {
  await store.write(file, JSON.stringify(value)).catch(() => undefined);
}

/** The whole list of a source (categories, people: tens of items), fetched once and filtered here. */
export async function optionList(source: string): Promise<Option[]> {
  const known = get().options[source];
  if (known) return known;
  const list = await api.options(source, "", OPTION_LIST_LIMIT);
  set((s) => ({ options: { ...s.options, [source]: list } }));
  return list;
}

/** A server screen (a form), kept on the device for the next time. */
export async function loadScreen(id: string) {
  const screen = await api.screen(id);
  set((s) => ({ screens: { ...s.screens, [id]: screen } }));
  await keep(FILES.screens, get().screens);
  return screen;
}

/** The home screen (what can be captured), the capture form and its lists, ahead of use. */
async function prefetch() {
  try {
    const home = await api.home();
    set({ home });
    await keep(FILES.home, home);
    const capture = await loadScreen(CAPTURE_SCREEN);
    const sources = new Set<string>();
    for (const c of capture.components) {
      if (c.type !== "form") continue;
      for (const f of c.fields) {
        if ((f.type === "choice" || f.type === "multi_choice") && f.source) sources.add(f.source);
      }
    }
    await Promise.all(
      [...sources].map((src) =>
        api
          .options(src, "", OPTION_LIST_LIMIT)
          .then((list) => set((s) => ({ options: { ...s.options, [src]: list } })))
          .catch(() => undefined),
      ),
    );
  } catch {
    // offline: what the device kept is shown; next round
  }
}

// ---------- captures and the offline queue ----------
export async function submit(
  form: FormComponent,
  values: Record<string, Json>,
): Promise<SubmitOutcome> {
  const t = get().t;
  const request = {
    action: form.submit.action,
    client_id: newId(),
    values,
    created_at: nowIso(),
  };
  if (!configured(get().settings)) {
    await queue.add(request);
    await countQueue();
    return { kind: "queued", message: t("submit.queuedNoServer") };
  }
  try {
    const r = await api.action(request);
    if (r.status === "ok") {
      charts.invalidate();
      refresh();
      hostRef.desktop?.broadcastRefresh();
      return { kind: "done", message: r.message || t("submit.done") };
    }
    if (r.status === "queued")
      return { kind: "queued", message: r.message || t("submit.queuedServer") };
    if (r.status === "invalid") {
      return {
        kind: "invalid",
        message: r.message || t("form.check"),
        fieldErrors: r.field_errors ?? {},
      };
    }
    return { kind: "failed", message: r.message || t("submit.failed") };
  } catch (e) {
    if (e instanceof OfflineError) {
      await queue.add(request);
      await countQueue();
      return { kind: "queued", message: t("submit.queuedOffline") };
    }
    return { kind: "failed", message: errorText(t, e) };
  }
}

/** Sends the offline queue now. */
export async function sync(): Promise<number> {
  if (!configured(get().settings)) return 0;
  const n = await queue.flush((r) => api.action(r));
  await countQueue();
  if (n > 0) {
    charts.invalidate();
    refresh();
    hostRef.desktop?.broadcastRefresh();
  }
  return n;
}

export async function dismissRejected(clientId: string) {
  await queue.dismiss(clientId);
  await countQueue();
}

// ---------- charts ----------
export async function loadCharts() {
  const chartSpecs = await api.charts();
  set({ chartSpecs });
  await keep(FILES.charts, { charts: chartSpecs });
  publishTargets();
  return chartSpecs;
}

export async function loadCatalog(force = false): Promise<ChartCatalog> {
  const known = get().catalog;
  if (known && !force) return known;
  const catalog = await api.catalog();
  set({ catalog });
  await keep(FILES.catalog, catalog);
  return catalog;
}

export const preview = (spec: ChartSpec, drill?: string | null) => api.preview(spec, drill);

/** The charts shown (without those being deleted). A new array only when one of them changes. */
export function useVisibleCharts(): ChartSpec[] {
  const specs = useStore((s) => s.chartSpecs);
  const deleting = useStore((s) => s.deleting);
  return useMemo(() => specs.filter((c) => !deleting.includes(c.id)), [specs, deleting]);
}

function afterChartChange() {
  charts.invalidate();
  refresh();
  hostRef.desktop?.broadcastRefresh();
}

/**
 * A quick change from a chart's controls (period, filters, order, kind, colour, on home): shown at once, saved,
 * and undoable from the toast (as every edit in Boni Calendar).
 */
export async function changeChart(next: ChartSpec, label?: string) {
  const t = get().t;
  const before = get().chartSpecs.find((c) => c.id === next.id);
  if (!before) return;
  const spec = normalize(next);
  set((s) => ({ chartSpecs: s.chartSpecs.map((c) => (c.id === spec.id ? spec : c)) }));
  try {
    await api.updateChart(spec);
    await keep(FILES.charts, { charts: get().chartSpecs });
    afterChartChange();
    toast(label ?? t("charts.changed"), {
      label: t("toast.undo"),
      run: () => void changeChart(before, t("charts.restored")),
    });
  } catch (e) {
    set((s) => ({ chartSpecs: s.chartSpecs.map((c) => (c.id === before.id ? before : c)) }));
    toast(errorText(t, e));
  }
}

/** Saves the editor's chart (new or edited). */
export async function saveChart(spec: ChartSpec) {
  const saved = spec.id ? await api.updateChart(spec) : await api.createChart(spec);
  await loadCharts();
  afterChartChange();
  const page = get().page;
  const slot = get().chartForPage;
  if (!spec.id && saved?.id && page && slot?.page === page.id) {
    const chart: Block = { id: blockId(), type: "chart", chart: saved.id };
    const at = page.spec.blocks.findIndex((b) => b.id === slot.block);
    const blocks = [...page.spec.blocks];
    if (at < 0) blocks.push(chart);
    else blocks.splice(at, 1, chart);
    setPageBlocks(blocks);
  }
  set({ chartForPage: null });
  return saved;
}

export async function duplicateChart(spec: ChartSpec) {
  const t = get().t;
  try {
    const saved = await api.createChart({
      ...spec,
      id: "",
      title: `${spec.title} (${t("charts.copy")})`,
    });
    await loadCharts();
    afterChartChange();
    toast(t("charts.duplicated"));
    return saved;
  } catch (e) {
    toast(errorText(t, e));
    return null;
  }
}

/** Deleting waits a few seconds (Undo in the toast) before it reaches the server. */
export function deleteChart(id: string) {
  const t = get().t;
  set((s) => ({ deleting: [...s.deleting, id] }));
  const v = get().view;
  if (v.kind === "chart" && v.id === id) showStart();
  const finish = async () => {
    if (!get().deleting.includes(id)) return; // undone
    try {
      await api.deleteChart(id);
      await loadCharts();
      await loadWidgets(); // its widgets are gone too
      afterChartChange();
    } catch (e) {
      toast(errorText(t, e));
    } finally {
      set((s) => ({ deleting: s.deleting.filter((d) => d !== id) }));
    }
  };
  const timer = setTimeout(() => void finish(), DELETE_AFTER_MS);
  toast(t("charts.deleted"), {
    label: t("toast.undo"),
    run: () => {
      clearTimeout(timer);
      set((s) => ({ deleting: s.deleting.filter((d) => d !== id) }));
    },
  });
}

/** A new order (dragged in the sidebar): at once, then saved. */
export async function orderCharts(ids: string[]) {
  const t = get().t;
  const before = get().chartSpecs;
  const byId = new Map(before.map((c) => [c.id, c]));
  set({ chartSpecs: ids.map((id) => byId.get(id)).filter((c): c is ChartSpec => Boolean(c)) });
  try {
    set({ chartSpecs: await api.orderCharts(ids) });
    await keep(FILES.charts, { charts: get().chartSpecs });
    hostRef.desktop?.broadcastRefresh();
  } catch (e) {
    set({ chartSpecs: before });
    toast(errorText(t, e));
  }
}

// ---------- shortcuts (kept on the device too: the phone opens on them without network) ----------
export async function loadShortcuts(): Promise<Shortcut[]> {
  const shortcuts = await api.shortcuts();
  set({ shortcuts });
  await keep(FILES.shortcuts, { shortcuts });
  publishTargets();
  return shortcuts;
}

/** How many shortcuts show when the app's icon is held (launchers show four or five). */
const LAUNCHER_MENU = 4;

/** The phone's launcher entries follow the shortcuts and charts (names, colours, which still exist). */
function publishTargets() {
  const phone = hostRef.phone;
  if (!phone) return;
  const s = get();
  phone.setTargets(
    [
      ...s.shortcuts.map((x) => ({ target: `shortcut:${x.id}`, label: x.label, color: x.color })),
      ...s.chartSpecs.map((c) => ({ target: `chart:${c.id}`, label: c.title, color: c.color })),
    ],
    Math.min(LAUNCHER_MENU, s.shortcuts.length),
  );
}

/** A shortcut or a chart on the phone's home screen. */
export async function pinToHome(entry: { target: string; label: string; color: string | null }) {
  const t = get().t;
  const ok = (await hostRef.phone?.pin(entry)) ?? false;
  if (!ok) toast(t("shortcut.pinUnsupported"));
}

/** The shortcuts shown (without those being deleted). A new array only when one of them changes. */
export function useVisibleShortcuts(): Shortcut[] {
  const list = useStore((s) => s.shortcuts);
  const deleting = useStore((s) => s.deletingShortcuts);
  return useMemo(() => list.filter((c) => !deleting.includes(c.id)), [list, deleting]);
}

export const openShortcutEditor = (shortcut: Shortcut, isNew = false) =>
  set({ panel: { kind: "shortcut", shortcut, isNew }, ...FRESH_PANEL });

/** Saves the shortcut editor's shortcut (new or edited). */
export async function saveShortcut(sc: Shortcut): Promise<Shortcut> {
  const saved = sc.id ? await api.updateShortcut(sc) : await api.createShortcut(sc);
  await loadShortcuts();
  return saved;
}

/** Deleting waits a few seconds (Undo in the toast) before it reaches the server, as a chart. */
export function deleteShortcut(id: string) {
  const t = get().t;
  set((s) => ({ deletingShortcuts: [...s.deletingShortcuts, id] }));
  const finish = async () => {
    if (!get().deletingShortcuts.includes(id)) return; // undone
    try {
      await api.deleteShortcut(id);
      await loadShortcuts();
    } catch (e) {
      toast(errorText(t, e));
    } finally {
      set((s) => ({ deletingShortcuts: s.deletingShortcuts.filter((d) => d !== id) }));
    }
  };
  const timer = setTimeout(() => void finish(), DELETE_AFTER_MS);
  toast(t("shortcut.deleted"), {
    label: t("toast.undo"),
    run: () => {
      clearTimeout(timer);
      set((s) => ({ deletingShortcuts: s.deletingShortcuts.filter((d) => d !== id) }));
    },
  });
}

/** A new order (dragged): at once, then saved. */
export async function orderShortcuts(ids: string[]) {
  const t = get().t;
  const before = get().shortcuts;
  const byId = new Map(before.map((c) => [c.id, c]));
  set({ shortcuts: ids.map((id) => byId.get(id)).filter((c): c is Shortcut => Boolean(c)) });
  try {
    set({ shortcuts: await api.orderShortcuts(ids) });
    await keep(FILES.shortcuts, { shortcuts: get().shortcuts });
  } catch (e) {
    set({ shortcuts: before });
    toast(errorText(t, e));
  }
}

/**
 * A tap on a shortcut. `open` (or a form it cannot fill completely): the form filled in. `save`: the capture goes
 * at once, through the offline queue, held back while its toast offers Undo; it survives closing the app.
 */
export async function runShortcut(sc: Shortcut) {
  const t = get().t;
  const form = formOf(get().screens[sc.screen]);
  if (sc.mode === "open" || !form) {
    openScreen(sc.screen, sc.values, sc.id);
    return;
  }
  if (!canSaveDirectly(form, sc.values, today())) {
    openScreen(sc.screen, sc.values, sc.id);
    toast(t("shortcut.incomplete"));
    return;
  }
  const request = {
    action: form.submit.action,
    client_id: newId(),
    values: F.payload(form, filledValues(form, sc.values, today())),
    created_at: nowIso(),
  };
  await queue.add(request, Date.now() + DELETE_AFTER_MS);
  await countQueue();
  const timer = setTimeout(() => void sync().catch(() => 0), DELETE_AFTER_MS + 100);
  toast(t("shortcut.saving", { label: sc.label }), {
    label: t("toast.undo"),
    run: () => {
      clearTimeout(timer);
      void queue.dismiss(request.client_id).then(countQueue);
    },
  });
}

// ---------- widgets of this computer (kept on the device too: they appear at login without network) ----------
export async function loadWidgets(): Promise<Widget[]> {
  const widgets = await api.widgets();
  await keep(FILES.widgets, { widgets });
  set({ widgets });
  hostRef.desktop?.setWidgets(widgets);
  return widgets;
}

export async function addWidget(chartId: string) {
  const t = get().t;
  try {
    await api.addWidget(chartId, "medium");
    await loadWidgets();
    toast(t("widgets.added"));
  } catch (e) {
    toast(errorText(t, e));
  }
}

export async function removeWidget(id: string) {
  const t = get().t;
  const w = get().widgets.find((x) => x.id === id);
  try {
    await api.deleteWidget(id);
    await loadWidgets();
    if (w) {
      toast(t("widgets.removed"), {
        label: t("toast.undo"),
        run: () => void addWidget(w.chart_id),
      });
    }
  } catch (e) {
    toast(errorText(t, e));
  }
}

export const setWidgetHidden = (id: string, hidden: boolean) =>
  saveSettings({ widgetHidden: { id, hidden } });

// ---------- settings and account ----------
export async function saveSettings(patch: SettingsPatch) {
  const next = await hostRef.setSettings(patch);
  onSettingsChanged(next);
  return next;
}

export async function login(form: LoginForm): Promise<LoginAnswer> {
  const r = await hostRef.login(form);
  if (r.ok) onSettingsChanged(r.settings);
  return r;
}

export async function logout() {
  onSettingsChanged(await hostRef.logout());
}

export const suggestedDevice = () => hostRef.suggestedDevice();

export const todayIso = () => today();

// ---------- the agent ----------
export const showChat = () => set({ view: { kind: "chat" } });
/** The inbox view loads its proposals when it opens. */
export const showInbox = () => set({ view: { kind: "inbox" } });
export const showLog = () => {
  set({ view: { kind: "log" } });
  void loadRuns();
};

/** Why a run stopped, in words: a fixed code from the server, never its data. */
export function agentErrorText(t: T, code: string): string {
  if (code === "agent-off") return t("agent.error.off");
  if (code === "declined") return t("agent.error.declined");
  if (code === "plan-invalid") return t("agent.error.planInvalid");
  if (code.startsWith("model-")) return t("agent.error.model");
  const rule = /^(P\d{1,2}|R\d)/.exec(code)?.[1];
  if (rule) return t("agent.error.rule", { rule });
  return t("agent.error.generic", { code });
}

function patchEntry(id: string, patch: Partial<ChatEntry>) {
  set((s) => ({ chat: s.chat.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
}
/** A later answer of the same run: its replies follow the earlier ones; its question or confirmation replaces the last. */
function mergeResult(prev: TurnResult | null, next: TurnResult): TurnResult {
  if (!prev) return next;
  return {
    ...next,
    replies: [...prev.replies, ...next.replies],
    proposals: [...prev.proposals, ...next.proposals],
    notices: [...prev.notices, ...next.notices],
  };
}
async function agentCall(id: string, call: () => Promise<TurnResult>) {
  set({ chatBusy: true });
  try {
    const r = await call();
    const entry = get().chat.find((e) => e.id === id);
    patchEntry(id, { result: mergeResult(entry?.result ?? null, r), error: null });
    if (r.pending?.kind === "confirm") set((s) => ({ confirmFlip: !s.confirmFlip }));
    if (r.proposals.length) void loadInbox();
  } catch (e) {
    const code = e instanceof ApiError ? e.code : null;
    patchEntry(id, {
      error: code === "agent-off" ? agentErrorText(get().t, code) : errorText(get().t, e),
    });
  } finally {
    set({ chatBusy: false });
  }
}

export async function sendTurn(text: string) {
  const request = text.trim();
  if (!request || get().chatBusy) return;
  const id = newId();
  set((s) => ({ chat: [...s.chat, { id, request, result: null, error: null }] }));
  await agentCall(id, () => agent.turn(request, CONVERSATION));
}
export async function answerAsk(entryId: string, a: { choice: number } | { text: string }) {
  const e = get().chat.find((x) => x.id === entryId);
  const p = e?.result?.pending;
  if (!e?.result || p?.kind !== "ask") return;
  const run = e.result.run;
  await agentCall(entryId, () => agent.answer(run, p.id, a));
}
export async function confirmPending(entryId: string) {
  const e = get().chat.find((x) => x.id === entryId);
  const p = e?.result?.pending;
  if (!e?.result || p?.kind !== "confirm") return;
  const run = e.result.run;
  await agentCall(entryId, () => agent.confirm(run, p.id));
}
export async function declinePending(entryId: string) {
  const e = get().chat.find((x) => x.id === entryId);
  const p = e?.result?.pending;
  if (!e?.result || p?.kind !== "confirm") return;
  const run = e.result.run;
  await agentCall(entryId, () => agent.decline(run, p.id));
}

export async function loadInbox() {
  try {
    set({ inbox: await agent.proposals() });
  } catch {
    // the inbox stays as it was (offline, agent off)
  }
}
/** Accepting one proposal (never all at once: each is looked at, docs/nucleo.md 7.5). */
export async function acceptProposal(id: string) {
  const t = get().t;
  try {
    const r = await agent.accept(id);
    if (r.pending?.kind === "confirm") {
      // Accepted, but it still needs a confirmation (deleting...): it goes on in the conversation.
      const entry: ChatEntry = {
        id: newId(),
        request: t("inbox.acceptedRequest"),
        result: r,
        error: null,
      };
      set((s) => ({
        chat: [...s.chat, entry],
        confirmFlip: !s.confirmFlip,
        view: { kind: "chat" },
      }));
    } else toast(r.error ? agentErrorText(t, r.error) : t("inbox.accepted"));
  } catch (e) {
    toast(errorText(t, e));
  }
  await loadInbox();
}
export async function rejectProposal(id: string) {
  try {
    await agent.reject(id);
  } catch (e) {
    toast(errorText(get().t, e));
  }
  await loadInbox();
}

export async function loadRuns() {
  try {
    set({ runs: await agent.runs() });
  } catch {
    // the log stays as it was
  }
}
/** What a run did (its request and steps), for the Registro; null when it cannot be read. */
export async function loadRunDetail(id: string): Promise<RunDetail | null> {
  try {
    return await agent.runDetail(id);
  } catch {
    return null;
  }
}
/** "Undo what this request did": every change of that run, newest first, all or nothing. */
export async function undoRun(id: string) {
  const t = get().t;
  try {
    const n = await agent.undo(id);
    toast(t("log.undone", { n }));
  } catch (e) {
    toast(e instanceof ApiError && e.status === 409 ? t("log.cannotUndo") : errorText(t, e));
  }
  await loadRuns();
}

/** What the models may see of each collection, or null when the agent is off or unreachable. */
/** The installed extensions; null when they cannot be read (agent off, offline). */
export async function loadExtensions(): Promise<ExtensionView[] | null> {
  try {
    return await agent.extensions();
  } catch {
    return null;
  }
}

/** Juan turns an extension on or off; false when the server did not take it. */
export async function changeExtension(id: string, enabled: boolean): Promise<boolean> {
  try {
    await agent.setExtension(id, enabled);
    return true;
  } catch {
    toast(useStore.getState().t("ext.error"));
    return false;
  }
}

export async function loadVisibility(): Promise<Visibility[] | null> {
  try {
    return await agent.visibility();
  } catch {
    return null;
  }
}

/** The account's mailbox: null when none is connected, undefined when it cannot be read (offline, shared device). */
export async function loadMail(): Promise<MailView | null | undefined> {
  try {
    return await agent.mail();
  } catch {
    return undefined;
  }
}

/** Connects or changes the mailbox; the server tries it first. Returns the view, or the error's code. */
export async function saveMail(input: MailInput): Promise<MailView | { error: string }> {
  try {
    const m = await agent.saveMail(input);
    return m ?? { error: "failed" };
  } catch (e) {
    return { error: e instanceof ApiError ? e.code : "offline" };
  }
}

/** The reviewer now; the mailbox's view with its suggestion (if any). */
export async function reviewMail(): Promise<MailView | null> {
  try {
    return await agent.reviewMail();
  } catch {
    toast(useStore.getState().t("mail.error.failed"));
    return null;
  }
}

/** Juan's answer to the reviewer's suggestion: the guide and the mailbox after it. */
export async function answerSuggestion(id: string, accept: boolean) {
  try {
    return await agent.answerSuggestion(id, accept);
  } catch {
    toast(useStore.getState().t("mail.error.failed"));
    return null;
  }
}

export async function loadMailGuide(): Promise<MailGuide | null> {
  try {
    return await agent.mailGuide();
  } catch {
    return null;
  }
}

/** Saves part of the reading guide; the new guide, or the error's code. */
export async function saveMailGuide(
  input: Parameters<typeof agent.saveMailGuide>[0],
): Promise<MailGuide | { error: string }> {
  try {
    return (await agent.saveMailGuide(input)) ?? { error: "failed" };
  } catch (e) {
    return { error: e instanceof ApiError ? e.code : "offline" };
  }
}

export async function checkMail(): Promise<MailView | null> {
  try {
    return await agent.checkMail();
  } catch {
    toast(useStore.getState().t("mail.error.failed"));
    return null;
  }
}

/** Reads the last `days` days of mail again (its pending proposals are replaced); a toast says how many. */
export async function rereadMail(days: number): Promise<boolean> {
  const t = useStore.getState().t;
  try {
    const r = await agent.rereadMail(days);
    toast(t("mail.reread.done", { n: r.mails }));
    return true;
  } catch {
    toast(t("mail.error.failed"));
    return false;
  }
}

export async function forgetMail(): Promise<boolean> {
  try {
    await agent.forgetMail();
    return true;
  } catch {
    toast(useStore.getState().t("mail.error.failed"));
    return false;
  }
}

/** Juan's choice for one collection (a personal device only); true when the server took it. */
export async function changeVisibility(id: string, level: AiLevel): Promise<boolean> {
  const t = useStore.getState().t;
  try {
    await agent.setVisibility(id, level);
    return true;
  } catch (e) {
    toast(e instanceof ApiError && e.status === 403 ? t("ai.personal") : t("ai.failed"));
    return false;
  }
}

// ------------------------------------------------------------------ pages (docs/extensiones.md 6)

type Block = Page["spec"]["blocks"][number];

/** A new block's id (closed spec: letters, digits, - and _). */
export const blockId = () => Math.random().toString(36).slice(2, 10);

/** The user's pages, kept on the device too. Null when the server has none to give (an older server). */
export async function loadPages(): Promise<PageInfo[] | null> {
  try {
    const pages = await agent.pages();
    set({ pages });
    await keep(FILES.pages, { pages });
    return pages;
  } catch {
    return get().pages;
  }
}

/** At start and after a reconnection: the pages again, and the start page if none is open. */
async function startPages() {
  const pages = await loadPages();
  const v = get().view;
  if (v.kind === "home" || (v.kind === "page" && !pages?.some((p) => p.id === v.id)))
    await openStart();
  else if (v.kind === "page") await openPage(v.id);
}

export async function openPage(id: string) {
  await flushPage();
  const same = get().page?.id === id;
  set({ view: { kind: "page", id }, page: same ? get().page : null });
  try {
    const page = await agent.page(id);
    const v = get().view;
    if (!page || v.kind !== "page" || v.id !== id) return;
    set({ page });
    await keep(FILES.lastPage, { page });
  } catch {
    if (!get().page) toast(get().t("page.loadError"));
  }
}

/** The start screen: the last page opened here if it still exists, else the first; none, the welcome. */
export async function openStart() {
  const pages = get().pages;
  if (!pages?.length) {
    set({ view: { kind: "home" }, page: null });
    return;
  }
  const last = await readJson<{ page: Page }>(store, FILES.lastPage);
  const id = pages.some((p) => p.id === last?.page?.id)
    ? (last?.page.id as string)
    : (pages.find((p) => !p.parent) ?? pages[0])?.id;
  if (id) await openPage(id);
}

/** A new page (as Notion's): untitled, open at once with the caret in its title. */
export async function newPage(parent: string | null = null) {
  await flushPage();
  try {
    const page = await agent.createPage({ title: "", parent });
    if (!page) return;
    set({
      pages: [...(get().pages ?? []), page],
      page,
      view: { kind: "page", id: page.id },
      pageFocus: { title: true },
    });
    await keep(FILES.lastPage, { page });
    void loadPages();
  } catch {
    toast(get().t("page.error"));
  }
}

// Changes to the open page are kept at once on screen and sent together after a short pause (typing does
// not make a request per key); opening another page or leaving the window sends what is pending.
const SAVE_AFTER_MS = 500;
let pending: {
  id: string;
  patch: { title?: string; spec?: PageSpec };
  timer: ReturnType<typeof setTimeout>;
} | null = null;

function savePage(id: string, patch: { title?: string; spec?: PageSpec }) {
  if (pending && pending.id !== id) void flushPage();
  if (pending) clearTimeout(pending.timer);
  pending = {
    id,
    patch: { ...pending?.patch, ...patch },
    timer: setTimeout(() => void flushPage(), SAVE_AFTER_MS),
  };
}

export async function flushPage() {
  const p = pending;
  if (!p) return;
  pending = null;
  clearTimeout(p.timer);
  try {
    await agent.updatePage(p.id, p.patch);
    const page = get().page;
    if (page?.id === p.id) await keep(FILES.lastPage, { page });
    if (p.patch.title !== undefined) await keep(FILES.pages, { pages: get().pages });
  } catch {
    toast(get().t("page.error"));
    // What the server has is the truth again.
    if (get().page?.id === p.id) await openPage(p.id);
    void loadPages();
  }
}

export function setPageTitle(title: string) {
  const page = get().page;
  if (!page) return;
  const clean = title.replace(/\s+/g, " ").slice(0, 120);
  set({
    page: { ...page, title: clean },
    pages: get().pages?.map((p) => (p.id === page.id ? { ...p, title: clean } : p)) ?? null,
  });
  savePage(page.id, { title: clean.trim() });
}

/** The page's blocks, changed at once here and kept on the server shortly after. */
export function setPageBlocks(blocks: Block[]) {
  const page = get().page;
  if (!page) return;
  const spec: PageSpec = { ...page.spec, version: 1, blocks };
  set({ page: { ...page, spec } });
  savePage(page.id, { spec });
}

/** The reading column or the window's whole width. */
export function setPageFull(full: boolean) {
  const page = get().page;
  if (!page) return;
  const spec: PageSpec = { version: 1, blocks: page.spec.blocks, ...(full ? { full: true } : {}) };
  set({ page: { ...page, spec } });
  savePage(page.id, { spec });
}

export const setPageFocus = (f: State["pageFocus"]) => set({ pageFocus: f });

/** A new chart for a block of this page: the editor opens, and saving puts the chart in its place. */
export function newChartForPage(spec: ChartSpec, block: string) {
  const page = get().page;
  if (!page) return;
  openEditor(spec, true);
  set({ chartForPage: { page: page.id, block } });
}

/** To the trash, with Undo in the toast (no confirmation: section 1 of the design guide). */
export async function deletePage(id: string) {
  const t = get().t;
  await flushPage();
  try {
    await agent.deletePage(id);
  } catch {
    toast(t("page.error"));
    return;
  }
  if (get().page?.id === id) set({ page: null });
  await loadPages();
  const v = get().view;
  if (v.kind === "page" && v.id === id) await openStart();
  toast(t("page.deleted"), {
    label: t("toast.undo"),
    run: () =>
      void agent
        .restorePage(id)
        .then(() => loadPages())
        .then(() => openPage(id))
        .catch(() => toast(t("page.error"))),
  });
}
