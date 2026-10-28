import type { UserStore } from "@boni/store";
import type { CategoryKind, Debt, Movement } from "@boni/views";
import { findByPath } from "../data.ts";
import { movementPaths, storeNotes } from "../money/book.ts";
import { categoryRows } from "../money/collections.ts";
import { MOV, noteName, type Person, parseDebt, parseMovement, titleFromSlug } from "./finanzas.ts";

/** What the API v1 reads of an account's money (`StoreMoney`), and where a captured movement goes. */
export interface MoneySource {
  movements(): Movement[];
  debts(): Debt[];
  categories(): string[];
  /** What each category is (spending, income, neither), when the account keeps it (Categorías). */
  categoryKinds?(): Map<string, CategoryKind>;
  people(): Person[];
  fingerprint(): string;
  freeMovementPath(date: string, base: string): string;
}

const MOVEMENTS = "t_movimiento";
const DEBTS = "t_deuda";
const CATEGORIES_NOTE = "registros/finanzas/categorias.md";
/** In the order of their notes' paths (as the first Boni read them): lists that keep the first seen match. */
const byPath = <T extends { path: string }>(l: T[]) =>
  [...l].sort((a, b) => (a.path < b.path ? -1 : 1));

/**
 * The money read from Boni itself (Juan, 2026-10-23: no more vault). The same records the first Boni's notes gave
 * (`parseMovement`, `parseDebt` over each entry's properties by name), so every chart gives the same numbers.
 */
export class StoreMoney implements MoneySource {
  // No parameter properties: the server runs TypeScript with Node's type stripping (AGENTS.md).
  private store: UserStore;
  constructor(store: UserStore) {
    this.store = store;
  }

  private typeOf(key: string): string | null {
    return Object.values(this.store.schema().types).find((t) => t.key === key)?.id ?? null;
  }

  movements(): Movement[] {
    return byPath(storeNotes(this.store)(MOVEMENTS, "movement"))
      .map((n) => parseMovement({ ...n.fm, path: n.path }))
      .filter((m): m is Movement => m !== null);
  }

  debts(): Debt[] {
    return byPath(storeNotes(this.store)(DEBTS, "debt"))
      .map((n) => parseDebt({ ...n.fm, path: n.path }))
      .filter((d): d is Debt & { date: string | null } => d !== null);
  }

  /** The rows of Categorías; before it exists, the `categories` list of registros/finanzas/categorias.md. */
  categories(): string[] {
    const own = categoryRows(this.store);
    if (own) return own.map((c) => c.name);
    let hit: { type: string; id: string };
    try {
      hit = findByPath(this.store, CATEGORIES_NOTE);
    } catch {
      return [];
    }
    const note = storeNotes(this.store)(hit.type, "").find((n) => n.id === hit.id);
    const v = note?.fm.categories;
    const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\n,]/) : [];
    return list.map((x) => String(x).trim()).filter(Boolean);
  }

  categoryKinds(): Map<string, CategoryKind> {
    return new Map((categoryRows(this.store) ?? []).map((c) => [c.name, c.kind]));
  }

  people(): Person[] {
    const type = this.typeOf("persona");
    if (!type) return [];
    return storeNotes(this.store)(type, "person")
      .map((n) => ({
        slug: noteName(n.path),
        label: titleFromSlug(noteName(n.path)),
        hint: typeof n.fm.summary === "string" && n.fm.summary ? n.fm.summary : null,
      }))
      .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
  }

  /** Changes when a movement or a debt does (how many, and the latest change). */
  fingerprint(): string {
    const parts: string[] = [];
    for (const t of [MOVEMENTS, DEBTS]) {
      const list = this.store.list(t);
      parts.push(`${t}:${list.length}:${Math.max(0, ...list.map((s) => s.entity.updated))}`);
    }
    return parts.join("|");
  }

  freeMovementPath(date: string, base: string): string {
    const folder = `${MOV}/${date.slice(0, 4)}/${date.slice(5, 7)}`;
    const taken = movementPaths(this.store);
    for (let n = 1; n < 1000; n++) {
      const path = `${folder}/${n === 1 ? base : `${base}-${n}`}.md`;
      if (!taken.has(path)) return path;
    }
    throw new Error("could not find a free note name");
  }
}
