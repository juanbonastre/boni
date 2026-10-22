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

export type PageBlock =
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
  | { id: string; type: "action"; screen: string; label: string; shortcut?: string };

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
}
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
  spec.blocks.forEach((b, i) => {
    const w = `blocks[${i}]`;
    if (!isObj(b) || typeof b.id !== "string" || !ID.test(b.id)) {
      errors.push(`${w}: needs an id`);
      return;
    }
    if (ids.has(b.id)) errors.push(`${w}: id used twice`);
    ids.add(b.id);
    const indentOk =
      b.indent === undefined || (typeof b.indent === "number" && [1, 2, 3, 4].includes(b.indent));
    const textual = (extra: string[], max: number = PAGE_LIMITS.text) =>
      only(b, ["id", "type", "text", "indent", ...extra]) && text(b.text, max, true) && indentOk;
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
        if (!only(b, ["id", "type"])) errors.push(`${w}: a divider has nothing else`);
        break;
      case "page":
        if (!only(b, ["id", "type", "page"]) || typeof b.page !== "string" || !ID.test(b.page))
          errors.push(`${w}: a page link names its page`);
        break;
      case "chart":
        if (!only(b, ["id", "type", "chart"]) || typeof b.chart !== "string" || !ID.test(b.chart))
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
          !only(b, ["id", "type", "source", "view"]) ||
          typeof b.source !== "string" ||
          !ID.test(b.source) ||
          !v ||
          !only(v, ["layout", "group", "date", "sort", "hide", "also", "span", "filter"]) ||
          (v.span !== undefined && v.span !== "month" && v.span !== "week") ||
          (v.filter !== undefined && filterErrors(v.filter).length > 0) ||
          (v.also !== undefined &&
            (!Array.isArray(v.also) || v.also.length > 10 || !v.also.every((f) => okField(f)))) ||
          !(DATABASE_LAYOUTS as readonly unknown[]).includes(v.layout) ||
          !okField(v.group) ||
          !okField(v.date) ||
          !sortOk ||
          (v.hide !== undefined &&
            (!Array.isArray(v.hide) || v.hide.length > 100 || !v.hide.every((f) => okField(f))))
        )
          errors.push(`${w}: a database names its collection and a closed view`);
        break;
      }
      case "action":
        if (
          !only(b, ["id", "type", "screen", "label", "shortcut"]) ||
          typeof b.screen !== "string" ||
          !ID.test(b.screen) ||
          !text(b.label, PAGE_LIMITS.label) ||
          (b.shortcut !== undefined && (typeof b.shortcut !== "string" || !ID.test(b.shortcut)))
        )
          errors.push(`${w}: an action names a screen and has a label`);
        break;
      default:
        errors.push(`${w}: unknown block "${String(b.type)}"`);
    }
  });
  return errors;
}
