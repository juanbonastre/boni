import { type FieldDef, label, type TypeDef } from "@boni/entities";
import type { StoredEntity, UserStore } from "@boni/store";
import { entityFromNote, propWrites } from "../fromNote.ts";
import type { Book, MoneyNote, PropValue } from "./reconcile.ts";

/**
 * The reconciliation's book over Boni's own movements and debts (core mode): each entity as the note the script
 * read (its properties by name: an option by its name, a relation as the `[[note]]` it points to), a new movement
 * made from the script's note text (Boni's mirror writes the note), a change by property name. What comes from a
 * statement is `imported` with the statement as its source; the close's marks are the code's.
 */
const PATH_FIELD = "f_vault_path";
const MOVEMENTS = "t_movimiento";
const DEBTS = "t_deuda";
const EXTRACTS = "registros/finanzas/extractos";

const baseName = (p: string) => (p.split("/").pop() ?? p).replace(/\.md$/i, "");

export function storeBook(store: UserStore, o: { device?: string; run?: string } = {}): Book {
  const device = o.device ?? "conciliacion";
  const run = o.run ? { run: o.run } : {};
  const types = () => store.schema().types;
  const noteNames = new Map<string, string>();
  /** The note an entity is (its path's name), for relations. */
  const nameOf = (id: string): string | null => {
    if (noteNames.has(id)) return noteNames.get(id) as string;
    const e = store.get(id)?.entity;
    const t = e ? types()[e.type] : undefined;
    const p = e?.values[PATH_FIELD];
    const name =
      typeof p === "string" ? baseName(p) : t ? String(e?.values[t.titleField] ?? "") : null;
    if (name !== null) noteNames.set(id, name);
    return name;
  };
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
        const link = (x: unknown) => {
          const n = typeof x === "string" ? nameOf(x) : null;
          return n ? `[[${n}]]` : null;
        };
        return f.relation?.many
          ? (Array.isArray(v) ? v : [v]).map(link).filter(Boolean)
          : link(Array.isArray(v) ? v[0] : v);
      }
      default:
        return v;
    }
  };
  const asNote = (s: StoredEntity, t: TypeDef, type: string): MoneyNote => {
    const fm: Record<string, unknown> = { type };
    for (const f of t.fields) {
      if (f.id === PATH_FIELD || f.id === t.titleField) continue;
      fm[f.name] = prop(f, s.entity.values[f.id]);
    }
    fm.type = type;
    const p = s.entity.values[PATH_FIELD];
    return { id: s.entity.id, path: typeof p === "string" ? p : s.entity.id, fm };
  };
  const notes = (typeId: string, type: string) => {
    const t = types()[typeId];
    return t ? store.list(typeId).map((s) => asNote(s, t, type)) : [];
  };
  let paths: Set<string> | null = null;
  const from = (statement: string) => ({
    integrity: "imported" as const,
    source: { kind: "vault" as const, id: `${EXTRACTS}/${statement}` },
  });
  return {
    movements: () => notes(MOVEMENTS, "movement"),
    debts: () => notes(DEBTS, "debt"),
    taken(path) {
      if (!paths) {
        paths = new Set();
        for (const s of store.list(MOVEMENTS, { includeDeleted: true })) {
          const p = s.entity.values[PATH_FIELD];
          if (typeof p === "string") paths.add(p);
        }
      }
      return paths.has(path);
    },
    create(path, text, statement) {
      entityFromNote(store, MOVEMENTS, path, text, device, {
        from: from(statement),
        headingTitle: true,
        ...run,
      });
      paths?.add(path);
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
