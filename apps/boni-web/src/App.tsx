import { MoreHorizontal, PanelLeft, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { ActivityView } from "./components/Activity.tsx";
import { AuditView } from "./components/Audit.tsx";
import { ChartCard } from "./components/ChartCard.tsx";
import { ChatView, InboxView } from "./components/Chat.tsx";
import { CollectionsView, CollectionView } from "./components/Collections.tsx";
import { InboxButton, InboxPanel, ProposalPage } from "./components/InboxCards.tsx";
import { NotesView } from "./components/Notes.tsx";
import { PageView, Welcome } from "./components/PageView.tsx";
import { MenuRow, MenuSep, PopButton } from "./components/Popover.tsx";
import { QuickFind, TrashDialog } from "./components/QuickFind.tsx";
import { RowView } from "./components/RowView.tsx";
import { SettingsModal } from "./components/SettingsModal.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { SidePanel } from "./components/SidePanel.tsx";
import { SystemPageView } from "./components/SystemPage.tsx";
import { host } from "./host.ts";
import { MobileApp } from "./MobileApp.tsx";
import {
  closeProposal,
  configured,
  deletePage,
  dismissRejected,
  dismissToast,
  duplicatePage,
  goBack,
  newPage,
  openCollection,
  openFind,
  openPage,
  openSettings,
  setChartDrill,
  setPageFull,
  showChat,
  showCollections,
  showLog,
  showNotes,
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
  const inboxOpen = useStore((s) => s.inboxOpen);
  const toast = useStore((s) => s.toast);
  const findOpen = useStore((s) => s.findOpen);
  const trashOpen = useStore((s) => s.trash != null);
  // In a narrow window the side panel takes the sidebar's room while it is open (the charts keep theirs).
  const narrow = useMedia("(max-width: 1100px)");
  const showSidebar = sidebarOpen && !(narrow && (panelOpen || inboxOpen));
  if (mobile) return <MobileApp />;
  return (
    <div className={`app${showSidebar ? "" : " no-sidebar"}`}>
      {showSidebar && <Sidebar />}
      <div className="main">
        <TopBar />
        <Content />
      </div>
      {panelOpen ? <SidePanel /> : <InboxPanel />}
      {settingsOpen && <SettingsModal />}
      {findOpen && <QuickFind />}
      {trashOpen && <TrashDialog />}
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
 * [ the sidebar, Ctrl+K search, Ctrl+, settings, Esc back to the page (panels close first). On the phone Esc is Back: it
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
      if (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        openFind(!s.findOpen);
        return;
      }
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
        if (s.view.kind === "proposal") closeProposal();
        else if (s.view.kind === "chart" && s.view.drill) setChartDrill(null);
        else if (s.view.kind === "inbox") showChat();
        else if (s.view.kind === "row" && s.view.from === "notes") showNotes();
        else if (s.view.kind === "row" && s.view.from) openCollection(s.view.type);
        else if (s.view.kind === "collection") showCollections();
        else if (s.view.kind === "audit") showLog();
        else if (s.view.kind === "row" && s.page) void openPage(s.page.id);
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
  const pages = useStore((s) => s.pages);
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
        ) : view.kind === "log" ? (
          t("activity.title")
        ) : view.kind === "inbox" ? (
          <>
            <button type="button" className="title-crumb" onClick={showChat}>
              {t("nav.chat")}
            </button>
            <span className="title-sep">/</span>
            <span className="title-name">{t("inbox.title")}</span>
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
        ) : view.kind === "row" ? (
          <RowCrumbs />
        ) : view.kind === "proposal" ? (
          <span className="crumbs">
            <span className="crumb-part">
              <button type="button" className="crumb" onClick={closeProposal}>
                {t("inbox.title")}
              </button>
              <span className="crumb-sep">/</span>
            </span>
            <span className="crumb current">{t("ghost.proposed")}</span>
          </span>
        ) : view.kind === "collections" ? (
          t("nav.collections")
        ) : view.kind === "models" ? (
          t("nav.models")
        ) : view.kind === "notes" ? (
          t("nav.notes")
        ) : view.kind === "audit" ? (
          <span className="crumbs">
            <span className="crumb-part">
              <button type="button" className="crumb" onClick={showLog}>
                {t("activity.title")}
              </button>
              <span className="crumb-sep">/</span>
            </span>
            <span className="crumb current">{t("audit.title")}</span>
          </span>
        ) : view.kind === "collection" ? (
          <CollectionCrumbs />
        ) : onPage && page ? (
          <Crumbs page={page} pages={pages ?? []} />
        ) : view.kind === "page" ? (
          ""
        ) : (
          "Boni"
        )}
      </h1>
      <span className="spacer" />
      {pending > 0 && <span className="status">{t("top.pending", { n: pending })}</span>}
      {ready && <InboxButton />}
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
      {onPage && page && (
        <PopButton
          className="icon-btn"
          title={t("page.more")}
          width={240}
          label={<MoreHorizontal size={16} strokeWidth={1.8} />}
        >
          {(close) => (
            <div className="menu-list" role="menu">
              <MenuRow
                label={t("page.full")}
                on={Boolean(page.spec.full)}
                onClick={() => {
                  close();
                  setPageFull(!page.spec.full);
                }}
              />
              <MenuRow
                label={t("page.newSub")}
                onClick={() => {
                  close();
                  void newPage(page.id);
                }}
              />
              <MenuRow
                label={t("page.duplicate")}
                onClick={() => {
                  close();
                  void duplicatePage(page.id);
                }}
              />
              <MenuSep />
              <MenuRow
                label={t("page.delete")}
                danger
                onClick={() => {
                  close();
                  void deletePage(page.id);
                }}
              />
            </div>
          )}
        </PopButton>
      )}
    </header>
  );
}

/** Colecciones / the collection open on its own page. */
function CollectionCrumbs() {
  const t = useStore((s) => s.t);
  const type = useStore((s) =>
    s.view.kind === "collection"
      ? s.dataTypes?.find((x) => x.id === (s.view as { type: string }).type)
      : undefined,
  );
  return (
    <span className="crumbs">
      <span className="crumb-part">
        <button type="button" className="crumb" onClick={showCollections}>
          {t("nav.collections")}
        </button>
        <span className="crumb-sep">/</span>
      </span>
      <span className="crumb current">{type?.name ?? ""}</span>
    </span>
  );
}

/** Where an open row is: the page (or Colecciones) it was opened from, its collection, its title. */
function RowCrumbs() {
  const t = useStore((s) => s.t);
  const fromCollection = useStore((s) => s.view.kind === "row" && s.view.from === "collection");
  const fromNotes = useStore((s) => s.view.kind === "row" && s.view.from === "notes");
  const page = useStore((s) => (fromCollection || fromNotes ? null : s.page));
  const row = useStore((s) => s.row);
  const type = useStore((s) =>
    s.view.kind === "row"
      ? s.dataTypes?.find((x) => x.id === (s.view as { type: string }).type)
      : undefined,
  );
  const title = row && type ? row.values[type.titleField] : null;
  return (
    <span className="crumbs">
      {page && (
        <span className="crumb-part">
          <button type="button" className="crumb" onClick={() => void openPage(page.id)}>
            {page.title || t("page.untitled")}
          </button>
          <span className="crumb-sep">/</span>
        </span>
      )}
      {fromCollection && (
        <span className="crumb-part">
          <button type="button" className="crumb" onClick={showCollections}>
            {t("nav.collections")}
          </button>
          <span className="crumb-sep">/</span>
        </span>
      )}
      {fromNotes && (
        <span className="crumb-part">
          <button type="button" className="crumb" onClick={showNotes}>
            {t("nav.notes")}
          </button>
          <span className="crumb-sep">/</span>
        </span>
      )}
      {type && (
        <span className="crumb-part">
          {fromCollection ? (
            <button type="button" className="crumb" onClick={() => openCollection(type.id)}>
              {type.name}
            </button>
          ) : (
            <span className="crumb">{type.name}</span>
          )}
          <span className="crumb-sep">/</span>
        </span>
      )}
      <span className="crumb current">
        {typeof title === "string" && title ? title : t("page.untitled")}
      </span>
    </span>
  );
}

/** Where the page is (as Notion's top bar): its parent pages, then its own name, small. */
function Crumbs({
  page,
  pages,
}: {
  page: { id: string; title: string; parent: string | null };
  pages: { id: string; title: string; parent: string | null }[];
}) {
  const t = useStore((s) => s.t);
  const path: { id: string; title: string }[] = [];
  const seen = new Set([page.id]);
  for (let at = page.parent; at && !seen.has(at); ) {
    seen.add(at);
    const p = pages.find((x) => x.id === at);
    if (!p) break;
    path.unshift(p);
    at = p.parent;
  }
  return (
    <span className="crumbs">
      {path.map((p) => (
        <span key={p.id} className="crumb-part">
          <button type="button" className="crumb" onClick={() => void openPage(p.id)}>
            {p.title || t("page.untitled")}
          </button>
          <span className="crumb-sep">/</span>
        </span>
      ))}
      <span className="crumb current">{page.title || t("page.untitled")}</span>
    </span>
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
  if (view.kind === "log") return <ActivityView />;
  if (view.kind === "audit") return <AuditView filter={view.filter} />;
  if (view.kind === "chart") {
    return (
      <div className="content">
        <ChartCard key={view.id} chartId={view.id} focused className="focus" />
      </div>
    );
  }
  if (view.kind === "page") return <PageView after={<QueueNotes />} />;
  if (view.kind === "row") return <RowView />;
  if (view.kind === "proposal") return <ProposalPage key={view.id} id={view.id} />;
  if (view.kind === "collections") return <CollectionsView />;
  if (view.kind === "models") return <SystemPageView name="models" />;
  if (view.kind === "notes") return <NotesView />;
  if (view.kind === "collection") return <CollectionView />;
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
