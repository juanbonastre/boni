import {
  ChevronRight,
  Database,
  FileText,
  Library,
  MessageSquare,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import type { PageInfo } from "../core/agent.ts";
import {
  deletePage,
  duplicatePage,
  loadTrash,
  movePage,
  newPage,
  openCollection,
  openFind,
  openPage,
  openRow,
  openSettings,
  type Recent,
  showAllPages,
  showChat,
  toggleFold,
  toggleSidebar,
  useStore,
} from "../store.ts";
import { CollectionTree } from "./CollectionTree.tsx";
import { MenuRow, MenuSep, PopButton } from "./Popover.tsx";

/**
 * The sidebar (Juan, 2026-10-28): search, the conversation with Boni and «Todas las páginas» (the whole tree, to
 * manage it); then «Recientes» and «Páginas» (the user's pages and the tree of collections, to open, add and
 * delete), each folded by its heading; at the bottom, the trash, settings and who is logged in.
 */
export function Sidebar() {
  const t = useStore((s) => s.t);
  const view = useStore((s) => s.view);
  const settings = useStore((s) => s.settings);
  const waiting = useStore((s) => s.inbox.length + s.requests.length);
  const pages = useStore((s) => s.pages);
  const tree = useStore((s) => s.tree);
  const [drag, setDrag] = useState<Drag>(null);
  const folded = useStore((s) => s.fold.sections);
  const fold = (x: string) => toggleFold("sections", x);
  const own = (pages ?? []).filter((p) => !p.template);

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
        <button
          type="button"
          className={`nav-row${view.kind === "allPages" ? " active" : ""}`}
          onClick={showAllPages}
        >
          <Library size={15} strokeWidth={1.8} />
          <span className="nav-name">{t("nav.notes")}</span>
        </button>
        {/* «Modelos» is in Ajustes; what the models and Boni did are pages («Uso de la IA», «Actividad»). */}
        <RecentSection open={!folded.includes("recent")} toggle={() => fold("recent")} />
        {(pages !== null || tree !== null) && (
          <>
            <SectionHead
              name={t("nav.pages")}
              open={!folded.includes("pages")}
              toggle={() => fold("pages")}
              add={
                <button
                  type="button"
                  className="icon-btn tiny"
                  onClick={() => void newPage()}
                  title={t("page.new")}
                  aria-label={t("page.new")}
                >
                  <Plus size={13} strokeWidth={2} />
                </button>
              }
            />
            {!folded.includes("pages") && (
              <ul className="nav-list" aria-label={t("nav.pages")}>
                <PageTree pages={own} parent={null} depth={0} drag={drag} setDrag={setDrag} />
                {/* One tree (docs/clases.md §2.7): collections, their records with a note, Boni's own things. */}
                <CollectionTree />
                {own.length === 0 && !tree?.collections.length && (
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
            )}
          </>
        )}
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

/** A section's heading: a click on its name folds it (as Notion's); `add` is its own button, if any. */
export function SectionHead({
  name,
  open,
  toggle,
  add,
}: {
  name: string;
  open: boolean;
  toggle: () => void;
  add?: ReactNode;
}) {
  return (
    <div className="group-head">
      <button type="button" className="group-fold" aria-expanded={open} onClick={toggle}>
        <span>{name}</span>
        <ChevronRight size={12} strokeWidth={2} className="group-chev" aria-hidden="true" />
      </button>
      {add}
    </div>
  );
}

/** «Recientes»: the last pages, collections and notes opened on this device (gone ones are left out). */
export function RecentSection({ open, toggle }: { open: boolean; toggle: () => void }) {
  const t = useStore((s) => s.t);
  const view = useStore((s) => s.view);
  const recent = useStore((s) => s.recent);
  const pages = useStore((s) => s.pages);
  const types = useStore((s) => s.dataTypes);
  const row = useStore((s) => s.row);
  const items = recent.flatMap((r): { r: Recent; name: string; icon: ReactNode }[] => {
    if (r.kind === "page") {
      const p = pages?.find((x) => x.id === r.id);
      if (pages && !p) return [];
      const name = (p ? p.title : r.title) || t("page.untitled");
      return [{ r, name, icon: p?.icon ? <span className="page-icon">{p.icon}</span> : null }];
    }
    const type = types?.find((x) => x.id === (r.kind === "row" ? r.type : r.id));
    if (types && !type) return [];
    if (r.kind === "collection")
      return [
        {
          r,
          name: type?.name ?? r.title,
          icon: type?.icon ? (
            <span className="page-icon">{type.icon}</span>
          ) : (
            <Database size={14} strokeWidth={1.8} className="page-icon" />
          ),
        },
      ];
    // The note open now says its title as it is being written.
    const live = row?.id === r.id && type ? row.values[type.titleField] : undefined;
    const title = typeof live === "string" ? live : r.title;
    return [{ r, name: title || t("page.untitled"), icon: null }];
  });
  if (!items.length) return null;
  const isOpen = (r: Recent) =>
    r.kind === "page"
      ? view.kind === "page" && view.id === r.id
      : r.kind === "collection"
        ? view.kind === "collection" && view.type === r.id
        : view.kind === "row" && view.id === r.id;
  return (
    <>
      <SectionHead name={t("nav.recent")} open={open} toggle={toggle} />
      {open && (
        <ul className="nav-list" aria-label={t("nav.recent")}>
          {items.map(({ r, name, icon }) => (
            <li key={`${r.kind}:${r.id}`}>
              <div className={`chart-row tree-row${isOpen(r) ? " active" : ""}`}>
                <span className="page-toggle static">
                  {icon ?? <FileText size={14} strokeWidth={1.8} className="page-icon" />}
                </span>
                <button
                  type="button"
                  className="chart-main"
                  onClick={() =>
                    r.kind === "page"
                      ? void openPage(r.id)
                      : r.kind === "collection"
                        ? openCollection(r.id)
                        : void openRow(r.type, r.id)
                  }
                >
                  <span className="nav-name">{name}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const MAX_DEPTH = 6;

/** A page being dragged in the sidebar, and where it would land (before, after or inside a row). */
export type Drag = { id: string; over: string | null; where: "before" | "after" | "inside" } | null;

export function PageTree({
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
