import {
  ChevronRight,
  Database,
  FileText,
  Lock,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import {
  AI_LEVELS,
  type AiLevel,
  type DataType,
  type PageInfo,
  type TreeCollection,
  type TreeNote,
} from "../core/agent.ts";
import {
  agentApi,
  deleteCollection,
  deletePage,
  loadDataTypes,
  loadTree,
  moveInTree,
  newNoteIn,
  openCollection,
  openPage,
  openRow,
  trashNote,
  useStore,
} from "../store.ts";
import { CollectionsUsage } from "./Collections.tsx";
import { byName, EyeToggle, NewCollectionInput, treeOrder } from "./CollectionTree.tsx";
import { whoName } from "./Dash.tsx";
import { SystemPill } from "./DatabaseBlock.tsx";
import { MenuRow, MenuSep, PopButton } from "./Popover.tsx";
import { LEVEL_ICONS, ProtectionMenu } from "./Protection.tsx";

/**
 * «Todas las páginas» (Juan, 2026-10-28): what the sidebar's «Páginas» holds, to manage it. The user's pages,
 * every collection inside its mother with all its notes (whatever its eye says) and Boni's own things last, with
 * what the old «Colecciones» had (the usage, a search, the filter by what the AI sees, each protection), the
 * eye, new collections and notes, «Mover a…» and deleting. A search or a level lists what matches flat, each with
 * where it is.
 */
export function AllPagesView() {
  const t = useStore((s) => s.t);
  const tree = useStore((s) => s.tree);
  const types = useStore((s) => s.dataTypes);
  const pages = useStore((s) => s.pages);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<AiLevel | null>(null);
  const [open, setOpen] = useState<string[]>([]);
  const [notes, setNotes] = useState<Record<string, TreeNote[]>>({});
  // Where a new collection is being named: the top level (""), inside a collection, or nowhere.
  const [adding, setAdding] = useState<string | null>(null);
  useEffect(() => {
    void loadDataTypes();
    void loadTree();
  }, []);
  const fetchNotes = (type: string) =>
    agentApi.treeNotes(type).then(
      (list) => setNotes((n) => ({ ...n, [type]: list })),
      () => undefined,
    );
  const toggle = (id: string) => {
    if (open.includes(id)) return setOpen(open.filter((x) => x !== id));
    setOpen([...open, id]);
    void fetchNotes(id);
  };
  // After a change: the notes of every collection open here, again.
  const refresh = () => {
    for (const id of open) void fetchNotes(id);
  };
  const byId = new Map((types ?? []).map((x) => [x.id, x]));
  const cols = tree?.collections ?? [];
  const order = treeOrder(cols);
  const own = (pages ?? []).filter((p) => !p.template);
  const templates = (pages ?? []).filter((p) => p.template);
  const system = (types ?? []).filter((x) => x.system);
  const q = query.trim().toLocaleLowerCase("es");
  const matches = (s: string) => !q || s.toLocaleLowerCase("es").includes(q);
  const atLevel = (type: string) => !level || byId.get(type)?.level === level;
  // Boni's own records are not a level the user chose: they are not counted in the filter.
  const count = (l: AiLevel) => (types ?? []).filter((x) => x.level === l && !x.system).length;
  const where = (type: string) => {
    const at = order.find((o) => o.c.id === type);
    return at ? [...at.path, at.c.name] : [];
  };
  const kit: Kit = { byId, open, toggle, refresh, setAdding };

  const rows: ReactNode[] = [];
  if (adding === "") rows.push(<AddingLine key="new" depth={0} onDone={() => setAdding(null)} />);
  if (q || level) {
    for (const { c, path } of order)
      if (matches(c.name) && atLevel(c.id))
        rows.push(<CollectionLine key={c.id} c={c} depth={0} path={path} kit={kit} />);
    if (q) {
      const seen = new Set<string>();
      for (const n of [...(tree?.notes ?? []), ...Object.values(notes).flat()])
        if (!seen.has(n.id) && matches(n.title) && atLevel(n.type)) {
          seen.add(n.id);
          rows.push(<NoteLine key={n.id} n={n} depth={0} path={where(n.type)} kit={kit} />);
        }
    }
    if (!level) {
      for (const p of [...own, ...templates])
        if (q && matches(p.title)) rows.push(<PageLine key={p.id} p={p} depth={0} />);
      for (const x of system)
        if (matches(x.name)) rows.push(<SystemLine key={x.id} x={x} depth={0} />);
    }
  } else {
    // The user's pages first (until they live in collections, docs/clases.md §3), then the tree.
    const walkPages = (parent: string | null, depth: number) => {
      for (const p of own.filter((x) =>
        parent === null ? !x.parent || !own.some((y) => y.id === x.parent) : x.parent === parent,
      )) {
        rows.push(<PageLine key={p.id} p={p} depth={depth} />);
        if (depth < 6) walkPages(p.id, depth + 1);
      }
    };
    walkPages(null, 0);
    const walk = (c: TreeCollection, depth: number) => {
      rows.push(<CollectionLine key={c.id} c={c} depth={depth} kit={kit} />);
      if (!open.includes(c.id)) return;
      if (adding === c.id)
        rows.push(
          <AddingLine
            key={`new-${c.id}`}
            parent={c.id}
            depth={depth + 1}
            onDone={() => setAdding(null)}
          />,
        );
      const daughters = byName(cols.filter((x) => x.parent === c.id));
      for (const d of daughters) walk(d, depth + 1);
      const list = notes[c.id];
      if (!list) rows.push(<Waiting key={`w-${c.id}`} depth={depth + 1} />);
      else if (!list.length && !daughters.length)
        rows.push(<Muted key={`e-${c.id}`} depth={depth + 1} text={t("tree.noNotes")} />);
      else
        for (const n of list) rows.push(<NoteLine key={n.id} n={n} depth={depth + 1} kit={kit} />);
    };
    for (const { c } of order.filter((o) => o.depth === 0)) walk(c, 0);
    if (templates.length || system.length) {
      const boni = open.includes("boni");
      const flip = () => setOpen(boni ? open.filter((x) => x !== "boni") : [...open, "boni"]);
      rows.push(
        <tr key="boni">
          <td className="is-title" colSpan={COLS}>
            <span className="all-name">
              <Toggle
                open={boni}
                name={t("tree.boni")}
                icon={<Lock size={14} strokeWidth={1.8} />}
                onToggle={flip}
              />
              <button type="button" className="cols-name" onClick={flip}>
                <span>{t("tree.boni")}</span>
              </button>
            </span>
          </td>
        </tr>,
      );
      if (boni) {
        for (const p of templates) rows.push(<PageLine key={p.id} p={p} depth={1} />);
        for (const x of system) rows.push(<SystemLine key={x.id} x={x} depth={1} />);
      }
    }
  }

  return (
    <div className="content page-doc full">
      <div className="doc cols">
        <h1 className="cols-title">{t("nav.notes")}</h1>
        <p className="cols-help">{t("col.help")}</p>
        <div className="cols-tools">
          <label className="cols-search">
            <Search size={14} strokeWidth={1.8} aria-hidden />
            <input
              value={query}
              placeholder={t("col.search")}
              aria-label={t("col.search")}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="cols-filter" role="radiogroup" aria-label={t("col.ai")}>
            {[null, ...AI_LEVELS].map((l) => (
              <button
                key={l ?? "all"}
                type="button"
                role="radio"
                aria-checked={level === l}
                className={`cols-chip${level === l ? " on" : ""}`}
                onClick={() => setLevel(l)}
              >
                {l && LEVEL_ICONS[l]}
                {l ? t(`ai.level.${l}`) : t("col.all")}
                {l && <span className="cols-chip-n">{count(l)}</span>}
              </button>
            ))}
          </div>
          <button type="button" className="btn small all-new" onClick={() => setAdding("")}>
            <Plus size={14} strokeWidth={1.8} />
            {t("tree.newCollection")}
          </button>
        </div>
        {tree === null && types === null ? (
          <div className="page-loading" role="status" aria-busy="true" />
        ) : !rows.length ? (
          <p className="cols-empty">{q || level ? t("col.empty") : t("col.none")}</p>
        ) : (
          <table className="db-table cols-table all-table">
            <thead>
              <tr>
                <th>{t("col.name")}</th>
                <th className="num">{t("col.items")}</th>
                <th>{t("col.ai")}</th>
                <th className="all-eye">{t("tree.inBar")}</th>
                <th className="cols-origin">{t("col.origin")}</th>
                <th className="all-act">
                  <span className="sr-only">{t("page.more")}</span>
                </th>
              </tr>
            </thead>
            <tbody>{rows}</tbody>
          </table>
        )}
        <CollectionsUsage />
      </div>
    </div>
  );
}

/** The table's columns, for a line across all of them. */
const COLS = 6;

/** What every line needs from the view. */
interface Kit {
  byId: Map<string, DataType>;
  open: string[];
  toggle: (id: string) => void;
  refresh: () => void;
  setAdding: (where: string | null) => void;
}

const indent = (depth: number) => ({ paddingLeft: 10 + depth * 18 });

function Toggle({
  open,
  name,
  icon,
  onToggle,
}: {
  open: boolean;
  name: string;
  icon: ReactNode;
  onToggle: () => void;
}) {
  const t = useStore((s) => s.t);
  return (
    <button
      type="button"
      className={`page-toggle${open ? " open" : ""}`}
      aria-expanded={open}
      aria-label={`${open ? t("page.collapse") : t("page.expand")}: ${name}`}
      onClick={onToggle}
    >
      <span className="page-icon-slot">{icon}</span>
      <ChevronRight size={14} strokeWidth={2} className="page-chev" />
    </button>
  );
}

/** Where a line is, when the list is flat (a search): its mothers, muted. */
function Where({ path }: { path?: string[] }) {
  return path?.length ? <span className="all-where">{path.join(" / ")}</span> : null;
}

function CollectionLine({
  c,
  depth,
  path,
  kit,
}: {
  c: TreeCollection;
  depth: number;
  path?: string[];
  kit: Kit;
}) {
  const t = useStore((s) => s.t);
  const type = kit.byId.get(c.id);
  const icon = c.icon ? (
    <span className="page-icon">{c.icon}</span>
  ) : (
    <Database size={14} strokeWidth={1.8} className="page-icon" />
  );
  return (
    <tr className="all-row">
      <td className="is-title" style={indent(depth)}>
        <span className="all-name">
          {path ? (
            <span className="page-toggle static">{icon}</span>
          ) : (
            <Toggle
              open={kit.open.includes(c.id)}
              name={c.name}
              icon={icon}
              onToggle={() => kit.toggle(c.id)}
            />
          )}
          <button
            type="button"
            className="cols-name"
            aria-label={t("col.open", { name: c.name })}
            onClick={() => openCollection(c.id)}
          >
            <span>{c.name}</span>
          </button>
          <Where path={path} />
        </span>
      </td>
      <td className="num">{c.count}</td>
      <td>{type ? <ProtectionMenu type={type} /> : null}</td>
      <td className="all-eye">
        <EyeToggle c={c} always />
      </td>
      <td className="cols-origin">{type?.zone ? t(`db.zone.${type.zone}`) : ""}</td>
      <td className="all-act">
        <PopButton
          className="icon-btn tiny"
          title={`${t("page.more")}: ${c.name}`}
          label={<MoreHorizontal size={14} strokeWidth={1.8} />}
        >
          {(close) => (
            <LineMenu
              close={close}
              move={{ what: { collection: c.id }, from: c.parent ?? null, after: kit.refresh }}
            >
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
                  if (!kit.open.includes(c.id)) kit.toggle(c.id);
                  kit.setAdding(c.id);
                }}
              />
            </LineMenu>
          )}
        </PopButton>
      </td>
    </tr>
  );
}

function NoteLine({
  n,
  depth,
  path,
  kit,
}: {
  n: TreeNote;
  depth: number;
  path?: string[];
  kit: Kit;
}) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const name = n.title || t("page.untitled");
  const ai = n.ai ?? [];
  const read = ai.length
    ? t("notes.aiRead", {
        who: ai.map((b) => whoName(t, b)).join(", "),
        when: n.aiAt
          ? new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "es-ES", {
              dateStyle: "medium",
            }).format(n.aiAt)
          : "",
      })
    : "";
  return (
    <tr className="all-row">
      <td className="is-title" style={indent(depth)}>
        <span className="all-name">
          <span className="page-toggle static">
            <FileText size={14} strokeWidth={1.8} className="page-icon" />
          </span>
          <button
            type="button"
            className="cols-name all-note"
            onClick={() => void openRow(n.type, n.id)}
          >
            <span>{name}</span>
          </button>
          {read && (
            <span className="notes-ai" title={read}>
              <Sparkles size={12} strokeWidth={1.8} aria-hidden="true" />
              <span className="sr-only">{read}</span>
            </span>
          )}
          <Where path={path} />
        </span>
      </td>
      <td />
      <td />
      <td className="all-eye" />
      <td className="cols-origin" />
      <td className="all-act">
        <PopButton
          className="icon-btn tiny"
          title={`${t("page.more")}: ${name}`}
          label={<MoreHorizontal size={14} strokeWidth={1.8} />}
        >
          {(close) => (
            <LineMenu
              close={close}
              move={{ what: { row: n.id }, from: n.type, after: kit.refresh }}
              remove={{
                label: t("tree.deleteNote"),
                run: () => void trashNote(n.type, n.id).then(kit.refresh),
              }}
            />
          )}
        </PopButton>
      </td>
    </tr>
  );
}

/** A page of the user's (or one of Boni's templates, read only here). */
function PageLine({ p, depth }: { p: PageInfo; depth: number }) {
  const t = useStore((s) => s.t);
  const name = p.title || t("page.untitled");
  return (
    <tr className="all-row">
      <td className="is-title" style={indent(depth)}>
        <span className="all-name">
          <span className="page-toggle static">
            {p.icon ? (
              <span className="page-icon">{p.icon}</span>
            ) : (
              <FileText size={14} strokeWidth={1.8} className="page-icon" />
            )}
          </span>
          <button type="button" className="cols-name all-note" onClick={() => void openPage(p.id)}>
            <span>{name}</span>
          </button>
        </span>
      </td>
      <td />
      <td />
      <td className="all-eye" />
      <td className="cols-origin" />
      <td className="all-act">
        {!p.template && (
          <PopButton
            className="icon-btn tiny"
            title={`${t("page.more")}: ${name}`}
            label={<MoreHorizontal size={14} strokeWidth={1.8} />}
          >
            {(close) => (
              <div className="menu-list" role="menu">
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
        )}
      </td>
    </tr>
  );
}

/** One of Boni's own collections: read only, opened as any other. */
function SystemLine({ x, depth }: { x: DataType; depth: number }) {
  const t = useStore((s) => s.t);
  return (
    <tr className="all-row">
      <td className="is-title" style={indent(depth)}>
        <span className="all-name">
          <span className="page-toggle static">
            <Database size={14} strokeWidth={1.8} className="page-icon" />
          </span>
          <button
            type="button"
            className="cols-name"
            aria-label={t("col.open", { name: x.name })}
            onClick={() => openCollection(x.id)}
          >
            <span>{x.name}</span>
          </button>
        </span>
      </td>
      <td className="num">{x.count}</td>
      <td>
        <SystemPill />
      </td>
      <td className="all-eye" />
      <td className="cols-origin" />
      <td className="all-act" />
    </tr>
  );
}

function AddingLine({
  parent,
  depth,
  onDone,
}: {
  parent?: string;
  depth: number;
  onDone: () => void;
}) {
  return (
    <tr>
      <td colSpan={COLS} style={indent(depth)}>
        <NewCollectionInput parent={parent} depth={0} stay onDone={onDone} />
      </td>
    </tr>
  );
}

function Waiting({ depth }: { depth: number }) {
  return (
    <tr aria-busy="true">
      <td colSpan={COLS} style={indent(depth)}>
        <span className="all-where">…</span>
      </td>
    </tr>
  );
}

function Muted({ depth, text }: { depth: number; text: string }) {
  return (
    <tr>
      <td colSpan={COLS} style={indent(depth)}>
        <span className="all-where">{text}</span>
      </td>
    </tr>
  );
}

/**
 * A line's menu: its own items, «Mover a…» (which turns the menu into the list of where it can go: never into
 * itself or a daughter of its own) and deleting.
 */
function LineMenu({
  close,
  move,
  remove,
  children,
}: {
  close: () => void;
  move: { what: { collection: string } | { row: string }; from: string | null; after: () => void };
  remove?: { label: string; run: () => void };
  children?: ReactNode;
}) {
  const t = useStore((s) => s.t);
  const tree = useStore((s) => s.tree);
  const [moving, setMoving] = useState(false);
  const self = "collection" in move.what ? move.what.collection : null;
  if (moving) {
    const targets = treeOrder(tree?.collections ?? []).filter(
      ({ c, mothers }) =>
        c.id !== move.from && (!self || (c.id !== self && !mothers.includes(self))),
    );
    const go = (to: string | null) => {
      close();
      void moveInTree(move.what, to).then(move.after);
    };
    return (
      <div className="menu-list all-move" role="menu" aria-label={t("tree.moveTo")}>
        {self && move.from !== null && (
          <MenuRow label={t("tree.toRoot")} onClick={() => go(null)} />
        )}
        {targets.map(({ c, path }) => (
          <MenuRow key={c.id} label={[...path, c.name].join(" / ")} onClick={() => go(c.id)} />
        ))}
      </div>
    );
  }
  return (
    <div className="menu-list" role="menu">
      {children}
      <MenuRow label={t("tree.moveTo")} onClick={() => setMoving(true)} />
      <MenuSep />
      <MenuRow
        label={remove?.label ?? t("tree.delete")}
        danger
        onClick={() => {
          close();
          if (remove) remove.run();
          else if (self) void deleteCollection(self).then(move.after);
        }}
      />
    </div>
  );
}
