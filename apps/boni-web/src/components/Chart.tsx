import { type ChartStyle, fullStyle } from "@boni/views";
import {
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as M from "../core/chartMath.ts";
import type { ChartData, ChartPoint, ChartSeries } from "../core/contract.ts";
import type { T } from "../i18n.ts";
import { useStore } from "../store.ts";
import { useChartAnim } from "./useChartAnim.ts";

/**
 * Charts drawn by hand in SVG, looking as Notion's: thin marks, 4 px rounded data ends anchored to the
 * baseline, a dotted grid, the value over each mark (data labels), a band behind what the pointer is over,
 * a soft gradient under a line, entry animation. The chart's style (Notion's "Style" settings) chooses the
 * grid, the labels, one colour or one per bar, the axis names, the average as a reference line, a running
 * total and zero values left out. Kinds: bar, stacked_bar, hbar, line, area, donut (SVG); number and table.
 */

const REST = "_rest";
const OTHER = "_other";
const CATEGORICAL = [
  "var(--c1)",
  "var(--c2)",
  "var(--c3)",
  "var(--c4)",
  "var(--c5)",
  "var(--c6)",
  "var(--c7)",
  "var(--c8)",
];

/** The colour of a chart's own series: stable per chart (it follows the chart, never its position). */
export const ACCENT = "var(--accent)";

/** Colours of each series in order: main = the chart's accent, split = categorical ("Otros" grey), compare = neutral. */
export function seriesColors(data: ChartData, accent: string = ACCENT): string[] {
  let slot = 0;
  return data.series.map((s) => {
    if (s.role === "compare") return "var(--compare)";
    if (s.role === "split" && s.key === OTHER) return "var(--muted)";
    if (s.role === "split") return CATEGORICAL[slot++ % CATEGORICAL.length]!;
    return accent;
  });
}

export function sliceColors(points: ChartPoint[]): string[] {
  let slot = 0;
  return points.map((p) =>
    p.key === REST ? "var(--muted)" : CATEGORICAL[slot++ % CATEGORICAL.length]!,
  );
}

/** What the style asks of the drawing. */
interface Look {
  grid: "h" | "v" | "both" | "none";
  labels: boolean;
  colorful: boolean;
  reference: boolean;
  xName: string | null;
  yName: string | null;
}
const plainLook: Look = {
  grid: "h",
  labels: true,
  colorful: false,
  reference: true,
  xName: null,
  yName: null,
};
const TIME_KINDS = new Set(["bar", "stacked_bar", "line", "area"]);

/** The data as the style wants it: zero values left out, or each point the running total so far. */
function styled(data: ChartData, style: Required<ChartStyle>): ChartData {
  let series = data.series;
  if (style.omitZero && data.kind !== "number") {
    const keep = (series[0]?.points ?? []).map((_, i) =>
      series.some((s) => (s.points[i]?.value ?? 0) !== 0),
    );
    series = series.map((s) => ({ ...s, points: s.points.filter((_, i) => keep[i]) }));
  }
  if (style.cumulative && TIME_KINDS.has(data.kind)) {
    series = series.map((s) => {
      let sum = 0;
      return {
        ...s,
        points: s.points.map((p) => {
          if (p.no_data) return p;
          sum += p.value;
          return { ...p, value: sum };
        }),
      };
    });
    return { ...data, series, average: null };
  }
  return series === data.series ? data : { ...data, series };
}

const donutPoints = (series: ChartSeries[]) => (series[0]?.points ?? []).filter((p) => p.value > 0);

// ---------- text measuring (labels that must fit: ellipsis) ----------
let measureCtx: CanvasRenderingContext2D | null = null;
const FONT = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
function textWidth(text: string, size: number, weight = 400): number {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * size * 0.55;
  measureCtx.font = `${weight} ${size}px ${FONT}`;
  return measureCtx.measureText(text).width;
}
function fitText(text: string, max: number, size: number, weight = 400): string {
  if (max <= 0) return "";
  if (textWidth(text, size, weight) <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textWidth(`${text.slice(0, mid)}…`, size, weight) <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo ? `${text.slice(0, lo)}…` : "";
}

function useSize<E extends HTMLElement>(): [React.RefObject<E | null>, { w: number; h: number }] {
  const ref = useRef<E>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSize((s) =>
        s.w === Math.round(r.width) && s.h === Math.round(r.height)
          ? s
          : { w: Math.round(r.width), h: Math.round(r.height) },
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
const width = (r: Rect) => r.right - r.left;
const height = (r: Rect) => r.bottom - r.top;

/** Plot area and hit-testing shared by drawing and clicking. */
function geometry(
  kind: string,
  w: number,
  h: number,
  n: number,
  compact: boolean,
  look: Look = plainLook,
) {
  const horizontal = kind === "hbar";
  // Room for the axis names when the style shows them.
  const padL = look.yName ? 18 : 0;
  const padB = look.xName ? 18 : 0;
  const plot: Rect = horizontal
    ? {
        left: (compact ? 92 : 120) + padL,
        top: 4,
        right: w - (compact ? 64 : 76),
        bottom: h - 4 - padB,
      }
    : {
        left: (compact ? 30 : 38) + padL,
        top: 20,
        right: w - (compact ? 8 : 12),
        bottom: h - 22 - padB,
      };
  const band = n === 0 ? 0 : (horizontal ? height(plot) : width(plot)) / n;
  const indexAt = (x: number, y: number): number | null => {
    if (n === 0) return null;
    const inside = horizontal
      ? y >= plot.top && y <= plot.bottom
      : x >= plot.left && x <= plot.right;
    if (!inside) return null;
    const i = Math.floor(horizontal ? (y - plot.top) / band : (x - plot.left) / band);
    return Math.max(0, Math.min(n - 1, i));
  };
  return { plot, band, indexAt };
}

/** Rounded at the data end, square at the baseline. */
function barPath(
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  horizontal: boolean,
): string {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (horizontal) {
    return `M${x},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x}Z`;
  }
  return `M${x},${y + h}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h}Z`;
}

interface Tip {
  x: number;
  y: number;
  title: string;
  lines: { text: string; color?: string }[];
}

const pointTitle = (t: T, p: ChartPoint) =>
  p.no_data
    ? t("chart.noData", { label: p.label })
    : p.partial
      ? t("chart.partial", { label: p.label })
      : p.label;

function tipLines(
  t: T,
  series: ChartSeries[],
  colors: string[],
  i: number,
  unit: string,
  stacked: boolean,
): Tip["lines"] {
  const main = series[0]?.points[i];
  if (!main) return [];
  if (main.no_data) return [{ text: "–" }];
  if (series.length === 1) return [{ text: M.format(main.value, unit) }];
  const lines: Tip["lines"] = series.flatMap((s, si) => {
    const p = s.points[i];
    return p ? [{ text: `${s.name}: ${M.format(p.value, unit)}`, color: colors[si] }] : [];
  });
  if (stacked) {
    const total = series.reduce((sum, s) => sum + (s.points[i]?.value ?? 0), 0);
    lines.push({ text: t("chart.totalLine", { value: M.format(total, unit) }) });
  }
  return lines;
}

interface ChartProps {
  data: ChartData;
  /** The chart's own colour (its main series); the accent when it has none. */
  color?: string | null;
  compact?: boolean;
  /** How it looks (Notion's style settings); the defaults when absent. */
  style?: ChartStyle;
  onSelect?: (p: ChartPoint) => void;
}

export function Chart({ data: raw, color, compact = false, style, onSelect }: ChartProps) {
  const catalog = useStore((s) => s.catalog);
  const full = fullStyle(style);
  const key = JSON.stringify(full);
  const data = useMemo(() => styled(raw, full), [raw, key]);
  const look: Look = {
    grid: full.grid,
    labels: full.labels,
    colorful: full.colors === "colorful",
    reference: full.reference === "average",
    xName: full.axes === "x" || full.axes === "both" ? (data.x_label ?? null) : null,
    yName:
      full.axes === "y" || full.axes === "both"
        ? (catalog?.measures.find((m) => m.id === data.measure)?.label ?? null)
        : null,
  };
  if (data.kind === "number") return <NumberTile data={data} compact={compact} />;
  if (data.kind === "table")
    return <ChartTable data={data} color={color} compact={compact} onSelect={onSelect} />;
  return <SvgChart data={data} color={color} compact={compact} look={look} onSelect={onSelect} />;
}

function SvgChart({
  data,
  color,
  compact = false,
  look,
  onSelect,
}: Omit<ChartProps, "style"> & { look: Look }) {
  const t = useStore((s) => s.t);
  const uid = useId();
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  // Fingers have no hover: a tap shows the value (it stays until a tap elsewhere), a second tap on the same bar
  // or slice opens its detail (at once where the values are already written, as horizontal bars).
  const pointer = useRef("mouse");
  const tapped = useRef<string | null>(null);
  useEffect(() => {
    if (!hover || pointer.current === "mouse") return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        tapped.current = null;
        setHover(null);
      }
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [hover]);
  const { series, entry } = useChartAnim(data);
  const colors = seriesColors(data, color ?? ACCENT);
  const unit = data.unit ?? "EUR";

  const local = (e: React.PointerEvent | React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const hit = (pos: { x: number; y: number }): ChartPoint | null => {
    const main = data.series.find((s) => s.role !== "compare")?.points ?? [];
    if (data.kind === "donut") {
      const pts = donutPoints(data.series);
      const i = donutGeometry(w, h).indexAt(pts, pos.x, pos.y);
      return i == null ? null : (pts[i] ?? null);
    }
    if (data.kind === "hbar") {
      const cmp = data.series.find((s) => s.role === "compare")?.points;
      const rows = hbarRows(main, cmp, w, h, compact, look);
      const i = geometry("hbar", w, h, rows.length, compact, look).indexAt(pos.x, pos.y);
      return i == null ? null : (rows[i]?.[0] ?? null);
    }
    const i = geometry(data.kind, w, h, main.length, compact, look).indexAt(pos.x, pos.y);
    return i == null ? null : (main[i] ?? null);
  };

  let body: { svg: ReactNode; tip: Tip | null } = { svg: null, tip: null };
  if (w > 0 && h > 0) {
    const ctx: DrawCtx = { t, uid, w, h, compact, unit, entry, hover, colors, look };
    switch (data.kind) {
      case "hbar":
        body = drawHBars(ctx, series);
        break;
      case "line":
      case "area":
        body = drawLines(
          ctx,
          series,
          look.reference ? (data.average ?? null) : null,
          data.kind === "area",
        );
        break;
      case "donut":
        body = drawDonut(ctx, donutPoints(series));
        break;
      case "stacked_bar":
        body = drawColumns(ctx, series, null, true);
        break;
      default:
        body = drawColumns(ctx, series, look.reference ? (data.average ?? null) : null, false);
    }
  }
  const clickable =
    Boolean(onSelect) && hover != null && Boolean(hit(hover)) && !hit(hover)!.key.startsWith("_");
  return (
    <div
      ref={ref}
      className={`chart${clickable ? " clickable" : ""}`}
      onPointerDown={(e) => {
        pointer.current = e.pointerType;
        if (e.pointerType !== "mouse") setHover(local(e));
      }}
      onPointerMove={(e) => {
        if (e.pointerType === "mouse" || e.buttons) setHover(local(e));
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setHover(null);
      }}
      onClick={(e) => {
        const p = hit(local(e));
        // Horizontal bars already show every value: a tap opens the detail at once.
        const shown = data.kind === "hbar" && !data.series.some((x) => x.role === "compare");
        if (pointer.current !== "mouse" && !shown) {
          const again = p != null && tapped.current === p.key;
          tapped.current = p?.key ?? null;
          if (!again) return;
        }
        if (onSelect && p && !p.key.startsWith("_")) onSelect(p);
      }}
    >
      <svg width={w} height={h} role="img" aria-label={data.title}>
        {body.svg}
        {data.kind !== "donut" && <AxisNames c={{ w, h, look }} />}
      </svg>
      {body.tip && <Tooltip tip={body.tip} w={w} h={h} />}
    </div>
  );
}

function Tooltip({ tip, w, h }: { tip: Tip; w: number; h: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r && (Math.round(r.width) !== box.w || Math.round(r.height) !== box.h)) {
      setBox({ w: Math.round(r.width), h: Math.round(r.height) });
    }
  });
  const left = Math.round(Math.max(0, Math.min(w - box.w, tip.x - box.w / 2)));
  let top = tip.y - box.h - 8;
  if (top < 0) top = Math.min(tip.y + 12, Math.max(0, h - box.h));
  const single = tip.lines.length === 1 && !tip.lines[0]?.color;
  return (
    <div ref={ref} className="chart-tip" style={{ left, top: Math.round(top) }}>
      <div className="chart-tip-title">{tip.title}</div>
      {tip.lines.map((l, i) => (
        <div key={i} className={single ? "chart-tip-value" : "chart-tip-line"}>
          {l.color && <span className="dot" style={{ background: l.color }} />}
          {l.text}
        </div>
      ))}
    </div>
  );
}

interface DrawCtx {
  t: T;
  /** Unique per chart (ids of clip paths). */
  uid: string;
  w: number;
  h: number;
  compact: boolean;
  unit: string;
  entry: number;
  hover: { x: number; y: number } | null;
  colors: string[];
  look: Look;
}

/** The axis names (the style's "Axis name"): the x name under the labels, the y name up the left side. */
function AxisNames({ c }: { c: { w: number; h: number; look: Look } }) {
  return (
    <g>
      {c.look.xName && (
        <text
          x={c.w / 2}
          y={c.h - 3}
          textAnchor="middle"
          className="t-axis axis-name"
          fontSize={11}
        >
          {fitText(c.look.xName, c.w - 20, 11)}
        </text>
      )}
      {c.look.yName && (
        <text
          x={0}
          y={0}
          transform={`translate(10 ${c.h / 2}) rotate(-90)`}
          textAnchor="middle"
          className="t-axis axis-name"
          fontSize={11}
        >
          {fitText(c.look.yName, c.h - 20, 11)}
        </text>
      )}
    </g>
  );
}

/** Notion's vertical grid lines, through each column's centre. */
function VGrid({ c, plot, band, n }: { c: DrawCtx; plot: Rect; band: number; n: number }) {
  if (c.look.grid !== "v" && c.look.grid !== "both") return null;
  return (
    <g>
      {Array.from({ length: n }, (_, i) => {
        const x = Math.round(plot.left + band * (i + 0.5)) + 0.5;
        return <line key={i} x1={x} x2={x} y1={plot.top} y2={plot.bottom} className="grid" />;
      })}
    </g>
  );
}

/** The band behind the column the pointer is over (Notion's hover). */
function HoverBand({
  plot,
  band,
  i,
  horizontal,
}: {
  plot: Rect;
  band: number;
  i: number | null;
  horizontal?: boolean;
}) {
  if (i == null) return null;
  return horizontal ? (
    <rect x={0} y={plot.top + band * i} width="100%" height={band} className="hover-band" />
  ) : (
    <rect
      x={plot.left + band * i}
      y={plot.top - 14}
      width={band}
      height={plot.bottom - plot.top + 14}
      className="hover-band"
    />
  );
}

/** Values over the marks, as many as fit side by side (every k-th, always the last). */
function DataLabels({
  c,
  xs,
  ys,
  values,
  band,
}: {
  c: DrawCtx;
  xs: number[];
  ys: (number | null)[];
  values: number[];
  band: number;
}) {
  if (!c.look.labels || c.entry < 0.95) return null;
  const size = valueSize(c) - 1;
  const texts = values.map((v) => M.formatAuto(v, c.unit));
  const widest = Math.max(...texts.map((tx) => textWidth(tx, size)));
  const step = Math.max(1, Math.ceil((widest + 6) / Math.max(band, 1)));
  return (
    <g>
      {texts.map((tx, i) =>
        ys[i] == null || (texts.length - 1 - i) % step !== 0 ? null : (
          <text
            key={i}
            x={xs[i]}
            y={(ys[i] as number) - 6}
            textAnchor="middle"
            className="t-label data-label"
            fontSize={size}
          >
            {tx}
          </text>
        ),
      )}
    </g>
  );
}

const axisSize = (c: DrawCtx) => (c.compact ? 10 : 11);
const valueSize = (c: DrawCtx) => (c.compact ? 11 : 12);

function Empty({ c }: { c: DrawCtx }) {
  return (
    <text x={c.w / 2} y={c.h / 2} textAnchor="middle" dominantBaseline="middle" className="t-label">
      {c.t("chart.empty")}
    </text>
  );
}

function YAxis({
  c,
  plot,
  ticks,
  y,
}: {
  c: DrawCtx;
  plot: Rect;
  ticks: number[];
  y: (v: number) => number;
}) {
  return (
    <g>
      {ticks.map((tk) => (
        <g key={tk}>
          {(tk === 0 || c.look.grid === "h" || c.look.grid === "both") && (
            <line
              x1={plot.left}
              x2={plot.right}
              y1={Math.round(y(tk)) + 0.5}
              y2={Math.round(y(tk)) + 0.5}
              className={tk === 0 ? "baseline" : "grid"}
            />
          )}
          <text
            x={plot.left - 6}
            y={y(tk)}
            textAnchor="end"
            dominantBaseline="middle"
            className="t-axis"
            fontSize={axisSize(c)}
          >
            {M.compact(tk)}
          </text>
        </g>
      ))}
    </g>
  );
}

/** X labels that fit: every k-th one, always including the last; a long one is cut to its room. */
function XLabels({
  c,
  plot,
  band,
  points,
}: {
  c: DrawCtx;
  plot: Rect;
  band: number;
  points: ChartPoint[];
}) {
  const maxLabels = Math.max(2, Math.floor(width(plot) / (c.compact ? 36 : 44)));
  const step = M.labelStep(points.length, maxLabels);
  const size = axisSize(c);
  const room = band * step - 6;
  return (
    <g>
      {points.map((p, i) =>
        (points.length - 1 - i) % step === 0 ? (
          <text
            key={p.key}
            x={plot.left + band * (i + 0.5)}
            y={plot.bottom + 5}
            textAnchor="middle"
            dominantBaseline="hanging"
            className="t-axis"
            fontSize={size}
          >
            {fitText(p.label, room, size)}
          </text>
        ) : null,
      )}
    </g>
  );
}

/** A small label on a surface-coloured pill (readable when it crosses bars or the line). */
function Pill({
  c,
  text,
  x,
  y,
  alignRight,
}: {
  c: DrawCtx;
  text: string;
  x: number;
  y: number;
  alignRight: boolean;
}) {
  const size = axisSize(c);
  const tw = textWidth(text, size);
  const left = alignRight ? x - tw : x;
  return (
    <g>
      <rect
        x={left - 4}
        y={y - size - 2}
        width={tw + 8}
        height={size + 4}
        rx={4}
        className="pill-bg"
      />
      <text x={left} y={y - 2} className="t-axis" fontSize={size}>
        {text}
      </text>
    </g>
  );
}

function AverageLine({
  c,
  plot,
  average,
  y,
  labelRight,
}: {
  c: DrawCtx;
  plot: Rect;
  average: number | null;
  y: (v: number) => number;
  labelRight: boolean;
}) {
  if (average == null || average <= 0) return null;
  const ay = y(average);
  const text = c.t("chart.average", { value: M.formatAuto(average, c.unit) });
  return (
    <g>
      <line x1={plot.left} x2={plot.right} y1={ay} y2={ay} className="average" />
      {!c.compact && (
        <Pill
          c={c}
          text={text}
          x={labelRight ? plot.right - 4 : plot.left + 8}
          y={ay - 3}
          alignRight={labelRight}
        />
      )}
    </g>
  );
}

// ---------- vertical columns: one series, grouped series (split or compare) or stacked ----------
function drawColumns(c: DrawCtx, series: ChartSeries[], average: number | null, stacked: boolean) {
  const main = series[0]?.points ?? [];
  const n = main.length;
  if (n === 0) return { svg: <Empty c={c} />, tip: null };
  const g = geometry("bar", c.w, c.h, n, c.compact, c.look);
  const maxV = stacked
    ? Math.max(
        ...main.map((_, i) =>
          series.reduce((s, ser) => s + Math.max(ser.points[i]?.value ?? 0, 0), 0),
        ),
      )
    : Math.max(...series.flatMap((s) => s.points.map((p) => p.value)));
  const ticks = M.ticks(Math.max(maxV, average ?? 0), c.compact ? 3 : 4);
  const top = ticks[ticks.length - 1]!;
  const y = (v: number) => g.plot.bottom - (v / top) * height(g.plot);
  const hi = c.hover ? g.indexAt(c.hover.x, c.hover.y) : null;
  const groups = stacked ? 1 : series.length;
  const groupW = Math.min(groups === 1 ? 24 : 12 * groups, g.band * 0.72);
  const gap = groups > 1 ? Math.min(2, groupW / groups / 4) : 0;
  const barW = (groupW - gap * (groups - 1)) / groups;
  const marks: ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = main[i]!;
    const cx = g.plot.left + g.band * (i + 0.5);
    if (p0.no_data) {
      marks.push(
        <line
          key={`nd${i}`}
          x1={cx - groupW / 4}
          x2={cx + groupW / 4}
          y1={g.plot.bottom - 4}
          y2={g.plot.bottom - 4}
          className="no-data"
        />,
      );
      continue;
    }
    const alpha = p0.partial ? 0.55 : 1;
    if (stacked) {
      let base = 0;
      const visible = series
        .map((_, si) => si)
        .filter((si) => (series[si]!.points[i]?.value ?? 0) > 0);
      visible.forEach((si, k) => {
        const v = series[si]!.points[i]!.value;
        const yTop = y((base + v) * c.entry);
        const yBottom = y(base * c.entry) - (k === 0 ? 1 : 0);
        const hgt = yBottom - yTop;
        if (hgt > 0.5) {
          const x = cx - barW / 2;
          marks.push(
            k === visible.length - 1 ? (
              <path
                key={`s${i}-${si}`}
                d={barPath(x, yTop, barW, hgt, 4, false)}
                fill={c.colors[si]}
                opacity={alpha}
              />
            ) : (
              <rect
                key={`s${i}-${si}`}
                x={x}
                y={yTop}
                width={barW}
                height={hgt}
                fill={c.colors[si]}
                opacity={alpha}
              />
            ),
          );
          if (k > 0)
            marks.push(
              <line
                key={`sep${i}-${si}`}
                x1={x}
                x2={x + barW}
                y1={yBottom}
                y2={yBottom}
                className="seg-sep"
              />,
            );
        }
        base += v;
      });
    } else {
      series.forEach((s, si) => {
        const p = s.points[i];
        if (!p) return;
        const left = cx - groupW / 2 + si * (barW + gap);
        const yTop = y(Math.max(p.value, 0) * c.entry);
        const hgt = g.plot.bottom - 1 - yTop;
        if (hgt > 0.5) {
          const fill =
            c.look.colorful && series.length === 1
              ? CATEGORICAL[i % CATEGORICAL.length]
              : c.colors[si];
          marks.push(
            <path
              key={`b${i}-${si}`}
              d={barPath(left, yTop, barW, hgt, Math.min(4, barW / 2), false)}
              fill={fill}
              opacity={alpha}
            />,
          );
        }
      });
    }
  }
  // The average's label sits at the right unless the latest value's label is there at the same height.
  const lastIdx = main
    .map((p, k) => (p.no_data ? -1 : k))
    .filter((k) => k >= 0)
    .pop();
  const averageRight = !(
    average != null &&
    lastIdx != null &&
    lastIdx >= n - 3 &&
    Math.abs(y(average) - y(Math.max(main[lastIdx]!.value, 0))) < 22
  );
  // The value over each column (over the stack, or over the tallest of a group).
  const tops = main.map((p, i) =>
    p.no_data
      ? null
      : stacked
        ? series.reduce((s, ser) => s + Math.max(ser.points[i]?.value ?? 0, 0), 0)
        : Math.max(...series.map((ser) => Math.max(ser.points[i]?.value ?? 0, 0))),
  );
  const label =
    series.length === 1 || stacked ? (
      <DataLabels
        c={c}
        xs={main.map((_, i) => g.plot.left + g.band * (i + 0.5))}
        ys={tops.map((v) => (v == null ? null : y(v)))}
        values={tops.map((v) => v ?? 0)}
        band={g.band}
      />
    ) : null;
  let tip: Tip | null = null;
  if (hi != null) {
    const cx = g.plot.left + g.band * (hi + 0.5);
    const stackTop = stacked
      ? series.reduce((s, ser) => s + Math.max(ser.points[hi]?.value ?? 0, 0), 0)
      : Math.max(...series.map((ser) => Math.max(ser.points[hi]?.value ?? 0, 0)));
    tip = {
      x: cx,
      y: y(stackTop),
      title: pointTitle(c.t, main[hi]!),
      lines: tipLines(c.t, series, c.colors, hi, c.unit, stacked),
    };
  }
  return {
    svg: (
      <g>
        <HoverBand plot={g.plot} band={g.band} i={hi} />
        <YAxis c={c} plot={g.plot} ticks={ticks} y={y} />
        <VGrid c={c} plot={g.plot} band={g.band} n={n} />
        <XLabels c={c} plot={g.plot} band={g.band} points={main} />
        {marks}
        {series.length === 1 && (
          <AverageLine c={c} plot={g.plot} average={average} y={y} labelRight={averageRight} />
        )}
        {label}
      </g>
    ),
    tip,
  };
}

// ---------- horizontal bars (rankings), with a tick for the compared period ----------
/** Rows that fit: if there are too many for the height, the smallest are folded into one "Resto" row. */
function hbarRows(
  main: ChartPoint[],
  compare: ChartPoint[] | undefined,
  w: number,
  h: number,
  compact: boolean,
  look: Look = plainLook,
) {
  const plot = geometry("hbar", w, h, main.length, compact, look).plot;
  const maxRows = Math.max(2, Math.floor(height(plot) / (compact ? 20 : 28)));
  const pairs = main.map((p, i) => [p, compare?.[i]] as [ChartPoint, ChartPoint | undefined]);
  if (pairs.length <= maxRows) return pairs;
  const rest = pairs.slice(maxRows - 1);
  const label = `Resto (${rest.length})`;
  const restCmp = compare
    ? { key: REST, label, value: rest.reduce((s, r) => s + (r[1]?.value ?? 0), 0) }
    : undefined;
  return [
    ...pairs.slice(0, maxRows - 1),
    [{ key: REST, label, value: rest.reduce((s, r) => s + r[0].value, 0) }, restCmp],
  ] as [ChartPoint, ChartPoint | undefined][];
}

function drawHBars(c: DrawCtx, series: ChartSeries[]) {
  const mainIdx = Math.max(
    0,
    series.findIndex((s) => s.role !== "compare"),
  );
  const main = series[mainIdx]?.points ?? [];
  const cmp = series.find((s) => s.role === "compare");
  if (!main.length) return { svg: <Empty c={c} />, tip: null };
  const rows = hbarRows(main, cmp?.points, c.w, c.h, c.compact, c.look);
  const g = geometry("hbar", c.w, c.h, rows.length, c.compact, c.look);
  const top = Math.max(1, ...rows.map(([p, q]) => Math.max(p.value, q?.value ?? 0)));
  const decimals = top < 100;
  const barH = Math.min(c.compact ? 14 : 18, g.band * 0.7);
  const hi = c.hover ? g.indexAt(c.hover.x, c.hover.y) : null;
  const accent = c.colors[mainIdx] ?? "var(--accent)";
  const labelSize = c.compact ? 11 : 12;
  const vSize = valueSize(c);
  return {
    svg: (
      <g>
        <HoverBand plot={g.plot} band={g.band} i={hi} horizontal />
        <line
          x1={g.plot.left + 0.5}
          x2={g.plot.left + 0.5}
          y1={g.plot.top}
          y2={g.plot.bottom}
          className="baseline"
        />
        {rows.map(([p, prev], i) => {
          const cy = g.plot.top + g.band * (i + 0.5);
          const alpha = 1;
          const bw = (Math.max(p.value, 0) / top) * width(g.plot) * c.entry;
          const px = prev
            ? g.plot.left + 1 + (Math.max(prev.value, 0) / top) * width(g.plot)
            : null;
          const end = Math.max(g.plot.left + 1 + bw, px ?? 0);
          return (
            <g key={p.key} opacity={alpha}>
              <text
                x={g.plot.left - 8}
                y={cy}
                textAnchor="end"
                dominantBaseline="middle"
                className="t-label"
                fontSize={labelSize}
              >
                {fitText(p.label, g.plot.left - 12, labelSize)}
              </text>
              {bw > 0.5 && (
                <path
                  d={barPath(g.plot.left + 1, cy - barH / 2, bw, barH, 4, true)}
                  fill={
                    p.key === REST
                      ? "var(--muted)"
                      : c.look.colorful
                        ? CATEGORICAL[i % CATEGORICAL.length]
                        : accent
                  }
                />
              )}
              {px != null && c.entry > 0.6 && (
                <line
                  x1={px}
                  x2={px}
                  y1={cy - barH / 2 - 3}
                  y2={cy + barH / 2 + 3}
                  className="compare-tick"
                />
              )}
              {c.entry > 0.6 && c.look.labels && (
                <text
                  x={end + 6}
                  y={cy}
                  dominantBaseline="middle"
                  className="t-value"
                  fontSize={vSize}
                >
                  {M.format(p.value, c.unit, decimals)}
                </text>
              )}
            </g>
          );
        })}
      </g>
    ),
    tip:
      hi != null && cmp
        ? {
            x: g.plot.left + width(g.plot) / 2,
            y: g.plot.top + g.band * (hi + 0.5) - barH / 2,
            title: rows[hi]![0].label,
            lines: [
              { text: M.format(rows[hi]![0].value, c.unit), color: accent },
              {
                text: `${cmp.name}: ${M.format(rows[hi]![1]?.value ?? 0, c.unit)}`,
                color: "var(--compare)",
              },
            ],
          }
        : null,
  };
}

// ---------- lines and areas: one or several series, the compared period dashed ----------
function drawLines(c: DrawCtx, series: ChartSeries[], average: number | null, filled: boolean) {
  const main = series[0]?.points ?? [];
  const n = main.length;
  if (n === 0) return { svg: <Empty c={c} />, tip: null };
  const g = geometry("line", c.w, c.h, n, c.compact, c.look);
  const maxV = Math.max(...series.flatMap((s) => s.points.map((p) => p.value)));
  const ticks = M.ticks(Math.max(maxV, average ?? 0), c.compact ? 3 : 4);
  const top = ticks[ticks.length - 1]!;
  const y = (v: number) => g.plot.bottom - (Math.max(v, 0) / top) * height(g.plot);
  const x = (i: number) => g.plot.left + g.band * (i + 0.5);
  const drawn = series.filter((s) => s.role !== "compare").length;
  // The compared period first (behind); then the series from last to first, so the largest one is on top.
  const order = series
    .map((_, i) => i)
    .sort(
      (a, b) =>
        (series[a]!.role === "compare" ? -1 : series.length - a) -
        (series[b]!.role === "compare" ? -1 : series.length - b),
    );
  const reveal = g.plot.left + (width(g.plot) + g.band) * c.entry;
  const clipId = `clip${c.uid.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const paths: ReactNode[] = [];
  for (const si of order) {
    const s = series[si]!;
    const pts = s.points;
    const color = c.colors[si]!;
    const dashed = s.role === "compare";
    // As Notion's: a soft gradient under a single line, a flat tint for areas.
    const fill = dashed ? 0 : filled ? (drawn === 1 ? 0.16 : 0.1) : drawn === 1 ? 1 : 0;
    const gradId = `g${clipId}-${si}`;
    // Runs of consecutive points with data: gaps (no_data) break the line instead of pretending it was zero.
    const runs: number[][] = [];
    pts.forEach((p, i) => {
      if (p.no_data) return;
      const last = runs[runs.length - 1];
      if (!last || last[last.length - 1] !== i - 1) runs.push([i]);
      else last.push(i);
    });
    runs.forEach((run, r) => {
      const line = run.map((i, k) => `${k ? "L" : "M"}${x(i)},${y(pts[i]!.value)}`).join("");
      const area = `M${x(run[0]!)},${g.plot.bottom}${run.map((i) => `L${x(i)},${y(pts[i]!.value)}`).join("")}L${x(run[run.length - 1]!)},${g.plot.bottom}Z`;
      if (fill === 1)
        paths.push(
          <g key={`a${si}-${r}`}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={color} stopOpacity={0.22} />
                <stop offset="1" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={area} fill={`url(#${gradId})`} />
          </g>,
        );
      else if (fill > 0)
        paths.push(<path key={`a${si}-${r}`} d={area} fill={color} opacity={fill} />);
      paths.push(
        <path
          key={`l${si}-${r}`}
          d={line}
          fill="none"
          stroke={color}
          strokeWidth={dashed ? 1.5 : 1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={dashed ? "4 4" : undefined}
        />,
      );
      // The period in progress is not comparable yet: its segment is faded.
      if (!dashed && run.length >= 2 && pts[run[run.length - 1]!]!.partial) {
        const a = run[run.length - 2]!;
        const b = run[run.length - 1]!;
        paths.push(
          <line
            key={`pa${si}-${r}`}
            x1={x(a)}
            y1={y(pts[a]!.value)}
            x2={x(b)}
            y2={y(pts[b]!.value)}
            className="partial-mask"
          />,
        );
        paths.push(
          <line
            key={`pb${si}-${r}`}
            x1={x(a)}
            y1={y(pts[a]!.value)}
            x2={x(b)}
            y2={y(pts[b]!.value)}
            stroke={color}
            strokeOpacity={0.4}
            strokeWidth={2}
            strokeLinecap="round"
          />,
        );
      }
      if (run.length === 1)
        paths.push(
          <circle
            key={`d${si}-${r}`}
            cx={x(run[0]!)}
            cy={y(pts[run[0]!]!.value)}
            r={3}
            fill={color}
          />,
        );
    });
  }
  const hi = c.hover ? g.indexAt(c.hover.x, c.hover.y) : null;
  const last = main
    .map((p, k) => (p.no_data ? -1 : k))
    .filter((k) => k >= 0)
    .pop();
  let end: ReactNode = null;
  if (drawn === 1 && last != null && c.entry > 0.95) {
    const p = main[last]!;
    end = (
      <g>
        <circle cx={x(last)} cy={y(p.value)} r={6} className="surface-fill" />
        <circle cx={x(last)} cy={y(p.value)} r={4} fill={c.colors[0]} />
        {p.partial && <circle cx={x(last)} cy={y(p.value)} r={2} className="surface-fill" />}
        {hi == null && !c.look.labels && (
          <text
            x={x(last)}
            y={y(p.value) - 8}
            textAnchor="middle"
            className="t-value"
            fontSize={valueSize(c)}
          >
            {M.formatAuto(p.value, c.unit)}
          </text>
        )}
      </g>
    );
  }
  let hoverMarks: ReactNode = null;
  let tip: Tip | null = null;
  if (hi != null) {
    const p = main[hi]!;
    hoverMarks = (
      <g>
        <line x1={x(hi)} x2={x(hi)} y1={g.plot.top} y2={g.plot.bottom} className="baseline" />
        {series.map((s, si) => {
          const q = s.points[hi];
          if (!q || q.no_data) return null;
          return (
            <g key={si}>
              <circle cx={x(hi)} cy={y(q.value)} r={5} className="surface-fill" />
              <circle cx={x(hi)} cy={y(q.value)} r={3.5} fill={c.colors[si]} />
            </g>
          );
        })}
      </g>
    );
    const anchor = Math.max(
      ...series.map((s) => (s.points[hi] && !s.points[hi]!.no_data ? s.points[hi]!.value : 0)),
    );
    tip = {
      x: x(hi),
      y: p.no_data ? g.plot.bottom : y(anchor),
      title: pointTitle(c.t, p),
      lines: tipLines(c.t, series, c.colors, hi, c.unit, false),
    };
  }
  return {
    svg: (
      <g>
        <defs>
          <clipPath id={clipId}>
            <rect x={0} y={0} width={Math.max(0, reveal)} height={c.h} />
          </clipPath>
        </defs>
        <YAxis c={c} plot={g.plot} ticks={ticks} y={y} />
        <VGrid c={c} plot={g.plot} band={g.band} n={n} />
        <XLabels c={c} plot={g.plot} band={g.band} points={main} />
        <g clipPath={`url(#${clipId})`}>{paths}</g>
        {drawn === 1 && hi == null && (
          <DataLabels
            c={c}
            xs={main.map((_, i) => x(i))}
            ys={main.map((p) => (p.no_data ? null : y(p.value)))}
            values={main.map((p) => p.value)}
            band={g.band}
          />
        )}
        {drawn === 1 && (
          <AverageLine c={c} plot={g.plot} average={average} y={y} labelRight={false} />
        )}
        {end}
        {hoverMarks}
      </g>
    ),
    tip,
  };
}

// ---------- donut: share of a total, legend at the side when there is room ----------
function donutGeometry(w: number, h: number) {
  const withLegend = w > h * 1.5;
  const d = withLegend ? Math.min(h, w * 0.45) : Math.min(w, h);
  const thickness = d * 0.1;
  const radius = d / 2 - thickness / 2 - 2;
  const cx = withLegend ? d / 2 : w / 2;
  const cy = h / 2;
  const indexAt = (points: ChartPoint[], px: number, py: number): number | null => {
    const total = points.reduce((s, p) => s + p.value, 0);
    if (total <= 0) return null;
    const dist = Math.hypot(px - cx, py - cy);
    if (dist < radius - thickness / 2 - 8 || dist > radius + thickness / 2 + 8) return null;
    const deg = ((Math.atan2(py - cy, px - cx) * 180) / Math.PI + 90 + 360) % 360;
    let acc = 0;
    for (let i = 0; i < points.length; i++) {
      acc += (points[i]!.value / total) * 360;
      if (deg <= acc) return i;
    }
    return points.length - 1;
  };
  return { cx, cy, radius, thickness, legendLeft: withLegend ? d + 16 : null, indexAt };
}

function arc(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number): string {
  const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
  const sweep = Math.min(sweepDeg, 359.99);
  const x1 = cx + r * Math.cos(rad(startDeg));
  const y1 = cy + r * Math.sin(rad(startDeg));
  const x2 = cx + r * Math.cos(rad(startDeg + sweep));
  const y2 = cy + r * Math.sin(rad(startDeg + sweep));
  return `M${x1},${y1}A${r},${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x2},${y2}`;
}

function drawDonut(c: DrawCtx, points: ChartPoint[]) {
  const total = points.reduce((s, p) => s + p.value, 0);
  if (!points.length || total <= 0) return { svg: <Empty c={c} />, tip: null };
  const colors = sliceColors(points);
  const d = donutGeometry(c.w, c.h);
  const hi = c.hover ? d.indexAt(points, c.hover.x, c.hover.y) : null;
  const gap = points.length > 1 ? 1.2 : 0;
  let start = 0;
  const slices = points.map((p, i) => {
    const sweep = (p.value / total) * 360 * c.entry;
    const path = arc(d.cx, d.cy, d.radius, start + gap / 2, Math.max(sweep - gap, 0.1));
    start += sweep;
    return (
      <path
        key={p.key}
        d={path}
        fill="none"
        stroke={colors[i]}
        strokeWidth={d.thickness}
        opacity={hi != null && hi !== i ? 0.4 : 1}
      />
    );
  });
  const hp = hi != null ? points[hi]! : null;
  const title = hp
    ? `${hp.label} · ${M.number((hp.value / total) * 100)} %`
    : c.t("chart.totalCenter");
  const value = M.formatAuto(hp ? hp.value : total, c.unit);
  const inner = (d.radius - d.thickness / 2) * 1.7;
  // Notion's donut: the total big in the centre, its name small under it.
  const centerSize = Math.max(
    14,
    Math.min(c.compact ? 18 : 28, (d.radius - d.thickness / 2) * 0.45),
  );
  const legend: ReactNode[] = [];
  if (d.legendLeft != null) {
    const rowH = c.compact ? 18 : 22;
    const rows = Math.min(points.length, Math.floor(c.h / rowH));
    let y = c.h / 2 - (rows * rowH) / 2;
    const sizeA = axisSize(c);
    const sizeL = c.compact ? 11 : 12;
    const sizeV = valueSize(c);
    for (let i = 0; i < rows; i++) {
      const p = points[i]!;
      const pct = `${M.number((p.value / total) * 100)} %`;
      const v = M.formatAuto(p.value, c.unit);
      const pw = textWidth(pct, sizeA);
      const vw = textWidth(v, sizeV, 600);
      const labelW = c.w - d.legendLeft - 14 - vw - pw - 16;
      legend.push(
        <g key={p.key} opacity={hi != null && hi !== i ? 0.5 : 1}>
          <circle cx={d.legendLeft + 4} cy={y + rowH / 2} r={4} fill={colors[i]} />
          <text
            x={d.legendLeft + 14}
            y={y + rowH / 2}
            dominantBaseline="middle"
            className="t-label"
            fontSize={sizeL}
          >
            {fitText(p.label, labelW, sizeL)}
          </text>
          <text
            x={c.w - pw - 8}
            y={y + rowH / 2}
            textAnchor="end"
            dominantBaseline="middle"
            className="t-value"
            fontSize={sizeV}
          >
            {v}
          </text>
          <text
            x={c.w}
            y={y + rowH / 2}
            textAnchor="end"
            dominantBaseline="middle"
            className="t-axis"
            fontSize={sizeA}
          >
            {pct}
          </text>
        </g>,
      );
      y += rowH;
    }
  }
  return {
    svg: (
      <g>
        {slices}
        {c.entry > 0.6 && (
          <g>
            <text
              x={d.cx}
              y={d.cy + 2}
              textAnchor="middle"
              className="t-tip-value donut-total"
              fontSize={centerSize}
            >
              {fitText(value, inner, centerSize, 700)}
            </text>
            <text
              x={d.cx}
              y={d.cy + 8}
              textAnchor="middle"
              dominantBaseline="hanging"
              className="t-tip-title"
              fontSize={11}
            >
              {fitText(title, inner, 11)}
            </text>
          </g>
        )}
        {legend}
      </g>
    ),
    tip: null,
  };
}

// ---------- number: one big figure and its change ----------
function NumberTile({ data, compact }: { data: ChartData; compact: boolean }) {
  const t = useStore((s) => s.t);
  const compare = data.series.find((s) => s.role === "compare");
  const delta = data.delta_pct;
  // Spending going up is bad news, income going up is good; counts are neutral.
  const good =
    delta == null
      ? null
      : data.measure === "income"
        ? delta > 0
        : data.measure === "count"
          ? null
          : delta < 0;
  return (
    <div className={`number-tile${compact ? " compact" : ""}`}>
      <div className="number-big">{M.formatAuto(data.total ?? 0, data.unit ?? "EUR")}</div>
      {delta != null && (
        <div className={`number-delta ${good === true ? "good" : good === false ? "bad" : ""}`}>
          {t("chart.versus", {
            delta: M.percent(delta),
            what: compare?.name ?? t("chart.previousPeriod"),
          })}
        </div>
      )}
      {data.previous_total != null && (
        <div className="muted small">
          {`${compare?.name ? compare.name.charAt(0).toUpperCase() + compare.name.slice(1) : t("chart.before")}: ${M.formatAuto(data.previous_total, data.unit ?? "EUR")}`}
        </div>
      )}
    </div>
  );
}

// ---------- table: the exact values ----------
function ChartTable({ data, color, compact = false, onSelect }: ChartProps) {
  const t = useStore((s) => s.t);
  const colors = seriesColors(data, color ?? ACCENT);
  const main = data.series[0]?.points ?? [];
  const unit = data.unit ?? "EUR";
  return (
    <div className={`chart-table${compact ? " compact" : ""}`}>
      <table>
        <thead>
          <tr>
            <th>{data.x_label ?? ""}</th>
            {data.series.map((s, si) => (
              <th key={si} className="num">
                {data.series.length > 1 && (
                  <span className="dot" style={{ background: colors[si] }} />
                )}
                {data.series.length === 1
                  ? unit === "EUR"
                    ? t("chart.amount")
                    : t("chart.count")
                  : s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {main.map((p, i) => {
            const clickable = Boolean(onSelect) && !p.key.startsWith("_");
            return (
              <tr
                key={p.key}
                className={clickable ? "clickable" : undefined}
                onClick={clickable ? () => onSelect?.(p) : undefined}
              >
                <td>{pointTitle(t, p)}</td>
                {data.series.map((s, si) => {
                  const q = s.points[i];
                  return (
                    <td key={si} className="num">
                      {!q || q.no_data ? "–" : M.format(q.value, unit)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
