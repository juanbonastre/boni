import {
  ChevronRight,
  Database,
  FileText,
  FolderTree,
  MessageSquare,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type { PageInfo } from "../core/agent.ts";
import {
  deletePage,
  duplicatePage,
  loadTrash,
  movePage,
  newPage,
  openFind,
  openPage,
  openSettings,
  showChat,
  showCollections,
  showNotes,
  toggleSidebar,
  useStore,
} from "../store.ts";
import { CollectionTree } from "./CollectionTree.tsx";
import { MenuRow, MenuSep, PopButton } from "./Popover.tsx";

/**
 * The sidebar: the conversation with Boni, the user's pages (a tree: a page can hold subpages) and, at the
 * bottom, settings and who is logged in. Nothing else is fixed here: what the user sees is what they made.
 */
export function Sidebar() {
  const t = useStore((s) => s.t);
  const view = useStore((s) => s.view);
  const settings = useStore((s) => s.settings);
  const waiting = useStore((s) => s.inbox.length + s.requests.length);
  const pages = useStore((s) => s.pages);
  const [drag, setDrag] = useState<Drag>(null);

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
        <button type="button" className="nav-row" onClick={() => openFind()}>
          <Search size={15} strokeWidth={1.8} />
          <span className="nav-name">{t("nav.search")}</span>
          <span className="nav-key">Ctrl K</span>
        </button>
        <button
          type="button"
          className={`nav-row${view.kind === "chat" || view.kind === "inbox" ? " active" : ""}`}
          onClick={showChat}
        >
          <MessageSquare size={15} strokeWidth={1.8} />
          <span className="nav-name">{t("nav.chat")}</span>
          {waiting > 0 && <span className="nav-count">{waiting}</span>}
        </button>
        {/* One tree (docs/clases.md §2.7): collections, their records with a note, Boni's own things. */}
        <CollectionTree />
      </div>
      {pages !== null && (
        <button type="button" className="nav-row trash-row" onClick={() => void loadTrash()}>
          <Trash2 size={15} strokeWidth={1.8} />
          <span className="nav-name">{t("page.trash")}</span>
        </button>
      )}
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

/** A page being dragged in the sidebar, and where it would land (before, after or inside a row). */
type Drag = { id: string; over: string | null; where: "before" | "after" | "inside" } | null;

function PageTree({
  pages,
  parent,
  depth,
  drag,
  setDrag,
}: {
  pages: PageInfo[];
  parent: string | null;
  depth: number;
  drag: Drag;
  setDrag: (d: Drag) => void;
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
              className={`chart-row page-row${view.kind === "page" && view.id === p.id ? " active" : ""}${
                drag?.over === p.id && drag.id !== p.id ? ` drop-${drag.where}` : ""
              }${drag?.id === p.id ? " dragging" : ""}`}
              style={{ paddingLeft: depth * 14 }}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", p.id);
                setDrag({ id: p.id, over: null, where: "inside" });
              }}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                const y = (e.clientY - r.top) / r.height;
                setDrag({
                  ...drag,
                  over: p.id,
                  where: y < 0.25 ? "before" : y > 0.75 ? "after" : "inside",
                });
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag?.over && drag.over !== drag.id)
                  void movePage(drag.id, drag.over, drag.where);
                setDrag(null);
              }}
              onDragEnd={() => setDrag(null)}
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
                    <MenuRow
                      label={t("page.duplicate")}
                      onClick={() => {
                        close();
                        void duplicatePage(p.id);
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
                <PageTree
                  pages={pages}
                  parent={p.id}
                  depth={depth + 1}
                  drag={drag}
                  setDrag={setDrag}
                />
              </ul>
            )}
          </li>
        );
      })}
    </>
  );
}
