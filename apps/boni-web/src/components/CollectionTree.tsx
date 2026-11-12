import {
  ChevronRight,
  Database,
  Eye,
  EyeOff,
  FileText,
  Lock,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TreeCollection } from "../core/agent.ts";
import { chipTitle, pointAttrs } from "../core/pointing.ts";
import {
  deleteCollection,
  newCollection,
  newNoteIn,
  openCollection,
  openPage,
  openRow,
  renameCollection,
  renameNote,
  setNotesInTree,
  showMap,
  toast,
  toggleFold,
  trashNote,
  useStore,
} from "../store.ts";
import { MenuRow, MenuSep, PointMenu, PopButton } from "./Popover.tsx";

/**
 * The collections of the sidebar's «Páginas» (docs/clases.md §2.7; Juan, 2026-10-28): each inside its mother, and
 * under each the records with a note when the collection shows them (the eye); Boni's own things last, read only.
 * Here they are opened, added and deleted; «Todas las páginas» manages them (filter, protection, move).
 */
export function CollectionTree() {
  const t = useStore((s) => s.t);
  const tree = useStore((s) => s.tree);
  const pages = useStore((s) => s.pages);
  const types = useStore((s) => s.dataTypes);
  const opened = useStore((s) => s.fold.branches);
  const [adding, setAdding] = useState<string | null>(null);
  const toggle = (id: string) => toggleFold("branches", id);
  const templates = (pages ?? []).filter((p) => p.template);
  // Boni's records («Mis datos» has its own place, above).
  const system = (types ?? []).filter((x) => x.system && !x.editable);
  const boni = opened.includes("boni");
  const tools: NodeTools = {
    opened,
    toggle,
    adding,
    add: (inside) => {
      toggleFold("branches", inside, true);
      setAdding(inside);
    },
    done: () => setAdding(null),
  };
  return (
    <>
      {treeOrder(tree?.collections ?? [])
        .filter((x) => x.depth === 0)
        .map(({ c }) => (
          <Node key={c.id} c={c} depth={0} tools={tools} />
        ))}
      {(templates.length > 0 || system.length > 0) && (
        <li>
          <div className="chart-row tree-row">
            <button
              type="button"
              className={`page-toggle${boni ? " open" : ""}`}
              aria-expanded={boni}
              aria-label={`${boni ? t("page.collapse") : t("page.expand")}: ${t("tree.boni")}`}
              onClick={() => toggle("boni")}
            >
              <span className="page-icon-slot">
                <Lock size={14} strokeWidth={1.8} className="page-icon" />
              </span>
              <ChevronRight size={14} strokeWidth={2} className="page-chev" />
            </button>
            <button type="button" className="chart-main" onClick={() => toggle("boni")}>
              <span className="nav-name">{t("tree.boni")}</span>
            </button>
          </div>
          {boni && (
            <ul className="nav-list">
              {templates.map((p) => (
                <Leaf
                  key={p.id}
                  name={p.title || t("page.untitled")}
                  depth={1}
                  active={p.id}
                  onOpen={() => void openPage(p.id)}
                />
              ))}
              {system.map((x) => (
                <Leaf
                  key={x.id}
                  name={x.name}
                  depth={1}
                  table
                  active={x.id}
                  onOpen={() => openCollection(x.id)}
                />
              ))}
            </ul>
          )}
        </li>
      )}
    </>
  );
}

interface NodeTools {
  opened: string[];
  toggle: (id: string) => void;
  /** The collection a new daughter is being named in. */
  adding: string | null;
  add: (inside: string) => void;
  done: () => void;
}

function Node({ c, depth, tools }: { c: TreeCollection; depth: number; tools: NodeTools }) {
  const t = useStore((s) => s.t);
  const tree = useStore((s) => s.tree);
  const view = useStore((s) => s.view);
  const daughters = byName((tree?.collections ?? []).filter((x) => x.parent === c.id));
  const notes = c.notes ? (tree?.notes ?? []).filter((n) => n.type === c.id) : [];
  const adding = tools.adding === c.id;
  // Lit when it is open, or one of its records whose note the tree does not show (its notes hidden).
  const lit =
    (view.kind === "collection" && view.type === c.id) ||
    (view.kind === "row" && view.type === c.id && !notes.some((n) => n.id === view.id));
  const kids = daughters.length + notes.length > 0 || adding;
  const open = kids && (tools.opened.includes(c.id) || adding);
  // The right button opens the same menu as «Más opciones», where the pointer is (task 42, as Notion's).
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const items = (close: () => void) => (
    <div className="menu-list" role="menu">
      <MenuRow
        label={t("tree.newNote")}
        onClick={() => {
          close();
          void newNoteIn(c.id);
        }}
      />
      <MenuRow
        label={t("tree.newInside")}
        onClick={() => {
          close();
          tools.add(c.id);
        }}
      />
      <MenuRow
        label={t("tree.rename")}
        onClick={() => {
          close();
          setRenaming(true);
        }}
      />
      <MenuRow
        label={t("map.show")}
        onClick={() => {
          close();
          showMap(`col:${c.id}`);
        }}
      />
      <MenuSep />
      <MenuRow
        label={t("tree.delete")}
        danger
        boniAction="schema.delete_type"
        onClick={() => {
          close();
          void deleteCollection(c.id);
        }}
      />
    </div>
  );
  const icon = c.icon ? (
    <span className="page-icon">{c.icon}</span>
  ) : (
    <Database size={14} strokeWidth={1.8} className="page-icon" />
  );
  return (
    <li>
      <div
        className={`chart-row tree-row${lit ? " active" : ""}${menu ? " menu-open" : ""}`}
        style={{ paddingLeft: depth * 14 }}
        {...pointAttrs(
          { kind: "collection", id: c.id },
          chipTitle(t("point.kind.collection"), c.name),
        )}
        onContextMenu={(e) => {
          if (renaming) return;
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {kids ? (
          <button
            type="button"
            className={`page-toggle${open ? " open" : ""}`}
            aria-expanded={open}
            aria-label={`${open ? t("page.collapse") : t("page.expand")}: ${c.name}`}
            onClick={() => tools.toggle(c.id)}
          >
            <span className="page-icon-slot">{icon}</span>
            <ChevronRight size={14} strokeWidth={2} className="page-chev" />
          </button>
        ) : (
          <span className="page-toggle static">{icon}</span>
        )}
        {renaming ? (
          <RenameInput
            name={c.name}
            label={`${t("tree.rename")}: ${c.name}`}
            boniAction="schema.rename_type"
            onDone={(name) => {
              setRenaming(false);
              if (name) void renameCollection(c.id, name);
            }}
          />
        ) : (
          <button type="button" className="chart-main" onClick={() => openCollection(c.id)}>
            <span className="nav-name">{c.name}</span>
          </button>
        )}
        <EyeToggle c={c} />
        <PopButton
          className="icon-btn tiny row-action"
          title={`${t("page.more")}: ${c.name}`}
          align="start"
          label={<MoreHorizontal size={13} strokeWidth={1.8} />}
        >
          {items}
        </PopButton>
        <button
          type="button"
          className="icon-btn tiny row-action"
          title={t("tree.newNote")}
          aria-label={`${t("tree.newNote")}: ${c.name}`}
          onClick={() => void newNoteIn(c.id)}
        >
          <Plus size={13} strokeWidth={1.8} />
        </button>
      </div>
      {menu && (
        <PointMenu
          x={menu.x}
          y={menu.y}
          label={`${t("page.more")}: ${c.name}`}
          onClose={() => setMenu(null)}
        >
          {items}
        </PointMenu>
      )}
      {open && (
        <ul className="nav-list" data-boni-action="schema.describe">
          {adding && (
            <li>
              <NewCollectionInput
                parent={c.id}
                depth={depth + 1}
                onDone={() => {
                  tools.done();
                }}
              />
            </li>
          )}
          {daughters.map((d) => (
            <Node key={d.id} c={d} depth={depth + 1} tools={tools} />
          ))}
          {notes.map((n) => (
            <Leaf
              key={n.id}
              name={n.title || t("page.untitled")}
              depth={depth + 1}
              active={n.id}
              onOpen={() => void openRow(n.type, n.id)}
              onDelete={() => void trashNote(n.type, n.id)}
              onRename={(name) => void renameNote(n.type, n.id, name)}
              link={`boni://note?id=${n.id}`}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Whether a collection's records with a note show in the tree (the account's choice, on every device). */
export function EyeToggle({ c, always }: { c: TreeCollection; always?: boolean }) {
  const t = useStore((s) => s.t);
  const label = c.notes ? t("tree.notesHide") : t("tree.notesShow");
  return (
    <button
      type="button"
      className={`icon-btn tiny${always ? "" : " row-action"}${c.notes ? " on" : ""}`}
      title={label}
      aria-label={`${label}: ${c.name}`}
      aria-pressed={c.notes}
      data-boni-action="schema.set_tree"
      onClick={() => void setNotesInTree(c.id, !c.notes)}
    >
      {c.notes ? <Eye size={13} strokeWidth={1.8} /> : <EyeOff size={13} strokeWidth={1.8} />}
    </button>
  );
}

/** A new collection's name, typed in place (Enter makes it, Escape or leaving it empty does not). */
export function NewCollectionInput({
  parent,
  depth,
  stay,
  onDone,
}: {
  parent?: string;
  depth: number;
  /** Not opened once made (in «Todas las páginas»). */
  stay?: boolean;
  onDone: (made: boolean) => void;
}) {
  const t = useStore((s) => s.t);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const make = async () => {
    const n = name.trim();
    if (!n) return onDone(false);
    setBusy(true);
    const ok = await newCollection(n, parent, stay);
    setBusy(false);
    // A taken name keeps the box, to change it.
    if (ok) onDone(true);
  };
  return (
    <div className="chart-row tree-row tree-new" style={{ paddingLeft: depth * 14 }}>
      <span className="page-toggle static">
        <Database size={14} strokeWidth={1.8} className="page-icon" />
      </span>
      <input
        // biome-ignore lint/a11y/noAutofocus: it appears because the user asked to name a collection
        autoFocus
        value={name}
        // Read only while it is made (disabled would lose the focus, and with it Enter and Escape).
        readOnly={busy}
        data-boni-action="schema.create_type"
        placeholder={t("tree.namePlaceholder")}
        aria-label={t("tree.namePlaceholder")}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void make();
          if (e.key === "Escape") {
            e.stopPropagation();
            onDone(false);
          }
        }}
        onBlur={() => {
          if (!name.trim() && !busy) onDone(false);
        }}
      />
    </div>
  );
}

/**
 * A name changed in place, in its row of the sidebar (task 42): Enter or leaving it keeps a new name, Escape or
 * leaving it empty does not.
 */
export function RenameInput({
  name,
  label,
  boniAction,
  onDone,
}: {
  name: string;
  label: string;
  /** The action it runs (F10), for Boni over the screen. */
  boniAction?: string;
  onDone: (name: string | null) => void;
}) {
  const [value, setValue] = useState(name);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (keep: boolean) => {
    if (done.current) return;
    done.current = true;
    const v = value.replace(/\s+/g, " ").trim();
    onDone(keep && v && v !== name ? v : null);
  };
  // After the menu it was asked from has gone (its focus with it).
  useEffect(() => {
    const id = requestAnimationFrame(() => ref.current?.select());
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <input
      ref={ref}
      className="tree-rename"
      data-boni-action={boniAction}
      value={value}
      aria-label={label}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") {
          e.stopPropagation();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
    />
  );
}

function Leaf({
  name,
  depth,
  active,
  table,
  onOpen,
  onDelete,
  onRename,
  link,
}: {
  name: string;
  depth: number;
  /** The id that, open, makes it the current row. */
  active: string;
  table?: boolean;
  onOpen: () => void;
  onDelete?: () => void;
  onRename?: (name: string) => void;
  /** Its `boni://` link, to copy. */
  link?: string;
}) {
  const t = useStore((s) => s.t);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const items = (close: () => void) => (
    <div className="menu-list" role="menu">
      {onRename && (
        <MenuRow
          label={t("tree.rename")}
          onClick={() => {
            close();
            setRenaming(true);
          }}
        />
      )}
      {link && (
        <MenuRow
          label={t("db.copyLink")}
          onClick={() => {
            close();
            void navigator.clipboard
              ?.writeText(link)
              .then(() => toast(t("db.linkCopied")))
              .catch(() => {});
          }}
        />
      )}
      {(onRename || link) && <MenuSep />}
      {onDelete && (
        <MenuRow
          label={t("tree.deleteNote")}
          danger
          onClick={() => {
            close();
            onDelete();
          }}
        />
      )}
    </div>
  );
  const on = useStore(
    (s) =>
      (s.view.kind === "row" && s.view.id === active) ||
      (s.view.kind === "page" && s.view.id === active) ||
      (s.view.kind === "collection" && s.view.type === active),
  );
  return (
    <li>
      <div
        className={`chart-row tree-row${on ? " active" : ""}${menu ? " menu-open" : ""}`}
        style={{ paddingLeft: depth * 14 }}
        {...pointAttrs(
          table ? { kind: "collection", id: active } : { kind: "row", id: active },
          chipTitle(t(table ? "point.kind.collection" : "point.kind.page"), name),
        )}
        onContextMenu={(e) => {
          // Boni's own things have nothing to be done with.
          if (!onDelete || renaming) return;
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <span className="page-toggle static">
          {table ? (
            <Database size={14} strokeWidth={1.8} className="page-icon" />
          ) : (
            <FileText size={14} strokeWidth={1.8} className="page-icon" />
          )}
        </span>
        {renaming && onRename ? (
          <RenameInput
            name={name}
            label={`${t("tree.rename")}: ${name}`}
            onDone={(next) => {
              setRenaming(false);
              if (next) onRename(next);
            }}
          />
        ) : (
          <button type="button" className="chart-main" onClick={onOpen}>
            <span className="nav-name">{name}</span>
          </button>
        )}
        {onDelete && (
          <PopButton
            className="icon-btn tiny row-action"
            title={`${t("page.more")}: ${name}`}
            align="start"
            label={<MoreHorizontal size={13} strokeWidth={1.8} />}
          >
            {items}
          </PopButton>
        )}
      </div>
      {menu && (
        <PointMenu
          x={menu.x}
          y={menu.y}
          label={`${t("page.more")}: ${name}`}
          onClose={() => setMenu(null)}
        >
          {items}
        </PointMenu>
      )}
    </li>
  );
}

export const byName = <X extends { name: string }>(list: X[]) =>
  [...list].sort((a, b) => a.name.localeCompare(b.name, "es"));

/** A collection in the tree's order: how deep, and its mothers' names and ids (the farthest first). */
export interface Placed {
  c: TreeCollection;
  depth: number;
  path: string[];
  mothers: string[];
}

/**
 * The collections in the tree's order (each mother before her daughters, sisters by name). A collection whose
 * mother is not in the list sits at the top (never lost).
 */
export function treeOrder(list: TreeCollection[]): Placed[] {
  const ids = new Set(list.map((c) => c.id));
  const out: Placed[] = [];
  const walk = (c: TreeCollection, depth: number, path: string[], mothers: string[]) => {
    out.push({ c, depth, path, mothers });
    for (const d of byName(list.filter((x) => x.parent === c.id)))
      if (depth < 20) walk(d, depth + 1, [...path, c.name], [...mothers, c.id]);
  };
  for (const c of byName(list.filter((x) => !x.parent || !ids.has(x.parent)))) walk(c, 0, [], []);
  return out;
}
