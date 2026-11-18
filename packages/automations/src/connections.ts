/**
 * A step's connections with collections and their limits (docs/automatizaciones.md §5.5): what the step may do in each
 * collection it is joined to. In F14c only «Código» has them: it always reads, and may be let create, modify or remove
 * (AU-41, AU-46, AU-176; Juan, 2026-11-16); the «Agente» (F15) takes the same four. A connection only narrows: it
 * never lets a step do what the policy does not (the policy is asked for every read and every write all the same,
 * AU-161, AU-174).
 */
import { type FilterItem, filterErrors, isFilterGroup } from "@boni/views";
import {
  AGENT_TYPE,
  CODE_LIMITS,
  CODE_TYPE,
  CodeFault,
  type CodeProblem,
  type WriteAction,
} from "./code.ts";
import { FormatError, isExpr, type ParamValue, type Step } from "./format.ts";
import type { Cell } from "./rows.ts";
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
  /**
   * The three write actions: `false` is «No», `ask` «Preguntar», `yes` «Sí», each on its own (AU-176). Their own
   * limits narrow on top of the read's (AU-177, AU-48): «Solo estas filas» (`where`) of modify and remove, «Solo
   * estos campos» (`fields`) of create and modify, the fixed values of create and modify (`fixed`, which the step
   * does not choose: Juan's, decision 18 of §10), and «Como mucho N filas» (`limit`, AU-196) of the three.
   */
  create:
    | false
    | {
        mode: "ask" | "yes";
        fields?: string[];
        fixed?: Record<string, ParamValue>;
        limit?: number;
        /** An «Agente»'s line for each field the AI decides (AU-52): what the field is for, in its schema. */
        lines?: Record<string, string>;
      };
  update:
    | false
    | {
        mode: "ask" | "yes";
        where?: FilterItem[];
        fields?: string[];
        /** What each row it modifies ends with in these fields, whatever the step asked (decision 18 of §10). */
        fixed?: Record<string, ParamValue>;
        limit?: number;
        lines?: Record<string, string>;
      };
  /** Always to the trash (AU-122); a `yes` removes without asking only as AU-186 says. */
  remove: false | { mode: "ask" | "yes"; where?: FilterItem[]; limit?: number };
}

/** A fixed value as the format holds it that is a plain value, not an expression (an «Agente»'s may be one, AU-52). */
export function literalCell(v: ParamValue): v is Cell {
  if (isExpr(v)) return false;
  if (Array.isArray(v)) return v.every(literalCell);
  if (typeof v === "object" && v !== null) return Object.values(v).every(literalCell);
  return true;
}

/** One write action's cell when it is not «No». */
export type WriteCell = Exclude<Connection[WriteAction], false>;

/**
 * «Como mucho N filas» (AU-196): a write action's limit goes from 1 to this, as a read's does. An «Agente»'s write
 * action is born with `AGENT_BORN_ROWS` the moment a hand takes it out of «No»: Juan's limit on what an AI decides.
 * A «Código»'s is born without one (what its code writes, he wrote).
 */
export const ACTION_ROWS_MAX = CODE_LIMITS.readRows;
export const AGENT_BORN_ROWS = 20;

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
 * Which actions a step type's connections may give, and so the columns of its table (AU-41, AU-46, AU-176): «Código»
 * and «Agente» (F15 E3), the four; every other type, none (a connection on it does not validate).
 */
export function connectionActions(type: string): readonly ConnectionAction[] {
  return type === CODE_TYPE || type === AGENT_TYPE ? ALL : NONE;
}

/**
 * A write action's cell as it is born when a hand takes it out of «No» (AU-196): with `mode`, and on an «Agente»
 * with «Como mucho 20». A «Código»'s, and any other type's, with no limit.
 */
export function bornCell(type: string, mode: "ask" | "yes"): WriteCell {
  return type === AGENT_TYPE ? { mode, limit: AGENT_BORN_ROWS } : { mode };
}
const ALL: readonly ConnectionAction[] = Object.freeze([...CONNECTION_ACTIONS]);
const NONE: readonly ConnectionAction[] = Object.freeze([]);

/** What connecting a collection gives (AU-41): reading with no limits, and no permission to write. */
export function newConnection(collection: string): Connection {
  return { collection, read: {}, create: false, update: false, remove: false };
}

/**
 * The fix of `code.write.notAllowed` (AU-176): the connection with that action's cell at «Preguntar». Never «Sí»: that
 * only the person's hand sets (AU-188). A cell that already allows it is left as it is.
 */
export function allowing(
  connection: Connection,
  action: Exclude<ConnectionAction, "read">,
  type: string = CODE_TYPE,
): Connection {
  if (connection[action] !== false) return connection;
  return { ...connection, [action]: bornCell(type, "ask") };
}

/**
 * Every permission a step's connections give, in the order of its connections and of `CONNECTION_ACTIONS`, each with
 * its mode: reading is always `yes`; a write `ask` («pregunta antes») or `yes` (a removal so is «sin preguntar»,
 * AU-178, AU-189).
 */
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
export function fieldsAsked(ask: ReadAsk): string[] {
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
export function narrow(
  ask: ReadAsk,
  connections: readonly Connection[],
  action?: Exclude<WriteAction, "create">,
): NarrowedAsk {
  const connection = connections.find((c) => c.collection === ask.collection && c.read !== false);
  const read = connection?.read;
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
  // With an action (AU-48): the rows it may modify or remove, its own filter added with «y» too (what an «Agente» is
  // shown as rows it may change, E3); an action in «No» gives none.
  const cell = action ? connection?.[action] : undefined;
  if (action && !cell)
    throw new CodeFault(`the step's connection does not let it ${action} in ${ask.collection}`, {
      code: "code.write.notAllowed",
      detail: { collection: ask.collection, action },
    });
  const where = [...(read.where ?? []), ...(cell ? (cell.where ?? []) : []), ...(ask.where ?? [])];
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
  const agent = step.type === AGENT_TYPE;
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
    // «Como mucho N filas» of a write action (AU-196): a whole number from 1 to `ACTION_ROWS_MAX`.
    const rowsOk = (action: WriteAction, n: number | undefined) => {
      if (n !== undefined && !(Number.isInteger(n) && n >= 1 && n <= ACTION_ROWS_MAX))
        limits("limit", { action, got: n });
    };
    // A field's line is of a field the AI decides (AU-52): only an «Agente» has them.
    const linesOk = (cell: { fields?: readonly string[]; lines?: Record<string, string> }) => {
      for (const [field, line] of Object.entries(cell.lines ?? {}))
        if (!agent || !cell.fields?.includes(field) || typeof line !== "string")
          limits("field", { field });
    };
    // A fixed value of create or modify is of a field the collection has; one also left to the step would be two
    // answers (AU-48). An «Agente»'s may be an expression (AU-52), which the code resolves for each unit; a «Código»'s
    // is a plain one. Modify's are create's, the same (decision 18 of §10).
    const fixedOk = (cell: { fields?: readonly string[]; fixed?: Record<string, ParamValue> }) => {
      for (const [field, v] of Object.entries(cell.fixed ?? {}))
        if (!keys.has(field) || cell.fields?.includes(field) || (!agent && !literalCell(v)))
          limits("field", { field });
    };
    if (c.create !== false) {
      fieldsKnown(c.create.fields);
      fixedOk(c.create);
      rowsOk("create", c.create.limit);
      linesOk(c.create);
    }
    if (c.update !== false) {
      whereOk(c.update.where);
      fieldsKnown(c.update.fields);
      fixedOk(c.update);
      rowsOk("update", c.update.limit);
      linesOk(c.update);
    }
    if (c.remove !== false) {
      whereOk(c.remove.where);
      rowsOk("remove", c.remove.limit);
    }
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
const rowsOf = (v: unknown, path: string): number => {
  if (typeof v !== "number") throw new FormatError(`${path}`, "a number");
  return v;
};
const linesOf = (v: unknown, path: string): Record<string, string> => {
  if (!isObj(v) || !Object.values(v).every((x) => typeof x === "string"))
    throw new FormatError(`${path}`, "a line of text by field key");
  return { ...(v as Record<string, string>) };
};
const fixedOf = (
  v: unknown,
  path: string,
  param: (v: unknown, path: string) => ParamValue,
): Record<string, ParamValue> => {
  if (!isObj(v)) throw new FormatError(`${path}`, "an object");
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, param(x, `${path}.${k}`)]));
};
const modeOf = (v: unknown, path: string, modes: readonly string[]) => {
  if (typeof v !== "string" || !modes.includes(v))
    throw new FormatError(`${path}`, `${modes.join(" or ")}`);
  return v;
};

/**
 * One connection as the format holds it (§5.5), closed: a key it does not know is refused. `param` reads a value as
 * a parameter's (format.ts), for `create.fixed` and `update.fixed`.
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
    closedKeys(create, ["mode", "fields", "fixed", "limit", "lines"], `${path}.create`);
    const c: Exclude<Connection["create"], false> = {
      mode: modeOf(create.mode, `${path}.create.mode`, ["ask", "yes"]) as "ask" | "yes",
    };
    if (create.fields !== undefined) c.fields = stringList(create.fields, `${path}.create.fields`);
    if (create.fixed !== undefined) c.fixed = fixedOf(create.fixed, `${path}.create.fixed`, param);
    if (create.limit !== undefined) c.limit = rowsOf(create.limit, `${path}.create.limit`);
    if (create.lines !== undefined) c.lines = linesOf(create.lines, `${path}.create.lines`);
    out.create = c;
  }
  const update = v.update ?? false;
  if (update !== false) {
    if (!isObj(update)) throw new FormatError(`${path}.update`, "false or its permission");
    closedKeys(update, ["mode", "where", "fields", "fixed", "limit", "lines"], `${path}.update`);
    const u: Exclude<Connection["update"], false> = {
      mode: modeOf(update.mode, `${path}.update.mode`, ["ask", "yes"]) as "ask" | "yes",
    };
    if (update.where !== undefined) u.where = filterOf(update.where, `${path}.update.where`);
    if (update.fields !== undefined) u.fields = stringList(update.fields, `${path}.update.fields`);
    if (update.fixed !== undefined) u.fixed = fixedOf(update.fixed, `${path}.update.fixed`, param);
    if (update.limit !== undefined) u.limit = rowsOf(update.limit, `${path}.update.limit`);
    if (update.lines !== undefined) u.lines = linesOf(update.lines, `${path}.update.lines`);
    out.update = u;
  }
  const remove = v.remove ?? false;
  if (remove !== false) {
    if (!isObj(remove)) throw new FormatError(`${path}.remove`, "false or its permission");
    closedKeys(remove, ["mode", "where", "limit"], `${path}.remove`);
    const r: Exclude<Connection["remove"], false> = {
      mode: modeOf(remove.mode, `${path}.remove.mode`, ["ask", "yes"]) as "ask" | "yes",
    };
    if (remove.where !== undefined) r.where = filterOf(remove.where, `${path}.remove.where`);
    if (remove.limit !== undefined) r.limit = rowsOf(remove.limit, `${path}.remove.limit`);
    out.remove = r;
  }
  return out;
}
