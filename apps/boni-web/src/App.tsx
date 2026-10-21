import { PanelLeft, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { ChartCard } from "./components/ChartCard.tsx";
import { ChatView, InboxView, LogView } from "./components/Chat.tsx";
import { PageView, Welcome } from "./components/PageView.tsx";
import { SettingsModal } from "./components/SettingsModal.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { SidePanel } from "./components/SidePanel.tsx";
import { host } from "./host.ts";
import { MobileApp } from "./MobileApp.tsx";
import {
  configured,
  dismissRejected,
  dismissToast,
  goBack,
  openPage,
  openSettings,
  renamePage,
  setChartDrill,
  setPageEditing,
  showChat,
  showStart,
  toggleSidebar,
  useStore,
} from "./store.ts";
import { useTheme } from "./theme.ts";

/**
 * The main window, laid out as Boni Calendar: the sidebar, the main area (a page of the user's, the
 * conversation, or one chart on its own) and the side panel (capture, chart editor) next to it.
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
 * [ the sidebar, Ctrl+, settings, Esc back to the page (panels close first). On the phone Esc is Back: it
 * closes the top thing (`goBack`).
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
      if (e.key === "[") {
        e.preventDefault();
        toggleSidebar();
      } else if (
        e.key === "Escape" &&
        !e.defaultPrevented &&
        !s.panel &&
        s.view.kind !== "home" &&
        s.view.kind !== "page"
      ) {
        e.preventDefault();
        if (s.view.kind === "chart" && s.view.drill) setChartDrill(null);
        else if (s.view.kind === "inbox" || s.view.kind === "log") showChat();
        else showStart();
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
  const page = useStore((s) => s.page);
  const editing = useStore((s) => s.pageEditing);
  const pending = useStore((s) => s.pending);
  const settings = useStore((s) => s.settings);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const ready = configured(settings);
  const offline = ready && host.live && !settings.live && !settings.liveUnsupported;
  const onPage = view.kind === "page" && page?.id === view.id;
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
        {view.kind === "chat" ? (
          t("nav.chat")
        ) : view.kind === "inbox" || view.kind === "log" ? (
          <>
            <button type="button" className="title-crumb" onClick={showChat}>
              {t("nav.chat")}
            </button>
            <span className="title-sep">/</span>
            <span className="title-name">
              {view.kind === "inbox" ? t("inbox.title") : t("log.title")}
            </span>
          </>
        ) : view.kind === "chart" && spec ? (
          <>
            {page && (
              <>
                <button
                  type="button"
                  className="title-crumb"
                  onClick={() => void openPage(page.id)}
                >
                  {page.title}
                </button>
                <span className="title-sep">/</span>
              </>
            )}
            <span className="title-name">{spec.title}</span>
          </>
        ) : onPage && page ? (
          <PageTitle id={page.id} title={page.title} />
        ) : view.kind === "page" ? (
          ""
        ) : (
          "Boni"
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
      {onPage && !editing && (
        <button type="button" className="pill" onClick={() => setPageEditing(true)}>
          {t("page.edit")}
        </button>
      )}
      {onPage && editing && (
        <button type="button" className="btn primary" onClick={() => setPageEditing(false)}>
          {t("page.done")}
        </button>
      )}
    </header>
  );
}

/** The page's name, changed in place: click, type, Enter (Esc leaves it as it was). */
function PageTitle({ id, title }: { id: string; title: string }) {
  const t = useStore((s) => s.t);
  const [text, setText] = useState<string | null>(null);
  if (text === null)
    return (
      <button
        type="button"
        className="title-name title-edit"
        title={t("page.name")}
        onClick={() => setText(title)}
      >
        {title || t("page.untitled")}
      </button>
    );
  const done = (save: boolean) => {
    if (save && text.trim() && text.trim() !== title) void renamePage(id, text);
    setText(null);
  };
  return (
    <input
      className="title-input"
      aria-label={t("page.name")}
      value={text}
      maxLength={120}
      // biome-ignore lint/a11y/noAutofocus: the user just clicked the name to change it
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => done(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") done(true);
        else if (e.key === "Escape") {
          e.preventDefault();
          done(false);
        }
      }}
    />
  );
}

function Content() {
  const t = useStore((s) => s.t);
  const view = useStore((s) => s.view);
  const settings = useStore((s) => s.settings);
  const pages = useStore((s) => s.pages);
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
  if (view.kind === "chat")
    return (
      <div className="content">
        <ChatView />
      </div>
    );
  if (view.kind === "inbox")
    return (
      <div className="content">
        <InboxView />
      </div>
    );
  if (view.kind === "log")
    return (
      <div className="content">
        <LogView />
      </div>
    );
  if (view.kind === "chart") {
    return (
      <div className="content">
        <ChartCard key={view.id} chartId={view.id} focused className="focus" />
      </div>
    );
  }
  if (view.kind === "page") return <PageView after={<QueueNotes />} />;
  return <Welcome error={pages?.length ? null : loadError} after={<QueueNotes />} />;
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
