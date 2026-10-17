import { fromLocal, toLocal } from "@boni-calendar/core";
import { Plus } from "lucide-react";
import { useEffect } from "react";
import { nowMs } from "./clock.ts";
import { ContextMenu, useContextMenuTrigger } from "./components/ContextMenu.tsx";
import { EventDetail } from "./components/EventDetail.tsx";
import { HelpModal, Palette, SchemaEditor, SettingsModal } from "./components/Modals.tsx";
import { MonthView } from "./components/MonthView.tsx";
import { ScopeModal } from "./components/RecurrenceModals.tsx";
import { SelectionBar } from "./components/SelectionBar.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { TimeGrid } from "./components/TimeGrid.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { appRoot, eventTarget, getHost, onKeys, releaseFocus } from "./host.ts";
import { t } from "./i18n.ts";
import { noticesFor } from "./notifications.ts";
import { COMPACT_WIDTH, SERVER_TOKEN_KEY, useApp } from "./store.ts";

function useTheme() {
  const theme = useApp((s) => s.settings.theme);
  const density = useApp((s) => s.settings.density);
  useEffect(() => {
    const root = appRoot() ?? document.documentElement;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      root.dataset.theme = dark ? "dark" : "light";
      root.dataset.density = density;
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme, density]);
}

function isTyping(e: KeyboardEvent): boolean {
  const el = eventTarget(e);
  return (
    !!el &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT" ||
      el.isContentEditable)
  );
}

/**
 * While Ctrl, Shift or Meta is held the popover lets clicks through, so events under it can be
 * added to a selection. Not while typing: Shift for a capital letter must not fade the popover.
 */
function useModifierClass() {
  useEffect(() => {
    const sync = (e: KeyboardEvent) =>
      appRoot()?.classList.toggle(
        "mod-select",
        (e.ctrlKey || e.shiftKey || e.metaKey) && !isTyping(e),
      );
    const clear = () => appRoot()?.classList.remove("mod-select");
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", clear);
    };
  }, []);
}

/**
 * Clicking anywhere outside the detail popover (and the events that open it) closes it. First, a press
 * outside the detail saves what is being typed in it: its fields save when they lose the focus, and the
 * press could close the detail (or select something else, or drop a new event as an untitled draft)
 * before that happens, and the text would be lost.
 */
function useClickAway() {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = eventTarget(e);
      const active = ((appRoot()?.getRootNode() ?? document) as Document | ShadowRoot)
        ?.activeElement as HTMLElement | null | undefined;
      if (active?.closest(".detail") && !el?.closest(".detail")) active.blur();
      const s = useApp.getState();
      if (!s.popoverId) return;
      if (el?.closest(".popover, .menu, .ev, .bar, .mchip, .scrim, .toast")) return;
      s.set({ popoverId: null });
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, []);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useApp.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        s.set({ paletteOpen: true });
        return;
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        s.set({ settingsOpen: true });
        return;
      }
      if (mod && !e.altKey && e.key.toLowerCase() === "z" && !isTyping(e)) {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y" && !isTyping(e)) {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === "a" && !isTyping(e)) {
        e.preventDefault();
        s.selectAllVisible();
        return;
      }
      if (e.key === "Escape") {
        // Sharing the window, Esc in the calendar is the calendar's (the other app must not act on it too).
        if (getHost().keys === "root") e.preventDefault();
        if (s.paletteOpen || s.settingsOpen || s.helpOpen || s.schemaCalendarId || s.scopePrompt)
          return; // modals handle it
        if (s.popoverId || s.selectedId || s.selectedIds.length > 0) {
          s.clearSelection();
          releaseFocus();
        }
        return;
      }
      if (isTyping(e) || mod || e.altKey) return;
      if (s.paletteOpen || s.settingsOpen || s.helpOpen || s.schemaCalendarId || s.scopePrompt)
        return;
      const k = e.key;
      if (k === "t" || k === "T") s.goToday();
      else if (k === "d" || k === "D") s.setView("day");
      else if (k === "w" || k === "W") s.setView("week");
      else if (k === "m" || k === "M") s.setView("month");
      else if (k === "1") s.setView("day");
      else if (/^[2-9]$/.test(k)) s.setView("days", Number(k));
      else if (k === "ArrowLeft" || k === "j" || k === "J") s.step(-1);
      else if (k === "ArrowRight" || k === "k" || k === "K") s.step(1);
      else if (k === "n" || k === "N") {
        e.preventDefault();
        s.set({ paletteOpen: true });
      } else if (k === "/") {
        e.preventDefault();
        s.set({ paletteOpen: true });
      } else if (k === "?") s.set({ helpOpen: true });
      else if (k === "[") s.toggleSidebar();
      else if ((k === "Delete" || k === "Backspace") && s.selectedIds.length > 0) {
        e.preventDefault();
        s.removeEvents(s.selectedIds);
      } else return;
    };
    return onKeys(onKey);
  }, []);
}

/**
 * When the app shares the window, a press inside it moves the focus into it (unless the press already
 * focused something of ours), so its shortcuts work and keys typed elsewhere never reach them.
 */
function useFocusOnPress() {
  useEffect(() => {
    const root = appRoot();
    if (!root || getHost().keys !== "root") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onDown = () => {
      clearTimeout(timer);
      // After the press: its own default action (focusing an input, a button...) goes first.
      timer = setTimeout(() => {
        const active = (root.getRootNode() as Document | ShadowRoot).activeElement;
        if (!active || !root.contains(active)) root.focus({ preventScroll: true });
      });
    };
    root.addEventListener("pointerdown", onDown, true);
    return () => {
      clearTimeout(timer);
      root.removeEventListener("pointerdown", onDown, true);
    };
  }, []);
}

/** Shown over the grid while the vault loads, or when there is nothing to show because it failed. */
function VaultNotice() {
  const source = useApp((s) => s.source);
  const vault = useApp((s) => s.vault);
  const remote = useApp((s) => s.remote);
  const empty = useApp((s) => s.collections.length === 0);
  if (source === "server") {
    // Nothing to show yet from the server (no copy on this device): say why.
    if (!empty || remote.status === "live") return null;
    return (
      <div className="vault-notice" role="status">
        <span>
          {remote.status === "login"
            ? t("server.status.login")
            : remote.status === "offline"
              ? t("server.unreachable", { message: remote.message ?? "" })
              : t("server.status.connecting")}
        </span>
        {remote.status !== "connecting" && (
          <button
            type="button"
            className="btn"
            onClick={() => useApp.getState().set({ settingsOpen: true })}
          >
            {t("vault.openSettings")}
          </button>
        )}
      </div>
    );
  }
  if (source !== "vault" || !empty || vault.status === "idle") return null;
  const text =
    vault.status === "loading"
      ? t("vault.loading")
      : vault.status === "error"
        ? vault.message === "no-root"
          ? t("vault.noRoot")
          : `${t("vault.error")}: ${vault.message ?? ""}`
        : t("vault.empty");
  return (
    <div className="vault-notice" role="status">
      <span>{text}</span>
      {vault.status !== "loading" && (
        <button
          type="button"
          className="btn"
          onClick={() => useApp.getState().set({ settingsOpen: true })}
        >
          {t("vault.openSettings")}
        </button>
      )}
    </div>
  );
}

/** The phone layout follows the app's own width (a pane of another app can be narrow too). */
function useCompact() {
  useEffect(() => {
    const root = appRoot();
    if (!root) return;
    const sync = () => useApp.getState().setCompact(root.clientWidth < COMPACT_WIDTH);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(root);
    return () => ro.disconnect();
  }, []);
  // On a phone the drawer closes once a day is chosen in it.
  const seq = useApp((s) => s.nav.seq);
  useEffect(() => {
    const s = useApp.getState();
    if (s.compact && s.sidebarOpen) s.set({ sidebarOpen: false });
  }, [seq]);
}

/** New event at the next whole hour today (phone: the floating button). */
function newEventNow() {
  const s = useApp.getState();
  const tz = s.settings.tz;
  const now = toLocal(nowMs(), tz);
  const start = Math.min(23 * 60, Math.ceil(now.minute / 60) * 60);
  const end = Math.min(1440, start + s.settings.defaultDuration);
  const id = s.addEvent({
    when: {
      kind: "timed",
      start: fromLocal(now.day, start, tz),
      end: fromLocal(now.day, end, tz),
      tz,
    },
  });
  s.goTo(now.day);
  s.select(id, true);
}

/**
 * Reminders as system notifications, where the host shows them (desktop shell, Android): the list of the
 * next hours is handed over a moment after anything that changes it, and again every quarter of an hour.
 */
function useNotifications() {
  useEffect(() => {
    const notify = getHost().notify;
    if (!notify) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastServer = "";
    const send = () => {
      const s = useApp.getState();
      // A host that asks the server itself (Android) only needs to know how; the page lists nothing then.
      if (notify.server) {
        const token = getHost().storage.get(SERVER_TOKEN_KEY);
        const cfg =
          s.source === "server" && s.settings.server && token
            ? {
                url: s.settings.server.url,
                token,
                tz: s.settings.tz,
                locale: s.settings.locale,
                h24: s.settings.h24,
              }
            : null;
        const key = JSON.stringify(cfg);
        if (key !== lastServer) notify.server(cfg);
        lastServer = key;
        if (cfg) return;
      }
      notify.schedule(
        noticesFor(s.data.events, (id) => s.remindersOf(id), {
          now: nowMs(),
          tz: s.settings.tz,
          h24: s.settings.h24,
          locale: s.settings.locale,
        }),
      );
    };
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(send, 1500);
    };
    const off = useApp.subscribe((s, p) => {
      if (
        s.data.events !== p.data.events ||
        s.views !== p.views ||
        s.settings !== p.settings ||
        s.source !== p.source
      )
        soon();
    });
    notify.onOpen?.((eventId) => {
      // An occurrence of a series is "<master>~<day>": the master tells the calendar, the id the day.
      const s = useApp.getState();
      const [masterId = eventId, occ] = eventId.split("~");
      const ev = s.data.events.find((e) => e.id === masterId);
      if (!ev) return;
      const day =
        occ !== undefined
          ? Number(occ)
          : ev.when.kind === "timed"
            ? toLocal(ev.when.start, s.settings.tz).day
            : ev.when.startDay;
      s.goTo(day);
      s.select(eventId, true);
    });
    soon();
    const every = setInterval(send, 15 * 60_000);
    return () => {
      off();
      clearTimeout(timer);
      clearInterval(every);
    };
  }, []);
}

/** External calendars: read when the app starts and again every half hour. */
function useExternalRefresh() {
  useEffect(() => {
    void useApp.getState().loadExternal();
    const id = setInterval(() => void useApp.getState().loadExternal(), 30 * 60_000);
    return () => clearInterval(id);
  }, []);
}

export function App() {
  useTheme();
  useCompact();
  useExternalRefresh();
  useNotifications();
  useShortcuts();
  useClickAway();
  useModifierClass();
  useFocusOnPress();
  useContextMenuTrigger();
  const view = useApp((s) => s.view);
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const compact = useApp((s) => s.compact);
  const detailMode = useApp((s) => s.detailMode);
  const selectedId = useApp((s) => s.selectedId);
  const popoverId = useApp((s) => s.popoverId);
  const selectedIds = useApp((s) => s.selectedIds);
  const settingsOpen = useApp((s) => s.settingsOpen);
  const paletteOpen = useApp((s) => s.paletteOpen);
  const helpOpen = useApp((s) => s.helpOpen);
  const schemaId = useApp((s) => s.schemaCalendarId);
  const toast = useApp((s) => s.toast);
  const locale = useApp((s) => s.settings.locale);
  void locale; // re-render everything when the language changes

  return (
    <div
      className={`app ${sidebarOpen ? "" : "no-sidebar"} ${detailMode === "panel" && selectedId ? "with-panel" : ""} ${compact ? "compact" : ""}`}
    >
      {sidebarOpen && <Sidebar />}
      {compact && sidebarOpen && (
        <div className="drawer-scrim" onClick={() => useApp.getState().toggleSidebar()} />
      )}
      {compact && !popoverId && !selectedIds.length && (
        <button type="button" className="fab" title={t("sidebar.newEvent")} onClick={newEventNow}>
          <Plus size={24} />
        </button>
      )}
      <main className="main">
        <TopBar />
        <div className="stage">
          {view === "month" ? <MonthView /> : <TimeGrid />}
          <VaultNotice />
        </div>
      </main>
      <EventDetail />
      <ContextMenu />
      <SelectionBar />
      <ScopeModal />
      {settingsOpen && <SettingsModal />}
      {schemaId && <SchemaEditor calendarId={schemaId} />}
      {paletteOpen && <Palette />}
      {helpOpen && <HelpModal />}
      {toast && (
        <div className="toast" role="status">
          <span>{t(toast.text as never, toast.params)}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                useApp.getState().undo();
                useApp.getState().clearToast();
              }}
            >
              {t("event.undo")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
