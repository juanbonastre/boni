import { ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  type AuditAction,
  type AuditDetail,
  type AuditNames,
  type AuditSeen,
  actorKind,
} from "../core/audit.ts";
import type { T } from "../i18n.ts";
import { type AuditFilter, agentApi, errorText, showAudit, useStore } from "../store.ts";
import { whoColor, whoName } from "./Dash.tsx";

const WHO = [
  { key: "all", by: {} },
  { key: "models", by: { who: "model:" } },
  { key: "mcp", by: { who: "mcp:" } },
  { key: "boni", by: { by: "agent" } },
  { key: "people", by: { who: "user:" } },
] as const;
const PAGE = 50;

/**
 * «Auditoría» (Juan, 2026-10-24): every action of anyone, as a read-only collection: when, who (each kind of actor in
 * its colour), what, and on what (the collections and records it saw, what it changed). A row opens its detail on
 * the right: what reached the actor field by field (the note's text or not), what it wrote (a model's own answer
 * included), its arguments and whether it was allowed. The chains are verified on demand.
 */
export function AuditView({ filter }: { filter: AuditFilter }) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const types = useStore((s) => s.dataTypes);
  const [rows, setRows] = useState<AuditAction[]>([]);
  const [names, setNames] = useState<AuditNames>({ types: {}, fields: {}, titles: {} });
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<number | null>(null);
  const [verified, setVerified] = useState<boolean | null | "checking">(null);
  const load = async (before?: number) => {
    setLoading(true);
    try {
      const r = await agentApi.auditActions({
        ...filter,
        ...(before ? { before } : {}),
        limit: PAGE,
      });
      setRows((x) => (before ? [...x, ...r.actions] : r.actions));
      setNames((n) =>
        before
          ? {
              types: { ...n.types, ...r.names.types },
              fields: { ...n.fields, ...r.names.fields },
              titles: { ...n.titles, ...r.names.titles },
            }
          : r.names,
      );
      setMore(r.actions.length === PAGE);
      setError(null);
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    setOpen(null);
    void load();
  }, [filter.who, filter.by, filter.type, filter.run]);
  const verify = async () => {
    setVerified("checking");
    try {
      setVerified(await agentApi.auditVerify());
    } catch {
      setVerified(null);
    }
  };
  const when = new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "es-ES", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const whoKey =
    WHO.find((w) =>
      "who" in w.by
        ? w.by.who === filter.who
        : "by" in w.by
          ? w.by.by === filter.by
          : !filter.who && !filter.by,
    )?.key ?? "all";
  return (
    <div className="models-view">
      <div className="content dash">
        <header className="dash-head">
          <h1 className="dash-title">{t("audit.title")}</h1>
          {verified === true && (
            <span className="audit-chain ok">
              <ShieldCheck size={14} strokeWidth={1.8} aria-hidden="true" />
              {t("audit.verified")}
            </span>
          )}
          {verified === false && (
            <span className="audit-chain bad">
              <ShieldAlert size={14} strokeWidth={1.8} aria-hidden="true" />
              {t("audit.broken")}
            </span>
          )}
          {verified !== true && verified !== false && (
            <button
              type="button"
              className="btn ghost small"
              disabled={verified === "checking"}
              onClick={() => void verify()}
            >
              {verified === "checking" ? t("audit.verifying") : t("audit.verify")}
            </button>
          )}
        </header>
        <p className="cols-help">{t("audit.help")}</p>
        <div className="audit-filters">
          <span className="segmented" role="radiogroup" aria-label={t("audit.who")}>
            {WHO.map((w) => (
              <button
                key={w.key}
                type="button"
                role="radio"
                aria-checked={whoKey === w.key}
                className={whoKey === w.key ? "on" : ""}
                onClick={() =>
                  showAudit({ ...(filter.type ? { type: filter.type } : {}), ...w.by })
                }
              >
                {t(`audit.whoKind.${w.key}`)}
              </button>
            ))}
          </span>
          <select
            className="audit-type"
            aria-label={t("audit.collection")}
            value={filter.type ?? ""}
            onChange={(e) => {
              const { type: _t, ...rest } = filter;
              showAudit(e.target.value ? { ...rest, type: e.target.value } : rest);
            }}
          >
            <option value="">{t("audit.allCollections")}</option>
            {(types ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          {filter.run && (
            <button
              type="button"
              className="btn ghost small"
              onClick={() => {
                const { run: _r, ...rest } = filter;
                showAudit(rest);
              }}
            >
              {t("audit.oneRun")}
              <X size={12} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>
        {error && (
          <p className="decide-error" role="alert">
            {error}
          </p>
        )}
        {!error && !loading && rows.length === 0 && <p className="muted">{t("audit.empty")}</p>}
        {rows.length > 0 && (
          <div className="audit-table">
            <div className="audit-tr audit-th" aria-hidden="true">
              <span>{t("audit.col.when")}</span>
              <span>{t("audit.col.who")}</span>
              <span>{t("audit.col.what")}</span>
              <span>{t("audit.col.on")}</span>
            </div>
            {rows.map((a) => (
              <button
                key={a.seq}
                type="button"
                className={`audit-tr${open === a.seq ? " on" : ""}${a.decision === "deny" ? " denied" : ""}`}
                onClick={() => setOpen(open === a.seq ? null : a.seq)}
              >
                <span className="muted">{when.format(a.at)}</span>
                <span className="audit-who">
                  <span className="audit-dot" style={{ background: whoColor(a.by) }} />
                  <span className="audit-ellipsis">{whoName(t, a.by)}</span>
                </span>
                <span className="audit-ellipsis">{actionTitle(t, a)}</span>
                <span className="audit-ellipsis muted">{actionOn(t, a, names)}</span>
              </button>
            ))}
          </div>
        )}
        {loading && <div className="page-loading" role="status" aria-busy="true" />}
        {more && !loading && (
          <button
            type="button"
            className="btn audit-more"
            onClick={() => void load(rows.at(-1)?.seq)}
          >
            {t("audit.more")}
          </button>
        )}
      </div>
      {open !== null && <ActionPanel t={t} seq={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** What an action was, in words: «Buscó «dentista»», «Leyó un correo», «Creó», «Descargó una web». */
export function actionTitle(t: T, a: AuditAction): string {
  const verb = t(`audit.tool.${a.tool}`);
  const known = verb !== `audit.tool.${a.tool}`;
  const query = a.target?.query;
  const base = known ? verb : a.tool;
  if (a.decision === "deny") return t("audit.deniedAction", { what: base });
  return query ? `${base} «${query}»` : base;
}

/** What it was on: the collections and how many records it saw (with the text or not), and what it changed. */
export function actionOn(t: T, a: AuditAction, names: AuditNames): string {
  if (a.tool === "net.fetch" && a.target?.url) return a.target.url;
  const parts: string[] = [];
  const byType = new Map<string, AuditSeen[]>();
  for (const s of a.seen) byType.set(s.type, [...(byType.get(s.type) ?? []), s]);
  for (const [type, seen] of byType) {
    const name = names.types[type] ?? type;
    const text = seen.some((s) => s.body === "text");
    parts.push(
      seen.length === 1
        ? `${name} · ${names.titles[seen[0]?.entity ?? ""] || t("audit.oneRecord")}${text ? ` · ${t("audit.withText")}` : ""}`
        : `${name} · ${t("audit.records", { n: seen.length })}${text ? ` · ${t("audit.withText")}` : ""}`,
    );
  }
  for (const w of a.wrote.slice(0, 2))
    parts.push(`${t(`activity.kind.${w.kind}`)}: ${names.titles[w.target] || w.target}`);
  if (a.wrote.length > 2) parts.push(t("audit.andMore", { n: a.wrote.length - 2 }));
  if (!parts.length) return actorKind(a.by) === "model" ? t("audit.noData") : "";
  return parts.join(" · ");
}

/** One action in full, on the right. */
function ActionPanel({ t, seq, onClose }: { t: T; seq: number; onClose: () => void }) {
  const lang = useStore((s) => s.settings.language);
  const [d, setD] = useState<AuditDetail | null | "loading" | "error">("loading");
  useEffect(() => {
    setD("loading");
    agentApi
      .auditAction(seq)
      .then(setD)
      .catch(() => setD("error"));
  }, [seq]);
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
  const when = new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "es-ES", {
    dateStyle: "medium",
    timeStyle: "medium",
  });
  const a = d && typeof d === "object" ? d.action : null;
  return (
    <aside className="side-panel audit-panel" aria-label={t("audit.detail")}>
      <header className="panel-head">
        <h2>{a ? whoName(t, a.by) : t("audit.detail")}</h2>
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
        {d === "loading" && <div className="page-loading" role="status" aria-busy="true" />}
        {(d === "error" || d === null) && <p className="muted">{t("audit.noDetail")}</p>}
        {a && d && typeof d === "object" && (
          <>
            <p className="muted small">{when.format(a.at)}</p>
            <p className="audit-title">{actionTitle(t, a)}</p>
            <h3 className="models-sub">{t("audit.saw")}</h3>
            {a.seen.length === 0 ? (
              <p className="small">{t("audit.noData")}</p>
            ) : (
              <ul className="audit-seen">
                {a.seen.slice(0, 50).map((s) => (
                  <li key={s.entity}>
                    <span className="audit-seen-title">
                      {d.names.titles[s.entity] || t("audit.oneRecord")}
                    </span>
                    <span className="muted small">
                      {d.names.types[s.type] ?? s.type}
                      {s.fields.length
                        ? ` · ${s.fields.map((f) => d.names.fields[f] ?? f).join(", ")}`
                        : ""}
                    </span>
                    <span className={`small ${s.body === "text" ? "audit-text" : "audit-notext"}`}>
                      {s.body === "text"
                        ? t("audit.withText")
                        : s.body === "shape"
                          ? t("audit.textShape")
                          : t("audit.withoutText")}
                      {s.shapes.length
                        ? ` · ${t("audit.shapes", { fields: s.shapes.map((f) => d.names.fields[f] ?? f).join(", ") })}`
                        : ""}
                      {s.files.length ? ` · ${t("audit.withFile", { n: s.files.length })}` : ""}
                    </span>
                  </li>
                ))}
                {a.seen.length > 50 && (
                  <li className="muted small">{t("audit.andMore", { n: a.seen.length - 50 })}</li>
                )}
              </ul>
            )}
            <h3 className="models-sub">{t("audit.wrote")}</h3>
            {d.call ? (
              <pre className="audit-answer">{answerText(d.call.response)}</pre>
            ) : d.ops.length ? (
              <ul className="audit-seen">
                {d.ops.slice(0, 50).map((o) => (
                  <li key={o.seq}>
                    <span className="audit-seen-title">{d.names.titles[o.target] || o.target}</span>
                    <span className="muted small">{t(`activity.kind.${o.kind}`)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small">{t("audit.nothing")}</p>
            )}
            {a.target && Object.keys(a.target).length > 0 && (
              <>
                <h3 className="models-sub">{t("audit.args")}</h3>
                <dl className="audit-args">
                  {Object.entries(a.target).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
            <p className="muted small">
              {a.decision === "deny"
                ? t("audit.denied", { rule: a.rule ?? "" })
                : t("audit.allowed")}
              {a.result && "error" in a.result
                ? ` · ${t("audit.failed", { error: String(a.result.error) })}`
                : ""}
            </p>
            {a.run && (
              <button
                type="button"
                className="btn ghost small"
                onClick={() => showAudit({ run: a.run as string })}
              >
                {t("audit.wholeRun")}
              </button>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

/** A model's answer as text: its text fields one per line, otherwise its JSON, never markup. */
function answerText(v: unknown): string {
  if (typeof v === "string") return v.slice(0, 20000);
  return JSON.stringify(v, null, 2).slice(0, 20000);
}
