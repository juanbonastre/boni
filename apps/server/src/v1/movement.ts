import type { ByName } from "../byName.ts";
import { abs, type Dec, money, neg } from "./decimal.ts";

/**
 * The movement a capture makes (ported from the first Boni's expenses/note.py, itself a port of gastos-app's
 * MovementNote): its title (the concept or the merchant, and the amount), its properties by name and the people
 * it was with as records of Persona (their ids).
 */
export interface MovementDraft {
  kind: "gasto" | "ingreso";
  /** Positive, as typed. */
  amount: Dec;
  account: string;
  category: string;
  concept: string;
  merchant: string;
  date: string;
  /** "HH:MM", or null. */
  time: string | null;
  people: string[];
  invited: string[];
  related: string[];
  myShare: Dec | null;
}

/** "Peña y Ruíz" -> "Pena y Ruiz" (no accents in generated names). */
export const asciiText = (s: string) => s.normalize("NFD").replace(/\p{Mn}/gu, "");

/** "Cena con Peña!" -> "cena-con-pena" (Slug.of in gastos-app). */
export function slug(s: string, max = 60): string {
  return asciiText(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/^-+|-+$/g, "");
}

const euros = (x: Dec) => money(abs(x)).replace(".", ",");

export function movementRecord(d: MovementDraft, created: string): ByName {
  const signed = d.kind === "gasto" ? neg(abs(d.amount)) : abs(d.amount);
  const merchant = d.merchant.trim();
  const title = d.concept.trim() || merchant || "Movimiento";
  return {
    title: `${title} ${euros(d.amount)} EUR`,
    values: {
      date: d.date,
      time: d.time,
      amount: Number(money(signed)),
      currency: "EUR",
      my_share: d.myShare !== null ? Number(money(abs(d.myShare))) : null,
      account: d.account,
      category: d.category,
      merchant: merchant || null,
      concept: d.concept.trim() || null,
      people: d.people,
      invited: d.invited,
      status: "pendiente",
      source: "manual",
      created,
    },
  };
}
