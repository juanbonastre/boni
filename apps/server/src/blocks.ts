import type { UserStore } from "@boni/store";
import {
  type BlockResult,
  blockDateField,
  blockRows,
  type ChartData,
  type ControlBlock,
  catalogueErrors,
  computeBlock,
  DATA_BLOCKS,
  type DataBlock,
  type DatabaseView,
  filterErrors,
  tableRows,
} from "@boni/views";
import { recordUserRead, systemColumns } from "./audit.ts";
import { asShown, ghostRows, userTypes } from "./data.ts";
import { isSystemCollection, type SystemCollections } from "./systemCollections.ts";

/**
 * The numbers and charts of a page's data blocks (the block catalogue's number, bar list and chart;
 * packages/views catalogue.ts), computed from the user's own collections. A block whose settings are not valid
 * with the data comes back with its problems, never as another chart. Reading them is a read of the rows they
 * count, recorded like a table listed (only the fields used). Boni's own records (systemCollections.ts) are counted
 * like any collection; reading them is not recorded (the activity would count itself).
 */

export const MAX_BLOCKS = 50;
/** At most so many of a block's rows are listed (the latest); `total` says how many it counts. */
const ROWS_LIMIT = 2000;

export class BlocksError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/** Boni's own records, made only when a block names one of them (two reads of the journal and the audit). */
type Sys = () => SystemCollections;

/** The user's types (with Boni's own records when `blocks` name them), the rows of either, and a row's title. */
function sources(store: UserStore, blocks: readonly unknown[], getSys: Sys | undefined) {
  const named = blocks.some((b) =>
    isSystemCollection(String((b as { collection?: unknown } | null)?.collection ?? "")),
  );
  const sys = named ? getSys?.() : undefined;
  const types = { ...store.schema().types, ...(sys?.types ?? {}) };
  const cache = new Map<string, ReturnType<UserStore["entities"]>>();
  const rowsOf = (type: string) => {
    // A collection's numbers count her daughters' records too (docs/clases.md §2.3).
    if (!cache.has(type))
      cache.set(type, sys?.types[type] ? sys.rows(type) : store.entities(type, { deep: true }));
    return cache.get(type) ?? [];
  };
  const titleOf = (id: string) => {
    const e = store.get(id)?.entity;
    const def = e ? types[e.type] : undefined;
    return e && def ? String(e.values[def.titleField] ?? "") : "";
  };
  return { types, rowsOf, titleOf };
}

/**
 * The page's controls a request brings with its blocks (docs/sistema.md §4.6, D-59): what the blocks' `$<id>` stand
 * for. The app sends them as the page holds them; the server checks their shape and computes with them, so the
 * numbers are the store's, never the app's.
 */
function controlsIn(body: unknown, code: string): ControlBlock[] {
  const cs = (body as { controls?: unknown } | null)?.controls;
  if (cs === undefined) return [];
  if (
    !Array.isArray(cs) ||
    cs.length > MAX_BLOCKS ||
    !cs.every(
      (c) =>
        (c as { type?: unknown } | null)?.type === "control" && catalogueErrors(c).length === 0,
    )
  )
    throw new BlocksError(code);
  return cs as ControlBlock[];
}

const fieldsUsed = (
  block: DataBlock,
  def: Parameters<typeof blockDateField>[1],
  types: Parameters<typeof blockDateField>[2],
) =>
  [blockDateField(block, def, types), block.groupBy, block.field, block.filterField].filter(
    (f): f is string => !!f && !f.startsWith("@"),
  );

export function computeBlocks(
  store: UserStore,
  body: unknown,
  o: { today: string; device: string; now: number; sys?: Sys },
): { results: Record<string, BlockResult | { data: ChartData & { computed_at: string } }> } {
  const blocks = (body as { blocks?: unknown } | null)?.blocks;
  if (!Array.isArray(blocks) || blocks.length > MAX_BLOCKS) throw new BlocksError("bad-blocks");
  const controls = controlsIn(body, "bad-blocks");
  const { types, rowsOf, titleOf } = sources(store, blocks, o.sys);
  const results: Record<string, BlockResult | { data: ChartData & { computed_at: string } }> = {};
  const used = new Map<string, Set<string>>();
  for (const b of blocks) {
    const id = typeof (b as { id?: unknown })?.id === "string" ? (b as { id: string }).id : "";
    if (!id || !(DATA_BLOCKS as readonly unknown[]).includes((b as { type?: unknown }).type))
      throw new BlocksError("bad-blocks");
    const block = b as DataBlock;
    // Boni's own types (pages, proposals…) are not collections the catalogue offers: such a block is refused.
    const out = computeBlock(block, types, rowsOf, { today: o.today, titleOf, controls });
    // When it was computed, as every chart the app shows says.
    results[id] =
      "data" in out ? { data: { ...out.data, computed_at: new Date(o.now).toISOString() } } : out;
    const def = block.collection ? types[block.collection] : undefined;
    if ("data" in out && def && !isSystemCollection(def.id)) {
      const fields = used.get(def.id) ?? new Set<string>();
      for (const f of fieldsUsed(block, def, types)) fields.add(f);
      used.set(def.id, fields);
    }
  }
  for (const [type, fields] of used)
    recordUserRead(
      store,
      o.device,
      "data.blocks",
      type,
      rowsOf(type).map((e) => e.id),
      false,
      o.now,
      [...fields],
    );
  return { results };
}

/**
 * The rows one data block counts (`POST /api/data/blocks/rows`, a click on it: «Lo que cuenta»), narrowed to a
 * point when `drill` names one; as the collection's table shows them (the latest first, at most `ROWS_LIMIT`), with
 * the system columns. A read of those rows, recorded like the block's. A page's table (a «database» block) is
 * answered the same way, with the rows its rules pick (`tableRowsOf`).
 */
export function blockRowsOf(
  store: UserStore,
  body: unknown,
  o: { today: string; device: string; now: number; sys?: Sys },
) {
  const b = (body as { block?: unknown; drill?: unknown } | null) ?? {};
  if ((b.block as { type?: unknown } | null)?.type === "database")
    return tableRowsOf(store, b.block as Record<string, unknown>, controlsIn(body, "bad-block"), o);
  const block = b.block as DataBlock | undefined;
  const drill = typeof b.drill === "string" && b.drill.length <= 200 ? b.drill : undefined;
  if (
    !block ||
    typeof block !== "object" ||
    typeof block.id !== "string" ||
    !(DATA_BLOCKS as readonly unknown[]).includes(block.type)
  )
    throw new BlocksError("bad-block");
  const controls = controlsIn(body, "bad-block");
  const { types, rowsOf, titleOf } = sources(store, [block], o.sys);
  const out = blockRows(block, types, rowsOf, {
    today: o.today,
    titleOf,
    drill: drill ?? null,
    controls,
  });
  if ("problems" in out) return { problems: out.problems };
  const def = types[block.collection ?? ""];
  if (!def) throw new BlocksError("bad-block");
  const latest = [...out.rows].sort((x, y) => y.updated - x.updated).slice(0, ROWS_LIMIT);
  const { rows, titles } = asShown(store, def, latest);
  if (!isSystemCollection(def.id))
    recordUserRead(
      store,
      o.device,
      "data.blocks.rows",
      def.id,
      rows.map((r) => r.id),
      false,
      o.now,
      fieldsUsed(block, def, types),
    );
  return {
    type: def.id,
    rows,
    total: out.rows.length,
    titles,
    columns: isSystemCollection(def.id)
      ? {}
      : systemColumns(
          store,
          rows.map((r) => r.id),
        ),
  };
}

/**
 * A page's table's rows, picked by the server (docs/sistema.md §4.6, point 3; task 102): its view's rules with what
 * the page's controls hold, over every record of its collection (her daughters' too), never the app's copy; the
 * latest first, at most `ROWS_LIMIT`, `total` how many match, with the collection's proposals (its ghost rows, as
 * the collection's table has them) and the system columns. Only the user's collections: Boni's own are listed by
 * their areas. A read of the rows sent, recorded as a table listed.
 */
function tableRowsOf(
  store: UserStore,
  block: Record<string, unknown>,
  controls: readonly ControlBlock[],
  o: { today: string; device: string; now: number },
) {
  const source = typeof block.source === "string" ? block.source : "";
  const view = block.view as Partial<DatabaseView> | undefined;
  const filter = view?.filter ?? [];
  const def = isSystemCollection(source)
    ? undefined
    : userTypes(store).find((t) => t.id === source);
  if (typeof block.id !== "string" || !def || filterErrors(filter, true).length)
    throw new BlocksError("bad-block");
  const picked = tableRows(store.entities(source, { deep: true }), def, filter, {
    today: o.today,
    controls,
  });
  const latest = picked.sort((x, y) => y.updated - x.updated).slice(0, ROWS_LIMIT);
  const { rows, titles } = asShown(store, def, latest);
  const ids = rows.map((r) => r.id);
  recordUserRead(store, o.device, "data.rows", def.id, ids, false, o.now);
  return {
    type: def.id,
    rows,
    total: picked.length,
    truncated: picked.length > rows.length,
    titles,
    ghosts: ghostRows(store, source),
    columns: systemColumns(store, ids),
  };
}
