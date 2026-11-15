/**
 * The executors of «Colección» (docs/automatizaciones.md §5.10, AU-120 to AU-122): find, get, create, update, upsert,
 * trash and aggregate. Each works row by row, and only through the gate its context brings (AU-168): it never holds
 * the collections, and every read and write it asks for is judged by the policy first. A row read from a collection
 * keeps its `origin`, so a later step modifies it or sends it to the trash without searching again (AU-04).
 */
import type { Labeled } from "@boni/entities";
import { resultName } from "./catalogue.ts";
import type { Change, Labelled, StoredRow, WriteResult } from "./effects.ts";
import type { Executor, RowOut, StepContext, StepOutput } from "./engine.ts";
import { StepFault } from "./failures.ts";
import { MAIN, type ParamValue } from "./format.ts";
import type { Cell, Row, RowOrigin } from "./rows.ts";
import { filterOf, raw, setField } from "./steps.ts";

/**
 * How many rows «Las que cumplan…» may touch: all of them. The limits of a run (AU-17, F14d) will cap what a run
 * writes; until then this only keeps the query a number.
 */
export const ALL_ROWS = Number.MAX_SAFE_INTEGER;

const one = (rows: RowOut[]): StepOutput => ({ [MAIN]: rows });

/** A row out that is a saved row as the collections give it: its fields, its labels and where it is saved. */
const stored = (r: StoredRow): RowOut => ({
  json: r.json,
  label: r.label,
  ...(r.fields ? { fields: r.fields } : {}),
  origin: r.origin,
});

/** The row a write gives: the one saved, the one a test would make, or none when it waits for Juan. */
function written(r: WriteResult): RowOut[] {
  if (r.kind === "asked") return [];
  const { json, label, fields, origin } = r.row;
  return [{ json, label, ...(fields ? { fields } : {}), ...(origin ? { origin } : {}) }];
}

/** The step's collection: a fixed key (validation refuses an expression, AU-26). */
const collectionOf = (ctx: StepContext): string => String(raw(ctx, "collection"));

/** The fields a row is written with (`fields`: «the form of the row», AU-121): only the ones added, with labels. */
function fieldsOf(ctx: StepContext): { fields: Record<string, Cell>; values: Labelled } {
  const fields: Record<string, Cell> = {};
  const values: Labelled = {};
  const list = raw(ctx, "fields");
  for (const f of Array.isArray(list) ? list : []) {
    const o = f as Record<string, ParamValue>;
    const v: Labeled<Cell> =
      o.value === undefined
        ? { value: null, label: ctx.scope.literal, derived: false }
        : ctx.value(o.value);
    fields[String(o.field)] = v.value;
    values[String(o.field)] = v;
  }
  return { fields, values };
}

/** A count that is a whole number, zero or more. */
function wholeNumber(v: Cell, what: string, param: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0)
    throw new StepFault(`${what} is not a whole number`, {
      code: "value.type",
      param,
      detail: { needs: "whole" },
    });
  return v;
}

/**
 * The saved rows a modification or a trashing acts on (AU-121): the row that arrives, which must be a row of this
 * collection («Las filas que llegan»), or the ones that match the conditions, searched through the gate.
 */
async function targets(ctx: StepContext, row: Row | null): Promise<RowOrigin[]> {
  const collection = collectionOf(ctx);
  if (raw(ctx, "target") === "matching") {
    const values: Labelled = {};
    const where = filterOf(ctx, raw(ctx, "where"), values);
    const found = await ctx.gate.find(
      { collection, where, sort: [], limit: ALL_ROWS, related: false },
      values,
    );
    return found.map((r) => r.origin);
  }
  // With an empty list there is no row to act on (AU-14).
  if (!row) return [];
  if (row.origin?.collection !== collection)
    throw new StepFault(`the row that arrives is not a saved row of the collection ${collection}`, {
      code: "row.notSaved",
      param: "target",
      detail: { collection },
    });
  return [row.origin];
}

/** Writes each change through the gate: what was saved or would be, in order; nothing for what waits for Juan. */
async function writeAll(
  ctx: StepContext,
  changes: Change[],
  values: Labelled,
): Promise<StepOutput> {
  const out: RowOut[] = [];
  for (const c of changes) out.push(...written(await ctx.gate.write(c, values)));
  return one(out);
}

// «Buscar filas»: the rows that match, in the order asked, up to the limit (AU-120).
const find: Executor = {
  mode: "perRow",
  async run(ctx) {
    const values: Labelled = {};
    const where = filterOf(ctx, raw(ctx, "where"), values);
    const sortList = raw(ctx, "sort");
    const sort = (Array.isArray(sortList) ? sortList : []).map((s) => {
      const o = s as Record<string, ParamValue>;
      return {
        field: String(o.field),
        direction: o.direction === "desc" ? ("desc" as const) : ("asc" as const),
      };
    });
    const limit = ctx.value(raw(ctx, "limit") ?? null);
    values.limit = limit;
    const rows = await ctx.gate.find(
      {
        collection: collectionOf(ctx),
        where,
        sort,
        limit: wholeNumber(limit.value, "the limit", "limit"),
        related: raw(ctx, "related") === true,
      },
      values,
    );
    return one(rows.map(stored));
  },
};

// «Leer una fila»: the saved row with that id; one that is not there fails the step, and «Si falla» decides.
const get: Executor = {
  mode: "perRow",
  async run(ctx) {
    const id = ctx.value(raw(ctx, "row") ?? null);
    if (typeof id.value !== "string" || !id.value)
      throw new StepFault("the row to read is not a row id", {
        code: "value.type",
        param: "row",
        detail: { needs: "rowId" },
      });
    const collection = collectionOf(ctx);
    const r = await ctx.gate.get(collection, id);
    if (!r)
      throw new StepFault(`the row ${id.value} is not in the collection ${collection}`, {
        code: "row.missing",
        param: "row",
        detail: { collection },
      });
    return one([stored(r)]);
  },
};

// «Crear una fila»: one row with the fields added, for each row that arrives (once with fixed values when none does).
const create: Executor = {
  mode: "perRow",
  async run(ctx) {
    const { fields, values } = fieldsOf(ctx);
    return writeAll(ctx, [{ kind: "create", collection: collectionOf(ctx), fields }], values);
  },
};

// «Modificar filas»: the fields added, in the rows that arrive or in the ones that match.
const update: Executor = {
  mode: "perRow",
  async run(ctx, row) {
    const { fields, values } = fieldsOf(ctx);
    const rows = await targets(ctx, row);
    return writeAll(
      ctx,
      rows.map((r) => ({ kind: "update", row: r, fields })),
      values,
    );
  },
};

// «Crear o modificar»: the one row whose `match` fields hold the values written is modified; with none, one is made.
const upsert: Executor = {
  mode: "perRow",
  async run(ctx) {
    const { fields, values } = fieldsOf(ctx);
    const collection = collectionOf(ctx);
    const matchList = raw(ctx, "match");
    const keys = (Array.isArray(matchList) ? matchList : []).map((m) =>
      String((m as Record<string, ParamValue>).field),
    );
    const read: Labelled = {};
    const where = keys.map((field, i) => {
      const v = values[field];
      if (!v)
        throw new StepFault(`the field ${field} to match by is not among the fields written`, {
          code: "row.matchUnwritten",
          param: "match",
          detail: { field },
        });
      read[`match.${i}`] = v;
      if (v.value === null) return { field, op: "empty" as const };
      return {
        field,
        op: "is" as const,
        value: typeof v.value === "number" ? v.value : String(v.value),
      };
    });
    const found = await ctx.gate.find(
      { collection, where, sort: [], limit: 2, related: false },
      read,
    );
    if (found.length > 1) {
      // It never picks one: it fails saying how many match, which needs a count (only here, not on every row).
      const [count] = await ctx.gate.aggregate({ collection, where, measure: "count" }, read);
      const many = typeof count?.value === "number" ? count.value : found.length;
      throw new StepFault(
        `${many} rows of the collection ${collection} match: it modifies one or none`,
        { code: "row.many", param: "match", detail: { count: many } },
      );
    }
    const [match] = found;
    return writeAll(
      ctx,
      [
        match
          ? { kind: "update", row: match.origin, fields }
          : { kind: "create", collection, fields },
      ],
      values,
    );
  },
};

// «Eliminar filas»: to the trash, always (AU-122); it gives each row as it was.
const trash: Executor = {
  mode: "perRow",
  async run(ctx, row) {
    const rows = await targets(ctx, row);
    return writeAll(
      ctx,
      rows.map((r) => ({ kind: "trash", row: r })),
      {},
    );
  },
};

// «Contar o sumar»: one row with the result in the field `resultName` gives (as «Agrupar»), or one per value of
// `groupBy`.
const aggregate: Executor = {
  mode: "perRow",
  async run(ctx) {
    const values: Labelled = {};
    const where = filterOf(ctx, raw(ctx, "where"), values);
    const measure = String(raw(ctx, "measure")) as "count" | "sum" | "average" | "min" | "max";
    const field = raw(ctx, "field");
    const groupBy = raw(ctx, "groupBy");
    const name = resultName(
      measure,
      measure !== "count" && typeof field === "string" ? field : undefined,
    );
    const results = await ctx.gate.aggregate(
      {
        collection: collectionOf(ctx),
        where,
        measure,
        ...(measure !== "count" && typeof field === "string" ? { field } : {}),
        ...(typeof groupBy === "string" ? { groupBy } : {}),
      },
      values,
    );
    return one(
      results.map((r) => {
        const out: RowOut = { json: {}, label: r.label };
        if (typeof groupBy === "string")
          setField(out, groupBy, { value: r.group ?? null, label: r.label, derived: false });
        setField(out, name, { value: r.value, label: r.label, derived: true });
        return out;
      }),
    );
  },
};

/** The executors of this file, by `executorKey`. */
export const COLLECTION: Readonly<Record<string, Executor>> = {
  "collection.find": find,
  "collection.get": get,
  "collection.create": create,
  "collection.update": update,
  "collection.upsert": upsert,
  "collection.trash": trash,
  "collection.aggregate": aggregate,
};
