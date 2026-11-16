/**
 * A step's connections with collections and their limits (docs/automatizaciones.md §5.5): what the step may do in each
 * collection it is joined to. In F14c only «Código» has them and only to read (AU-41, AU-46); writing arrives with the
 * «Agente» (F15), and the format already holds its three actions so it does not change again. A connection only
 * narrows: it never lets a step do what the policy does not (the policy is asked for every read all the same, AU-161).
 */
import { type FilterItem, filterErrors, isFilterGroup } from "@boni/views";
import { CODE_LIMITS, CODE_TYPE, CodeFault, type CodeProblem } from "./code.ts";
import { FormatError, type ParamValue, type Step } from "./format.ts";
import type { ValidationContext } from "./validate.ts";

/** «Solo estas filas», «Solo estos campos» and a limit (AU-43). An absent one does not limit. */
export interface ReadLimits {
  /** The views' filter. It is added with «y» to whatever the step asks for: it narrows, never widens. */
  where?: FilterItem[];
  /**
   * Field keys. A row read comes with these and its id, nothing else; and a search may not filter, sort, count or sum
   * by a field outside them (asking «is it over 50?» of a hidden field would read it).
   */
  fields?: string[];
  /**
   * Rows per read, at most. A limit Juan set, or one the code asks for, cuts the rows quietly: it was asked for.
   * `CODE_LIMITS.readRows` is not one of those: a read that would give more than it fails (`code.limit`), since
   * half a collection handed over as if it were whole would add up wrong.
   */
  limit?: number;
}

/** The format of §5.5, as it is saved in `Step.connections`. */
export interface Connection {
  /** The collection's key: a literal, so the map knows it before any run (D-48). One connection per collection. */
  collection: string;
  read: false | ReadLimits;
  /** F15. In F14c anything but `false` does not validate (`connection.write`). */
  create: false | { mode: "ask" | "yes"; fields?: string[]; fixed?: Record<string, ParamValue> };
  /** F15. */
  update: false | { mode: "ask" | "yes"; where?: FilterItem[]; fields?: string[] };
  /** F15. To the trash; never "yes". */
  remove: false | { mode: "ask"; where?: FilterItem[] };
}

export const CONNECTION_ACTIONS = ["read", "create", "update", "remove"] as const;
export type ConnectionAction = (typeof CONNECTION_ACTIONS)[number];

/** Connections a step may hold, at most. */
export const MAX_CONNECTIONS = 12;

/**
 * One permission of a connection, as the three places that say it need it: the chip under the step (AU-40: «Lee ·
 * solo este año»), the cell of the table (AU-41: «Sí · con filtro») and the sentence under it (AU-44). The words are
 * the app's (`i18n.ts`); a filter is said with the words the views already have for one.
 */
export interface Permission {
  collection: string;
  action: ConnectionAction;
  mode: "yes" | "ask";
  where?: readonly FilterItem[];
  fields?: readonly string[];
  limit?: number;
}

/** A search as «Código» asks for it (`$col('…').find(…)` and its siblings), before the connection's limits. */
export interface ReadAsk {
  /** The collection's key. */
  collection: string;
  op: "find" | "get" | "count" | "sum";
  where?: readonly FilterItem[];
  sort?: readonly { field: string; direction: "asc" | "desc" }[];
  limit?: number;
  /** `get`: the row's id. */
  id?: string;
  /** `sum`: the field. */
  field?: string;
}

/**
 * An ask with its connection's limits on it: what the server reads. `fields`: the only ones that come back (`asRead`).
 * `failsOver`: neither the code nor the connection limited it, so more rows than this fail instead of being cut
 * (`cutRead`).
 */
export type NarrowedAsk = ReadAsk & {
  limit: number;
  fields?: readonly string[];
  failsOver?: number;
};

/**
 * Which actions a step type's connections may give, and so the columns of its table (AU-41, AU-46): «Código», `read`
 * alone; every other type of F14c, none (a connection on it does not validate). F15 adds the «Agente» with the four.
 */
export function connectionActions(type: string): readonly ConnectionAction[] {
  return type === CODE_TYPE ? READ_ONLY : NONE;
}
const READ_ONLY: readonly ConnectionAction[] = Object.freeze(["read"]);
const NONE: readonly ConnectionAction[] = Object.freeze([]);

/** What connecting a collection gives (AU-41): reading with no limits, and no permission to write. */
export function newConnection(collection: string): Connection {
  return { collection, read: {}, create: false, update: false, remove: false };
}

/** Every permission a step's connections give, in the order of its connections and of `CONNECTION_ACTIONS`. */
export function permissions(connections: readonly Connection[]): Permission[] {
  const out: Permission[] = [];
  for (const c of connections)
    for (const action of CONNECTION_ACTIONS) {
      const given = c[action];
      if (given === false) continue;
      const p: Permission = {
        collection: c.collection,
        action,
        mode: "mode" in given ? given.mode : "yes",
      };
      if ("where" in given && given.where && given.where.length > 0) p.where = given.where;
      if ("fields" in given && given.fields) p.fields = given.fields;
      if ("limit" in given && given.limit !== undefined) p.limit = given.limit;
      out.push(p);
    }
  return out;
}

/** The fields an ask touches: what it filters, sorts and sums by. */
function fieldsAsked(ask: ReadAsk): string[] {
  const out: string[] = [];
  for (const item of ask.where ?? [])
    for (const rule of isFilterGroup(item) ? item.rules : [item]) out.push(rule.field);
  for (const s of ask.sort ?? []) out.push(s.field);
  if (ask.field !== undefined) out.push(ask.field);
  return out;
}

/**
 * The ask with the connection's limits put on it (AU-43): its filter added with «y», its fields the only ones that
 * come back, its limit the ceiling. Throws `CodeFault` (`code.read.notConnected`, `code.read.query`) when the step has
 * no connection that reads that collection, or the ask names a field the connection hides. It never returns an ask
 * wider than the one it got: every row it lets through passes the connection's filter too.
 *
 * With no limit from the code nor from the connection, the limit is `CODE_LIMITS.readRows + 1` and `failsOver` says so:
 * whoever reads asks for one row more than may be given, so a read that would give more is told apart from one that
 * gives exactly that, and fails (`cutRead`) instead of being cut. `count` and `sum` give one number: no limit of rows
 * applies to them, the connection's filter does.
 */
export function narrow(ask: ReadAsk, connections: readonly Connection[]): NarrowedAsk {
  const read = connections.find((c) => c.collection === ask.collection && c.read !== false)?.read;
  if (read === undefined || read === false)
    throw new CodeFault(`no connection reads ${ask.collection}`, {
      code: "code.read.notConnected",
      detail: { collection: ask.collection },
    });
  if (read.fields)
    for (const field of fieldsAsked(ask))
      if (field !== "id" && !read.fields.includes(field))
        throw new CodeFault(`${field} is not read in ${ask.collection}`, {
          code: "code.read.query",
          detail: { collection: ask.collection, why: "hidden", field },
        });
  const limits = [ask.limit, read.limit].filter((n): n is number => n !== undefined);
  const counts = ask.op === "count" || ask.op === "sum";
  // A limit cuts quietly; one above the cap of a read, or none, is the cap, which fails rather than cut: the store is
  // never asked for more than one row past it.
  const limit = limits.length > 0 ? Math.min(...limits) : Number.POSITIVE_INFINITY;
  const capped = limit > CODE_LIMITS.readRows;
  const out: NarrowedAsk = {
    ...ask,
    limit: counts ? Number.MAX_SAFE_INTEGER : capped ? CODE_LIMITS.readRows + 1 : limit,
  };
  if (!counts && capped) out.failsOver = CODE_LIMITS.readRows;
  const where = [...(read.where ?? []), ...(ask.where ?? [])];
  if (where.length > 0) out.where = where;
  else delete out.where;
  if (read.fields) out.fields = read.fields;
  return out;
}

/**
 * The rows a read gives, from the ones the store gave for a narrowed ask (AU-43): at most its limit, cut quietly when
 * the code or the connection asked for that limit; when neither did, more than `CODE_LIMITS.readRows` is
 * `code.limit` and nothing is given, since half a collection handed over as whole would add up wrong.
 */
export function cutRead<T>(rows: readonly T[], ask: NarrowedAsk): T[] {
  if (ask.failsOver !== undefined && rows.length > ask.failsOver)
    throw new CodeFault(`a read of ${ask.collection} gives more than ${ask.failsOver} rows`, {
      code: "code.limit",
      detail: { limit: "readRows", max: ask.failsOver, got: rows.length },
    });
  return rows.slice(0, ask.limit);
}

/** A row as a read gives it (AU-43): its id and, with «Solo estos campos», those fields and no other. */
export function asRead(
  id: string,
  values: Readonly<Record<string, unknown>>,
  ask: Pick<NarrowedAsk, "fields">,
): Record<string, unknown> {
  const keys = ask.fields ?? Object.keys(values);
  const out: Record<string, unknown> = { id };
  // A key like `__proto__` is a field like any other: defined, never assigned (AU-25).
  for (const k of keys)
    if (k !== "id" && Object.hasOwn(values, k))
      Object.defineProperty(out, k, {
        value: values[k],
        enumerable: true,
        writable: true,
        configurable: true,
      });
  return out;
}

// ---------------------------------------------------------------- validation

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The fields a filter names. */
const fieldsOf = (where: readonly FilterItem[]) =>
  where.flatMap((item) => (isFilterGroup(item) ? item.rules : [item]).map((r) => r.field));

/**
 * What is wrong with a step's connections (AU-40, AU-41, AU-46): `connection.*`. Only needs to know the collections,
 * so validation checks them with any context, before the JavaScript.
 */
export function connectionProblems(step: Step, context: ValidationContext): CodeProblem[] {
  const connections = step.connections ?? [];
  if (connections.length === 0) return [];
  const out: CodeProblem[] = [];
  const add = (code: CodeProblem["code"], detail?: Record<string, string | number>) =>
    out.push({
      code,
      severity: "error",
      step: step.id,
      param: "connections",
      ...(detail ? { detail } : {}),
    });
  const actions = connectionActions(step.type);
  if (actions.length === 0) {
    add("connection.notAllowed");
    return out;
  }
  if (connections.length > MAX_CONNECTIONS)
    add("connection.many", { max: MAX_CONNECTIONS, got: connections.length });
  const seen = new Set<string>();
  for (const c of connections) {
    if (seen.has(c.collection)) add("connection.repeated", { collection: c.collection });
    seen.add(c.collection);
    const shape = context.collection(c.collection);
    if (!shape) {
      add("connection.unknown", { collection: c.collection });
      continue;
    }
    for (const action of CONNECTION_ACTIONS)
      if (c[action] !== false && !actions.includes(action))
        add("connection.write", { collection: c.collection, action });
    const keys = new Set(shape.fields.map((f) => f.key));
    const limits = (why: string, extra: Record<string, string | number> = {}) =>
      add("connection.limits", { collection: c.collection, why, ...extra });
    const fieldsKnown = (fields: readonly string[] | undefined) => {
      for (const field of fields ?? []) if (!keys.has(field)) limits("field", { field });
    };
    const whereOk = (where: readonly FilterItem[] | undefined) => {
      if (where === undefined) return;
      if (filterErrors(where).length > 0) limits("where");
      else
        for (const field of fieldsOf(where))
          if (field !== "id" && !keys.has(field)) limits("field", { field });
    };
    if (c.read !== false) {
      whereOk(c.read.where);
      fieldsKnown(c.read.fields);
      const n = c.read.limit;
      if (n !== undefined && !(Number.isInteger(n) && n >= 1 && n <= CODE_LIMITS.readRows))
        limits("limit", { got: n });
    }
    if (c.create !== false) fieldsKnown(c.create.fields);
    if (c.update !== false) {
      whereOk(c.update.where);
      fieldsKnown(c.update.fields);
    }
    if (c.remove !== false) whereOk(c.remove.where);
  }
  return out;
}

// ---------------------------------------------------------------- the format

const closedKeys = (v: Record<string, unknown>, keys: readonly string[], path: string) => {
  for (const k of Object.keys(v))
    if (!keys.includes(k)) throw new FormatError(`${path}.${k}`, "unknown key");
};
const stringList = (v: unknown, path: string): string[] => {
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string"))
    throw new FormatError(`${path}`, "a list of field keys");
  return [...v];
};
const filterOf = (v: unknown, path: string): FilterItem[] => {
  if (filterErrors(v).length > 0) throw new FormatError(`${path}`, "not a filter of the views");
  return v as FilterItem[];
};
const modeOf = (v: unknown, path: string, modes: readonly string[]) => {
  if (typeof v !== "string" || !modes.includes(v))
    throw new FormatError(`${path}`, `${modes.join(" or ")}`);
  return v;
};

/**
 * One connection as the format holds it (§5.5), closed: a key it does not know is refused. `param` reads a value as
 * a parameter's (format.ts), for `create.fixed`.
 */
export function parseConnection(
  v: unknown,
  path: string,
  param: (v: unknown, path: string) => ParamValue,
): Connection {
  if (!isObj(v)) throw new FormatError(`${path}`, "an object");
  closedKeys(v, ["collection", ...CONNECTION_ACTIONS], path);
  if (typeof v.collection !== "string" || v.collection === "")
    throw new FormatError(`${path}.collection`, "a collection's key");
  const out = newConnection(v.collection);
  out.read = false;
  const read = v.read ?? false;
  if (read !== false) {
    if (!isObj(read)) throw new FormatError(`${path}.read`, "false or its limits");
    closedKeys(read, ["where", "fields", "limit"], `${path}.read`);
    const limits: ReadLimits = {};
    if (read.where !== undefined) limits.where = filterOf(read.where, `${path}.read.where`);
    if (read.fields !== undefined) limits.fields = stringList(read.fields, `${path}.read.fields`);
    if (read.limit !== undefined) {
      if (typeof read.limit !== "number") throw new FormatError(`${path}.read.limit`, "a number");
      limits.limit = read.limit;
    }
    out.read = limits;
  }
  const create = v.create ?? false;
  if (create !== false) {
    if (!isObj(create)) throw new FormatError(`${path}.create`, "false or its permission");
    closedKeys(create, ["mode", "fields", "fixed"], `${path}.create`);
    const c: Exclude<Connection["create"], false> = {
      mode: modeOf(create.mode, `${path}.create.mode`, ["ask", "yes"]) as "ask" | "yes",
    };
    if (create.fields !== undefined) c.fields = stringList(create.fields, `${path}.create.fields`);
    if (create.fixed !== undefined) {
      if (!isObj(create.fixed)) throw new FormatError(`${path}.create.fixed`, "an object");
      c.fixed = Object.fromEntries(
        Object.entries(create.fixed).map(([k, x]) => [k, param(x, `${path}.create.fixed.${k}`)]),
      );
    }
    out.create = c;
  }
  const update = v.update ?? false;
  if (update !== false) {
    if (!isObj(update)) throw new FormatError(`${path}.update`, "false or its permission");
    closedKeys(update, ["mode", "where", "fields"], `${path}.update`);
    const u: Exclude<Connection["update"], false> = {
      mode: modeOf(update.mode, `${path}.update.mode`, ["ask", "yes"]) as "ask" | "yes",
    };
    if (update.where !== undefined) u.where = filterOf(update.where, `${path}.update.where`);
    if (update.fields !== undefined) u.fields = stringList(update.fields, `${path}.update.fields`);
    out.update = u;
  }
  const remove = v.remove ?? false;
  if (remove !== false) {
    if (!isObj(remove)) throw new FormatError(`${path}.remove`, "false or its permission");
    closedKeys(remove, ["mode", "where"], `${path}.remove`);
    const r: Exclude<Connection["remove"], false> = {
      mode: modeOf(remove.mode, `${path}.remove.mode`, ["ask"]) as "ask",
    };
    if (remove.where !== undefined) r.where = filterOf(remove.where, `${path}.remove.where`);
    out.remove = r;
  }
  return out;
}
