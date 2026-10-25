import type { PageBlock, PageSpec } from "./page.ts";

/**
 * Boni's own screens as pages of blocks (Juan, 2026-10-24: «todo lo que se ve en Boni se puede generar»): each comes
 * with Boni as it is here, the user may change it like any page, and «Restaurar la de Boni» brings this back. Blocks
 * have no names of their own where Boni's name for them is right (the app says it in the user's language).
 */

export const SYSTEM_PAGES = ["models"] as const;
export type SystemPage = (typeof SYSTEM_PAGES)[number];
export const isSystemPage = (x: unknown): x is SystemPage =>
  (SYSTEM_PAGES as readonly unknown[]).includes(x);

const at = (row: string, col: number, w: number, h?: "s" | "m" | "l") => ({
  row,
  col,
  w,
  ...(h ? { h } : {}),
});
const boni = (
  id: string,
  type: "number" | "bars" | "graph",
  source: string,
  place: PageBlock["at"],
) =>
  ({
    id,
    type,
    from: "boni",
    source,
    ...(type === "bars" ? {} : { bg: true }),
    at: place,
  }) as PageBlock;

/** «Modelos» as the mockup Juan approved (2026-10-24): figures, the uses and keys, spending by day and by model. */
const MODELS: PageSpec = {
  version: 1,
  blocks: [
    boni("spend", "number", "spend", at("r1", 0, 3)),
    boni("calls", "number", "calls", at("r1", 1, 3)),
    boni("reads", "number", "reads", at("r1", 2, 3)),
    boni("writes", "number", "writes", at("r1", 3, 3)),
    { id: "uses", type: "models", at: at("r2", 0, 7) },
    { id: "keys", type: "model-keys", at: at("r2", 0, 7) },
    { ...boni("byday", "graph", "spendByDay", at("r2", 1, 5, "s")), bg: false } as PageBlock,
    boni("bymodel", "bars", "callsByModel", at("r2", 1, 5)),
    { id: "activity", type: "link", to: "activity" },
  ],
};

export function systemPage(name: SystemPage): PageSpec {
  return structuredClone({ models: MODELS }[name]);
}

/** What the user changed of a system page, block by block (added, removed, changed, resized) and whether blocks moved. */
export interface SystemChange {
  sign: "+" | "−" | "✎" | "⤢" | "↕";
  block: PageBlock | null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const withoutPlace = (b: PageBlock) => {
  const { at: _a, ...rest } = b;
  return rest;
};

export function systemChanges(name: SystemPage, spec: PageSpec): SystemChange[] {
  const was = systemPage(name).blocks;
  const now = spec.blocks;
  const out: SystemChange[] = [];
  for (const b of now) if (!was.some((x) => x.id === b.id)) out.push({ sign: "+", block: b });
  for (const b of was) if (!now.some((x) => x.id === b.id)) out.push({ sign: "−", block: b });
  for (const b of now) {
    const old = was.find((x) => x.id === b.id);
    if (!old) continue;
    if (!same(withoutPlace(old), withoutPlace(b))) out.push({ sign: "✎", block: b });
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
