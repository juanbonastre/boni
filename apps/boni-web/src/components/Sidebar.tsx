import {
  ChevronRight,
  FileText,
  MessageSquare,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Settings,
} from "lucide-react";
import { useState } from "react";
import type { PageInfo } from "../core/agent.ts";
import {
  deletePage,
  newPage,
  openPage,
  openSettings,
  showChat,
  toggleSidebar,
  useStore,
} from "../store.ts";
import { MenuRow, MenuSep, PopButton } from "./Popover.tsx";

/**
 * The sidebar: the conversation with Boni, the user's pages (a tree: a page can hold subpages) and, at the
 * bottom, settings and who is logged in. Nothing else is fixed here: what the user sees is what they made.
 */
export function Sidebar() {
  const t = useStore((s) => s.t);
  const view = useStore((s) => s.view);
  const settings = useStore((s) => s.settings);
  const inbox = useStore((s) => s.inbox);
  const pages = useStore((s) => s.pages);

  return (
    <nav className="sidebar" aria-label={t("sidebar.label")}>
      <div className="sidebar-top">
        <button
          type="button"
          className="icon-btn"
          onClick={toggleSidebar}
          title={t("sidebar.hide")}
          aria-label={t("sidebar.hide")}
        >
          <PanelLeft size={16} strokeWidth={1.8} />
        </button>
      </div>
      <div className="sidebar-scroll">
        <button
          type="button"
          className={`nav-row${view.kind === "chat" || view.kind === "inbox" || view.kind === "log" ? " active" : ""}`}
          onClick={showChat}
        >
          <MessageSquare size={15} strokeWidth={1.8} />
          <span className="nav-name">{t("nav.chat")}</span>
          {inbox.length > 0 && <span className="nav-count">{inbox.length}</span>}
        </button>

        {pages !== null && (
          <>
            <div className="group-head">
              <span>{t("nav.pages")}</span>
              <button
                type="button"
                className="icon-btn tiny"
                onClick={() => void newPage()}
                title={t("page.new")}
                aria-label={t("page.new")}
              >
                <Plus size={13} strokeWidth={2} />
              </button>
            </div>
            <ul className="nav-list" aria-label={t("nav.pages")}>
              <PageTree pages={pages} parent={null} depth={0} />
              {pages.length === 0 && (
                <li>
                  <button
                    type="button"
                    className="nav-row muted-row"
                    onClick={() => void newPage()}
                  >
                    <Plus size={14} strokeWidth={1.8} />
                    <span className="nav-name">{t("page.new")}</span>
                  </button>
                </li>
              )}
            </ul>
          </>
        )}
      </div>
      <div className="sidebar-foot">
        <button type="button" className="foot-btn" onClick={() => openSettings()}>
          <Settings size={15} strokeWidth={1.8} />
          <span className="nav-name">{t("top.settings")}</span>
        </button>
        {settings.user && (
          <span className="foot-user" title={`${settings.user} · ${settings.device}`}>
            {settings.user}
          </span>
        )}
      </div>
    </nav>
  );
}

const MAX_DEPTH = 6;

function PageTree({
  pages,
  parent,
  depth,
}: {
  pages: PageInfo[];
  parent: string | null;
  depth: number;
}) {
  const t = useStore((s) => s.t);
  const view = useStore((s) => s.view);
  const [closed, setClosed] = useState<string[]>([]);
  // A page whose parent is gone shows at the top (never lost).
  const here = pages.filter((p) =>
    parent === null ? !p.parent || !pages.some((q) => q.id === p.parent) : p.parent === parent,
  );
  return (
    <>
      {here.map((p) => {
        const kids = depth < MAX_DEPTH && pages.some((c) => c.parent === p.id);
        const open = kids && !closed.includes(p.id);
        const name = p.title || t("page.untitled");
        return (
          <li key={p.id}>
            <div
              className={`chart-row page-row${view.kind === "page" && view.id === p.id ? " active" : ""}`}
              style={{ paddingLeft: depth * 14 }}
            >
              {kids ? (
                <button
                  type="button"
                  className={`page-toggle${open ? " open" : ""}`}
                  aria-expanded={open}
                  aria-label={`${open ? t("page.collapse") : t("page.expand")}: ${name}`}
                  onClick={() =>
                    setClosed((c) =>
                      c.includes(p.id) ? c.filter((x) => x !== p.id) : [...c, p.id],
                    )
                  }
                >
                  <span className="page-icon-slot">
                    {p.icon ? (
                      <span className="page-icon">{p.icon}</span>
                    ) : (
                      <FileText size={14} strokeWidth={1.8} className="page-icon" />
                    )}
                  </span>
                  <ChevronRight size={14} strokeWidth={2} className="page-chev" />
                </button>
              ) : (
                <span className="page-toggle static">
                  {p.icon ? (
                    <span className="page-icon">{p.icon}</span>
                  ) : (
                    <FileText size={14} strokeWidth={1.8} className="page-icon" />
                  )}
                </span>
              )}
              <button type="button" className="chart-main" onClick={() => void openPage(p.id)}>
                <span className={`nav-name${p.title ? "" : " untitled"}`}>{name}</span>
              </button>
              <PopButton
                className="icon-btn tiny row-action"
                title={`${t("page.more")}: ${name}`}
                align="start"
                label={<MoreHorizontal size={13} strokeWidth={1.8} />}
              >
                {(close) => (
                  <div className="menu-list" role="menu">
                    <MenuRow
                      label={t("page.newSub")}
                      onClick={() => {
                        close();
                        void newPage(p.id);
                      }}
                    />
                    <MenuSep />
                    <MenuRow
                      label={t("page.delete")}
                      danger
                      onClick={() => {
                        close();
                        void deletePage(p.id);
                      }}
                    />
                  </div>
                )}
              </PopButton>
              <button
                type="button"
                className="icon-btn tiny row-action"
                title={t("page.newSub")}
                aria-label={`${t("page.newSub")}: ${name}`}
                onClick={() => {
                  setClosed((c) => c.filter((x) => x !== p.id));
                  void newPage(p.id);
                }}
              >
                <Plus size={13} strokeWidth={1.8} />
              </button>
            </div>
            {open && (
              <ul className="nav-list">
                <PageTree pages={pages} parent={p.id} depth={depth + 1} />
              </ul>
            )}
          </li>
        );
      })}
    </>
  );
}
