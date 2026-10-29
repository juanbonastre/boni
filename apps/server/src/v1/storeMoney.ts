import type { UserStore } from "@boni/store";
import type { CategoryKind, Debt, Movement } from "@boni/views";
import { storeNotes, titleOf } from "../money/book.ts";
import { categoryRows } from "../money/collections.ts";
import { type Person, parseDebt, parseMovement } from "./finanzas.ts";

/** What the API v1 reads of an account's money (`StoreMoney`). */
export interface MoneySource {
  movements(): Movement[];
  debts(): Debt[];
  categories(): string[];
  /** What each category is (spending, income, neither), when the account keeps it (Categorías). */
  categoryKinds?(): Map<string, CategoryKind>;
  people(): Person[];
  fingerprint(): string;
}

const MOVEMENTS = "t_movimiento";
const DEBTS = "t_deuda";
/** By date and time, then title and id: lists that keep the first seen match read them always in this order. */
const byDate = <T extends { title: string; id: string; fm: Record<string, unknown> }>(l: T[]) => {
  const key = (n: T) => `${String(n.fm.date ?? "")} ${String(n.fm.time ?? "")}`;
  return [...l].sort((a, b) =>
    key(a) !== key(b)
      ? key(a) < key(b)
        ? -1
        : 1
      : a.title !== b.title
        ? a.title < b.title
          ? -1
          : 1
        : a.id < b.id
          ? -1
          : 1,
  );
};
/** "[[name|alias]]" → "name": a value written before people were a relation, until the reshape converts it. */
const oldLink = (s: string) => /^\[\[([^\]|#]+)/.exec(s)?.[1]?.trim() ?? s;

/**
 * The money read from Boni itself (Juan, 2026-10-23: no more vault): each movement and debt from its properties
 * by name (`parseMovement`, `parseDebt`), named by its id; a movement's people by their names, so the charts
 * group and label them as people.
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

  /** What a list names, by name: a record by its title, anything else as it was written. */
  private named(v: unknown): string[] {
    const list = v === null || v === undefined || v === "" ? [] : Array.isArray(v) ? v : [v];
    return list
      .map((x) => String(x).trim())
      .filter(Boolean)
      .map((x) => titleOf(this.store, x) || oldLink(x));
  }

  movements(): Movement[] {
    return byDate(storeNotes(this.store)(MOVEMENTS))
      .map((n) =>
        parseMovement({
          ...n.fm,
          id: n.id,
          people: this.named(n.fm.people),
          invited: this.named(n.fm.invited),
          related: this.named(n.fm.related),
        }),
      )
      .filter((m): m is Movement => m !== null);
  }

  debts(): Debt[] {
    return byDate(storeNotes(this.store)(DEBTS))
      .map((n) => parseDebt({ ...n.fm, id: n.id }))
      .filter((d): d is Debt & { date: string | null } => d !== null);
  }

  /** The rows of Categorías (none before the money has them). */
  categories(): string[] {
    return (categoryRows(this.store) ?? []).map((c) => c.name);
  }

  categoryKinds(): Map<string, CategoryKind> {
    return new Map((categoryRows(this.store) ?? []).map((c) => [c.name, c.kind]));
  }

  people(): Person[] {
    const type = this.typeOf("persona");
    if (!type) return [];
    return storeNotes(this.store)(type)
      .filter((n) => n.title.trim())
      .map((n) => ({
        id: n.id,
        label: n.title.trim(),
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
}
