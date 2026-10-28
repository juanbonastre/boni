import { ChevronRight, Database, Eye, EyeOff, FileText, Lock } from "lucide-react";
import { useState } from "react";
import type { TreeCollection } from "../core/agent.ts";
import { openCollection, openPage, openRow, setNotesInTree, useStore } from "../store.ts";

/**
 * The single tree of the sidebar (docs/clases.md §2.7, Juan 2026-10-28): the collections, each inside its mother,
 * and under each the records with a note when the collection shows them (the eye); Boni's own things last, read
 * only. It replaces «Colecciones», «Todas las páginas» and «Páginas».
 */
export function CollectionTree() {
  const t = useStore((s) => s.t);
  const tree = useStore((s) => s.tree);
  const pages = useStore((s) => s.pages);
  const types = useStore((s) => s.dataTypes);
  const [closed, setClosed] = useState<string[]>([]);
  if (!tree) return null;
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const toggle = (id: string) =>
    setClosed((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const templates = (pages ?? []).filter((p) => p.template);
  const system = (types ?? []).filter((x) => x.system);
  return (
    <ul className="nav-list" aria-label={t("tree.label")}>
      {tree.collections
        .filter((c) => !c.parent)
        .sort(byName)
        .map((c) => (
          <Node key={c.id} c={c} depth={0} closed={closed} toggle={toggle} />
        ))}
      <li>
        <Branch
          id="boni"
          name={t("tree.boni")}
          icon={<Lock size={14} strokeWidth={1.8} className="page-icon" />}
          depth={0}
          open={!closed.includes("boni")}
          toggle={toggle}
        />
        {!closed.includes("boni") && (
          <ul className="nav-list">
            {templates.map((p) => (
              <Leaf
                key={p.id}
                name={p.title || t("page.untitled")}
                depth={1}
                onOpen={() => void openPage(p.id)}
              />
            ))}
            {system.map((x) => (
              <Leaf key={x.id} name={x.name} depth={1} table onOpen={() => openCollection(x.id)} />
            ))}
          </ul>
        )}
      </li>
    </ul>
  );
}

function Node({
  c,
  depth,
  closed,
  toggle,
}: {
  c: TreeCollection;
  depth: number;
  closed: string[];
  toggle: (id: string) => void;
}) {
  const t = useStore((s) => s.t);
  const tree = useStore((s) => s.tree);
  const view = useStore((s) => s.view);
  const daughters = (tree?.collections ?? []).filter((x) => x.parent === c.id);
  const notes = c.notes ? (tree?.notes ?? []).filter((n) => n.type === c.id) : [];
  const open = !closed.includes(c.id);
  const kids = daughters.length + notes.length > 0;
  return (
    <li>
      <div
        className={`chart-row page-row${view.kind === "collection" && view.type === c.id ? " active" : ""}`}
        style={{ paddingLeft: depth * 14 }}
      >
        <button
          type="button"
          className={`page-toggle${kids ? (open ? " open" : "") : " static"}`}
          aria-expanded={kids ? open : undefined}
          aria-label={`${open ? t("page.collapse") : t("page.expand")}: ${c.name}`}
          onClick={() => kids && toggle(c.id)}
        >
          <span className="page-icon-slot">
            {c.icon ? (
              <span className="page-icon">{c.icon}</span>
            ) : (
              <Database size={14} strokeWidth={1.8} className="page-icon" />
            )}
          </span>
          {kids && <ChevronRight size={14} strokeWidth={2} className="page-chev" />}
        </button>
        <button type="button" className="chart-main" onClick={() => openCollection(c.id)}>
          <span className="nav-name">{c.name}</span>
        </button>
        <button
          type="button"
          className="icon-btn tiny row-action"
          title={c.notes ? t("tree.notesHide") : t("tree.notesShow")}
          aria-label={`${c.notes ? t("tree.notesHide") : t("tree.notesShow")}: ${c.name}`}
          aria-pressed={c.notes}
          onClick={() => void setNotesInTree(c.id, !c.notes)}
        >
          {c.notes ? <Eye size={13} strokeWidth={1.8} /> : <EyeOff size={13} strokeWidth={1.8} />}
        </button>
        <span className="nav-count muted">{c.count}</span>
      </div>
      {kids && open && (
        <ul className="nav-list">
          {daughters.map((d) => (
            <Node key={d.id} c={d} depth={depth + 1} closed={closed} toggle={toggle} />
          ))}
          {notes.map((n) => (
            <Leaf
              key={n.id}
              name={n.title || t("page.untitled")}
              depth={depth + 1}
              active={view.kind === "row" && view.id === n.id}
              onOpen={() => void openRow(n.type, n.id)}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function Branch({
  id,
  name,
  icon,
  depth,
  open,
  toggle,
}: {
  id: string;
  name: string;
  icon: React.ReactNode;
  depth: number;
  open: boolean;
  toggle: (id: string) => void;
}) {
  const t = useStore((s) => s.t);
  return (
    <div className="chart-row page-row" style={{ paddingLeft: depth * 14 }}>
      <button
        type="button"
        className={`page-toggle${open ? " open" : ""}`}
        aria-expanded={open}
        aria-label={`${open ? t("page.collapse") : t("page.expand")}: ${name}`}
        onClick={() => toggle(id)}
      >
        <span className="page-icon-slot">{icon}</span>
        <ChevronRight size={14} strokeWidth={2} className="page-chev" />
      </button>
      <button type="button" className="chart-main" onClick={() => toggle(id)}>
        <span className="nav-name">{name}</span>
      </button>
    </div>
  );
}

function Leaf({
  name,
  depth,
  active,
  table,
  onOpen,
}: {
  name: string;
  depth: number;
  active?: boolean;
  table?: boolean;
  onOpen: () => void;
}) {
  return (
    <li>
      <div
        className={`chart-row page-row${active ? " active" : ""}`}
        style={{ paddingLeft: depth * 14 }}
      >
        <span className="page-toggle static">
          {table ? (
            <Database size={14} strokeWidth={1.8} className="page-icon" />
          ) : (
            <FileText size={14} strokeWidth={1.8} className="page-icon" />
          )}
        </span>
        <button type="button" className="chart-main" onClick={onOpen}>
          <span className="nav-name">{name}</span>
        </button>
      </div>
    </li>
  );
}
