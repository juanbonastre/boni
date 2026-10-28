/** The repetition presets of the event detail (none, daily, weekly…) and how a repetition reads in words. */
import type { Locale } from "@boni/calendar";
import { civilFromDays, monthNames, type Recurrence, weekdayNames } from "@boni/calendar";
import { t } from "./i18n.ts";

export type RecPreset = "none" | "daily" | "weekly" | "monthly" | "yearly" | "weekdays" | "custom";

const WEEKDAYS = [1, 2, 3, 4, 5];

export function presetOf(r: Recurrence | null | undefined): RecPreset {
  if (!r) return "none";
  const plain = r.interval === 1 && r.until == null && r.count == null;
  if (!plain) return "custom";
  if (r.freq === "weekly" && r.byWeekday?.length) {
    const sorted = [...r.byWeekday].sort();
    return sorted.length === 5 && sorted.every((d, i) => d === WEEKDAYS[i]) ? "weekdays" : "custom";
  }
  return r.freq;
}

export function ruleOf(preset: RecPreset): Recurrence | null {
  switch (preset) {
    case "none":
    case "custom":
      return null;
    case "weekdays":
      return { freq: "weekly", interval: 1, byWeekday: [...WEEKDAYS] };
    default:
      return { freq: preset, interval: 1 };
  }
}

/** "Cada semana (Lun, Mié), hasta el 12 oct". */
export function recurrenceLabel(r: Recurrence | null | undefined, locale: Locale): string {
  if (!r) return t("rec.none", undefined, locale);
  const preset = presetOf(r);
  let base: string;
  if (preset !== "custom" && preset !== "none") {
    base = t(`rec.${preset}` as "rec.daily", undefined, locale);
  } else {
    const unit = t(`rec.unit.${r.freq}` as "rec.unit.daily", undefined, locale);
    base =
      r.interval === 1
        ? t(`rec.${r.freq}` as "rec.daily", undefined, locale)
        : t("rec.label.every", { n: r.interval, unit }, locale);
  }
  if (r.freq === "weekly" && r.byWeekday?.length && preset !== "weekdays") {
    const names = weekdayNames(locale, "short");
    base += ` (${[...r.byWeekday]
      .sort()
      .map((d) => names[d])
      .join(", ")})`;
  }
  if (r.until != null) {
    const { m, d } = civilFromDays(r.until);
    base += `, ${t("rec.label.until", { date: `${d} ${monthNames(locale, "short")[m - 1]}` }, locale)}`;
  } else if (r.count != null) {
    base += `, ${t("rec.label.count", { n: r.count }, locale)}`;
  }
  return base;
}
