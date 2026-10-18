import { ChevronLeft } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import * as M from "../core/chartMath.ts";
import { type ChartState, emptyState } from "../core/charts.ts";
import type { ChartData } from "../core/contract.ts";
import { charts, showChart, useStore } from "../store.ts";
import { CardControls } from "./CardControls.tsx";
import { ACCENT, Chart, seriesColors } from "./Chart.tsx";

/**
 * A chart card that loads its own data (the home screen, a chart on its own, a desktop widget). Its controls show
 * when the pointer is over it; while the chart is being edited in the side panel it shows the editor's preview.
 */
export function ChartCard({
  chartId,
  compact = false,
  focused = false,
  bare = false,
  className,
  widgetMenu,
}: {
  chartId: string;
  compact?: boolean;
  /** The chart on its own (the main area): no "open" control. */
  focused?: boolean;
  /** Without the card's own controls (the phone has them outside the card). */
  bare?: boolean;
  className?: string;
  widgetMenu?: (close: () => void) => ReactNode;
}) {
  const spec = useStore((s) => s.chartSpecs.find((c) => c.id === chartId));
  const preview = useStore((s) => (s.editPreview?.id === chartId ? s.editPreview.state : null));
  const draft = useStore((s) =>
    s.panel?.kind === "edit" && !s.panel.isNew && s.panel.spec.id === chartId ? s.panel.spec : null,
  );
  const editing = draft != null;
  const [drill, setDrill] = useState<string | null>(null);
  const state = useChartData(chartId, drill);
  const [controlsOpen, setControlsOpen] = useState(false);

  return (
    <ChartCardContent
      title={(draft ?? spec)?.title ?? state.data?.title ?? ""}
      color={(draft ?? spec)?.color}
      state={preview ?? state}
      compact={compact}
      className={`${className ?? ""}${editing ? " editing" : ""}${controlsOpen ? " controls-open" : ""}`}
      onTitle={!compact && !focused ? () => showChart(chartId) : undefined}
      onDrill={preview ? undefined : (key) => setDrill(key)}
      onBack={drill && !preview ? () => setDrill(null) : undefined}
      controls={
        spec && !editing && !bare ? (
          <CardControls
            spec={spec}
            compact={compact}
            focused={focused}
            onOpenChange={setControlsOpen}
            widgetMenu={widgetMenu}
          />
        ) : null
      }
    />
  );
}

/** A chart's data: the device's last copy at once, then the server's (one request per chart per refresh). */
export function useChartData(chartId: string, drill: string | null = null): ChartState {
  const tick = useStore((s) => s.refreshTick);
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
  return state;
}

/** The card body without loading (a new chart's preview passes its own state). */
export function ChartCardContent({
  title,
  color,
  state,
  compact = false,
  className,
  onTitle,
  onDrill,
  onBack,
  controls,
}: {
  title: string;
  color?: string | null;
  state: ChartState;
  compact?: boolean;
  className?: string;
  onTitle?: () => void;
  onDrill?: (key: string) => void;
  onBack?: () => void;
  controls?: ReactNode;
}) {
  const t = useStore((s) => s.t);
  const data = state.data;
  const sub = data?.subtitle ?? (state.loading ? t("chart.loading") : "");
  const note = state.offline && data ? t("chart.offline") : data?.stale ? t("chart.stale") : null;
  const name = title || data?.title || "";
  return (
    <section
      className={`card chart-card${compact ? " compact" : ""}${className ? ` ${className}` : ""}`}
      aria-label={name}
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
        <span className="card-dot" style={{ background: color ?? ACCENT }} />
        <div className="card-titles">
          {onTitle ? (
            <button type="button" className="card-title link" onClick={onTitle}>
              {name}
            </button>
          ) : (
            <h3 className="card-title">{name}</h3>
          )}
          {sub && <div className="card-sub">{sub}</div>}
        </div>
        {controls}
        {data && data.total != null && data.kind !== "number" && <Total data={data} />}
      </header>
      <div className="card-chart">
        {data ? (
          <Chart
            data={data}
            color={color}
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
      {data && <Legend data={data} color={color} compact={compact} />}
      {note && (
        <div className="card-note">
          <span className="ring" />
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
function Legend({
  data,
  color,
  compact,
}: {
  data: ChartData;
  color?: string | null;
  compact: boolean;
}) {
  if (data.series.length < 2 || ["donut", "number", "table"].includes(data.kind)) return null;
  const colors = seriesColors(data, color ?? ACCENT);
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
