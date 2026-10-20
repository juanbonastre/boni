import { euros, number } from "./chartMath.ts";
import type { FormComponent, Json, Option, Screen } from "./contract.ts";
import * as F from "./formLogic.ts";

/**
 * Pure shortcut logic. A shortcut is a server screen plus values for its form; nothing here knows what the form
 * captures: it only reads the form's fields.
 */

export const formOf = (screen: Screen | null | undefined): FormComponent | null =>
  (screen?.components.find((c) => c.type === "form") as FormComponent | undefined) ?? null;

/**
 * The values a shortcut keeps from a filled form: what was chosen or typed, without dates (a shortcut used next
 * week means next week's date), empty fields or switches left off.
 */
export function shortcutValues(form: FormComponent, values: F.Values): F.Values {
  const out: F.Values = {};
  for (const f of form.fields) {
    const v = values[f.id];
    if (f.type === "date" || f.type === "unknown" || F.isEmpty(v) || !F.isVisible(f, values))
      continue;
    if (f.type === "toggle" && v !== true && v !== "true") continue;
    out[f.id] = v ?? null;
  }
  return out;
}

/** The form's starting values with the shortcut's on top (the date stays today). */
export const filledValues = (form: FormComponent, values: F.Values, today: string): F.Values => ({
  ...F.initialValues(form, today),
  ...values,
});

/** True when the shortcut can be saved as it is (every required field has a value). */
export const canSaveDirectly = (form: FormComponent, values: F.Values, today: string) =>
  Object.keys(F.clientErrors(form, filledValues(form, values, today))).length === 0;

const label = (options: Option[] | null | undefined, value: Json) =>
  options?.find((o) => o.value === value)?.label ?? String(value);

/**
 * Most telling first: amounts, then what was typed, then picks from long lists, then the rest; small fixed choices
 * (chips like "expense / income") last.
 */
function rank(f: FormComponent["fields"][number]): number {
  if (f.type === "amount") return 0;
  if (f.type === "text") return 1;
  if (f.type === "choice") return f.options && !f.searchable ? 5 : 2;
  if (f.type === "multi_choice") return 3;
  return 4;
}

/**
 * What a shortcut puts in the form, most telling first, as short texts: "1,60 €", "Café", "Efectivo". Option
 * labels come from the field itself or from the lists already loaded (`options`, by source).
 */
export function summary(
  form: FormComponent,
  values: F.Values,
  options: Record<string, Option[]>,
): string[] {
  const parts: string[] = [];
  const fields = form.fields
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
    .map((x) => x.f);
  for (const f of fields) {
    const v = values[f.id];
    if (F.isEmpty(v)) continue;
    switch (f.type) {
      case "amount": {
        const n = typeof v === "number" ? v : F.parseAmount(String(v));
        if (n == null) break;
        parts.push((f.currency ?? "EUR") === "EUR" ? euros(n) : `${number(n)} ${f.currency}`);
        break;
      }
      case "choice":
        parts.push(label(f.options ?? (f.source ? options[f.source] : null), v ?? null));
        break;
      case "multi_choice": {
        const list = f.options ?? (f.source ? options[f.source] : null);
        parts.push((Array.isArray(v) ? v : [v ?? null]).map((x) => label(list, x)).join(", "));
        break;
      }
      case "toggle":
        if (v === true || v === "true") parts.push(f.label);
        break;
      case "text":
        parts.push(String(v));
        break;
      default:
        break;
    }
  }
  return parts;
}

/** A name to start from: the first text typed (a concept), else the two most telling parts of the summary. */
export function suggestedLabel(
  form: FormComponent,
  values: F.Values,
  options: Record<string, Option[]>,
): string {
  const text = form.fields.find((f) => f.type === "text" && !F.isEmpty(values[f.id]));
  if (text) return String(values[text.id]).trim().slice(0, 60);
  return summary(form, values, options).slice(0, 2).join(" · ").slice(0, 60);
}
