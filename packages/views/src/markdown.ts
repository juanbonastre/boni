import { type FileShown, isCrop, type PageBlock, pageErrors, ROW_MAX } from "./page.ts";

/**
 * A note's text (Markdown, as the vault kept it and Boni keeps a row's body) as the page editor's blocks, and back
 * (Juan, 2026-10-22: notes edited as pages). What the editor paints: headings (#, ##, ###), paragraphs, bullets,
 * numbered items, to-dos, quotes, code fences, dividers, nested with indentation. Everything else (tables, images,
 * HTML, deeper headings) stays as a paragraph holding its lines as they were, so nothing is lost: a note that is
 * opened and not edited is never written again, and one that is edited keeps what the editor does not know.
 * A note is a page (Juan, 2026-10-26: the same editor, every block): a block Markdown cannot say (a number, a chart,
 * a database, a button) travels as a fenced block marked «boni» holding the block as JSON; it comes back the same
 * block, and anything there that is not a valid block stays a code block as it was, never lost.
 */

type Block = PageBlock;
type Indent = 1 | 2 | 3 | 4;

const indentOf = (spaces: string): Indent | undefined => {
  const n = spaces.replace(/\t/g, "    ").length;
  const level = Math.min(4, Math.floor(n / 2)) as 0 | Indent;
  return level ? level : undefined;
};

/** The note's first-level heading when it opens the text: the note's real title (its file had a slug). */
export function leadingTitle(md: string): { title: string; rest: string } | null {
  const m = /^\s*#\s+(.+?)\s*#*\s*(?:\r?\n|$)/.exec(md);
  if (!m) return null;
  return { title: (m[1] as string).trim(), rest: md.slice(m[0].length).replace(/^\s*\n/, "") };
}

export function markdownToBlocks(md: string): Block[] {
  return readMarkdown(md).blocks;
}

/**
 * Where each block of a note's text came from (task 2g: Juan's notes are data and do not change by being opened or
 * by an edit elsewhere): the text as it was read, each block's span in it and what the block was then.
 * `writeMarkdown` writes a block that is still what it was as those very bytes, and the gap between two such blocks
 * that were next to each other as it was, so an edit changes only what was edited: a list written with «*», a
 * numbering that skips, two blank lines, «\r\n», a missing last newline or a fence never closed stay as they were.
 */
export interface MarkdownSource {
  readonly text: string;
  /** Per block id: its span in `text`, its place among the blocks read, and the block then (`blockKey`). */
  readonly spans: ReadonlyMap<string, { from: number; to: number; index: number; key: string }>;
  /** The ids of the blocks read, in their order. */
  readonly ids: readonly string[];
}

/** A block's content as a key that does not depend on the order of its fields. */
export function blockKey(b: Block): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v as object)
              .sort()
              .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(sort(b));
}

/** A note's text as the editor's blocks, with where each came from (`MarkdownSource`). */
export function readMarkdown(md: string): { blocks: Block[]; source: MarkdownSource } {
  // Where each line starts and ends in `md` («\r\n» and «\r» end a line, as the parser reads them).
  const starts: number[] = [0];
  const ends: number[] = [];
  for (let k = 0; k < md.length; k++) {
    const c = md[k];
    if (c !== "\n" && c !== "\r") continue;
    ends.push(k);
    if (c === "\r" && md[k + 1] === "\n") k++;
    starts.push(k + 1);
  }
  ends.push(md.length);
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  /** Each block's first and last line. */
  const lineSpans: [number, number][] = [];
  let n = 0;
  const id = () => `md${++n}`;
  let para: string[] = [];
  let paraAt = 0;
  // The line an iteration of the loop starts at, and how many blocks there were then.
  let at = 0;
  let before = 0;
  const flush = () => {
    if (para.length) {
      out.push({ id: id(), type: "text", text: para.join("\n") });
      lineSpans.push([paraAt, paraAt + para.length - 1]);
      before = out.length;
    }
    para = [];
  };
  /** The block an iteration made spans from the line it started at to the one it ended at. */
  const record = (i: number) => {
    for (let k = before; k < out.length; k++) lineSpans.push([at, Math.min(i, lines.length - 1)]);
  };
  /** A «boni» fence's block (JSON of one block) as the block, its id never one already used or a later `md<N>`. */
  const fromBoni = (b: Block): Block => {
    const taken = new Set(out.map((x) => x.id));
    const m = /^md(\d+)$/.exec(b.id);
    if (m) n = Math.max(n, Number(m[1]));
    if (taken.has(b.id)) return { ...b, id: id() };
    return b;
  };
  for (let i = 0; i < lines.length; record(i), i++) {
    at = i;
    before = out.length;
    const line = lines[i] as string;
    // A code fence: its lines as they are, until a closing fence of the same character, at least as long (Markdown).
    const fence = /^(\s*)(`{3,}|~{3,})\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      flush();
      const marker = fence[2] as string;
      const char = marker[0] as string;
      const min = marker.length;
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const c = (lines[j] as string).trim();
        if (c.length >= min && [...c].every((x) => x === char)) break;
        body.push(lines[j] as string);
        j++;
      }
      const code: Block = {
        id: id(),
        type: "code",
        text: body.join("\n"),
        ...(fence[3] ? { lang: fence[3] } : {}),
        ...(indentOf(fence[1] as string) ? { indent: indentOf(fence[1] as string) } : {}),
      };
      // A block Markdown cannot say travels as a fenced block marked «boni»; what there is not a valid block
      // stays a code block as it was (Juan, 2026-10-26: one kind of page, nothing is lost).
      if (code.lang === "boni") {
        try {
          const block = JSON.parse(code.text) as Block;
          if (pageErrors({ version: 1, blocks: [block] }).length === 0) {
            out.push(fromBoni(block));
            i = j;
            continue;
          }
        } catch {
          // not JSON: the code block as it was
        }
      }
      out.push(code);
      i = j;
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = /^(#{1,3})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      flush();
      out.push({
        id: id(),
        type: "heading",
        text: h[2] as string,
        level: (h[1] as string).length as 1 | 2 | 3,
      });
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
      out.push({ id: id(), type: "divider" });
      continue;
    }
    const todo = /^(\s*)[-*+]\s+\[( |x|X)\]\s?(.*)$/.exec(line);
    if (todo) {
      flush();
      const ind = indentOf(todo[1] as string);
      out.push({
        id: id(),
        type: "todo",
        text: todo[3] as string,
        ...(todo[2] !== " " ? { done: true } : {}),
        ...(ind ? { indent: ind } : {}),
      });
      continue;
    }
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      const ind = indentOf(bullet[1] as string);
      out.push({
        id: id(),
        type: "bullet",
        text: bullet[2] as string,
        ...(ind ? { indent: ind } : {}),
      });
      continue;
    }
    const num = /^(\s*)\d+[.)]\s+(.*)$/.exec(line);
    if (num) {
      flush();
      const ind = indentOf(num[1] as string);
      out.push({
        id: id(),
        type: "numbered",
        text: num[2] as string,
        ...(ind ? { indent: ind } : {}),
      });
      continue;
    }
    // A quote: its consecutive "> " lines are one block (an Obsidian callout "> [!note]" stays as written).
    if (/^>\s?/.test(line) && !/^>\s*\[!/.test(line)) {
      flush();
      const q: string[] = [line.replace(/^>\s?/, "")];
      while (i + 1 < lines.length && /^>\s?/.test(lines[i + 1] as string)) {
        i++;
        q.push((lines[i] as string).replace(/^>\s?/, ""));
      }
      out.push({ id: id(), type: "quote", text: q.join("\n") });
      continue;
    }
    // A file of the user's alone on its line (`![name|width|crop=x,y,w,h](boni:<id>)`): shown in place, as the
    // page's own block; several on one line and nothing else, a row of them side by side (task 2h).
    const shown = filesOfLine(line);
    if (shown) {
      flush();
      out.push(
        shown.length === 1
          ? { id: id(), type: "file", ...(shown[0] as FileShown) }
          : { id: id(), type: "files", files: shown },
      );
      continue;
    }
    // Anything else is a paragraph's line, kept as written (tables, images, links, deeper headings...).
    if (!para.length) paraAt = i;
    para.push(line);
  }
  flush();
  const spans = new Map<string, { from: number; to: number; index: number; key: string }>();
  out.forEach((b, index) => {
    const [first, last] = lineSpans[index] as [number, number];
    spans.set(b.id, {
      from: starts[first] as number,
      to: ends[last] as number,
      index,
      key: blockKey(b),
    });
  });
  return { blocks: out, source: { text: md, spans, ids: out.map((b) => b.id) } };
}

const LIST = new Set(["bullet", "numbered", "todo"]);

/** A fence long enough that no line of `text` can close it (its longest leading run of the same character, plus one). */
function fenceFor(text: string): string {
  let need = 3;
  for (const line of text.split("\n")) {
    const c = line[0];
    if (c !== "`" && c !== "~") continue;
    let run = 0;
    while (line[run] === c) run++;
    need = Math.max(need, run + 1);
  }
  return "`".repeat(need);
}

/**
 * A file of the user's as Markdown (task 2h, extending the width it already had): its name, then its width and the
 * part of it shown after bars, as Obsidian writes a width; the address stays `boni:<id>`, so any reader of the text
 * still finds the file and shows it whole.
 */
export function fileLink(f: FileShown): string {
  const c = f.crop;
  return `![${f.name.replace(/[\]|\n]/g, " ")}${f.width ? `|${f.width}` : ""}${
    c ? `|crop=${c.x},${c.y},${c.w},${c.h}` : ""
  }](boni:${f.file})`;
}

const NUM = String.raw`\d{1,3}(?:\.\d)?`;
const FILE_LINK = new RegExp(
  String.raw`!\[([^\]|\n]*)(?:\|(\d{2,4}))?(?:\|crop=(${NUM}),(${NUM}),(${NUM}),(${NUM}))?\]\(boni:([a-z0-9][a-z0-9_-]{0,63})\)`,
  "iy",
);

/**
 * The files of a line that holds only files of the user's (one, or a row of up to `ROW_MAX` with spaces between):
 * null for any other line, which stays as it was written (a crop outside its image, a ninth image, a word between).
 */
export function filesOfLine(line: string): FileShown[] | null {
  if (!line.includes("](boni:")) return null;
  const out: FileShown[] = [];
  let at = (/^\s*/.exec(line) as RegExpExecArray)[0].length;
  for (;;) {
    FILE_LINK.lastIndex = at;
    const m = FILE_LINK.exec(line);
    if (!m) return null;
    const crop = m[3]
      ? { x: Number(m[3]), y: Number(m[4]), w: Number(m[5]), h: Number(m[6]) }
      : undefined;
    if (crop && !isCrop(crop)) return null;
    out.push({
      file: m[7] as string,
      name: (m[1] as string).trim(),
      ...(m[2] ? { width: Number(m[2]) } : {}),
      ...(crop ? { crop } : {}),
    });
    const rest = line.slice(FILE_LINK.lastIndex);
    if (/^\s*$/.test(rest)) break;
    at = FILE_LINK.lastIndex + (/^[ \t]*/.exec(rest) as RegExpExecArray)[0].length;
  }
  return out.length && out.length <= ROW_MAX ? out : null;
}

export function blocksToMarkdown(blocks: readonly Block[]): string {
  return writeMarkdown(blocks, null);
}

/**
 * The blocks as a note's text. With the `source` they were read from (`readMarkdown`), a block that is still what it
 * was is written as its very bytes there, and so is the gap between two such blocks that were next to each other, the
 * text before the first and after the last: the blocks as read give back the text as read, byte for byte, and an
 * edit changes only the blocks edited (and the gaps around them, written as `blocksToMarkdown` writes them).
 */
export function writeMarkdown(blocks: readonly Block[], source: MarkdownSource | null): string {
  const parts: string[] = [];
  let prev: Block | null = null;
  /** The span in the source of the block written last, when it was written as it was there. */
  let prevKept: { from: number; to: number; index: number } | null = null;
  const counters: number[] = [];
  for (const b of blocks) {
    const ind = "indent" in b && b.indent ? b.indent : 0;
    const pad = "  ".repeat(ind);
    let text: string;
    switch (b.type) {
      case "heading":
        text = `${"#".repeat(b.level ?? 1)} ${b.text}`;
        break;
      case "bullet":
        text = `${pad}- ${b.text}`;
        break;
      case "todo":
        text = `${pad}- [${b.done ? "x" : " "}] ${b.text}`;
        break;
      case "numbered": {
        // Numbers go on while the list does (items nested deeper do not break it).
        const goesOn = prev !== null && LIST.has(prev.type) && counters[ind] !== undefined;
        counters.length = ind + 1;
        counters[ind] = goesOn ? (counters[ind] as number) + 1 : 1;
        text = `${pad}${counters[ind]}. ${b.text}`;
        break;
      }
      case "quote":
        text = b.text
          .split("\n")
          .map((l) => (l ? `> ${l}` : ">"))
          .join("\n");
        break;
      case "code": {
        const lang = (b as { lang?: string }).lang ?? "";
        const fence = fenceFor(b.text);
        text = `${pad}${fence}${lang}\n${b.text}\n${pad}${fence}`;
        break;
      }
      case "divider":
        text = "---";
        break;
      case "file":
        text = fileLink(b);
        break;
      case "files":
        text = b.files.map(fileLink).join(" ");
        break;
      case "toggle":
      case "callout":
        text = `${pad}${b.text}`;
        break;
      case "text":
        text = b.text;
        break;
      default: {
        // A block Markdown cannot say (a chart, a number, a database, a button) travels as a fenced block
        // marked «boni» holding the block as JSON; it comes back the same block (Juan, 2026-10-26).
        const json = JSON.stringify(b);
        const fence = fenceFor(json);
        text = `${pad}${fence}boni\n${json}\n${pad}${fence}`;
      }
    }
    // A bullet or a to-do ends the numbering at its level; anything that is not a list ends every one.
    if (b.type === "bullet" || b.type === "todo") counters.length = Math.min(counters.length, ind);
    else if (b.type !== "numbered") counters.length = 0;
    // List items follow each other without a blank line; everything else is a paragraph of its own.
    const tight =
      prev &&
      LIST.has(prev.type) &&
      LIST.has(b.type) &&
      (prev.type === "numbered") === (b.type === "numbered");
    const span = source?.spans.get(b.id);
    const src = source?.text ?? "";
    const same = span && span.key === blockKey(b);
    // Only its text changed: its marker, spacing and closing hashes are kept as they were written («* », «#  »).
    const retyped =
      span && !same
        ? (textEdited(src.slice(span.from, span.to), span.key, b) ??
          imageEdited(src.slice(span.from, span.to), span.key, b))
        : null;
    const kept = same || retyped !== null ? span : null;
    if (!parts.length) {
      // Before the first block: what was there, when it is still the first one read.
      if (kept?.index === 0) parts.push(src.slice(0, kept.from));
    } else if (kept && prevKept && prevKept.index === kept.index - 1)
      parts.push(src.slice(prevKept.to, kept.from));
    else parts.push(tight ? "\n" : "\n\n");
    parts.push(retyped ?? (kept ? src.slice(kept.from, kept.to) : text));
    prev = b;
    prevKept = kept ?? null;
  }
  // No blocks: a text that had none (blank lines) stays as it was; one whose blocks were all taken away is empty.
  if (!parts.length) return source && !source.ids.length ? source.text : "";
  // After the last block: what was there, when it is still the last one read.
  const end =
    prevKept && source && prevKept.index === source.ids.length - 1
      ? source.text.slice(prevKept.to)
      : "\n";
  return `${parts.join("")}${end}`;
}

/** A line's marker as it may be written: a heading's hashes, a list's dash, star, plus or number, a to-do's box. */
const MARKER = /^[ \t]*(?:#{1,6}[ \t]+|(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)/;

/**
 * A block whose text alone changed, written as it was (`written`, the block then as `key`) with its old text replaced:
 * the marker before it and what closes it (a heading's trailing spaces or hashes) as they were. Null when it is not
 * that block written that way, and then the block is written as Boni writes it.
 */
function textEdited(written: string, key: string, b: Block): string | null {
  if (!("text" in b) || typeof b.text !== "string") return null;
  if (!["text", "heading", "bullet", "todo", "numbered"].includes(b.type)) return null;
  const was = JSON.parse(key) as { text?: unknown };
  if (typeof was.text !== "string" || !was.text) return null;
  if (blockKey({ ...was, text: b.text } as Block) !== blockKey(b)) return null;
  const marker = b.type === "text" ? "" : (MARKER.exec(written)?.[0] ?? "");
  if (b.type !== "text" && !marker) return null;
  if (!written.startsWith(was.text, marker.length)) return null;
  const after = written.slice(marker.length + was.text.length);
  if (!/^[ \t#]*$/.test(after)) return null;
  return `${marker}${b.text}${after}`;
}

/**
 * An image or a row of them changed in place (task 2h: a width, a crop, one more beside it): its line written anew
 * with the spaces it had around it, so the lines next to it stay as they were (a row right under another, no blank
 * line between them).
 */
function imageEdited(written: string, key: string, b: Block): string | null {
  if (b.type !== "file" && b.type !== "files") return null;
  const was = JSON.parse(key) as { type?: unknown };
  if (was.type !== "file" && was.type !== "files") return null;
  const lead = (/^[ \t]*/.exec(written) as RegExpExecArray)[0];
  const trail = (/[ \t]*$/.exec(written) as RegExpExecArray)[0];
  return `${lead}${b.type === "file" ? fileLink(b) : b.files.map(fileLink).join(" ")}${trail}`;
}

/** The blocks of a note's text that say something of their own: what can be pointed at as a paragraph (F9). */
export const PART_KINDS: ReadonlySet<string> = new Set([
  "heading",
  "text",
  "bullet",
  "numbered",
  "todo",
  "toggle",
  "quote",
  "callout",
  "code",
]);

/**
 * A paragraph of a note as a reference (docs/sistema.md §4.7, F9): its blocks are made as it is read and their ids
 * (`md<N>`) move with every block written before them, so a paragraph is named by what it says (an FNV-1a hash of
 * its text, as eight hex digits) and which of those it is when the same words appear more than once. The app and
 * the server compute it the same way; the server finds the paragraph again in the text it keeps.
 */
export function partKey(text: string): string {
  let h = 0x811c9dc5;
  const s = text.replace(/\s+/g, " ").trim();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Where a paragraph is among a note's blocks: its key, and how many before it say the same; null for no paragraph. */
export function partOf(
  blocks: readonly PageBlock[],
  id: string,
): { part: string; n: number } | null {
  const i = blocks.findIndex((b) => b.id === id);
  const b = blocks[i];
  if (!b || !PART_KINDS.has(b.type) || !("text" in b) || !b.text.trim()) return null;
  const part = partKey(b.text);
  let n = 0;
  for (const x of blocks.slice(0, i))
    if (PART_KINDS.has(x.type) && "text" in x && partKey(x.text) === part) n++;
  return { part, n };
}

const keysOf = new WeakMap<PageBlock, string>();
/**
 * `partOf` for every paragraph of a note at once, by block id, in one pass: what a note's editor marks its blocks with
 * as the note is typed (task 2g), each block's key worked out once for as long as the block is the same.
 */
export function partsOf(blocks: readonly PageBlock[]): Map<string, { part: string; n: number }> {
  const out = new Map<string, { part: string; n: number }>();
  const seen = new Map<string, number>();
  for (const b of blocks) {
    if (!PART_KINDS.has(b.type) || !("text" in b)) continue;
    let part = keysOf.get(b);
    if (part === undefined) {
      part = partKey(b.text);
      keysOf.set(b, part);
    }
    const n = seen.get(part) ?? 0;
    seen.set(part, n + 1);
    if (b.text.trim()) out.set(b.id, { part, n });
  }
  return out;
}

/** The paragraph a reference names in a note's text, found again by its words; null when it is no longer there. */
export function findPart(blocks: readonly PageBlock[], part: string, n: number): string | null {
  const same = blocks.flatMap((b) =>
    PART_KINDS.has(b.type) && "text" in b && partKey(b.text) === part ? [b.text] : [],
  );
  return same[n] ?? same[0] ?? null;
}
