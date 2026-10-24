/** Pure helpers for axes and number formats (Spanish style, as the server's labels). */

/** Clean axis ticks from 0 up to at least `max`: 0, 50, 100, 150 ... about `count` steps. */
export function ticks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const n = Math.max(1, Math.ceil(max / step - 1e-9));
  // Rounded: 3 × 0.1 is 0.30000000000000004 in floating point, and an axis must read 0,3.
  return Array.from({ length: n + 1 }, (_, i) => Number((i * step).toPrecision(12)));
}

const group = (whole: number) => String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** Money: "1.234,56 €", or without decimals ("1.235 €") when `decimals` is false. */
export function euros(value: number, decimals = true): string {
  const cents = Math.round(Math.abs(value) * 100);
  const whole = decimals ? Math.floor(cents / 100) : Math.floor((cents + 50) / 100);
  const text = decimals ? `${group(whole)},${String(cents % 100).padStart(2, "0")}` : group(whole);
  return `${value < 0 ? "-" : ""}${text} €`;
}

/** Best format for a label: no decimals from 100 up. */
export const eurosAuto = (value: number) => euros(value, Math.abs(value) < 100);

/** Plain number: 1.234 or 2,5. */
export function number(value: number): string {
  const tenths = Math.round(Math.abs(value) * 10);
  const dec = tenths % 10;
  return `${value < 0 ? "-" : ""}${group(Math.floor(tenths / 10))}${dec ? `,${dec}` : ""}`;
}

/** A value in the chart's unit: money ("EUR") or a plain count (""). */
export const format = (value: number, unit = "EUR", decimals = true) =>
  unit === "EUR" ? euros(value, decimals) : number(value);

/** Best format for a label in the chart's unit. */
export const formatAuto = (value: number, unit = "EUR") =>
  unit === "EUR" ? eurosAuto(value) : number(value);

/** Signed percentage with one decimal: "+51,6 %", "-3 %". */
export const percent = (value: number) => `${value > 0 ? "+" : ""}${number(value)} %`;

/** Show every n-th axis label so that at most `maxLabels` fit (the last one is always shown). */
export const labelStep = (count: number, maxLabels: number) =>
  maxLabels <= 0 || count <= maxLabels ? 1 : Math.ceil(count / maxLabels);

/** Compact axis tick: 0, 50, 1K, 2,5K. */
export function compact(value: number): string {
  const short = (x: number, unit: string) =>
    `${Number.isInteger(x) ? x : (Math.round(x * 10) / 10).toString().replace(".", ",")}${unit}`;
  // Millions as "M" (a "1000K" label does not fit the axis).
  if (Math.abs(value) >= 1_000_000) return short(value / 1_000_000, "M");
  if (Math.abs(value) >= 1000) return short(value / 1000, "K");
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
}
