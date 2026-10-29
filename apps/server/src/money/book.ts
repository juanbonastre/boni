import { type FieldDef, label, type TypeDef } from "@boni/entities";
import type { StoredEntity, UserStore } from "@boni/store";
import { createByName, propWrites } from "../byName.ts";
import type { Book, MoneyNote, NewMovement, PropValue } from "./reconcile.ts";

/**
 * The reconciliation's book over Boni's own movements and debts: each record with its properties by name (an
 * option by its name, a category by its name, any other relation by the ids it points to), a new movement made
 * from its properties, a change by property name. Records are known by their id, never by a path (D-17). What
 * comes from a statement is `imported` with the statement as its source; the close's marks are the code's.
 */
const MOVEMENTS = "t_movimiento";
const DEBTS = "t_deuda";
/** The account's "Categorías" (collections.ts): a movement's category is read as the row's name. */
export const CATEGORIES = "t_categoria";
const EXTRACTS = "extractos";

/** A record's title, or "" (deleted or gone). */
export function titleOf(store: UserStore, id: unknown): string {
  const e = typeof id === "string" ? store.get(id)?.entity : undefined;
  const t = e ? store.schema().types[e.type] : undefined;
  return e && t && e.deleted === undefined ? String(e.values[t.titleField] ?? "") : "";
}

/**
 * Boni's records of a type with their properties by name (an option by its name, a category by its name, any
 * other relation by the ids it points to). What the reconciliation and the charts read.
 */
export function storeNotes(store: UserStore): (typeId: string) => MoneyNote[] {
  const types = () => store.schema().types;
  const prop = (f: FieldDef, v: unknown): unknown => {
    if (v === undefined || v === null) return null;
    switch (f.type) {
      case "select":
        return f.options?.find((o) => o.id === v)?.name ?? v;
      case "multiselect":
        return (Array.isArray(v) ? v : [v]).map(
          (x) => f.options?.find((o) => o.id === x)?.name ?? x,
        );
      case "relation": {
        if (f.relation?.target === CATEGORIES) {
          const one = Array.isArray(v) ? v[0] : v;
          const e = typeof one === "string" ? store.get(one)?.entity : undefined;
          return e && e.deleted === undefined ? String(e.values.f_nombre ?? "") || null : null;
        }
        return f.relation?.many ? (Array.isArray(v) ? v : [v]) : Array.isArray(v) ? v[0] : v;
      }
      default:
        return v;
    }
  };
  const asNote = (s: StoredEntity, t: TypeDef): MoneyNote => {
    const fm: Record<string, unknown> = {};
    for (const f of t.fields) {
      if (f.archived || f.hidden || f.id === t.titleField) continue;
      fm[f.name] = prop(f, s.entity.values[f.id]);
    }
    return { id: s.entity.id, title: String(s.entity.values[t.titleField] ?? ""), fm };
  };
  return (typeId: string) => {
    const t = types()[typeId];
    return t ? store.list(typeId).map((s) => asNote(s, t)) : [];
  };
}

export function storeBook(store: UserStore, o: { device?: string; run?: string } = {}): Book {
  const device = o.device ?? "conciliacion";
  const run = o.run ? { run: o.run } : {};
  const types = () => store.schema().types;
  const notes = storeNotes(store);
  const from = (statement: string) => ({
    integrity: "imported" as const,
    source: { kind: "file" as const, id: `${EXTRACTS}/${statement}` },
  });
  return {
    movements: () => notes(MOVEMENTS),
    debts: () => notes(DEBTS),
    title: (id) => titleOf(store, id),
    create(m: NewMovement, statement: string) {
      return createByName(store, MOVEMENTS, m, device, { from: from(statement), ...run });
    },
    update(id, props, statement) {
      const t = types()[MOVEMENTS] as TypeDef;
      const l = (f: FieldDef | null) =>
        label(statement ? "imported" : "own", f?.sensitivity ?? t.sensitivity, [
          statement ? from(statement).source : { kind: "code", id: "conciliacion" },
        ]);
      const meta = { actor: statement ? ("import" as const) : ("agent" as const), device, ...run };
      const writes = propWrites(store, MOVEMENTS, props as Record<string, PropValue>, l, meta);
      if (Object.keys(writes).length) store.update(id, writes, meta);
    },
  };
}
