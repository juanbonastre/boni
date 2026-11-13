// A note's text through the editor's engine and back (task 2g): byte for byte, an edit only where it was made.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readMarkdown, writeMarkdown } from "@boni/views";
import { Node as PMNode } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { longNote, NOTES } from "../../../../packages/views/src/notes.test-util.ts";
import type { Page } from "./agent.ts";
import { blocksOfDoc, docOf, inRun, isText, schema, spliceRun } from "./docModel.ts";
import { applyEdits, inlineSpans, plainText, toggleWrap } from "./inline.ts";

type Block = Page["spec"]["blocks"][number];

/**
 * A note read, its blocks in the engine's documents (a run of the blocks it takes, the others between them as they
 * are), the documents rebuilt from what they hold alone (no block objects kept), and the note written back.
 */
function throughEngine(md: string): string {
  const { blocks, source } = readMarkdown(md);
  const out: Block[] = [];
  let run: Block[] = [];
  const flush = () => {
    if (!run.length) return;
    const fresh = PMNode.fromJSON(schema, JSON.parse(JSON.stringify(docOf(run).toJSON())));
    out.push(...blocksOfDoc(fresh));
    run = [];
  };
  for (const b of blocks as Block[]) {
    if (inRun(b)) run.push(b);
    else {
      flush();
      out.push(b);
    }
  }
  flush();
  return writeMarkdown(out, source);
}

/** Where two texts first differ, for a report a person can read. */
function firstDifference(a: string, b: string): string {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `at ${i}: ${JSON.stringify(a.slice(Math.max(0, i - 20), i + 20))} → ${JSON.stringify(b.slice(Math.max(0, i - 20), i + 20))}`;
}

describe("a note through the editor's engine (task 2g)", () => {
  it("comes back byte for byte: every note of the corpus and a year of a journal", () => {
    const notes = { ...NOTES, "a year of a journal": longNote(365) };
    const differ = Object.entries(notes).flatMap(([name, md]) => {
      const back = throughEngine(md);
      return back === md ? [] : [`${name}: ${firstDifference(md, back)}`];
    });
    expect(differ).toEqual([]);
  });

  it("an edit typed in one block changes only that block's text", () => {
    const md = NOTES["spelled every other way"] as string;
    const { blocks, source } = readMarkdown(md);
    const doc = docOf(blocks as Block[]);
    let state = EditorState.create({ schema, doc });
    // The caret at the end of the third block, and a word typed.
    let pos = 0;
    for (let i = 0; i < 2; i++) pos += doc.child(i).nodeSize;
    const at = pos + doc.child(2).nodeSize - 1;
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, at)).insertText(" más"),
    );
    const after = blocksOfDoc(state.doc);
    expect(after.filter((b, i) => b !== blocks[i]).map((b) => b.id)).toEqual([blocks[2]?.id]);
    const back = writeMarkdown(after, source);
    const span = source.spans.get(blocks[2]?.id as string);
    expect(back.slice(0, span?.from)).toBe(md.slice(0, span?.from));
    expect(back.slice(-(md.length - (span?.to ?? 0)))).toBe(md.slice(span?.to));
  });

  it("text selected from one block to another and deleted joins them; the rest stays", () => {
    const blocks: Block[] = [
      { id: "a", type: "text", text: "primero" },
      { id: "b", type: "bullet", text: "segundo" },
      { id: "c", type: "text", text: "tercero" },
    ];
    let state = EditorState.create({ schema, doc: docOf(blocks) });
    // From «pri|mero» to «seg|undo».
    const from = 1 + 3;
    const to = blocks[0] && 1 + 7 + 1 + 1 + 3;
    state = state.apply(state.tr.delete(from, to as number));
    const after = blocksOfDoc(state.doc);
    expect(after).toEqual([
      { id: "a", type: "text", text: "priundo" },
      { id: "c", type: "text", text: "tercero" },
    ]);
    expect(after[1]).toBe(blocks[2]);
  });
});

describe("a run's blocks written back into the page", () => {
  const page: Block[] = [
    { id: "t", type: "toggle", text: "plegado", open: false },
    { id: "h", type: "text", text: "oculto", indent: 1 },
    { id: "p", type: "text", text: "después" },
    { id: "c", type: "chart", chart: "x" },
    { id: "q", type: "text", text: "fuera" },
  ];
  it("keeps a folded toggle's blocks where they were", () => {
    const t2 = { id: "t", type: "toggle", text: "plegado!", open: false } as Block;
    expect(spliceRun(page, ["t", "p"], [t2, page[2] as Block]).map((b) => b.id)).toEqual([
      "t",
      "h",
      "p",
      "c",
      "q",
    ]);
  });
  it("a block gone leaves; a new one goes after the one before it in the run", () => {
    const n = { id: "n", type: "text", text: "nuevo" } as Block;
    expect(spliceRun(page, ["t", "p"], [page[0] as Block, n]).map((b) => b.id)).toEqual([
      "t",
      "h",
      "n",
      "c",
      "q",
    ]);
    expect(spliceRun(page, ["t", "p"], [n, page[2] as Block]).map((b) => b.id)).toEqual([
      "h",
      "n",
      "p",
      "c",
      "q",
    ]);
  });
});

/** A block's formats as the editor paints them: each one inside its text, its marks and words in order. */
function formatsHold(text: string): string | null {
  for (const sp of inlineSpans(text)) {
    const [a, b] = sp.inner;
    if (!(0 <= sp.from && sp.from <= a && a <= b && b <= sp.to && sp.to <= text.length))
      return `${sp.kind} at ${sp.from} is out of its text`;
    for (const [x, y] of sp.marks)
      if (!(sp.from <= x && x <= y && y <= sp.to) || (x < b && y > a))
        return `${sp.kind} at ${sp.from}: a mark over its words`;
  }
  plainText(text);
  return null;
}

describe("a note's inline formats painted (task 2f)", () => {
  it("every block of the corpus: its formats inside its text, and a format put on and off gives back its bytes", () => {
    const notes = { ...NOTES, "a year of a journal": longNote(365) };
    for (const [name, md] of Object.entries(notes))
      for (const b of readMarkdown(md).blocks as Block[]) {
        if (!isText(b) || b.type === "code") continue;
        expect(formatsHold(b.text), `${name}: ${b.text}`).toBeNull();
        const word = b.text.match(/\p{L}{3,}/u);
        if (!word || word.index === undefined) continue;
        for (const kind of ["strong", "em", "strike", "code"] as const) {
          const on = toggleWrap(b.text, word.index, word.index + word[0].length, kind);
          if (!on) continue;
          const once = applyEdits(b.text, on.edits);
          const off = toggleWrap(once, on.from, on.to, kind);
          // Some words are inside a format of their own kind already: taking it off is what the key does then.
          if (off) expect(applyEdits(once, off.edits), `${name}: ${b.text}`).toBe(b.text);
        }
      }
  });
});

/**
 * The read-only check on a folder of real notes (never in CI, never Juan's notes in this repo): with
 * `BONI_NOTES_DIR` set to a folder of Markdown files (an export of a vault), every file goes through the engine and
 * back, and every one that would change is named. It writes nothing.
 */
describe.runIf(!!process.env.BONI_NOTES_DIR)("notes of a folder through the engine", () => {
  it("come back byte for byte", () => {
    const dir = process.env.BONI_NOTES_DIR as string;
    const files: string[] = [];
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith(".md")) files.push(p);
      }
    };
    walk(dir);
    const started = performance.now();
    let formats = 0;
    const differ = files.flatMap((p) => {
      const md = readFileSync(p, "utf8");
      const back = throughEngine(md);
      const name = p.slice(dir.length + 1);
      // Its formats as the editor paints them (task 2f): each inside its block's text.
      const painted = (readMarkdown(md).blocks as Block[]).flatMap((b) => {
        if (!isText(b) || b.type === "code") return [];
        formats += inlineSpans(b.text).length;
        const wrong = formatsHold(b.text);
        return wrong ? [`${name}: ${wrong}`] : [];
      });
      return [...(back === md ? [] : [`${name}: ${firstDifference(md, back)}`]), ...painted];
    });
    console.info(
      `${files.length} notes, ${differ.length} would change, ${formats} formats painted, ${Math.round(performance.now() - started)} ms`,
    );
    expect(differ).toEqual([]);
  });
});
