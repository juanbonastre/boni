import type { Entity, TypeDef } from "@boni/entities";
import { type BlockProblem, type CatalogueData, catalogueErrors } from "./catalogue.ts";
import { type ChartData, type ChartSpec, computeChart, type Period, SpecError } from "./chart.ts";
import { entityMonths, entityProfile } from "./entities.ts";
import type { DataBlock } from "./page.ts";

/**
 * A data block of a page (a number, a bar list or a chart; catalogue.ts) computed from one of the user's
 * collections with the chart engine (chart.ts, entities.ts), so it gives the same numbers as any other chart.
 */

const PERIOD: Record<NonNullable<DataBlock["period"]>, Period> = {
  month: { kind: "this_month" },
  "30d": { kind: "last_days", days: 30 },
  "12m": { kind: "last_months", months: 12 },
  year: { kind: "this_year" },
  all: { kind: "all" },
};
const GRANULARITY = { "@day": "day", "@week": "week", "@month": "month" } as const;

/** The engine's chart for a data block. */
export function blockChartSpec(b: DataBlock): ChartSpec {
  const measure =
    !b.measure || b.measure === "count" || !b.field ? "count" : `${b.measure}:${b.field}`;
  const time =
    b.groupBy && b.groupBy in GRANULARITY
      ? GRANULARITY[b.groupBy as keyof typeof GRANULARITY]
      : null;
  return {
    title: b.title || "—",
    kind: b.type === "number" ? "number" : b.type === "bars" ? "hbar" : (b.shape ?? "bar"),
    measure,
    x:
      b.type === "number" || !b.groupBy
        ? null
        : time
          ? { field: "date", granularity: time }
          : { field: b.groupBy },
    period: PERIOD[b.period ?? "all"],
    filters:
      b.filterField && b.filterValue
        ? [{ field: b.filterField, op: "in", values: [b.filterValue] }]
        : [],
    compare: "none",
  };
}

/** The date field a block places rows by: the one it names, or the collection's first ("" when it has none). */
export function blockDateField(b: DataBlock, def: TypeDef): string {
  if (b.date) return b.date;
  return (
    def.fields.find((f) => (f.type === "date" || f.type === "datetime") && !f.archived)?.id ?? ""
  );
}

/** What the catalogue knows of the user's collections, from the store's schema (the user's own types). */
export function catalogueData(types: readonly TypeDef[]): CatalogueData {
  return {
    collections: types
      .filter((t) => !t.system && !t.archived)
      .map((t) => ({
        id: t.id,
        name: t.name,
        fields: t.fields
          .filter((f) => !f.hidden && !f.archived)
          .map((f) => ({
            id: f.id,
            name: f.name,
            type: f.type,
            ...(f.options ? { options: f.options.map((o) => ({ id: o.id, name: o.name })) } : {}),
          })),
      })),
  };
}

export type BlockResult = { data: ChartData } | { problems: BlockProblem[] };

/**
 * A data block's numbers, or what is wrong with it (a setting that is not valid, or no longer is: a field
 * removed, an option renamed away). Never another chart in its place.
 */
export function computeBlock(
  b: DataBlock,
  types: Readonly<Record<string, TypeDef>>,
  entities: (type: string) => Entity[],
  o: { today: string; titleOf?: (id: string) => string },
): BlockResult {
  const problems = catalogueErrors(b, catalogueData(Object.values(types)));
  if (problems.length) return { problems };
  // Boni's own numbers are the app's (from its models and audit), not a collection's.
  if (b.from === "boni")
    return { problems: [{ block: b.id, key: "from", code: "not-allowed", value: "boni" }] };
  const def = types[b.collection ?? ""] as TypeDef;
  const dateField = blockDateField(b, def);
  const rows = entities(def.id);
  try {
    const data = computeChart(
      entityProfile(def, { dateField, ...(o.titleOf ? { titleOf: o.titleOf } : {}) }),
      blockChartSpec(b),
      rows,
      { today: o.today, monthsWithData: dateField ? entityMonths(rows, dateField) : new Set() },
    );
    return { data };
  } catch (e) {
    // The catalogue offers nothing the engine refuses; if it ever does, the block says so.
    if (e instanceof SpecError)
      return { problems: [{ block: b.id, key: "", code: "bad", value: e.message }] };
    throw e;
  }
}
