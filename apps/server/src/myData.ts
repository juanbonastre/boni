/**
 * «Mis datos» as a collection (docs/flujos.md §4.7, F6b; Juan, 2026-11-05: «Sí, que sea una colección»): Boni makes a
 * row per page and collection of the user's, and its own after them (its template pages and its records), and the
 * section is that collection's page, with the views, filters and «Nuevo» of any other. It is the one Boni's collection
 * a person changes (D-04): a change to a row is done to what the row is, by the same functions as anywhere else and
 * with their rules (a name used once, a private collection lowered only from its own page, only an empty collection
 * deleted) and their Undo. Made on each read (a few dozen rows, so what changed a moment ago shows at once), never
 * stored, and outside the store's schema: no model and no assistant sees it.
 */
import { createHash } from "node:crypto";
import {
  branch,
  type Entity,
  type FieldDef,
  type FieldType,
  label,
  type SelectOption,
  type TypeDef,
} from "@boni/entities";
import { AI_LEVELS, type AiLevel, type UserStore } from "@boni/store";
import { dataLevel, dataRowTarget, SYS } from "@boni/views";
import {
  createCollection,
  DataError,
  deleteCollection,
  moveCollection,
  notesInTree,
  renameCollection,
  restoreCollection,
  setNotesInTree,
  setProtection,
  userTypes,
} from "./data.ts";
import { createPage, listPages, PageError, removePage, restorePage, updatePage } from "./pages.ts";
import { timed } from "./perf.ts";
import {
  SYS_ACTIVITY,
  SYS_CALLS,
  SYS_DATA,
  SYS_RUNS,
  type SystemCollections,
} from "./systemCollections.ts";
import { usageOf, type Who } from "./usage.ts";

const D = SYS.data;
const L = label("own", "personal", []);
const LEVEL_NAMES: Record<AiLevel, string> = {
  visible: "Visible",
  opaque: "Opaca",
  restricted: "Restringida",
  private: "Privada",
};
const ZONE_NAMES: Record<string, string> = {
  restricted: "restricted/ del vault",
  private: "private/ del vault",
};
/** Boni's records listed here (not «Mis datos» itself). */
const BONI_RECORDS: readonly string[] = [SYS_CALLS, SYS_ACTIVITY, SYS_RUNS];
const NEW_NAME = "Nueva colección";

const opt = (id: string, name: string): SelectOption => ({ id, name, label: L });
const field = (id: string, name: string, type: FieldType, more: Partial<FieldDef> = {}) =>
  ({ id, key: id.slice(2), name, type, label: L, ...more }) as FieldDef;
/** Who reads or writes, as an option: the same id for the same one on every read. */
const whoId = (w: Who) => `o_w_${createHash("sha256").update(w.id).digest("hex").slice(0, 10)}`;

function typeOf(who: SelectOption[], zones: SelectOption[]): TypeDef {
  return {
    id: SYS_DATA,
    key: "datos",
    name: "Mis datos",
    icon: "🗂️",
    fields: [
      field(D.title, "Nombre", "text"),
      field(D.kind, "Tipo", "select", {
        options: [opt(D.page, "Página"), opt(D.collection, "Colección"), opt(D.boni, "De Boni")],
      }),
      field(D.mother, "Madre", "relation", { relation: { target: SYS_DATA, many: false } }),
      field(D.level, "Nivel", "select", {
        options: AI_LEVELS.map((l) => opt(dataLevel(l), LEVEL_NAMES[l])),
      }),
      field(D.notes, "Elementos", "number"),
      field(D.bar, "En la barra", "checkbox"),
      field(D.reads, "Leída por", "multiselect", { options: who }),
      field(D.writes, "Escrita por", "multiselect", { options: who }),
      field(D.origin, "Origen", "select", { options: zones }),
    ],
    titleField: D.title,
    sensitivity: "personal",
    schemaVersion: 1,
    label: L,
  };
}

/** The collection and its rows: the user's pages (each after its mother), his collections (each mother before her
 * daughters, by name), then Boni's. */
export function myData(
  store: UserStore,
  o: { now: number; tz: string; sys: SystemCollections },
): { type: TypeDef; rows: Entity[] } {
  const usage = usageOf(store, { now: o.now, tz: o.tz });
  const who = new Map<string, SelectOption>();
  const ids = (list: readonly Who[] | undefined) =>
    (list ?? []).map((w) => {
      const id = whoId(w);
      if (!who.has(id)) who.set(id, opt(id, w.name));
      return id;
    });
  const schema = store.schema();
  const levels = store.aiAccess();
  const zones = store.zones();
  const mine = userTypes(store);
  const pages = listPages(store);
  const rows: Entity[] = [];
  const row = (id: string, values: Entity["values"], updated = 0) =>
    rows.push({ id: D.row + id, type: SYS_DATA, values, created: updated, updated, version: 1 });

  const own = pages.filter((p) => !p.template);
  const walkPages = (parent: string | null, depth: number) => {
    for (const p of own.filter((x) =>
      parent === null ? !x.parent || !own.some((y) => y.id === x.parent) : x.parent === parent,
    )) {
      row(
        p.id,
        {
          [D.title]: p.title,
          [D.kind]: D.page,
          ...(p.parent && own.some((y) => y.id === p.parent)
            ? { [D.mother]: D.row + p.parent }
            : {}),
        },
        p.updated,
      );
      if (depth < 6) walkPages(p.id, depth + 1);
    }
  };
  walkPages(null, 0);

  const isRoot = (t: TypeDef) => !t.parent || !mine.some((y) => y.id === t.parent);
  const walk = (parent: string | null) => {
    const here = mine
      .filter((t) => (parent === null ? isRoot(t) : t.parent === parent))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
    for (const t of here) {
      const u = usage.types[t.id];
      const reads = ids(u?.reads);
      const writes = ids(u?.writes);
      row(t.id, {
        [D.title]: t.name,
        [D.kind]: D.collection,
        ...(isRoot(t) ? {} : { [D.mother]: D.row + t.parent }),
        [D.level]: dataLevel(levels[t.id] ?? "visible"),
        // Her table's rows: hers and her daughters', as her page counts them.
        [D.notes]: branch(schema, t.id).reduce((n, id) => n + store.count(id), 0),
        [D.bar]: notesInTree(store, t),
        ...(reads.length ? { [D.reads]: reads } : {}),
        ...(writes.length ? { [D.writes]: writes } : {}),
        ...(zones[t.id] ? { [D.origin]: `o_origen_${zones[t.id]}` } : {}),
      });
      walk(t.id);
    }
  };
  walk(null);

  for (const p of pages.filter((x) => x.template))
    row(p.id, { [D.title]: p.title, [D.kind]: D.boni }, p.updated);
  for (const id of BONI_RECORDS) {
    const t = o.sys.types[id];
    if (t)
      row(id, {
        [D.title]: t.name,
        [D.kind]: D.boni,
        [D.level]: dataLevel("private"),
        [D.notes]: o.sys.count(id),
      });
  }
  const usedZones = [...new Set(Object.values(zones))].map((z) =>
    opt(`o_origen_${z}`, ZONE_NAMES[z] ?? z),
  );
  return { type: typeOf([...who.values()], usedZones), rows };
}

/**
 * Boni's collections with «Mis datos» among them (http.ts gives the app these): made only when asked for, then kept
 * for the request.
 */
export function withMyData(
  store: UserStore,
  base: SystemCollections,
  o: { now: number; tz: string },
): SystemCollections {
  let made: { type: TypeDef; rows: Entity[] } | null = null;
  const mine = () => {
    made ??= timed("«Mis datos»", 200, () => myData(store, { ...o, sys: base }));
    return made;
  };
  return {
    get types() {
      return { ...base.types, [SYS_DATA]: mine().type };
    },
    rows: (t) => (t === SYS_DATA ? mine().rows : base.rows(t)),
    count: (t) => (t === SYS_DATA ? mine().rows.length : base.count(t)),
  };
}

type Target = { kind: "collection" | "page"; id: string } | { kind: "boni" };

/** What a row of «Mis datos» is: one of the user's collections or pages, or one of Boni's (changed nowhere here). */
function targetOf(store: UserStore, row: string): Target {
  const id = dataRowTarget(row);
  if (!id) throw new DataError("not-found");
  if (userTypes(store).some((t) => t.id === id)) return { kind: "collection", id };
  const page = listPages(store).find((p) => p.id === id);
  if (page) return page.template ? { kind: "boni" } : { kind: "page", id };
  if (BONI_RECORDS.includes(id)) return { kind: "boni" };
  throw new DataError("not-found");
}

/** A page's own errors as the data routes say them. */
const asData = <T>(f: () => T): T => {
  try {
    return f();
  } catch (e) {
    if (e instanceof PageError)
      throw new DataError(e.code === "not-found" ? "not-found" : "bad-body");
    throw e;
  }
};

/** The mother a row is moved under: one of the same kind (a collection under a collection, a page under a page). */
function motherOf(store: UserStore, kind: "collection" | "page", v: unknown): string | null {
  if (v === null || v === "") return null;
  if (typeof v !== "string") throw new DataError("bad-body");
  const at = targetOf(store, v);
  if (at.kind !== kind) throw new DataError("bad-body");
  return at.id;
}

/**
 * A change to a row, done to what it is: its name (renamed), its mother (moved, with its branch), its level (the
 * protection's own rule: a private collection is lowered only from its page, «locked» here) or whether its notes show
 * in the sidebar. Anything else in a row is computed and says «read-only».
 */
export function updateMyData(store: UserStore, row: string, values: unknown, device?: string) {
  if (!values || typeof values !== "object" || Array.isArray(values))
    throw new DataError("bad-body");
  const target = targetOf(store, row);
  if (target.kind === "boni") throw new DataError("read-only");
  const changes = Object.entries(values as Record<string, unknown>);
  if (changes.some(([f]) => !(D.editable as readonly string[]).includes(f)))
    throw new DataError("read-only");
  for (const [f, v] of changes) {
    if (f === D.title) {
      if (typeof v !== "string" || !v.trim()) throw new DataError("bad-body");
      if (target.kind === "collection") renameCollection(store, target.id, { name: v }, device);
      else asData(() => updatePage(store, target.id, { title: v }, device));
    } else if (f === D.mother) {
      const parent = motherOf(store, target.kind, v);
      if (target.kind === "collection") moveCollection(store, target.id, { parent }, device);
      else asData(() => updatePage(store, target.id, { parent }, device));
    } else if (target.kind !== "collection") {
      // A page has no level and no notes of its own.
      throw new DataError("read-only");
    } else if (f === D.level) {
      const level = AI_LEVELS.find((l) => dataLevel(l) === v);
      if (!level) throw new DataError("bad-body");
      const r = setProtection(store, target.id, { level }, device ?? "?");
      if ("error" in r) throw new DataError(r.error);
    } else if (f === D.bar) {
      if (typeof v !== "boolean") throw new DataError("bad-body");
      setNotesInTree(store, target.id, v);
    }
  }
}

/** A row deleted: an empty collection out of the tree, a page to the trash; Boni's are not deleted. */
export function deleteMyData(store: UserStore, row: string, device?: string): void {
  const target = targetOf(store, row);
  if (target.kind === "boni") throw new DataError("read-only");
  if (target.kind === "collection") deleteCollection(store, target.id, device);
  else asData(() => removePage(store, target.id, device));
}

/** The Undo of deleting a row: the collection or the page back where it was. */
export function restoreMyData(store: UserStore, row: string, device?: string): void {
  const id = dataRowTarget(row);
  if (!id) throw new DataError("not-found");
  const def = store.schema().types[id];
  if (def) restoreCollection(store, id, device);
  else asData(() => restorePage(store, id, device));
}

/**
 * «Nuevo»: a collection (a page when its «Tipo» says so), with the name given or «Nueva colección», «Nueva colección
 * 2»…; inside the mother given, at the level given. What a filtered view adds besides (computed fields) is left out.
 * The new row's id.
 */
export function createMyData(store: UserStore, values: unknown, device?: string): string {
  const v = (values && typeof values === "object" ? values : {}) as Record<string, unknown>;
  const raw = v[D.title];
  const name = typeof raw === "string" ? raw.trim() : "";
  if (v[D.kind] === D.page) {
    const parent = motherOf(store, "page", v[D.mother] ?? null);
    const p = asData(() =>
      createPage(store, { title: name, ...(parent ? { parent } : {}) }, device),
    );
    return D.row + p.id;
  }
  if (v[D.kind] !== undefined && v[D.kind] !== D.collection) throw new DataError("read-only");
  const parent = motherOf(store, "collection", v[D.mother] ?? null);
  const taken = new Set(userTypes(store).map((t) => t.name.toLowerCase()));
  let fresh = name || NEW_NAME;
  for (let n = 2; !name && taken.has(fresh.toLowerCase()); n++) fresh = `${NEW_NAME} ${n}`;
  const { id } = createCollection(store, { name: fresh, ...(parent ? { parent } : {}) }, device);
  const rest: Record<string, unknown> = {};
  if (v[D.level] !== undefined) rest[D.level] = v[D.level];
  if (v[D.bar] !== undefined) rest[D.bar] = v[D.bar];
  if (Object.keys(rest).length) updateMyData(store, D.row + id, rest, device);
  return D.row + id;
}
