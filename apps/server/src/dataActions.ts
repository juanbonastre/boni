import {
  codeLabel,
  deepLabel,
  FIELD_KINDS,
  fieldByName,
  fieldName,
  leaf,
  neutralize,
  plain,
  type ReadStore,
  ToolError,
  type ToolRegistry,
  typeByKey,
  typeName,
  type Val,
} from "@boni/agent";
import {
  type FieldId,
  type FieldType,
  join,
  type Label,
  ROLES,
  type Role,
  type TypeDef,
} from "@boni/entities";
import { type OpMeta, StoreError, type UserStore } from "@boni/store";
import { BY_ROLES, byRoles } from "./calendarStore.ts";
import {
  changeColumn,
  DataError,
  type DataWho,
  deleteCollection,
  moveCollection,
  moveRow,
  ROW_UI,
  removeColumn,
  renameCollection,
  rowUiOf,
  setNotesInTree,
  setRowUi,
  TREE_UI,
} from "./data.ts";
import { viewOf } from "./pageActions.ts";
import { rolesToSet } from "./roles.ts";

/**
 * The actions of the area «Datos» that the core's tools did not have (docs/sistema.md §4.1, F10): renaming, moving
 * and deleting a collection, changing or taking out one of its fields, moving a record to another collection. The
 * planner, a flow and an assistant run the same code as the app's routes (data.ts), as the run's writer, so Undo of
 * the run takes it back. A model names collections and fields as it sees them (their keys): a collection closed to
 * the models is not found. Deleting is Juan's card (P5); lowering a collection's level for the models is only his,
 * in its page (A-04), and is no action.
 */

/** What the server gives a data action for its run (`ToolDef.service` "data"): the store, and the run's meta. */
export interface DataService {
  store: UserStore;
  meta: OpMeta;
}
const serviceOf = (s: unknown): DataService => {
  if (!s || typeof s !== "object" || !("store" in s)) throw new ToolError("not-available");
  return s as DataService;
};
const code = codeLabel("data");
const low = (l: Label) => l.integrity === "model" || l.integrity === "external";
const text = (v: Val | undefined): string => {
  const x = v ? plain(v) : null;
  if (typeof x !== "string" || !x.trim()) throw new ToolError("bad-argument");
  // A name a model or someone outside wrote is painted as text, never as markup.
  return low(deepLabel(v as Val)) ? neutralize(x.trim()) : x.trim();
};
const who = (s: DataService, args: readonly (Val | undefined)[], extra: Label): DataWho => ({
  meta: s.meta,
  label: join(extra, ...args.filter((a): a is Val => !!a).map(deepLabel)),
});
const wrap = <T>(f: () => T): T => {
  try {
    return f();
  } catch (e) {
    if (e instanceof DataError) throw new ToolError(e.code);
    throw e;
  }
};
const typeOf = (ro: ReadStore, v: Val | undefined): TypeDef => {
  const key = v ? plain(v) : null;
  if (typeof key !== "string") throw new ToolError("bad-argument");
  return typeByKey(ro, key);
};
const fieldOf = (def: TypeDef, v: Val | undefined) => {
  const name = v ? plain(v) : null;
  if (typeof name !== "string") throw new ToolError("bad-argument");
  const f = fieldByName(def, name);
  if (!f) throw new ToolError("unknown-field");
  return f;
};
/** A list's options as a model writes them («Por leer, Leído»): one it had keeps its id (and its records). */
const optionsOf = (def: TypeDef, field: string, v: Val): { id?: string; name: string }[] => {
  const was = def.fields.find((f) => f.id === field)?.options ?? [];
  const raw = plain(v);
  const names = (
    Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,;\n]/) : []
  ).filter((x): x is string => typeof x === "string" && !!x.trim());
  if (!names.length || names.length > 50) throw new ToolError("select-needs-options");
  return names.map((n) => {
    const name = low(deepLabel(v)) ? neutralize(n.trim()) : n.trim();
    const old = was.find((o) => o.name.toLowerCase() === name.toLowerCase());
    return old ? { id: old.id, name: old.name } : { name };
  });
};

const type = { role: "type" as const, required: true, describe: "the collection's key" };

/** The data actions, added to a registry (the server's, and the MCP's that describes what a flow may be made of). */
export function withDataActions(r: ToolRegistry): ToolRegistry {
  r.register({
    name: "schema.rename_type",
    icon: "Type",
    undo: ["run"],
    effect: "schema",
    area: "data",
    service: "data",
    title: "Renombrar colección",
    describe: "Rename one of Juan's collections (its key stays); the name is used once",
    args: { type, name: { role: "content", required: true, describe: "its new name" } },
    run(c, a, extra) {
      const s = serviceOf(c.service);
      const def = typeOf(c.store, a.type);
      wrap(() =>
        renameCollection(s.store, def.id, { name: text(a.name) }, who(s, [a.name], extra)),
      );
      return leaf(typeName(def), code);
    },
  });
  r.register({
    name: "schema.move_type",
    icon: "FolderInput",
    undo: ["run"],
    effect: "schema",
    area: "data",
    service: "data",
    title: "Mover colección",
    describe:
      "Move one of Juan's collections inside another (parent: its key), with what is inside it; parent null: to the top",
    args: {
      type,
      parent: { role: "type", describe: "the collection it goes inside; null: to the top" },
    },
    run(c, a, extra) {
      const s = serviceOf(c.service);
      const def = typeOf(c.store, a.type);
      const to = a.parent ? plain(a.parent) : null;
      const parent = to === null ? null : typeOf(c.store, a.parent).id;
      wrap(() => moveCollection(s.store, def.id, { parent }, who(s, [a.parent], extra)));
      return leaf(typeName(def), code);
    },
  });
  r.register({
    name: "schema.delete_type",
    icon: "FolderX",
    undo: ["trash", "run"],
    effect: "write",
    area: "data",
    service: "data",
    // Deleting is Juan's card (docs/sistema.md §4.1, P5); only an empty collection goes, and Undo brings it back.
    alwaysConfirm: true,
    title: "Borrar colección",
    describe:
      "Delete one of Juan's collections, only when nothing is left in it (no records, no collection inside); he confirms it",
    args: { type },
    run(c, a, extra) {
      const s = serviceOf(c.service);
      const def = typeOf(c.store, a.type);
      wrap(() => deleteCollection(s.store, def.id, who(s, [], extra)));
      return leaf({ deleted: typeName(def) }, code);
    },
  });
  r.register({
    name: "schema.update_field",
    icon: "Settings2",
    undo: ["run"],
    effect: "schema",
    area: "data",
    service: "data",
    title: "Cambiar campo",
    describe: `Rename a field of a collection, change its kind (${FIELD_KINDS.join(", ")}; with values, only among kinds of text) or a list's options (comma-separated; one still in use stays)`,
    args: {
      type,
      field: { role: "field", required: true, describe: "the field's key" },
      name: { role: "content", describe: "its new name" },
      kind: { role: "option", describe: "its new kind" },
      options: {
        role: "content",
        describe: 'select and multiselect: all its options, comma-separated ("Por leer, Leído")',
      },
    },
    run(c, a, extra) {
      const s = serviceOf(c.service);
      const def = typeOf(c.store, a.type);
      const f = fieldOf(def, a.field);
      const body: Record<string, unknown> = {};
      if (a.name) body.name = text(a.name);
      if (a.kind) {
        const kind = plain(a.kind) as FieldType;
        if (!FIELD_KINDS.includes(kind)) throw new ToolError("bad-option");
        body.type = kind;
      }
      if (a.options) body.options = optionsOf(def, f.id, a.options);
      if (!Object.keys(body).length) throw new ToolError("bad-argument");
      wrap(() =>
        changeColumn(s.store, def.id, f.id, body, who(s, [a.name, a.kind, a.options], extra)),
      );
      return leaf(
        fieldName(c.store.schema().types[def.id]?.fields.find((x) => x.id === f.id) ?? f),
        code,
      );
    },
  });
  r.register({
    name: "schema.remove_field",
    icon: "Eraser",
    undo: ["trash", "run"],
    effect: "write",
    area: "data",
    service: "data",
    // Taking a field out keeps its values (archived); still Juan's card, as deleting (P5).
    alwaysConfirm: true,
    title: "Quitar campo",
    describe:
      "Take a field out of a collection (its values are kept, and Undo brings it back); he confirms it",
    args: { type, field: { role: "field", required: true, describe: "the field's key" } },
    run(c, a, extra) {
      const s = serviceOf(c.service);
      const def = typeOf(c.store, a.type);
      const f = fieldOf(def, a.field);
      wrap(() => removeColumn(s.store, def.id, f.id, who(s, [], extra)));
      return leaf({ removed: fieldName(f) }, code);
    },
  });
  r.register({
    name: "entities.move",
    icon: "ArrowRightLeft",
    undo: ["run"],
    effect: "write",
    area: "data",
    service: "data",
    title: "Mover a",
    describe:
      "Move a record to another of Juan's collections (type: its key), keeping its id and its history",
    args: {
      id: { role: "entity", required: true, describe: "the record's id" },
      type: { role: "type", required: true, describe: "the collection it goes to" },
    },
    run(c, a, extra) {
      const s = serviceOf(c.service);
      const id = a.id ? plain(a.id) : null;
      // A record the models may not see is not there for them; one they see only as a handle (opaque) stays where
      // Juan keeps it: moved to a collection open to them it would be read (A-04, his alone).
      const seen = typeof id === "string" ? c.store.get(id) : null;
      if (typeof id !== "string" || !seen) throw new ToolError("not-found");
      if (Object.values(seen.labels).some((l) => l.noModel)) throw new ToolError("not-writable");
      const to = typeOf(c.store, a.type);
      wrap(() => moveRow(s.store, id, { type: to.id }, who(s, [a.type], extra)));
      return leaf({ id, type: typeName(to) }, code);
    },
  });
  r.register({
    name: "schema.set_view",
    keeps: (c, a) => [`${ROW_UI}${typeOf(c.store, a.type).id}`],
    icon: "Eye",
    undo: ["run"],
    effect: "write",
    area: "data",
    service: "data",
    title: "Guardar vista",
    describe:
      'Save a view of one of Juan\'s collections as one of its tabs, by its name (the same name: that tab changed): view {"lit": {"layout": "table" | "board" | "list" | "gallery" | "calendar", "sort": {"field", "desc"}, "group", "hide": [...], "filter": [...], "calc": {field: "count" | "sum" | "average" | ...}, "pin": field, "wrap": [...]}} by its fields\' keys; remove true (and no view): that tab taken out',
    args: {
      type,
      name: { role: "content", required: true, describe: "the tab's name" },
      view: { role: "definition", describe: "the view" },
      remove: { role: "option", describe: "true: take the tab out" },
    },
    run(c, a) {
      const s = serviceOf(c.service);
      const def = typeOf(c.store, a.type);
      const name = text(a.name).slice(0, 60);
      const raw = a.view ? plain(a.view) : null;
      // A plan says it with `remove`; the MCP also with view null.
      if (raw === null && !a.view && !(a.remove && plain(a.remove) === true))
        throw new ToolError("bad-argument");
      const views = rowUiOf(s.store, def.id).views;
      const at = views.findIndex((v) => v.name.toLowerCase() === name.toLowerCase());
      let next = views;
      if (raw === null) {
        if (at < 0) throw new ToolError("no-such-view");
        next = views.filter((_, i) => i !== at);
      } else {
        const view = viewOf(def, raw);
        const id = views[at]?.id ?? `v_${Date.now().toString(36)}${views.length}`;
        const saved = { ...view, id, name };
        next = at < 0 ? [...views, saved] : views.map((v, i) => (i === at ? saved : v));
      }
      const out = setRowUi(s.store, def.id, { views: next });
      if ("error" in out) throw new ToolError(out.error);
      return leaf({ collection: typeName(def), views: out.views.map((v) => v.name) }, code);
    },
  });
  r.register({
    name: "schema.set_roles",
    // The account goes by roles from now on (D-64), kept with the run: its Undo leaves it as it was.
    keeps: () => [BY_ROLES],
    icon: "Tags",
    undo: ["run"],
    effect: "schema",
    area: "data",
    service: "data",
    title: "Papeles",
    describe: `Give a collection's fields the roles the apps use it by (docs/clases.md §6: Calendario, Tareas, Dinero), or take them away: roles {role: the field's key, or null to take it away}; roles: ${ROLES.join(", ")}. A day ("date") or an instant ("start"), not both; "time", "endTime" and "endDate" go with "date", "end" with "start"; "done" is a checkbox; "amount" a number and, with a day, makes it money. A role its mother gives stays hers`,
    args: {
      type,
      roles: { role: "definition", required: true, describe: "{role: field key or null}" },
    },
    run(c, a) {
      const s = serviceOf(c.service);
      const def = typeOf(c.store, a.type);
      const raw = a.roles ? plain(a.roles) : null;
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new ToolError("bad-argument");
      const roles: Partial<Record<Role, FieldId | null>> = {};
      for (const [r, v] of Object.entries(raw as Record<string, unknown>)) {
        if (!(ROLES as string[]).includes(r)) throw new ToolError("bad-role");
        roles[r as Role] = v === null ? null : fieldOf(def, leaf(v as never, code)).id;
      }
      if (!Object.keys(roles).length) throw new ToolError("bad-argument");
      try {
        s.store.batch(() => {
          // The account's first role (D-64): until now its calendars went by their definitions, so what those say
          // becomes their roles first (as `cli.ts roles --apply`), and going by roles hides none of them.
          if (!byRoles(s.store))
            for (const f of rolesToSet(s.store).found)
              s.store.applySchema({ op: "set_roles", type: f.type, roles: f.roles }, s.meta);
          s.store.applySchema({ op: "set_roles", type: def.id, roles }, s.meta);
          if (s.store.setting(BY_ROLES) !== "1") s.store.setSetting(BY_ROLES, "1");
        });
      } catch (e) {
        // What does not fit the branch (a day and an instant, a field in two roles…): the core's reason, as a code.
        if (e instanceof StoreError && e.code === "invalid") throw new ToolError("bad-roles");
        throw e;
      }
      return leaf({ collection: typeName(def), roles: Object.keys(roles) }, code);
    },
  });
  r.register({
    name: "schema.set_tree",
    keeps: (c, a) => [`${TREE_UI}${typeOf(c.store, a.type).id}`],
    icon: "ListTree",
    undo: ["run"],
    effect: "write",
    area: "data",
    service: "data",
    title: "Notas en el árbol",
    describe:
      "Show a collection's notes under it in Boni's sidebar tree (on true), or only the collection (false)",
    args: { type, on: { role: "option", required: true, describe: "true or false" } },
    run(c, a) {
      const s = serviceOf(c.service);
      const def = typeOf(c.store, a.type);
      const v = a.on ? plain(a.on) : null;
      const on = v === true || v === "true" ? true : v === false || v === "false" ? false : null;
      if (on === null) throw new ToolError("bad-argument");
      wrap(() => setNotesInTree(s.store, def.id, on));
      return leaf({ collection: typeName(def), notes: on }, code);
    },
  });
  return r;
}
