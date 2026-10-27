import type { PageBlock, PageSpec, PageTemplate } from "./page.ts";

/**
 * Boni's template pages (design audit, Juan 2026-10-25): pages like any other, made only of the block catalogue's
 * blocks over Boni's own records, which are read-only collections (apps/server systemCollections.ts). Each account
 * gets them once; the user changes them like any page, and «Restaurar la de Boni» brings this version back.
 */

/** Boni's own records as collections: their ids, their fields and the options a page's filter names. */
export const SYS = {
  calls: {
    id: "t_sys_llamadas",
    title: "f_titulo",
    date: "f_fecha",
    use: "f_uso",
    model: "f_modelo",
    provider: "f_prov",
    cost: "f_coste",
    tokens: "f_tokens",
  },
  activity: {
    id: "t_sys_actividad",
    title: "f_titulo",
    date: "f_fecha",
    who: "f_quien",
    what: "f_que",
    collection: "f_col",
    rows: "f_filas",
    /** «Qué»: read or changed. */
    read: "o_que_leyo",
    wrote: "o_que_cambio",
  },
  runs: {
    id: "t_sys_runs",
    title: "f_titulo",
    date: "f_fecha",
    status: "f_estado",
    seconds: "f_segundos",
    changes: "f_cambios",
    cost: "f_coste",
  },
} as const;

const at = (row: string, col: number, w: number, h?: "s" | "m" | "l") => ({
  row,
  col,
  w,
  ...(h ? { h } : {}),
});
const C = SYS.calls;
const A = SYS.activity;
const R = SYS.runs;

const USO_IA: PageSpec = {
  version: 1,
  template: "uso-ia",
  blocks: [
    {
      id: "u1",
      type: "number",
      title: "Gasto en IA",
      collection: C.id,
      measure: "sum",
      field: C.cost,
      period: "month",
      bg: true,
      at: at("r1", 0, 3),
    },
    {
      id: "u2",
      type: "number",
      title: "Llamadas",
      collection: C.id,
      measure: "count",
      period: "month",
      bg: true,
      at: at("r1", 1, 3),
    },
    {
      id: "u3",
      type: "number",
      title: "Lecturas de las IAs",
      collection: A.id,
      measure: "sum",
      field: A.rows,
      period: "month",
      filterField: A.what,
      filterValue: A.read,
      bg: true,
      at: at("r1", 2, 3),
    },
    {
      id: "u4",
      type: "number",
      title: "Cambios de las IAs",
      collection: A.id,
      measure: "sum",
      field: A.rows,
      period: "month",
      filterField: A.what,
      filterValue: A.wrote,
      bg: true,
      at: at("r1", 3, 3),
    },
    {
      id: "u5",
      type: "graph",
      title: "Gasto por día",
      shape: "bar",
      collection: C.id,
      groupBy: "@day",
      measure: "sum",
      field: C.cost,
      period: "month",
      bg: true,
      at: at("r2", 0, 8, "m"),
    },
    {
      id: "u6",
      type: "bars",
      title: "Gasto por modelo",
      collection: C.id,
      groupBy: C.model,
      measure: "sum",
      field: C.cost,
      period: "month",
      at: at("r2", 1, 4),
    },
    {
      id: "u7",
      type: "bars",
      title: "Llamadas por uso",
      collection: C.id,
      groupBy: C.use,
      measure: "count",
      period: "month",
      at: at("r2", 1, 4),
    },
  ],
};

const ACTIVIDAD: PageSpec = {
  version: 1,
  template: "actividad",
  blocks: [
    {
      id: "a1",
      type: "number",
      title: "Lecturas",
      collection: A.id,
      measure: "sum",
      field: A.rows,
      period: "30d",
      filterField: A.what,
      filterValue: A.read,
      bg: true,
      at: at("r1", 0, 3),
    },
    {
      id: "a2",
      type: "number",
      title: "Cambios",
      collection: A.id,
      measure: "sum",
      field: A.rows,
      period: "30d",
      filterField: A.what,
      filterValue: A.wrote,
      bg: true,
      at: at("r1", 1, 3),
    },
    {
      id: "a3",
      type: "graph",
      title: "Por día",
      shape: "line",
      collection: A.id,
      groupBy: "@day",
      measure: "sum",
      field: A.rows,
      period: "30d",
      bg: true,
      at: at("r1", 2, 6, "s"),
    },
    {
      id: "a4",
      type: "bars",
      title: "Quién",
      collection: A.id,
      groupBy: A.who,
      measure: "sum",
      field: A.rows,
      period: "30d",
      at: at("r2", 0, 6),
    },
    {
      id: "a5",
      type: "bars",
      title: "En qué colección",
      collection: A.id,
      groupBy: A.collection,
      measure: "sum",
      field: A.rows,
      period: "30d",
      at: at("r2", 1, 6),
    },
    {
      id: "a6",
      type: "database",
      source: A.id,
      view: { layout: "table", sort: { field: A.date, desc: true } },
    },
    { id: "a7", type: "link", title: "Cada ejecución de Boni", to: "registro" },
  ] as PageBlock[],
};

const REGISTRO: PageSpec = {
  version: 1,
  template: "registro",
  blocks: [
    {
      id: "r1",
      type: "number",
      title: "Ejecuciones",
      collection: R.id,
      measure: "count",
      period: "30d",
      bg: true,
      at: at("r1", 0, 4),
    },
    {
      id: "r2",
      type: "number",
      title: "Cambios",
      collection: R.id,
      measure: "sum",
      field: R.changes,
      period: "30d",
      bg: true,
      at: at("r1", 1, 4),
    },
    {
      id: "r3",
      type: "number",
      title: "Tiempo de Boni (segundos)",
      collection: R.id,
      measure: "sum",
      field: R.seconds,
      period: "30d",
      bg: true,
      at: at("r1", 2, 4),
    },
    {
      id: "r4",
      type: "graph",
      title: "Ejecuciones por día",
      shape: "bar",
      collection: R.id,
      groupBy: "@day",
      measure: "count",
      period: "30d",
      bg: true,
      at: at("r2", 0, 12, "s"),
    },
    {
      id: "r5",
      type: "database",
      source: R.id,
      view: { layout: "table", sort: { field: R.date, desc: true } },
    },
  ] as PageBlock[],
};

const TEMPLATES: Record<PageTemplate, { title: string; icon: string; spec: PageSpec }> = {
  "uso-ia": { title: "Uso de la IA", icon: "🤖", spec: USO_IA },
  actividad: { title: "Actividad", icon: "🧾", spec: ACTIVIDAD },
  registro: { title: "Registro", icon: "📜", spec: REGISTRO },
};

/** A template's page, a fresh copy every time (changing one never changes Boni's). */
export function templatePage(name: PageTemplate): { title: string; icon: string; spec: PageSpec } {
  return structuredClone(TEMPLATES[name]);
}

/** Template links name their destination by template until the account's real page ids are known. */
export function resolveTemplateLinks(
  spec: PageSpec,
  pages: readonly { id: string; template?: PageTemplate }[],
): PageSpec {
  return {
    ...spec,
    blocks: spec.blocks.map((b) => {
      if (b.type !== "link") return b;
      const page = pages.find((p) => p.template === b.to);
      return page ? { ...b, to: page.id } : b;
    }),
  };
}

/** What the user changed of a template page, block by block (added, removed, changed, resized) and whether blocks moved. */
export interface TemplateChange {
  sign: "+" | "−" | "✎" | "⤢" | "↕";
  block: PageBlock | null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const withoutPlace = (b: PageBlock, pages: readonly { id: string; template?: PageTemplate }[]) => {
  const { at: _a, ...rest } = b;
  if (b.type !== "link") return rest;
  const page = pages.find((p) => p.id === b.to);
  return page?.template ? { ...rest, to: page.template } : rest;
};

export function templateChanges(
  name: PageTemplate,
  spec: PageSpec,
  pages: readonly { id: string; template?: PageTemplate }[] = [],
): TemplateChange[] {
  const was = TEMPLATES[name].spec.blocks;
  const now = spec.blocks;
  const out: TemplateChange[] = [];
  for (const b of now) if (!was.some((x) => x.id === b.id)) out.push({ sign: "+", block: b });
  for (const b of was) if (!now.some((x) => x.id === b.id)) out.push({ sign: "−", block: b });
  for (const b of now) {
    const old = was.find((x) => x.id === b.id);
    if (!old) continue;
    if (!same(withoutPlace(old, pages), withoutPlace(b, pages))) out.push({ sign: "✎", block: b });
    else if (old.at?.w !== b.at?.w || old.at?.h !== b.at?.h) out.push({ sign: "⤢", block: b });
  }
  // Where each kept block is drawn: its row and column and its place in that column (or in the page's flow).
  const kept = (list: readonly PageBlock[]) => {
    const both = list.filter(
      (b) => now.some((x) => x.id === b.id) && was.some((x) => x.id === b.id),
    );
    const where = (b: PageBlock) => {
      const mates = both.filter((x) =>
        b.at ? x.at?.row === b.at.row && x.at?.col === b.at.col : !x.at,
      );
      return [b.id, b.at?.row ?? "", b.at?.col ?? -1, mates.indexOf(b)];
    };
    return both.map(where).sort((x, y) => String(x[0]).localeCompare(String(y[0])));
  };
  if (!same(kept(now), kept(was))) out.push({ sign: "↕", block: null });
  return out;
}
