import { type Entity, rolesOf, type TypeDef } from "@boni/entities";
import {
  type BlockProblem,
  type CatalogueData,
  type CatalogueRoles,
  catalogueErrors,
} from "./catalogue.ts";
import {
  type ChartData,
  type ChartSpec,
  chartRecords,
  computeChart,
  type Period,
  SpecError,
} from "./chart.ts";
import { entityMonths, entityProfile } from "./entities.ts";
import type { DataBlock } from "./page.ts";
import { type ControlBlock, heldValue, monthRange, refOf } from "./pageValues.ts";

/**
 * A data block of a page (a number, a bar list or a chart; catalogue.ts) computed from one of the user's
 * collections with the chart engine (chart.ts, entities.ts), so it gives the same numbers as any other chart.
 */

const PERIOD: Record<"month" | "30d" | "12m" | "year" | "all", Period> = {
  month: { kind: "this_month" },
  "30d": { kind: "last_days", days: 30 },
  "12m": { kind: "last_months", months: 12 },
  year: { kind: "this_year" },
  all: { kind: "all" },
};
const GRANULARITY = { "@day": "day", "@week": "week", "@month": "month" } as const;

/**
 * The engine's chart for a data block, with the page's values where it names its controls (pageValues.ts): a
 * filter by what an option control holds, a period of a month control's month; an empty control, no filter and
 * every date.
 */
export function blockChartSpec(b: DataBlock, controls: readonly ControlBlock[] = []): ChartSpec {
  const held = (v: string | undefined) => {
    const ref = refOf(v);
    return ref ? heldValue(controls.find((c) => c.id === ref)) : v;
  };
  const filterValue = held(b.filterValue);
  const month = refOf(b.period) ? held(b.period) : undefined;
  const period: Period = refOf(b.period)
    ? typeof month === "string"
      ? { kind: "range", ...monthRange(month) }
      : PERIOD.all
    : PERIOD[(b.period ?? "all") as keyof typeof PERIOD];
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
    period,
    filters:
      b.filterField && filterValue !== undefined
        ? [{ field: b.filterField, op: "in", values: [String(filterValue)] }]
        : [],
    compare: "none",
  };
}

/**
 * The date field a block places rows by: the one it names, else the collection's day (its `date` or `start` role,
 * her mother's when inherited: D-20), else its first date field ("" when it has none).
 */
export function blockDateField(
  b: DataBlock,
  def: TypeDef,
  types: Readonly<Record<string, TypeDef>> = { [def.id]: def },
): string {
  if (b.date) return b.date;
  const roles = rolesOf({ types }, def.id);
  const day = roles.date ?? roles.start;
  if (day) return day;
  return (
    def.fields.find((f) => (f.type === "date" || f.type === "datetime") && !f.archived)?.id ?? ""
  );
}

/**
 * What the catalogue knows of the user's collections, from the store's schema (the user's own types), each with
 * the roles the catalogue uses (its day, its amount, its category; D-20), when their fields are among the shown.
 */
export function catalogueData(
  types: readonly TypeDef[],
  controls: readonly ControlBlock[] = [],
): CatalogueData {
  const schema = { types: Object.fromEntries(types.map((t) => [t.id, t])) };
  return {
    collections: types
      .filter((t) => !t.system && !t.archived)
      .map((t) => {
        const fields = t.fields.filter((f) => !f.hidden && !f.archived);
        const shown = new Set(fields.map((f) => f.id));
        const r = rolesOf(schema, t.id);
        const roles: CatalogueRoles = {};
        const day = r.date ?? r.start;
        if (day && shown.has(day)) roles.date = day;
        if (r.amount && shown.has(r.amount)) roles.amount = r.amount;
        if (r.category && shown.has(r.category)) roles.category = r.category;
        return {
          id: t.id,
          name: t.name,
          fields: fields.map((f) => ({
            id: f.id,
            name: f.name,
            type: f.type,
            ...(f.options ? { options: f.options.map((o) => ({ id: o.id, name: o.name })) } : {}),
            ...(f.relation ? { target: f.relation.target } : {}),
          })),
          ...(Object.keys(roles).length ? { roles } : {}),
        };
      }),
    ...(controls.length
      ? {
          controls: controls.map((c) => ({
            id: c.id,
            name: c.name,
            kind: c.kind,
            ...(c.collection ? { collection: c.collection } : {}),
            ...(c.field ? { field: c.field } : {}),
          })),
        }
      : {}),
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
  o: { today: string; titleOf?: (id: string) => string; controls?: readonly ControlBlock[] },
): BlockResult {
  const controls = o.controls ?? [];
  const problems = catalogueErrors(b, catalogueData(Object.values(types), controls));
  if (problems.length) return { problems };
  const def = types[b.collection] as TypeDef;
  const dateField = blockDateField(b, def, types);
  const rows = entities(def.id);
  try {
    const data = computeChart(
      entityProfile(def, { dateField, ...(o.titleOf ? { titleOf: o.titleOf } : {}) }),
      blockChartSpec(b, controls),
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

/**
 * The rows a data block counts (a click on it: «Lo que cuenta»), from the same selection as its number, so the
 * list always adds up to what the block shows. `drill` narrows it to one point (a bar's or a chart's key).
 */
export function blockRows(
  b: DataBlock,
  types: Readonly<Record<string, TypeDef>>,
  entities: (type: string) => Entity[],
  o: {
    today: string;
    titleOf?: (id: string) => string;
    drill?: string | null;
    controls?: readonly ControlBlock[];
  },
): { rows: Entity[] } | { problems: BlockProblem[] } {
  const controls = o.controls ?? [];
  const problems = catalogueErrors(b, catalogueData(Object.values(types), controls));
  if (problems.length) return { problems };
  const def = types[b.collection] as TypeDef;
  const dateField = blockDateField(b, def, types);
  const all = entities(def.id);
  try {
    const rows = chartRecords(
      entityProfile(def, { dateField, ...(o.titleOf ? { titleOf: o.titleOf } : {}) }),
      blockChartSpec(b, controls),
      all,
      {
        today: o.today,
        monthsWithData: new Set(),
        ...(o.drill !== undefined && b.type !== "number" ? { drill: o.drill } : {}),
      },
    );
    return { rows };
  } catch (e) {
    if (e instanceof SpecError)
      return { problems: [{ block: b.id, key: "", code: "bad", value: e.message }] };
    throw e;
  }
}
