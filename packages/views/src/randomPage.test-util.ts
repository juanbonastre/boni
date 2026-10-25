import type { Entity, FieldDef, FieldType, TypeDef } from "@boni/entities";
import { label } from "@boni/entities";
import { catalogueData } from "./blockData.ts";
import {
  applies,
  CATALOGUE,
  type CatalogueData,
  HEIGHTS,
  optionsOf,
  type Place,
  WIDTHS,
} from "./catalogue.ts";
import type { PageSpec } from "./page.ts";

/**
 * Random users' collections and random pages built only from the block catalogue, for property tests (like
 * packages/agent's random plans): whatever the catalogue lets anyone build must be valid and must compute.
 * Seeded: a failing seed repeats exactly. Data is invented, with the worst cases a user can have (long names,
 * accents, an empty collection, one with no date field, one with no number field).
 */

export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)] as T;
  return { next, int, pick };
}
export type Rng = ReturnType<typeof rng>;

const L = label("user", "personal", []);
const NAMES = [
  "Movimientos",
  "Libros",
  "Clases",
  "Correos",
  "Facturas de proveedores y gastos deducibles del trimestre",
  "Ñandúes",
  "日記",
  "X",
];
const FIELD_NAMES = [
  "Importe",
  "Categoría",
  "Fecha",
  "Estado",
  "Autor",
  "Páginas",
  "Horas",
  "Tipo de gasto según la gestoría",
];
const OPTION_NAMES = [
  "Leído",
  "Pendiente",
  "Comer fuera",
  "Supermercado",
  "Café ☕",
  "Una opción con un nombre muy largo de verdad",
  "A",
];
const TYPES: FieldType[] = [
  "text",
  "number",
  "money",
  "select",
  "multiselect",
  "date",
  "datetime",
  "checkbox",
  "duration",
];

/** A user's collections: 1-4 types with random fields, sometimes without a date or a number. */
export function randomTypes(r: Rng): TypeDef[] {
  const n = 1 + r.int(4);
  return Array.from({ length: n }, (_, t) => {
    const fields: FieldDef[] = [
      { id: "f_titulo", key: "titulo", name: "Título", type: "text", label: L },
    ];
    const m = r.int(6);
    for (let i = 0; i < m; i++) {
      const type = r.pick(TYPES);
      const id = `f_${t}_${i}`;
      fields.push({
        id,
        key: `c${i}`,
        name: `${r.pick(FIELD_NAMES)}${i ? ` ${i}` : ""}`,
        type,
        ...(type === "select" || type === "multiselect"
          ? {
              options: Array.from({ length: 1 + r.int(5) }, (_, k) => ({
                id: `o_${t}_${i}_${k}`,
                name: OPTION_NAMES[k % OPTION_NAMES.length] as string,
                label: L,
              })),
            }
          : {}),
        label: L,
      });
    }
    return {
      id: `t_${t}`,
      key: `tipo${t}`,
      name: r.pick(NAMES),
      fields,
      titleField: "f_titulo",
      sensitivity: "personal",
      schemaVersion: 1,
      label: L,
    };
  });
}

const day = (r: Rng) => {
  const ms = Date.UTC(2025, 0, 1) + r.int(700) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
};

/** Rows of a type: none, one or many, with empty values among them. */
export function randomEntities(r: Rng, def: TypeDef): Entity[] {
  const n = r.pick([0, 1, 3, 40, 300]);
  return Array.from({ length: n }, (_, i) => {
    const values: Entity["values"] = { f_titulo: `Fila ${i}` };
    for (const f of def.fields.slice(1)) {
      if (r.next() < 0.15) continue;
      if (f.type === "number" || f.type === "duration")
        values[f.id] = r.pick([0, 1, 2.5, -40, 1234567.89]);
      else if (f.type === "money")
        values[f.id] = { amount: r.pick([0.5, 12, -3, 4999.99]), currency: "EUR" };
      else if (f.type === "select") values[f.id] = r.pick(f.options ?? []).id;
      else if (f.type === "multiselect")
        values[f.id] = (f.options ?? []).filter(() => r.next() < 0.4).map((o) => o.id);
      else if (f.type === "date") values[f.id] = day(r);
      else if (f.type === "datetime") values[f.id] = `${day(r)}T10:30:00Z`;
      else if (f.type === "checkbox") values[f.id] = r.next() < 0.5;
      else values[f.id] = r.pick(["", "texto", "Un texto bastante más largo que los demás"]);
    }
    return { id: `e_${def.id}_${i}`, type: def.id, values, created: 0, updated: 0, version: 1 };
  });
}

/**
 * A block of a random kind, every setting chosen from what the catalogue offers for it, in its order. A kind
 * that the chosen collection cannot fill (a bar list of a collection with no select field) is tried again.
 */
export function randomBlock(r: Rng, id: string, data: CatalogueData): Record<string, unknown> {
  for (let i = 0; i < 8; i++) {
    const b = tryBlock(r, id, data);
    if (b) return b;
  }
  return { id, type: "heading", text: "Título" };
}

function tryBlock(r: Rng, id: string, data: CatalogueData): Record<string, unknown> | null {
  const kinds = data.collections.length
    ? CATALOGUE
    : CATALOGUE.filter((k) => !k.settings.some((s) => s.key === "collection"));
  const kind = r.pick(kinds);
  const b: Record<string, unknown> = { id, type: kind.type };
  for (const s of kind.settings) {
    if (!applies(s, b)) continue;
    if (s.optional && r.next() < 0.5) continue;
    if (s.type === "text") {
      b[s.key] = r.pick([
        "Gasto del mes",
        "Ñ",
        "Lo que llevo leído este año en novelas y ensayos",
        s.empty ? "" : "x",
      ]);
      continue;
    }
    if (s.type === "toggle") {
      b[s.key] = r.next() < 0.5;
      continue;
    }
    const opts = optionsOf(s, b, data);
    if (!opts.length) {
      // Nothing to choose from (a collection without a number field): the block counts rows instead.
      if (s.key === "field") {
        b.measure = "count";
        continue;
      }
      if (s.optional) continue;
      return null;
    }
    b[s.key] = r.pick(opts).value;
  }
  return b;
}

/** A page of random blocks, some in rows of columns (widths adding up to at most 12), some on their own. */
export function randomPage(r: Rng, data: CatalogueData): PageSpec {
  const blocks: Record<string, unknown>[] = [];
  const rows = 1 + r.int(5);
  let n = 0;
  for (let i = 0; i < rows; i++) {
    if (r.next() < 0.3) {
      blocks.push(randomBlock(r, `b${n++}`, data));
      continue;
    }
    let left = 12;
    let col = 0;
    while (left > 0 && col < 4) {
      const fits = WIDTHS.map((w) => w.value as number).filter((w) => w <= left);
      if (!fits.length) break;
      const w = r.pick(fits);
      const stack = 1 + r.int(3);
      for (let k = 0; k < stack; k++) {
        const b = randomBlock(r, `b${n++}`, data);
        const at: Place = { row: `r${i}`, col, w };
        if (b.type === "graph") at.h = r.pick(HEIGHTS).value as Place["h"];
        blocks.push({ ...b, at });
      }
      left -= w;
      col++;
      if (r.next() < 0.3) break;
    }
  }
  return { version: 1, blocks: blocks as unknown as PageSpec["blocks"] };
}

/** A user's data for the catalogue and the store, from one seed. */
export function randomUser(seed: number) {
  const r = rng(seed);
  const types = randomTypes(r);
  const data = catalogueData(types);
  const rows = new Map(types.map((t) => [t.id, randomEntities(r, t)]));
  return { r, types, data, rows };
}
