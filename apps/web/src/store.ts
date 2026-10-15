import {
  type Account,
  addMonths,
  type CalEvent,
  type CalendarData,
  type CalendarDef,
  type CalendarMapping,
  type CalendarView,
  type CivilDay,
  type Collection,
  type CollectionProvider,
  type CollectionSnapshot,
  calendarDefs,
  diffRows,
  editOccurrence,
  eventsInDays,
  expandAll,
  type FirstDay,
  generateCollectionSample,
  type Locale,
  makeModel,
  makeProjector,
  memoryProvider,
  type OccurrenceCache,
  type Projector,
  type PropertyDef,
  parseOccurrenceId,
  projectsOf,
  type Row,
  reconcileRows,
  resolveOccurrence,
  type Scope,
  startOfMonth,
  startOfWeek,
  supportsTasks,
  systemTimeZone,
  todayIn,
  validateModel,
  type When,
  withSchema,
} from "@boni-calendar/core";
import { create } from "zustand";
import { nowMs } from "./clock.ts";
import { setLocale } from "./i18n.ts";
import { clickSelection, orderedVisibleIds } from "./selection.ts";
import type { IgnoredNote, VaultLoad } from "./vault/loadVault.ts";
import {
  readVault,
  resetVaultIndex,
  serialized,
  stopWatchingVault,
  watchVault,
} from "./vault/sync.ts";
import { vaultBridge } from "./vaultBridge.ts";

export type ViewKind = "day" | "week" | "days" | "month";
export type Theme = "dark" | "light" | "system";

export interface Settings {
  locale: Locale;
  theme: Theme;
  h24: boolean;
  firstDay: FirstDay;
  tz: string;
  secondTz: string | null;
  weekNumbers: boolean;
  defaultDuration: number;
  snap: number;
  density: "compact" | "comfortable";
  /** Where the calendars come from: invented sample data, or the notes of the user's vault (desktop app). */
  dataSource: "sample" | "vault";
}

export interface VaultState {
  status: "idle" | "loading" | "ready" | "error";
  root: string | null;
  notes: number;
  /** Notes the calendar cannot show (broken properties, no date), and why. */
  ignored: IgnoredNote[];
  /** Definitions or folders that could not be read. */
  problems: string[];
  message?: string;
}

export interface DragState {
  kind: "move" | "resize" | "create";
  id: string;
  when: When;
  /** Other selected events moving together with `id` (kind "move"). */
  group?: Record<string, When>;
}

export interface ScopePrompt {
  kind: "edit" | "delete";
  onChoose: (scope: Scope) => void;
  onCancel: () => void;
}

export type CtxTarget =
  | { kind: "event"; id: string }
  | { kind: "slot"; day: CivilDay; minute: number | null }
  | { kind: "calendar"; id: string };

export interface Toast {
  id: number;
  text: string;
  params?: Record<string, string | number>;
  undo?: boolean;
}

const SETTINGS_KEY = "boni-calendar:settings";
const UI_KEY = "boni-calendar:ui";

const DEFAULT_SETTINGS: Settings = {
  locale: "es",
  theme: "dark",
  h24: true,
  firstDay: 1,
  tz: systemTimeZone(),
  secondTz: null,
  weekNumbers: false,
  defaultDuration: 60,
  snap: 15,
  density: "comfortable",
  dataSource: "sample",
};

function load<T>(key: string): Partial<T> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<T>) : {};
  } catch {
    return {};
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private windows, previews); the app works without it.
  }
}

interface UiPersist {
  view: ViewKind;
  nDays: number;
  sidebarOpen: boolean;
  hiddenCalendars: string[];
}

export interface AppState {
  /**
   * Rows are the only truth. `data` is derived from them (events are the projection of the rows
   * through each calendar's mapping): read it, never write it; edit through the store actions.
   */
  accounts: Account[];
  collections: Collection[];
  views: CalendarView[];
  rows: Row[];
  /** What `rows` were read from. */
  source: "sample" | "vault";
  vault: VaultState;
  projector: Projector;
  provider: CollectionProvider;
  data: CalendarData;
  settings: Settings;
  view: ViewKind;
  nDays: number;
  sidebarOpen: boolean;
  /** The single selected event, or null when none or several are selected. */
  selectedId: string | null;
  selectedIds: string[];
  anchorId: string | null;
  popoverId: string | null;
  detailMode: "popover" | "panel";
  drag: DragState | null;
  nav: { seq: number; day: CivilDay; animate: boolean };
  past: Row[][];
  future: Row[][];
  toast: Toast | null;
  settingsOpen: boolean;
  paletteOpen: boolean;
  helpOpen: boolean;
  schemaCalendarId: string | null;
  newEventId: string | null;
  ctxMenu: { x: number; y: number; target: CtxTarget } | null;
  /** Days around the view that recurring events are expanded for. */
  win: { from: CivilDay; to: CivilDay };
  scopePrompt: ScopePrompt | null;

  today: () => CivilDay;
  setSettings: (patch: Partial<Settings>) => void;
  setView: (view: ViewKind, nDays?: number) => void;
  goTo: (day: CivilDay, animate?: boolean) => void;
  goToday: () => void;
  step: (dir: 1 | -1) => void;
  toggleSidebar: () => void;
  toggleCalendar: (id: string) => void;
  updateCalendar: (id: string, patch: Partial<CalendarDef>) => void;
  setSchema: (id: string, schema: PropertyDef[]) => void;
  /** Which columns a calendar reads (date, times, task...). Ignored when the result would be invalid. */
  setMapping: (id: string, mapping: CalendarMapping) => void;
  /** Whether events of this calendar can be tasks (it maps a task column). */
  supportsTasks: (calendarId: string) => boolean;
  select: (id: string | null, popover?: boolean) => void;
  clickSelect: (id: string, mods: { ctrl: boolean; shift: boolean }) => void;
  clearSelection: () => void;
  selectAllVisible: () => void;
  setDetailMode: (m: "popover" | "panel") => void;
  addEvent: (e: Partial<CalEvent> & { when: When }) => string;
  setWindow: (from: CivilDay, to: CivilDay) => void;
  /** Visible-window events with recurring series expanded into occurrences. */
  expanded: () => CalEvent[];
  getEvent: (id: string) => CalEvent | null;
  /** True when the event belongs to a read-only calendar (it can be selected but not edited). */
  isLocked: (id: string) => boolean;
  updateEvent: (id: string, patch: Partial<CalEvent>, scope?: Scope) => void;
  updateEvents: (ids: string[], patch: Partial<CalEvent>, scope?: Scope) => void;
  /** Like updateEvents, but asks "this / following / all" first when a recurring event is involved. */
  editEvents: (ids: string[], patch: Partial<CalEvent>) => void;
  deleteEvent: (id: string) => void;
  deleteEvents: (ids: string[], scope?: Scope) => void;
  removeEvents: (ids: string[]) => void;
  setScopePrompt: (p: ScopePrompt | null) => void;
  askScope: (
    ids: string[],
    kind: "edit" | "delete",
    run: (scope: Scope) => void,
    onCancel?: () => void,
  ) => void;
  duplicateEvent: (id: string) => string | null;
  duplicateEvents: (ids: string[]) => string[];
  showOnlyCalendar: (id: string) => void;
  showAllCalendars: () => void;
  setDrag: (d: DragState | null) => void;
  commitDrag: (scope?: Scope) => void;
  finishDrag: () => void;
  undo: () => void;
  redo: () => void;
  showToast: (text: string, undo?: boolean, params?: Record<string, string | number>) => void;
  clearToast: () => void;
  resetData: () => void;
  /** Reads the vault (definitions and notes) and shows it. */
  loadVault: () => Promise<void>;
  /** Asks for the vault folder (desktop app); true when one is set. */
  chooseVaultRoot: () => Promise<boolean>;
  setDataSource: (source: "sample" | "vault") => Promise<void>;
  set: (patch: Partial<AppState>) => void;
}

function makeSnapshot(settings: Settings, hidden: Set<string>): CollectionSnapshot {
  const snap = generateCollectionSample({
    anchorDay: todayIn(settings.tz, nowMs()),
    tz: settings.tz,
  });
  return {
    ...snap,
    views: snap.views.map((v) => (hidden.has(v.id) ? { ...v, visible: false } : v)),
  };
}

type Source = Pick<AppState, "accounts" | "collections" | "views" | "rows">;

/** Everything derived from the stored collections, views and rows. */
function derive(src: Source, tz: string, keep?: Projector): Pick<AppState, "projector" | "data"> {
  const projector = keep ?? makeProjector(makeModel(src.collections, src.views, { defaultTz: tz }));
  return {
    projector,
    data: {
      accounts: src.accounts,
      calendars: calendarDefs(src.collections, src.views),
      projects: projectsOf(src.rows),
      events: projector.project(src.rows),
    },
  };
}

/** The projector can be kept when no view changed in a way that affects how rows read or write. */
function sameProjection(a: readonly CalendarView[], b: readonly CalendarView[]): boolean {
  return (
    a.length === b.length &&
    a.every((v, i) => {
      const w = b[i];
      return (
        w &&
        v.id === w.id &&
        v.collectionId === w.collectionId &&
        v.mapping === w.mapping &&
        v.tz === w.tz
      );
    })
  );
}

const newEventId = (now: number): string =>
  `ev-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Applies a list of per-event changes (patches or removals) in one pass, honouring recurrence scope. */
function applyEdits(
  events: CalEvent[],
  items: { id: string; change: { patch?: Partial<CalEvent>; remove?: boolean } }[],
  scope: Scope,
  now: number,
): CalEvent[] {
  let out = events;
  for (const it of items) {
    out = editOccurrence(out, it.id, scope, it.change, { newId: () => newEventId(now), now });
  }
  return out;
}

const occurrenceCache: OccurrenceCache = new WeakMap();
let expandedKey: { events: CalEvent[]; from: CivilDay; to: CivilDay } | null = null;
let expandedValue: CalEvent[] = [];
/** Expansion is memoised on the events array and the window, so repeated reads are free. */
export function expandedCache(
  events: CalEvent[],
  win: { from: CivilDay; to: CivilDay },
): CalEvent[] {
  const k = expandedKey;
  if (k && k.events === events && k.from === win.from && k.to === win.to) return expandedValue;
  expandedKey = { events, from: win.from, to: win.to };
  expandedValue = expandAll(events, win.from, win.to, occurrenceCache);
  return expandedValue;
}

let toastSeq = 0;

export const useApp = create<AppState>((set, get) => {
  const urlTz =
    typeof location === "undefined" ? null : new URLSearchParams(location.search).get("tz");
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...load<Settings>(SETTINGS_KEY),
    ...(urlTz ? { tz: urlTz } : {}),
  };
  const ui = load<UiPersist>(UI_KEY);
  const hidden = new Set(ui.hiddenCalendars ?? []);
  setLocale(settings.locale);
  // With the vault as the source the first picture is empty (no flash of sample data) until it loads.
  const wantVault = settings.dataSource === "vault" && !!vaultBridge();
  const snapshot: CollectionSnapshot = wantVault
    ? { accounts: [], collections: [], views: [], rows: [] }
    : makeSnapshot(settings, hidden);

  const persistUi = () => {
    const s = get();
    save(UI_KEY, {
      view: s.view,
      nDays: s.nDays,
      sidebarOpen: s.sidebarOpen,
      hiddenCalendars: s.data.calendars.filter((c) => !c.visible).map((c) => c.id),
    } satisfies UiPersist);
  };

  /** Stores new rows (and tells the provider what changed). `history: false` for undo and redo. */
  const setRows = (rows: Row[], history = true) => {
    const s = get();
    set({
      rows,
      data: { ...s.data, events: s.projector.project(rows) },
      ...(history ? { past: [...s.past.slice(-99), s.rows], future: [] } : {}),
    });
    void s.provider.apply(diffRows(s.rows, rows)).catch((e) => console.error("save failed", e));
  };

  /** Applies an edited event list as row changes, with undo history. */
  const commit = (next: CalEvent[]) => {
    const s = get();
    setRows(reconcileRows(s.projector.model, s.rows, s.data.events, next));
  };

  /** Replaces collections, views or accounts; the derived data follows. */
  const setDefinitions = (patch: Partial<Pick<Source, "accounts" | "collections" | "views">>) => {
    const s = get();
    const next: Source = {
      accounts: patch.accounts ?? s.accounts,
      collections: patch.collections ?? s.collections,
      views: patch.views ?? s.views,
      rows: s.rows,
    };
    const keep =
      next.collections === s.collections && sameProjection(s.views, next.views)
        ? s.projector
        : undefined;
    const d = derive(next, s.settings.tz, keep);
    // Only calendars changed: keep the very same events array so nothing that reads events re-renders.
    set({
      ...next,
      projector: d.projector,
      data: keep ? { ...s.data, calendars: d.data.calendars, accounts: next.accounts } : d.data,
    });
  };

  /**
   * Shows what a read of the vault found. When nothing that matters changed this only refreshes the
   * counts; otherwise unchanged notes keep their row (and event) objects, a calendar keeps being
   * visible or hidden as the user left it, and a selection survives if its event still exists.
   */
  const applyVault = (r: VaultLoad, root: string | null) => {
    const s = get();
    const hidden = new Set(load<UiPersist>(UI_KEY).hiddenCalendars ?? []);
    const wasVisible = new Map(s.views.map((v) => [v.id, v.visible]));
    // Definitions are read again on every refresh: keep the previous objects when nothing changed in
    // them, so everything that compares them by identity (the projector, the calendar list) stays put.
    const prevView = new Map(s.views.map((v) => [v.id, v]));
    const prevColl = new Map(s.collections.map((c) => [c.id, c]));
    const same = <T>(a: T | undefined, b: T): T =>
      a && JSON.stringify(a) === JSON.stringify(b) ? a : b;
    const collections = r.snapshot.collections.map((c) => same(prevColl.get(c.id), c));
    const views = r.snapshot.views.map((v) => {
      const old = prevView.get(v.id);
      return {
        ...v,
        mapping: same(old?.mapping, v.mapping),
        visible: wasVisible.get(v.id) ?? !hidden.has(v.id),
      };
    });
    const vault: VaultState = {
      status: "ready",
      root,
      notes: r.notes,
      ignored: r.ignored,
      problems: r.problems,
    };
    const sameRows =
      s.source === "vault" &&
      s.rows.length === r.snapshot.rows.length &&
      s.rows.every((row, i) => row === r.snapshot.rows[i]);
    const sameDefs =
      JSON.stringify(s.collections) === JSON.stringify(collections) &&
      JSON.stringify(s.views) === JSON.stringify(views) &&
      JSON.stringify(s.accounts) === JSON.stringify(r.snapshot.accounts);
    if (sameRows && sameDefs) {
      if (JSON.stringify(s.vault) !== JSON.stringify(vault)) set({ vault });
      return;
    }
    const sameCollections =
      collections.every((c, i) => c === s.collections[i]) &&
      collections.length === s.collections.length;
    const snap: CollectionSnapshot = {
      ...r.snapshot,
      collections: sameCollections ? s.collections : collections,
      views,
    };
    const keep = sameCollections && sameProjection(s.views, views) ? s.projector : undefined;
    const d = derive(snap, s.settings.tz, keep);
    const ids = new Set(d.data.events.map((e) => e.id));
    const selectedIds = s.selectedIds.filter((id) => ids.has(id));
    set({
      ...snap,
      ...d,
      source: "vault",
      provider: s.source === "vault" ? s.provider : memoryProvider(snap),
      ...(s.source === "vault" ? {} : { past: [], future: [] }),
      selectedIds,
      selectedId: selectedIds.length === 1 ? (selectedIds[0] ?? null) : null,
      anchorId: s.anchorId && ids.has(s.anchorId) ? s.anchorId : null,
      popoverId: s.popoverId && ids.has(s.popoverId) ? s.popoverId : null,
      vault,
    });
  };

  const mapViews = (fn: (v: CalendarView) => CalendarView) =>
    setDefinitions({ views: get().views.map(fn) });

  return {
    ...snapshot,
    ...derive(snapshot, settings.tz),
    source: wantVault ? "vault" : "sample",
    vault: {
      status: wantVault ? "loading" : "idle",
      root: null,
      notes: 0,
      ignored: [],
      problems: [],
    },
    provider: memoryProvider(snapshot),
    settings,
    view: ui.view ?? "week",
    nDays: ui.nDays ?? 7,
    sidebarOpen: ui.sidebarOpen ?? true,
    selectedId: null,
    selectedIds: [],
    anchorId: null,
    popoverId: null,
    detailMode: "popover",
    drag: null,
    nav: { seq: 0, day: todayIn(settings.tz, nowMs()), animate: false },
    past: [],
    future: [],
    toast: null,
    settingsOpen: false,
    paletteOpen: false,
    helpOpen: false,
    schemaCalendarId: null,
    newEventId: null,
    ctxMenu: null,
    win: {
      from: todayIn(settings.tz, nowMs()) - 21,
      to: todayIn(settings.tz, nowMs()) + 35,
    },
    scopePrompt: null,

    today: () => todayIn(get().settings.tz, nowMs()),

    setSettings: (patch) => {
      const next = { ...get().settings, ...patch };
      if (patch.locale) setLocale(patch.locale);
      save(SETTINGS_KEY, next);
      set({ settings: next });
      // Rows without their own timezone follow the app's.
      if (patch.tz !== undefined) setDefinitions({ collections: [...get().collections] });
      if (patch.firstDay !== undefined) {
        // Re-align the visible range (week/month rows) to the new first day of the week.
        const vis = useVisible.getState().start;
        const center = get().view === "month" ? vis : vis + 3;
        get().goTo(center, false);
      }
    },

    setView: (view, nDays) => {
      const prev = get();
      const vis = useVisible.getState().start;
      const today = get().today();
      const prevN = visibleDays(prev.view, prev.nDays);
      let focus = vis;
      if (view === "day" || view === "days") {
        // Land on today when it is on screen, otherwise on the first visible day.
        const [from, to] =
          prev.view === "month"
            ? [startOfMonth(vis), startOfMonth(addMonths(vis, 1)) - 1]
            : [vis, vis + prevN - 1];
        focus =
          today >= from && today <= to ? today : prev.view === "month" ? startOfMonth(vis) : vis;
      } else if (view === "month" || view === "week") {
        focus = prev.view === "month" ? vis : vis + Math.floor(prevN / 2);
        if (prev.view !== "month" && view === "month") focus = vis + Math.floor(prevN / 2);
      }
      const animate = prev.view !== "month" && view !== "month";
      set({
        view,
        nDays: nDays ?? prev.nDays,
        popoverId: null,
        nav: { seq: prev.nav.seq + 1, day: focus, animate },
      });
      persistUi();
    },

    goTo: (day, animate = true) => {
      set((s) => ({ nav: { seq: s.nav.seq + 1, day, animate } }));
    },

    goToday: () => get().goTo(get().today()),

    step: (dir) => {
      const { view, nDays } = get();
      const cur = useVisible.getState().start;
      if (view === "month") get().goTo(addMonths(startOfMonth(cur), dir));
      else get().goTo(cur + dir * (view === "day" ? 1 : view === "week" ? 7 : nDays));
    },

    toggleSidebar: () => {
      set((s) => ({ sidebarOpen: !s.sidebarOpen }));
      persistUi();
    },

    toggleCalendar: (id) => {
      mapViews((v) => (v.id === id ? { ...v, visible: !v.visible } : v));
      persistUi();
    },

    updateCalendar: (id, patch) => {
      const { name, schema, id: _id, ...viewPatch } = patch;
      const s = get();
      const view = s.views.find((v) => v.id === id);
      if (!view) return;
      let collections = s.collections;
      if (name !== undefined || schema) {
        collections = collections.map((c) => {
          if (c.id !== view.collectionId) return c;
          const renamed = name !== undefined ? { ...c, name } : c;
          return schema ? withSchema(renamed, view, schema) : renamed;
        });
      }
      setDefinitions({
        collections,
        views: s.views.map((v) => (v.id === id ? { ...v, ...viewPatch } : v)),
      });
    },

    setSchema: (id, schema) => get().updateCalendar(id, { schema }),

    setMapping: (id, mapping) => {
      const s = get();
      const views = s.views.map((v) => (v.id === id ? { ...v, mapping } : v));
      const errors = validateModel(s.collections, views).filter((i) => i.severity === "error");
      if (errors.length > 0) return console.warn("mapping rejected", errors);
      setDefinitions({ views });
    },

    supportsTasks: (calendarId) => supportsTasks(get().projector.model, calendarId),

    select: (id, popover = true) =>
      set({
        selectedId: id,
        selectedIds: id ? [id] : [],
        anchorId: id,
        popoverId: popover ? id : null,
      }),

    clearSelection: () =>
      set({ selectedId: null, selectedIds: [], anchorId: null, popoverId: null, newEventId: null }),

    clickSelect: (id, mods) => {
      const s = get();
      const visible = new Set(s.data.calendars.filter((c) => c.visible).map((c) => c.id));
      const expanded = s.expanded();
      const calOf = new Map(expanded.map((e) => [e.id, e.calendarId]));
      const r = clickSelection({
        current: s.selectedIds,
        anchor: s.anchorId,
        clicked: id,
        ordered: orderedVisibleIds(expanded, visible, s.settings.tz),
        calendarOf: (x) => calOf.get(x),
        ctrl: mods.ctrl,
        shift: mods.shift,
      });
      set({
        selectedIds: r.ids,
        selectedId: r.ids.length === 1 ? (r.ids[0] ?? null) : null,
        anchorId: r.anchor,
        popoverId: r.popover ? id : null,
      });
    },

    selectAllVisible: () => {
      const s = get();
      const vis = useVisible.getState().start;
      const n = visibleDays(s.view, s.nDays);
      const [from, to] =
        s.view === "month"
          ? [startOfMonth(vis), startOfMonth(addMonths(vis, 1)) - 1]
          : [vis, vis + n - 1];
      const visible = new Set(s.data.calendars.filter((c) => c.visible).map((c) => c.id));
      const ids = eventsInDays(s.expanded(), visible, from, to, s.settings.tz).map((e) => e.id);
      set({
        selectedIds: ids,
        selectedId: ids.length === 1 ? (ids[0] ?? null) : null,
        anchorId: ids[0] ?? null,
        popoverId: null,
      });
    },

    setDetailMode: (m) => set({ detailMode: m }),

    addEvent: (e) => {
      const s = get();
      const calendarId =
        e.calendarId ?? s.data.calendars.find((c) => c.visible && !c.readOnly)?.id ?? "main";
      const now = nowMs();
      const id = `ev-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const ev: CalEvent = {
        calendarId,
        title: "",
        location: "",
        description: "",
        props: {},
        isTask: false,
        done: false,
        ...e,
        id,
        created: now,
        updated: now,
      };
      commit([...s.data.events, ev]);
      set({ selectedId: id, selectedIds: [id], anchorId: id, newEventId: id });
      return id;
    },

    // The window only moves when a view gets near its edge, and then by a wide margin, so scrolling
    // does not re-expand the series (and re-render every row) on each step.
    setWindow: (from, to) => {
      const w = get().win;
      if (from >= w.from && to <= w.to) return;
      set({ win: { from: from - 56, to: to + 56 } });
    },

    expanded: () => expandedCache(get().data.events, get().win),

    getEvent: (id) => resolveOccurrence(get().data.events, id),

    isLocked: (id) => {
      const ev = get().getEvent(id);
      return !!ev && get().data.calendars.find((c) => c.id === ev.calendarId)?.readOnly === true;
    },

    updateEvent: (id, patch, scope = "all") => get().updateEvents([id], patch, scope),

    updateEvents: (ids, patch, scope = "all") => {
      const now = nowMs();
      commit(
        applyEdits(
          get().data.events,
          ids.map((id) => ({ id, change: { patch } })),
          scope,
          now,
        ),
      );
    },

    editEvents: (ids, patch) => {
      // Changing the repetition rule itself always applies to the whole series.
      if ("recurrence" in patch) return get().updateEvents(ids, patch, "all");
      get().askScope(ids, "edit", (scope) => get().updateEvents(ids, patch, scope));
    },

    deleteEvent: (id) => get().removeEvents([id]),

    deleteEvents: (ids, scope = "all") => {
      const now = nowMs();
      commit(
        applyEdits(
          get().data.events,
          ids.map((id) => ({ id, change: { remove: true } })),
          scope,
          now,
        ),
      );
      get().clearSelection();
      if (ids.length === 1) get().showToast("event.deleted", true);
      else get().showToast("events.deleted", true, { n: ids.length });
    },

    removeEvents: (ids) => {
      get().askScope(ids, "delete", (scope) => get().deleteEvents(ids, scope));
    },

    setScopePrompt: (p) => set({ scopePrompt: p }),

    askScope: (ids, kind, run, onCancel) => {
      const recurring = ids.some((id) => {
        const p = parseOccurrenceId(id);
        return !!p && get().data.events.some((e) => e.id === p.seriesId && e.recurrence);
      });
      if (!recurring) return run("all");
      set({
        scopePrompt: {
          kind,
          onChoose: (scope) => {
            set({ scopePrompt: null });
            run(scope);
          },
          onCancel: () => {
            set({ scopePrompt: null });
            onCancel?.();
          },
        },
      });
    },

    duplicateEvent: (id) => get().duplicateEvents([id])[0] ?? null,

    duplicateEvents: (ids) => {
      const s = get();
      const now = nowMs();
      const copies: CalEvent[] = [];
      for (const id of ids) {
        const e = resolveOccurrence(s.data.events, id);
        if (!e) continue;
        // A copy of an occurrence is a plain, single event.
        const { seriesId: _a, occurrenceDay: _b, exdates: _c, ...rest } = e;
        copies.push({
          ...rest,
          recurrence: null,
          id: newEventId(now),
          title: e.title ? `${e.title} (2)` : "",
          created: now,
          updated: now,
        });
      }
      if (copies.length === 0) return [];
      commit([...s.data.events, ...copies]);
      const newIds = copies.map((c) => c.id);
      set({
        selectedIds: newIds,
        selectedId: newIds.length === 1 ? (newIds[0] ?? null) : null,
        anchorId: newIds[0] ?? null,
        newEventId: newIds.length === 1 ? (newIds[0] ?? null) : null,
      });
      return newIds;
    },

    showOnlyCalendar: (id) => {
      mapViews((v) => ({ ...v, visible: v.id === id }));
      persistUi();
    },

    showAllCalendars: () => {
      mapViews((v) => ({ ...v, visible: true }));
      persistUi();
    },

    setDrag: (d) => set({ drag: d }),

    commitDrag: (scope = "all") => {
      const { drag, data } = get();
      if (!drag) return;
      set({ drag: null });
      const whens: Record<string, When> = { ...drag.group, [drag.id]: drag.when };
      commit(
        applyEdits(
          data.events,
          Object.entries(whens).map(([id, when]) => ({ id, change: { patch: { when } } })),
          scope,
          nowMs(),
        ),
      );
    },

    /** Ends a drag: asks for the scope first when a recurring event moved, keeping the preview on screen. */
    finishDrag: () => {
      const { drag } = get();
      if (!drag) return;
      const ids = [drag.id, ...Object.keys(drag.group ?? {})];
      get().askScope(
        ids,
        "edit",
        (scope) => get().commitDrag(scope),
        () => set({ drag: null }),
      );
    },

    undo: () => {
      const s = get();
      const prev = s.past[s.past.length - 1];
      if (!prev) return;
      setRows(prev, false);
      set({
        past: s.past.slice(0, -1),
        future: [s.rows, ...s.future],
        popoverId: null,
        selectedId: null,
        selectedIds: [],
        anchorId: null,
      });
    },

    redo: () => {
      const s = get();
      const next = s.future[0];
      if (!next) return;
      setRows(next, false);
      set({ past: [...s.past, s.rows], future: s.future.slice(1) });
    },

    showToast: (text, undo, params) => {
      const id = ++toastSeq;
      set({ toast: { id, text, undo, params } });
      setTimeout(() => {
        if (get().toast?.id === id) set({ toast: null });
      }, 5000);
    },

    clearToast: () => set({ toast: null }),

    resetData: () => {
      const s = get();
      if (s.source === "vault") return void get().loadVault();
      const snap = makeSnapshot(s.settings, new Set());
      set({
        ...snap,
        ...derive(snap, s.settings.tz),
        provider: memoryProvider(snap),
        past: [],
        future: [],
        selectedId: null,
        selectedIds: [],
        anchorId: null,
        popoverId: null,
      });
    },

    loadVault: async () => {
      const bridge = vaultBridge();
      if (!bridge) return;
      await serialized(async () => {
        if (get().collections.length === 0) {
          set((s) => ({ vault: { ...s.vault, status: "loading", message: undefined } }));
        }
        try {
          const root = await bridge.getRoot();
          if (root.ok && !root.value) {
            set((st) => ({ vault: { ...st.vault, status: "error", message: "no-root" } }));
            return;
          }
          // Writing is not switched on yet: the vault is shown read-only.
          const r = await readVault(bridge, { readOnly: true });
          applyVault(r, root.ok ? root.value : null);
          watchVault(bridge, r.folders, () => void get().loadVault());
        } catch (e) {
          set((s) => ({
            vault: { ...s.vault, status: "error", message: String((e as Error).message ?? e) },
          }));
        }
      });
    },

    chooseVaultRoot: async () => {
      const bridge = vaultBridge();
      if (!bridge) return false;
      const r = await bridge.chooseRoot();
      if (!r.ok) {
        set((s) => ({ vault: { ...s.vault, status: "error", message: r.message } }));
        return false;
      }
      if (r.value) {
        resetVaultIndex();
        set((s) => ({ vault: { ...s.vault, root: r.value } }));
      }
      return !!r.value;
    },

    setDataSource: async (source) => {
      const bridge = vaultBridge();
      if (source === "vault") {
        if (!bridge) return;
        const root = await bridge.getRoot();
        if (!(root.ok && root.value) && !(await get().chooseVaultRoot())) return;
        get().setSettings({ dataSource: "vault" });
        await get().loadVault();
        return;
      }
      get().setSettings({ dataSource: "sample" });
      stopWatchingVault(bridge);
      const s = get();
      const snap = makeSnapshot(s.settings, new Set());
      set({
        ...snap,
        ...derive(snap, s.settings.tz),
        source: "sample",
        provider: memoryProvider(snap),
        past: [],
        future: [],
        selectedId: null,
        selectedIds: [],
        anchorId: null,
        popoverId: null,
        vault: { ...s.vault, status: "idle" },
      });
    },

    set: (patch) => set(patch),
  };
});

/** Coarse "what is on screen" published by the grid (rounded to whole days). */
export const useVisible = create<{ start: CivilDay; weekStart: CivilDay }>(() => ({
  start: 0,
  weekStart: 0,
}));

export function alignForView(day: CivilDay, view: ViewKind, firstDay: FirstDay): CivilDay {
  if (view === "week") return startOfWeek(day, firstDay);
  if (view === "month") return startOfWeek(startOfMonth(day), firstDay);
  return day;
}

export function visibleDays(view: ViewKind, nDays: number): number {
  return view === "day" ? 1 : view === "week" ? 7 : view === "days" ? nDays : 7;
}
