import { ChevronDown, ChevronRight, FileText, Folder, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { NoteEntry } from "../core/audit.ts";
import type { T } from "../i18n.ts";
import { agentApi, errorText, openRow, useStore } from "../store.ts";
import { whoName } from "./Dash.tsx";

interface FolderNode {
  name: string;
  path: string;
  folders: FolderNode[];
  notes: NoteEntry[];
  /** How many notes inside (all levels) an AI has read. */
  ai: number;
}

/**
 * The notes explorer (Juan, 2026-10-24: in Obsidian he saw every file the AIs used; in Boni he must too): every note
 * at the path it had in the vault, as Obsidian's file tree, folders first. A note an AI has read carries a mark
 * (who and when on hover) and its folder says how many; a search lists the matches flat. A note opens as its row's
 * page (with its history).
 */
export function NotesView() {
  const t = useStore((s) => s.t);
  const [notes, setNotes] = useState<NoteEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => {
    agentApi
      .notes()
      .then((r) => setNotes(r.notes))
      .catch((e) => setError(errorText(t, e)));
  }, []);
  const tree = useMemo(() => (notes ? build(notes) : null), [notes]);
  const q = query.trim().toLocaleLowerCase("es");
  const hits =
    q && notes
      ? notes.filter((n) => `${n.path} ${n.title}`.toLocaleLowerCase("es").includes(q))
      : [];
  const toggle = (p: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  const read = notes?.filter((n) => n.ai.length).length ?? 0;
  return (
    <div className="content dash">
      <header className="dash-head">
        <h1 className="dash-title">{t("nav.notes")}</h1>
        {notes && (
          <span className="muted">
            {t("notes.count", { n: notes.length })} · {t("notes.read", { n: read })}
          </span>
        )}
      </header>
      <p className="cols-help">{t("notes.help")}</p>
      <label className="cols-search notes-search">
        <Search size={14} strokeWidth={1.8} aria-hidden />
        <input
          value={query}
          placeholder={t("notes.search")}
          aria-label={t("notes.search")}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {error && (
        <p className="decide-error" role="alert">
          {error}
        </p>
      )}
      {!notes && !error && <div className="page-loading" role="status" aria-busy="true" />}
      {q ? (
        <ul className="notes-tree" aria-label={t("nav.notes")}>
          {hits.slice(0, 200).map((n) => (
            <NoteRow key={n.id} t={t} n={n} depth={0} label={n.path} />
          ))}
          {hits.length === 0 && <li className="muted small">{t("notes.none")}</li>}
        </ul>
      ) : (
        tree && (
          <ul className="notes-tree" aria-label={t("nav.notes")}>
            <FolderRows t={t} f={tree} depth={0} open={open} toggle={toggle} />
          </ul>
        )
      )}
    </div>
  );
}

function FolderRows({
  t,
  f,
  depth,
  open,
  toggle,
}: {
  t: T;
  f: FolderNode;
  depth: number;
  open: Set<string>;
  toggle: (p: string) => void;
}) {
  return (
    <>
      {f.folders.map((sub) => {
        const on = open.has(sub.path);
        return (
          <li key={sub.path}>
            <button
              type="button"
              className="notes-row notes-folder"
              aria-expanded={on}
              style={{ paddingLeft: 8 + depth * 18 }}
              onClick={() => toggle(sub.path)}
            >
              {on ? (
                <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
              ) : (
                <ChevronRight size={14} strokeWidth={1.8} aria-hidden="true" />
              )}
              <Folder size={14} strokeWidth={1.8} aria-hidden="true" />
              <span className="notes-name">{sub.name}</span>
              {sub.ai > 0 && (
                <span className="notes-ai" title={t("notes.aiIn", { n: sub.ai })}>
                  <Sparkles size={12} strokeWidth={1.8} aria-hidden="true" />
                  {sub.ai}
                </span>
              )}
            </button>
            {on && (
              <ul>
                <FolderRows t={t} f={sub} depth={depth + 1} open={open} toggle={toggle} />
              </ul>
            )}
          </li>
        );
      })}
      {f.notes.map((n) => (
        <NoteRow key={n.id} t={t} n={n} depth={depth} label={n.path.split("/").pop() ?? n.path} />
      ))}
    </>
  );
}

function NoteRow({ t, n, depth, label }: { t: T; n: NoteEntry; depth: number; label: string }) {
  const lang = useStore((s) => s.settings.language);
  const when = n.aiAt
    ? new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "es-ES", { dateStyle: "medium" }).format(
        n.aiAt,
      )
    : "";
  const who = n.ai.map((b) => whoName(t, b)).join(", ");
  return (
    <li>
      <button
        type="button"
        className="notes-row"
        style={{ paddingLeft: 26 + depth * 18 }}
        title={n.title || label}
        onClick={() => void openRow(n.type, n.id)}
      >
        <FileText size={14} strokeWidth={1.8} aria-hidden="true" />
        <span className="notes-name">{label}</span>
        {n.ai.length > 0 && (
          <span className="notes-ai" title={t("notes.aiRead", { who, when })}>
            <Sparkles size={12} strokeWidth={1.8} aria-hidden="true" />
            <span className="sr-only">{t("notes.aiRead", { who, when })}</span>
          </span>
        )}
      </button>
    </li>
  );
}

/** The folders of the notes' paths, folders first and then notes, each by name. */
function build(notes: NoteEntry[]): FolderNode {
  const root: FolderNode = { name: "", path: "", folders: [], notes: [], ai: 0 };
  for (const n of notes) {
    const parts = n.path.split("/");
    let f = root;
    let path = "";
    for (const p of parts.slice(0, -1)) {
      path = path ? `${path}/${p}` : p;
      let sub = f.folders.find((x) => x.name === p);
      if (!sub) {
        sub = { name: p, path, folders: [], notes: [], ai: 0 };
        f.folders.push(sub);
      }
      if (n.ai.length) sub.ai++;
      f = sub;
    }
    f.notes.push(n);
  }
  const sort = (f: FolderNode) => {
    f.folders.sort((a, b) => a.name.localeCompare(b.name, "es"));
    f.notes.sort((a, b) => a.path.localeCompare(b.path, "es"));
    for (const s of f.folders) sort(s);
  };
  sort(root);
  return root;
}
