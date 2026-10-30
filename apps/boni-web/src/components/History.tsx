import { blocksToMarkdown, SYSTEM_COLUMNS } from "@boni/views";
import { ListChecks, X } from "lucide-react";
import { type CSSProperties, useEffect, useState } from "react";
import type { Page } from "../core/agent.ts";
import type { RowHistory } from "../core/audit.ts";
import type { T } from "../i18n.ts";
import {
  agentApi,
  focusHistory,
  type HistoryMark,
  setHistoryMarks,
  showAudit,
  useStore,
} from "../store.ts";
import { whoColor, whoName } from "./Dash.tsx";
import { systemText } from "./DatabaseBlock.tsx";

/**
 * A row's history (Juan, 2026-10-24), beside its page: its system columns (nobody edits them), every change, and who
 * saw it and what of it. MOCKUP (mockup/historial-visual, Juan 2026-10-30): while it is open, the page itself shows
 * who wrote what, in each one's colour (each block of the text by who wrote it last, as `git blame` from the
 * versions the log keeps; each property by who changed it last), and the panel's legend lights one of them alone.
 */
export function HistoryPanel({
  id,
  type,
  onClose,
}: {
  id: string;
  type: string;
  onClose: () => void;
}) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const doc = useStore((s) => s.rowDoc);
  const focus = useStore((s) => s.historyMarks?.focus ?? null);
  const locale = lang === "en" ? "en-GB" : "es-ES";
  const [h, setH] = useState<RowHistory | null | "loading" | "error">("loading");
  useEffect(() => {
    setH("loading");
    agentApi
      .rowHistory(id)
      .then(setH)
      .catch(() => setH("error"));
  }, [id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const d = h && typeof h === "object" ? h : null;
  // The page in the colours of who wrote it while the panel is open (its text as it was when it opened).
  useEffect(() => {
    if (!d) return;
    setHistoryMarks({ blocks: alignBlame(doc?.spec.blocks ?? [], d.blame), fields: fieldMarks(d) });
    return () => setHistoryMarks(null);
  }, [d, doc?.id]);
  const when = (at: number) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(at);
  return (
    <aside className="side-panel history-panel" aria-label={t("history.title")}>
      <header className="panel-head">
        <h2>{t("history.title")}</h2>
        <button
          type="button"
          className="icon-btn"
          onClick={onClose}
          title={t("models.close")}
          aria-label={t("models.close")}
        >
          <X size={16} strokeWidth={1.8} />
        </button>
      </header>
      <div className="panel-body audit-detail">
        {h === "loading" && <div className="page-loading" role="status" aria-busy="true" />}
        {(h === "error" || h === null) && <p className="muted">{t("history.unavailable")}</p>}
        {d && (
          <>
            <h3 className="models-sub">{t("history.whoDid")}</h3>
            <Legend t={t} d={d} focus={focus} />
            <h3 className="models-sub">{t("history.changes")}</h3>
            <ul className="audit-seen">
              {[...d.changes].reverse().map((c) => (
                <li key={c.seq}>
                  <span>
                    <i className="who-dot" style={{ background: historyColor(c.by) }} />
                    {whoName(t, c.by)} · {t(`activity.kind.${c.kind}`)}
                  </span>
                  <span className="muted small">
                    {when(c.at)}
                    {c.fields.length
                      ? ` · ${c.fields.map((f) => d.names.fields[f] ?? f).join(", ")}`
                      : ""}
                    {c.body ? ` · ${t("history.text")}` : ""}
                  </span>
                </li>
              ))}
            </ul>
            {d.columns && (
              <dl className="history-cols">
                {SYSTEM_COLUMNS.map((c) => {
                  const text = systemText(t, c, d.columns ?? undefined, locale, lang);
                  return text ? (
                    <div key={c}>
                      <dt>{t(`sys.${c}`)}</dt>
                      <dd>{text}</dd>
                    </div>
                  ) : null;
                })}
              </dl>
            )}
            <h3 className="models-sub">{t("history.seenBy")}</h3>
            {d.seenBy.length === 0 ? (
              <p className="small">{t("history.nobody")}</p>
            ) : (
              <ul className="audit-seen">
                {d.seenBy.slice(0, 50).map((s) => (
                  <li key={s.action}>
                    <span>{whoName(t, s.by)}</span>
                    <span className="muted small">
                      {when(s.at)}
                      {s.fields.length
                        ? ` · ${s.fields.map((f) => d.names.fields[f] ?? f).join(", ")}`
                        : ""}
                    </span>
                    <span className={`small ${s.body === "text" ? "audit-text" : "audit-notext"}`}>
                      {s.body === "text" ? t("audit.withText") : t("audit.withoutText")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="btn ghost small" onClick={() => showAudit({ type })}>
              <ListChecks size={14} strokeWidth={1.8} aria-hidden="true" />
              {t("history.openAudit")}
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

/** Each one who wrote here, in their colour, with how much is theirs; a click lights only theirs. */
function Legend({ t, d, focus }: { t: T; d: RowHistory; focus: string | null }) {
  const lines = new Map<string, number>();
  for (const l of d.blame) if (l.text.trim()) lines.set(l.by, (lines.get(l.by) ?? 0) + 1);
  const props = new Map<string, number>();
  for (const m of Object.values(fieldMarks(d))) props.set(m.by, (props.get(m.by) ?? 0) + 1);
  const who = [...new Set([...lines.keys(), ...props.keys()])].sort(
    (a, b) =>
      (lines.get(b) ?? 0) + (props.get(b) ?? 0) * 3 - (lines.get(a) ?? 0) - (props.get(a) ?? 0) * 3,
  );
  if (!who.length) return <p className="small">{t("history.nobody")}</p>;
  return (
    <div className="who-legend">
      {who.map((by) => {
        const n = lines.get(by) ?? 0;
        const p = props.get(by) ?? 0;
        return (
          <button
            key={by}
            type="button"
            className={`who-chip${focus === by ? " on" : ""}${focus && focus !== by ? " off" : ""}`}
            aria-pressed={focus === by}
            style={{ "--who": historyColor(by) } as CSSProperties}
            onClick={() => {
              focusHistory(by);
              // Their first part brought into view (the text can be long).
              requestAnimationFrame(() =>
                document
                  .querySelector(".row-doc .by-who")
                  ?.scrollIntoView({ block: "center", behavior: "smooth" }),
              );
            }}
          >
            <i className="who-dot" />
            <span className="who-chip-name">{whoName(t, by)}</span>
            <span className="muted small">
              {[
                n ? t(n === 1 ? "history.line" : "history.lines", { n }) : "",
                p ? t(p === 1 ? "history.prop" : "history.props", { n: p }) : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </button>
        );
      })}
      <p className="muted small">{focus ? t("history.focusOff") : t("history.focusHint")}</p>
    </div>
  );
}

/** A colour per one who writes: the user's own, every model and assistant as everywhere else in Boni. */
export function historyColor(by: string): string {
  if (by.startsWith("user:")) return "var(--c6)";
  if (by === "import") return "var(--compare)";
  return whoColor(by);
}

/** «Who · when», for the label a coloured block shows under the pointer. */
export function whoLabel(t: T, m: HistoryMark, locale: string): string {
  const at = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    m.at,
  );
  const also = m.others.length ? ` (+ ${m.others.map((o) => whoName(t, o)).join(", ")})` : "";
  return `${whoName(t, m.by)}${also} · ${at}`;
}

/** Each property by who changed it last (the changes come oldest first). */
function fieldMarks(d: RowHistory): Record<string, HistoryMark> {
  const out: Record<string, HistoryMark> = {};
  for (const c of d.changes) for (const f of c.fields) out[f] = { by: c.by, at: c.at, others: [] };
  return out;
}

type Block = Page["spec"]["blocks"][number];

/** A line's text without what makes it a list, a to-do, a heading or a quote. */
const MARKER = /^\s*(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|#{1,6}\s+|>\s?)/;
const bare = (s: string) => s.replace(MARKER, "").trim();

/**
 * Each block of the text with who wrote it last: its lines found in order among the blamed lines of the text (by
 * their words, whatever marks them), and the newest of them decides; the others who wrote some of it are kept.
 */
export function alignBlame(
  blocks: readonly Block[],
  blame: RowHistory["blame"],
): Record<string, HistoryMark> {
  const out: Record<string, HistoryMark> = {};
  let p = 0;
  for (const b of blocks) {
    const own = (b as { text?: unknown }).text;
    const lines = (typeof own === "string" ? own : blocksToMarkdown([b])).split("\n");
    const first = bare(lines[0] ?? "");
    if (!first) continue;
    let j = p;
    while (j < blame.length && bare(blame[j]?.text ?? "") !== first) j++;
    if (j >= blame.length) continue;
    const mine = blame.slice(j, j + lines.length);
    p = j + lines.length;
    const last = mine.reduce((a, x) => (x.at > a.at ? x : a));
    out[b.id] = {
      by: last.by,
      at: last.at,
      others: [...new Set(mine.map((x) => x.by))].filter((x) => x !== last.by),
    };
  }
  return out;
}
