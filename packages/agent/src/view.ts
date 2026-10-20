import { plannerMaySee, type Schema } from "@boni/entities";
import type { Json, Val } from "./values.ts";

/**
 * The only way into the planner's context (docs/nucleo.md, 7.3): whatever it may not see (external
 * or ambient) becomes an opaque handle with the value's shape ("text, 120 characters, external") and
 * the path to use it in a plan. Tool results, the schema's names, the history of the conversation and
 * the memories all go through here; error messages never carry data at all (fixed codes).
 */
export interface Handle {
  $handle: string;
  kind: "text" | "number" | "boolean" | "list" | "record" | "null" | "value";
  integrity: string;
  size?: number;
  fields?: string[];
}

function shape(v: Val): Pick<Handle, "kind" | "size" | "fields"> {
  if (v.t === "list") return { kind: "list", size: v.items.length };
  if (v.t === "rec") return { kind: "record", fields: Object.keys(v.fields) };
  const x = v.value;
  if (typeof x === "string") return { kind: "text", size: [...x].length };
  if (typeof x === "number") return { kind: "number" };
  if (typeof x === "boolean") return { kind: "boolean" };
  if (x === null) return { kind: "null" };
  return { kind: "value" };
}

export function toPlannerView(v: Val, path: string): Json {
  if (!plannerMaySee(v.label))
    return { $handle: path, integrity: v.label.integrity, ...shape(v) } as unknown as Json;
  if (v.t === "v") return v.value;
  if (v.t === "list") return v.items.map((item, i) => toPlannerView(item, `${path}[${i}]`));
  return Object.fromEntries(
    Object.entries(v.fields).map(([k, f]) => [k, toPlannerView(f, `${path}.${k}`)]),
  );
}

/** The user's types as the planner sees them: names it may not see are left out (their ids stay). */
export function schemaView(schema: Schema): Json {
  return Object.values(schema.types)
    .filter((t) => !t.system && !t.archived)
    .map((t) => ({
      key: plannerMaySee(t.label) ? t.key : `type_${t.id}`,
      ...(plannerMaySee(t.label) ? { name: t.name } : {}),
      fields: t.fields
        .filter((f) => !f.hidden && !f.archived)
        .map((f) => ({
          key: plannerMaySee(f.label) ? f.key : `field_${f.id}`,
          ...(plannerMaySee(f.label) ? { name: f.name } : {}),
          type: f.type,
          ...(f.options
            ? {
                options: f.options.map((o) =>
                  plannerMaySee(o.label) ? { id: o.id, name: o.name } : { id: o.id },
                ),
              }
            : {}),
        })),
    })) as unknown as Json;
}
