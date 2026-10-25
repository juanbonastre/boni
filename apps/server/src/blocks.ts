import type { UserStore } from "@boni/store";
import {
  type BlockResult,
  blockDateField,
  type ChartData,
  computeBlock,
  DATA_BLOCKS,
  type DataBlock,
} from "@boni/views";
import { recordUserRead } from "./audit.ts";

/**
 * The numbers and charts of a page's data blocks (the block catalogue's number, bar list and chart;
 * packages/views catalogue.ts), computed from the user's own collections. A block whose settings are not valid
 * with the data comes back with its problems, never as another chart. Reading them is a read of the rows they
 * count, recorded like a table listed (only the fields used).
 */

export const MAX_BLOCKS = 50;

export class BlocksError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export function computeBlocks(
  store: UserStore,
  body: unknown,
  o: { today: string; device: string; now: number },
): { results: Record<string, BlockResult | { data: ChartData & { computed_at: string } }> } {
  const blocks = (body as { blocks?: unknown } | null)?.blocks;
  if (!Array.isArray(blocks) || blocks.length > MAX_BLOCKS) throw new BlocksError("bad-blocks");
  const types = store.schema().types;
  const cache = new Map<string, ReturnType<UserStore["entities"]>>();
  const rowsOf = (type: string) => {
    if (!cache.has(type)) cache.set(type, store.entities(type));
    return cache.get(type) ?? [];
  };
  const titleOf = (id: string) => {
    const e = store.get(id)?.entity;
    const def = e ? types[e.type] : undefined;
    return e && def ? String(e.values[def.titleField] ?? "") : "";
  };
  const results: Record<string, BlockResult | { data: ChartData & { computed_at: string } }> = {};
  const used = new Map<string, Set<string>>();
  for (const b of blocks) {
    const id = typeof (b as { id?: unknown })?.id === "string" ? (b as { id: string }).id : "";
    if (!id || !(DATA_BLOCKS as readonly unknown[]).includes((b as { type?: unknown }).type))
      throw new BlocksError("bad-blocks");
    const block = b as DataBlock;
    // Boni's own types (pages, proposals…) are not collections the catalogue offers: such a block is refused.
    const out = computeBlock(block, types, rowsOf, { today: o.today, titleOf });
    // When it was computed, as every chart the app shows says.
    results[id] =
      "data" in out ? { data: { ...out.data, computed_at: new Date(o.now).toISOString() } } : out;
    const def = types[block.collection];
    if ("data" in out && def) {
      const fields = used.get(def.id) ?? new Set<string>();
      for (const f of [blockDateField(block, def), block.groupBy, block.field, block.filterField])
        if (f && !f.startsWith("@")) fields.add(f);
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
