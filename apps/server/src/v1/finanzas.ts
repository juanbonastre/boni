import type { Debt, Movement } from "@boni/views";

/**
 * The money's note formats (the first Boni's registros/finanzas), ported from its sources/finanzas.py: a movement
 * or a debt read from its properties by name (`parseMovement`, `parseDebt`), as Boni keeps them (`StoreMoney`),
 * and where a new movement's note goes. The only module that knows those formats.
 */
const FIN = "registros/finanzas";
export const MOV = `${FIN}/movimientos`;

export interface Person {
  slug: string;
  label: string;
  hint: string | null;
}

/** "[[name|alias]]" -> "name". */
export function linkName(v: unknown): string {
  let s = String(v ?? "").trim();
  if (s.startsWith("[[") && s.endsWith("]]")) s = s.slice(2, -2);
  return (s.split("|", 1)[0] ?? "").split("#", 1)[0]?.trim() ?? "";
}
const asList = (v: unknown): unknown[] =>
  v === null || v === undefined || v === "" ? [] : Array.isArray(v) ? v : [v];
export function toFloat(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).replace(",", ".").trim();
  const n = Number(s);
  return s !== "" && Number.isFinite(n) ? n : null;
}
export const noteName = (path: string) => (path.split("/").pop() ?? "").replace(/\.md$/, "");
const pyStr = (v: unknown) =>
  v === null || v === undefined || v === "" || v === false || v === 0 ? "" : String(v);
function isoDay(v: unknown): string | null {
  const s = String(v ?? "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate() ? s : null;
}

export function parseMovement(row: Record<string, unknown> & { path: string }): Movement | null {
  const date = isoDay(row.date);
  const amount = toFloat(row.amount);
  if (date === null || amount === null) return null;
  return {
    name: noteName(row.path),
    date,
    amount,
    category: pyStr(row.category),
    my_share: toFloat(row.my_share),
    settles: linkName(row.settles),
    people: asList(row.people).map(linkName),
    invited: asList(row.invited).map(linkName),
    related: asList(row.related).map(linkName),
    account: pyStr(row.account),
    merchant: pyStr(row.merchant).trim(),
    concept: pyStr(row.concept).trim(),
    status: pyStr(row.status),
    source: pyStr(row.source),
  };
}

export function parseDebt(
  row: Record<string, unknown> & { path: string },
): (Debt & { date: string | null }) | null {
  const amount = toFloat(row.amount);
  if (amount === null) return null;
  return {
    name: noteName(row.path),
    movement: linkName(row.movement),
    amount: Math.abs(amount),
    direction: pyStr(row.direction) || "me-deben",
    status: pyStr(row.status),
    date: isoDay(row.date),
  };
}

export const titleFromSlug = (slug: string) =>
  slug
    .split("-")
    .filter((w) => w)
    .map((w) => (w[0]?.toUpperCase() ?? "") + w.slice(1))
    .join(" ");
