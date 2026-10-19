import type { Entity, FieldDef, TypeDef } from "@boni/entities";
import { type Profile, timeKey } from "./chart.ts";
import type { Day } from "./dates.ts";
import { pySum } from "./pyround.ts";

/**
 * The chart engine over any entity type (docs/nucleo.md, 8): a profile built from the type's schema.
 * The X axis or a split can be any field (a select by its options, a relation by the titles it points
 * to, multi-valued fields count once per value); the date field chosen is the time axis. Measures:
 * `count`, `sum:<field>` and `avg:<field>` over a number field (a money field by its amount).
 * Money movements keep their own profile (money.ts): "spending" is more than a sum.
 */

export interface EntityProfileOptions {
  /** The date (or datetime) field that places an entity in time. */
  dateField: string;
  /** Titles of related entities, for labels ("" when unknown). */
  titleOf?: (id: string) => string;
}

const asDay = (v: unknown): Day | null =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;

function numberOf(f: FieldDef | undefined, v: unknown): number | null {
  if (!f) return null;
  if (f.type === "number" || f.type === "duration") return typeof v === "number" ? v : null;
  if (f.type === "money" && v && typeof v === "object" && "amount" in v)
    return (v as { amount: number }).amount;
  return null;
}

export function entityProfile(def: TypeDef, o: EntityProfileOptions): Profile<Entity> {
  const field = (id: string) => def.fields.find((f) => f.id === id);
  const isNumber = (id: string) => ["number", "money", "duration"].includes(field(id)?.type ?? "");
  const parseMeasure = (m: string): [string, FieldDef | undefined] => {
    const [fn = "count", id = ""] = m.split(":");
    return [fn, field(id)];
  };
  return {
    day: (e) => asDay(e.values[o.dateField]) ?? "0000-01-01",
    values(e, id) {
      if (id === "date") return [asDay(e.values[o.dateField]) ?? ""];
      const v = e.values[id];
      if (v === null || v === undefined || v === "") return [""];
      if (Array.isArray(v)) return v.length ? v.map(String) : [""];
      if (typeof v === "object") return [String((v as { amount?: number }).amount ?? "")];
      return [String(v)];
    },
    folded: new Set(def.fields.filter((f) => f.type === "text").map((f) => f.id)),
    pathLike: new Set(),
    number: (e, id) => numberOf(field(id), e.values[id]),
    isNumber,
    labeler(id) {
      const f = field(id);
      return (k) => {
        if (!k) return "(vacío)";
        if (f?.options) return f.options.find((x) => x.id === k)?.name ?? k;
        if (f?.type === "relation") return o.titleOf?.(k) || k;
        return k;
      };
    },
    measure(m, recs) {
      const [fn, f] = parseMeasure(m);
      if (fn === "count" || !f) return recs.length;
      const nums = recs
        .map((e) => numberOf(f, e.values[f.id]))
        .filter((n): n is number => n !== null);
      const total = pySum(nums);
      return fn === "avg" ? (nums.length ? total / nums.length : 0) : total;
    },
    relevant(e, m) {
      if (e.deleted !== undefined || asDay(e.values[o.dateField]) === null) return false;
      const [fn, f] = parseMeasure(m);
      return fn === "count" || !f || numberOf(f, e.values[f.id]) !== null;
    },
    unit: (m) => {
      const [fn, f] = parseMeasure(m);
      return fn !== "count" && f?.type === "money" ? "EUR" : "";
    },
    allStart: "2000-01-01",
    isAverage: (m) => m.startsWith("avg:"),
  };
}

/** Months ("YYYY-MM") that have any entity, for the engine's gaps. */
export const entityMonths = (entities: Entity[], dateField: string) =>
  new Set(
    entities
      .map((e) => asDay(e.values[dateField]))
      .filter((d): d is Day => d !== null)
      .map((d) => timeKey(d, "month")),
  );
