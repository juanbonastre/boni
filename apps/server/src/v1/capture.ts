import { addDays } from "@boni/views";
import { cmp, type Dec, dec, parseDec, share } from "./decimal.ts";
import type { MovementDraft } from "./note.ts";

/**
 * "Apuntar gasto": the form the clients render, its validation and the movement draft, ported from the
 * first Boni's expenses/capture.py. The form's JSON is exactly what that server sent (every default
 * written out), because the Boni apps render it as it comes.
 */
export const ACTION = "expenses.capture";
export const SCREEN_ID = "capture-expense";
const opt = (value: string, label: string) => ({ value, label, hint: null });
export const ACCOUNTS = [opt("efectivo", "Efectivo"), opt("revolut", "Revolut"), opt("ing", "ING")];
const KINDS = [opt("gasto", "Gasto"), opt("ingreso", "Ingreso")];
const MAX_AMOUNT = dec("100000");

const base = (id: string, label: string, required = false) => ({
  id,
  label,
  required,
  help: null as string | null,
  visible_when: null as unknown,
});
const choice = (id: string, label: string, extra: Record<string, unknown>) => ({
  ...base(id, label),
  type: "choice",
  options: null,
  source: null,
  searchable: false,
  style: "chips",
  default: null,
  ...extra,
});
const multi = (id: string, label: string, extra: Record<string, unknown>) => ({
  ...base(id, label),
  type: "multi_choice",
  options: null,
  source: null,
  searchable: false,
  default: [],
  ...extra,
});
const amount = (id: string, label: string, extra: Record<string, unknown>) => ({
  ...base(id, label),
  type: "amount",
  currency: "EUR",
  default: null,
  min: 0.01,
  max: null,
  ...extra,
});
const text = (id: string, label: string, extra: Record<string, unknown>) => ({
  ...base(id, label),
  type: "text",
  default: null,
  max_length: null,
  multiline: false,
  placeholder: null,
  ...extra,
});

export function captureScreen(lastAccount: string | null) {
  const shared = { field: "shared", equals: true };
  return {
    api_version: "1",
    id: SCREEN_ID,
    title: "Apuntar gasto",
    components: [
      {
        type: "form",
        id: "expense",
        fields: [
          choice("kind", "Tipo", { required: true, options: KINDS, default: "gasto" }),
          amount("amount", "Importe", { required: true, max: 100000.0 }),
          choice("account", "Cuenta", {
            required: true,
            options: ACCOUNTS,
            default: lastAccount || "efectivo",
          }),
          choice("category", "Categoría", {
            required: true,
            source: "categories",
            searchable: true,
            style: "dropdown",
          }),
          text("concept", "Concepto", { placeholder: "Qué fue", max_length: 200 }),
          text("merchant", "Comercio", { max_length: 120 }),
          multi("people", "Con quién", { source: "people", searchable: true }),
          { ...base("shared", "Pagué yo por otros"), type: "toggle", default: false },
          multi("invited", "A quién he invitado", {
            source: "people",
            searchable: true,
            help: "No te devuelven nada",
            visible_when: shared,
          }),
          amount("my_share", "Mi parte", {
            visible_when: shared,
            help: "Vacio: se calcula (importe x (1 + invitados) / (personas + 1))",
          }),
          { ...base("date", "Fecha", true), type: "date", default: "today" },
        ],
        submit: { action: ACTION, label: "Guardar" },
      },
    ],
  };
}

/** The ids of the form's fields (a shortcut may only fill those). */
export const CAPTURE_FIELDS = new Set(captureScreen(null).components[0]?.fields.map((f) => f.id));

/** Python's truthiness (bool(v)): "false" as text is true, 0 and empty lists are false. */
export function pyTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}
const pyStr = (v: unknown) => (typeof v === "boolean" ? (v ? "True" : "False") : String(v));
function strList(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (typeof v === "string") return v ? [v] : [];
  if (Array.isArray(v)) return v.map(pyStr).filter((x) => x);
  return [];
}
const decimal = (v: unknown): Dec | null =>
  v === null || v === undefined || (typeof v === "string" && !v.trim()) ? null : parseDec(v);
const dedupe = (xs: string[]) => [...new Set(xs)];
const len = (s: string) => [...s].length;

/** Python's date.fromisoformat for the forms the apps send ("YYYY-MM-DD", "YYYYMMDD"). */
function isoDate(s: string): string | null {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(s);
  if (!m || (s.includes("-") && s.length !== 10)) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > dim) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export interface CaptureContext {
  /** null: unknown (the lists could not be read): those checks are skipped. */
  categories: string[] | null;
  people: ReadonlySet<string> | null;
  /** When the user saved, as civil date and "HH:MM" in the server's zone; null if the app did not say. */
  createdAt: { date: string; time: string } | null;
  today: string;
}

export function validateCapture(
  values: Record<string, unknown>,
  c: CaptureContext,
): { draft: MovementDraft | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const kind = pyTruthy(values.kind) ? pyStr(values.kind) : "gasto";
  if (kind !== "gasto" && kind !== "ingreso") errors.kind = "Tipo no valido";
  const amt = decimal(values.amount);
  if (amt === null || cmp(amt, dec("0")) <= 0) errors.amount = "Pon un importe mayor que 0";
  else if (cmp(amt, MAX_AMOUNT) > 0) errors.amount = "Importe demasiado alto";
  const account = pyTruthy(values.account) ? pyStr(values.account) : "";
  if (!ACCOUNTS.some((o) => o.value === account)) errors.account = "Elige una cuenta";
  const category = (pyTruthy(values.category) ? pyStr(values.category) : "").trim();
  if (!category) errors.category = "Elige una categoria";
  else if (c.categories !== null && !c.categories.includes(category))
    errors.category = "Esa categoria no esta en la lista";
  const concept = (pyTruthy(values.concept) ? pyStr(values.concept) : "").trim();
  const merchant = (pyTruthy(values.merchant) ? pyStr(values.merchant) : "").trim();
  if (len(concept) > 200) errors.concept = "Demasiado largo";
  if (len(merchant) > 120) errors.merchant = "Demasiado largo";
  const who = dedupe(strList(values.people));
  const shared = pyTruthy(values.shared);
  const invited = shared ? dedupe(strList(values.invited)) : [];
  for (const p of invited) if (!who.includes(p)) who.push(p); // like the app: invited people are also people
  if (c.people !== null) {
    const unknown = who.filter((p) => !c.people?.has(p));
    if (unknown.length) errors.people = `No encuentro: ${unknown.join(", ")}`;
  }
  let myShare = shared ? decimal(values.my_share) : null;
  if (shared) {
    if (!who.length) errors.people = "Si pagaste por otros, di con quien";
    else if (myShare === null && amt !== null && cmp(amt, dec("0")) > 0)
      myShare = share(amt, who.length, invited.length);
    if (
      myShare !== null &&
      amt !== null &&
      !(cmp(myShare, dec("0")) >= 0 && cmp(myShare, amt) <= 0)
    )
      errors.my_share = "Tu parte tiene que estar entre 0 y el importe";
  }
  const rawDate = pyTruthy(values.date) ? pyStr(values.date) : "today";
  let d: string | null = rawDate === "today" ? c.today : isoDate(rawDate);
  if (d === null) errors.date = "Fecha no valida";
  if (d !== null && d > addDays(c.today, 1)) errors.date = "La fecha es futura";
  if (Object.keys(errors).length) return { draft: null, errors };
  d = d as string;
  const time = c.createdAt && c.createdAt.date === d ? c.createdAt.time : null;
  return {
    draft: {
      kind: kind as "gasto" | "ingreso",
      amount: amt as Dec,
      account,
      category,
      concept,
      merchant,
      date: d,
      time,
      people: who,
      invited,
      related: [],
      myShare,
    },
    errors: {},
  };
}
