/**
 * A note's text in parts, for an assistant that cannot take it whole (task 112, A-30). The MCP's client refuses a
 * tool's answer over its output limit (Claude Code: 25,000 tokens by default, `MAX_MCP_OUTPUT_TOKENS`), so a note
 * of 100,000 characters could not be read at all, and one of 40,000 cost the whole note to see one section. Over
 * `PART` characters, `read` gives the note's outline (each Markdown heading with its level, where it starts and its
 * size, its subsections included) and the start of its text; a section by its heading, or a range by offset and
 * length, gives the rest, never more than `PART` at a time.
 *
 * Characters are Unicode code points, as Python's `len` counts them (an accent is one, an emoji is one, never cut in
 * half), never bytes or UTF-16 units. Headings are ATX headings (`#` to `######`) outside code fences, the same
 * fences the editor reads (`packages/views/src/markdown.ts`).
 */

/**
 * The most text one answer of `read` carries (code points). Spanish Markdown runs about 3.5 characters per token,
 * and text dense with ids, numbers and code nearer 2.5; with its outline capped at `OUTLINE_MAX` and JSON's escapes
 * (a newline is two characters), an answer stays near 10,000 tokens and under 16,000 at worst: well under the
 * client's 25,000, and near the 10,000 over which Claude Code warns. A text made mostly of emoji or of Chinese or
 * Japanese, near a token per character, would not fit; none of Juan's notes is (they are Spanish and English).
 */
export const PART = 30_000;
/** The most an outline takes in an answer (characters of its JSON); deeper headings go first when it would not fit. */
export const OUTLINE_MAX = 8_000;

export interface Heading {
  /** Its text, without the `#`s. */
  heading: string;
  level: number;
  /** Where its line starts in the note (characters). */
  at: number;
  /** Its size up to the next heading of its level or higher, its subsections included (characters). */
  chars: number;
}

/** Code points of a string. */
export function charCount(s: string): number {
  let n = s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n--;
        i++;
      }
    }
  }
  return n;
}

/** The UTF-16 index where code point `cp` starts (from UTF-16 index `from`, at code point `fromCp`). */
function unitAt(s: string, cp: number, from = 0, fromCp = 0): number {
  let i = from;
  let k = fromCp;
  while (k < cp && i < s.length) {
    const c = s.charCodeAt(i);
    const pair = c >= 0xd800 && c <= 0xdbff && i + 1 < s.length;
    const d = pair ? s.charCodeAt(i + 1) : 0;
    i += pair && d >= 0xdc00 && d <= 0xdfff ? 2 : 1;
    k++;
  }
  return i;
}

/** `length` characters of `s` from character `offset`. */
export function charSlice(s: string, offset: number, length: number): string {
  const a = unitAt(s, offset);
  return s.slice(a, unitAt(s, offset + length, a, offset));
}

const FENCE = /^\s*(`{3,}|~{3,})/;
const ATX = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

/** The note's headings in order, each with its level, where it starts and its size (characters). */
export function outlineOf(text: string): Heading[] {
  const found: { heading: string; level: number; at: number }[] = [];
  let fence: string | null = null;
  let at = 0;
  for (const line of text.split("\n")) {
    const f = FENCE.exec(line);
    if (fence) {
      // A fence closes with the same character, at least as long, and nothing after it (Markdown).
      if (f && (f[1] as string)[0] === fence[0] && (f[1] as string).length >= fence.length)
        if (
          !line
            .trim()
            .slice((f[1] as string).length)
            .trim()
        )
          fence = null;
    } else if (f) fence = f[1] as string;
    else {
      const h = ATX.exec(line.replace(/\r$/, ""));
      if (h?.[2]?.trim()) found.push({ heading: h[2].trim(), level: (h[1] as string).length, at });
    }
    at += charCount(line) + 1;
  }
  const end = charCount(text);
  return found.map((h, i) => {
    let j = i + 1;
    while (j < found.length && (found[j] as Heading).level > h.level) j++;
    return { ...h, chars: (j < found.length ? (found[j] as Heading).at : end) - h.at };
  });
}

/** An outline that fits `OUTLINE_MAX`: the deepest levels dropped first, then cut; and what was left out. */
export function fitOutline(all: Heading[]): {
  outline: Heading[];
  deepest?: number;
  more?: number;
} {
  const size = (hs: Heading[]) => JSON.stringify(hs, null, 1).length;
  let outline = all;
  let deepest: number | undefined;
  while (size(outline) > OUTLINE_MAX) {
    let max = 0;
    let min = 7;
    for (const h of outline) {
      max = Math.max(max, h.level);
      min = Math.min(min, h.level);
    }
    if (max === min) break;
    deepest = max - 1;
    outline = outline.filter((h) => h.level < max);
  }
  if (size(outline) <= OUTLINE_MAX) return { outline, ...(deepest ? { deepest } : {}) };
  const kept: Heading[] = [];
  for (const h of outline) {
    if (size([...kept, h]) > OUTLINE_MAX) break;
    kept.push(h);
  }
  return {
    outline: kept,
    ...(deepest ? { deepest } : {}),
    more: outline.length - kept.length,
  };
}

/** The start of `text` (from character `from`, at most `PART`), cut after a line when one ends in its last quarter. */
export function startOf(
  text: string,
  from = 0,
  upTo = charCount(text),
): { text: string; next: number } {
  const room = Math.min(PART, upTo - from);
  let part = charSlice(text, from, room);
  if (from + room < upTo) {
    const nl = part.lastIndexOf("\n");
    if (nl >= part.length * 0.75) part = part.slice(0, nl + 1);
  }
  return { text: part, next: from + charCount(part) };
}

const norm = (h: string) =>
  h
    .replace(/^\s*#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("es");

/** The headings that are `name` (its text, with or without its `#`s; case and spacing do not count). */
export const headed = (outline: Heading[], name: string): Heading[] =>
  outline.filter((h) => norm(h.heading) === norm(name));
