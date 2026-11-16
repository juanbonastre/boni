/**
 * A step's connections with collections and their limits (docs/automatizaciones.md §5.5): what the step may do in each
 * collection it is joined to. In F14c only «Código» has them and only to read (AU-41, AU-46); writing arrives with the
 * «Agente» (F15), and the format already holds its three actions so it does not change again. A connection only
 * narrows: it never lets a step do what the policy does not (the policy is asked for every read all the same, AU-161).
 * Contracts of F14c: nothing here is built yet (pending.ts).
 */
import type { FilterItem } from "@boni/views";
import type { ParamValue } from "./format.ts";
import { notBuilt } from "./pending.ts";

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
 * Which actions a step type's connections may give, and so the columns of its table (AU-41, AU-46): «Código», `read`
 * alone; every other type of F14c, none (a connection on it does not validate). F15 adds the «Agente» with the four.
 */
export function connectionActions(type: string): readonly ConnectionAction[] {
  return notBuilt(`connectionActions(${type})`);
}

/** What connecting a collection gives (AU-41): reading with no limits, and no permission to write. */
export function newConnection(collection: string): Connection {
  return notBuilt(`newConnection(${collection})`);
}

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

/** Every permission a step's connections give, in the order of its connections and of `CONNECTION_ACTIONS`. */
export function permissions(connections: readonly Connection[]): Permission[] {
  return notBuilt(`permissions(${connections.length})`);
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

/** An ask with its connection's limits on it: what the server reads. `fields`: the only ones that come back. */
export type NarrowedAsk = ReadAsk & { limit: number; fields?: readonly string[] };

/**
 * The ask with the connection's limits put on it (AU-43): its filter added with «y», its fields the only ones that
 * come back, its limit the ceiling. Throws `CodeFault` (`code.read.notConnected`, `code.read.query`) when the step has
 * no connection that reads that collection, or the ask names a field the connection hides. It never returns an ask
 * wider than the one it got: every row it lets through passes the connection's filter too.
 */
export function narrow(ask: ReadAsk, connections: readonly Connection[]): NarrowedAsk {
  return notBuilt(`narrow(${ask.collection}, ${connections.length})`);
}
