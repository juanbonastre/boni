import { ChevronDown, ChevronRight, ListChecks } from "lucide-react";
import { useEffect, useState } from "react";
import type { AuditSummary } from "../core/audit.ts";
import { agentApi, showAudit, useStore } from "../store.ts";
import { LogView } from "./Chat.tsx";
import { BarList, DashChart, dailyChart, daysOf, Kpi, whoName } from "./Dash.tsx";

const DAY = 86_400_000;
const RANGES = [7, 30, 365] as const;

/**
 * «Actividad» (Juan, 2026-10-24: the Registro said too much in too many rows): what Boni, the models, the MCP and Juan
 * read and changed in a period, as numbers and charts; the runs one by one stay below, folded, and the audit opens
 * from a collection's bar or the button.
 */
export function ActivityView() {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [sum, setSum] = useState<AuditSummary | null | "error">(null);
  const [runs, setRuns] = useState(false);
  useEffect(() => {
    setSum(null);
    const to = Date.now();
    agentApi
      .auditSummary(to - days * DAY, to)
      .then(setSum)
      .catch(() => setSum("error"));
  }, [days]);
  const nf = new Intl.NumberFormat(lang === "en" ? "en-GB" : "es-ES");
  const s = sum && sum !== "error" ? sum : null;
  const total = (k: "reads" | "writes") => {
    const by = new Map<string, number>();
    for (const r of s?.activity ?? []) by.set(r.day, (by.get(r.day) ?? 0) + r[k]);
    return Object.fromEntries(by);
  };
  const writers = new Map<string, number>();
  for (const r of s?.activity ?? [])
    if (r.writes) writers.set(r.by, (writers.get(r.by) ?? 0) + r.writes);
  const types = new Map<string, { name: string; reads: number; writes: number }>();
  for (const r of s?.byType ?? []) {
    const x = types.get(r.type) ?? { name: r.name, reads: 0, writes: 0 };
    x.reads += r.reads;
    x.writes += r.writes;
    types.set(r.type, x);
  }
  const kinds = s?.totals.kinds ?? {};
  const pct =
    s && s.totals.proposals ? Math.round((s.totals.accepted / s.totals.proposals) * 100) : 0;
  return (
    <div className="content dash">
      <header className="dash-head">
        <h1 className="dash-title">{t("activity.title")}</h1>
        <span className="segmented" role="radiogroup" aria-label={t("activity.range")}>
          {RANGES.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={days === d}
              className={days === d ? "on" : ""}
              onClick={() => setDays(d)}
            >
              {t(`activity.range.${d}`)}
            </button>
          ))}
        </span>
      </header>
      {sum === "error" && <p className="muted">{t("activity.unavailable")}</p>}
      {sum === null && <div className="page-loading" role="status" aria-busy="true" />}
      {s && (
        <>
          <div className="kpis">
            <Kpi label={t("activity.kpi.readings")} value={nf.format(s.totals.readings)} />
            <Kpi
              label={t("activity.kpi.proposals")}
              value={nf.format(s.totals.proposals)}
              note={t("activity.kpi.accepted", { pct })}
            />
            <Kpi
              label={t("activity.kpi.changes")}
              value={nf.format(s.totals.writes)}
              note={t("activity.kpi.undone", { n: nf.format(s.totals.undone) })}
            />
            <Kpi label={t("activity.kpi.requests")} value={nf.format(s.totals.requests)} />
          </div>
          <div className="dash-grid">
            <section className="dash-col">
              <h2 className="dash-h2">{t("activity.byDay")}</h2>
              <DashChart
                data={dailyChart("activity", "line", daysOf(s.from, s.to), [
                  { name: t("activity.reads"), values: total("reads") },
                  { name: t("activity.writes"), values: total("writes") },
                ])}
                legend={[
                  { name: t("activity.reads"), color: "var(--c1)" },
                  { name: t("activity.writes"), color: "var(--c2)" },
                ]}
              />
            </section>
            <section className="dash-col">
              <h2 className="dash-h2">{t("activity.whoWrites")}</h2>
              <BarList
                rows={[...writers.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([by, n]) => ({ key: by, label: whoName(t, by), values: [n] }))}
                series={[{ name: t("activity.writes"), color: "var(--accent)" }]}
                format={(n) => nf.format(n)}
                onSelect={(by) => showAudit({ by })}
                empty={t("activity.empty")}
              />
              <h2 className="dash-h2">{t("activity.kinds")}</h2>
              <div className="kinds">
                {(["create", "update", "delete"] as const).map((k) => (
                  <span key={k} className="kind">
                    <span className="kind-value">{nf.format(kinds[k] ?? 0)}</span>
                    <span className="muted">{t(`activity.kind.${k}`)}</span>
                  </span>
                ))}
              </div>
            </section>
          </div>
          <section className="dash-col">
            <h2 className="dash-h2">{t("activity.byType")}</h2>
            <BarList
              rows={[...types.entries()]
                .sort((a, b) => b[1].reads + b[1].writes - (a[1].reads + a[1].writes))
                .map(([type, x]) => ({ key: type, label: x.name, values: [x.reads, x.writes] }))}
              series={[
                { name: t("activity.reads"), color: "var(--c1)" },
                { name: t("activity.writes"), color: "var(--c2)" },
              ]}
              format={(n) => nf.format(n)}
              onSelect={(type) => showAudit({ type })}
              empty={t("activity.empty")}
            />
          </section>
          <div className="dash-actions">
            <button type="button" className="btn" onClick={() => showAudit({})}>
              <ListChecks size={14} strokeWidth={1.8} aria-hidden="true" />
              {t("activity.openAudit")}
            </button>
          </div>
          <section className="card models-card">
            <button
              type="button"
              className="models-row"
              aria-expanded={runs}
              onClick={() => setRuns(!runs)}
            >
              <span className="models-row-main">
                <span className="models-name">{t("activity.runs")}</span>
                <span className="muted small">{t("activity.runsHelp")}</span>
              </span>
              {runs ? (
                <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
              ) : (
                <ChevronRight size={15} strokeWidth={1.8} aria-hidden="true" />
              )}
            </button>
            {runs && (
              <div className="models-more">
                <LogView />
              </div>
            )}
          </section>
        </>
      )}
      {/* Without the audit (an older server, a shared device) the runs are what there is. */}
      {sum === "error" && <LogView />}
    </div>
  );
}
