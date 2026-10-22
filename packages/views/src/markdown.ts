import type { PageBlock } from "./page.ts";

/**
 * A note's text (Markdown, as the vault kept it and Boni keeps a row's body) as the page editor's blocks, and back
 * (Juan, 2026-10-22: notes edited as pages). What the editor paints: headings (#, ##, ###), paragraphs, bullets,
 * numbered items, to-dos, quotes, code fences, dividers, nested with indentation. Everything else (tables, images,
 * HTML, deeper headings) stays as a paragraph holding its lines as they were, so nothing is lost: a note that is
 * opened and not edited is never written again, and one that is edited keeps what the editor does not know.
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
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let n = 0;
  const id = () => `md${++n}`;
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ id: id(), type: "text", text: para.join("\n") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    // A code fence: its lines as they are, until the closing fence.
    const fence = /^(\s*)(```|~~~)\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !(lines[j] as string).trim().startsWith(fence[2] as string)) {
        body.push(lines[j] as string);
        j++;
      }
      out.push({
        id: id(),
        type: "code",
        text: body.join("\n"),
        ...(fence[3] ? { lang: fence[3] } : {}),
        ...(indentOf(fence[1] as string) ? { indent: indentOf(fence[1] as string) } : {}),
      } as Block);
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
    // Anything else is a paragraph's line, kept as written (tables, images, links, deeper headings...).
    para.push(line);
  }
  flush();
  return out;
}

const LIST = new Set(["bullet", "numbered", "todo"]);

export function blocksToMarkdown(blocks: readonly Block[]): string {
  const parts: string[] = [];
  let prev: Block | null = null;
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
        text = `${pad}\`\`\`${lang}\n${b.text}\n${pad}\`\`\``;
        break;
      }
      case "divider":
        text = "---";
        break;
      case "toggle":
      case "callout":
        text = `${pad}${b.text}`;
        break;
      case "text":
        text = b.text;
        break;
      default:
        continue; // charts, databases, buttons, subpages: not in a note's text
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
    if (parts.length) parts.push(tight ? "\n" : "\n\n");
    parts.push(text);
    prev = b;
  }
  return parts.length ? `${parts.join("")}\n` : "";
}
