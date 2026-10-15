import { useEffect } from "react";
import { ContextMenu, useContextMenuTrigger } from "./components/ContextMenu.tsx";
import { EventDetail } from "./components/EventDetail.tsx";
import { HelpModal, Palette, SchemaEditor, SettingsModal } from "./components/Modals.tsx";
import { MonthView } from "./components/MonthView.tsx";
import { ScopeModal } from "./components/RecurrenceModals.tsx";
import { SelectionBar } from "./components/SelectionBar.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { TimeGrid } from "./components/TimeGrid.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { t } from "./i18n.ts";
import { useApp } from "./store.ts";

function useTheme() {
  const theme = useApp((s) => s.settings.theme);
  const density = useApp((s) => s.settings.density);
  useEffect(() => {
    const root = document.documentElement;
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
  const el = e.target as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT" ||
      el.isContentEditable)
  );
}

/** While Ctrl, Shift or Meta is held the popover lets clicks through, so events under it can be added to a selection. */
function useModifierClass() {
  useEffect(() => {
    const sync = (e: KeyboardEvent) =>
      document.body.classList.toggle("mod-select", e.ctrlKey || e.shiftKey || e.metaKey);
    const clear = () => document.body.classList.remove("mod-select");
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

/** Clicking anywhere outside the detail popover (and the events that open it) closes it. */
function useClickAway() {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const s = useApp.getState();
      if (!s.popoverId) return;
      const el = e.target as HTMLElement | null;
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
        if (s.paletteOpen || s.settingsOpen || s.helpOpen || s.schemaCalendarId || s.scopePrompt)
          return; // modals handle it
        if (s.popoverId || s.selectedId || s.selectedIds.length > 0) {
          s.clearSelection();
          (document.activeElement as HTMLElement | null)?.blur?.();
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Shown over the grid while the vault loads, or when there is nothing to show because it failed. */
function VaultNotice() {
  const source = useApp((s) => s.source);
  const vault = useApp((s) => s.vault);
  const empty = useApp((s) => s.collections.length === 0);
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

export function App() {
  useTheme();
  useShortcuts();
  useClickAway();
  useModifierClass();
  useContextMenuTrigger();
  const view = useApp((s) => s.view);
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const detailMode = useApp((s) => s.detailMode);
  const selectedId = useApp((s) => s.selectedId);
  const settingsOpen = useApp((s) => s.settingsOpen);
  const paletteOpen = useApp((s) => s.paletteOpen);
  const helpOpen = useApp((s) => s.helpOpen);
  const schemaId = useApp((s) => s.schemaCalendarId);
  const toast = useApp((s) => s.toast);
  const locale = useApp((s) => s.settings.locale);
  void locale; // re-render everything when the language changes

  return (
    <div
      className={`app ${sidebarOpen ? "" : "no-sidebar"} ${detailMode === "panel" && selectedId ? "with-panel" : ""}`}
    >
      {sidebarOpen && <Sidebar />}
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
