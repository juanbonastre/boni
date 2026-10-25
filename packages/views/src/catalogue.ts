import type { FieldType } from "@boni/entities";

/**
 * The block catalogue (docs/nucleo.md 8; Juan, 2026-10-24): ONE list of what a page may hold, each kind of block
 * with every setting it takes. The same list is what the user's panel of a block draws (a control per setting),
 * what checks a page (`catalogueErrors`) and what an AI is told it may build (`catalogueForAI`). So whatever an
 * AI can put on a page, the user can change with ordinary controls, and a setting added here reaches all three.
 *
 * A setting's value never depends on code: it is a literal, or one of a list of values that comes from the
 * user's own collections (their names, number fields, select fields and those fields' options). A value that is
 * not one of them is an error to show, never replaced by another that would look right (session 0, 2026-10-24).
 */

/** What the catalogue knows of the user's collections: the app's `DataType`, reduced. */
export interface CatalogueField {
  id: string;
  name: string;
  type: FieldType;
  options?: { id: string; name: string }[];
}
export interface CatalogueCollection {
  id: string;
  name: string;
  fields: CatalogueField[];
}
export interface CatalogueData {
  collections: CatalogueCollection[];
}

export interface Option {
  /** A number where the block keeps a number (a heading's level, a width). */
  value: string | number;
  /** Spanish, as the user's panel shows it. */
  label: string;
}

/** Lists whose values come from the user's data, resolved by `optionsOf`. */
export type DataOptions =
  | "collections"
  | "numberFields"
  | "groupFields"
  | "timeOrGroupFields"
  | "filterFields"
  | "filterValues"
  | "dateFields"
  | "periods";

export interface Setting {
  key: string;
  /** Spanish: the control's label. Short (docs/design-guide.md; wiki §9: no AI-sounding names). */
  label: string;
  type: "text" | "choice" | "toggle" | "color";
  options?: readonly Option[] | DataOptions;
  /** Only shown, and only allowed, when another setting has (or has not) one of these values. */
  when?: { key: string; is?: readonly unknown[]; not?: readonly unknown[] };
  /** May be left out (a choice not made, a toggle off). */
  optional?: boolean;
  /** A text that must be there but may be empty (a paragraph being written). */
  empty?: boolean;
  /** Longest text. */
  max?: number;
  /** Where the panel puts it: «Datos», «Aspecto», or folded under «Solo algunas filas». */
  section: "data" | "look" | "filter";
  /** One line for the AI when the values are not obvious from the list. */
  ai?: string;
}

export interface BlockKind {
  /** The block's `type` in a page. */
  type: string;
  /** Spanish, in the «+» menu and the panel's title. */
  name: string;
  group: "Cifras y gráficas" | "Para escribir" | "Tus datos" | "Botones";
  /** Its width in twelfths when added, and whether its height can be chosen (charts). */
  w: number;
  h?: Height;
  /** What it is for, for the AI (English, as the prompt). */
  ai: string;
  settings: readonly Setting[];
  /** The block as it is added (before the user or the AI changes anything). */
  defaults: Readonly<Record<string, unknown>>;
}

export type Height = "s" | "m" | "l";
/** Where a block is on the page's grid of 12 columns: its row, its column in the row and that column's width. */
export interface Place {
  row: string;
  col: number;
  w: number;
  h?: Height;
}

export const WIDTHS: readonly Option[] = [
  { value: 2, label: "Muy estrecho" },
  { value: 3, label: "Un cuarto" },
  { value: 4, label: "Un tercio" },
  { value: 6, label: "La mitad" },
  { value: 8, label: "Dos tercios" },
  { value: 9, label: "Tres cuartos" },
  { value: 12, label: "Todo el ancho" },
];
export const HEIGHTS: readonly Option[] = [
  { value: "s", label: "Bajo" },
  { value: "m", label: "Medio" },
  { value: "l", label: "Alto" },
];
/** A block's size, for every kind (charts also have a height): the same for the panel and the AI. */
export const PLACE_SETTINGS: readonly Setting[] = [
  { key: "w", label: "Ancho", type: "choice", options: WIDTHS, section: "look" },
  { key: "h", label: "Altura", type: "choice", options: HEIGHTS, section: "look" },
];

export const PERIODS: readonly Option[] = [
  { value: "month", label: "Este mes" },
  { value: "30d", label: "Últimos 30 días" },
  { value: "12m", label: "Últimos 12 meses" },
  { value: "year", label: "Este año" },
  { value: "all", label: "Desde siempre" },
];
export const MEASURES: readonly Option[] = [
  { value: "count", label: "Cuántas filas" },
  { value: "sum", label: "La suma de…" },
  { value: "avg", label: "La media de…" },
];
export const TIME_GROUPS: readonly Option[] = [
  { value: "@day", label: "Por día" },
  { value: "@week", label: "Por semana" },
  { value: "@month", label: "Por mes" },
];
export const SHAPES: readonly Option[] = [
  { value: "bar", label: "Columnas" },
  { value: "hbar", label: "Barras" },
  { value: "line", label: "Línea" },
  { value: "area", label: "Área" },
  { value: "donut", label: "Anillo" },
];
/** Chart colours by name (the app's palette, `color.<name>` in its i18n). */
export const COLORS = [
  "violet",
  "orange",
  "coral",
  "amber",
  "green",
  "teal",
  "sky",
  "blue",
  "pink",
  "red",
  "slate",
] as const;

const TITLE: Setting = { key: "title", label: "Nombre", type: "text", max: 120, section: "data" };
const BG: Setting = {
  key: "bg",
  label: "Con fondo",
  type: "toggle",
  optional: true,
  section: "look",
};

/** The settings that say what a number, a bar list or a chart counts, in which rows and when. */
const dataSettings = (group: DataOptions | null): Setting[] => [
  {
    key: "collection",
    label: "Colección",
    type: "choice",
    options: "collections",
    section: "data",
  },
  ...(group
    ? [
        {
          key: "groupBy",
          label: "Agrupar",
          type: "choice" as const,
          options: group,
          section: "data" as const,
          ai:
            group === "timeOrGroupFields"
              ? "@day|@week|@month (by time) or a select field of the collection"
              : "a select field of the collection",
        },
      ]
    : []),
  { key: "measure", label: "Qué cuenta", type: "choice", options: MEASURES, section: "data" },
  {
    key: "field",
    label: "De",
    type: "choice",
    options: "numberFields",
    when: { key: "measure", not: ["count"] },
    section: "data",
    ai: "a number field of the collection",
  },
  {
    key: "period",
    label: "Periodo",
    type: "choice",
    options: "periods",
    section: "data",
    ai: "month|30d|12m|year|all (only all for a collection without a date field)",
  },
  {
    key: "date",
    label: "Fecha que cuenta",
    type: "choice",
    options: "dateFields",
    optional: true,
    section: "filter",
    ai: "a date field of the collection; the first one when left out",
  },
  {
    key: "filterField",
    label: "Solo las filas con",
    type: "choice",
    options: "filterFields",
    optional: true,
    section: "filter",
    ai: "a select field of the collection; all rows when left out",
  },
  {
    key: "filterValue",
    label: "Igual a",
    type: "choice",
    options: "filterValues",
    when: { key: "filterField", not: [undefined, ""] },
    section: "filter",
    ai: "one of that field's options, by its id as listed in Data",
  },
];

export const CATALOGUE: readonly BlockKind[] = [
  {
    type: "number",
    name: "Cifra",
    group: "Cifras y gráficas",
    w: 3,
    ai: "one big number: a count, sum or average of a collection's rows in a period",
    settings: [TITLE, ...dataSettings(null), BG],
    defaults: { title: "Cifra", measure: "count", period: "month", bg: true },
  },
  {
    type: "bars",
    name: "Lista de barras",
    group: "Cifras y gráficas",
    w: 6,
    ai: "a ranked list with a bar per value of a select field (a category, a person)",
    settings: [TITLE, ...dataSettings("groupFields"), BG],
    defaults: { title: "Lista de barras", measure: "count", period: "month" },
  },
  {
    type: "graph",
    name: "Gráfica",
    group: "Cifras y gráficas",
    w: 6,
    h: "m",
    ai: "a chart over time (@day|@week|@month) or by a select field; donut for few parts of a whole",
    settings: [
      TITLE,
      { key: "shape", label: "Forma", type: "choice", options: SHAPES, section: "look" },
      { key: "color", label: "Color", type: "color", optional: true, section: "look" },
      ...dataSettings("timeOrGroupFields"),
      BG,
    ],
    defaults: {
      title: "Gráfica",
      shape: "bar",
      groupBy: "@month",
      measure: "count",
      period: "12m",
      bg: true,
    },
  },
  {
    type: "heading",
    name: "Título",
    group: "Para escribir",
    w: 12,
    ai: "a heading over the blocks under it",
    settings: [
      { key: "text", label: "Texto", type: "text", max: 200, section: "data" },
      {
        key: "level",
        label: "Tamaño",
        type: "choice",
        options: [
          { value: 1, label: "Grande" },
          { value: 2, label: "Mediano" },
          { value: 3, label: "Pequeño" },
        ],
        optional: true,
        section: "look",
      },
    ],
    defaults: { text: "Título", level: 2 },
  },
  {
    type: "text",
    name: "Texto",
    group: "Para escribir",
    w: 12,
    ai: "a paragraph of plain text (no Markdown, no links)",
    settings: [
      { key: "text", label: "Texto", type: "text", max: 5000, empty: true, section: "data" },
    ],
    defaults: { text: "" },
  },
];

const NO_DATA: CatalogueData = { collections: [] };
export const kindOf = (type: string): BlockKind | undefined =>
  CATALOGUE.find((k) => k.type === type);
export const CATALOGUE_TYPES = CATALOGUE.map((k) => k.type);

type Block = Readonly<Record<string, unknown>>;

/** Whether a setting applies to a block as it is now (a setting that does not is not allowed on it either). */
export function applies(s: Setting, block: Block): boolean {
  if (!s.when) return true;
  const v = block[s.when.key];
  if (s.when.is) return s.when.is.includes(v);
  if (s.when.not) return !s.when.not.includes(v);
  return true;
}

const fieldsOf = (data: CatalogueData, block: Block) =>
  data.collections.find((c) => c.id === block.collection)?.fields ?? [];
const DATES: readonly FieldType[] = ["date", "datetime"];
const hasDate = (fs: CatalogueField[]) => fs.some((f) => DATES.includes(f.type));
const GROUPABLE: readonly FieldType[] = ["select", "multiselect", "relation", "checkbox"];
const byField = (fs: CatalogueField[], types: readonly FieldType[]) =>
  fs.filter((f) => types.includes(f.type)).map((f) => ({ value: f.id, label: f.name }));

/** The values a setting may take on this block, with the user's data (for a list that comes from it). */
export function optionsOf(s: Setting, block: Block, data: CatalogueData): readonly Option[] {
  if (s.type === "color") return COLORS.map((c) => ({ value: c, label: c }));
  if (!s.options) return [];
  if (typeof s.options !== "string") return s.options;
  const fs = fieldsOf(data, block);
  switch (s.options) {
    case "collections":
      return data.collections.map((c) => ({ value: c.id, label: c.name }));
    case "numberFields":
      return byField(fs, ["number", "money", "duration"]);
    case "groupFields":
      return byField(fs, GROUPABLE);
    case "timeOrGroupFields":
      return [...(hasDate(fs) ? TIME_GROUPS : []), ...byField(fs, GROUPABLE)];
    case "periods":
      return hasDate(fs) ? PERIODS : PERIODS.filter((p) => p.value === "all");
    case "filterFields":
      return byField(fs, ["select", "multiselect"]);
    case "dateFields":
      return byField(fs, DATES);
    case "filterValues": {
      const f = fs.find((x) => x.id === block.filterField);
      return (f?.options ?? []).map((o) => ({ value: o.id, label: o.name }));
    }
  }
}

/** A problem of one block, for the block itself (in Spanish, by the app) and for an AI that made it. */
export interface BlockProblem {
  block: string;
  key: string;
  code: "missing" | "bad" | "not-allowed" | "not-in-data";
  value?: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Problems of a catalogue block's settings: unknown keys, values of the wrong type, required ones missing and,
 * with the user's data, values that are not among the ones it offers (`not-in-data`). Without data, only the
 * shape is checked (what the server can say of any page); with it, everything the panel would show.
 */
export function catalogueErrors(block: unknown, data?: CatalogueData): BlockProblem[] {
  if (!isRecord(block)) return [{ block: "", key: "", code: "bad" }];
  const id = String(block.id ?? "");
  const kind = kindOf(String(block.type));
  if (!kind) return [{ block: id, key: "type", code: "bad", value: block.type }];
  const out: BlockProblem[] = [];
  const known = new Set(["id", "type", "at", ...kind.settings.map((s) => s.key)]);
  for (const k of Object.keys(block))
    if (!known.has(k)) out.push({ block: id, key: k, code: "not-allowed" });
  for (const s of kind.settings) {
    const v = block[s.key];
    const on = applies(s, block);
    if (!on) {
      if (v !== undefined) out.push({ block: id, key: s.key, code: "not-allowed", value: v });
      continue;
    }
    if (v === undefined || (v === "" && !s.empty)) {
      if (!s.optional) out.push({ block: id, key: s.key, code: "missing" });
      continue;
    }
    if (s.type === "text") {
      if (typeof v !== "string" || v.length > (s.max ?? 200))
        out.push({ block: id, key: s.key, code: "bad", value: v });
      else if (!s.empty && !v.trim()) out.push({ block: id, key: s.key, code: "missing" });
      continue;
    }
    if (s.type === "toggle") {
      if (typeof v !== "boolean") out.push({ block: id, key: s.key, code: "bad", value: v });
      continue;
    }
    if (s.type === "color" || typeof s.options !== "string") {
      if (!optionsOf(s, block, NO_DATA).some((o) => o.value === v))
        out.push({ block: id, key: s.key, code: "bad", value: v });
      continue;
    }
    // A value from the user's data: an id, or one of the fixed values the list may also have (a period, a time).
    const fixed =
      s.options === "periods"
        ? PERIODS
        : typeof v === "string" && v.startsWith("@")
          ? TIME_GROUPS
          : null;
    if (
      typeof v !== "string" ||
      (fixed ? !fixed.some((o) => o.value === v) : !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(v))
    ) {
      out.push({ block: id, key: s.key, code: "bad", value: v });
      continue;
    }
    if (data && !optionsOf(s, block, data).some((o) => o.value === v))
      out.push({ block: id, key: s.key, code: "not-in-data", value: v });
  }
  return out;
}

/**
 * The user changed one setting in the panel: the settings after it that depend on it are fitted to the new
 * value (another collection has other fields): one that no longer applies is taken out, a required one that is
 * no longer among the offered values takes the first that is, an optional one is left empty. Only what comes
 * after the changed setting moves; nothing is changed for an AI's page behind anyone's back (that is
 * `catalogueErrors`' job: say it).
 */
export function fitAfter(
  block: Readonly<Record<string, unknown>>,
  changed: string,
  data: CatalogueData,
): Record<string, unknown> {
  const kind = kindOf(String(block.type));
  if (!kind) return { ...block };
  const b: Record<string, unknown> = { ...block };
  const from = kind.settings.findIndex((s) => s.key === changed);
  for (const s of kind.settings.slice(from + 1)) {
    if (!applies(s, b)) {
      delete b[s.key];
      continue;
    }
    if (s.type !== "choice" || typeof s.options !== "string") continue;
    const opts = optionsOf(s, b, data);
    if (opts.some((o) => o.value === b[s.key])) continue;
    if (s.optional || !opts[0]) delete b[s.key];
    else b[s.key] = opts[0].value;
  }
  // A sum or an average of a collection with no number field cannot be: it counts rows.
  if (
    b.measure &&
    b.measure !== "count" &&
    b.field === undefined &&
    kind.settings.some((s) => s.key === "field")
  )
    b.measure = "count";
  return b;
}

/** A catalogue block as it is added: the kind's defaults, the first collection's fields where it needs them. */
export function newBlock(
  type: string,
  id: string,
  data: CatalogueData,
): Record<string, unknown> | null {
  const kind = kindOf(type);
  if (!kind) return null;
  const b: Record<string, unknown> = { id, type, ...kind.defaults };
  if (kind.settings.some((s) => s.key === "collection")) {
    const c = data.collections[0];
    if (c) {
      b.collection = c.id;
      const group = kind.settings.find((s) => s.key === "groupBy");
      if (group && typeof group.options === "string") {
        const opts = optionsOf(group, b, data);
        if (!opts.some((o) => o.value === b.groupBy)) b.groupBy = opts[0]?.value;
      }
    }
  }
  return b;
}

const whenText = (w: NonNullable<Setting["when"]>) =>
  w.is
    ? `${w.key} is ${w.is.map(String).join("|")}`
    : w.not?.some((x) => x === undefined)
      ? `${w.key} is set`
      : `${w.key} is not ${(w.not ?? []).map(String).join("|")}`;

/**
 * The catalogue as an AI is told it: the same kinds and settings the user's panel shows (sizes included),
 * with the values each takes; the values that come from the data are listed with the data itself.
 */
export function catalogueForAI(data: CatalogueData): string {
  const values = (s: Setting) => {
    if (s.type === "text") return `text (≤${s.max ?? 200})`;
    if (s.type === "toggle") return "true|false";
    if (s.type === "color") return COLORS.join("|");
    if (typeof s.options === "string") return s.ai ?? s.options;
    return (s.options ?? []).map((o) => o.value).join("|");
  };
  const kinds = CATALOGUE.map((k) => {
    const all = [...k.settings, ...PLACE_SETTINGS.filter((s) => s.key !== "h" || k.h)];
    const list = all.map((s) => {
      const extra = [s.optional ? "optional" : "", s.when ? `only when ${whenText(s.when)}` : ""]
        .filter(Boolean)
        .join(", ");
      return `${s.key}: ${values(s)}${extra ? ` (${extra})` : ""}`;
    });
    return `${k.type}: ${k.ai}\n  { ${list.join(", ")} }`;
  });
  const layout =
    "A page is rows; a row has columns whose widths (w, in twelfths) add up to at most 12; a column has blocks\n" +
    "one under another. Every block says where it is: at { row (an id), col (0, 1, 2… in its row), w, h }.";
  const collections = data.collections.map((c) => {
    const fields = c.fields.map((f) => {
      const opts = f.options?.length
        ? ` options: ${f.options.map((o) => `${o.id}=${o.name}`).join(", ")}`
        : "";
      return `    ${f.id} (${f.name}, ${f.type})${opts}`;
    });
    return `  ${c.id} (${c.name})\n${fields.join("\n")}`;
  });
  return `${layout}\n\nBlocks:\n${kinds.join("\n")}\n\nData (collections, their fields and options):\n${collections.join("\n")}`;
}
