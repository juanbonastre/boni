import type { BlockProblem, CatalogueData, PageBlock } from "@boni/views";
import type { ChartData } from "./contract.ts";

/**
 * A page's data blocks (the block catalogue's number, bar list and chart) as the server computes them
 * (`POST /api/data/blocks`): each block's numbers, or what is wrong with it, said in the block itself.
 */

type FieldType = CatalogueData["collections"][number]["fields"][number]["type"];

export type BlockResult = { data: ChartData } | { problems: BlockProblem[] };
/** A number, a bar list or a chart of a page, with its place on the grid. */
export type DataBlock = Extract<PageBlock, { type: "number" | "bars" | "graph" }>;
export const isDataBlock = (b: PageBlock): b is DataBlock =>
  b.type === "number" || b.type === "bars" || b.type === "graph";

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const CODES = new Set(["missing", "bad", "not-allowed", "not-in-data"]);

export function parseBlockResults(b: unknown): Record<string, BlockResult> {
  const out: Record<string, BlockResult> = {};
  const results = isObj(b) && isObj(b.results) ? b.results : {};
  for (const [id, r] of Object.entries(results)) {
    if (!isObj(r)) continue;
    if (isObj(r.data) && Array.isArray(r.data.series))
      out[id] = { data: r.data as unknown as ChartData };
    else if (Array.isArray(r.problems))
      out[id] = {
        problems: r.problems.filter(
          (p): p is BlockProblem =>
            isObj(p) && typeof p.key === "string" && CODES.has(String(p.code)),
        ),
      };
  }
  return out;
}

/** What the catalogue needs of the user's collections, from the app's list of them. */
export function catalogueOf(
  types:
    | readonly {
        id: string;
        name: string;
        fields: readonly {
          id: string;
          name: string;
          type: string;
          options?: { id: string; name: string }[];
        }[];
      }[]
    | null,
  pages: readonly { id: string; title: string }[] | null = [],
): CatalogueData {
  return {
    pages: (pages ?? []).map((p) => ({ value: p.id, label: p.title })),
    collections: (types ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      fields: t.fields.map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type as FieldType,
        ...(f.options ? { options: f.options.map((o) => ({ id: o.id, name: o.name })) } : {}),
      })),
    })),
  };
}
