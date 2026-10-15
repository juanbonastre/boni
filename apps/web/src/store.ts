import {
  addMonths,
  type CalEvent,
  type CalendarData,
  type CalendarDef,
  type CivilDay,
  eventsInDays,
  type FirstDay,
  generateSample,
  type Locale,
  type PropertyDef,
  startOfMonth,
  startOfWeek,
  systemTimeZone,
  todayIn,
  type When,
} from "@boni-calendar/core";
import { create } from "zustand";
import { nowMs } from "./clock.ts";
import { setLocale } from "./i18n.ts";
import { clickSelection, orderedVisibleIds } from "./selection.ts";

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
}

export interface DragState {
  kind: "move" | "resize" | "create";
  id: string;
  when: When;
  /** Other selected events moving together with `id` (kind "move"). */
  group?: Record<string, When>;
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
  past: CalEvent[][];
  future: CalEvent[][];
  toast: Toast | null;
  settingsOpen: boolean;
  paletteOpen: boolean;
  helpOpen: boolean;
  schemaCalendarId: string | null;
  newEventId: string | null;
  ctxMenu: { x: number; y: number; target: CtxTarget } | null;

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
  select: (id: string | null, popover?: boolean) => void;
  clickSelect: (id: string, mods: { ctrl: boolean; shift: boolean }) => void;
  clearSelection: () => void;
  selectAllVisible: () => void;
  setDetailMode: (m: "popover" | "panel") => void;
  addEvent: (e: Partial<CalEvent> & { when: When }) => string;
  updateEvent: (id: string, patch: Partial<CalEvent>) => void;
  updateEvents: (ids: string[], patch: Partial<CalEvent>) => void;
  deleteEvent: (id: string) => void;
  deleteEvents: (ids: string[]) => void;
  duplicateEvent: (id: string) => string | null;
  duplicateEvents: (ids: string[]) => string[];
  showOnlyCalendar: (id: string) => void;
  showAllCalendars: () => void;
  setDrag: (d: DragState | null) => void;
  commitDrag: () => void;
  undo: () => void;
  redo: () => void;
  showToast: (text: string, undo?: boolean, params?: Record<string, string | number>) => void;
  clearToast: () => void;
  resetData: () => void;
  set: (patch: Partial<AppState>) => void;
}

function makeData(settings: Settings, hidden: Set<string>): CalendarData {
  const data = generateSample({ anchorDay: todayIn(settings.tz, nowMs()), tz: settings.tz });
  return {
    ...data,
    calendars: data.calendars.map((c) => (hidden.has(c.id) ? { ...c, visible: false } : c)),
  };
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

  const persistUi = () => {
    const s = get();
    save(UI_KEY, {
      view: s.view,
      nDays: s.nDays,
      sidebarOpen: s.sidebarOpen,
      hiddenCalendars: s.data.calendars.filter((c) => !c.visible).map((c) => c.id),
    } satisfies UiPersist);
  };

  /** Applies an event-list change with undo history. */
  const commit = (next: CalEvent[]) => {
    const s = get();
    set({
      data: { ...s.data, events: next },
      past: [...s.past.slice(-99), s.data.events],
      future: [],
    });
  };

  return {
    data: makeData(settings, hidden),
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

    today: () => todayIn(get().settings.tz, nowMs()),

    setSettings: (patch) => {
      const next = { ...get().settings, ...patch };
      if (patch.locale) setLocale(patch.locale);
      save(SETTINGS_KEY, next);
      set({ settings: next });
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
      set((s) => ({
        data: {
          ...s.data,
          calendars: s.data.calendars.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c)),
        },
      }));
      persistUi();
    },

    updateCalendar: (id, patch) =>
      set((s) => ({
        data: {
          ...s.data,
          calendars: s.data.calendars.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        },
      })),

    setSchema: (id, schema) =>
      set((s) => ({
        data: {
          ...s.data,
          calendars: s.data.calendars.map((c) => (c.id === id ? { ...c, schema } : c)),
        },
      })),

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
      const calOf = new Map(s.data.events.map((e) => [e.id, e.calendarId]));
      const r = clickSelection({
        current: s.selectedIds,
        anchor: s.anchorId,
        clicked: id,
        ordered: orderedVisibleIds(s.data.events, visible, s.settings.tz),
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
      const ids = eventsInDays(s.data.events, visible, from, to, s.settings.tz).map((e) => e.id);
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

    updateEvent: (id, patch) => {
      const s = get();
      commit(s.data.events.map((e) => (e.id === id ? { ...e, ...patch, updated: nowMs() } : e)));
    },

    updateEvents: (ids, patch) => {
      const s = get();
      const set_ = new Set(ids);
      const now = nowMs();
      commit(s.data.events.map((e) => (set_.has(e.id) ? { ...e, ...patch, updated: now } : e)));
    },

    deleteEvent: (id) => get().deleteEvents([id]),

    deleteEvents: (ids) => {
      const s = get();
      const gone = new Set(ids);
      commit(s.data.events.filter((e) => !gone.has(e.id)));
      get().clearSelection();
      if (ids.length === 1) get().showToast("event.deleted", true);
      else get().showToast("events.deleted", true, { n: ids.length });
    },

    duplicateEvent: (id) => get().duplicateEvents([id])[0] ?? null,

    duplicateEvents: (ids) => {
      const s = get();
      const now = nowMs();
      const copies: CalEvent[] = [];
      for (const id of ids) {
        const e = s.data.events.find((x) => x.id === id);
        if (!e) continue;
        copies.push({
          ...e,
          id: `ev-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
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
      set((s) => ({
        data: {
          ...s.data,
          calendars: s.data.calendars.map((c) => ({ ...c, visible: c.id === id })),
        },
      }));
      persistUi();
    },

    showAllCalendars: () => {
      set((s) => ({
        data: { ...s.data, calendars: s.data.calendars.map((c) => ({ ...c, visible: true })) },
      }));
      persistUi();
    },

    setDrag: (d) => set({ drag: d }),

    commitDrag: () => {
      const { drag, data } = get();
      if (!drag) return;
      set({ drag: null });
      const whens: Record<string, When> = { ...drag.group, [drag.id]: drag.when };
      const now = nowMs();
      if (data.events.some((e) => whens[e.id])) {
        commit(
          data.events.map((e) => {
            const when = whens[e.id];
            return when ? { ...e, when, updated: now } : e;
          }),
        );
      }
    },

    undo: () => {
      const s = get();
      const prev = s.past[s.past.length - 1];
      if (!prev) return;
      set({
        data: { ...s.data, events: prev },
        past: s.past.slice(0, -1),
        future: [s.data.events, ...s.future],
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
      set({
        data: { ...s.data, events: next },
        past: [...s.past, s.data.events],
        future: s.future.slice(1),
      });
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
      set({
        data: makeData(s.settings, new Set()),
        past: [],
        future: [],
        selectedId: null,
        selectedIds: [],
        anchorId: null,
        popoverId: null,
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
