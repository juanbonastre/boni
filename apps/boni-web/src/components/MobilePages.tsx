// The phone's «Páginas» tab (Juan, 2026-10-30): one's data on the phone, as the sidebar has it on the desktop.
import { ChevronRight, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { loadRows, openFind, openRow, useStore } from "../store.ts";
import { CollectionTree } from "./CollectionTree.tsx";
import { PageView } from "./PageView.tsx";
import { RowView } from "./RowView.tsx";
import { type Drag, PageTree, RecentSection, SectionHead } from "./Sidebar.tsx";

/**
 * The phone's «Páginas» (Juan, 2026-10-30: «no me aparece ninguna sección para ver mis datos»): the search, the
 * recent ones and the one tree of the sidebar, rows big enough for a finger; a collection opens as a list of its
 * records (a table does not fit a phone), a record or a page as it opens on the desktop. Back goes a step at a time.
 */
export function MobilePages() {
  const view = useStore((s) => s.view);
  if (view.kind === "collection") return <MobileCollection type={view.type} />;
  if (view.kind === "row")
    return (
      <div className="m-scroll m-row">
        <RowView />
      </div>
    );
  if (view.kind === "page")
    return (
      <div className="m-scroll m-row">
        <PageView />
      </div>
    );
  return <PagesHome />;
}

function PagesHome() {
  const t = useStore((s) => s.t);
  const pages = useStore((s) => s.pages);
  const [recentOpen, setRecentOpen] = useState(true);
  const [pagesOpen, setPagesOpen] = useState(true);
  const [drag, setDrag] = useState<Drag>(null);
  const own = (pages ?? []).filter((p) => !p.template);
  return (
    <div className="m-scroll m-pages">
      <button type="button" className="m-pages-search" onClick={() => openFind()}>
        <Search size={18} strokeWidth={1.8} />
        <span>{t("mobile.pagesSearch")}</span>
      </button>
      <RecentSection open={recentOpen} toggle={() => setRecentOpen(!recentOpen)} />
      <SectionHead name={t("nav.pages")} open={pagesOpen} toggle={() => setPagesOpen(!pagesOpen)} />
      {pagesOpen && (
        <ul className="nav-list" aria-label={t("nav.pages")}>
          <PageTree pages={own} parent={null} depth={0} drag={drag} setDrag={setDrag} />
          <CollectionTree />
        </ul>
      )}
    </div>
  );
}

/** A collection on the phone: its records one under another, the title and its first date, newest first. */
function MobileCollection({ type }: { type: string }) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const def = useStore((s) => s.dataTypes?.find((x) => x.id === type));
  const rows = useStore((s) => s.rows[type]?.rows);
  useEffect(() => {
    void loadRows(type);
  }, [type]);
  if (!def || !rows) return <div className="m-scroll" />;
  const date = def.fields.find((f) => f.type === "date");
  const day = (d: string) =>
    new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "es-ES", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${d}T12:00:00Z`));
  const list = [...rows].sort((a, b) =>
    String(date ? (b.values[date.id] ?? "") : "").localeCompare(
      String(date ? (a.values[date.id] ?? "") : ""),
    ),
  );
  return (
    <div className="m-scroll m-rows">
      {list.length === 0 && <p className="m-empty">{t("mobile.rowsEmpty")}</p>}
      <ul>
        {list.map((r) => {
          const title = r.values[def.titleField];
          const d = date ? r.values[date.id] : undefined;
          return (
            <li key={r.id}>
              <button
                type="button"
                className="m-rows-row"
                onClick={() => void openRow(r.type ?? type, r.id)}
              >
                <span className="m-rows-title">
                  {typeof title === "string" && title ? title : t("page.untitled")}
                </span>
                {typeof d === "string" && d && <span className="m-rows-date">{day(d)}</span>}
                <ChevronRight size={18} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
