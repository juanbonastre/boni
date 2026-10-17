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
  editSeries,
  eventsInDays,
  expandAll,
  extendSeries,
  type FirstDay,
  formatReminderDefaults,
  generateCollectionSample,
  hasReminders,
  inSeries,
  type Locale,
  makeModel,
  makeProjector,
  memoryProvider,
  NO_REMINDERS,
  type OccurrenceCache,
  type Projector,
  type PropertyDef,
  parseOccurrenceId,
  parseReminderDefaults,
  projectsOf,
  type Recurrence,
  type Reminder,
  type ReminderDefaults,
  type Row,
  reconcileRows,
  resolveOccurrence,
  type Scope,
  type SeriesContext,
  setSeriesRule as setSeriesRuleOn,
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
import {
  cachedFeed,
  downloadFeed,
  EXTERNAL_ACCOUNT,
  type ExternalCal,
  type ExternalStatus,
  externalDef,
  forgetFeed,
  isExternalCalendar,
  isExternalEvent,
  newExternalId,
  readFeed,
  saveFeed,
} from "./external.ts";
import { appRoot, getHost } from "./host.ts";
import { setLocale } from "./i18n.ts";
import {
  applyChanges,
  forgetSnapshot,
  login,
  Remote,
  type RemoteChanges,
  RemoteError,
  type RemoteSnapshot,
  savedOutbox,
  savedSnapshot,
  saveOutbox,
  saveSnapshot,
} from "./remote.ts";
import { clickSelection, orderedVisibleIds } from "./selection.ts";
import { ServerWriter } from "./serverWriter.ts";
import { EVENT_REMINDERS_COLUMN, patchCollectionReminders } from "./vault/definitions.ts";
import type { IgnoredNote, VaultLoad } from "./vault/loadVault.ts";
import { makeVaultProvider, VaultWriteError } from "./vault/provider.ts";
import {
  aliases,
  noteOf,
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
  /** Lets the app change the vault's notes. Off until the user turns it on in Settings. */
  vaultWrite: boolean;
  /** Calendars of other services read by their iCal address (kept on this device only). */
  externals: ExternalCal[];
  /** Boni Calendar Server this device uses instead of a vault folder (the session token is kept apart). */
  server: { url: string; user: string } | null;
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

export interface RemoteState {
  /** "login": the session ended (or was revoked) and the device must log in again. */
  status: "off" | "connecting" | "live" | "offline" | "login";
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
  /** The events are a series kept as separate notes (a deletion keeps the past ones). */
  notes?: boolean;
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
/** The session token of this device on the server (device storage, never in settings or the vault). */
export const SERVER_TOKEN_KEY = "boni-calendar:server-token";
/**
 * Preferences shared by all the devices of a server account (phase 4). The theme, the density and the
 * timezone stay per device (a phone and a laptop, a trip).
 */
const ACCOUNT_PREFS = [
  "locale",
  "h24",
  "firstDay",
  "secondTz",
  "weekNumbers",
  "defaultDuration",
  "snap",
] as const satisfies readonly (keyof Settings)[];
/** Device storage: changes to the account made without a connection, still to be sent. */
const ACCOUNT_PENDING_KEY = "boni-calendar:account-pending";
/** Device storage: the server account this device already merged its own calendars with. */
const ACCOUNT_SYNCED_KEY = "boni-calendar:account-synced";
/** Below this width (CSS px) the app uses its phone layout. */
export const COMPACT_WIDTH = 640;
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
  vaultWrite: false,
  externals: [],
  server: null,
};

function load<T>(key: string): Partial<T> {
  try {
    const raw = getHost().storage.get(key);
    return raw ? (JSON.parse(raw) as Partial<T>) : {};
  } catch {
    return {};
  }
}

function save(key: string, value: unknown): void {
  getHost().storage.set(key, JSON.stringify(value));
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
  source: "sample" | "vault" | "server";
  /** The connection to Boni Calendar Server (source "server"). */
  remote: RemoteState;
  /**
   * External calendars (read-only, by iCal address): merged into `data` but never rows, so they are
   * never written anywhere. `events` per calendar, in the order of `settings.externals`.
   */
  external: { byCal: Record<string, CalEvent[]>; status: Record<string, ExternalStatus> };
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
  /** A part of Settings to show when it opens ("external": the external calendars, to add one). */
  settingsFocus: "external" | "reminders" | null;
  paletteOpen: boolean;
  helpOpen: boolean;
  schemaCalendarId: string | null;
  /**
   * The event just created. While it has no title it is a draft: the grid shows only its range, highlighted,
   * and it is dropped (with its undo history) when its detail closes without a title.
   */
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
  /** The app is as narrow as a phone: drawer, bottom sheet, floating button (docs/design-guide.md, mobile). */
  compact: boolean;
  setCompact: (compact: boolean) => void;
  toggleCalendar: (id: string) => void;
  updateCalendar: (id: string, patch: Partial<CalendarDef>) => void;
  setSchema: (id: string, schema: PropertyDef[]) => void;
  /** Which columns a calendar reads (date, times, task...). Ignored when the result would be invalid. */
  setMapping: (id: string, mapping: CalendarMapping) => void;
  /** Whether events of this calendar can be tasks (it maps a task column). */
  supportsTasks: (calendarId: string) => boolean;
  /** Whether events of this calendar can repeat (a recurrence column, or series kept as separate notes). */
  supportsRecurrence: (calendarId: string) => boolean;
  /** Whether repeating an event creates one note per occurrence (the calendar maps a series). */
  supportsSeries: (calendarId: string) => boolean;
  /** Gives an event a repetition rule as separate notes (or ends its series with a null rule). */
  setSeriesRule: (id: string, rule: Recurrence | null) => void;
  /** Creates the notes that open-ended series are missing; the number created. */
  extendSeries: () => number;
  /** The note of an event in the vault, or null (sample data, or not saved yet). */
  noteOfEvent: (id: string) => string | null;
  openNote: (id: string) => Promise<void>;
  select: (id: string | null, popover?: boolean) => void;
  /** A click on an event: selects it (Shift, Ctrl+Shift: several), or with Ctrl alone opens its note. */
  clickSelect: (id: string, mods: { ctrl: boolean; shift: boolean }) => void;
  clearSelection: () => void;
  selectAllVisible: () => void;
  setDetailMode: (m: "popover" | "panel") => void;
  addEvent: (e: Partial<CalEvent> & { when: When }) => string;
  /** Drops a new event that never got a title, as if it had not been made. */
  discardDraft: (id: string) => void;
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
  /** A calendar's default reminders (none when it has none), own or external. */
  remindersOf: (calendarId: string) => ReminderDefaults;
  /** Sets a calendar's default reminders: in its definition (vault or server), or in the account for an external one. */
  setCalendarReminders: (calendarId: string, d: ReminderDefaults) => Promise<void>;
  /** An event's own reminders (`null`: its calendar's). Adds the column for them to the definition if needed. */
  setEventReminders: (id: string, list: Reminder[] | null) => Promise<void>;
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
  /** Asks for the vault folder (desktop app) and reads it; true when one is set. */
  chooseVaultRoot: () => Promise<boolean>;
  /** Logs this device in to a Boni Calendar Server and shows its calendar; throws on a bad login. */
  connectServer: (url: string, user: string, password: string) => Promise<void>;
  /** Leaves the server (ends this device's session) and goes back to the vault folder or the sample. */
  disconnectServer: () => Promise<void>;
  /** Shows the server's calendar (the last copy first) and follows its changes live. */
  loadServer: () => Promise<void>;
  /** Downloads external calendars again (all, or one), showing the last copy until it arrives. */
  loadExternal: (id?: string) => Promise<void>;
  addExternal: (c: Omit<ExternalCal, "id">) => string;
  updateExternal: (id: string, patch: Partial<Omit<ExternalCal, "id">>) => void;
  removeExternal: (id: string) => void;
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

type ExternalSlice = AppState["external"];

/**
 * `data` with the external calendars added (after the vault's or the sample's own). Idempotent:
 * whatever external data `own` already had is replaced.
 */
function withExternal(
  own: CalendarData,
  ext: ExternalSlice,
  externals: readonly ExternalCal[],
  hidden: (id: string) => boolean,
): CalendarData {
  const cals = own.calendars.filter((c) => !isExternalCalendar(c.id));
  const accounts = own.accounts.filter((a) => a.id !== EXTERNAL_ACCOUNT);
  const ownEvents = own.events.some(isExternalEvent)
    ? own.events.filter((e) => !isExternalEvent(e))
    : own.events;
  const extEvents = externals.flatMap((c) => ext.byCal[c.id] ?? []);
  if (externals.length === 0) {
    return cals.length === own.calendars.length && ownEvents === own.events
      ? own
      : { ...own, accounts, calendars: cals, events: ownEvents };
  }
  return {
    ...own,
    accounts: [...accounts, { id: EXTERNAL_ACCOUNT, name: "", email: "" }],
    calendars: [...cals, ...externals.map((c) => externalDef(c, !hidden(c.id)))],
    events: extEvents.length ? [...ownEvents, ...extEvents] : ownEvents,
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
  today: CivilDay,
): CalEvent[] {
  let out = events;
  const ctx: SeriesContext = { newId: () => newEventId(now), now, today };
  for (const it of items) {
    // A note of a series kept as separate notes is a plain event with a `series`; anything else may be an occurrence.
    out = out.find((e) => e.id === it.id)?.series
      ? editSeries(out, it.id, scope, it.change, ctx)
      : editOccurrence(out, it.id, scope, it.change, ctx);
  }
  return out;
}

const newSeriesId = (now: number): string =>
  `s-${Math.floor(now).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

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
/** Length of the undo history when the current new event was made (a discarded draft goes back to it). */
let draftMark = 0;

/** The live connection to the server (one per app). `snap` holds the server's rows as it sent them. */
const server: {
  version: number;
  snap: RemoteSnapshot | null;
  stop: (() => void) | null;
  saveTimer: ReturnType<typeof setTimeout> | undefined;
  remote: Remote | null;
  writer: ServerWriter | null;
} = { version: 0, snap: null, stop: null, saveTimer: undefined, remote: null, writer: null };
function stopFollowing() {
  server.stop?.();
  server.stop = null;
  server.snap = null;
  server.version = 0;
  server.remote = null;
  server.writer = null;
}
const serverKey = (c: { url: string; user: string }) => `${c.url}|${c.user}`;
/** One writer for the whole session, so notes it sent to the trash can still be brought back by Undo. */
let vaultProvider: CollectionProvider | null = null;
function vaultWriter(bridge: Parameters<typeof makeVaultProvider>[0]): CollectionProvider {
  vaultProvider = vaultProvider ?? makeVaultProvider(bridge);
  return vaultProvider;
}

export const useApp = create<AppState>((set, get) => {
  const urlTz =
    typeof location === "undefined" ? null : new URLSearchParams(location.search).get("tz");
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...getHost().settings,
    ...load<Settings>(SETTINGS_KEY),
    ...(urlTz ? { tz: urlTz } : {}),
  };
  const ui = load<UiPersist>(UI_KEY);
  const narrowAtStart = (appRoot()?.clientWidth ?? 1024) < COMPACT_WIDTH;
  const hidden = new Set(ui.hiddenCalendars ?? []);
  setLocale(settings.locale);
  // With the vault as the source the first picture is empty (no flash of sample data) until it loads.
  // With a vault (desktop app, Obsidian) the calendars are its notes; invented sample data only
  // in a plain browser (development, tests).
  const wantVault = !!vaultBridge();
  // A device logged in to a server shows the server's calendar (the last copy until it connects).
  const wantServer = !!settings.server && !!getHost().storage.get(SERVER_TOKEN_KEY);
  const snapshot: CollectionSnapshot =
    wantVault || wantServer
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

  /** `own` (the vault's or the sample's data) with the external calendars as they are now. */
  const merge = (own: CalendarData): CalendarData => {
    const s = get();
    const hidden = new Set(load<UiPersist>(UI_KEY).hiddenCalendars ?? []);
    const shown = new Map(s.data.calendars.map((c) => [c.id, c.visible]));
    return withExternal(own, s.external, s.settings.externals, (id) =>
      shown.has(id) ? !shown.get(id) : hidden.has(id),
    );
  };
  /** Only the vault's or the sample's events: what rows are made of. */
  const own = (events: readonly CalEvent[]): CalEvent[] =>
    events.filter((e) => !isExternalEvent(e));

  /** Stores new rows (and tells the provider what changed). `history: false` for undo and redo. */
  const setRows = (rows: Row[], history = true) => {
    const s = get();
    set({
      rows,
      data: merge({ ...s.data, events: s.projector.project(rows) }),
      ...(history ? { past: [...s.past.slice(-99), s.rows], future: [] } : {}),
    });
    void s.provider.apply(diffRows(s.rows, rows)).catch(writeFailed);
  };

  /** A write to the vault did not happen: say so and show what the notes really say. */
  const writeFailed = (e: unknown) => {
    console.error("vault write failed", e);
    const conflict = e instanceof VaultWriteError && e.kind === "conflict";
    get().showToast(conflict ? "vault.conflict" : "vault.saveFailed");
    void get().loadVault();
  };

  /** Applies an edited event list as row changes, with undo history. */
  const commit = (next: CalEvent[]) => {
    const s = get();
    setRows(reconcileRows(s.projector.model, s.rows, own(s.data.events), own(next)));
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
      data: merge(
        keep ? { ...s.data, calendars: d.data.calendars, accounts: next.accounts } : d.data,
      ),
    });
  };

  /**
   * Shows what a read of the vault found. When nothing that matters changed this only refreshes the
   * counts; otherwise unchanged notes keep their row (and event) objects, a calendar keeps being
   * visible or hidden as the user left it, and a selection survives if its event still exists.
   */
  const applyLoad = (
    r: Pick<VaultLoad, "snapshot" | "notes" | "ignored" | "problems">,
    root: string | null,
    source: "vault" | "server",
    provider: () => CollectionProvider,
  ) => {
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
      s.source === source &&
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
    d.data = merge(d.data);
    const ids = new Set(d.data.events.map((e) => e.id));
    // A new event is first known by a temporary id; once its note exists the row carries the path.
    const now = (id: string) => (ids.has(id) ? id : (aliases.get(id) ?? id));
    const selectedIds = s.selectedIds.map(now).filter((id) => ids.has(id));
    set({
      ...snap,
      ...d,
      source,
      provider: provider(),
      ...(s.source === source ? {} : { past: [], future: [] }),
      selectedIds,
      selectedId: selectedIds.length === 1 ? (selectedIds[0] ?? null) : null,
      anchorId: s.anchorId && ids.has(now(s.anchorId)) ? now(s.anchorId) : null,
      popoverId: s.popoverId && ids.has(now(s.popoverId)) ? now(s.popoverId) : null,
      newEventId: s.newEventId ? now(s.newEventId) : null,
      vault,
    });
  };

  const mapViews = (fn: (v: CalendarView) => CalendarView) =>
    setDefinitions({ views: get().views.map(fn) });

  /** Shows or hides external calendars (they are not views: their visibility lives in `data`). */
  const mapExternalVisible = (fn: (c: CalendarDef) => boolean) => {
    const s = get();
    if (!s.data.calendars.some((c) => isExternalCalendar(c.id))) return;
    set({
      data: {
        ...s.data,
        calendars: s.data.calendars.map((c) =>
          isExternalCalendar(c.id) ? { ...c, visible: fn(c) } : c,
        ),
      },
    });
  };

  /** Replaces the external slice and what `data` shows of it. */
  const setExternal = (patch: Partial<ExternalSlice>) => {
    set((s) => ({ external: { ...s.external, ...patch } }));
    set((s) => ({ data: merge(s.data) }));
  };

  /** Writes a calendar's reminders where its definition lives: the vault folder or the server. */
  const persistReminders = async (
    collectionId: string,
    edit: { reminders?: { timed: string; allDay: string } | null; eventColumn?: boolean },
  ) => {
    const s = get();
    try {
      if (s.source === "server") {
        await server.remote?.setCollectionReminders(collectionId, edit);
      } else if (s.source === "vault") {
        const bridge = vaultBridge();
        if (bridge) await patchCollectionReminders(bridge, collectionId, edit);
      }
    } catch (e) {
      writeFailed(e);
    }
  };

  // ---- The server account (phase 4): preferences and external calendars shared by its devices ----
  type Pending = { prefs?: boolean; externals?: boolean };
  const pending = (): Pending => load<Pending>(ACCOUNT_PENDING_KEY);
  const setPending = (p: Pending) => save(ACCOUNT_PENDING_KEY, p);
  const accountPrefs = (st: Settings) =>
    Object.fromEntries(ACCOUNT_PREFS.map((k) => [k, st[k]])) as Record<
      string,
      string | number | boolean | null
    >;
  /** Settings changed because the account changed: not sent back. */
  let applyingAccount = false;
  /** The last sending of the external calendars (a new one is downloaded by the server after it). */
  let externalsSent: Promise<void> = Promise.resolve();
  let prefsTimer: ReturnType<typeof setTimeout> | undefined;

  /** Sends prefs or calendars to the account now, or marks them to be sent when there is a connection. */
  const pushAccount = (what: "prefs" | "externals"): Promise<void> => {
    if (get().source !== "server") return Promise.resolve();
    setPending({ ...pending(), [what]: true });
    const remote = server.remote;
    if (!remote) return Promise.resolve();
    const st = get().settings;
    const sent =
      what === "prefs" ? remote.putPrefs(accountPrefs(st)) : remote.putExternals(st.externals);
    return sent.then(
      () => setPending({ ...pending(), [what]: false }),
      (e) => console.warn("account not saved yet", e),
    );
  };

  /** Shows what the account has: its preferences and its calendars (downloading new or changed ones). */
  const applyAccount = (prefs: Record<string, unknown>, externals: ExternalCal[]) => {
    const st = get().settings;
    const patch: Partial<Settings> = {};
    for (const k of ACCOUNT_PREFS) {
      const v = prefs[k];
      const cur = st[k];
      if (v === undefined || v === cur) continue;
      if (cur === null || v === null || typeof v === typeof cur)
        (patch as Record<string, unknown>)[k] = v;
    }
    const before = new Map(st.externals.map((c) => [c.id, c]));
    if (JSON.stringify(externals) !== JSON.stringify(st.externals)) patch.externals = externals;
    if (Object.keys(patch).length === 0) return;
    applyingAccount = true;
    try {
      get().setSettings(patch);
    } finally {
      applyingAccount = false;
    }
    if (!patch.externals) return;
    const ids = new Set(externals.map((c) => c.id));
    const { byCal, status } = get().external;
    setExternal({
      byCal: Object.fromEntries(Object.entries(byCal).filter(([id]) => ids.has(id))),
      status: Object.fromEntries(Object.entries(status).filter(([id]) => ids.has(id))),
    });
    for (const c of externals) {
      const was = before.get(c.id);
      if (!was || was.url !== c.url) void get().loadExternal(c.id);
    }
  };

  /**
   * Brings the account and this device together. The first time this device meets the account, its own
   * calendars join the account's (and an account that never stored anything takes this device's
   * preferences); afterwards the account wins, except for changes this device made offline.
   */
  const syncAccount = async (remote: Remote, key: string) => {
    const acc = await remote.account();
    const storage = getHost().storage;
    if (storage.get(ACCOUNT_SYNCED_KEY) !== key || acc.updated === 0) {
      const known = new Set(acc.externals.map((c) => c.url));
      const ids = new Set(acc.externals.map((c) => c.id));
      const mine = get().settings.externals.filter((c) => !known.has(c.url));
      const merged = [
        ...acc.externals,
        ...mine.map((c) => (ids.has(c.id) ? { ...c, id: newExternalId() } : c)),
      ];
      applyAccount(acc.updated === 0 ? accountPrefs(get().settings) : acc.prefs, merged);
      if (mine.length > 0) await remote.putExternals(merged);
      if (acc.updated === 0) await remote.putPrefs(accountPrefs(get().settings));
      if (mine.length > 0) get().showToast("external.joined", false, { n: mine.length });
      storage.set(ACCOUNT_SYNCED_KEY, key);
      setPending({});
      return;
    }
    const p = pending();
    applyAccount(
      p.prefs ? accountPrefs(get().settings) : acc.prefs,
      p.externals ? get().settings.externals : acc.externals,
    );
    if (p.prefs) await pushAccount("prefs");
    if (p.externals) await pushAccount("externals");
  };

  return {
    ...snapshot,
    ...derive(snapshot, settings.tz),
    source: wantServer ? "server" : wantVault ? "vault" : "sample",
    remote: { status: wantServer ? "connecting" : "off" },
    vault: {
      status: wantVault || wantServer ? "loading" : "idle",
      root: null,
      notes: 0,
      ignored: [],
      problems: [],
    },
    provider: memoryProvider(snapshot),
    external: { byCal: {}, status: {} },
    settings,
    // A phone starts on three days, with the sidebar (a drawer there) closed.
    view: ui.view ?? (narrowAtStart ? "days" : "week"),
    nDays: ui.nDays ?? (narrowAtStart ? 3 : 7),
    sidebarOpen: narrowAtStart ? false : (ui.sidebarOpen ?? true),
    compact: narrowAtStart,
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
    settingsFocus: null,
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
      // With a server, what the account shares goes to it (the calendars at once, preferences shortly).
      if (!applyingAccount && get().source === "server") {
        if (patch.externals) externalsSent = pushAccount("externals");
        if (ACCOUNT_PREFS.some((k) => k in patch)) {
          clearTimeout(prefsTimer);
          prefsTimer = setTimeout(() => void pushAccount("prefs"), 400);
        }
      }
      // Rows without their own timezone follow the app's.
      if (patch.tz !== undefined) setDefinitions({ collections: [...get().collections] });
      // Turning writing on or off changes which calendars are read-only.
      if (patch.vaultWrite !== undefined && get().source === "vault") void get().loadVault();
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

    setCompact: (compact) => {
      if (compact === get().compact) return;
      // The drawer starts closed whenever the app turns narrow.
      set(compact ? { compact, sidebarOpen: false } : { compact });
    },

    toggleSidebar: () => {
      set((s) => ({ sidebarOpen: !s.sidebarOpen }));
      persistUi();
    },

    toggleCalendar: (id) => {
      if (isExternalCalendar(id)) mapExternalVisible((c) => (c.id === id ? !c.visible : c.visible));
      else mapViews((v) => (v.id === id ? { ...v, visible: !v.visible } : v));
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

    supportsRecurrence: (calendarId) => {
      const m = get().views.find((v) => v.id === calendarId)?.mapping;
      return !!m && !!(m.recurrence || m.series);
    },

    supportsSeries: (calendarId) => !!get().views.find((v) => v.id === calendarId)?.mapping.series,

    setSeriesRule: (id, rule) => {
      const s = get();
      const now = nowMs();
      commit(
        setSeriesRuleOn(s.data.events, id, rule, newSeriesId(now), {
          newId: () => newEventId(now),
          now,
          today: s.today(),
        }),
      );
    },

    extendSeries: () => {
      const s = get();
      const now = nowMs();
      const more = extendSeries(s.data.events, {
        newId: () => newEventId(now),
        now,
        today: s.today(),
      });
      if (more.length === 0) return 0;
      // Upkeep, not an edit of the user: no undo step.
      setRows(
        reconcileRows(s.projector.model, s.rows, own(s.data.events), [
          ...own(s.data.events),
          ...more,
        ]),
        false,
      );
      return more.length;
    },

    noteOfEvent: (id) => (get().source === "vault" ? noteOf(id) : null),

    openNote: async (id) => {
      const path = get().noteOfEvent(id);
      const r = path ? await vaultBridge()?.openNote?.(path) : null;
      if (r && !r.ok) get().showToast("vault.openFailed");
    },

    select: (id, popover = true) =>
      set({
        selectedId: id,
        selectedIds: id ? [id] : [],
        anchorId: id,
        // Moving or resizing a new event keeps its detail open (closing it would drop the draft).
        popoverId: popover || (id !== null && id === get().newEventId) ? id : null,
      }),

    clearSelection: () =>
      set({ selectedId: null, selectedIds: [], anchorId: null, popoverId: null, newEventId: null }),

    clickSelect: (id, mods) => {
      const s = get();
      // Ctrl+click opens the event's note (like a link in Obsidian); an event without one is just selected.
      if (mods.ctrl && !mods.shift && s.noteOfEvent(id)) return void s.openNote(id);
      const visible = new Set(s.data.calendars.filter((c) => c.visible).map((c) => c.id));
      const r = clickSelection({
        current: s.selectedIds,
        anchor: s.anchorId,
        clicked: id,
        ordered: orderedVisibleIds(s.expanded(), visible, s.settings.tz),
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
      draftMark = s.past.length;
      commit([...s.data.events, ev]);
      set({ selectedId: id, selectedIds: [id], anchorId: id, popoverId: id, newEventId: id });
      return id;
    },

    discardDraft: (id) => {
      const s = get();
      const ev = s.data.events.find((e) => e.id === id);
      if (!ev || ev.title) return;
      setRows(
        s.rows.filter((r) => r.id !== id),
        false,
      );
      set({
        past: s.past.slice(0, Math.min(draftMark, s.past.length)),
        future: [],
        ...(s.newEventId === id ? { newEventId: null } : {}),
      });
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

    updateEvents: (all, patch, scope = "all") => {
      // Read-only calendars (subscriptions) are never edited, whatever the selection holds.
      const ids = all.filter((id) => !get().isLocked(id));
      if (ids.length === 0) return;
      const now = nowMs();
      commit(
        applyEdits(
          get().data.events,
          ids.map((id) => ({ id, change: { patch } })),
          scope,
          now,
          get().today(),
        ),
      );
    },

    remindersOf: (calendarId) => {
      if (isExternalCalendar(calendarId)) {
        const c = get().settings.externals.find((x) => x.id === calendarId);
        return parseReminderDefaults(c?.reminders);
      }
      return get().views.find((v) => v.id === calendarId)?.reminders ?? NO_REMINDERS;
    },

    setCalendarReminders: async (calendarId, d) => {
      if (isExternalCalendar(calendarId)) {
        get().updateExternal(calendarId, { reminders: formatReminderDefaults(d) });
        return;
      }
      const s = get();
      const view = s.views.find((v) => v.id === calendarId);
      if (!view || view.readOnly) return;
      const { reminders: _old, ...rest } = view;
      setDefinitions({
        views: s.views.map((v) =>
          v.id === calendarId ? { ...rest, ...(hasReminders(d) ? { reminders: d } : {}) } : v,
        ),
      });
      await persistReminders(view.collectionId, {
        reminders: hasReminders(d) ? formatReminderDefaults(d) : null,
      });
    },

    setEventReminders: async (id, list) => {
      const s = get();
      const ev = s.data.events.find((e) => e.id === (id.includes("~") ? id.split("~")[0] : id));
      const view = ev && s.views.find((v) => v.id === ev.calendarId);
      if (!ev || !view || view.readOnly) return;
      if (!view.mapping.reminders) {
        // The first event with reminders of its own: its calendar gets the column for them.
        const col = EVENT_REMINDERS_COLUMN;
        setDefinitions({
          collections: s.collections.map((c) =>
            c.id === view.collectionId && !c.columns.some((x) => x.id === col.id)
              ? {
                  ...c,
                  columns: [...c.columns, { id: col.id, name: col.name, type: "text" as const }],
                }
              : c,
          ),
          views: s.views.map((v) =>
            v.id === view.id ? { ...v, mapping: { ...v.mapping, reminders: col.id } } : v,
          ),
        });
        await persistReminders(view.collectionId, { eventColumn: true });
      }
      get().editEvents([id], { reminders: list });
    },

    editEvents: (ids, patch) => {
      const first = ids[0] ? get().getEvent(ids[0]) : null;
      // A series kept as notes: the rule is handled by creating or replacing the later notes.
      if (
        "recurrence" in patch &&
        first &&
        ids.length === 1 &&
        get().supportsSeries(first.calendarId)
      ) {
        return get().setSeriesRule(first.id, patch.recurrence ?? null);
      }
      // Changing the repetition rule itself always applies to the whole series.
      if ("recurrence" in patch) return get().updateEvents(ids, patch, "all");
      get().askScope(ids, "edit", (scope) => get().updateEvents(ids, patch, scope));
    },

    deleteEvent: (id) => get().removeEvents([id]),

    deleteEvents: (all, scope = "all") => {
      const ids = all.filter((id) => !get().isLocked(id));
      if (ids.length === 0) return;
      const now = nowMs();
      commit(
        applyEdits(
          get().data.events,
          ids.map((id) => ({ id, change: { remove: true } })),
          scope,
          now,
          get().today(),
        ),
      );
      get().clearSelection();
      if (ids.length === 1) get().showToast("event.deleted", true);
      else get().showToast("events.deleted", true, { n: ids.length });
    },

    removeEvents: (all) => {
      // Read-only calendars (subscriptions) keep their events: nothing to ask about them.
      const ids = all.filter((id) => !get().isLocked(id));
      if (ids.length === 0) return get().showToast("ctx.readOnly");
      get().askScope(ids, "delete", (scope) => get().deleteEvents(ids, scope));
    },

    setScopePrompt: (p) => set({ scopePrompt: p }),

    askScope: (ids, kind, run, onCancel) => {
      const events = get().data.events;
      const notes = ids.some((id) => inSeries(events, id));
      const recurring = ids.some((id) => {
        const p = parseOccurrenceId(id);
        return !!p && events.some((e) => e.id === p.seriesId && e.recurrence);
      });
      if (!recurring && !notes) return run("all");
      set({
        scopePrompt: {
          kind,
          notes,
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
        const { seriesId: _a, occurrenceDay: _b, exdates: _c, series: _d, ...rest } = e;
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
      mapExternalVisible((c) => c.id === id);
      persistUi();
    },

    showAllCalendars: () => {
      mapViews((v) => ({ ...v, visible: true }));
      mapExternalVisible(() => true);
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
          get().today(),
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
      const d = derive(snap, s.settings.tz);
      set({
        ...snap,
        ...d,
        data: merge(d.data),
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
          const r = await readVault(bridge, { readOnly: !get().settings.vaultWrite });
          applyLoad(r, root.ok ? root.value : null, "vault", () => vaultWriter(bridge));
          watchVault(bridge, r.folders, () => void get().loadVault());
          // Series kept as notes keep going as time passes (only when writing is on).
          if (get().settings.vaultWrite) {
            const n = get().extendSeries();
            if (n > 0) get().showToast("vault.seriesExtended", false, { n });
          }
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
        await get().loadVault();
      }
      return !!r.value;
    },

    connectServer: async (url, user, password) => {
      const device = navigator.userAgent.includes("Android")
        ? "Android"
        : vaultBridge()
          ? "Escritorio"
          : "Navegador";
      const token = await login(url, user, password, device);
      getHost().storage.set(SERVER_TOKEN_KEY, token);
      stopFollowing();
      stopWatchingVault(vaultBridge());
      get().setSettings({ server: { url: url.trim().replace(/\/+$/, ""), user } });
      set({ remote: { status: "connecting" } });
      await get().loadServer();
    },

    disconnectServer: async () => {
      const cfg = get().settings.server;
      const token = getHost().storage.get(SERVER_TOKEN_KEY);
      // What is still queued is sent first if it can be (otherwise it waits for the next login).
      await server.writer?.flush();
      stopFollowing();
      if (cfg && token) {
        await new Remote(cfg.url, token).logout();
        void forgetSnapshot(serverKey(cfg));
      }
      getHost().storage.set(SERVER_TOKEN_KEY, "");
      get().setSettings({ server: null });
      set({ remote: { status: "off" } });
      // Back to the vault folder (desktop, Android) or to the sample (a plain browser).
      if (vaultBridge()) {
        set({ source: "vault", collections: [], views: [], rows: [] });
        await get().loadVault();
      } else {
        set({ source: "sample" });
        get().resetData();
      }
    },

    loadServer: async () => {
      const cfg = get().settings.server;
      const token = getHost().storage.get(SERVER_TOKEN_KEY);
      if (!cfg || !token) return;
      const remote = new Remote(cfg.url, token);
      const key = serverKey(cfg);
      const label = `${cfg.user} · ${remote.url}`;
      // Changes go through the server (when it lets this account write: otherwise its calendars come
      // read-only); what was not sent yet is kept on the device and shown on top of the server's rows.
      const writer = new ServerWriter(
        {
          remote: () => server.remote,
          version: () => server.version,
          save: (o) => saveOutbox(key, o),
          sent: () => server.snap && show(server.snap),
          rejected: (why, e) => {
            console.error("server write failed", e);
            get().showToast(why === "conflict" ? "vault.conflict" : "vault.saveFailed");
            void remote.snapshot().then(reload).catch(fail);
          },
        },
        await savedOutbox(key),
      );
      server.remote = remote;
      server.writer = writer;
      const show = (snap: RemoteSnapshot) => {
        if (server.writer !== writer) return; // logged out or connected again meanwhile
        server.version = snap.version;
        server.snap = snap;
        const rows = writer.over(snap.rows, snap.version);
        applyLoad(
          {
            snapshot: { ...snap, rows },
            notes: snap.rows.length,
            ignored: snap.ignored,
            problems: snap.problems,
          },
          label,
          "server",
          () => writer,
        );
      };
      const reload = (snap: RemoteSnapshot) => {
        show(snap);
        void saveSnapshot(key, snap);
      };
      const fail = (e: unknown) => {
        if (e instanceof RemoteError && e.kind === "unauthorized") {
          stopFollowing();
          set({ remote: { status: "login" } });
        } else {
          set({
            remote: { status: "offline", message: e instanceof Error ? e.message : String(e) },
          });
        }
      };
      // The last copy first: the calendar opens at once, also without a connection.
      if (get().source !== "server" || get().rows.length === 0) {
        const cached = await savedSnapshot(key);
        if (cached) show(cached);
      }
      try {
        reload(await remote.snapshot());
        void writer.flush();
        // Then the account's calendars, downloaded by the server (the app's start could not yet).
        void syncAccount(remote, key)
          .catch((e) => console.warn("account", e))
          .then(() => get().loadExternal());
      } catch (e) {
        fail(e);
        if (e instanceof RemoteError && e.kind === "unauthorized") return;
      }
      if (server.stop) return;
      /** New rows, or a new snapshot when the server says so (definitions changed, too far behind). */
      const apply = async (c: RemoteChanges) => {
        if (c.version <= server.version) return;
        if (c.full || !server.snap) return reload(await remote.snapshot());
        const snap: RemoteSnapshot = {
          ...server.snap,
          version: c.version,
          rows: applyChanges(server.snap.rows, c),
        };
        show(snap);
        clearTimeout(server.saveTimer);
        server.saveTimer = setTimeout(() => void saveSnapshot(key, snap), 2000);
      };
      let behind = false;
      server.stop = remote.follow(
        (c) => {
          // A version skipped (the connection dropped between two) is caught up from the log.
          if (c.version > server.version + 1 && !c.full) {
            void remote.changes(server.version).then(apply).catch(fail);
          } else void apply(c).catch(fail);
        },
        (live, error) => {
          if (error?.kind === "unauthorized") return fail(error);
          if (live) {
            set({ remote: { status: "live" } });
            void writer.flush();
            if (behind) {
              void remote.changes(server.version).then(apply).catch(fail);
              void syncAccount(remote, key).catch((e) => console.warn("account", e));
            }
            behind = false;
          } else {
            behind = true;
            set({ remote: { status: "offline", message: error?.message } });
          }
        },
        // The account changed on another device: its calendars or preferences.
        () => void syncAccount(remote, key).catch((e) => console.warn("account", e)),
      );
    },

    loadExternal: async (only) => {
      const list = get().settings.externals.filter((c) => !only || c.id === only);
      await Promise.all(
        list.map(async (c) => {
          const tz = get().settings.tz;
          const status = (st: ExternalStatus) =>
            setExternal({ status: { ...get().external.status, [c.id]: st } });
          const show = (text: string, at: number) => {
            const r = readFeed(c, text, tz);
            setExternal({ byCal: { ...get().external.byCal, [c.id]: r.events } });
            return {
              state: "ok" as const,
              at,
              events: r.events.length,
              unsupported: r.unsupported,
            };
          };
          // The last copy first (instant, and works offline), then the network.
          let shown: ExternalStatus | null = null;
          if (!get().external.byCal[c.id]) {
            const cached = await cachedFeed(c.id);
            if (cached) {
              try {
                shown = show(cached.text, cached.at);
              } catch {
                shown = null;
              }
            }
          }
          // With a server it downloads the calendar (the device only talks to it); without a connection
          // to it, the last copy stays.
          const viaServer = get().source === "server";
          if (viaServer && !server.remote) return;
          status({ ...(shown ?? get().external.status[c.id] ?? {}), state: "loading" });
          try {
            let text: string;
            let at = nowMs();
            if (viaServer && server.remote) {
              await externalsSent;
              const r = await server.remote.feed(c.id, !!only);
              text = r.text;
              at = r.at;
            } else text = await downloadFeed(c.url);
            // The calendar may have been removed or changed meanwhile.
            const now = get().settings.externals.find((x) => x.id === c.id);
            if (!now || now.url !== c.url) return;
            status(show(text, at));
            void saveFeed(c.id, text, at);
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            const prev = shown ?? get().external.status[c.id];
            status({ ...prev, state: "error", message });
          }
        }),
      );
    },

    addExternal: (c) => {
      const id = newExternalId();
      get().setSettings({ externals: [...get().settings.externals, { ...c, id }] });
      setExternal({});
      void get().loadExternal(id);
      return id;
    },

    updateExternal: (id, patch) => {
      const s = get();
      const before = s.settings.externals.find((c) => c.id === id);
      if (!before) return;
      s.setSettings({
        externals: s.settings.externals.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      });
      if (patch.url !== undefined && patch.url !== before.url) {
        const { [id]: _drop, ...byCal } = get().external.byCal;
        setExternal({ byCal });
        void forgetFeed(id);
        void get().loadExternal(id);
      } else setExternal({});
    },

    removeExternal: (id) => {
      const s = get();
      s.setSettings({ externals: s.settings.externals.filter((c) => c.id !== id) });
      const { [id]: _a, ...byCal } = get().external.byCal;
      const { [id]: _b, ...status } = get().external.status;
      setExternal({ byCal, status });
      void forgetFeed(id);
    },

    set: (patch) => set(patch),
  };
});

/**
 * A new event without a title goes away when its detail closes (Escape, a click elsewhere, the close button,
 * another selection) or when its title is left empty: it never was more than a highlighted range.
 */
useApp.subscribe((s, prev) => {
  const id = prev.newEventId;
  if (!id) return;
  const open = (st: AppState) =>
    st.popoverId === id || (st.detailMode === "panel" && st.selectedId === id);
  if (s.newEventId === id && (open(s) || !open(prev))) return;
  const ev = s.data.events.find((e) => e.id === id);
  if (ev && !ev.title) s.discardDraft(id);
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
