import { SYSTEM_COLUMNS } from "@boni/views";
import { ListChecks, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { RowHistory } from "../core/audit.ts";
import type { T } from "../i18n.ts";
import { agentApi, showAudit, useStore } from "../store.ts";
import { whoColor, whoName } from "./Dash.tsx";
import { systemText } from "./DatabaseBlock.tsx";

/**
 * A row's history (Juan, 2026-10-24), beside its page: its system columns (nobody edits them), who wrote each
 * paragraph of its text (as `git blame`, from the versions the log keeps), every change, and who saw it and what
 * of it. Lines by the same author in a row are one block with that author's colour.
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
  const when = (at: number) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(at);
  const d = h && typeof h === "object" ? h : null;
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
            {d.blame.some((l) => l.text.trim()) && (
              <>
                <h3 className="models-sub">{t("history.whoWrote")}</h3>
                <Blame t={t} lines={d.blame} />
              </>
            )}
            <h3 className="models-sub">{t("history.changes")}</h3>
            <ul className="audit-seen">
              {[...d.changes].reverse().map((c) => (
                <li key={c.seq}>
                  <span>
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

/** The text, block by block of the same author, each with its colour and name. */
function Blame({ t, lines }: { t: T; lines: RowHistory["blame"] }) {
  const blocks: { by: string; text: string[] }[] = [];
  for (const l of lines) {
    const last = blocks.at(-1);
    if (last && last.by === l.by) last.text.push(l.text);
    else blocks.push({ by: l.by, text: [l.text] });
  }
  return (
    <div className="blame">
      {blocks.map((b, i) => (
        <div key={i} className="blame-block" style={{ borderColor: whoColor(b.by) }}>
          <span className="blame-who">{whoName(t, b.by)}</span>
          <p className="blame-text">{b.text.join("\n").trim() || " "}</p>
        </div>
      ))}
    </div>
  );
}
