/**
 * The JSON Schema subset an extension's functions describe their input and output with (docs/extensiones.md §11.6):
 * types, objects with their properties, lists, a closed set of values, bounds. No `pattern`: a regular expression
 * from a manifest would run on Boni's side, and a slow one could stall it.
 */

export type SchemaType = "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";

export interface Schema {
  type?: SchemaType | SchemaType[];
  properties?: Record<string, Schema>;
  required?: string[];
  /** Other keys allowed (true, the default), refused (false) or each as this schema. */
  additionalProperties?: boolean | Schema;
  items?: Schema;
  enum?: (string | number | boolean | null)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  /** One of these. */
  anyOf?: Schema[];
}

const TYPES = new Set<SchemaType>([
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
  "null",
]);
const KEYS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "anyOf",
  "description",
  "title",
]);
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** What is wrong with a schema itself (a manifest's), empty when it is one this subset reads; `depth` stops a loop. */
export function schemaShapeErrors(s: unknown, path = "$", depth = 0): string[] {
  if (depth > 32) return [`${path}: demasiado anidado`];
  if (!isObj(s)) return [`${path}: no es un esquema`];
  const out: string[] = [];
  for (const k of Object.keys(s)) if (!KEYS.has(k)) out.push(`${path}: «${k}» no se admite`);
  const types = s.type === undefined ? [] : Array.isArray(s.type) ? s.type : [s.type];
  for (const t of types) if (!TYPES.has(t as SchemaType)) out.push(`${path}: tipo «${String(t)}»`);
  if (s.properties !== undefined) {
    if (!isObj(s.properties)) out.push(`${path}.properties: no es un objeto`);
    else
      for (const [k, v] of Object.entries(s.properties))
        out.push(...schemaShapeErrors(v, `${path}.${k}`, depth + 1));
  }
  if (
    s.required !== undefined &&
    (!Array.isArray(s.required) || s.required.some((x) => typeof x !== "string"))
  )
    out.push(`${path}.required: una lista de nombres`);
  if (isObj(s.additionalProperties))
    out.push(...schemaShapeErrors(s.additionalProperties, `${path}.*`, depth + 1));
  else if (s.additionalProperties !== undefined && typeof s.additionalProperties !== "boolean")
    out.push(`${path}.additionalProperties: sí, no o un esquema`);
  if (s.items !== undefined) out.push(...schemaShapeErrors(s.items, `${path}[]`, depth + 1));
  if (
    s.enum !== undefined &&
    (!Array.isArray(s.enum) || s.enum.some((x) => x !== null && typeof x === "object"))
  )
    out.push(`${path}.enum: una lista de valores sencillos`);
  for (const k of ["minimum", "maximum"] as const)
    if (s[k] !== undefined && typeof s[k] !== "number") out.push(`${path}.${k}: un número`);
  for (const k of ["minLength", "maxLength", "minItems", "maxItems"] as const)
    if (s[k] !== undefined && !isCount(s[k])) out.push(`${path}.${k}: un entero desde 0`);
  if (s.anyOf !== undefined) {
    if (!Array.isArray(s.anyOf) || !s.anyOf.length) out.push(`${path}.anyOf: una lista`);
    else
      for (const [i, x] of s.anyOf.entries())
        out.push(...schemaShapeErrors(x, `${path}|${i}`, depth + 1));
  }
  return out;
}

const typeOf = (v: unknown): SchemaType | "other" =>
  v === null
    ? "null"
    : Array.isArray(v)
      ? "array"
      : typeof v === "string"
        ? "string"
        : typeof v === "boolean"
          ? "boolean"
          : typeof v === "number" && Number.isFinite(v)
            ? "number"
            : typeof v === "object"
              ? "object"
              : "other";

/** Where `value` does not fit `schema` (at most `max` of them), empty when it fits. */
export function schemaErrors(schema: Schema, value: unknown, path = "$", max = 20): string[] {
  const out: string[] = [];
  check(schema, value, path, out, max, 0);
  return out;
}

function check(s: Schema, v: unknown, path: string, out: string[], max: number, depth: number) {
  if (out.length >= max) return;
  if (depth > 64) {
    out.push(`${path}: demasiado anidado`);
    return;
  }
  if (s.anyOf) {
    if (!s.anyOf.some((x) => schemaErrors(x, v, path, 1).length === 0))
      out.push(`${path}: no encaja en ninguna de las opciones`);
    return;
  }
  const t = typeOf(v);
  if (s.type !== undefined) {
    const want = Array.isArray(s.type) ? s.type : [s.type];
    const fits = want.some(
      (w) =>
        w === t ||
        (w === "number" && t === "number") ||
        (w === "integer" && t === "number" && Number.isInteger(v)),
    );
    if (!fits) {
      out.push(`${path}: se esperaba ${want.join(" o ")}`);
      return;
    }
  } else if (t === "other") {
    out.push(`${path}: no es un valor JSON`);
    return;
  }
  if (s.enum && !s.enum.some((x) => x === v)) out.push(`${path}: valor no admitido`);
  if (t === "number") {
    const n = v as number;
    if (s.minimum !== undefined && n < s.minimum) out.push(`${path}: menor que ${s.minimum}`);
    if (s.maximum !== undefined && n > s.maximum) out.push(`${path}: mayor que ${s.maximum}`);
  }
  if (t === "string") {
    const n = (v as string).length;
    if (s.minLength !== undefined && n < s.minLength) out.push(`${path}: demasiado corto`);
    if (s.maxLength !== undefined && n > s.maxLength) out.push(`${path}: demasiado largo`);
  }
  if (t === "array") {
    const list = v as unknown[];
    if (s.minItems !== undefined && list.length < s.minItems) out.push(`${path}: pocos elementos`);
    if (s.maxItems !== undefined && list.length > s.maxItems)
      out.push(`${path}: demasiados elementos`);
    if (s.items)
      for (let i = 0; i < list.length && out.length < max; i++)
        check(s.items, list[i], `${path}[${i}]`, out, max, depth + 1);
  }
  if (t === "object") {
    const o = v as Record<string, unknown>;
    for (const k of s.required ?? []) if (!Object.hasOwn(o, k)) out.push(`${path}.${k}: falta`);
    for (const [k, x] of Object.entries(o)) {
      if (out.length >= max) break;
      const own = s.properties && Object.hasOwn(s.properties, k) ? s.properties[k] : undefined;
      if (own) check(own, x, `${path}.${k}`, out, max, depth + 1);
      else if (s.additionalProperties === false) out.push(`${path}.${k}: no se admite`);
      else if (typeof s.additionalProperties === "object")
        check(s.additionalProperties, x, `${path}.${k}`, out, max, depth + 1);
    }
  }
}
