/**
 * What the gestures on a note's images do to its blocks (task 2h), as pure functions: an image set to a width or a
 * crop, moved to another place of the text, put beside another (a row) or taken out of one, a row split. An image is
 * a file block or one of a row's (`files`); each gesture gives the page's next blocks, one step of Undo, or null when
 * it changes nothing. Nothing here knows the screen.
 */
import { type Crop, type FileShown, ROW_MAX } from "@boni/views";
import type { Page } from "./agent.ts";

type Block = Page["spec"]["blocks"][number];
type FileBlock = Extract<Block, { type: "file" }>;
type RowBlock = Extract<Block, { type: "files" }>;

/** One image of the page: its block, and its place in the block (0 for a file block alone). */
export interface ImageAt {
  block: string;
  index: number;
}
/** Where an image is dropped: above or below a block (an image of its own there), or beside an image (a row). */
export type ImageDrop =
  | { block: string; side: "above" | "below" }
  | { block: string; index: number; side: "left" | "right" };

/** The images a block shows: a file block's one, a row's, none for any other block. */
export function shownOf(b: Block): FileShown[] {
  if (b.type === "files") return b.files;
  if (b.type !== "file") return [];
  const { file, name, width, crop } = b;
  return [{ file, name, ...(width ? { width } : {}), ...(crop ? { crop } : {}) }];
}

/** Every image of the page in its order (the viewer passes from one to the next). */
export function imagesOf(blocks: readonly Block[]): { at: ImageAt; shown: FileShown }[] {
  return blocks.flatMap((b) =>
    shownOf(b).map((shown, index) => ({ at: { block: b.id, index }, shown })),
  );
}

/** An image as a file block of its own (its width kept only when asked: a width in a row is the row's). */
function alone(id: string, f: FileShown, at?: Block["at"]): FileBlock {
  return { id, type: "file", ...f, ...(at ? { at } : {}) } as FileBlock;
}
/** The image without its width (it joins or leaves a row: the row's sizes start even, Juan 2026-10-30). */
const unsized = ({ width: _w, ...f }: FileShown): FileShown => f;
/** A block holding these images: a row when there are two or more, a file block for one, nothing for none. */
function holding(b: FileBlock | RowBlock, files: FileShown[]): Block[] {
  if (!files.length) return [];
  if (files.length === 1) return [alone(b.id, unsized(files[0] as FileShown), b.at)];
  return [{ id: b.id, type: "files", files, ...(b.at ? { at: b.at } : {}) } as RowBlock];
}

/** The page with one image changed (its width, its crop); null when it is not there or stays the same. */
export function withImage(
  blocks: readonly Block[],
  at: ImageAt,
  change: (f: FileShown) => FileShown,
): Block[] | null {
  const i = blocks.findIndex((b) => b.id === at.block);
  const b = blocks[i];
  if (!b || (b.type !== "file" && b.type !== "files")) return null;
  const files = shownOf(b);
  const was = files[at.index];
  if (!was) return null;
  const now = change(was);
  if (JSON.stringify(now) === JSON.stringify(was)) return null;
  const next: Block =
    b.type === "file"
      ? alone(b.id, now, b.at)
      : { ...b, files: files.map((f, k) => (k === at.index ? now : f)) };
  return blocks.map((x, k) => (k === i ? next : x));
}

/** An image at this width (CSS pixels, whole; undefined: as it comes, up to the text's width). */
export const sized =
  (width: number | undefined) =>
  (f: FileShown): FileShown => {
    const { width: _w, ...rest } = f;
    return width ? { ...rest, width: Math.round(width) } : rest;
  };

/** An image showing this part of it (undefined: all of it); the numbers kept to one decimal inside the image. */
export const cropped =
  (crop: Crop | undefined) =>
  (f: FileShown): FileShown => {
    const { crop: _c, ...rest } = f;
    const c = crop && tidyCrop(crop);
    return c ? { ...rest, crop: c } : rest;
  };

/** A crop as the text keeps it: one decimal, inside the image, at least 1 % wide and high; null for the whole image. */
export function tidyCrop(c: Crop): Crop | null {
  const r = (n: number) => Math.round(n * 10) / 10;
  const w = r(Math.min(100, Math.max(1, c.w)));
  const h = r(Math.min(100, Math.max(1, c.h)));
  const x = r(Math.min(100 - w, Math.max(0, c.x)));
  const y = r(Math.min(100 - h, Math.max(0, c.y)));
  if (x === 0 && y === 0 && w === 100 && h === 100) return null;
  return { x, y, w, h };
}

/**
 * The page with an image moved: above or below a block it is an image of its own; beside another it joins that one's
 * row (two images alone make one). A row left with one image is a file block again. Null when nothing would change
 * or the row is full.
 */
export function moveImage(
  blocks: readonly Block[],
  from: ImageAt,
  to: ImageDrop,
  makeId: () => string,
): Block[] | null {
  const src = blocks.find((b) => b.id === from.block);
  if (!src || (src.type !== "file" && src.type !== "files")) return null;
  const moving = shownOf(src)[from.index];
  if (!moving) return null;
  const target = blocks.find((b) => b.id === to.block);
  if (!target) return null;
  if (src.type === "file" && target === src) return null;
  // The image beside which it goes, by itself (its place may change once the moving one leaves its row).
  const besideOf =
    "index" in to && (target.type === "file" || target.type === "files")
      ? shownOf(target)[to.index]
      : undefined;
  if ("index" in to && !besideOf) return null;
  const sameRow = target === src;
  if (sameRow && src.type === "files" && "index" in to) {
    // Within its row: only its place changes.
    if (besideOf === moving) return null;
    const files = src.files.filter((_, k) => k !== from.index);
    const k = files.indexOf(besideOf as FileShown);
    files.splice(to.side === "left" ? k : k + 1, 0, moving);
    if (files.every((f, i) => f === src.files[i])) return null;
    return blocks.map((b) => (b === src ? { ...src, files } : b));
  }
  if ("index" in to && !sameRow && target.type === "files" && target.files.length >= ROW_MAX)
    return null;

  // The page without the moving image.
  const left: Block[] = [];
  for (const b of blocks) {
    if (b !== src) left.push(b);
    else if (src.type === "files")
      left.push(
        ...holding(
          src,
          src.files.filter((_, k) => k !== from.index),
        ),
      );
  }

  let out: Block[];
  if (!("index" in to)) {
    const at = left.findIndex((b) => b.id === to.block);
    if (at < 0) return null;
    const made = src.type === "file" ? (src as FileBlock) : alone(makeId(), unsized(moving));
    const where = to.side === "above" ? at : at + 1;
    out = [...left.slice(0, where), made, ...left.slice(where)];
  } else {
    const at = left.findIndex((b) => b.id === to.block);
    const host = left[at];
    if (!host || (host.type !== "file" && host.type !== "files")) return null;
    const files =
      host.type === "files" ? [...host.files] : [unsized(shownOf(host)[0] as FileShown)];
    const k = files.indexOf(
      host.type === "files" ? (besideOf as FileShown) : (files[0] as FileShown),
    );
    const beside = host.type === "files" ? k : 0;
    files.splice(to.side === "left" ? beside : beside + 1, 0, unsized(moving));
    const row: RowBlock = {
      id: host.id,
      type: "files",
      files,
      ...(host.at ? { at: host.at } : {}),
    } as RowBlock;
    out = left.map((b, i) => (i === at ? row : b));
  }
  const same =
    out.length === blocks.length && out.every((b, i) => blockSame(b, blocks[i] as Block));
  return same ? null : out;
}

const blockSame = (a: Block, b: Block) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** The page with a row's images each a block of its own, in their order, the first keeping the row's id. */
export function splitRow(
  blocks: readonly Block[],
  id: string,
  makeId: () => string,
): Block[] | null {
  const b = blocks.find((x) => x.id === id);
  if (b?.type !== "files") return null;
  return blocks.flatMap((x) =>
    x === b
      ? b.files.map((f, k) => alone(k ? makeId() : b.id, unsized(f), k ? undefined : b.at))
      : [x],
  );
}

/** The smallest crop the box is made (% of the image's width and height). */
const SMALLEST = 5;

/** A crop's box after one of its corners, or the box itself, moved by (dx, dy) % of the image; kept inside it. */
export function reshaped(
  b: Crop,
  part: "move" | "nw" | "ne" | "sw" | "se",
  dx: number,
  dy: number,
): Crop {
  if (part === "move")
    return {
      ...b,
      x: Math.min(100 - b.w, Math.max(0, b.x + dx)),
      y: Math.min(100 - b.h, Math.max(0, b.y + dy)),
    };
  let left = b.x;
  let top = b.y;
  let right = b.x + b.w;
  let bottom = b.y + b.h;
  if (part === "nw" || part === "sw") left = Math.min(right - SMALLEST, Math.max(0, left + dx));
  else right = Math.max(left + SMALLEST, Math.min(100, right + dx));
  if (part === "nw" || part === "ne") top = Math.min(bottom - SMALLEST, Math.max(0, top + dy));
  else bottom = Math.max(top + SMALLEST, Math.min(100, bottom + dy));
  return { x: left, y: top, w: right - left, h: bottom - top };
}
