import {
  blocksToMarkdown,
  type DatabaseFilter,
  type DatabaseView,
  markdownToBlocks,
  type PageSpec,
  resolveTemplateLinks,
  templatePage,
} from "@boni/views";
import { useMemo } from "react";
import { create } from "zustand";
import {
  AgentApi,
  type AiLevel,
  type AutoAccept,
  type ConversationSummary,
  type DataRow,
  type DataType,
  type DataValue,
  type ExtensionView,
  type InboxRequest,
  type LiveEvent,
  type MailGuide,
  type MailInput,
  type MailView,
  type Page,
  type PageInfo,
  type Planner,
  type Proposal,
  type ProposalView,
  type Related,
  type Reply,
  type RunDetail,
  type RunSummary,
  type Tree,
  type TurnResult,
  type Visibility,
} from "./core/agent.ts";
import { ApiError, BoniApi, NotConfiguredError, OfflineError } from "./core/api.ts";
import type { SystemColumns } from "./core/audit.ts";
import type { HistoryMark } from "./core/blame.ts";
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
  recent: "recent.json",
  sidebar: "sidebar.json",
};
/** How many recent pages the sidebar keeps. */
const RECENT_MAX = 5;
const OPTION_LIST_LIMIT = 500;
const RELOAD_EVERY_MINUTES = 15;
const DELETE_AFTER_MS = 6000;

/** Something opened lately (the sidebar's «Recientes», on this device). */
export type Recent =
  | { kind: "page"; id: string; title: string }
  | { kind: "collection"; id: string; title: string }
  | { kind: "row"; id: string; type: string; title: string };

export type View =
  | { kind: "home" }
  | { kind: "chart"; id: string; drill?: string | null }
  | { kind: "chat" }
  | { kind: "inbox" }
  | { kind: "log" }
  | { kind: "page"; id: string }
  /** A row of a collection opened as a page (its properties and its text), as Notion's. */
  /** Where it was opened from, to go back there (none: the tree, «Recientes», a search: back to its collection). */
  | { kind: "row"; type: string; id: string; from?: "collection" | "allPages" | "page" }
  /** «Todas las páginas» (Juan, 2026-10-28): the whole tree, to manage (filter, protection, the eye, move). */
  | { kind: "allPages" }
  | { kind: "audit"; filter: AuditFilter }
  /** One collection on a page of its own (its protection is unlocked only here). */
  | { kind: "collection"; type: string }
  /** A proposal on a page of its own, read-only (Juan, 2026-10-23): its values, its note, why and where from. */
  | { kind: "proposal"; id: string; back: View };
/**
 * The right side panel (on the phone, a sheet over the whole screen): a server screen (the capture form, maybe
 * filled in by a shortcut), the chart editor or the shortcut editor.
 */
export type Panel =
  | null
  | { kind: "screen"; id: string; values?: F.Values; shortcut?: string }
  | { kind: "edit"; spec: ChartSpec; isNew: boolean }
  | { kind: "shortcut"; shortcut: Shortcut; isNew: boolean }
  /** A block of the open page: a control for each of its settings in the block catalogue. */
  | { kind: "block"; id: string }
  /** The rows a data block counts (a click on it: «Lo que cuenta»), or those of one of its bars or points. */
  | { kind: "rows"; id: string; drill?: string; label?: string };
/** The phone's tabs: capturing (shortcuts), the charts and the conversation with Boni. */
export type Tab = "capture" | "pages" | "charts" | "boni";

/** One turn of the conversation: what Juan asked and what the agent answered (painted by the code). */
export interface ChatEntry {
  id: string;
  request: string;
  result: TurnResult | null;
  error: string | null;
  /** The steps it took, as they were seen live (docs/conversacion.md 3.5); kept for the session. */
  steps?: LiveStep[];
}
/** A step of a turn as it runs: what it is (the tool's title, or the kind of step) and whether it ended. */
export interface LiveStep {
  id: string;
  op: string;
  what: string;
  done: boolean;
}
/** The turn that runs now: its entry, the live id the device gave it, what it did and said so far. */
export interface LiveTurn {
  entry: string;
  id: string;
  thinking: boolean;
  steps: LiveStep[];
  replies: Reply[];
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
  /** The section Settings opens on (a link to Ajustes → Modelos), else the first. */
  settingsSection: string | null;
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
  /** The open conversation's turns (docs/conversacion.md 3.1). */
  chat: ChatEntry[];
  chatBusy: boolean;
  /** Juan's conversations, the latest first; null until they come. */
  conversations: ConversationSummary[] | null;
  /** The conversation open in the chat; null: a new one, made with its first message. */
  conversationId: string | null;
  /** The turn running now, as it goes (3.5). */
  live: LiveTurn | null;
  /** The models a conversation may plan with (3.5). */
  planners: Planner[];
  /** The user's pages (docs/extensiones.md 6): null while unknown (no server, agent store off). */
  pages: PageInfo[] | null;
  /** The open page with its blocks. */
  page: Page | null;
  /** Where the caret goes next on the open page: a block (start or end of its text), or the title. */
  pageFocus: { block: string; at: "start" | "end" | number } | { title: true } | null;
  /** A chart being created from a block of this page: saved, it takes that block's place. */
  chartForPage: { page: string; block: string } | null;
  /** The user's collections (as databases), and the rows loaded of each. */
  dataTypes: DataType[] | null;
  /** The tree of the sidebar (docs/clases.md §2.7): collections and the records with a note they show. */
  tree: Tree | null;
  /** What was opened last on this device, newest first (the sidebar's «Recientes»). */
  recent: Recent[];
  /** The sidebar's folded sections and unfolded branches of the tree, on this device. */
  fold: { sections: string[]; branches: string[] };
  /** The row open as a page, with its text. */
  row: DataRow | null;
  /** The open row's text as the page editor's blocks (saved back as Markdown). */
  rowDoc: Page | null;
  /** What points to the open row (its «Relacionado») and the titles of what it points to. */
  related: Related | null;
  /** With a record's History open, who wrote each block and property of its page, and whose to light. */
  historyMarks: HistoryMarks | null;
  /** Blocks selected as a whole in the page being edited (Notion's): the block where it started, the one where it ends. */
  blockSel: { anchor: string; focus: string } | null;
  /** A file pasted or dropped with several collections of files to keep it in: the app asks once. */
  fileChoice: {
    options: { type: string; name: string }[];
    answer: (type: string | null) => void;
  } | null;
  /** One of Boni's screens as a page («Modelos»), edited like any page; `modified` when it is not Boni's. */
  rows: Record<
    string,
    {
      rows: DataRow[];
      titles: Record<string, string>;
      ghosts?: DataRow[];
      columns?: Record<string, SystemColumns>;
    }
  >;
  /** The record opened from another app (its id), for the peek's "Abrir en Boni". */
  openedNote: string | null;
  /** How each collection is shown on its own page (this session). */
  collectionViews: Record<string, DatabaseView>;
  /** Ctrl+K: the quick find over the pages. */
  findOpen: boolean;
  /** The pages in the trash, while its list is open. */
  trash: (PageInfo & { deleted: number })[] | null;
  /** Proposals waiting in the inbox, and the agent's latest runs (the log). */
  inbox: Proposal[];
  /** Questions from background work waiting for Juan (Juan, 2026-10-24: one queue with the proposals). */
  requests: InboxRequest[];
  /** The inbox is being read for a proposal opened by its id (its page waits instead of saying it is gone). */
  inboxLoading: boolean;
  /** Proposals being accepted or rejected right now (their card shows it; another can be decided meanwhile). */
  deciding: Record<string, "accept" | "done" | "reject">;
  /** Why deciding one failed, in Juan's words, on its card. */
  decideErrors: Record<string, { text: string; gone: boolean }>;
  /** The inbox as a panel on the right (Juan, 2026-10-22): opens by itself when something new arrives. */
  inboxOpen: boolean;
  runs: RunSummary[];
  /** How often Boni would have accepted alone, and been right (shown on top of the Registro). */
  autoAccept: AutoAccept | null;
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
/** The agent's API, for views that read and change things of their own («Modelos»). */
export const agentApi = agent;
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
  settingsSection: null,
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
  conversations: null,
  conversationId: null,
  live: null,
  planners: [],
  pages: null,
  page: null,
  pageFocus: null,
  chartForPage: null,
  findOpen: false,
  trash: null,
  dataTypes: null,
  tree: null,
  recent: [],
  fold: { sections: [], branches: [] },
  rows: {},
  collectionViews: {},
  openedNote: null,
  row: null,
  rowDoc: null,
  related: null,
  historyMarks: null,
  blockSel: null,
  fileChoice: null,
  inbox: [],
  requests: [],
  inboxLoading: false,
  deciding: {},
  decideErrors: {},
  inboxOpen: false,
  runs: [],
  autoAccept: null,
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

/**
 * Starts the page: settings, what the device kept, shell events. Widget pages load less; a peek (a note opened from
 * another app, in a small window that closes when it loses the focus) loads as little as a widget.
 */
export async function init(kind: "main" | "widget" | "peek", h: Host = defaultHost) {
  const role = kind === "peek" ? "widget" : kind;
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
  void readJson<{ items?: unknown }>(h.store, FILES.recent).then((r) => {
    const ok = (x: unknown): x is Recent => {
      const o = x as Partial<Record<string, unknown>> | null;
      return (
        !!o &&
        typeof o.id === "string" &&
        typeof o.title === "string" &&
        (o.kind === "page" ||
          o.kind === "collection" ||
          (o.kind === "row" && typeof o.type === "string"))
      );
    };
    if (Array.isArray(r?.items)) set({ recent: r.items.filter(ok).slice(0, RECENT_MAX) });
  });
  void readJson<{ sections?: unknown; branches?: unknown }>(h.store, FILES.sidebar).then((f) => {
    const ids = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 500) : [];
    if (f) set({ fold: { sections: ids(f.sections), branches: ids(f.branches) } });
  });
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
    window.addEventListener("pagehide", () => {
      void flushPage();
      void flushRowBody();
    });
    void countQueue();
    void reloadAll();
    void h.phone?.takeLaunch().then((target) => target && navigate(target));
    // A note asked for while the window was opening (a boni:// link) comes now that the page listens.
    h.desktop?.pageReady?.();
    publishTargets();
    if (!h.desktop && !h.phone) {
      // A plain browser has no shell sending ticks: keep its own minute.
      let minute = 0;
      setInterval(() => void onTick(++minute, role), 60_000);
    }
  } else if (kind === "peek") {
    // A note's text typed a moment before the peek closes is sent before it goes.
    window.addEventListener("pagehide", () => void flushRowBody());
    h.desktop?.pageReady?.();
    h.embed?.ready();
  } else {
    void loadCharts().catch(() => undefined);
  }
}

/** What the tray, a widget or a phone's launcher shortcut asks the main window to show. */
export function navigate(screen: string) {
  if (screen.startsWith("note:")) void openNoteAt(screen.slice(5));
  else if (screen.startsWith("proposal:")) void openProposal(screen.slice(9));
  else if (screen === "blank") {
    // The peek was hidden: its next note starts empty, never showing the last one for a moment.
    void flushRowBody();
    set({ row: null, rowDoc: null, view: { kind: "home" } });
  } else if (screen === "settings") openSettings();
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
  // The inbox, every minute in the main window: new proposals open its panel.
  if (role === "main" && configured(get().settings)) void loadInbox();
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
/** A block's settings in the side panel («Modificar…»). */
export const openBlockPanel = (id: string) => set({ panel: { kind: "block", id }, ...FRESH_PANEL });
/** What a data block counts, in the side panel (a click on it; `drill` a bar's or a point's key). */
export const openRowsPanel = (id: string, drill?: string, label?: string) =>
  set({
    panel: { kind: "rows", id, ...(drill ? { drill } : {}), ...(label ? { label } : {}) },
    ...FRESH_PANEL,
  });
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
export const openSettings = (open = true, section: string | null = null) =>
  set({ settingsOpen: open, settingsSection: open ? section : null });

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
  // The phone's «Páginas» goes back a step at a time: a record to its collection, a collection or a page to the tree.
  else if (s.tab === "pages" && s.view.kind === "row") {
    void flushRowBody();
    openCollection(s.view.type);
  } else if (s.tab === "pages" && (s.view.kind === "collection" || s.view.kind === "page"))
    set({ view: { kind: "home" } });
  else if (s.view.kind === "row") {
    // A record opened from another app (Boni Calendar's «Abrir en Boni»): Back goes back to that app.
    void flushRowBody();
    showChat();
    return false;
  } else if (s.tab !== "capture") showTab("capture");
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
 * A tap on a shortcut. `open` (or a form it cannot fill completely): the form filled in. `save`: the capture is
 * sent at once, so what it counts shows at once (Juan, 2026-10-25), and its notice's Undo takes it out again.
 * Without a connection it goes through the offline queue, held back while its notice offers Undo; it survives
 * closing the app.
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
  if (configured(get().settings)) {
    try {
      const r = await api.action(request);
      if (r.status === "ok") {
        charts.invalidate();
        refresh();
        hostRef.desktop?.broadcastRefresh();
        toast(t("shortcut.logged", { label: sc.label }), {
          label: t("toast.undo"),
          run: () => void undoCapture(request.client_id),
        });
        return;
      }
      if (r.status === "queued") return toast(r.message || t("submit.queuedServer"));
      openScreen(sc.screen, sc.values, sc.id);
      toast(r.message || t("form.check"));
      return;
    } catch (e) {
      // Without a connection: the queue below.
      if (!(e instanceof OfflineError)) return toast(errorText(t, e));
    }
  }
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

/** A capture just saved, out again (the notice's Undo): what counted it shows without it at once. */
async function undoCapture(clientId: string) {
  const t = get().t;
  try {
    await api.undoAction(clientId);
    charts.invalidate();
    refresh();
    hostRef.desktop?.broadcastRefresh();
    toast(t("shortcut.undone"));
  } catch (e) {
    toast(e instanceof ApiError ? t("shortcut.undoFailed") : errorText(t, e));
  }
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
/** What a live event changes in the turn as it runs. */
function applyLive(l: LiveTurn, e: LiveEvent): LiveTurn {
  switch (e.type) {
    case "planning":
      return { ...l, thinking: true };
    case "planned":
      return { ...l, thinking: false };
    case "step":
      return e.state === "start"
        ? {
            ...l,
            thinking: false,
            steps: [...l.steps, { id: e.id, op: e.op, what: e.what, done: false }],
          }
        : { ...l, steps: l.steps.map((x) => (x.id === e.id ? { ...x, done: true } : x)) };
    case "reply":
      return { ...l, replies: [...l.replies, e.reply] };
    default:
      return l;
  }
}

/**
 * A call that runs a turn (or goes on with one), watched live while the request waits (docs/conversacion.md 3.5):
 * the device makes an id for it, and asks the server what it did every moment until it answers. Any device can,
 * the phone and the desktop app too, since it is only requests.
 */
async function agentCall(id: string, call: (live: string) => Promise<TurnResult>) {
  const liveId = newId();
  set({
    chatBusy: true,
    live: { entry: id, id: liveId, thinking: true, steps: [], replies: [] },
  });
  let after = 0;
  /** What the turn did since the last look; true once it ended or waits on Juan. */
  const pull = async () => {
    const r = await agent.live(liveId, after).catch(() => null);
    if (!r) return false;
    after += r.events.length;
    const l = get().live;
    if (l?.id === liveId && r.events.length) set({ live: r.events.reduce(applyLive, l) });
    return r.done;
  };
  let running = true;
  void (async () => {
    while (running) {
      await new Promise((r) => setTimeout(r, LIVE_POLL_MS));
      if (!running || (await pull())) break;
    }
  })();
  try {
    const r = await call(liveId);
    running = false;
    // What it did after the last look (a quick turn answers between two); the watch ends on its next tick,
    // never waited on (a page whose clock is stopped would wait forever).
    await pull();
    const entry = get().chat.find((e) => e.id === id);
    const steps = get().live?.id === liveId ? (get().live?.steps ?? []) : [];
    patchEntry(id, {
      result: mergeResult(entry?.result ?? null, r),
      error: null,
      ...(steps.length
        ? { steps: [...(entry?.steps ?? []), ...steps.map((x) => ({ ...x, done: true }))] }
        : {}),
    });
    if (r.pending?.kind === "confirm") set((s) => ({ confirmFlip: !s.confirmFlip }));
    if (r.proposals.length) void loadInbox();
  } catch (e) {
    const code = e instanceof ApiError ? e.code : null;
    patchEntry(id, {
      error: code === "agent-off" ? agentErrorText(get().t, code) : errorText(get().t, e),
    });
  } finally {
    running = false;
    if (get().live?.id === liveId) set({ live: null });
    set({ chatBusy: false });
    void loadConversations();
  }
}
const LIVE_POLL_MS = 350;

export async function sendTurn(text: string) {
  const request = text.trim();
  if (!request || get().chatBusy) return;
  const id = newId();
  set((s) => ({ chat: [...s.chat, { id, request, result: null, error: null }] }));
  // A new conversation is made with its first message (its title comes from it).
  let conversation = get().conversationId;
  if (!conversation)
    try {
      const made = await agent.newConversation();
      conversation = made.id;
      // Its title, as the server will give it from this first message (its first words).
      const title = request.length <= 60 ? request : `${request.slice(0, 57).trimEnd()}…`;
      set((s) => ({
        conversationId: made.id,
        conversations: [{ ...made, title }, ...(s.conversations ?? [])],
      }));
    } catch {
      // A server without the list: the device keeps a conversation of its own there, as before.
    }
  await agentCall(id, (live) => agent.turn(request, conversation ?? CONVERSATION, live));
}
/** «Parar» (docs/conversacion.md 3.5): the turn stops before its next step, or where it waits. */
export function stopTurn() {
  const l = get().live;
  if (l) void agent.stop(l.id).catch(() => undefined);
}
export async function answerAsk(entryId: string, a: { choice: number } | { text: string }) {
  const e = get().chat.find((x) => x.id === entryId);
  const p = e?.result?.pending;
  if (!e?.result || p?.kind !== "ask") return;
  const run = e.result.run;
  await agentCall(entryId, (live) => agent.answer(run, p.id, a, live));
}
export async function confirmPending(entryId: string) {
  const e = get().chat.find((x) => x.id === entryId);
  const p = e?.result?.pending;
  if (!e?.result || p?.kind !== "confirm") return;
  const run = e.result.run;
  await agentCall(entryId, (live) => agent.confirm(run, p.id, live));
}

// ------------------------------------------------------------ conversations (docs/conversacion.md 3.1)

export async function loadConversations() {
  try {
    set({ conversations: await agent.conversations() });
  } catch {
    if (get().conversations === null) set({ conversations: [] });
  }
}
export async function loadPlanners() {
  try {
    set({ planners: await agent.planners() });
  } catch {
    set({ planners: [] });
  }
}
/** A conversation of the list, its turns as the server keeps them. */
export async function openConversation(id: string) {
  if (get().chatBusy) return;
  set({ conversationId: id, chat: [], view: { kind: "chat" } });
  try {
    const r = await agent.conversation(id);
    if (get().conversationId !== id) return;
    set({
      chat: r.turns.map((x) => ({
        id: x.id,
        request: x.request,
        result: {
          run: x.run,
          status: x.status,
          replies: x.replies,
          pending: x.pending,
          proposals: x.proposals,
          notices: x.notices,
          error: x.error,
        },
        error: null,
      })),
    });
  } catch (e) {
    toast(errorText(get().t, e));
  }
}
/** A new conversation: the chat starts empty; the conversation is made with its first message. */
export function newConversation() {
  if (get().chatBusy) return;
  set({ conversationId: null, chat: [], view: { kind: "chat" } });
}
export async function renameConversation(id: string, title: string) {
  const t = title.trim().slice(0, 120);
  if (!t) return;
  try {
    const c = await agent.updateConversation(id, { title: t });
    if (c)
      set((s) => ({ conversations: (s.conversations ?? []).map((x) => (x.id === id ? c : x)) }));
  } catch (e) {
    toast(errorText(get().t, e));
  }
}
/** To the trash, with its turns. */
export async function removeConversation(id: string) {
  try {
    await agent.deleteConversation(id);
    set((s) => ({ conversations: (s.conversations ?? []).filter((x) => x.id !== id) }));
    if (get().conversationId === id) newConversation();
    toast(get().t("chats.deleted"));
  } catch (e) {
    toast(errorText(get().t, e));
  }
}
/** The model the open conversation plans with ("" for the account's); a new one is made to keep it. */
export async function chooseModel(model: string) {
  let id = get().conversationId;
  try {
    if (!id) {
      const made = await agent.newConversation();
      id = made.id;
      set((s) => ({ conversationId: made.id, conversations: [made, ...(s.conversations ?? [])] }));
    }
    const c = await agent.updateConversation(id, { model });
    if (c)
      set((s) => ({ conversations: (s.conversations ?? []).map((x) => (x.id === c.id ? c : x)) }));
  } catch (e) {
    toast(errorText(get().t, e));
  }
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
    const [inbox, asked] = await Promise.all([
      agent.proposals(),
      // An older server has no questions: the inbox goes on with its proposals.
      agent.requests().catch((e) => {
        if (e instanceof OfflineError) throw e;
        return null;
      }),
    ]);
    const requests = asked ?? get().requests;
    // Something new since the last look (not the first one, when the window opens): the panel comes out.
    const ids = [...inbox.map((p) => p.id), ...requests.map((r) => r.id)];
    const fresh = inboxSeen !== null && ids.some((id) => !inboxSeen?.has(id));
    inboxSeen = new Set([...(inboxSeen ?? []), ...ids]);
    // A card whose decision failed stays, saying why, until Juan takes it out (the server no longer lists it).
    const errors = get().decideErrors;
    const kept = get().inbox.filter((p) => errors[p.id] && !inbox.some((x) => x.id === p.id));
    const keptAsked = get().requests.filter(
      (r) => errors[r.id] && !requests.some((x) => x.id === r.id),
    );
    set({
      inbox: [...kept, ...inbox],
      requests: [...keptAsked, ...requests],
      ...(fresh ? { inboxOpen: true } : {}),
    });
  } catch {
    // the inbox stays as it was (offline, agent off)
  }
}
let inboxSeen: Set<string> | null = null;
export const toggleInbox = (open = !get().inboxOpen) => {
  set({ inboxOpen: open });
  if (open) void loadInbox();
};
/** Accepting one proposal (never all at once: each is looked at, docs/nucleo.md 7.5). */
/**
 * Deciding proposals (Juan, 2026-10-23: accepting took 10-20 s, gave no sign of it, and blocked the next one):
 * each click marks its card at once (the button turns into a spinner) and joins a queue the server answers in
 * order, so Juan can go on with the next card; a decided card leaves the list as soon as its answer comes, a
 * failed one says why on the card, and the inbox is read again once the queue is empty.
 */
let deciding: Promise<void> = Promise.resolve();
let decided = 0;
function decide(
  id: string,
  kind: "accept" | "done" | "reject",
  run: () => Promise<void>,
): Promise<void> {
  if (get().deciding[id]) return Promise.resolve();
  set((s) => ({
    deciding: { ...s.deciding, [id]: kind },
    decideErrors: Object.fromEntries(Object.entries(s.decideErrors).filter(([k]) => k !== id)),
  }));
  decided++;
  const job = deciding.then(async () => {
    try {
      await run();
    } finally {
      set((s) => ({
        deciding: Object.fromEntries(Object.entries(s.deciding).filter(([k]) => k !== id)),
      }));
      if (--decided === 0) void loadInbox();
    }
  });
  deciding = job.catch(() => {});
  return job;
}
const dropProposal = (id: string) =>
  set((s) => ({
    inbox: s.inbox.filter((p) => p.id !== id),
    requests: s.requests.filter((r) => r.id !== id),
  }));
/** A decision that failed: stale (it changed since) and already decided are not Juan's mistakes. */
function decideFailed(id: string, code: string | { text: string }) {
  const t = get().t;
  const gone =
    code === "stale" ||
    code === "no-such-proposal" ||
    code === "nothing-pending" ||
    code === "run-expired";
  const text =
    typeof code !== "string"
      ? code.text
      : code === "stale"
        ? t("inbox.stale")
        : code === "no-such-proposal"
          ? t("inbox.alreadyDecided")
          : code === "nothing-pending" || code === "run-expired"
            ? t("inbox.requestGone")
            : agentErrorText(t, code);
  set((s) => ({ decideErrors: { ...s.decideErrors, [id]: { text, gone } } }));
}
/** Takes a card that can no longer be decided out of the list. */
export function dismissProposal(id: string) {
  dropProposal(id);
  set((s) => ({
    decideErrors: Object.fromEntries(Object.entries(s.decideErrors).filter(([k]) => k !== id)),
  }));
}

/**
 * `done` ("Ya lo hice", Juan 2026-10-23): the task is made already marked done, and the reading counts as right.
 */
export function acceptProposal(
  id: string,
  edits?: { title?: string; collection?: string },
  opts: { done?: boolean } = {},
) {
  return decide(id, opts.done ? "done" : "accept", async () => {
    const t = get().t;
    try {
      const r = await agent.accept(id, opts.done ? { ...edits, done: true } : edits);
      if (r.pending?.kind === "confirm") {
        // Accepted, but it still needs a confirmation (deleting...): it goes on in the conversation.
        const entry: ChatEntry = {
          id: newId(),
          request: t("inbox.acceptedRequest"),
          result: r,
          error: null,
        };
        dropProposal(id);
        set((s) => ({
          chat: [...s.chat, entry],
          confirmFlip: !s.confirmFlip,
          view: { kind: "chat" },
        }));
      } else if (r.error) decideFailed(id, r.error);
      else {
        dropProposal(id);
        if (opts.done) toast(t("inbox.acceptedDone"));
        else if (edits) toast(t("inbox.acceptedCorrected"));
      }
    } catch (e) {
      decideFailed(id, { text: errorText(t, e) });
    }
  });
}
/**
 * Answering a question of background work (Juan, 2026-10-24): the work goes on with the answer, as background work
 * (what it makes arrives as proposals, read again once the queue is empty).
 */
export function answerRequest(id: string, a: { choice: number } | { text: string }) {
  return decide(id, "accept", async () => {
    try {
      const r = await agent.answerRequest(id, a);
      if (r.error) decideFailed(id, r.error);
      else dropProposal(id);
    } catch (e) {
      decideFailed(id, { text: errorText(get().t, e) });
    }
  });
}
/** Putting a question away unanswered: its work ends having done nothing more. */
export function dismissRequest(id: string) {
  return decide(id, "reject", async () => {
    try {
      await agent.dismissRequest(id);
      dropProposal(id);
    } catch (e) {
      decideFailed(id, { text: errorText(get().t, e) });
    }
  });
}

/** A proposal's own page (from its card, its ghost row or the calendar); Esc and the crumb go back. */
export async function openProposal(id: string) {
  const v = get().view;
  set({ view: { kind: "proposal", id, back: v.kind === "proposal" ? v.back : v } });
  if (!get().inbox.some((p) => p.id === id)) {
    set({ inboxLoading: true });
    try {
      await loadInbox();
    } finally {
      set({ inboxLoading: false });
    }
  }
}
export function closeProposal() {
  const v = get().view;
  if (v.kind !== "proposal") return;
  if (v.back.kind === "row") void openRow(v.back.type, v.back.id);
  else if (v.back.kind === "page") void openPage(v.back.id);
  else set({ view: v.back });
}
/** The mail a proposal came from, as its row in Boni ("Ver correo": IMAP gives no webmail link). */
export const openMail = (at: { type: string; id: string }) => void openRow(at.type, at.id);
export function rejectProposal(id: string) {
  return decide(id, "reject", async () => {
    try {
      await agent.reject(id);
      dropProposal(id);
    } catch (e) {
      decideFailed(id, { text: errorText(get().t, e) });
    }
  });
}

export async function loadRuns() {
  try {
    set(await agent.runs());
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

/** The versions of extensions proposed through the MCP, waiting for Juan (E3); null when the server says no. */
export async function loadProposals(): Promise<ProposalView[] | null> {
  try {
    return await agent.extensionProposals();
  } catch {
    return null;
  }
}

/** Juan activates or rejects a proposed version, or goes back to the one before; false when it did not take. */
export async function decideExtension(
  id: string,
  action: "activate" | "reject" | "revert",
): Promise<boolean> {
  try {
    await agent.decideExtension(id, action);
    return true;
  } catch {
    toast(useStore.getState().t("ext.error"));
    return false;
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
  void loadTree();
  void loadDataTypes();
  const pages = await loadPages();
  const v = get().view;
  if (v.kind === "home" || (v.kind === "page" && !pages?.some((p) => p.id === v.id)))
    await openStart();
  else if (v.kind === "page") await openPage(v.id);
}

export async function openPage(id: string) {
  await flushPage();
  await flushRowBody();
  const same = get().page?.id === id;
  set({ view: { kind: "page", id }, page: same ? get().page : null });
  try {
    const page = await agent.page(id);
    const v = get().view;
    if (!page || v.kind !== "page" || v.id !== id) return;
    set({ page });
    noteRecent({ kind: "page", id, title: page.title });
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

/** A new page (as Notion's): untitled, open at once with the caret in its name. It is on screen before
 * the server answers; what is typed meanwhile goes to the server with it. */
export async function newPage(parent: string | null = null) {
  await flushPage();
  const temp: Page = {
    id: `new-${blockId()}`,
    title: "",
    icon: "",
    parent,
    position: Number.MAX_SAFE_INTEGER,
    spec: { version: 1, blocks: [] },
  };
  set({
    pages: [...(get().pages ?? []), temp],
    page: temp,
    view: { kind: "page", id: temp.id },
    pageFocus: { title: true },
  });
  try {
    const made = await agent.createPage({ title: "", parent });
    if (!made) throw new Error("no page");
    const typed = get().page?.id === temp.id ? (get().page as Page) : null;
    const page: Page = typed
      ? { ...made, title: typed.title, icon: typed.icon, spec: typed.spec }
      : made;
    set({
      pages: (get().pages ?? []).map((p) => (p.id === temp.id ? page : p)),
      ...(typed ? { page, view: { kind: "page" as const, id: page.id } } : {}),
    });
    if (typed && (typed.title || typed.icon || typed.spec.blocks.length))
      savePage(page.id, {
        title: typed.title.trim(),
        spec: typed.spec,
        ...(typed.icon ? { icon: typed.icon } : {}),
      });
    await keep(FILES.lastPage, { page });
    await keep(FILES.pages, { pages: get().pages });
  } catch {
    set({ pages: (get().pages ?? []).filter((p) => p.id !== temp.id) });
    if (get().page?.id === temp.id) await openStart();
    toast(get().t("page.error"));
  }
}

// Changes to the open page are kept at once on screen and sent together after a short pause (typing does
// not make a request per key); opening another page or leaving the window sends what is pending.
const SAVE_AFTER_MS = 500;
let pending: {
  id: string;
  patch: { title?: string; icon?: string; spec?: PageSpec };
  timer: ReturnType<typeof setTimeout>;
} | null = null;

function savePage(id: string, patch: { title?: string; icon?: string; spec?: PageSpec }) {
  // A page still being made on the server: what it holds is sent when it is (newPage).
  if (id.startsWith("new-")) return;
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
    if (p.patch.title !== undefined || p.patch.icon !== undefined)
      await keep(FILES.pages, { pages: get().pages });
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

/** The page's icon (an emoji; "" removes it). */
export function setPageIcon(icon: string) {
  const page = get().page;
  if (!page) return;
  set({
    page: { ...page, icon },
    pages: get().pages?.map((p) => (p.id === page.id ? { ...p, icon } : p)) ?? null,
  });
  savePage(page.id, { icon });
}

// Undo on a page (Ctrl+Z, Ctrl+Shift+Z), as Notion's: every change of its blocks can be taken back; typing
// in one block for a moment is one step.
const history = { page: "", past: [] as PageSpec[], future: [] as PageSpec[], typing: "", at: 0 };
const HISTORY_LIMIT = 200;

function remember(page: Page, typingIn?: string) {
  if (history.page !== page.id) Object.assign(history, { page: page.id, past: [], future: [] });
  const now = Date.now();
  const sameTyping = typingIn && history.typing === typingIn && now - history.at < 1500;
  history.typing = typingIn ?? "";
  history.at = now;
  history.future = [];
  if (sameTyping) return;
  history.past.push(page.spec);
  if (history.past.length > HISTORY_LIMIT) history.past.shift();
}

/** The page's blocks, changed at once here and kept on the server shortly after. `typingIn` names the
 * block being typed in (those keystrokes make one undo step). */
export function setPageBlocks(blocks: Block[], typingIn?: string) {
  const page = editing();
  if (!page) return;
  remember(page, typingIn);
  putSpec(page, { ...page.spec, version: 1, blocks });
}

/** A document's blocks kept: a page on the server; a row's text as Markdown, its row's body. */
function putSpec(page: Page, spec: PageSpec) {
  if (page.id.startsWith("row:")) {
    set({ rowDoc: { ...page, spec } });
    setRowBody(blocksToMarkdown(spec.blocks));
    return;
  }
  set({ page: { ...page, spec } });
  savePage(page.id, { spec });
}

export function undoPage(redo = false): boolean {
  const page = editing();
  if (!page || history.page !== page.id) return false;
  const from = redo ? history.future : history.past;
  const spec = from.pop();
  if (!spec) return false;
  (redo ? history.past : history.future).push(page.spec);
  history.typing = "";
  putSpec(page, spec);
  return true;
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

/** Whole blocks selected, from one to another (both in the page being edited). */
export const selectBlocks = (anchor: string, focus: string) =>
  set({ blockSel: { anchor, focus }, pageFocus: null });
export const clearBlockSel = () => {
  if (get().blockSel) set({ blockSel: null });
};

/** A file's bytes as base64: every host's channel to the server carries text. */
const base64Of = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
/** The biggest file a page takes pasted or dropped (the server's `MAX_PASTED_BYTES`). */
const MAX_PASTED = 5 * 1024 * 1024;

/**
 * Files pasted or dropped into the page being edited (Juan, 2026-10-30): each kept in Boni, where the account keeps
 * them (asked once when there is more than one collection of files), and put as file blocks after `after`, or in
 * place of the empty text block the caret was in.
 */
export async function addFilesToPage(files: File[], after: string | null): Promise<void> {
  const t = get().t;
  const made: Page["spec"]["blocks"] = [];
  let into: string | undefined;
  for (const file of files) {
    const name = file.name || "fichero";
    if (file.size > MAX_PASTED) {
      toast(t("file.tooBig", { name }));
      continue;
    }
    try {
      const data = await base64Of(file);
      let r = await agent.addFile(name, data, into);
      if ("choose" in r) {
        const options = r.choose;
        const picked = await new Promise<string | null>((answer) =>
          set({ fileChoice: { options, answer } }),
        );
        set({ fileChoice: null });
        if (!picked) return;
        into = picked;
        r = await agent.addFile(name, data, into);
        if ("choose" in r) return;
      }
      made.push({ id: blockId(), type: "file", file: r.id, name: r.name });
    } catch {
      toast(t("file.saveError", { name }));
    }
  }
  const page = editing();
  if (!page || !made.length) return;
  const blocks = page.spec.blocks;
  const i = after ? blocks.findIndex((b) => b.id === after) : blocks.length - 1;
  const here = blocks[i];
  const out = [...blocks];
  if (here && here.type === "text" && !here.text) out.splice(i, 1, ...made);
  else out.splice(i + 1, 0, ...made);
  setPageBlocks(out);
}

export const openFind = (open = true) => set({ findOpen: open });

/** A copy of a page next to it (Notion's Duplicate): its name with "(1)", its blocks, open at once. */
export async function duplicatePage(id: string) {
  await flushPage();
  try {
    const src = await agent.page(id);
    if (!src) return;
    const copy = await agent.createPage({
      title: `${src.title || get().t("page.untitled")} (1)`.slice(0, 120),
      parent: src.parent,
      spec: src.spec,
    });
    if (!copy) return;
    if (src.icon) await agent.updatePage(copy.id, { icon: src.icon });
    await loadPages();
    await openPage(copy.id);
  } catch {
    toast(get().t("page.error"));
  }
}

/** A page moved in the sidebar: under another one, or before / after a sibling (its position between). */
export async function movePage(id: string, target: string, where: "before" | "after" | "inside") {
  const pages = get().pages ?? [];
  const t = pages.find((p) => p.id === target);
  if (!t || id === target) return;
  // Never under itself.
  for (let at: string | null = where === "inside" ? target : t.parent; at; ) {
    if (at === id) return;
    at = pages.find((p) => p.id === at)?.parent ?? null;
  }
  const parent = where === "inside" ? target : t.parent;
  const siblings = pages
    .filter((p) => p.parent === parent && p.id !== id)
    .sort((a, b) => a.position - b.position);
  let position: number;
  if (where === "inside") position = (siblings[siblings.length - 1]?.position ?? 0) + 1;
  else {
    const i = siblings.findIndex((p) => p.id === target);
    const before = where === "before" ? siblings[i - 1] : siblings[i];
    const after = where === "before" ? siblings[i] : siblings[i + 1];
    position =
      before && after
        ? (before.position + after.position) / 2
        : before
          ? before.position + 1
          : (after?.position ?? 1) - 1;
  }
  const previous = pages;
  set({ pages: pages.map((p) => (p.id === id ? { ...p, parent, position } : p)) });
  try {
    await agent.updatePage(id, { parent, position });
    await loadPages();
  } catch {
    set({ pages: previous });
    toast(get().t("page.error"));
  }
}

export async function loadTrash() {
  try {
    set({ trash: await agent.trash() });
  } catch {
    toast(get().t("page.loadError"));
  }
}
export const closeTrash = () => set({ trash: null });

export async function restoreFromTrash(id: string) {
  try {
    await agent.restorePage(id);
    await Promise.all([loadPages(), loadTrash()]);
    toast(get().t("page.restored"));
  } catch {
    toast(get().t("page.error"));
  }
}

/** "/Página": a subpage made at once, linked from this block, and opened with the caret in its name. */
export async function newSubpageBlock(block: string) {
  const page = get().page;
  if (!page) return;
  try {
    const sub = await agent.createPage({ title: "", parent: page.id });
    if (!sub) return;
    setPageBlocks(
      page.spec.blocks.map((b) => (b.id === block ? { id: block, type: "page", page: sub.id } : b)),
    );
    await flushPage();
    set({ pages: [...(get().pages ?? []), sub] });
    set({ page: sub, view: { kind: "page", id: sub.id }, pageFocus: { title: true } });
    await keep(FILES.lastPage, { page: sub });
    void loadPages();
  } catch {
    toast(get().t("page.error"));
  }
}

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

// ------------------------------------------------------------------ databases (plan PR 19)

/** The sidebar's tree, again from the server. */
export async function loadTree(): Promise<Tree | null> {
  try {
    const tree = await agent.tree();
    set({ tree });
    return tree;
  } catch {
    return get().tree;
  }
}

/** A new collection (at the root or inside `parent`), opened on its page unless `stay`. Whether it was made. */
export async function newCollection(name: string, parent?: string, stay = false) {
  try {
    const id = await agent.createCollection(name, parent);
    await Promise.all([loadDataTypes(), loadTree()]);
    if (id && !stay) openCollection(id);
    return true;
  } catch (e) {
    toast(get().t(e instanceof ApiError && e.code === "taken" ? "tree.taken" : "tree.failed"));
    return false;
  }
}

/** A collection out of the tree: only an empty one (otherwise it says why). */
export async function deleteCollection(type: string) {
  try {
    await agent.deleteCollection(type);
    forgetRecent(type);
    await Promise.all([loadDataTypes(), loadTree()]);
  } catch (e) {
    toast(
      get().t(e instanceof ApiError && e.code === "not-empty" ? "tree.notEmpty" : "tree.failed"),
    );
  }
}

/** A collection moved under another (`null`: the root), or a record to another collection. */
export async function moveInTree(
  what: { collection: string } | { row: string },
  to: string | null,
) {
  try {
    if ("collection" in what) await agent.moveCollection(what.collection, to);
    else if (to) await agent.moveRow(what.row, to);
    await Promise.all([loadDataTypes(), loadTree()]);
  } catch {
    toast(get().t("tree.failed"));
  }
}

/** A note of the tree to the trash (its toast's Undo brings it back). */
export async function trashNote(type: string, id: string) {
  await deleteRow(type, id);
  forgetRecent(id);
  void loadTree();
}

/** A new note in a collection: a record of it, opened as a page to write in. */
export async function newNoteIn(type: string) {
  const row = await addRow(type);
  if (!row) return;
  void loadTree();
  await openRow(type, row.id);
}

/** Whether a collection's records with a note show in the tree (the account's choice, on every device). */
export async function setNotesInTree(type: string, notes: boolean) {
  const tree = get().tree;
  if (tree)
    set({
      tree: {
        ...tree,
        collections: tree.collections.map((c) => (c.id === type ? { ...c, notes } : c)),
      },
    });
  try {
    await agent.setNotesInTree(type, notes);
  } catch {
    toast(get().t("tree.failed"));
  }
  await loadTree();
}

export async function loadDataTypes(): Promise<DataType[] | null> {
  try {
    const dataTypes = await agent.dataTypes();
    set({ dataTypes });
    return dataTypes;
  } catch {
    return get().dataTypes;
  }
}

/**
 * «Restaurar la de Boni» on a page made from one of Boni's templates: its blocks as the template has them again,
 * with Undo (in the toast and Ctrl+Z) bringing the user's back.
 */
export function restoreTemplate() {
  const page = get().page;
  const name = page?.spec.template;
  if (!page || !name) return;
  const before = page.spec;
  remember(page);
  putSpec(page, resolveTemplateLinks(templatePage(name).spec, get().pages ?? []));
  toast(get().t("system.restored", { name: page.title || get().t("page.untitled") }), {
    label: get().t("toast.undo"),
    run: () => {
      const now = get().page;
      if (now?.id === page.id) putSpec(now, before);
    },
  });
}
/** «Todas las páginas»: the whole tree, with what manages it. */
export const showAllPages = () => {
  set({ view: { kind: "allPages" }, panel: null });
  void loadDataTypes();
  void loadTree();
};

/**
 * The sidebar's folding, kept on this device: `sections` lists the folded sections, `branches` the unfolded
 * branches of the tree. Flips `id` in its list, or sets it (`on`: in the list).
 */
export function toggleFold(kind: "sections" | "branches", id: string, on?: boolean) {
  const cur = get().fold[kind];
  const want = on ?? !cur.includes(id);
  if (want === cur.includes(id)) return;
  const fold = { ...get().fold, [kind]: want ? [...cur, id] : cur.filter((x) => x !== id) };
  set({ fold });
  void keep(FILES.sidebar, fold);
}

/** Which thing is open, whatever else its view says (where it was opened from, a title). */
const openKey = (v: State["view"]) =>
  v.kind === "row"
    ? `row:${v.id}`
    : v.kind === "page"
      ? `page:${v.id}`
      : v.kind === "collection"
        ? `collection:${v.type}`
        : v.kind;

/**
 * What is open shows lit in the sidebar's «Páginas» (Juan, 2026-10-30): the section unfolded, and the collections
 * above it, and a record's own collection when its notes show there. A page's own tree unfolds by itself
 * (`PageTree`). Only when something else is opened (or the tree arrives), so a branch folded by hand stays folded.
 */
function revealInTree() {
  const { view, tree, pages, dataTypes, fold } = get();
  const want: string[] = [];
  if (view.kind === "row" || view.kind === "collection") {
    const byId = new Map((tree?.collections ?? []).map((c) => [c.id, c]));
    let c = byId.get(view.type);
    if (!c && dataTypes?.some((x) => x.id === view.type && x.system)) want.push("boni");
    if (view.kind === "row" && c?.notes && tree?.notes.some((n) => n.id === view.id))
      want.push(c.id);
    for (let i = 0; c?.parent && i < 20; i++) {
      want.push(c.parent);
      c = byId.get(c.parent);
    }
  } else if (view.kind === "page") {
    if (pages?.some((p) => p.id === view.id && p.template)) want.push("boni");
  } else return;
  const branches = [...new Set([...fold.branches, ...want])];
  const sections = fold.sections.filter((x) => x !== "pages");
  if (branches.length === fold.branches.length && sections.length === fold.sections.length) return;
  const next = { sections, branches };
  set({ fold: next });
  void keep(FILES.sidebar, next);
}
useStore.subscribe((s, prev) => {
  if (openKey(s.view) !== openKey(prev.view) || (s.tree && !prev.tree) || (s.pages && !prev.pages))
    revealInTree();
});

/** Something gone out of «Recientes». */
function forgetRecent(id: string) {
  const recent = get().recent.filter((r) => r.id !== id);
  set({ recent });
  void keep(FILES.recent, { items: recent });
}

/** Something opened: first in «Recientes» (on this device). */
export function noteRecent(item: Recent) {
  const recent = [
    item,
    ...get().recent.filter((r) => !(r.kind === item.kind && r.id === item.id)),
  ].slice(0, RECENT_MAX);
  set({ recent });
  void keep(FILES.recent, { items: recent });
}
/** What «Auditoría» shows: an actor's kind (`who`, a prefix) or one actor (`by`), a collection, a run. */
export interface AuditFilter {
  who?: string;
  by?: string;
  type?: string;
  run?: string;
}
export const showAudit = (filter: AuditFilter) => {
  set({ view: { kind: "audit", filter }, panel: null });
  void loadDataTypes();
};
export const openCollection = (type: string) => {
  set({ view: { kind: "collection", type }, panel: null });
  const name = get().dataTypes?.find((x) => x.id === type)?.name;
  if (name) noteRecent({ kind: "collection", id: type, title: name });
};
export const setCollectionView = (type: string, v: DatabaseView) =>
  set({ collectionViews: { ...get().collectionViews, [type]: v } });

/**
 * How much the models may see of a collection, Juan's choice (at once here, then on the server). A private one
 * is lowered only with `unlock`, which only the collection's own page sends, after he confirms.
 */
export async function changeProtection(type: string, level: AiLevel, unlock = false) {
  const before = get().dataTypes;
  const put = (l: AiLevel) =>
    set({
      dataTypes: get().dataTypes?.map((x) => (x.id === type ? { ...x, level: l } : x)) ?? null,
    });
  const was = before?.find((x) => x.id === type)?.level;
  put(level);
  try {
    await agent.setProtection(type, level, unlock);
    return true;
  } catch (e) {
    if (was) put(was);
    toast(
      get().t(e instanceof ApiError && e.code === "locked" ? "protect.locked" : "db.saveError"),
    );
    return false;
  }
}

/** Saves a rule of a collection's protection (or removes it), then reads the collections again. */
export async function saveRule(
  type: string,
  rule: { id?: string; filter: DatabaseFilter[]; level: AiLevel } | { id: string; remove: true },
  unlock = false,
) {
  try {
    if ("remove" in rule) await agent.removeRule(rule.id, unlock);
    else await agent.saveRule(type, rule, unlock);
    await loadDataTypes();
    return true;
  } catch (e) {
    toast(
      get().t(e instanceof ApiError && e.code === "locked" ? "protect.locked" : "db.saveError"),
    );
    return false;
  }
}

/** A ghost row (a pending proposal) accepted or rejected where it is shown; its collection and the inbox again. */
export async function decideGhost(type: string, proposal: string, accept: boolean) {
  if (accept) await acceptProposal(proposal);
  else await rejectProposal(proposal);
  await loadRows(type);
}

export async function loadRows(type: string) {
  try {
    const r = await agent.dataRows(type);
    set({ rows: { ...get().rows, [type]: r } });
  } catch {
    toast(get().t("db.loadError"));
  }
}

const putRow = (type: string, row: DataRow) => {
  const cur = get().rows[type];
  if (!cur) return;
  const has = cur.rows.some((r) => r.id === row.id);
  set({
    rows: {
      ...get().rows,
      [type]: {
        ...cur,
        rows: has ? cur.rows.map((r) => (r.id === row.id ? row : r)) : [row, ...cur.rows],
      },
    },
  });
};

/** A cell changed in a view: at once here, then on the server (its answer is the truth). */
/** Boni's own records (calls to models, its activity): read only, so nothing here changes or opens them. */
const readOnly = (type: string) => get().dataTypes?.find((x) => x.id === type)?.system === true;

export async function editCell(type: string, id: string, field: string, value: DataValue) {
  if (readOnly(type)) return;
  const before = get().rows[type]?.rows.find((r) => r.id === id);
  if (!before) return;
  putRow(type, { ...before, values: { ...before.values, [field]: value } });
  try {
    const saved = await agent.updateRow(id, { [field]: value });
    if (saved) putRow(type, saved);
  } catch {
    putRow(type, before);
    toast(get().t("db.saveError"));
  }
}

/** The file a row holds (a file block names the row): its bytes' hash and its name; null when it is gone. */
export async function fileOfRow(id: string): Promise<{ sha: string; name: string } | null> {
  const row = await agent.dataRow(id).catch(() => null);
  if (!row?.type) return null;
  if (!get().dataTypes) await loadDataTypes();
  const def = get().dataTypes?.find((x) => x.id === row.type);
  const field = def?.fields.find((f) => f.type === "file");
  const sha = field ? row.values[field.id] : undefined;
  if (typeof sha !== "string") return null;
  const title = def ? row.values[def.titleField] : undefined;
  return { sha, name: typeof title === "string" ? title : "" };
}
/** An image of the user's to paint in a note's text (a data: address); null when it cannot be shown in place. */
export const fileInline = (sha: string) => agent.fileInline(sha).catch(() => null);

/** An attachment of a row, opened where the host can (the desktop app: with the system's app). */
export async function openFile(sha256: string, name: string) {
  const r = (await hostRef.openFile?.(sha256, name)) ?? "error";
  if (r === "shown") toast(get().t("db.fileShown"));
  else if (r !== "opened") toast(get().t(r === "offline" ? "db.fileOffline" : "db.fileError"));
}

export async function addRow(type: string, values: Record<string, DataValue> = {}) {
  if (readOnly(type)) return null;
  try {
    const row = await agent.createRow(type, values);
    if (row) putRow(type, row);
    return row;
  } catch {
    toast(get().t("db.saveError"));
    return null;
  }
}

/** Several rows to the trash at once (a table's selection), with one Undo for all of them. */
export async function deleteRows(type: string, ids: string[]) {
  if (readOnly(type) || !ids.length) return;
  const t = get().t;
  const gone: string[] = [];
  for (const id of ids) {
    try {
      await agent.deleteRow(id);
      gone.push(id);
    } catch {
      toast(t("db.saveError"));
      break;
    }
  }
  if (!gone.length) return;
  const now = get().rows[type];
  if (now)
    set({
      rows: {
        ...get().rows,
        [type]: { ...now, rows: now.rows.filter((r) => !gone.includes(r.id)) },
      },
    });
  void loadTree();
  toast(gone.length === 1 ? t("db.deleted") : t("db.deletedN", { n: gone.length }), {
    label: t("toast.undo"),
    run: () =>
      void Promise.all(gone.map((id) => agent.restoreRow(id)))
        .then(() => Promise.all([loadRows(type), loadTree()]))
        .catch(() => toast(t("db.saveError"))),
  });
}

export const deleteRow = (type: string, id: string) => deleteRows(type, [id]);

/** A record opened from another app (Boni Calendar's "Abrir en Boni", by its id), as its page. */
export async function openNoteAt(id: string) {
  // On the phone the page shows in Boni's tab (not over the capture form).
  set({ openedNote: id, row: null, rowDoc: null, tab: "boni" });
  // Not logged in yet (Boni Calendar's peek, the first time): it opens once the login is done.
  if (!configured(get().settings)) return;
  try {
    const row = await agent.dataRow(id);
    if (row?.type) return void (await openRow(row.type, id));
    toast(get().t("note.notFound"));
  } catch (e) {
    toast(get().t(e instanceof ApiError && e.status === 404 ? "note.notFound" : "note.offline"));
  }
}

/** A row opened as a page: its properties and its text (a note's body). */
export async function openRow(type: string, id: string) {
  if (readOnly(type)) return;
  await flushPage();
  await flushRowBody();
  const kind = get().view.kind;
  const from = kind === "collection" || kind === "allPages" || kind === "page" ? kind : undefined;
  set({
    view: { kind: "row", type, id, ...(from ? { from } : {}) },
    row: null,
    rowDoc: null,
    related: null,
    panel: null,
  });
  void agent
    .dataRelated(id)
    .then((related) => {
      const v = get().view;
      if (v.kind === "row" && v.id === id) set({ related });
    })
    .catch(() => {});
  if (!get().dataTypes) void loadDataTypes();
  try {
    const row = await agent.dataRow(id);
    const v = get().view;
    if (row && v.kind === "row" && v.id === id) {
      set({ row, rowDoc: rowDocOf(row) });
      const def = get().dataTypes?.find((x) => x.id === type);
      const title = def ? row.values[def.titleField] : null;
      noteRecent({ kind: "row", id, type, title: typeof title === "string" ? title : "" });
    }
  } catch (e) {
    // Gone since (in the trash): out of «Recientes» too.
    if (e instanceof ApiError && e.status === 404) forgetRecent(id);
    toast(get().t("db.loadError"));
  }
}

/**
 * How a collection's rows open (Juan, 2026-10-22): its properties folded (the default) or not, and some hidden one
 * by one. The account keeps it, so Boni, Boni Calendar's peek and every device show the same.
 */
function changeRowUi(
  type: string,
  patch: {
    open?: boolean;
    hidden?: string[];
    related?: boolean;
    folded?: string[];
    widths?: Record<string, number>;
  },
) {
  set({
    dataTypes:
      get().dataTypes?.map((x) =>
        x.id === type ? { ...x, rowUi: { ...x.rowUi, ...patch } } : x,
      ) ?? null,
  });
  void agent.setRowUi(type, patch).catch(() => toast(get().t("db.saveError")));
}
export interface HistoryMarks {
  blocks: Record<string, HistoryMark>;
  fields: Record<string, HistoryMark>;
  /** Only this one's parts lit (a click on it in the legend). */
  focus: string | null;
}
/** The page in the colours of who wrote it, while its History is open (Juan, 2026-10-30). */
export function setHistoryMarks(m: Omit<HistoryMarks, "focus"> | null) {
  set({ historyMarks: m ? { ...m, focus: null } : null });
}
export function focusHistory(by: string | null) {
  const m = get().historyMarks;
  if (m) set({ historyMarks: { ...m, focus: m.focus === by ? null : by } });
}
export function toggleRowProps(type: string) {
  const ui = get().dataTypes?.find((x) => x.id === type)?.rowUi;
  changeRowUi(type, { open: !ui?.open });
}
/** A column of the collection's table as wide as the user left it (Juan, 2026-10-30), kept for the account. */
export function setColumnWidth(type: string, column: string, width: number) {
  const now = get().dataTypes?.find((x) => x.id === type)?.rowUi.widths ?? {};
  changeRowUi(type, {
    widths: { ...now, [column]: Math.round(Math.max(40, Math.min(1600, width))) },
  });
}
/** A column back to the width its kind of value has by itself. */
export function resetColumnWidth(type: string, column: string) {
  const { [column]: _, ...rest } = get().dataTypes?.find((x) => x.id === type)?.rowUi.widths ?? {};
  changeRowUi(type, { widths: rest });
}
/** Its rows' «Relacionado» unfolded or not, for the collection (the account's, as the properties). */
export function toggleRelated(type: string) {
  const ui = get().dataTypes?.find((x) => x.id === type)?.rowUi;
  changeRowUi(type, { related: !ui?.related });
}
/** One group of it (`<collection>:<field>`) folded or not, for the collection. */
export function toggleRelatedGroup(type: string, group: string) {
  const now = get().dataTypes?.find((x) => x.id === type)?.rowUi.folded ?? [];
  changeRowUi(type, {
    folded: now.includes(group) ? now.filter((x) => x !== group) : [...now, group],
  });
}
export function setPropHidden(type: string, field: string, hidden: boolean) {
  const now = get().dataTypes?.find((x) => x.id === type)?.rowUi.hidden ?? [];
  changeRowUi(type, {
    hidden: hidden ? [...new Set([...now, field])] : now.filter((x) => x !== field),
  });
}

/** A property of the open row changed: here, in the collection's loaded rows, then on the server. */
export async function editRowValue(type: string, id: string, field: string, value: DataValue) {
  const row = get().row;
  if (row?.id === id) set({ row: { ...row, values: { ...row.values, [field]: value } } });
  if (get().rows[type]) await editCell(type, id, field, value);
  else {
    try {
      await agent.updateRow(id, { [field]: value });
    } catch {
      toast(get().t("db.saveError"));
    }
  }
}

/** A row's text (Markdown) as a page the block editor edits (Juan, 2026-10-22: notes as pages). */
const rowDocOf = (row: DataRow): Page => ({
  id: `row:${row.id}`,
  title: "",
  icon: "",
  parent: null,
  position: 0,
  spec: { version: 1, blocks: markdownToBlocks(row.body ?? "") },
});

/** The document being edited (a page, a row's text), for the panels that show one of its blocks. */
export const useEditing = () => useStore((s) => (s.view.kind === "row" ? s.rowDoc : s.page));
/** The document being edited: the open row's text on a row, else the open page. */
const editing = (): Page | null => {
  const v = get().view.kind;
  if (v === "row") return get().rowDoc;
  return get().page;
};

// The text of the open row is sent after a pause in typing, and before leaving it.
let bodyTimer: ReturnType<typeof setTimeout> | null = null;
let bodyPending: { id: string; body: string } | null = null;

export function setRowBody(body: string) {
  const row = get().row;
  if (!row) return;
  set({ row: { ...row, body } });
  bodyPending = { id: row.id, body };
  if (bodyTimer) clearTimeout(bodyTimer);
  bodyTimer = setTimeout(() => void flushRowBody(), 600);
}

export async function flushRowBody() {
  if (bodyTimer) clearTimeout(bodyTimer);
  bodyTimer = null;
  const p = bodyPending;
  bodyPending = null;
  if (!p) return;
  try {
    await agent.updateRow(p.id, {}, p.body);
  } catch {
    toast(get().t("db.saveError"));
  }
}
