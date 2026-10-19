import { fold, type Profile } from "./chart.ts";
import type { Day } from "./dates.ts";
import { pySum } from "./pyround.ts";

/**
 * Money movements as chart records, and the single definition of "spending" (gasto), ported from the
 * first Boni's `stats/spending.py` and `stats/engine.py` (legacy/boni; same as gastos-app's
 * tools/finanzas.py and the vault's registros/finanzas/README.md). Change it in all of them together.
 *
 * - Only spending categories count: not `ingreso/`, `inversion`, `transferencia/`.
 * - An expense counts as Juan's share: `my_share` if set, else the whole amount.
 * - A positive movement of a spending category that `settles` a debt is a friend paying back: 0.
 * - A positive movement that `settles` an expense (a shop refund) reduces spending.
 * - A debt Juan decided not to collect (`perdonada`, `invitacion`, direction `me-deben`) becomes his
 *   spending, on the date and with the fields of the original expense.
 */

export interface Movement {
  name: string;
  date: Day;
  amount: number;
  category: string;
  my_share?: number | null;
  settles?: string;
  people?: string[];
  invited?: string[];
  related?: string[];
  account?: string;
  merchant?: string;
  concept?: string;
  status?: string;
  source?: string;
}

export interface Debt {
  name: string;
  movement: string;
  amount: number;
  direction: string;
  status: string;
}

export interface MoneyRec {
  date: Day;
  /** Juan's spending (negative = refund); 0 if not spending. */
  spending: number;
  /** Income (ingreso/...), positive. */
  income: number;
  /** An expense of Juan's (for count and average). */
  counted: boolean;
  /** The movement's signed amount, as in the bank. */
  amount: number;
  category: string;
  account: string;
  merchant: string;
  concept: string;
  status: string;
  source: string;
  people: string[];
  invited: string[];
  related: string[];
}

const NOT_SPENDING = ["ingreso/", "inversion", "transferencia/"];
const FORGIVEN = new Set(["perdonada", "invitacion"]);

export const isSpending = (category: string) =>
  !NOT_SPENDING.some((p) => (category || "").startsWith(p));

export function movementSpending(m: Movement, debtNames: ReadonlySet<string>): number {
  if (!isSpending(m.category)) return 0;
  if (m.amount < 0) return m.my_share !== null && m.my_share !== undefined ? m.my_share : -m.amount;
  if (m.amount > 0 && m.settles && !debtNames.has(m.settles)) return -m.amount;
  return 0;
}

const rec = (m: Movement, spending: number, income: number, counted: boolean): MoneyRec => ({
  date: m.date,
  spending,
  income,
  counted,
  amount: m.amount,
  category: m.category,
  account: m.account ?? "",
  merchant: m.merchant ?? "",
  concept: m.concept ?? "",
  status: m.status ?? "",
  source: m.source ?? "",
  people: m.people ?? [],
  invited: m.invited ?? [],
  related: m.related ?? [],
});

/** One record per movement, plus one per forgiven debt (on its expense's date and fields). */
export function moneyRecords(movements: Movement[], debts: Debt[]): MoneyRec[] {
  const debtNames = new Set(debts.map((d) => d.name));
  const out = movements.map((m) => {
    const sp = movementSpending(m, debtNames);
    const inc = m.category.startsWith("ingreso/") && m.amount > 0 ? m.amount : 0;
    return rec(m, sp, inc, m.amount < 0 && isSpending(m.category) && sp > 0);
  });
  const byName = new Map(movements.map((m) => [m.name, m]));
  for (const d of debts)
    if (FORGIVEN.has(d.status) && d.direction === "me-deben") {
      const m = byName.get(d.movement);
      if (m && isSpending(m.category)) out.push(rec(m, d.amount, 0, false));
    }
  return out;
}

/** Months ("YYYY-MM") with any movement: a time bucket without one is a gap, not zero spending. */
export const monthsWithData = (movements: Movement[]) =>
  new Set(movements.map((m) => m.date.slice(0, 7)));

// ---------------------------------------------------------------- the money profile

const MULTI = new Set(["people", "invited", "related"]);
const group = (r: MoneyRec) => (r.category || "otros").split("/", 1)[0] || "otros";
const nice = (s: string) => {
  const t = s.replaceAll("-", " ").trim();
  return (t[0]?.toUpperCase() ?? "") + t.slice(1);
};
/** "ana-ejemplo" -> "Ana Ejemplo" (Python's title_from_slug). */
const titleFromSlug = (slug: string) =>
  slug
    .split("-")
    .filter((w) => w)
    .map((w) => (w[0]?.toUpperCase() ?? "") + w.slice(1))
    .join(" ");
const ACCOUNTS: Record<string, string> = { efectivo: "Efectivo", revolut: "Revolut", ing: "ING" };
const EMPTY_LABEL: Record<string, string> = {
  group: "(sin grupo)",
  category: "(sin categoria)",
  account: "(sin cuenta)",
  merchant: "(sin comercio)",
  concept: "(sin concepto)",
  people: "(nadie)",
  invited: "(nadie)",
  related: "(sin proyecto ni evento)",
  status: "(sin estado)",
  source: "(sin origen)",
};

export const moneyProfile: Profile<MoneyRec> = {
  day: (r) => r.date,
  values(r, field) {
    if (MULTI.has(field)) {
      const vals = r[field as "people"];
      return vals.length ? [...vals] : [""];
    }
    if (field === "group") return [group(r)];
    if (field === "date") return [r.date];
    if (field === "amount") return [String(Math.abs(r.amount))];
    const v = (r as unknown as Record<string, unknown>)[field];
    return [typeof v === "string" ? v : ""];
  },
  folded: new Set(["category", "group", "account", "status", "source"]),
  pathLike: new Set(["category", "group"]),
  number: (r, field) => (field === "amount" ? Math.abs(r.amount) : null),
  isNumber: (field) => field === "amount",
  labeler(field, rawKeys) {
    const keys = rawKeys.filter((k) => k !== "_rest" && k !== "_other");
    if (field === "category") {
      const groups = new Set(keys.filter((k) => k).map((k) => k.split("/", 1)[0]));
      const oneGroup = groups.size <= 1;
      return (k) => {
        if (!k) return EMPTY_LABEL.category as string;
        const i = k.indexOf("/");
        const g = i < 0 ? k : k.slice(0, i);
        const sub = i < 0 ? "" : k.slice(i + 1);
        if (!sub) return nice(g);
        return oneGroup ? nice(sub) : `${nice(sub)} (${g})`;
      };
    }
    return (k) => {
      if (!k) return EMPTY_LABEL[field] ?? "(vacio)";
      if (field === "group") return nice(k);
      if (field === "account") return ACCOUNTS[k] ?? nice(k);
      if (field === "people" || field === "invited") return titleFromSlug(k);
      if (field === "status" || field === "source") return nice(k);
      return k;
    };
  },
  measure(measure, recs) {
    if (measure === "income") return pySum(recs.map((r) => r.income));
    if (measure === "count") return recs.filter((r) => r.counted).length;
    if (measure === "average") {
      const n = recs.filter((r) => r.counted).length;
      return n ? pySum(recs.map((r) => r.spending)) / n : 0;
    }
    return pySum(recs.map((r) => r.spending));
  },
  relevant: (r, measure) => (measure === "income" ? r.income > 0 : r.spending !== 0 || r.counted),
  unit: (measure) => (measure === "count" ? "" : "EUR"),
  allStart: "2024-01-01",
  isAverage: (measure) => measure === "average",
};

export { fold };
