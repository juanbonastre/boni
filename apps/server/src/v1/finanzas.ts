import type { Debt, Movement } from "@boni/views";

/**
 * The money's records as the charts read them (ported from the first Boni's sources/finanzas.py): a movement or a
 * debt from its properties by name (`parseMovement`, `parseDebt`), as Boni keeps them (`StoreMoney`). Each is
 * named by its record's id; a debt's movement and what a movement settles are ids; its people are their names.
 */
export interface Person {
  /** The record of Persona. */
  id: string;
  label: string;
  hint: string | null;
}

const asList = (v: unknown): unknown[] =>
  v === null || v === undefined || v === "" ? [] : Array.isArray(v) ? v : [v];
const names = (v: unknown): string[] =>
  asList(v)
    .map((x) => String(x).trim())
    .filter(Boolean);
export function toFloat(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).replace(",", ".").trim();
  const n = Number(s);
  return s !== "" && Number.isFinite(n) ? n : null;
}
const pyStr = (v: unknown) =>
  v === null || v === undefined || v === "" || v === false || v === 0 ? "" : String(v);
function isoDay(v: unknown): string | null {
  const s = String(v ?? "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate() ? s : null;
}

export function parseMovement(row: Record<string, unknown> & { id: string }): Movement | null {
  const date = isoDay(row.date);
  const amount = toFloat(row.amount);
  if (date === null || amount === null) return null;
  return {
    name: row.id,
    date,
    amount,
    category: pyStr(row.category),
    my_share: toFloat(row.my_share),
    settles: names(row.settles)[0] ?? "",
    people: names(row.people),
    invited: names(row.invited),
    related: names(row.related),
    account: pyStr(row.account),
    merchant: pyStr(row.merchant).trim(),
    concept: pyStr(row.concept).trim(),
    status: pyStr(row.status),
    source: pyStr(row.source),
  };
}

export function parseDebt(
  row: Record<string, unknown> & { id: string },
): (Debt & { date: string | null }) | null {
  const amount = toFloat(row.amount);
  if (amount === null) return null;
  return {
    name: row.id,
    movement: names(row.movement)[0] ?? "",
    amount: Math.abs(amount),
    direction: pyStr(row.direction) || "me-deben",
    status: pyStr(row.status),
    date: isoDay(row.date),
  };
}
