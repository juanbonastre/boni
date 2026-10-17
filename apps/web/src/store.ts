import { create } from "zustand";
import { ApiError, BoniApi, NotConfiguredError, OfflineError } from "./core/api.ts";
import { ChartRepository } from "./core/charts.ts";
import { newId, nowIso, today } from "./core/clock.ts";
import type {
  ChartCatalog,
  ChartSpec,
  FormComponent,
  Json,
  Option,
  Screen,
  Widget,
} from "./core/contract.ts";
import { OfflineQueue, type QueuedAction } from "./core/queue.ts";
import { readJson } from "./core/storage.ts";
import { type ClientSettings, host as defaultHost, type Host, type SettingsPatch } from "./host.ts";
import { type T, translator } from "./i18n.ts";

/**
 * App state shared by the main window and each widget window (one store per page). No business logic: the server
 * decides, this only moves data, keeps the offline queue and the last answers on the device.
 */

export const HOME = "home";
export const CHARTS = "charts";
export const CHART_EDIT = "chart-edit";
export const CAPTURE = "capture-expense";
const WIDGETS_FILE = "widgets.json";
const OPTION_LIST_LIMIT = 500;
const REFRESH_EVERY_MINUTES = 15;

export type SubmitOutcome =
  | { kind: "done" | "queued"; message: string }
  | { kind: "invalid"; message: string; fieldErrors: Record<string, string> }
  | { kind: "failed"; message: string };

interface State {
  ready: boolean;
  settings: ClientSettings;
  t: T;
  screen: string;
  editing: ChartSpec | null;
  screens: Record<string, Screen>;
  screenError: string | null;
  options: Record<string, Option[]>;
  chartSpecs: ChartSpec[];
  catalog: ChartCatalog | null;
  widgets: Widget[];
  /** Incremented to make every chart card reload (one request per chart per tick). */
  refreshTick: number;
  pending: number;
  rejected: QueuedAction[];
  toast: { text: string; id: number } | null;
  settingsOpen: boolean;
}

export const configured = (s: ClientSettings) => Boolean(s.serverUrl && s.hasToken);

let hostRef: Host = defaultHost;
const api = new BoniApi({ request: (m, p, b) => hostRef.transport.request(m, p, b) });
const queue = new OfflineQueue({
  read: (n) => hostRef.store.read(n),
  write: (n, t) => hostRef.store.write(n, t),
  remove: (n) => hostRef.store.remove(n),
});
export const charts = new ChartRepository(
  () => (configured(useStore.getState().settings) ? api : null),
  {
    read: (n) => hostRef.store.read(n),
    write: (n, t) => hostRef.store.write(n, t),
    remove: (n) => hostRef.store.remove(n),
  },
);

export function errorText(t: T, e: unknown): string {
  if (e instanceof OfflineError) return t("error.offline");
  if (e instanceof NotConfiguredError) return t("error.notConfigured");
  if (e instanceof ApiError) return e.message;
  return (e as Error)?.message || t("error.generic");
}

export const useStore = create<State>(() => ({
  ready: false,
  settings: {
    serverUrl: "",
    hasToken: false,
    theme: "system",
    language: "es",
    showWidgets: false,
    autostart: false,
    layerAvailable: false,
  },
  t: translator("es"),
  screen: HOME,
  editing: null,
  screens: {},
  screenError: null,
  options: {},
  chartSpecs: [],
  catalog: null,
  widgets: [],
  refreshTick: 0,
  pending: 0,
  rejected: [],
  toast: null,
  settingsOpen: false,
}));

const set = useStore.setState;
const get = useStore.getState;

let toastSeq = 0;
export function toast(text: string) {
  const id = ++toastSeq;
  set({ toast: { text, id } });
  setTimeout(() => {
    if (get().toast?.id === id) set({ toast: null });
  }, 5000);
}

function applySettings(settings: ClientSettings) {
  set({ settings, t: translator(settings.language) });
  const t = get().t;
  hostRef.desktop?.setLabels(
    Object.fromEntries(
      ["open", "charts", "widgets", "autostart", "refresh", "settings", "quit"].map((k) => [
        k,
        t(`tray.${k}`),
      ]),
    ),
  );
}

async function countQueue() {
  const items = await queue.items();
  set({ pending: items.filter((i) => !i.error).length, rejected: items.filter((i) => i.error) });
}

/** Starts the page: settings, cached widget list, shell events. `role` "widget" pages do less. */
export async function init(role: "main" | "widget", h: Host = defaultHost) {
  hostRef = h;
  applySettings(await h.getSettings());
  const cached = await readJson<{ widgets: Widget[] }>(h.store, WIDGETS_FILE);
  set({ widgets: cached?.widgets ?? [], ready: true });
  h.onEvent((e) => {
    if (e.type === "tick") void onTick(e.minute);
    else if (e.type === "refresh") refresh();
    else if (e.type === "navigate") {
      if (e.screen === "settings") openSettings();
      else go(e.screen);
    } else if (e.type === "settings") onSettingsChanged(e.settings);
  });
  if (role === "main") {
    void countQueue();
    void prefetch();
    if (configured(get().settings)) void loadWidgets().catch(() => undefined);
    if (!h.desktop) {
      // A plain browser has no shell sending ticks: keep its own minute.
      let minute = 0;
      setInterval(() => void onTick(++minute), 60_000);
    }
  }
}

function onSettingsChanged(s: ClientSettings) {
  const before = get().settings;
  applySettings(s);
  if (before.serverUrl !== s.serverUrl || before.hasToken !== s.hasToken) {
    charts.invalidate();
    set({ screens: {}, options: {}, catalog: null });
    refresh();
  }
}

let widgetsLoaded = false;

/**
 * The coordinator's minute (only one page gets ticks): the offline queue every minute; the widget list until the
 * server first answers (at login the network may take a while), then with everything else every 15 minutes.
 */
async function onTick(minute: number) {
  await sync().catch(() => 0);
  const due = minute % REFRESH_EVERY_MINUTES === 0;
  if (configured(get().settings) && (due || !widgetsLoaded)) {
    await loadWidgets().catch(() => undefined);
  }
  if (due) {
    await prefetch();
    refresh();
  }
}

export function refresh() {
  set((s) => ({ refreshTick: s.refreshTick + 1 }));
}

export function go(screen: string, editing: ChartSpec | null = null) {
  set({ screen, editing, screenError: null });
}

export const openSettings = (open = true) => set({ settingsOpen: open });

// ---------- server screens ----------
export async function loadScreen(id: string): Promise<void> {
  try {
    const screen = id === HOME ? await api.home() : await api.screen(id);
    set((s) => ({ screens: { ...s.screens, [id]: screen }, screenError: null }));
  } catch (e) {
    set({ screenError: errorText(get().t, e) });
  }
}

/** The whole list of a source (categories, people: tens of items), fetched once and filtered here. */
export async function optionList(source: string): Promise<Option[]> {
  const known = get().options[source];
  if (known) return known;
  const list = await api.options(source, "", OPTION_LIST_LIMIT);
  set((s) => ({ options: { ...s.options, [source]: list } }));
  return list;
}

/** Loads what the capture form needs before it is opened. Errors are ignored (offline: next round). */
export async function prefetch() {
  if (!configured(get().settings)) return;
  await loadScreen(HOME);
  const form = await api.screen(CAPTURE).catch(() => null);
  if (!form) return;
  set((s) => ({ screens: { ...s.screens, [CAPTURE]: form } }));
  const sources = new Set<string>();
  for (const c of form.components) {
    if (c.type !== "form") continue;
    for (const f of c.fields) {
      if ((f.type === "choice" || f.type === "multi_choice") && f.source) sources.add(f.source);
    }
  }
  for (const src of sources) {
    try {
      const list = await api.options(src, "", OPTION_LIST_LIMIT);
      set((s) => ({ options: { ...s.options, [src]: list } }));
    } catch {
      // next round
    }
  }
  api
    .charts()
    .then((chartSpecs) => set({ chartSpecs }))
    .catch(() => undefined);
}

// ---------- captures and the offline queue ----------
export async function submit(
  form: FormComponent,
  values: Record<string, Json>,
): Promise<SubmitOutcome> {
  const t = get().t;
  const request = { action: form.submit.action, client_id: newId(), values, created_at: nowIso() };
  if (!configured(get().settings)) {
    await queue.add(request);
    await countQueue();
    return { kind: "queued", message: t("submit.queuedNoServer") };
  }
  try {
    const r = await api.action(request);
    if (r.status === "ok") {
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
    refresh();
    hostRef.desktop?.broadcastRefresh();
  }
  return n;
}

export async function dismissRejected(clientId: string) {
  await queue.dismiss(clientId);
  await countQueue();
}

// ---------- chart definitions and the editor ----------
export async function loadCharts() {
  const chartSpecs = await api.charts();
  set({ chartSpecs });
  return chartSpecs;
}

export async function loadCatalog(): Promise<ChartCatalog> {
  const known = get().catalog;
  if (known) return known;
  const catalog = await api.catalog();
  set({ catalog });
  return catalog;
}

export const preview = (spec: ChartSpec, drill?: string | null) => api.preview(spec, drill);

async function chartsChanged() {
  await loadCharts();
  charts.invalidate();
  set((s) => {
    const { [HOME]: _home, ...screens } = s.screens;
    return { screens };
  });
  refresh();
  hostRef.desktop?.broadcastRefresh();
}

export async function saveChart(spec: ChartSpec) {
  const saved = spec.id ? await api.updateChart(spec) : await api.createChart(spec);
  await chartsChanged();
  return saved;
}

export async function deleteChart(id: string) {
  await api.deleteChart(id);
  await chartsChanged();
  await loadWidgets(); // its widgets are gone too
}

export async function orderCharts(ids: string[]) {
  set({ chartSpecs: await api.orderCharts(ids) });
  await chartsChanged();
}

// ---------- widgets of this device (kept on the device too: they appear at login without network) ----------
export async function loadWidgets(): Promise<Widget[]> {
  const widgets = await api.widgets();
  widgetsLoaded = true;
  await hostRef.store.write(WIDGETS_FILE, JSON.stringify({ widgets }));
  set({ widgets });
  hostRef.desktop?.setWidgets(widgets);
  return widgets;
}

export async function addWidget(chartId: string, size: string) {
  await api.addWidget(chartId, size);
  await loadWidgets();
}

export async function updateWidget(id: string, chartId: string, size: string) {
  await api.updateWidget(id, chartId, size);
  await loadWidgets();
}

export async function removeWidget(id: string) {
  await api.deleteWidget(id);
  await loadWidgets();
}

// ---------- settings ----------
export async function saveSettings(patch: SettingsPatch) {
  const next = await hostRef.setSettings(patch);
  onSettingsChanged(next);
  return next;
}

export const todayIso = () => today();
