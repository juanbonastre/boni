import type { ReactNode } from "react";
import { actorKind, shortModel } from "../core/audit.ts";
import type { ChartData } from "../core/contract.ts";
import type { T } from "../i18n.ts";
import { Chart } from "./Chart.tsx";

/**
 * The pieces of Boni's dashboards (Juan, 2026-10-24: «Modelos», «Actividad», «Colecciones»: numbers and charts
 * first, detail on click): a tile with one number, a list of bars with their values written, a chart of Boni's
 * own drawing (Chart.tsx) at a fixed height, and the words for who did something.
 */

export function Kpi({
  label,
  value,
  note,
  meter,
  onClick,
  expanded,
}: {
  label: string;
  value: string;
  note?: ReactNode;
  /** A share of a limit (0..1) and its state, drawn as a bar under the number. */
  meter?: { share: number; state: "ok" | "warn" | "over" };
  onClick?: () => void;
  expanded?: boolean;
}) {
  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {meter && (
        <span className="kpi-meter" aria-hidden="true">
          <span
            className={`kpi-meter-fill ${meter.state}`}
            style={{ width: `${Math.round(Math.min(1, meter.share) * 100)}%` }}
          />
        </span>
      )}
      {note && <span className="kpi-note">{note}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className="kpi" aria-expanded={expanded} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="kpi">{body}</div>
  );
}

/** Rows of a label and one or two bars, each with its value written (one colour per series, legend above). */
export function BarList({
  rows,
  series,
  format = (n) => String(n),
  onSelect,
  empty,
}: {
  rows: { key: string; label: string; values: number[] }[];
  series: { name: string; color: string }[];
  format?: (n: number) => string;
  onSelect?: (key: string) => void;
  empty?: string;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => r.values));
  if (!rows.length) return <p className="muted small">{empty}</p>;
  return (
    <div className="barlist">
      {series.length > 1 && (
        <div className="dash-legend">
          {series.map((s) => (
            <span key={s.name}>
              <span className="dash-swatch" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
      {rows.map((r) => {
        const inner = (
          <>
            <span className="barlist-label" title={r.label}>
              {r.label}
            </span>
            <span className="barlist-bars">
              {r.values.map((v, i) => (
                <span key={series[i]?.name ?? i} className="barlist-bar">
                  <span className="barlist-track">
                    <span
                      className="barlist-fill"
                      style={{
                        width: `${Math.max(v > 0 ? 2 : 0, Math.round((v / max) * 100))}%`,
                        background: series[i]?.color,
                      }}
                    />
                  </span>
                  <span className="barlist-value">{format(v)}</span>
                </span>
              ))}
            </span>
          </>
        );
        return onSelect ? (
          <button key={r.key} type="button" className="barlist-row" onClick={() => onSelect(r.key)}>
            {inner}
          </button>
        ) : (
          <div key={r.key} className="barlist-row">
            {inner}
          </div>
        );
      })}
    </div>
  );
}

/** One of Boni's charts at the dashboard's height, with its legend in HTML above it. */
export function DashChart({
  data,
  legend,
}: {
  data: ChartData;
  legend?: { name: string; color: string }[];
}) {
  return (
    <div className="dash-chart-box">
      {legend && legend.length > 1 && (
        <div className="dash-legend">
          {legend.map((l) => (
            <span key={l.name}>
              <span className="dash-swatch" style={{ background: l.color }} />
              {l.name}
            </span>
          ))}
        </div>
      )}
      <div className="dash-chart">
        <Chart data={data} style={{ labels: false, reference: "none" }} />
      </div>
    </div>
  );
}

/** The categorical colours, in order (Boni's tokens). */
export const COLORS = [
  "var(--c1)",
  "var(--c2)",
  "var(--c3)",
  "var(--c4)",
  "var(--c5)",
  "var(--c6)",
  "var(--c7)",
  "var(--c8)",
];

/** Who did something, in words: «Tú · portátil», «Lector · deepseek-v4.1-flash», «MCP · claude-code», «Boni». */
export function whoName(t: T, by: string): string {
  if (by.startsWith("user:")) return t("who.user", { device: by.slice(5) });
  if (by.startsWith("mcp:")) return t("who.mcp", { device: by.slice(4) });
  if (by.startsWith("model:")) {
    const [, role = "", ...rest] = by.split(":");
    const model = rest.join(":");
    const name = t(`models.role.${role}`);
    return model ? `${name} · ${shortModel(model)}` : name;
  }
  if (by === "import") return t("who.import");
  if (by.startsWith("connector")) return t("who.connector");
  if (by === "system") return t("who.system");
  return t("who.boni");
}

/** A stable colour per kind of actor (models by role), so the same one is the same colour everywhere. */
export function whoColor(by: string): string {
  const kind = actorKind(by);
  if (kind === "mcp") return "var(--c7)";
  if (kind === "user") return "var(--muted)";
  if (kind === "boni") return "var(--compare)";
  const role = by.split(":")[1];
  return role === "planner"
    ? "var(--c1)"
    : role === "reader"
      ? "var(--c2)"
      : role === "reviewer"
        ? "var(--c3)"
        : "var(--c4)";
}

/** Points of a daily series over a period ("1".."31" or short dates), zero where nothing happened. */
export function daysOf(from: number, to: number): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const DAY = 86_400_000;
  for (let at = Math.floor(from / DAY) * DAY; at < to; at += DAY) {
    const key = new Date(at).toISOString().slice(0, 10);
    out.push({ key, label: String(Number(key.slice(8, 10))) });
  }
  return out.slice(-366);
}

/** A chart's data of one or more daily series (Boni's ChartData, drawn by Chart.tsx). */
export function dailyChart(
  id: string,
  kind: "stacked_bar" | "line" | "bar",
  days: { key: string; label: string }[],
  series: { name: string; values: Record<string, number> }[],
  unit = "",
): ChartData {
  return {
    chart_id: id,
    title: "",
    kind,
    unit,
    computed_at: "",
    series: series.map((s, i) => ({
      name: s.name,
      key: `s${i}`,
      role: series.length > 1 ? "split" : "main",
      points: days.map((d) => ({ key: d.key, label: d.label, value: s.values[d.key] ?? 0 })),
    })),
  };
}

/** Bytes in words (KB, MB, GB). */
export function bytes(n: number, lang: string): string {
  const f = new Intl.NumberFormat(lang === "en" ? "en-GB" : "es-ES", { maximumFractionDigits: 1 });
  if (n < 1024 * 1024) return `${f.format(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${f.format(n / 1024 / 1024)} MB`;
  return `${f.format(n / 1024 / 1024 / 1024)} GB`;
}
