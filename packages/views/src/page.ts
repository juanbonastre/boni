/**
 * A page (docs/extensiones.md 6, the Lienzo; docs/nucleo.md 8): what the user puts on it, as a list of blocks
 * from a closed catalogue. The app paints each block with its own components; nothing in a page is code, a
 * link that opens by itself or HTML. A block of data names what it shows (a chart by its id) and the code
 * computes it; an action block names a screen the app already has. The page grows block types as the
 * catalogue does (the block editor of plan PR 18 builds on this).
 */

export type PageBlock =
  | { id: string; type: "heading"; text: string }
  | { id: string; type: "text"; text: string }
  | { id: string; type: "chart"; chart: string }
  | { id: string; type: "action"; screen: string; label: string; shortcut?: string };

export interface PageSpec {
  version: 1;
  blocks: PageBlock[];
}

export const PAGE_BLOCKS = ["heading", "text", "chart", "action"] as const;
export const PAGE_LIMITS = {
  blocks: 200,
  heading: 200,
  text: 5000,
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
    !only(spec, ["version", "blocks"])
  )
    return ["page: { version: 1, blocks: [...] }"];
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
    switch (b.type) {
      case "heading":
        if (!only(b, ["id", "type", "text"]) || !text(b.text, PAGE_LIMITS.heading, true))
          errors.push(`${w}: a heading has text`);
        break;
      case "text":
        if (!only(b, ["id", "type", "text"]) || !text(b.text, PAGE_LIMITS.text, true))
          errors.push(`${w}: a text block has text`);
        break;
      case "chart":
        if (!only(b, ["id", "type", "chart"]) || typeof b.chart !== "string" || !ID.test(b.chart))
          errors.push(`${w}: a chart names its chart`);
        break;
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
