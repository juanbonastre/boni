import {
  blocksToMarkdown,
  type DatabaseFilter,
  type DatabaseView,
  dataRowTarget,
  type FilterItem,
  flowRowTarget,
  MAX_VIEWS,
  markdownToBlocks,
  type PageSpec,
  resolveTemplateLinks,
  type SavedView,
  SYS,
  templatePage,
  withPassed,
} from "@boni/views";
import { useMemo } from "react";
import { create } from "zustand";
import {
  AgentApi,
  type AiLevel,
  type AreaAccuracy,
  type AutoAccept,
  type ConversationSummary,
  type DataRow,
  type DataType,
  type DataUsage,
  type DataValue,
  type ExtensionView,
  fieldEditable,
  type InboxRequest,
  type LiveEvent,
  type MailGuide,
  type MailInput,
  type MailView,
  type Origin,
  type Page,
  type PageInfo,
  type Painted,
  type Planner,
  type Proposal,
  type ProposalView,
  type Related,
  type Reply,
  type RunDetail,
  type RunSummary,
  type ScreenRefs,
  type StepWords,
  type TodayItem,
  type Tree,
  type TurnResult,
  type Visibility,
} from "./core/agent.ts";
import { ApiError, BoniApi, NotConfiguredError, OfflineError } from "./core/api.ts";
import type { SystemColumns } from "./core/audit.ts";
import type { HistoryMark } from "./core/blame.ts";
import {
  type Place,
  readKept,
  restored,
  toKept,
  WINDOW_FILE,
  type WindowMode,
} from "./core/boniWindow.ts";
import { normalize } from "./core/chartBuilder.ts";
import { ChartRepository, type ChartState } from "./core/charts.ts";
import { deviceZone, newId, nowIso, today } from "./core/clock.ts";
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
import {
  type Draft,
  type Drafts,
  draftIn,
  draftToNew,
  madeDraft,
  withDraft,
  withoutDraft,
} from "./core/drafts.ts";
import * as F from "./core/formLogic.ts";
import {
  addPointed,
  focusRef,
  MAX_POINTED,
  type Pointed,
  type PointedRef,
  panelRef,
  pointKey,
  visibleRefs,
} from "./core/pointing.ts";
import { isPending, OfflineQueue, type QueuedAction } from "./core/queue.ts";
import { filterOf, litKeys, typeOfKey } from "./core/screenReplies.ts";
import { canSaveDirectly, filledValues, formOf } from "./core/shortcuts.ts";
import { readJson, type TextStore } from "./core/storage.ts";
import {
  type ClientSettings,
  host as defaultHost,
  type Host,
  type LoginAnswer,
  type LoginForm,
  openUrl,
  phoneLayout,
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
  boniWindow: WINDOW_FILE,
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
  /**
   * «Flujos» (docs/sistema.md §4.4, F8): Boni's collection of flows with its views («Tabla», «Mapa»); `flow`: one flow
   * on a page of its own, in its editor; `map`: the map opened on something («Ver en el mapa»), `n` new each time.
   */
  | {
      kind: "flows";
      flow?: string;
      map?: {
        center: string | null;
        pages?: boolean;
        run?: string;
        /** «¿De dónde viene?»: the record asked about (its title) and where it comes from. */
        origin?: { title: string; origin: Origin };
        /** On the phone, where it was asked from (the Registro, the Bandeja): Back returns there. */
        back?: { tab: Tab; view: View };
        n: number;
      };
    }
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
  | { kind: "rows"; id: string; drill?: string; label?: string }
  /** A record opened from the conversation without leaving it (a mail, as a mail client shows it). */
  | { kind: "row"; type: string; id: string };
/**
 * The phone's places (Juan, 2026-10-31): Inicio (today), Páginas (his data), Boni (the conversation) and the Bandeja.
 * Capturing is the + button's, not a tab; charts are on Inicio and in the pages.
 */
export type Tab = "home" | "pages" | "boni" | "inbox";

/** One turn of the conversation: what Juan asked and what the agent answered (painted by the code). */
export interface ChatEntry {
  id: string;
  request: string;
  result: TurnResult | null;
  error: string | null;
  /** The steps it took, as they were seen live (docs/conversacion.md 3.5); kept for the session. */
  steps?: LiveStep[];
  /** What was pointed at for it: its chips, shown with the message (I-33). */
  pointed?: Pointed[];
}
/**
 * A step of a turn as it runs: what it is (the tool's title, or the kind of step), in Juan's words when the server
 * says them, whether it ended, and what it found.
 */
export interface LiveStep {
  id: string;
  op: string;
  what: string;
  done: boolean;
  words?: StepWords;
  n?: number;
  value?: number;
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
  /**
   * What Juan is writing to each conversation and has not sent (core/drafts.ts): its text and what he pointed at
   * for it. The same on its screen and in its window, kept when either closes (F9).
   */
  chatDrafts: Drafts;
  /** Pointing (`Ctrl+Shift+E`, F9): the pointer marks what the next message is about. */
  pointing: boolean;
  /** The turn running now, as it goes (3.5). */
  live: LiveTurn | null;
  /** The models a conversation may plan with (3.5). */
  planners: Planner[];
  /** The phone's list of conversations, a drawer opened from its top bar. */
  chatList: boolean;
  /** Inicio's «Hoy» on the phone: today in Juan's calendars; null until loaded, or from a server without it. */
  today: TodayItem[] | null;
  /** A record's History, opened from its page (the desktop's button) or the phone's «…». */
  rowHistory: boolean;
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
  /** Who reads and writes each collection (F6), for the diagrams; null until asked. */
  dataUsage: DataUsage | null;
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
  /** Which saved view of each collection is open on this device (task 69), by its id. */
  activeViews: Record<string, string>;
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
  /** The conversation over the screen (docs/sistema.md §4.7, F9): a window over what is open, or docked to the right. */
  boniWindow: WindowMode;
  /** Where Juan dragged the floating window (I-35); null: its corner, at the bottom right. */
  boniPlace: Place | null;
  /** Rows chosen in each table on screen (its selection), by the table: the screen gives them to Boni (F9). */
  chosenRows: Record<string, string[]>;
  /** When Boni last opened something on the screen (F9): the main area lights for a moment. */
  lit: number;
  /**
   * What Boni lit or scrolled to on the screen (F9, `screen.highlight`, `screen.scroll`): the things by their keys
   * (`pointKey`), lit for a moment wherever they are drawn; `n` again each time.
   */
  screenLight: { keys: string[]; scroll: boolean; n: number } | null;
  /**
   * A collection Boni opened filtered (F9, `screen.filter`): its rules on top of the view's while it is on screen,
   * never saved; × takes it away, «Guardar» keeps it in the view (Juan's own change to the view).
   */
  boniFilter: { type: string; rules: FilterItem[]; caption: string | null; n: number } | null;
  runs: RunSummary[];
  /** The Registro's «Acierto»: Boni's decisions per area (docs/fiabilidad.md). */
  accuracy: AreaAccuracy[];
  /** «Aprender» (docs/preferencias.md §5): whether Boni's learners may suggest anything on their own. */
  learning: boolean;
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

/**
 * Where this device keeps the view each collection has open. Declared before the store, which reads it as it is made:
 * declared after it, the read failed in silence and every collection opened on its first view after a restart.
 */
const ACTIVE_VIEWS = "boni:activeViews";

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
  tab: "home",
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
  chatDrafts: {},
  pointing: false,
  live: null,
  planners: [],
  chatList: false,
  today: null,
  rowHistory: false,
  pages: null,
  page: null,
  pageFocus: null,
  chartForPage: null,
  findOpen: false,
  trash: null,
  dataTypes: null,
  dataUsage: null,
  tree: null,
  recent: [],
  fold: { sections: [], branches: [] },
  rows: {},
  activeViews: readActiveViews(),
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
  boniWindow: "closed",
  boniPlace: null,
  chosenRows: {},
  lit: 0,
  screenLight: null,
  boniFilter: null,
  runs: [],
  accuracy: [],
  learning: true,
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
  if (kind !== "widget") window.addEventListener("keydown", zoomKeys);
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
      flushBoniWindow();
    });
    void restoreBoniWindow();
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
    set({ panel: null });
    if (sc) void runShortcut(sc);
    else toast(get().t("shortcut.gone"));
  } else if (screen.startsWith("chart:")) {
    const id = screen.slice(6);
    set({ panel: null, tab: "home" });
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
/**
 * Ctrl+= or Ctrl++ (bigger), Ctrl+- (smaller) and Ctrl+0 (the page's own size): the size of everything, where the
 * host keeps a zoom (the desktop app; Juan, 2026-11-02). Elsewhere the browser's own zoom does it.
 */
function zoomKeys(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const zoom = get().settings.zoom;
  if (typeof zoom !== "number") return;
  const next =
    e.key === "+" || e.key === "="
      ? zoom + 0.1
      : e.key === "-"
        ? zoom - 0.1
        : e.key === "0"
          ? 1
          : null;
  if (next === null) return;
  e.preventDefault();
  void saveSettings({ zoom: next });
}

/** A block's settings in the side panel («Modificar…»). */
export const openBlockPanel = (id: string) => set({ panel: { kind: "block", id }, ...FRESH_PANEL });
/**
 * The collection a reply names. The planner names a type by its key ("correo"); its table's id is another thing
 * (`t_01…`, Juan, 2026-11-02: the mail's lines opened nothing). A name or an id work too.
 */
export const replyType = (typeName: string) =>
  get().dataTypes?.find((x) => x.key === typeName || x.id === typeName || x.name === typeName);

/**
 * A record a reply points to (its type by name or key, its id; Juan, 2026-11-02): a mail opens as a mail client
 * shows it, in a window of its own in the desktop app (task 30) and elsewhere in the side panel, with «Agrandar» for
 * its page; anything else opens as its page.
 */
export async function openRecord(typeName: string, id: string) {
  if (!get().dataTypes) await loadDataTypes();
  const type = replyType(typeName);
  if (!type) return;
  const peek = hostRef.desktop?.openPeek;
  if (type.view === "mail" && peek) peek(`note:${id}`);
  else if (type.view === "mail") set({ panel: { kind: "row", type: type.id, id }, ...FRESH_PANEL });
  else await openRow(type.id, id);
}

/**
 * A mail's tasks proposed now, from the conversation (task 30): they go to the inbox, which says so. When nothing
 * new comes of it, the toast says why (already waiting, already taken, nothing for you) and offers to read the mail
 * again (task 54; Juan, 2026-11-04: «que el usuario pudiese volver a proponerlo»).
 */
export async function proposeFromMail(id: string, again = false) {
  const t = get().t;
  try {
    const r = await agent.proposeFromMail(id, again);
    const retry = { label: t("mail.proposeAgain"), run: () => void proposeFromMail(id, true) };
    if (r.n) toast(r.n === 1 ? t("mail.proposedOne") : t("mail.proposed", { n: r.n }));
    else if (r.already) toast(t("mail.proposedAlready"), retry);
    else if (r.decided) toast(t("mail.proposedDecided"), retry);
    else toast(t("mail.proposedNone"), retry);
    if (r.n || again) void loadInbox();
  } catch (e) {
    toast(
      t(
        e instanceof ApiError && e.code === "no-collections"
          ? "mail.proposeNoCollections"
          : e instanceof ApiError && e.code === "flow-off"
            ? "mail.proposeFlowOff"
            : "mail.proposeFailed",
      ),
    );
  }
}
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
 * typed in it), the conversations' drawer, a record's History, a chart's detail, a chart on its own, then a step
 * back in the place, then Inicio. False when there was nothing to close.
 * Menus and lists that components open close on Esc before this runs; Android's button is Esc too (`androidBack`).
 */
export function goBack(): boolean {
  const s = get();
  if (s.settingsOpen) openSettings(false);
  else if (s.discardAsk) keepEditing();
  else if (s.panel) dismissPanel();
  else if (s.chatList) toggleChatList(false);
  else if (s.rowHistory) setRowHistory(false);
  else if (s.tab === "inbox" && s.view.kind === "proposal") set({ view: { kind: "home" } });
  else if (s.view.kind === "chart" && s.view.drill) setChartDrill(null);
  else if (s.view.kind === "chart") showHome();
  else if (s.view.kind === "inbox" || s.view.kind === "log") showChat();
  // A flow's page goes back to «Flujos»; the map asked for from another place, back to it.
  else if (s.view.kind === "flows" && s.view.flow) showFlows();
  else if (s.view.kind === "flows" && s.view.map?.back)
    set({ tab: s.view.map.back.tab, view: s.view.map.back.view });
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
  } else if (s.tab !== "home") showTab("home");
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
  // A card accepted from the conversation whose state changed since it was seen (task 73).
  if (code === "changed") return t("inbox.changed");
  if (code.startsWith("model-")) return t("agent.error.model");
  // The limits of one request (P12) are not a security rule: say which one was hit.
  if (code.startsWith("P12-")) return t(`agent.error.limit.${code.slice(4)}`);
  const rule = /^(P\d{1,2}|R\d)/.exec(code)?.[1];
  if (rule) return t("agent.error.rule", { rule });
  return t("agent.error.generic", { code });
}

function patchEntry(id: string, patch: Partial<ChatEntry>) {
  set((s) => ({ chat: s.chat.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
}
/** A later answer of the same run: its replies follow the earlier ones; its question or confirmation replaces the last. */
/**
 * A run reports everything it has made so far each time it answers (after a question, a confirmation): the later
 * report replaces the earlier one, and one that brings nothing (a refusal) keeps what was shown (Juan, 2026-11-02:
 * «No, gracias» showed the whole answer again).
 */
function mergeResult(prev: TurnResult | null, next: TurnResult): TurnResult {
  if (!prev) return next;
  return {
    ...next,
    replies: next.replies.length ? next.replies : prev.replies,
    proposals: next.proposals.length ? next.proposals : prev.proposals,
    notices: next.notices.length ? next.notices : prev.notices,
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
            steps: [
              ...l.steps,
              {
                id: e.id,
                op: e.op,
                what: e.what,
                done: false,
                ...(e.words ? { words: e.words } : {}),
              },
            ],
          }
        : {
            ...l,
            steps: l.steps.map((x) =>
              x.id === e.id
                ? {
                    ...x,
                    done: true,
                    ...(e.n !== undefined ? { n: e.n } : {}),
                    ...(e.value !== undefined ? { value: e.value } : {}),
                  }
                : x,
            ),
          };
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
  const look = async () => {
    const r = await agent.live(liveId, after).catch(() => null);
    if (!r) return false;
    after += r.events.length;
    const l = get().live;
    if (l?.id === liveId && r.events.length) set({ live: r.events.reduce(applyLive, l) });
    return r.done;
  };
  // One look at a time, each from where the last ended: the last look, made once it answers, could otherwise ask
  // from the same place as the one still on its way, and every step would show twice (seen on a phone).
  let looking: Promise<unknown> = Promise.resolve();
  const pull = () => {
    const next = looking.then(look);
    looking = next.catch(() => undefined);
    return next;
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
    // A turn that changed something may have made or changed a page, or decided cards of the Bandeja (F10).
    if (r.proposals.length || r.changed) void loadInbox();
    if (r.changed) void pagesAfterRun();
    // Once per turn: an answer or a confirmation repeats the run's replies, what they did on the screen already done.
    if (!entry?.result?.replies.some((x) => SCREEN_REPLIES.has(x.component))) screenActs(r.replies);
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

/** The open conversation's unsent message (core/drafts.ts): its text and what Juan pointed at for it. */
export const draftOf = (s: Pick<State, "conversationId" | "chatDrafts">): Draft =>
  draftIn(s.chatDrafts, s.conversationId);
const putDraft = (change: (d: Draft) => Draft) =>
  set((s) => ({ chatDrafts: withDraft(s.chatDrafts, s.conversationId, change) }));
export const setDraftText = (text: string) => putDraft((d) => ({ ...d, text }));
/** Takes a chip off the bar. */
export const unpoint = (key: string) =>
  putDraft((d) => ({ ...d, pointed: d.pointed.filter((p) => pointKey(p.ref) !== key) }));
/**
 * What the pointer marked goes to the bar as chips, for the next message; pointing ends and the conversation opens
 * over the screen, to write it.
 */
export function pointAt(more: readonly Pointed[]) {
  if (more.length) putDraft((d) => ({ ...d, pointed: addPointed(d.pointed, more) }));
  set({ pointing: false });
  // Open as it was left: an open one stays where it is (docked, it would take the Bandeja's place and put away the
  // card just pointed at).
  if (get().boniWindow === "closed") openBoniWindow();
}
/**
 * Pointing on or off (`Ctrl+Shift+E`, the bar's «Señalar»): on the desktop, over a screen with something to point at
 * (not the conversation's own, not under Ajustes, the search or the trash, as `Ctrl+E`).
 */
export function setPointing(on: boolean) {
  const s = get();
  const may =
    !phoneLayout() && s.view.kind !== "chat" && !s.settingsOpen && !s.findOpen && s.trash == null;
  set({ pointing: on && may });
}
export const togglePointing = () => setPointing(!get().pointing);

export async function sendTurn(text: string) {
  const request = text.trim();
  if (!request || get().chatBusy) return;
  // What was pointed at goes with this message, once, and stays shown with it.
  const chips = draftOf(get()).pointed.slice(-MAX_POINTED);
  const pointed = chips.map((p) => p.ref);
  if (pointed.length) putDraft((d) => ({ ...d, pointed: [] }));
  set({ pointing: false });
  const id = newId();
  set((s) => ({
    chat: [
      ...s.chat,
      { id, request, result: null, error: null, ...(chips.length ? { pointed: chips } : {}) },
    ],
  }));
  // A new conversation is made with its first message (its title comes from it).
  let conversation = get().conversationId;
  if (!conversation)
    try {
      const made = await agent.newConversation();
      conversation = made.id;
      // Its title, as the server will give it from this first message (its first words).
      const title = request.length <= 60 ? request : `${request.slice(0, 57).trimEnd()}…`;
      // What Juan wrote on while the server made it is this conversation's draft now.
      set((s) => ({
        conversationId: made.id,
        conversations: [{ ...made, title }, ...(s.conversations ?? [])],
        chatDrafts: madeDraft(s.chatDrafts, made.id),
      }));
    } catch {
      // A server without the list: the device keeps a conversation of its own there, as before.
    }
  const screen = screenNow(pointed);
  await agentCall(id, (live) =>
    agent.turn(request, conversation ?? CONVERSATION, live, screen, chips),
  );
}

/**
 * The Bandeja's cards in the order it shows them (Juan, 2026-10-24, option A): proposals and questions mixed, the
 * oldest first, at the top. The panel and the screen (F9) both read it.
 */
export function inboxOrder(
  inbox: readonly Proposal[],
  requests: readonly InboxRequest[],
): ({ p: Proposal } | { r: InboxRequest })[] {
  return [
    ...inbox.map((p) => ({ p, at: p.created })),
    ...requests.map((r) => ({ r, at: r.created })),
  ]
    .sort((a, b) => a.at - b.at)
    .map((x) => ("p" in x ? { p: x.p } : { r: x.r }));
}

/**
 * What is on the screen as Juan writes (docs/sistema.md §4.7, F9; task 85), by reference: what is open (of a
 * collection, the view it shows), the Bandeja's cards when it is open, in its order, the rows chosen in its tables,
 * what he pointed at for this message, what is in view, what he was on (the focus) and what the right panel shows.
 * The server makes them values; what is closed to the models or no longer there it leaves out.
 */
export function screenNow(pointed: readonly PointedRef[] = []): ScreenRefs {
  const s = get();
  const v = s.view as { kind: string; id?: string; type?: string; flow?: string };
  const id =
    v.kind === "collection"
      ? (v.type ?? null)
      : v.kind === "flows"
        ? (v.flow ?? null)
        : (v.id ?? null);
  const view = v.kind === "collection" && v.type ? s.activeViews[v.type] : undefined;
  const dom = typeof document !== "undefined";
  const visible = dom ? visibleRefs() : [];
  const focus = dom ? focusRef() : null;
  const panel = panelRef(s.panel, s.page?.id ?? null);
  return {
    open: { kind: v.kind, id, ...(view ? { view } : {}) },
    // The Bandeja's cards when they are on the screen: its panel, or its own screen.
    inbox:
      s.inboxOpen || v.kind === "inbox"
        ? inboxOrder(s.inbox, s.requests)
            .slice(0, 20)
            .map((x) =>
              "p" in x ? { kind: "proposal", id: x.p.id } : { kind: "question", id: x.r.id },
            )
        : [],
    chosen: [...new Set(Object.values(s.chosenRows).flat())].slice(0, 50),
    ...(pointed.length ? { pointed: pointed.slice(-MAX_POINTED) } : {}),
    ...(visible.length ? { visible } : {}),
    ...(focus ? { focus } : {}),
    ...(panel ? { panel } : {}),
  };
}

/** What Boni's «open» reply opens (F9), when it may: never what something from outside chose. */
export type OpenTarget = (
  | { kind: "place"; place: "inbox" | "flows" | "log" | "data" }
  | { kind: "collection"; type: DataType }
  | { kind: "record"; id: string; title: string | null; type: string | null }
  | { kind: "run"; run: string }
  | { kind: "flow"; flow: string }
) & {
  /** «Ver en el mapa» (F8 with F9): on the map of «Flujos», a run drawn on it with the step that stopped it lit. */
  map: boolean;
};

/**
 * An «open» reply's target (F9; I-30), the same for opening it and for saying it: a place of the app by its fixed
 * name, a collection by the key the planner knows it by, a record only as a tool or the screen gave it (the code's
 * own id). Nothing whose value or whose step's condition came from outside.
 */
export function openTarget(r: Reply, types: readonly DataType[] | null): OpenTarget | null {
  const outside = (p: Painted | undefined) =>
    !p || p.integrity === "external" || p.integrity === "ambient";
  const d = r.data;
  const text = (p: Painted | undefined) =>
    p?.t === "v" && typeof p.value === "string" ? p.value : null;
  const map = d.map?.t === "v" && d.map.value === true && !outside(d.map);
  if (d.place) {
    const place = text(d.place);
    return !outside(d.place) &&
      (place === "inbox" || place === "flows" || place === "log" || place === "data")
      ? { kind: "place", place, map: false }
      : null;
  }
  if (d.collection) {
    const type = typeOfKey(text(d.collection), types);
    return type && !outside(d.collection) ? { kind: "collection", type, map } : null;
  }
  // A run only as a tool gave it (the code's own id, I-29), always on the map.
  if (d.run) {
    const run = text(d.run);
    return run && d.run.integrity === "own" ? { kind: "run", run, map: true } : null;
  }
  if (d.flow) {
    const flow = text(d.flow);
    return flow && !outside(d.flow) ? { kind: "flow", flow, map } : null;
  }
  const rec = d.record?.t === "rec" && !outside(d.record) ? d.record : null;
  const id = rec?.fields.id;
  if (!rec || id?.t !== "v" || id.integrity !== "own" || typeof id.value !== "string") return null;
  // Its title by its collection's title field (a tool's record), or as the screen gave it.
  const typeKey = text(rec.fields.type);
  const def = typeKey
    ? types?.find((x) => x.key === typeKey || `type_${x.id}` === typeKey)
    : undefined;
  const titleKey = def?.fields.find((f) => f.id === def.titleField)?.key;
  const title = text(rec.fields.title) ?? (titleKey ? text(rec.fields[titleKey]) : null);
  return { kind: "record", id: id.value, title, type: def?.id ?? null, map };
}
let filterAsks = 0;
let lightAsks = 0;
/** Lights things on the screen by their keys (F9): Boni's highlight, and the conversation's «Ver» again. */
export function lightKeys(keys: readonly string[], scroll = false) {
  if (keys.length) set({ screenLight: { keys: [...keys], scroll, n: ++lightAsks } });
}
/** × of Boni's filter: the view as it was. */
export const clearBoniFilter = () => set({ boniFilter: null });

/** The replies that act on the screen (F9): done once, when the turn comes. */
const SCREEN_REPLIES = new Set(["open", "filter", "highlight", "scroll"]);
/**
 * Boni over the screen (F9): what a turn that just came asks to open, filter, light or scroll to, done once; never
 * when a conversation is read again, nor when its run goes on (an answer, a confirmation repeat its replies). On the
 * phone, in the tab that shows it. From the Conversación screen the conversation goes on in the window, over it.
 */
function screenActs(replies: readonly Reply[]) {
  const s = get();
  const open = replies.find((x) => x.component === "open");
  const filter = replies.find((x) => x.component === "filter");
  const lights = replies.filter((x) => x.component === "highlight" || x.component === "scroll");
  const target = open ? openTarget(open, s.dataTypes) : null;
  const filtered = filter ? filterOf(filter, s.dataTypes) : null;
  // What it lights instead of the whole area: the things it names, or the run's step (the map lights it).
  const own = lights.some((r) => litKeys(r).length > 0) || target?.kind === "run";
  if (target) openOnScreen(target, !own);
  // Filtered: its collection opened, with the rules over its view while it is there (§4.7, part five).
  if (filtered) {
    if (target?.kind !== "collection" || target.type.id !== filtered.type.id || target.map)
      openOnScreen({ kind: "collection", type: filtered.type, map: false }, !own);
    set({
      boniFilter: {
        type: filtered.type.id,
        rules: filtered.rules,
        caption: filtered.caption,
        n: ++filterAsks,
      },
    });
  }
  for (const r of lights) lightKeys(litKeys(r), r.component === "scroll");
}

/**
 * What an «open» reply opens, once (F9): a place, a collection, a record, a flow or a run, on the map if asked; the
 * whole area lit only when nothing in it is (`area`).
 */
function openOnScreen(target: OpenTarget, area = true) {
  const s = get();
  const fromChat = s.view.kind === "chat";
  if (target.kind === "place") {
    if (target.place === "inbox") showInbox();
    else if (target.place === "flows") showFlows();
    else if (target.place === "log") showLog();
    else showAllPages();
  } else if (target.kind === "run") showRun(target.run);
  else if (target.kind === "flow")
    target.map ? showMap(`flow:${target.flow}`) : showFlow(target.flow);
  else if (target.kind === "collection")
    target.map ? showMap(`col:${target.type.id}`) : openCollection(target.type.id);
  else if (target.map && target.type) showMapOf(target.type, target.id);
  else void openRowById(target.id);
  const tab: Tab =
    target.kind === "place" && target.place === "inbox"
      ? "inbox"
      : target.kind === "place" && target.place === "log"
        ? "boni"
        : "pages";
  set({
    ...(area ? { lit: Date.now() } : {}),
    ...(fromChat ? { boniWindow: "float" as const } : {}),
    ...(phoneLayout() ? { tab } : {}),
  });
}

/** A table's chosen rows, for the screen (F9); none when it closes. */
export const setChosenRows = (table: string, ids: readonly string[]) =>
  set((s) => {
    const rest = Object.fromEntries(Object.entries(s.chosenRows).filter(([k]) => k !== table));
    return { chosenRows: ids.length ? { ...rest, [table]: [...ids] } : rest };
  });

/**
 * The conversation over the screen (F9, C4): `Ctrl+E` and the circle open it over what is open, or close it; on the
 * Conversación screen it is already there. Docked to the right it takes the Bandeja's place; another panel there
 * (the Bandeja back, a record) floats it beside until it closes.
 */
export function openBoniWindow(mode: "float" | "right" = "float") {
  if (get().view.kind === "chat") return;
  set({ boniWindow: mode, ...(mode === "right" ? { inboxOpen: false } : {}) });
}
export const closeBoniWindow = () => set({ boniWindow: "closed" });
/** The floating window dragged by its bar (I-35): it stays there, on every screen and after a restart. */
export const placeBoniWindow = (place: Place) => set({ boniPlace: place });
export const toggleBoniWindow = () =>
  get().boniWindow === "closed" ? openBoniWindow() : closeBoniWindow();
/** «Ampliar»: the conversation on its own screen, the window closed. */
export function widenBoniWindow() {
  set({ boniWindow: "closed" });
  showChat();
}
/**
 * A flow run by hand (docs/flujos.md, F2): a turn of a new conversation, so its replies, questions and confirmations
 * are where they always are. Its plan is the saved one; what the user typed in its form is his.
 */
export async function runFlowInChat(id: string, name: string, inputs: Record<string, string>) {
  if (get().chatBusy) return;
  const request = `«${name}»`;
  const entry = newId();
  let conversation: string | undefined;
  try {
    const made = await agent.newConversation();
    conversation = made.id;
    set((s) => ({ conversations: [{ ...made, title: request }, ...(s.conversations ?? [])] }));
  } catch {
    conversation = undefined;
  }
  set({
    conversationId: conversation ?? null,
    chat: [{ id: entry, request, result: null, error: null }],
    view: { kind: "chat" },
    panel: null,
  });
  await agentCall(entry, (live) => agent.runFlow(id, inputs, conversation, live));
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
  set({ conversationId: id, chat: [], pointing: false, view: { kind: "chat" } });
  await loadTurns(id);
}
/**
 * A conversation's turns, as the server keeps them, into the one open now. `quiet`: the one the device remembered
 * (I-35), which may be gone: then a new one starts, with nothing said.
 */
async function loadTurns(id: string, quiet = false) {
  try {
    const r = await agent.conversation(id);
    if (get().conversationId !== id) return;
    set({
      chat: r.turns.map((x) => ({
        id: x.id,
        request: x.request,
        ...(x.pointed.length ? { pointed: x.pointed } : {}),
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
    if (!quiet) return void toast(errorText(get().t, e));
    // Kept after a restart but not read back (deleted on another device, or the server out of reach): a new
    // conversation, never one whose turns are not shown; what was being written to it goes to the new one.
    if (get().conversationId === id)
      set((s) => ({ conversationId: null, chat: [], chatDrafts: draftToNew(s.chatDrafts, id) }));
  }
}
/** A new conversation: the chat starts empty; the conversation is made with its first message. */
export function newConversation() {
  if (get().chatBusy) return;
  set({ conversationId: null, chat: [], pointing: false, view: { kind: "chat" } });
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
    set((s) => ({
      conversations: (s.conversations ?? []).filter((x) => x.id !== id),
      chatDrafts: withoutDraft(s.chatDrafts, id),
    }));
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
      set((s) => ({
        conversationId: made.id,
        conversations: [made, ...(s.conversations ?? [])],
        chatDrafts: madeDraft(s.chatDrafts, made.id),
      }));
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
  edits?: {
    title?: string;
    collection?: string;
    values?: Record<string, DataValue>;
    link?: string;
    into?: string;
  },
  /** `same`: the title of the entry the proposal went into or got linked to («Es el mismo», task 58). */
  opts: { done?: boolean; same?: string } = {},
) {
  return decide(id, opts.done ? "done" : "accept", async () => {
    const t = get().t;
    try {
      // The word the card showed goes with it: the server checks the card again before acting (task 73).
      const seen = get().inbox.find((p) => p.id === id)?.card?.now.state ?? null;
      const r = await agent.accept(id, opts.done ? { ...edits, done: true } : edits, seen);
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
        // A while to take it back (Juan, 2026-11-02): the toast's «Deshacer» undoes what it made and the card returns.
        toast(
          opts.same
            ? t("inbox.acceptedSame", { title: opts.same })
            : t(
                opts.done
                  ? "inbox.acceptedDone"
                  : edits
                    ? "inbox.acceptedCorrected"
                    : "inbox.accepted",
              ),
          { label: t("toast.undo"), run: () => void restoreProposal(id, r.run) },
        );
      }
    } catch (e) {
      // The card changed since Juan saw it (task 73): it says so, and the inbox read again once the queue is
      // empty shows its word; pressed again, it is accepted.
      if (e instanceof ApiError && e.status === 409 && e.code === "changed")
        decideFailed(id, { text: t("inbox.changed") });
      else decideFailed(id, { text: errorText(t, e) });
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

/**
 * A mail seen without leaving where Juan is (tasks 68 and 74; Juan, 2026-11-05: «quiero que se abra como peek»; then
 * «lo abre en la bandeja, ocultando todas las tarjetas, debería aparecer como una ventana peek»): in the desktop app,
 * in the peek, its window of its own, as the conversation opens a mail (task 30); elsewhere in the side panel, where
 * «Agrandar» takes it to its page and closing it gives the inbox back.
 */
export async function peekMail(at: { type: string; id: string }) {
  if (!get().dataTypes) await loadDataTypes();
  const peek = hostRef.desktop?.openPeek;
  if (peek && replyType(at.type)?.view === "mail") peek(`note:${at.id}`);
  else set({ panel: { kind: "row", type: at.type, id: at.id }, ...FRESH_PANEL });
}

/** A mail in its webmail (task 68): the address the server gives (Gmail's own, in its account), opened outside. */
export async function openWebmail(id: string) {
  try {
    const url = await agent.mailWebmail(id);
    if (!url || (await openUrl(url)) === "error") toast(get().t("mail.webmailFailed"));
  } catch {
    toast(get().t("mail.webmailFailed"));
  }
}
export function rejectProposal(id: string) {
  return decide(id, "reject", async () => {
    try {
      await agent.reject(id);
      dropProposal(id);
      toast(get().t("inbox.rejected"), {
        label: get().t("toast.undo"),
        run: () => void restoreProposal(id),
      });
    } catch (e) {
      decideFailed(id, { text: errorText(get().t, e) });
    }
  });
}

/** A decision taken back from the toast: the proposal waits again (its acceptance undone), and the inbox reloads. */
export async function restoreProposal(id: string, run?: string) {
  dismissToast();
  try {
    await agent.restore(id, run);
    await loadInbox();
  } catch (e) {
    toast(errorText(get().t, e));
  }
}

export async function loadRuns() {
  try {
    const [runs, d] = await Promise.all([
      agent.runs(),
      // A server without it: no «Acierto».
      agent.decisions().catch(() => ({ areas: [] as AreaAccuracy[], learning: true })),
    ]);
    set({ ...runs, accuracy: d.areas, learning: d.learning });
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
    // Its turn in the conversation has nothing left to undo.
    set((s) => ({
      chat: s.chat.map((e) =>
        e.result?.run === id ? { ...e, result: { ...e.result, changed: false } } : e,
      ),
    }));
  } catch (e) {
    toast(e instanceof ApiError && e.status === 409 ? t("log.cannotUndo") : errorText(t, e));
  }
  await Promise.all([loadRuns(), pagesAfterRun()]);
}

/** After a run or its Undo: the pages again, and the start if the open page is no longer there. */
async function pagesAfterRun() {
  const pages = await loadPages();
  const v = get().view;
  if (pages && v.kind === "page" && !pages.some((p) => p.id === v.id)) await openStart();
  else if (pages && v.kind === "page") await openPage(v.id);
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

/** The mailbox's host, asked once per session (a mail's webmail link needs it, task 55); null without a mailbox. */
let mailboxView: Promise<MailView | null | undefined> | null = null;
export function mailboxHost(): Promise<string | null> {
  mailboxView ??= loadMail();
  return mailboxView.then((m) => m?.host ?? null);
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
  mailboxView = null;
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
  } catch (e) {
    // «Revisar la guía» is off, or there are no models: said as such (D-51).
    const t = useStore.getState().t;
    toast(
      e instanceof ApiError && e.status === 409 ? t("mail.review.off") : t("mail.error.failed"),
    );
    return null;
  }
}

/** Juan's answer to the reviewer's suggestion (yes, no, or in his words): the guide and the mailbox after it. */
export async function answerSuggestion(id: string, accept: boolean, changed = false) {
  try {
    return await agent.answerSuggestion(id, accept, changed);
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

/** The areas Boni decides in, for Settings «Decisiones» (a server without them: none). */
export async function loadDecisions() {
  try {
    const d = await agent.decisions();
    set({ accuracy: d.areas, learning: d.learning });
  } catch {
    // as it was
  }
}

/** Juan turns «Aprender» (docs/preferencias.md §5): it flips at once and goes back if the server says no. */
export async function setLearning(on: boolean): Promise<boolean> {
  const { t, learning } = useStore.getState();
  set({ learning: on });
  try {
    const d = await agent.setLearning(on);
    set({ accuracy: d.areas, learning: d.learning });
    return true;
  } catch (e) {
    set({ learning });
    toast(e instanceof ApiError && e.status === 403 ? t("ai.personal") : t("decisions.failed"));
    return false;
  }
}

/**
 * Juan turns an area's «Solo» (docs/fiabilidad.md §3.4): on only once earned, and only from a personal device. The
 * switch flips at once and goes back if the server says no.
 */
export async function setDecisionAuto(area: string, auto: boolean): Promise<boolean> {
  const { t, accuracy } = useStore.getState();
  set({ accuracy: accuracy.map((a) => (a.area === area ? { ...a, auto } : a)) });
  try {
    const d = await agent.setDecisionAuto(area, auto);
    set({ accuracy: d.areas, learning: d.learning });
    return true;
  } catch (e) {
    set({ accuracy });
    const status = e instanceof ApiError ? e.status : 0;
    toast(
      status === 403
        ? t("ai.personal")
        : status === 409
          ? t("decisions.notYet")
          : t("decisions.failed"),
    );
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
    // A page still being made here (its server id not back yet) stays in the list (task 36).
    const making = (get().pages ?? []).filter(
      (p) => p.id.startsWith("new-") && !pages.some((x) => x.id === p.id),
    );
    set({ pages: [...pages, ...making] });
    await keep(FILES.pages, { pages });
    return pages;
  } catch {
    return get().pages;
  }
}

/**
 * At start and after a reconnection: the pages again, and the start page if none is open. If Juan went somewhere
 * while they came (a new page he is naming, another page), that is where he stays: the list was asked before his
 * page existed, so it is not in it (task 36: the start page took the window from a page being named after a login,
 * and what he typed went nowhere).
 */
async function startPages() {
  void loadTree();
  void loadDataTypes();
  const before = get().view;
  const pages = await loadPages();
  const v = get().view;
  if (v !== before) {
    // Asked again now that his page may be in: the list asked before it lacks it.
    void loadPages();
    return;
  }
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

/**
 * A page opened by a link that carries values (D-59): opened, then its controls named take them, saved with it (as
 * a change of the person's, undoable) when one changed.
 */
export async function openPageWith(id: string, values: Record<string, string | number | null>) {
  await openPage(id);
  const page = get().page;
  if (page?.id !== id || !Object.keys(values).length) return;
  const { blocks, changed } = withPassed(page.spec.blocks, values);
  if (changed) setPageBlocks(blocks);
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
    // In the list in place of the temporary one; or added, if a list read meanwhile left it out.
    const list = get().pages ?? [];
    set({
      pages: list.some((p) => p.id === temp.id)
        ? list.map((p) => (p.id === temp.id ? page : p))
        : [...list.filter((p) => p.id !== page.id), page],
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

/** A page's new name from the sidebar's menu (task 42); the open page's is its title, as when it is typed. */
export function renamePage(id: string, title: string) {
  if (get().page?.id === id) return setPageTitle(title);
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 120);
  set({ pages: get().pages?.map((p) => (p.id === id ? { ...p, title: clean } : p)) ?? null });
  savePage(id, { title: clean });
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

/**
 * A new collection made from a picker (the inbox's correction, task 53): its id, with the types and the tree
 * reloaded; null when it was not made (a taken name says so).
 */
export async function createCollectionNamed(name: string): Promise<string | null> {
  try {
    const id = await agent.createCollection(name);
    await Promise.all([loadDataTypes(), loadTree()]);
    return id || null;
  } catch (e) {
    toast(get().t(e instanceof ApiError && e.code === "taken" ? "tree.taken" : "tree.failed"));
    return null;
  }
}

/** A new collection (at the root or inside `parent`), opened on its page unless `stay`. Whether it was made. */
/**
 * A new collection (inside `parent`), opened unless `stay`; its id, or null when it could not be made. What it changes
 * shows everywhere at once, «Mis datos»'s rows too (task 77: made from the diagram, the table did not show it).
 */
export async function newCollection(
  name: string,
  parent?: string,
  stay = false,
): Promise<string | null> {
  try {
    const id = await agent.createCollection(name, parent);
    await afterMyData();
    if (id && !stay) openCollection(id);
    return id ?? null;
  } catch (e) {
    toast(get().t(e instanceof ApiError && e.code === "taken" ? "tree.taken" : "tree.failed"));
    return null;
  }
}

/** A collection's new name from the sidebar's menu (task 42): at once in the tree; a taken name says so. */
export async function renameCollection(type: string, name: string) {
  const tree = get().tree;
  if (tree)
    set({
      tree: {
        ...tree,
        collections: tree.collections.map((c) => (c.id === type ? { ...c, name } : c)),
      },
    });
  try {
    await agent.renameCollection(type, name);
  } catch (e) {
    toast(get().t(e instanceof ApiError && e.code === "taken" ? "tree.taken" : "tree.failed"));
  }
  await afterMyData();
}

/** A collection out of the tree: only an empty one (otherwise it says why). */
export async function deleteCollection(type: string) {
  try {
    await agent.deleteCollection(type);
    forgetRecent(type);
    await afterMyData();
  } catch (e) {
    toast(
      get().t(e instanceof ApiError && e.code === "not-empty" ? "tree.notEmpty" : "tree.failed"),
    );
  }
}

// ---------- a collection's columns (task 40: as Notion's properties) ----------
const columnError = (e: unknown) =>
  get().t(
    e instanceof ApiError && e.code === "taken"
      ? "db.col.taken"
      : e instanceof ApiError && e.code === "in-use"
        ? "db.col.inUse"
        : "db.col.failed",
  );

/** A new column with its name and kind; false when the server said no (said in a toast). */
export async function addColumn(type: string, name: string, kind: string): Promise<boolean> {
  try {
    await agent.addColumn(type, { name, type: kind });
    await loadDataTypes();
    return true;
  } catch (e) {
    toast(columnError(e));
    return false;
  }
}

/**
 * A column put beside another (`side`) or a duplicate of one (`copy`, its values with it), from a column's menu (task
 * 76): its id, or "" when the server said no (said in a toast). The toast's «Deshacer» takes it out again.
 */
export async function addColumnBeside(
  type: string,
  col: {
    name: string;
    kind?: string;
    beside?: { field: string; side: "left" | "right" };
    copy?: string;
  },
): Promise<string> {
  try {
    const { kind, ...rest } = col;
    const id = await agent.addColumn(type, { ...rest, ...(kind ? { type: kind } : {}) });
    // A copy brings its values: the rows are read again with them.
    await Promise.all([loadDataTypes(), col.copy ? loadRows(type) : null]);
    const made = get()
      .dataTypes?.find((x) => x.id === type)
      ?.fields.find((f) => f.id === id);
    toast(
      get().t(col.copy ? "db.col.duplicated" : "db.col.added", { name: made?.name ?? col.name }),
      {
        label: get().t("toast.undo"),
        run: () =>
          void agent
            .removeColumn(type, id)
            .then(() => loadDataTypes())
            .catch((e) => toast(columnError(e))),
      },
    );
    return id;
  } catch (e) {
    toast(columnError(e));
    return "";
  }
}

/** A column's name, kind or options changed; false when the server said no (said in a toast). */
export async function changeColumn(
  type: string,
  field: string,
  change: {
    name?: string;
    type?: string;
    options?: { id?: string; name: string; color?: string }[];
  },
): Promise<boolean> {
  try {
    await agent.changeColumn(type, field, change);
    await loadDataTypes();
    return true;
  } catch (e) {
    toast(columnError(e));
    return false;
  }
}

/** A column out, its values kept: the toast's «Deshacer» brings it back. */
export async function removeColumn(type: string, field: string, name: string) {
  try {
    await agent.removeColumn(type, field);
    await loadDataTypes();
    toast(get().t("db.col.deleted", { name }), {
      label: get().t("toast.undo"),
      run: () =>
        void agent
          .restoreColumn(type, field)
          .then(() => loadDataTypes())
          .catch((e) => toast(columnError(e))),
    });
  } catch (e) {
    toast(columnError(e));
  }
}

/** Who reads and writes each collection (F6): asked when a diagram opens. */
export async function loadDataUsage() {
  try {
    set({ dataUsage: await agent.dataUsage() });
  } catch {
    // the diagram shows without it
  }
}

/**
 * A relation drawn from one collection to another in a diagram (F6): a column of the first named as the second,
 * one record; the toast's «Deshacer» takes it out again.
 */
export async function addRelation(type: string, target: string): Promise<boolean> {
  const types = get().dataTypes ?? [];
  const from = types.find((x) => x.id === type);
  const to = types.find((x) => x.id === target);
  if (!from || !to) return false;
  let name = to.name;
  for (let n = 2; from.fields.some((f) => f.name.toLowerCase() === name.toLowerCase()); n++)
    name = `${to.name} ${n}`;
  try {
    const id = await agent.addRelation(type, { name, target });
    await afterMyData();
    toast(get().t("data.related", { from: from.name, to: to.name }), {
      label: get().t("toast.undo"),
      run: () => void removeColumn(type, id, name),
    });
    return true;
  } catch (e) {
    toast(columnError(e));
    return false;
  }
}

/** A collection moved under another (`null`: the root), or a record to another collection. */
export async function moveInTree(
  what: { collection: string } | { row: string },
  to: string | null,
): Promise<boolean> {
  try {
    if ("collection" in what) await agent.moveCollection(what.collection, to);
    else if (to) await agent.moveRow(what.row, to);
    await afterMyData();
    return true;
  } catch {
    toast(get().t("tree.failed"));
    return false;
  }
}

/** A record to another collection, from its row's «Mover a» (F10, `entities.move`); its toast's Undo takes it back. */
export async function moveRowTo(from: string, id: string, to: string) {
  const t = get().t;
  const name = get().dataTypes?.find((x) => x.id === to)?.name ?? "";
  try {
    await agent.moveRow(id, to);
  } catch {
    return toast(t("tree.failed"));
  }
  const now = get().rows[from];
  if (now)
    set({
      rows: { ...get().rows, [from]: { ...now, rows: now.rows.filter((r) => r.id !== id) } },
    });
  void loadTree();
  toast(t("db.movedTo", { name }), {
    label: t("toast.undo"),
    run: () =>
      void agent
        .moveRow(id, from)
        .then(() => Promise.all([loadRows(from), loadTree()]))
        .catch(() => toast(t("tree.failed"))),
  });
}

/** A note's new title from the sidebar's menu (task 42): its record's title, then the tree again. */
export async function renameNote(type: string, id: string, title: string) {
  const def = get().dataTypes?.find((x) => x.id === type);
  if (!def || def.system || def.readOnly) return;
  await editRowValue(type, id, def.titleField, title);
  // «Recientes» keeps a note's title from when it was opened: this one says the new one.
  const recent = get().recent;
  if (recent.some((r) => r.kind === "row" && r.id === id)) {
    const next = recent.map((r) => (r.kind === "row" && r.id === id ? { ...r, title } : r));
    set({ recent: next });
    void keep(FILES.recent, { items: next });
  }
  await loadTree();
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
    const fresh = await agent.dataTypes();
    // A collection's views changed here and not yet in the account stay as they are here (task 69).
    const dataTypes = pendingViews.size
      ? fresh.map((x) => {
          const views = pendingViews.get(x.id);
          return views ? { ...x, rowUi: { ...x.rowUi, views } } : x;
        })
      : fresh;
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
/** «Flujos»: its views, as last left on this device. */
export const showFlows = () => set({ view: { kind: "flows" }, panel: null });
/** One flow on a page of its own, in its editor. */
export const showFlow = (id: string) => set({ view: { kind: "flows", flow: id }, panel: null });
let mapAsks = 0;
/**
 * «Ver en el mapa» of a row: a flow's row its flow, a row of «Mis datos» what it is (Boni's own records are on no
 * map), any other its collection.
 */
export function showMapOf(type: string, row: string) {
  if (type === SYS.flows.id) {
    const flow = flowRowTarget(row);
    return showMap(flow ? `flow:${flow}` : null);
  }
  if (type === SYS.data.id) {
    const id = dataRowTarget(row);
    if (!id) return showMap(null);
    const def = get().dataTypes?.find((x) => x.id === id);
    if (def?.system) return showMap(null);
    return def ? showMap(`col:${id}`) : showMap(`page:${id}`, { pages: true });
  }
  showMap(`col:${type}`);
}
/**
 * «Ver en el mapa» (docs/sistema.md §4.4; I-25): «Flujos» on its map, with this in the centre (a map node's id:
 * `col:<collection>`, `flow:<id>`, `page:<id>`, `boni:chat`…); `pages`: with the pages shown while it is there (a page);
 * `run`: that run drawn on it.
 */
export const showMap = (
  center: string | null,
  o: { pages?: boolean; run?: string; origin?: { title: string; origin: Origin } } = {},
) => {
  const s = get();
  // On the phone «Flujos» lives in «Páginas»: the map opens there, and Back returns to where it was asked from (a
  // run's «Recorrido» in the Registro or the Bandeja, task 90).
  const away = phoneLayout() && s.tab !== "pages";
  set({
    ...(away ? { tab: "pages" as const } : {}),
    view: {
      kind: "flows",
      map: {
        center,
        ...(o.pages ? { pages: true } : {}),
        // A run drawn on it (§4.4, «una ejecución encima»): its flow unfolded, the way it went.
        ...(o.run ? { run: o.run } : {}),
        ...(o.origin ? { origin: o.origin } : {}),
        ...(away ? { back: { tab: s.tab, view: s.view } } : {}),
        n: ++mapAsks,
      },
    },
    panel: null,
    settingsOpen: false,
  });
};

/**
 * A run's «Recorrido» (task 90; Juan, 2026-11-06: «teniendo el mapa, no tiene sentido tener lo del recorrido»): the
 * map with that run drawn on it, centred on where it belongs (its flow, the conversation, the reviewer, the Bandeja),
 * its words in its card. The Registro keeps the list of runs and each one's words.
 */
export const showRun = (run: string) => showMap(null, { run });

/**
 * «¿De dónde viene?» of a record (docs/sistema.md §4.4): what a flow or the conversation proposed or wrote, on the map
 * with that run drawn on it and the way it came told in words; what someone wrote, said in a notice.
 */
export async function showOrigin(id: string, title: string) {
  const t = get().t;
  let o: Origin | null = null;
  try {
    o = await agentApi.origin(id);
  } catch (e) {
    return toast(errorText(t, e));
  }
  if (!o) return toast(t("origin.none"));
  if (o.run)
    return showMap(o.run.owner ?? (o.run.flow ? `flow:${o.run.flow}` : "boni:chat"), {
      run: o.run.id,
      origin: { title, origin: o },
    });
  toast(originText(t, o));
}

/** Who wrote a record no run made, in words («Lo escribiste tú, en portatil, el 5 nov 12:10»). */
export function originText(t: T, o: Origin): string {
  const when = new Intl.DateTimeFormat(get().settings.language === "en" ? "en-GB" : "es-ES", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: deviceZone(),
  }).format(o.at);
  if (o.by === "user")
    return o.device ? t("origin.user.on", { device: o.device, when }) : t("origin.user", { when });
  if (o.by === "assistant") return t("origin.assistant", { name: o.device ?? "", when });
  return t(`origin.${o.by}`, { when });
}

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
  // Boni's filter lasts while its collection is on screen: going elsewhere takes it away.
  const f = s.boniFilter;
  if (f && s.view !== prev.view && !(s.view.kind === "collection" && s.view.type === f.type))
    set({ boniFilter: null });
});

/**
 * Boni's window as the device kept it (I-35): where it was, how (closed, floating, docked), the last conversation with
 * its turns, and the drafts. From then on each change is kept, a moment after the last (one write for a burst of
 * typing or a drag), and at once when the window goes.
 */
let keepingWindow = false;
let windowTimer: ReturnType<typeof setTimeout> | undefined;
async function restoreBoniWindow() {
  const k = readKept(await readJson<unknown>(store, FILES.boniWindow));
  const s = get();
  const now = {
    mode: s.boniWindow,
    place: s.boniPlace,
    conversation: s.conversationId,
    drafts: s.chatDrafts,
  };
  const r = restored(now, k, s.view.kind === "chat");
  set({
    boniWindow: r.mode,
    boniPlace: r.place,
    conversationId: r.conversation,
    chatDrafts: r.drafts,
    ...(r.mode === "right" && s.boniWindow === "closed" ? { inboxOpen: false } : {}),
  });
  keepingWindow = true;
  const id = get().conversationId;
  if (id && id === k.conversation && !s.conversationId) await loadTurns(id, true);
}
function keepBoniWindow() {
  windowTimer = undefined;
  const s = get();
  void keep(
    FILES.boniWindow,
    toKept({
      mode: s.boniWindow,
      place: s.boniPlace,
      conversation: s.conversationId,
      drafts: s.chatDrafts,
    }),
  );
}
function flushBoniWindow() {
  if (!windowTimer) return;
  clearTimeout(windowTimer);
  keepBoniWindow();
}
useStore.subscribe((s, prev) => {
  if (
    !keepingWindow ||
    (s.boniWindow === prev.boniWindow &&
      s.boniPlace === prev.boniPlace &&
      s.conversationId === prev.conversationId &&
      s.chatDrafts === prev.chatDrafts)
  )
    return;
  clearTimeout(windowTimer);
  windowTimer = setTimeout(keepBoniWindow, 300);
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
  // «Flujos» is a section of its own (its row in «Mis datos» opens it there).
  if (type === SYS.flows.id) return showFlows();
  set({ view: { kind: "collection", type }, panel: null });
  const name = get().dataTypes?.find((x) => x.id === type)?.name;
  if (name) noteRecent({ kind: "collection", id: type, title: name });
};

// ---------- a collection's views (task 69; Juan, 2026-11-05: Notion's views as tabs, with «+») ----------
function readActiveViews(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(ACTIVE_VIEWS) ?? "{}") as unknown;
    return v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).filter(
            (e): e is [string, string] => typeof e[1] === "string",
          ),
        )
      : {};
  } catch {
    return {};
  }
}
/** The first view of a collection that keeps none yet: its table, or what its page gives (`first`). */
const FIRST_VIEW = "v_inicio";
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingViews = new Map<string, SavedView[]>();
/** A collection's views as they are now: here at once, in the account a moment later (one request for a burst). */
function keepViews(type: string, views: SavedView[]) {
  set({
    dataTypes:
      get().dataTypes?.map((x) => (x.id === type ? { ...x, rowUi: { ...x.rowUi, views } } : x)) ??
      null,
  });
  pendingViews.set(type, views);
  clearTimeout(saveTimers.get(type));
  saveTimers.set(
    type,
    setTimeout(() => {
      saveTimers.delete(type);
      void agent
        .setRowUi(type, { views })
        .catch(() => toast(get().t("db.saveError")))
        .finally(() => {
          if (pendingViews.get(type) === views) pendingViews.delete(type);
        });
    }, 300),
  );
}
/** Opens one of a collection's views on this device. */
export function chooseView(type: string, id: string) {
  const activeViews = { ...get().activeViews, [type]: id };
  set({ activeViews });
  try {
    localStorage.setItem(ACTIVE_VIEWS, JSON.stringify(activeViews));
  } catch {}
}
/** A view changed (its layout, filter, sort, columns…): kept with its id and its name, or the one given. */
export function changeView(
  type: string,
  views: SavedView[],
  id: string,
  v: DatabaseView,
  name?: string,
) {
  keepViews(
    type,
    views.map((x) => (x.id === id ? { ...v, id: x.id, name: name ?? x.name } : x)),
  );
}
const newViewId = () => `v_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** «+»: a new view with this layout, named by it, opened. */
export function addView(type: string, views: SavedView[], view: DatabaseView, name: string) {
  if (views.length >= MAX_VIEWS) return;
  const id = newViewId();
  keepViews(type, [...views, { ...view, id, name }]);
  chooseView(type, id);
}
export function renameView(type: string, views: SavedView[], id: string, name: string) {
  const n = name.trim().slice(0, 60);
  if (n && n !== views.find((x) => x.id === id)?.name)
    keepViews(
      type,
      views.map((x) => (x.id === id ? { ...x, name: n } : x)),
    );
}
export function duplicateView(type: string, views: SavedView[], id: string, name: string) {
  const v = views.find((x) => x.id === id);
  if (!v || views.length >= MAX_VIEWS) return;
  const copy = { ...v, id: newViewId(), name };
  const at = views.indexOf(v) + 1;
  keepViews(type, [...views.slice(0, at), copy, ...views.slice(at)]);
  chooseView(type, copy.id);
}
/**
 * A collection's views for its page (task 69): those kept or its first, the one open, and what the head's tabs do. The
 * first one is named after its layout; a new one too; a copy says it is one.
 */
export function useViews(
  type: string,
  first: DatabaseView,
  /** More views a collection starts with besides the first («Flujos»: its «Mapa»), each with its name. */
  more: readonly { view: DatabaseView; name: string }[] = [],
  /** A layout's name where the collection says it its own way («Flujos»: the diagram is its «Mapa»). */
  layoutName?: (layout: DatabaseView["layout"]) => string | undefined,
) {
  const t = useStore((s) => s.t);
  const nameOf = (l: DatabaseView["layout"]) => layoutName?.(l) ?? t(`db.layouts.${l}`);
  const kept = useStore((s) => s.dataTypes?.find((x) => x.id === type)?.rowUi.views);
  const chosen = useStore((s) => s.activeViews[type]);
  const views: SavedView[] = kept?.length
    ? kept
    : [
        { ...first, id: FIRST_VIEW, name: nameOf(first.layout) },
        ...more.map((m, i) => ({ ...m.view, id: `${FIRST_VIEW}_${i + 1}`, name: m.name })),
      ];
  const active = views.find((v) => v.id === chosen) ?? (views[0] as SavedView);
  return {
    view: active as DatabaseView,
    // A view still named after its layout takes the new one's name with it (Notion's).
    onView: (v: DatabaseView) =>
      changeView(
        type,
        views,
        active.id,
        v,
        v.layout !== active.layout && active.name === nameOf(active.layout)
          ? nameOf(v.layout)
          : undefined,
      ),
    control: {
      list: views,
      active: active.id,
      onSwitch: (id: string) => chooseView(type, id),
      onAdd: (layout: DatabaseView["layout"]) => addView(type, views, { layout }, nameOf(layout)),
      onRename: (id: string, name: string) => renameView(type, views, id, name),
      onDuplicate: (id: string) =>
        duplicateView(
          type,
          views,
          id,
          t("db.view.copyOf", { name: views.find((v) => v.id === id)?.name ?? "" }),
        ),
      onDelete: (id: string) => deleteView(type, views, id, active.id),
    },
  };
}

/** A view gone (never the last one); if it was the one open, its neighbour opens. */
export function deleteView(type: string, views: SavedView[], id: string, open: string) {
  if (views.length <= 1) return;
  const at = views.findIndex((x) => x.id === id);
  const rest = views.filter((x) => x.id !== id);
  keepViews(type, rest);
  if (open === id) chooseView(type, (rest[Math.max(0, at - 1)] as SavedView).id);
}

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
    if (get().rows[SYS.data.id]) void loadRows(SYS.data.id);
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

/**
 * Boni's own records (calls to models, its activity): read only, so nothing here changes or opens them. «Mis datos»
 * is the one Boni's collection a person changes (its rows are his collections and pages).
 */
const readOnly = (type: string) => {
  const def = get().dataTypes?.find((x) => x.id === type);
  return def?.system === true && !def.editable;
};
const MY_DATA = SYS.data.id;
/** Boni's own collections a person changes: their rows are what they stand for (a collection, a page, a flow). */
const OWN = (type: string) => type === MY_DATA || type === SYS.flows.id;

/**
 * After a change in «Mis datos»: what it changed shows everywhere (the sidebar's tree and pages, the collections) and
 * its rows again (a mother renamed is her daughters' «Padre» too).
 */
const afterMyData = () =>
  Promise.all([loadDataTypes(), loadTree(), loadPages(), loadRows(SYS.data.id)]).catch(
    () => undefined,
  );
/** Why a change in «Mis datos» was refused, in words; the general one for the rest. */
const myDataError = (e: unknown) => {
  const t = get().t;
  const code = e instanceof ApiError ? e.code : "";
  // «Flujos» (flowsCollection.ts): what a change to a flow's row was refused for.
  if (code.startsWith("flow-")) return t(`flows.err.${code.slice(5)}`);
  return code === "taken"
    ? t("tree.taken")
    : code === "not-empty"
      ? t("tree.notEmpty")
      : code === "locked"
        ? t("data.locked")
        : t("db.saveError");
};

/** A cell changed in a view: at once here, then on the server (its answer is the truth). */
export async function editCell(type: string, id: string, field: string, value: DataValue) {
  const def = get().dataTypes?.find((x) => x.id === type);
  if (readOnly(type) || (def && !fieldEditable(def, field))) return;
  const before = get().rows[type]?.rows.find((r) => r.id === id);
  if (!before) return;
  putRow(type, { ...before, values: { ...before.values, [field]: value } });
  try {
    const saved = await agent.updateRow(id, { [field]: value });
    if (saved) putRow(type, saved);
    if (type === MY_DATA) await afterMyData();
  } catch (e) {
    putRow(type, before);
    toast(OWN(type) ? myDataError(e) : get().t("db.saveError"));
  }
}

/**
 * A flow's new name from its editor (task 80): the same change as its «Nombre» in «Flujos» (a version with the
 * same steps), so the list says it at once, its rows here too.
 */
export async function renameFlow(id: string, name: string): Promise<void> {
  const saved = await agent.updateRow(SYS.flows.row + id, { [SYS.flows.title]: name });
  if (saved) putRow(SYS.flows.id, saved);
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
    if (type === MY_DATA) await afterMyData();
    return row;
  } catch (e) {
    toast(OWN(type) ? myDataError(e) : get().t("db.saveError"));
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
    } catch (e) {
      toast(OWN(type) ? myDataError(e) : t("db.saveError"));
      break;
    }
  }
  if (!gone.length) return;
  if (type === MY_DATA) {
    // A collection or a page went: forget it in «Recientes» too.
    for (const id of gone) forgetRecent(dataRowTarget(id) ?? id);
    void afterMyData();
  }
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
        .then(async () => {
          if (type === MY_DATA) await afterMyData();
          else await Promise.all([loadRows(type), loadTree()]);
        })
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
  // A row of «Flujos» opens its flow's page.
  if (type === SYS.flows.id) {
    const flow = flowRowTarget(id);
    if (flow) showFlow(flow);
    return;
  }
  // A row of «Mis datos» opens what it is: its collection's page, or the page.
  if (type === MY_DATA) {
    const target = dataRowTarget(id);
    if (!target) return;
    if (get().dataTypes?.some((x) => x.id === target)) return openCollection(target);
    return openPage(target);
  }
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
    rowHistory: false,
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
    views?: SavedView[];
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

/** The phone's list of conversations, opened and closed from its top bar (Back closes it too). */
export const toggleChatList = (open = !get().chatList) => set({ chatList: open });

/** Inicio's «Hoy»: what the calendars hold today in this device's timezone; offline it keeps what it had. */
export async function loadToday() {
  if (!configured(get().settings)) return;
  try {
    set({ today: await agent.today(deviceZone()) });
  } catch {
    // Offline or a server that failed: the last list stays.
  }
}

/** A task of «Hoy» ticked or unticked: at once on Inicio, then on the server (Undo in the toast). */
export async function tickToday(item: TodayItem, undo = false) {
  if (!item.doneField) return;
  const t = get().t;
  const flip = (done: boolean) =>
    set((s) => ({
      today: s.today?.map((x) => (x.id === item.id ? { ...x, done } : x)) ?? null,
    }));
  flip(!item.done);
  try {
    const saved = await agent.updateRow(item.id, { [item.doneField]: !item.done });
    if (saved && get().rows[item.type]) putRow(item.type, saved);
    if (!undo)
      toast(t(item.done ? "today.undone" : "today.done", { title: item.title }), {
        label: t("toast.undo"),
        run: () => void tickToday({ ...item, done: !item.done }, true),
      });
  } catch {
    flip(item.done);
    toast(t("db.saveError"));
  }
}

/** A record by its id alone (a file just kept, something of «Hoy»): its page in «Páginas». */
export async function openRowById(id: string, type?: string) {
  try {
    const kind = type ?? (await agent.dataRow(id))?.type;
    if (!kind) return void toast(get().t("note.notFound"));
    if (!get().dataTypes) await loadDataTypes();
    set({ tab: "pages", view: { kind: "home" } });
    await openRow(kind, id);
  } catch (e) {
    toast(get().t(e instanceof ApiError && e.status === 404 ? "note.notFound" : "note.offline"));
  }
}

/**
 * Files chosen on the phone (the + button's «Subir un archivo»): each kept in Boni where the account keeps files
 * (asked once when there is more than one collection of them), as a page drop does; one file opens as its record.
 */
export async function uploadFiles(files: File[]) {
  const t = get().t;
  const kept: string[] = [];
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
      kept.push(r.id);
    } catch {
      toast(t("file.saveError", { name }));
    }
  }
  if (kept.length === 1) await openRowById(kept[0] as string, into);
  else if (kept.length) toast(t("file.kept", { n: kept.length }));
}

export const setRowHistory = (open: boolean) => set({ rowHistory: open });
