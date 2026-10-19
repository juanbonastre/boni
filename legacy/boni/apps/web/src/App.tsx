import { PanelLeft, Plus, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { ChartCard, ChartCardContent } from "./components/ChartCard.tsx";
import { SettingsModal } from "./components/SettingsModal.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { SidePanel } from "./components/SidePanel.tsx";
import { isCategoryKind } from "./core/chartBuilder.ts";
import { emptyState } from "./core/charts.ts";
import { host } from "./host.ts";
import { MobileApp } from "./MobileApp.tsx";
import {
  CAPTURE_SCREEN,
  configured,
  dismissRejected,
  dismissToast,
  goBack,
  openScreen,
  openSettings,
  setChartDrill,
  showHome,
  toggleSidebar,
  useStore,
  useVisibleCharts,
} from "./store.ts";
import { useTheme } from "./theme.ts";

/**
 * The main window, laid out as Boni Calendar: the sidebar, the main area (the home screen's charts filling the
 * window, or one chart on its own) and the side panel (capture, chart editor) next to it.
 */
export function App() {
  useTheme();
  // Narrower than 640 px (a phone, the Android app): its own layout, made for capturing (MobileApp).
  const mobile = useMedia(`(max-width: ${MOBILE_WIDTH - 1}px)`);
  useShortcuts(mobile);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const panelOpen = useStore((s) => s.panel != null);
  const toast = useStore((s) => s.toast);
  // In a narrow window the side panel takes the sidebar's room while it is open (the charts keep theirs).
  const narrow = useMedia("(max-width: 1100px)");
  const showSidebar = sidebarOpen && !(narrow && panelOpen);
  if (mobile) return <MobileApp />;
  return (
    <div className={`app${showSidebar ? "" : " no-sidebar"}`}>
      {showSidebar && <Sidebar />}
      <div className="main">
        <TopBar />
        <Content />
      </div>
      <SidePanel />
      {settingsOpen && <SettingsModal />}
      {toast && (
        <div className="toast" role="status" key={toast.id}>
          <span>{toast.text}</span>
          {toast.action && (
            <button
              type="button"
              onClick={() => {
                toast.action?.run();
                dismissToast();
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Below this width (CSS px) the app uses its phone layout, as Boni Calendar. */
const MOBILE_WIDTH = 640;

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const update = () => setOn(m.matches);
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, [query]);
  return on;
}

/**
 * N new capture, [ the sidebar, Ctrl+, settings, Esc back to the home screen (panels close first). On the phone
 * Esc is Back: it closes the top thing (`goBack`).
 */
function useShortcuts(mobile: boolean) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if (mobile) {
        if (e.key === "Escape" && !e.defaultPrevented && goBack()) e.preventDefault();
        return;
      }
      const typing = (e.target as HTMLElement | null)?.closest(
        "input, textarea, select, [contenteditable]",
      );
      if (e.key === "," && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        openSettings(!s.settingsOpen);
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey || s.settingsOpen) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        openScreen(CAPTURE_SCREEN);
      } else if (e.key === "[") {
        e.preventDefault();
        toggleSidebar();
      } else if (e.key === "Escape" && !e.defaultPrevented && !s.panel && s.view.kind !== "home") {
        e.preventDefault();
        if (s.view.kind === "chart" && s.view.drill) setChartDrill(null);
        else showHome();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobile]);
}

function TopBar() {
  const t = useStore((s) => s.t);
  const view = useStore((s) => s.view);
  const spec = useStore((s) =>
    s.view.kind === "chart"
      ? s.chartSpecs.find((c) => c.id === (s.view as { id: string }).id)
      : null,
  );
  const home = useStore((s) => s.home);
  const pending = useStore((s) => s.pending);
  const settings = useStore((s) => s.settings);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const ready = configured(settings);
  const buttons = (home?.components ?? []).filter((c) => c.type === "button");
  // Without the server's home yet, capture is still offered (the form comes from the device's copy).
  const actions = buttons.length
    ? buttons
    : [{ type: "button" as const, label: t("capture.title"), screen: CAPTURE_SCREEN, icon: "add" }];
  const offline = ready && host.live && !settings.live && !settings.liveUnsupported;
  return (
    <header className="topbar">
      {!sidebarOpen && (
        <button
          type="button"
          className="icon-btn"
          onClick={toggleSidebar}
          title={t("sidebar.show")}
          aria-label={t("sidebar.show")}
        >
          <PanelLeft size={16} strokeWidth={1.8} />
        </button>
      )}
      <h1 className="title">
        {view.kind === "chart" && spec ? (
          <>
            <button type="button" className="title-crumb" onClick={showHome}>
              {t("top.home")}
            </button>
            <span className="title-sep">/</span>
            <span className="title-name">{spec.title}</span>
          </>
        ) : (
          t("top.home")
        )}
      </h1>
      <span className="spacer" />
      {pending > 0 && <span className="status">{t("top.pending", { n: pending })}</span>}
      {offline && (
        <span className="status" title={t("top.offlineHelp")}>
          <WifiOff size={14} strokeWidth={1.8} />
          {t("top.offline")}
        </span>
      )}
      {(settings.sessionEnded || settings.legacyToken) && (
        <button type="button" className="pill warn" onClick={() => openSettings()}>
          {settings.sessionEnded ? t("account.ended") : t("account.legacy")}
        </button>
      )}
      {actions.map((b) =>
        b.type === "button" ? (
          <button
            key={b.screen}
            type="button"
            className={b.style === "secondary" ? "pill" : "btn primary"}
            onClick={() => openScreen(b.screen)}
            title={`${b.label} (N)`}
          >
            {b.icon === "add" && <Plus size={15} strokeWidth={2} />}
            {b.label}
          </button>
        ) : null,
      )}
    </header>
  );
}

function Content() {
  const t = useStore((s) => s.t);
  const view = useStore((s) => s.view);
  const settings = useStore((s) => s.settings);
  const specs = useVisibleCharts();
  const loadError = useStore((s) => s.loadError);
  const ready = configured(settings);

  if (!ready) {
    return (
      <div className="content center">
        <div className="empty-state">
          <img src="./favicon.png" alt="" width={56} height={56} />
          <p>{t("home.setup")}</p>
          <button type="button" className="btn primary" onClick={() => openSettings()}>
            {t("home.setupButton")}
          </button>
        </div>
      </div>
    );
  }
  if (view.kind === "chart") {
    return (
      <div className="content">
        <ChartCard key={view.id} chartId={view.id} focused className="focus" />
      </div>
    );
  }
  const onHome = specs.filter((s) => s.home);
  return (
    <div className="content">
      {loadError && specs.length === 0 && <p className="form-error">{loadError}</p>}
      <div className="dashboard">
        {onHome.map((s) => (
          <ChartCard
            key={s.id}
            chartId={s.id}
            className={isCategoryKind(s.kind) && s.kind !== "donut" ? "wide" : undefined}
          />
        ))}
        <NewChartPreview />
      </div>
      {onHome.length === 0 && <p className="muted center-note">{t("charts.noneHome")}</p>}
      <QueueNotes />
    </div>
  );
}

/** The card of a chart being created in the side panel, with the editor's preview. */
function NewChartPreview() {
  const panel = useStore((s) => s.panel);
  const preview = useStore((s) => (s.editPreview?.id === "" ? s.editPreview.state : null));
  if (panel?.kind !== "edit" || !panel.isNew) return null;
  return (
    <ChartCardContent
      title={panel.spec.title}
      color={panel.spec.color}
      state={preview ?? emptyState()}
      className="editing new"
    />
  );
}

function QueueNotes() {
  const t = useStore((s) => s.t);
  const rejected = useStore((s) => s.rejected);
  if (!rejected.length) return null;
  return (
    <div className="card rejected">
      <h3>{t("queue.rejected")}</h3>
      {rejected.map((item) => (
        <div key={item.request.client_id} className="list-row">
          <span className="list-main small">
            {String(item.request.values.concept ?? "")} {String(item.request.values.amount ?? "")}:{" "}
            {item.error}
          </span>
          <button
            type="button"
            className="btn ghost"
            onClick={() => void dismissRejected(item.request.client_id)}
          >
            {t("queue.dismiss")}
          </button>
        </div>
      ))}
    </div>
  );
}
