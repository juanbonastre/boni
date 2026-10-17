import { ChevronLeft } from "lucide-react";
import { useEffect, useState } from "react";
import * as M from "../core/chartMath.ts";
import { type ChartState, emptyState } from "../core/charts.ts";
import type { ChartData } from "../core/contract.ts";
import { charts, useStore } from "../store.ts";
import { Chart, seriesColors } from "./Chart.tsx";

/** A chart card that loads its own data; used by the home screen and by the desktop widgets. */
export function ChartCard({
  chartId,
  title,
  compact = false,
  className,
}: {
  chartId: string;
  title: string;
  compact?: boolean;
  className?: string;
}) {
  const tick = useStore((s) => s.refreshTick);
  const [drill, setDrill] = useState<string | null>(null);
  const [state, setState] = useState<ChartState>(emptyState());

  useEffect(() => {
    let live = true;
    // The last saved answer at once, then the server's (shared with every other card of this chart).
    void charts.cached(chartId, drill).then((data) => {
      if (live && data)
        setState((s) => (s.data && s.data.drill === drill ? s : { ...emptyState(data) }));
    });
    void charts.load(chartId, drill, tick).then((s) => {
      if (live) setState(s);
    });
    return () => {
      live = false;
    };
  }, [chartId, drill, tick]);

  return (
    <ChartCardContent
      title={title}
      state={state}
      compact={compact}
      className={className}
      onDrill={(key) => setDrill(key)}
      onBack={drill ? () => setDrill(null) : undefined}
    />
  );
}

/** The card body without loading (the editor's preview passes its own state). */
export function ChartCardContent({
  title,
  state,
  compact = false,
  className,
  onDrill,
  onBack,
}: {
  title: string;
  state: ChartState;
  compact?: boolean;
  className?: string;
  onDrill?: (key: string) => void;
  onBack?: () => void;
}) {
  const t = useStore((s) => s.t);
  const data = state.data;
  const sub = data?.subtitle ?? (state.loading ? t("chart.loading") : "");
  const note =
    state.offline && data
      ? t("chart.offline")
      : data?.stale
        ? t("chart.stale")
        : data?.drilldown && !compact
          ? t("chart.tapDetail")
          : null;
  return (
    <section
      className={`card chart-card${compact ? " compact" : ""}${className ? ` ${className}` : ""}`}
    >
      <header className="card-head">
        {onBack && (
          <button
            type="button"
            className="icon-btn"
            onClick={onBack}
            title={t("chart.back")}
            aria-label={t("chart.back")}
          >
            <ChevronLeft size={16} strokeWidth={1.8} />
          </button>
        )}
        <div className="card-titles">
          <h3 className="card-title">{data?.title ?? title}</h3>
          {sub && <div className="card-sub">{sub}</div>}
        </div>
        {data && data.total != null && data.kind !== "number" && <Total data={data} />}
      </header>
      <div className="card-chart">
        {data ? (
          <Chart
            data={data}
            compact={compact}
            onSelect={data.drilldown && onDrill ? (p) => onDrill(p.key) : undefined}
          />
        ) : (
          <div className="card-empty muted">
            {state.error === "offline"
              ? t("chart.offlineNoData")
              : state.error === "not-configured"
                ? t("chart.notConfigured")
                : (state.error ?? t("chart.loading"))}
          </div>
        )}
      </div>
      {data && <Legend data={data} compact={compact} />}
      {note && (
        <div className="card-note">
          {(state.offline || data?.stale) && <span className="ring" />}
          {note}
        </div>
      )}
    </section>
  );
}

function Total({ data }: { data: ChartData }) {
  const t = useStore((s) => s.t);
  const delta = data.delta_pct;
  const up = (delta ?? 0) > 0;
  const bad = data.measure === "income" ? !up : up;
  return (
    <div className="card-total">
      <div className="card-total-value">{M.formatAuto(data.total ?? 0, data.unit ?? "EUR")}</div>
      {delta != null ? (
        <div className={`card-total-delta ${data.measure === "count" ? "" : bad ? "bad" : "good"}`}>
          {M.percent(delta)}
        </div>
      ) : (
        <div className="card-total-hint">
          {data.kind === "hbar" || data.kind === "donut" ? t("chart.total") : t("chart.inPeriod")}
        </div>
      )}
    </div>
  );
}

/** Names of the series (split values, compared period) with their colours; nothing for one series or a donut. */
function Legend({ data, compact }: { data: ChartData; compact: boolean }) {
  if (data.series.length < 2 || ["donut", "number", "table"].includes(data.kind)) return null;
  const colors = seriesColors(data);
  return (
    <div className={`legend${compact ? " compact" : ""}`}>
      {data.series.map((s, i) => (
        <span key={i} className="legend-item">
          <span className="dot" style={{ background: colors[i] }} />
          {s.role === "main" ? data.title : s.name}
        </span>
      ))}
    </div>
  );
}
