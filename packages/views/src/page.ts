import { catalogueErrors, type Place } from "./catalogue.ts";
import { filterErrors } from "./filter.ts";

/**
 * A page (docs/extensiones.md 6, the Lienzo; docs/nucleo.md 8): what the user puts on it, as a list of blocks
 * from a closed catalogue. The app paints each block with its own components; nothing in a page is code, a
 * link that opens by itself or HTML. A block of data names what it shows (a chart by its id) and the code
 * computes it; an action block names a screen the app already has. The page grows block types as the
 * catalogue does (the block editor of plan PR 18 builds on this).
 */

/** Nesting, as Notion's Tab: how far a block is indented under the one above (0 = not at all). */
type Indent = { indent?: 1 | 2 | 3 | 4 };

/**
 * A number, a bar list or a chart over one of the user's collections, with the settings of the block catalogue
 * (catalogue.ts): what it counts, in which rows and when. Computed by the code from the user's data.
 */
export interface DataBlock {
  id: string;
  type: "number" | "bars" | "graph";
  title: string;
  collection: string;
  measure: "count" | "sum" | "avg";
  field?: string;
  groupBy?: string;
  period: "month" | "30d" | "12m" | "year" | "all";
  date?: string;
  filterField?: string;
  filterValue?: string;
  shape?: "bar" | "hbar" | "line" | "area" | "donut";
  color?: string;
  bg?: boolean;
}
export const DATA_BLOCKS = ["number", "bars", "graph"] as const;

export type PageBlock = (
  | ({ id: string; type: "heading"; text: string; level?: 1 | 2 | 3 } & Indent)
  | ({ id: string; type: "text"; text: string } & Indent)
  | ({ id: string; type: "bullet"; text: string } & Indent)
  | ({ id: string; type: "numbered"; text: string } & Indent)
  | ({ id: string; type: "todo"; text: string; done?: boolean } & Indent)
  /** Its text is the toggle's line; the blocks indented under it fold away when it is closed. */
  | ({ id: string; type: "toggle"; text: string; open?: boolean } & Indent)
  | ({ id: string; type: "quote"; text: string } & Indent)
  | ({ id: string; type: "callout"; text: string; icon?: string } & Indent)
  /** Plain text in a fixed-width font, its lines kept; never run. */
  | ({ id: string; type: "code"; text: string; lang?: string } & Indent)
  | { id: string; type: "divider" }
  /** A link to another of the user's pages (a subpage), shown with its icon and name. */
  | { id: string; type: "page"; page: string }
  | { id: string; type: "chart"; chart: string }
  /** A collection of the user's shown as a Notion database view (plan PR 19). */
  | { id: string; type: "database"; source: string; view: DatabaseView }
  | { id: string; type: "action"; screen: string; label: string; shortcut?: string }
  | DataBlock
) & {
  /** Its place on the page's grid of 12 columns; a block without one is a row of its own, the whole width. */
  at?: Place;
};

/** How a database block shows its collection: Notion's layouts and their settings, all closed. */
export interface DatabaseView {
  layout: "table" | "board" | "list" | "gallery" | "calendar";
  /** The select field whose options are a board's columns. */
  group?: string;
  /** The date field a calendar places rows by. */
  date?: string;
  sort?: { field: string; desc?: boolean };
  /** Properties not shown in this view. */
  hide?: string[];
  /** Other collections the calendar also shows (as Boni Calendar showed every area at once). */
  also?: string[];
  /** A calendar's span: a month (the default) or a week. */
  span?: "month" | "week";
  /** Notion's filter: only the rows that match every rule. */
  filter?: DatabaseFilter[];
  /** System columns shown (Juan, 2026-10-24): kept by Boni, never edited by anyone; none by default. */
  system?: SystemColumn[];
}
/** Each row's system columns, in the order a table shows them. */
export const SYSTEM_COLUMNS = [
  "created",
  "createdBy",
  "updated",
  "updatedBy",
  "editors",
  "viewers",
  "seenAt",
  "origin",
  "version",
  "size",
] as const;
export type SystemColumn = (typeof SYSTEM_COLUMNS)[number];
export interface DatabaseFilter {
  field: string;
  op: (typeof FILTER_OPS)[number];
  /** Text, a number, a date ("YYYY-MM-DD") or an option's id, as the operator needs. */
  value?: string | number;
}
export const FILTER_OPS = [
  "is",
  "is_not",
  "contains",
  "not_contains",
  "empty",
  "not_empty",
  "checked",
  "unchecked",
  "before",
  "after",
  "gt",
  "lt",
] as const;
export const DATABASE_LAYOUTS = ["table", "board", "list", "gallery", "calendar"] as const;

export interface PageSpec {
  version: 1;
  /** The page uses the window's whole width (charts side by side) instead of a reading column. */
  full?: boolean;
  blocks: PageBlock[];
}

/** The blocks that hold text the user writes in place (and can turn into one another). */
export const TEXT_BLOCKS = [
  "text",
  "heading",
  "bullet",
  "numbered",
  "todo",
  "toggle",
  "quote",
  "callout",
  "code",
] as const;
export const PAGE_BLOCKS = [
  ...TEXT_BLOCKS,
  "divider",
  "page",
  "chart",
  "database",
  "action",
  ...DATA_BLOCKS,
] as const;
export const PAGE_LIMITS = {
  blocks: 1000,
  heading: 200,
  text: 5000,
  code: 20000,
  label: 80,
  title: 120,
} as const;

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const only = (o: Record<string, unknown>, keys: string[]) =>
  Object.keys(o).every((k) => keys.includes(k));
const text = (v: unknown, max: number, empty = false) =>
  typeof v === "string" && v.length <= max && (empty || v.trim().length > 0);

export const emptyPage = (): PageSpec => ({ version: 1, blocks: [] });

/** Problems of a page's spec (empty when it is fine): closed, every block of the catalogue, within limits. */
export function pageErrors(spec: unknown): string[] {
  if (
    !isObj(spec) ||
    spec.version !== 1 ||
    !Array.isArray(spec.blocks) ||
    !only(spec, ["version", "full", "blocks"]) ||
    (spec.full !== undefined && typeof spec.full !== "boolean")
  )
    return ["page: { version: 1, full?, blocks: [...] }"];
  if (spec.blocks.length > PAGE_LIMITS.blocks)
    return [`page: at most ${PAGE_LIMITS.blocks} blocks`];
  const errors: string[] = [];
  const ids = new Set<string>();
  /** Each row's columns and their widths, which add up to at most 12. */
  const rows = new Map<string, Map<number, number>>();
  spec.blocks.forEach((b, i) => {
    const w = `blocks[${i}]`;
    if (!isObj(b) || typeof b.id !== "string" || !ID.test(b.id)) {
      errors.push(`${w}: needs an id`);
      return;
    }
    if (ids.has(b.id)) errors.push(`${w}: id used twice`);
    ids.add(b.id);
    if (b.at !== undefined) {
      const at = b.at;
      if (
        !isObj(at) ||
        !only(at, ["row", "col", "w", "h"]) ||
        typeof at.row !== "string" ||
        !ID.test(at.row) ||
        !Number.isInteger(at.col) ||
        (at.col as number) < 0 ||
        (at.col as number) > 11 ||
        !Number.isInteger(at.w) ||
        (at.w as number) < 1 ||
        (at.w as number) > 12 ||
        (at.h !== undefined && at.h !== "s" && at.h !== "m" && at.h !== "l")
      )
        errors.push(`${w}: at { row, col 0-11, w 1-12, h s|m|l }`);
      else {
        let cols = rows.get(at.row);
        if (!cols) {
          cols = new Map();
          rows.set(at.row, cols);
        }
        const had = cols.get(at.col as number);
        if (had !== undefined && had !== at.w)
          errors.push(`${w}: a column has one width (row ${at.row}, column ${String(at.col)})`);
        cols.set(at.col as number, at.w as number);
      }
    }
    const indentOk =
      b.indent === undefined || (typeof b.indent === "number" && [1, 2, 3, 4].includes(b.indent));
    const textual = (extra: string[], max: number = PAGE_LIMITS.text) =>
      only(b, ["at", "id", "type", "text", "indent", ...extra]) &&
      text(b.text, max, true) &&
      indentOk;
    switch (b.type) {
      case "heading":
        if (
          !textual(["level"], PAGE_LIMITS.heading) ||
          (b.level !== undefined && b.level !== 1 && b.level !== 2 && b.level !== 3)
        )
          errors.push(`${w}: a heading has text and a level 1-3`);
        break;
      case "text":
      case "bullet":
      case "numbered":
      case "quote":
        if (!textual([])) errors.push(`${w}: a text block has text`);
        break;
      case "code":
        if (
          !textual(["lang"], PAGE_LIMITS.code) ||
          (b.lang !== undefined && (typeof b.lang !== "string" || !/^[\w+-]{1,20}$/.test(b.lang)))
        )
          errors.push(`${w}: a code block has text`);
        break;
      case "todo":
        if (!textual(["done"]) || (b.done !== undefined && typeof b.done !== "boolean"))
          errors.push(`${w}: a to-do has text and done`);
        break;
      case "toggle":
        if (!textual(["open"]) || (b.open !== undefined && typeof b.open !== "boolean"))
          errors.push(`${w}: a toggle has text and open`);
        break;
      case "callout":
        if (
          !textual(["icon"]) ||
          (b.icon !== undefined &&
            (typeof b.icon !== "string" || [...b.icon].length > 8 || /[<>&]/.test(b.icon)))
        )
          errors.push(`${w}: a callout has text and an emoji`);
        break;
      case "divider":
        if (!only(b, ["at", "id", "type"])) errors.push(`${w}: a divider has nothing else`);
        break;
      case "page":
        if (
          !only(b, ["at", "id", "type", "page"]) ||
          typeof b.page !== "string" ||
          !ID.test(b.page)
        )
          errors.push(`${w}: a page link names its page`);
        break;
      case "chart":
        if (
          !only(b, ["at", "id", "type", "chart"]) ||
          typeof b.chart !== "string" ||
          !ID.test(b.chart)
        )
          errors.push(`${w}: a chart names its chart`);
        break;
      case "database": {
        const v = isObj(b.view) ? b.view : null;
        const okField = (f: unknown) => f === undefined || (typeof f === "string" && ID.test(f));
        const sortOk =
          v?.sort === undefined ||
          (isObj(v.sort) &&
            only(v.sort, ["field", "desc"]) &&
            okField(v.sort.field) &&
            v.sort.field !== undefined &&
            (v.sort.desc === undefined || typeof v.sort.desc === "boolean"));
        if (
          !only(b, ["at", "id", "type", "source", "view"]) ||
          typeof b.source !== "string" ||
          !ID.test(b.source) ||
          !v ||
          !only(v, [
            "layout",
            "group",
            "date",
            "sort",
            "hide",
            "also",
            "span",
            "filter",
            "system",
          ]) ||
          (v.span !== undefined && v.span !== "month" && v.span !== "week") ||
          (v.filter !== undefined && filterErrors(v.filter).length > 0) ||
          (v.also !== undefined &&
            (!Array.isArray(v.also) || v.also.length > 10 || !v.also.every((f) => okField(f)))) ||
          !(DATABASE_LAYOUTS as readonly unknown[]).includes(v.layout) ||
          !okField(v.group) ||
          !okField(v.date) ||
          !sortOk ||
          (v.hide !== undefined &&
            (!Array.isArray(v.hide) || v.hide.length > 100 || !v.hide.every((f) => okField(f)))) ||
          (v.system !== undefined &&
            (!Array.isArray(v.system) ||
              !v.system.every((c) => (SYSTEM_COLUMNS as readonly unknown[]).includes(c))))
        )
          errors.push(`${w}: a database names its collection and a closed view`);
        break;
      }
      case "action":
        if (
          !only(b, ["at", "id", "type", "screen", "label", "shortcut"]) ||
          typeof b.screen !== "string" ||
          !ID.test(b.screen) ||
          !text(b.label, PAGE_LIMITS.label) ||
          (b.shortcut !== undefined && (typeof b.shortcut !== "string" || !ID.test(b.shortcut)))
        )
          errors.push(`${w}: an action names a screen and has a label`);
        break;
      case "number":
      case "bars":
      case "graph":
        for (const p of catalogueErrors(b))
          errors.push(
            `${w}: ${p.key ? `${p.key} ` : ""}${p.code === "missing" ? "is missing" : p.code === "not-allowed" ? "is not allowed here" : "is not valid"}`,
          );
        break;
      default:
        errors.push(`${w}: unknown block "${String(b.type)}"`);
    }
  });
  for (const [row, cols] of rows) {
    const total = [...cols.values()].reduce((a, x) => a + x, 0);
    if (total > 12) errors.push(`row ${row}: its columns are ${total} twelfths wide (at most 12)`);
  }
  return errors;
}
