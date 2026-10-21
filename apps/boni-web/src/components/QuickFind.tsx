import { FileText, RotateCcw, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PageInfo } from "../core/agent.ts";
import { closeTrash, openFind, openPage, restoreFromTrash, useStore } from "../store.ts";

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Where a page is: the names of the pages above it. */
function pathOf(p: PageInfo, pages: PageInfo[], untitled: string): string {
  const names: string[] = [];
  const seen = new Set([p.id]);
  for (let at = p.parent; at && !seen.has(at); ) {
    seen.add(at);
    const q = pages.find((x) => x.id === at);
    if (!q) break;
    names.unshift(q.title || untitled);
    at = q.parent;
  }
  return names.join(" / ");
}

/**
 * Ctrl+K, as Notion's search: a box over the window, the pages that match what is typed (accents and
 * case do not matter), arrows and Enter to open one, Esc to close.
 */
export function QuickFind() {
  const t = useStore((s) => s.t);
  const pages = useStore((s) => s.pages) ?? [];
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const found = useMemo(() => {
    const q = fold(query.trim());
    const all = [...pages].sort((a, b) => a.position - b.position);
    return (q ? all.filter((p) => fold(p.title || t("page.untitled")).includes(q)) : all).slice(
      0,
      50,
    );
  }, [query, pages, t]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const go = (p: PageInfo | undefined) => {
    if (!p) return;
    openFind(false);
    void openPage(p.id);
  };
  return (
    <div
      className="find-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) openFind(false);
      }}
    >
      <div className="find-box" role="dialog" aria-label={t("find.title")}>
        <div className="find-input">
          <Search size={16} strokeWidth={1.8} />
          <input
            // biome-ignore lint/a11y/noAutofocus: the search opens to be typed in
            autoFocus
            value={query}
            placeholder={t("find.placeholder")}
            aria-label={t("find.placeholder")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const n = found.length || 1;
                setActive((a) => (a + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(found[active]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                openFind(false);
              }
            }}
          />
        </div>
        <div className="find-list" ref={list} role="listbox" aria-label={t("nav.pages")}>
          {found.length === 0 && <p className="find-none">{t("find.none")}</p>}
          {found.map((p, i) => {
            const path = pathOf(p, pages, t("page.untitled"));
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={i === active}
                data-i={i}
                className={`find-row${i === active ? " active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(p)}
              >
                <span className="find-icon">
                  {p.icon || <FileText size={15} strokeWidth={1.8} />}
                </span>
                <span className={`find-name${p.title ? "" : " untitled"}`}>
                  {p.title || t("page.untitled")}
                </span>
                {path && <span className="find-path">{path}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Notion's Trash: the pages deleted, the latest first, each with Restore. */
export function TrashDialog() {
  const t = useStore((s) => s.t);
  const trash = useStore((s) => s.trash) ?? [];
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeTrash();
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  return (
    <div
      className="find-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) closeTrash();
      }}
    >
      <div className="find-box" role="dialog" aria-label={t("page.trash")}>
        <div className="find-head">
          <h2>{t("page.trash")}</h2>
          <button
            type="button"
            className="icon-btn"
            onClick={closeTrash}
            title={t("settings.close")}
            aria-label={t("settings.close")}
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>
        <p className="find-help">{t("page.trashHelp")}</p>
        <div className="find-list">
          {trash.length === 0 && <p className="find-none">{t("page.trashEmpty")}</p>}
          {trash.map((p) => (
            <div key={p.id} className="find-row static">
              <span className="find-icon">
                {p.icon || <FileText size={15} strokeWidth={1.8} />}
              </span>
              <span className={`find-name${p.title ? "" : " untitled"}`}>
                {p.title || t("page.untitled")}
              </span>
              <button
                type="button"
                className="btn ghost small"
                onClick={() => void restoreFromTrash(p.id)}
              >
                <RotateCcw size={14} strokeWidth={1.8} />
                {t("page.restore")}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
