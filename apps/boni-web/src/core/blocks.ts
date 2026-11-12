import type {
  BlockProblem,
  CatalogueControl,
  CatalogueData,
  CatalogueFlow,
  PageBlock,
} from "@boni/views";
import type { ChartData } from "./contract.ts";

/** The flows a button may start (D-60): the ones run by hand with a form, each with its form's names. */
export function buttonFlows(
  flows: readonly { id: string; name: string; trigger: Record<string, unknown> | null }[],
): CatalogueFlow[] {
  return flows
    .filter((f) => f.trigger?.manual === true)
    .map((f) => ({
      value: f.id,
      label: f.name,
      inputs: (Array.isArray(f.trigger?.inputs) ? f.trigger.inputs : []).flatMap((i: unknown) =>
        i && typeof i === "object" && typeof (i as { name?: unknown }).name === "string"
          ? [(i as { name: string }).name]
          : [],
      ),
    }));
}

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
          relation?: { target: string };
        }[];
        roles?: Readonly<Record<string, string>>;
      }[]
    | null,
  pages: readonly { id: string; title: string }[] | null = [],
  /** The page's controls: what its blocks may name (D-59). */
  controls: readonly CatalogueControl[] = [],
  /** The flows a button may start (D-60): those run by hand, with their form's names. */
  flows: readonly CatalogueFlow[] | null = null,
): CatalogueData {
  // The roles the catalogue uses (D-20), when their fields are among the shown.
  const rolesOf = (t: {
    fields: readonly { id: string }[];
    roles?: Readonly<Record<string, string>>;
  }) => {
    const has = (id: string | undefined) =>
      id && t.fields.some((f) => f.id === id) ? id : undefined;
    const day = has(t.roles?.date) ?? has(t.roles?.start);
    const amount = has(t.roles?.amount);
    const category = has(t.roles?.category);
    return day || amount || category
      ? {
          roles: {
            ...(day ? { date: day } : {}),
            ...(amount ? { amount } : {}),
            ...(category ? { category } : {}),
          },
        }
      : {};
  };
  return {
    pages: (pages ?? []).map((p) => ({ value: p.id, label: p.title })),
    ...(flows ? { flows: [...flows] } : {}),
    ...(controls.length
      ? {
          controls: controls.map(({ id, name, kind, collection, field }) => ({
            id,
            name,
            kind,
            ...(collection ? { collection } : {}),
            ...(field ? { field } : {}),
          })),
        }
      : {}),
    collections: (types ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      ...rolesOf(t),
      fields: t.fields.map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type as FieldType,
        ...(f.options ? { options: f.options.map((o) => ({ id: o.id, name: o.name })) } : {}),
        ...(f.relation ? { target: f.relation.target } : {}),
      })),
    })),
  };
}
