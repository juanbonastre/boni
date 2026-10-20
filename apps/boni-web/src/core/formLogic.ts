import type { FormComponent, FormField, Json, Option } from "./contract.ts";

/** Pure form logic: initial values, visibility, client-side checks, values sent to the server. */

export type Values = Record<string, Json>;

export function initialValues(form: FormComponent, today: string): Values {
  const v: Values = {};
  for (const f of form.fields) {
    switch (f.type) {
      case "amount":
        v[f.id] = f.default ?? null;
        break;
      case "text":
        v[f.id] = f.default ?? "";
        break;
      case "date":
        v[f.id] = !f.default || f.default === "today" ? today : f.default;
        break;
      case "choice":
        v[f.id] = f.default ?? null;
        break;
      case "multi_choice":
        v[f.id] = [...(f.default ?? [])];
        break;
      case "toggle":
        v[f.id] = f.default ?? false;
        break;
      default:
        v[f.id] = null;
    }
  }
  return v;
}

function same(a: Json, b: Json): boolean {
  if (typeof a === "boolean" || typeof b === "boolean") return String(a) === String(b);
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return a === b || (a !== null && b !== null && String(a) === String(b));
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

export function isVisible(field: FormField, values: Values): boolean {
  const cond = field.visible_when;
  return !cond || same(values[cond.field] ?? null, cond.equals);
}

export function isEmpty(v: Json | undefined): boolean {
  if (v === undefined || v === null) return true;
  if (Array.isArray(v)) return v.length === 0;
  return typeof v === "string" && v.trim() === "";
}

/** An amount typed as "12,50" -> 12.5; null if it is not a number. */
export function parseAmount(text: string): number | null {
  const t = text.trim().replaceAll(" ", "").replace(",", ".");
  if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export type ErrorCode = "required" | "not-a-number" | "too-low" | "too-high";

/** Required fields and amounts, checked before sending (the server checks everything again). */
export function clientErrors(form: FormComponent, values: Values): Record<string, ErrorCode> {
  const errors: Record<string, ErrorCode> = {};
  for (const f of form.fields) {
    if (!isVisible(f, values)) continue;
    const v = values[f.id];
    if (f.required && isEmpty(v)) errors[f.id] = "required";
    if (f.type === "amount" && !isEmpty(v)) {
      const n = typeof v === "number" ? v : parseAmount(String(v));
      if (n === null) errors[f.id] = "not-a-number";
      else if (f.min != null && n < f.min) errors[f.id] = "too-low";
      else if (f.max != null && n > f.max) errors[f.id] = "too-high";
    }
  }
  return errors;
}

/** Values to send: hidden fields dropped, amounts as numbers. */
export function payload(form: FormComponent, values: Values): Values {
  const out: Values = {};
  for (const f of form.fields) {
    if (!isVisible(f, values) || f.type === "unknown") continue;
    const v = values[f.id] ?? null;
    out[f.id] =
      f.type === "amount" && typeof v === "string" && !isEmpty(v) ? (parseAmount(v) ?? v) : v;
  }
  return out;
}

/** Lowercase without accents: "Peña" -> "pena" (same matching as the server's option search). */
export const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Options whose label, value or hint contain every word of `query` (accent and case insensitive). */
export function filterOptions(options: Option[], query: string): Option[] {
  const words = fold(query)
    .split(/[\s/-]+/)
    .filter(Boolean);
  if (!words.length) return options;
  return options.filter((o) => {
    const text = fold(`${o.label} ${o.value} ${o.hint ?? ""}`);
    return words.every((w) => text.includes(w));
  });
}

/** "2026-10-12" shifted by whole days (civil dates, no time zone involved). */
export function shiftIso(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}

export const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
