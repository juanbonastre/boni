/**
 * How a chart looks, apart from what it shows (as Notion's chart "Style" settings): height, grid lines,
 * axis names, data labels, one colour or one per bar, a running total, zero values left out, and the
 * average as a reference line. Closed: unknown keys and values are dropped, and so are the defaults, so a
 * chart that never changed its look keeps the definition it had.
 */
export interface ChartStyle {
  height?: "s" | "m" | "l" | "xl";
  grid?: "h" | "v" | "both" | "none";
  axes?: "none" | "x" | "y" | "both";
  labels?: boolean;
  colors?: "auto" | "colorful";
  cumulative?: boolean;
  omitZero?: boolean;
  reference?: "none" | "average";
}

export const CHART_STYLE_DEFAULTS: Required<ChartStyle> = {
  height: "m",
  grid: "h",
  axes: "none",
  labels: true,
  colors: "auto",
  cumulative: false,
  omitZero: false,
  reference: "average",
};

const CHOICES: { [K in keyof ChartStyle]-?: readonly unknown[] } = {
  height: ["s", "m", "l", "xl"],
  grid: ["h", "v", "both", "none"],
  axes: ["none", "x", "y", "both"],
  labels: [true, false],
  colors: ["auto", "colorful"],
  cumulative: [true, false],
  omitZero: [true, false],
  reference: ["none", "average"],
};

/** The style kept from anything (only known keys with allowed values, defaults left out); null when none. */
export function chartStyle(raw: unknown): ChartStyle | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const out: Record<string, unknown> = {};
  for (const [k, allowed] of Object.entries(CHOICES)) {
    const v = (raw as Record<string, unknown>)[k];
    if (allowed.includes(v) && v !== CHART_STYLE_DEFAULTS[k as keyof ChartStyle]) out[k] = v;
  }
  return Object.keys(out).length ? (out as ChartStyle) : null;
}

/** Every setting of a style, the defaults filled in. */
export const fullStyle = (s: ChartStyle | null | undefined): Required<ChartStyle> => ({
  ...CHART_STYLE_DEFAULTS,
  ...(s ?? {}),
});
