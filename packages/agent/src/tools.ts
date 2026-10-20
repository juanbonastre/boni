import {
  type FieldDef,
  type FieldType,
  join,
  type Label,
  label,
  newId,
  plannerMaySee,
  type TypeDef,
} from "@boni/entities";
import { BODY, type StoredEntity, StoreError, type UserStore } from "@boni/store";
import {
  codeLabel,
  deepLabel,
  type Json,
  leaf,
  leafFrom,
  list,
  plain,
  rec,
  type Val,
} from "./values.ts";

/**
 * The tool registry (docs/nucleo.md, 7.5 and 7.9). A whitelist that fails closed: a tool, an effect or
 * an argument without a classification does not register, and the server does not start. The effect
 * class is enforced with capabilities, not only declared: a tool receives only the objects its class
 * allows (a `read` gets a read-only view of the store and no network), so a misclassified tool fails
 * when it runs instead of doing what it did not declare (A10).
 */
export const EFFECTS = [
  "read",
  "write",
  "write_irreversible",
  "egress",
  "send",
  "schedule",
  "schema",
  "memory",
  "notify",
] as const;
export type Effect = (typeof EFFECTS)[number];
export const ARG_ROLES = [
  "destination",
  "url",
  "path",
  "recipient",
  "query",
  "content",
  "entity",
  "type",
  "field",
  "value",
  "option",
  "limit",
] as const;
export type ArgRole = (typeof ARG_ROLES)[number];
/** Roles whose value says where something goes: only a value taken as it is from Juan or his data (P2, P14). */
export const DESTINATION_ROLES: readonly ArgRole[] = ["destination", "url", "path", "recipient"];

export interface ArgSpec {
  role: ArgRole;
  required?: boolean;
  describe: string;
}

/** The read-only view of the store every tool gets. */
export interface ReadStore {
  schema(): ReturnType<UserStore["schema"]>;
  get(id: string): StoredEntity | null;
  list(type: string): StoredEntity[];
  search(text: string, opts?: { type?: string; limit?: number }): string[];
}
/** Writes made by a tool: each value with its own label, the run's meta, P17 applied. */
export interface Writer {
  create(type: string, values: Val, extra: Label): Val;
  update(id: string, values: Val, extra: Label): Val;
  remove(id: string): void;
}
export interface SchemaWriter {
  createType(key: string, name: string, l: Label): Val;
  addField(type: string, key: string, name: string, kind: FieldType, l: Label): Val;
}
export interface MemoryWriter {
  save(text: Val, extra: Label): Val;
}
export interface JobWriter {
  create(name: Val, schedule: Val, prompt: Val, extra: Label): Val;
}
export interface Notifier {
  /** To the devices of this account only: the recipient is the code's, never an argument. */
  notify(text: Val): void;
}
/** Network access: only `egress` and `send` tools get one (none is registered in production yet). */
export interface Net {
  fetchText(url: string): Promise<string>;
  send(message: { to: string; subject: string; body: string }): Promise<void>;
}

export interface Caps {
  read: { store: ReadStore };
  write: { store: ReadStore; writer: Writer };
  write_irreversible: { store: ReadStore; writer: Writer };
  egress: { store: ReadStore; net: Pick<Net, "fetchText"> };
  send: { store: ReadStore; net: Pick<Net, "send"> };
  schedule: { store: ReadStore; jobs: JobWriter };
  schema: { store: ReadStore; schema: SchemaWriter };
  memory: { store: ReadStore; memory: MemoryWriter };
  notify: { store: ReadStore; notifier: Notifier };
}

export interface ToolDef<E extends Effect = Effect> {
  name: string;
  effect: E;
  /** One line, for the planner's index. */
  describe: string;
  args: Readonly<Record<string, ArgSpec>>;
  /** P5: Juan confirms every call (deleting at the agent's request). */
  alwaysConfirm?: boolean;
  /** How the confirmation names the action ("Borrar", "Enviar correo"). */
  title: string;
  run(caps: Caps[E], args: Readonly<Record<string, Val>>, extra: Label): Val | Promise<Val>;
}

export class ToolError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export class ToolRegistry {
  private tools = new Map<string, ToolDef>();
  private frozen = false;

  /** Refuses (throws) anything not fully classified: the server must not start with it. */
  register<E extends Effect>(def: ToolDef<E>): this {
    if (this.frozen) throw new Error("the registry is frozen");
    if (!/^[a-z]+(\.[a-z_]+)+$|^[a-z]+$/.test(def.name)) throw new Error(`tool name ${def.name}`);
    if (this.tools.has(def.name)) throw new Error(`tool ${def.name} twice`);
    if (!(EFFECTS as readonly string[]).includes(def.effect))
      throw new Error(`tool ${def.name}: unclassified effect`);
    if (!def.describe || !def.title) throw new Error(`tool ${def.name}: no description`);
    for (const [name, a] of Object.entries(def.args)) {
      if (!/^[a-z][a-z_]{0,30}$/.test(name))
        throw new Error(`tool ${def.name}: argument name ${name}`);
      if (!(ARG_ROLES as readonly string[]).includes(a?.role))
        throw new Error(`tool ${def.name}: argument ${name} has no role`);
      if (!a.describe) throw new Error(`tool ${def.name}: argument ${name} has no description`);
      // Somewhere to send things is only for tools that send things.
      if (DESTINATION_ROLES.includes(a.role) && def.effect !== "egress" && def.effect !== "send")
        throw new Error(`tool ${def.name}: a destination in a ${def.effect} tool`);
    }
    if (
      (def.effect === "egress" || def.effect === "send") &&
      !Object.values(def.args).some((a) => DESTINATION_ROLES.includes(a.role))
    )
      throw new Error(`tool ${def.name}: ${def.effect} without a destination argument`);
    this.tools.set(def.name, def as unknown as ToolDef);
    return this;
  }
  freeze(): this {
    this.frozen = true;
    return this;
  }
  get(name: string): ToolDef | null {
    return Object.hasOwn(Object.fromEntries(this.tools), name)
      ? (this.tools.get(name) ?? null)
      : null;
  }
  all(): ToolDef[] {
    return [...this.tools.values()];
  }
  args(name: string) {
    const t = this.get(name);
    if (!t) return null;
    return {
      names: Object.keys(t.args),
      required: Object.entries(t.args)
        .filter(([, a]) => a.required)
        .map(([n]) => n),
    };
  }
}

// ---------------------------------------------------------------- entities as values

/** An entity as a record: one value per field (by key) with that field's label, read at this version. */
export function entityVal(s: StoredEntity, def: TypeDef | undefined): Val {
  const code = codeLabel("store");
  const from = { e: s.entity.id, v: s.entity.version };
  const fields: Record<string, Val> = {
    id: leafFrom(s.entity.id, code, from),
    type: leaf(def ? typeName(def) : s.entity.type, code),
  };
  for (const f of def?.fields ?? []) {
    if (f.hidden || f.archived) continue;
    const v = s.entity.values[f.id];
    if (v === undefined) continue;
    fields[fieldName(f)] = leafFrom(v as Json, s.labels[f.id] ?? code, from);
  }
  if (s.entity.body !== undefined)
    fields.body = leafFrom(s.entity.body, s.labels[BODY] ?? code, from);
  return rec(fields, code);
}

/** A name the planner may not see (it came from outside) is known to it by its id only (view.ts). */
export const fieldName = (f: FieldDef) => (plannerMaySee(f.label) ? f.key : `field_${f.id}`);
export const typeName = (t: TypeDef) => (plannerMaySee(t.label) ? t.key : `type_${t.id}`);
const fieldByName = (def: TypeDef, name: string) =>
  def.fields.find((f) => fieldName(f) === name && !f.archived && !f.hidden);

const typeByKey = (store: ReadStore, key: string): TypeDef => {
  const def = Object.values(store.schema().types).find(
    (t) => typeName(t) === key && !t.system && !t.archived,
  );
  if (!def) throw new ToolError("unknown-type");
  return def;
};
const str = (v: Val | undefined, code = "bad-argument"): string => {
  const x = v ? plain(v) : null;
  if (typeof x !== "string" || !x) throw new ToolError(code);
  return x;
};
const optNum = (v: Val | undefined, def: number, max: number): number => {
  if (!v) return def;
  const x = plain(v);
  if (typeof x !== "number" || !Number.isInteger(x) || x < 1) throw new ToolError("bad-limit");
  return Math.min(x, max);
};

/** What a `where` (field key = value) keeps, and the labels the decision read. */
/** Text compared without case or accents ("Ána" contains "ana"). */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase();

function matching(
  store: ReadStore,
  def: TypeDef,
  field?: Val,
  equals?: Val,
  contains?: Val,
): { kept: StoredEntity[]; read: Label[] } {
  const all = store.list(def.id);
  if (!field) return { kept: all, read: [] };
  const key = str(field);
  const f = fieldByName(def, key);
  if (!f) throw new ToolError("unknown-field");
  const want = JSON.stringify(equals ? plain(equals) : null);
  const read: Label[] = [];
  const kept = all.filter((s) => {
    const l = s.labels[f.id];
    if (l) read.push(l);
    const v = s.entity.values[f.id] ?? null;
    if (contains) {
      const part = plain(contains);
      if (typeof part !== "string" || !part) throw new ToolError("bad-argument");
      return typeof v === "string" && fold(v).includes(fold(part));
    }
    return JSON.stringify(v) === want;
  });
  return { kept, read };
}

// ---------------------------------------------------------------- the first tools

const FIELD_KINDS: readonly FieldType[] = [
  "text",
  "longtext",
  "number",
  "money",
  "checkbox",
  "date",
  "time",
  "datetime",
  "url",
  "email",
  "phone",
];

export function coreTools(): ToolRegistry {
  const r = new ToolRegistry();
  r.register({
    name: "entities.query",
    effect: "read",
    title: "Consultar",
    describe:
      "Entities of a type, optionally where a field equals a value or a text field contains a text",
    args: {
      type: { role: "type", required: true, describe: "type key" },
      field: { role: "field", describe: "field key to compare" },
      equals: { role: "value", describe: "the value it must have" },
      contains: { role: "value", describe: "or: text the field contains (any case, any accents)" },
      limit: { role: "limit", describe: "at most this many (default 50, max 200)" },
    },
    run({ store }, a) {
      const def = typeByKey(store, str(a.type));
      const { kept, read } = matching(store, def, a.field, a.equals, a.contains);
      const limit = optNum(a.limit, 50, 200);
      const l = read.length ? join(codeLabel("query"), ...read) : codeLabel("query");
      return list(
        kept.slice(0, limit).map((s) => entityVal(s, def)),
        l,
      );
    },
  });
  r.register({
    name: "entities.get",
    effect: "read",
    title: "Leer",
    describe: "One entity by id",
    args: { id: { role: "entity", required: true, describe: "entity id" } },
    run({ store }, a) {
      const s = store.get(str(a.id));
      if (!s || s.entity.deleted !== undefined) throw new ToolError("not-found");
      return entityVal(s, store.schema().types[s.entity.type]);
    },
  });
  r.register({
    name: "entities.aggregate",
    effect: "read",
    title: "Calcular",
    describe:
      "Count of entities of a type, or the sum of a number or money field, optionally where a field equals a value",
    args: {
      type: { role: "type", required: true, describe: "type key" },
      op: { role: "option", required: true, describe: '"count" or "sum"' },
      of: { role: "field", describe: "field key to sum" },
      field: { role: "field", describe: "field key to compare" },
      equals: { role: "value", describe: "the value it must have" },
    },
    run({ store }, a) {
      const def = typeByKey(store, str(a.type));
      const { kept, read } = matching(store, def, a.field, a.equals);
      const op = str(a.op);
      if (op === "count")
        return leaf(
          kept.length,
          read.length ? join(codeLabel("count"), ...read) : codeLabel("count"),
        );
      if (op !== "sum") throw new ToolError("bad-option");
      const f = fieldByName(def, str(a.of));
      if (!f || (f.type !== "number" && f.type !== "money")) throw new ToolError("unknown-field");
      let total = 0;
      for (const s of kept) {
        const v = s.entity.values[f.id];
        const n =
          typeof v === "number"
            ? v
            : v && typeof v === "object" && !Array.isArray(v)
              ? v.amount
              : 0;
        total += n;
        const l = s.labels[f.id];
        if (l) read.push(l);
      }
      return leaf(
        Math.round(total * 100) / 100,
        read.length ? join(codeLabel("sum"), ...read) : codeLabel("sum"),
      );
    },
  });
  r.register({
    name: "entities.search",
    effect: "read",
    title: "Buscar",
    describe: "Entities whose text has these words",
    args: {
      text: { role: "query", required: true, describe: "words to look for" },
      type: { role: "type", describe: "only this type" },
      limit: { role: "limit", describe: "at most this many (default 20, max 100)" },
    },
    run({ store }, a) {
      const def = a.type ? typeByKey(store, str(a.type)) : undefined;
      const ids = store.search(str(a.text), {
        ...(def ? { type: def.id } : {}),
        limit: optNum(a.limit, 20, 100),
      });
      const types = store.schema().types;
      const items = ids.map((id) => store.get(id)).filter((s): s is StoredEntity => s !== null);
      // Which entities matched says something about their text: the list carries their labels.
      const l = items.length
        ? join(
            codeLabel("search"),
            ...items.map((s) => deepLabel(entityVal(s, types[s.entity.type]))),
          )
        : codeLabel("search");
      return list(
        items.map((s) => entityVal(s, types[s.entity.type])),
        l,
      );
    },
  });
  r.register({
    name: "schema.describe",
    effect: "read",
    title: "Ver tipos",
    describe: "The types and their fields",
    args: {},
    run({ store }) {
      const out = Object.values(store.schema().types)
        .filter((t) => !t.system && !t.archived)
        .map((t) =>
          rec(
            {
              key: leaf(t.key, t.label),
              name: leaf(t.name, t.label),
              fields: list(
                t.fields
                  .filter((f) => !f.hidden && !f.archived)
                  .map((f) =>
                    rec(
                      {
                        key: leaf(f.key, f.label),
                        name: leaf(f.name, f.label),
                        type: leaf(f.type, codeLabel("schema")),
                        ...(f.options
                          ? {
                              options: list(
                                f.options.map((o) => leaf(o.name, o.label)),
                                codeLabel("schema"),
                              ),
                            }
                          : {}),
                      },
                      codeLabel("schema"),
                    ),
                  ),
                codeLabel("schema"),
              ),
            },
            codeLabel("schema"),
          ),
        );
      return list(out, codeLabel("schema"));
    },
  });
  r.register({
    name: "entities.create",
    effect: "write",
    title: "Crear",
    describe: "A new entity of a type; values is obj(field key, value, ...)",
    args: {
      type: { role: "type", required: true, describe: "type key" },
      values: { role: "content", required: true, describe: "obj(key, value, ...)" },
    },
    run({ writer }, a, extra) {
      return writer.create(str(a.type), a.values as Val, extra);
    },
  });
  r.register({
    name: "entities.update",
    effect: "write",
    title: "Cambiar",
    describe: "Change some fields of an entity; values is obj(field key, value, ...)",
    args: {
      id: { role: "entity", required: true, describe: "entity id" },
      values: { role: "content", required: true, describe: "obj(key, value, ...)" },
    },
    run({ writer }, a, extra) {
      return writer.update(str(a.id), a.values as Val, extra);
    },
  });
  r.register({
    name: "entities.delete",
    effect: "write",
    alwaysConfirm: true,
    title: "Borrar",
    describe: "Move an entity to the trash (Juan confirms)",
    args: { id: { role: "entity", required: true, describe: "entity id" } },
    run({ writer }, a) {
      writer.remove(str(a.id));
      return leaf(true, codeLabel("delete"));
    },
  });
  r.register({
    name: "schema.create_type",
    effect: "schema",
    title: "Crear tipo",
    describe: "A new type with a title field (add more fields with schema.add_field)",
    args: {
      key: { role: "value", required: true, describe: "ASCII key, e.g. libro" },
      name: { role: "content", required: true, describe: "name Juan reads, e.g. Libros" },
    },
    run({ schema }, a, extra) {
      return schema.createType(
        str(a.key),
        str(a.name),
        join(deepLabel(a.key as Val), deepLabel(a.name as Val), extra),
      );
    },
  });
  r.register({
    name: "schema.add_field",
    effect: "schema",
    title: "Añadir campo",
    describe: `A new field of a type; kind is one of ${FIELD_KINDS.join(", ")}`,
    args: {
      type: { role: "type", required: true, describe: "type key" },
      key: { role: "value", required: true, describe: "ASCII key" },
      name: { role: "content", required: true, describe: "name Juan reads" },
      kind: { role: "option", required: true, describe: "field kind" },
    },
    run({ schema }, a, extra) {
      const kind = str(a.kind) as FieldType;
      if (!FIELD_KINDS.includes(kind)) throw new ToolError("bad-option");
      return schema.addField(
        str(a.type),
        str(a.key),
        str(a.name),
        kind,
        join(deepLabel(a.key as Val), deepLabel(a.name as Val), extra),
      );
    },
  });
  r.register({
    name: "memory.save",
    effect: "memory",
    title: "Recordar",
    describe: "Remember something for later turns",
    args: { text: { role: "content", required: true, describe: "what to remember" } },
    run({ memory }, a, extra) {
      return memory.save(a.text as Val, extra);
    },
  });
  r.register({
    name: "jobs.create",
    effect: "schedule",
    title: "Programar",
    describe: 'A recurring job: schedule "daily" or "weekly", prompt is what Boni does then',
    args: {
      name: { role: "content", required: true, describe: "name of the job" },
      schedule: { role: "option", required: true, describe: '"daily" or "weekly"' },
      prompt: { role: "content", required: true, describe: "the request to run" },
    },
    run({ jobs }, a, extra) {
      return jobs.create(a.name as Val, a.schedule as Val, a.prompt as Val, extra);
    },
  });
  r.register({
    name: "notify",
    effect: "notify",
    title: "Avisar",
    describe: "A notification on Juan's own devices",
    args: { text: { role: "content", required: true, describe: "the text" } },
    run({ notifier }, a) {
      notifier.notify(a.text as Val);
      return leaf(true, codeLabel("notify"));
    },
  });
  return r;
}

// ---------------------------------------------------------------- capabilities

/**
 * Remote resources in text that a model or the outside wrote become plain text before it is stored
 * where another program paints it (P17: Obsidian loads `![](https://…)` by itself).
 */
export function neutralize(text: string): string {
  return text
    .replace(
      /!\[([^\]]*)\]\(([^)]*)\)/g,
      (_m, alt: string, url: string) => `${alt} (${url.replace(/:\/\//g, ":⁄⁄")})`,
    )
    .replace(
      /<(\/?)(img|iframe|video|audio|embed|object|link|script|source|style|svg|meta|base|form)\b/gi,
      "&lt;$1$2",
    );
}

export interface CapsContext {
  store: UserStore;
  run: string;
  device?: string;
  now: () => number;
  notify?: (text: string, l: Label) => void;
  net?: Net;
}

const lowIntegrity = (l: Label) => l.integrity === "model" || l.integrity === "external";

/** The read-only view: nothing that writes, nothing of the journal. */
/**
 * The read-only view, as the models may see it (Juan's choice per type, `store.aiAccess()`, read on every
 * call so a change applies at once): a `hidden` type does not exist here (not in the schema, its entities
 * not found, not in a search); an `opaque` type is there, but every value of its entities carries
 * `noModel`, so the planner gets handles, no reader gets them, and only code computes with them.
 */
export function readStore(store: UserStore): ReadStore {
  const levels = () => store.aiAccess();
  const kept = (l: Label | undefined): Label => ({ ...(l ?? codeLabel("store")), noModel: true });
  const asSeen = (s: StoredEntity | null, lv = levels()): StoredEntity | null => {
    if (!s) return null;
    const level = lv[s.entity.type] ?? "visible";
    if (level === "hidden") return null;
    if (level === "visible") return s;
    const labels: Record<string, Label> = {};
    for (const k of [...Object.keys(s.entity.values), ...Object.keys(s.labels), BODY])
      labels[k] = kept(s.labels[k]);
    return { ...s, labels };
  };
  return {
    schema: () => {
      const lv = levels();
      const all = store.schema();
      return {
        types: Object.fromEntries(Object.entries(all.types).filter(([id]) => lv[id] !== "hidden")),
      };
    },
    get: (id) => asSeen(store.get(id)),
    list: (type) => {
      const lv = levels();
      if (lv[type] === "hidden") return [];
      return store.list(type).map((s) => asSeen(s, lv) as StoredEntity);
    },
    search: (text, o) => {
      const lv = levels();
      if (o?.type && lv[o.type] === "hidden") return [];
      return store.search(text, o).filter((id) => asSeen(store.get(id), lv) !== null);
    },
  };
}

export function makeCaps(c: CapsContext): Caps {
  const ro = readStore(c.store);
  const meta = { actor: "agent" as const, run: c.run, ...(c.device ? { device: c.device } : {}) };
  const toWrites = (def: TypeDef, values: Val, extra: Label) => {
    if (values.t !== "rec") throw new ToolError("values-not-a-record");
    const writes: Record<string, { value: unknown; label: Label }> = {};
    for (const [k, v] of Object.entries(values.fields)) {
      const l = join(deepLabel(v), extra);
      let value: unknown = plain(v);
      if (typeof value === "string" && lowIntegrity(l)) value = neutralize(value);
      if (k === "body" || k === "$body") {
        writes[BODY] = { value, label: l };
        continue;
      }
      const f = fieldByName(def, k);
      if (!f) throw new ToolError("unknown-field");
      writes[f.id] = { value, label: l };
    }
    return writes;
  };
  const wrap = <T>(f: () => T): T => {
    try {
      return f();
    } catch (e) {
      if (e instanceof StoreError) throw new ToolError(`store-${e.code}`);
      throw e;
    }
  };
  const writer: Writer = {
    create(typeKey, values, extra) {
      const def = typeByKey(ro, typeKey);
      // What comes back is what the models may see of it (an opaque type's values stay kept).
      const made = wrap(() => c.store.create(def.id, toWrites(def, values, extra), meta));
      return entityVal(ro.get(made.entity.id) ?? made, def);
    },
    update(id, values, extra) {
      const s = ro.get(id);
      if (!s || s.entity.deleted !== undefined) throw new ToolError("not-found");
      const def = c.store.schema().types[s.entity.type];
      if (!def || def.system) throw new ToolError("not-found");
      const changed = wrap(() => c.store.update(id, toWrites(def, values, extra), meta));
      return entityVal(ro.get(changed.entity.id) ?? changed, def);
    },
    remove(id) {
      const s = ro.get(id);
      const def = s ? c.store.schema().types[s.entity.type] : undefined;
      if (!s || !def || def.system) throw new ToolError("not-found");
      wrap(() => c.store.remove(id, meta));
    },
  };
  const fieldDef = (key: string, name: string, kind: FieldType, l: Label): FieldDef => {
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(key)) throw new ToolError("bad-key");
    return {
      id: newId("f", c.now()),
      key,
      name: (lowIntegrity(l) ? neutralize(name) : name).slice(0, 80),
      type: kind,
      label: l,
    };
  };
  const schema: SchemaWriter = {
    createType(key, name, l) {
      if (!/^[a-z][a-z0-9_]{0,40}$/.test(key)) throw new ToolError("bad-key");
      if (Object.values(c.store.schema().types).some((t) => t.key === key))
        throw new ToolError("type-exists");
      const title = fieldDef("titulo", "Título", "text", l);
      const def: TypeDef = {
        id: newId("t", c.now()),
        key,
        name: (lowIntegrity(l) ? neutralize(name) : name).slice(0, 80),
        fields: [title],
        titleField: title.id,
        sensitivity: "personal",
        schemaVersion: 1,
        label: l,
      };
      wrap(() => c.store.applySchema({ op: "create_type", type: def }, meta));
      return leaf(key, l);
    },
    addField(typeKey, key, name, kind, l) {
      const def = typeByKey(ro, typeKey);
      if (def.fields.some((f) => f.key === key || fieldName(f) === key))
        throw new ToolError("field-exists");
      wrap(() =>
        c.store.applySchema(
          { op: "add_field", type: def.id, field: fieldDef(key, name, kind, l) },
          meta,
        ),
      );
      return leaf(key, l);
    },
  };
  const system = {
    actor: "system" as const,
    run: c.run,
    ...(c.device ? { device: c.device } : {}),
  };
  const memory: MemoryWriter = {
    save(text, extra) {
      const def = c.store.schema().types.memory;
      if (!def) throw new ToolError("no-memory");
      const l = join(deepLabel(text), extra);
      const v = plain(text);
      if (typeof v !== "string" || !v.trim()) throw new ToolError("bad-argument");
      const f = def.fields.find((x) => x.key === "text");
      if (!f) throw new ToolError("no-memory");
      const s = wrap(() =>
        c.store.create(
          def.id,
          { [f.id]: { value: lowIntegrity(l) ? neutralize(v) : v, label: l } },
          system,
        ),
      );
      return leaf(s.entity.id, codeLabel("memory"));
    },
  };
  const jobs: JobWriter = {
    create(name, schedule, prompt, extra) {
      const def = c.store.schema().types.job;
      if (!def) throw new ToolError("no-jobs");
      const sch = plain(schedule);
      if (sch !== "daily" && sch !== "weekly") throw new ToolError("bad-option");
      const byKey = (k: string) => def.fields.find((x) => x.key === k)?.id as string;
      const text = (v: Val) => {
        const x = plain(v);
        const l = join(deepLabel(v), extra);
        return { value: typeof x === "string" && lowIntegrity(l) ? neutralize(x) : x, label: l };
      };
      const s = wrap(() =>
        c.store.create(
          def.id,
          {
            [byKey("name")]: text(name),
            [byKey("schedule")]: { value: sch, label: join(deepLabel(schedule), extra) },
            [byKey("prompt")]: text(prompt),
          },
          system,
        ),
      );
      return leaf(s.entity.id, codeLabel("job"));
    },
  };
  const notifier: Notifier = {
    notify(text) {
      const v = plain(text);
      if (typeof v !== "string" || !v) throw new ToolError("bad-argument");
      c.notify?.(v.slice(0, 500), deepLabel(text));
    },
  };
  const noNet = {
    fetchText: () => Promise.reject(new ToolError("no-network")),
    send: () => Promise.reject(new ToolError("no-network")),
  };
  const net = c.net ?? noNet;
  return {
    read: { store: ro },
    write: { store: ro, writer },
    write_irreversible: { store: ro, writer },
    egress: { store: ro, net: { fetchText: (u) => net.fetchText(u) } },
    send: { store: ro, net: { send: (m) => net.send(m) } },
    schedule: { store: ro, jobs },
    schema: { store: ro, schema },
    memory: { store: ro, memory },
    notify: { store: ro, notifier },
  };
}

/** Boni's own types the agent's tools write through code (memory, jobs): made once, by the code. */
export function ensureSystemTypes(store: UserStore): void {
  const code = label("own", "personal", [{ kind: "code", id: "system-types" }]);
  const make = (id: "memory" | "job", name: string, keys: string[]) => {
    if (store.schema().types[id]) return;
    const fields: FieldDef[] = keys.map((k) => ({
      id: `f_${k}`,
      key: k,
      name: k,
      type: k === "prompt" ? "longtext" : "text",
      label: code,
    }));
    store.applySchema(
      {
        op: "create_type",
        type: {
          id,
          key: id,
          name,
          fields,
          titleField: fields[0]?.id as string,
          sensitivity: "personal",
          schemaVersion: 1,
          system: true,
          label: code,
        },
      },
      { actor: "system" },
    );
  };
  make("memory", "Memoria", ["text"]);
  make("job", "Trabajos", ["name", "schedule", "prompt"]);
}
