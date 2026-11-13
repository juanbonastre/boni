import { describe, expect, it } from "vitest";
import {
  blocksToMarkdown,
  findPart,
  leadingTitle,
  markdownToBlocks,
  partKey,
  partOf,
  partsOf,
  readMarkdown,
  writeMarkdown,
} from "./markdown.ts";
import { longNote, NOTES } from "./notes.test-util.ts";
import { type PageBlock, pageErrors } from "./page.ts";

/** A data block as the editor puts it on the grid (invented; never a real collection). */
const NUMBER: PageBlock = {
  id: "b1",
  type: "number",
  title: "Gasto",
  collection: "t_movimiento",
  measure: "count",
  period: "month",
  bg: true,
  at: { row: "r1", col: 0, w: 3 },
};

/** An invented note with the shapes of the vault's (never a real one). */
const NOTE = `## Contexto

Un párrafo con **negrita** y un [[enlace]].
Segunda línea del mismo párrafo.

- Una viñeta
  - Anidada
- [ ] Una tarea
- [x] Hecha

1. Primero
2. Segundo

> Una cita
> en dos líneas

\`\`\`bash
sudo agent-sudo list
\`\`\`

---

| Columna | Otra |
|---|---|
| a | b |

![[foto.png]]
`;

describe("notes as pages: Markdown and the editor's blocks", () => {
  it("reads what the editor paints, and keeps the rest as written", () => {
    const blocks = markdownToBlocks(NOTE);
    expect(blocks.map((b) => [b.type, "text" in b ? b.text : ""])).toEqual([
      ["heading", "Contexto"],
      ["text", "Un párrafo con **negrita** y un [[enlace]].\nSegunda línea del mismo párrafo."],
      ["bullet", "Una viñeta"],
      ["bullet", "Anidada"],
      ["todo", "Una tarea"],
      ["todo", "Hecha"],
      ["numbered", "Primero"],
      ["numbered", "Segundo"],
      ["quote", "Una cita\nen dos líneas"],
      ["code", "sudo agent-sudo list"],
      ["divider", ""],
      ["text", "| Columna | Otra |\n|---|---|\n| a | b |"],
      ["text", "![[foto.png]]"],
    ]);
    expect(blocks[3]).toMatchObject({ indent: 1 });
    expect(blocks[5]).toMatchObject({ done: true });
    expect(blocks[9]).toMatchObject({ lang: "bash" });
    expect(pageErrors({ version: 1, blocks })).toEqual([]);
  });

  it("writes back the same note", () => {
    expect(blocksToMarkdown(markdownToBlocks(NOTE))).toBe(NOTE);
  });

  it("a block Markdown cannot say travels as a fenced «boni» block and comes back the same", () => {
    const md = blocksToMarkdown([{ id: "md1", type: "text", text: "Un texto" }, NUMBER]);
    expect(md).toContain('```boni\n{"id":"b1"');
    const back = markdownToBlocks(md);
    expect(back[1]).toEqual(NUMBER);
    expect(pageErrors({ version: 1, blocks: back })).toEqual([]);
    // And back to the same Markdown (the round trip is closed).
    expect(blocksToMarkdown(back)).toBe(md);
  });

  it("a «boni» fence with something that is not a valid block stays a code block", () => {
    const md = '```boni\nnot json\n```\n\n```boni\n{"type":"wat"}\n```\n';
    expect(markdownToBlocks(md)).toMatchObject([
      { type: "code", lang: "boni", text: "not json" },
      { type: "code", lang: "boni", text: '{"type":"wat"}' },
    ]);
  });

  it("a code block with a fence inside uses a longer fence and keeps its text", () => {
    const code: PageBlock = { id: "c1", type: "code", lang: "js", text: "a();\n```\nb();" };
    const md = blocksToMarkdown([code]);
    expect(md).toBe("````js\na();\n```\nb();\n````\n");
    const back = markdownToBlocks(md)[0] as typeof code;
    expect(back).toMatchObject({ type: "code", lang: "js", text: "a();\n```\nb();" });
  });

  it("a «boni» block whose id another block uses comes back with a fresh id", () => {
    const md = [
      "```boni",
      JSON.stringify({ ...NUMBER, id: "md1" }),
      "```",
      "```boni",
      JSON.stringify({ ...NUMBER, id: "md1" }),
      "```",
    ].join("\n");
    const blocks = markdownToBlocks(md);
    expect(blocks.map((b) => b.id)[0]).toBe("md1");
    expect(blocks.map((b) => b.id)[1]).not.toBe("md1");
    expect(blocks[1]).toMatchObject({ type: "number", title: "Gasto" });
  });

  it("takes a note's first heading as its title", () => {
    expect(leadingTitle("# Redacción y corrección de TFG/TFM\n\nTexto.\n")).toEqual({
      title: "Redacción y corrección de TFG/TFM",
      rest: "Texto.\n",
    });
    expect(leadingTitle("Texto.\n# No es el primero\n")).toBeNull();
    expect(leadingTitle("## Un segundo nivel\n")).toBeNull();
  });
});

describe("a file of the user's in a note's text", () => {
  it("alone on its line is a file block, and comes back the same line; inside a sentence it stays text", () => {
    const md =
      "Antes.\n\n![plano de la casa.png|560](boni:e_01abc)\n\n![rubrica.pdf](boni:e_02def)\n\nDespués ![x.png](boni:e_03) en línea.\n";
    const blocks = markdownToBlocks(md);
    expect(blocks.map((b) => b.type)).toEqual(["text", "file", "file", "text"]);
    expect(blocks[1]).toMatchObject({ file: "e_01abc", name: "plano de la casa.png", width: 560 });
    expect(blocks[2]).toMatchObject({ file: "e_02def", name: "rubrica.pdf" });
    expect(blocks[2]).not.toHaveProperty("width");
    expect(blocksToMarkdown(blocks)).toBe(md);
    expect(pageErrors({ version: 1, blocks })).toEqual([]);
  });

  it("a file block names its row by an id and has a name; anything else is refused", () => {
    const ok = { id: "b1", type: "file", file: "e_01abc", name: "foto.png" };
    expect(pageErrors({ version: 1, blocks: [ok] })).toEqual([]);
    for (const bad of [
      { ...ok, file: "../x" },
      { ...ok, name: 3 },
      { ...ok, width: 5 },
      { ...ok, url: "https://example.com/x.png" },
    ])
      expect(pageErrors({ version: 1, blocks: [bad] })).toEqual([
        "blocks[0]: a file names its row and has a name",
      ]);
  });
});

describe("images shown at a width, side by side and cropped (task 2h)", () => {
  it("a width and a crop after bars, a row on one line; read and written back as they were", () => {
    const md = [
      "![foto.jpg|320|crop=10,5.5,80,90](boni:e_01abc)",
      "![solo recorte|crop=0,0,50,50](boni:e_02def)",
      "![a.png](boni:e_03) ![b.png|200](boni:e_04) ![c.png|crop=25,0,50,100](boni:e_05)\n",
    ].join("\n\n");
    const blocks = markdownToBlocks(md);
    expect(blocks.map((b) => b.type)).toEqual(["file", "file", "files"]);
    expect(blocks[0]).toMatchObject({ width: 320, crop: { x: 10, y: 5.5, w: 80, h: 90 } });
    expect(blocks[1]).toMatchObject({ crop: { x: 0, y: 0, w: 50, h: 50 } });
    expect(blocks[1]).not.toHaveProperty("width");
    expect(blocks[2]).toMatchObject({
      files: [
        { file: "e_03", name: "a.png" },
        { file: "e_04", name: "b.png", width: 200 },
        { file: "e_05", name: "c.png", crop: { x: 25, y: 0, w: 50, h: 100 } },
      ],
    });
    expect(blocksToMarkdown(blocks)).toBe(md);
    expect(pageErrors({ version: 1, blocks })).toEqual([]);
  });

  it("a crop outside the image, nine images or a word on the line: the line stays text as written", () => {
    for (const line of [
      "![x.png|crop=60,0,50,100](boni:e_01)",
      "![x.png|crop=0,0,0,100](boni:e_01)",
      "![x.png|crop=1.25,0,50,100](boni:e_01)",
      Array.from({ length: 9 }, (_, i) => `![${i}.png](boni:e_0${i})`).join(" "),
      "![a.png](boni:e_01) y ![b.png](boni:e_02)",
      "![a.png](https://example.com/a.png) ![b.png](boni:e_02)",
    ]) {
      const blocks = markdownToBlocks(`${line}\n`);
      expect(blocks.map((b) => b.type)).toEqual(["text"]);
      expect(blocksToMarkdown(blocks)).toBe(`${line}\n`);
    }
    // Two next to each other with no space between are a row too, as any Markdown reader shows them.
    expect(markdownToBlocks("![a.png](boni:e_01)![b.png](boni:e_02)\n")[0]?.type).toBe("files");
  });

  it("a row holds two to eight valid images; a crop is inside its image with one decimal at most", () => {
    const f = { file: "e_01abc", name: "foto.png" };
    const row = (files: unknown[]) => ({
      version: 1,
      blocks: [{ id: "r1", type: "files", files }],
    });
    expect(pageErrors(row([f, f]))).toEqual([]);
    for (const bad of [[f], Array(9).fill(f), [f, { ...f, file: "../x" }], [f, { ...f, extra: 1 }]])
      expect(pageErrors(row(bad))).toEqual([
        "blocks[0]: a row of images has two to 8, each naming its row",
      ]);
    const one = (crop: unknown) => ({
      version: 1,
      blocks: [{ id: "b1", type: "file", ...f, crop }],
    });
    expect(pageErrors(one({ x: 0, y: 0, w: 100, h: 100 }))).toEqual([]);
    for (const crop of [
      { x: -1, y: 0, w: 50, h: 50 },
      { x: 60, y: 0, w: 50, h: 50 },
      { x: 0, y: 0, w: 0, h: 50 },
      { x: 0.25, y: 0, w: 50, h: 50 },
      { x: 0, y: 0, w: 50 },
    ])
      expect(pageErrors(one(crop))).toEqual(["blocks[0]: a file names its row and has a name"]);
  });
});

describe("a paragraph of a note pointed at (F9, task 85): found again by its words, not by where it is", () => {
  const text = "# Ideas\n\nUna idea que vuelve.\n\n- Otra cosa\n\nUna  idea que   vuelve.\n";
  it("is the hash of its words, the same for the same words however they are spaced", () => {
    expect(partKey("Una idea que vuelve.")).toMatch(/^[0-9a-f]{8}$/);
    expect(partKey(" Una  idea que   vuelve. ")).toBe(partKey("Una idea que vuelve."));
    expect(partKey("Otra cosa")).not.toBe(partKey("Una idea que vuelve."));
  });
  it("tells identical ones apart by which of them it is, and finds it after text is written above", () => {
    const blocks = markdownToBlocks(text);
    const twins = blocks.filter(
      (b) => "text" in b && b.text.replace(/\s+/g, " ") === "Una idea que vuelve.",
    );
    expect(twins).toHaveLength(2);
    const second = partOf(blocks, twins[1]?.id ?? "");
    expect(second).toEqual({ part: partKey("Una idea que vuelve."), n: 1 });
    const moved = markdownToBlocks(`Algo nuevo arriba.\n\n${text}`);
    expect(findPart(moved, second?.part ?? "", 1)).toMatch(/^Una\s+idea/);
    expect(findPart(moved, partKey("Otra cosa"), 0)).toBe("Otra cosa");
    // One of them deleted: the first that is left.
    expect(findPart(markdownToBlocks("Una idea que vuelve.\n"), second?.part ?? "", 1)).toBe(
      "Una idea que vuelve.",
    );
    expect(findPart(moved, partKey("No está"), 0)).toBeNull();
    // A line is no paragraph.
    expect(partOf(markdownToBlocks("---\n"), "md1")).toBeNull();
  });
  it("are worked out for a whole note at once as for each paragraph alone (the editor's, task 2g)", () => {
    for (const md of [text, ...Object.values(NOTES), longNote(40)]) {
      const blocks = markdownToBlocks(md);
      const all = partsOf(blocks);
      for (const b of blocks) expect(all.get(b.id) ?? null).toEqual(partOf(blocks, b.id));
    }
  });
});

describe("a note's text does not change by being read, nor where it was not edited (task 2g)", () => {
  const corpus = { ...NOTES, "a year's journal": longNote(365) };

  it("the blocks as read give back the text as read, byte for byte", () => {
    for (const [name, md] of Object.entries(corpus)) {
      const { blocks, source } = readMarkdown(md);
      expect(writeMarkdown(blocks, source), name).toBe(md);
      // The same blocks as `markdownToBlocks` reads them, ids included.
      expect(blocks, name).toEqual(markdownToBlocks(md));
    }
  });

  it("an edit changes only the block edited and the gaps beside it", () => {
    for (const [name, md] of Object.entries(corpus)) {
      const { blocks, source } = readMarkdown(md);
      // Some forty blocks of each note, spread through it (every block of a year's journal would take a minute).
      const every = Math.max(7, Math.floor(blocks.length / 40));
      blocks.forEach((b, i) => {
        if (!("text" in b) || i % every !== 3) return;
        const edited = blocks.map((x, j) => (j === i ? { ...b, text: `${b.text} más` } : x));
        const out = writeMarkdown(edited, source);
        const prev = i > 0 ? source.spans.get((blocks[i - 1] as typeof b).id) : undefined;
        const next = source.spans.get((blocks[i + 1] as typeof b | undefined)?.id ?? "");
        const head = md.slice(0, prev ? prev.to : 0);
        const tail = next ? md.slice(next.from) : "";
        expect(out.startsWith(head), `${name}: before block ${i}`).toBe(true);
        expect(out.endsWith(tail), `${name}: after block ${i}`).toBe(true);
        expect(markdownToBlocks(out)[i], `${name}: block ${i}`).toMatchObject({
          text: `${b.text} más`,
        });
      });
    }
  });

  it("a year's journal is read and written back in a moment, as it is on every save (A-15)", () => {
    const md = corpus["a year's journal"];
    const t0 = performance.now();
    const { blocks, source } = readMarkdown(md);
    const at = blocks.findIndex((b, i) => i >= 100 && "text" in b);
    const edited = blocks.map((b, i) =>
      i === at && "text" in b ? { ...b, text: `${b.text}!` } : b,
    );
    const out = writeMarkdown(edited, source);
    const ms = performance.now() - t0;
    expect(blocks.length).toBeGreaterThan(2000);
    expect(out.length).toBe(md.length + 1);
    // 2,000 blocks: read and written in about 40 to 70 ms on a laptop; with room for a slow machine.
    expect(ms).toBeLessThan(500);
  });

  it("a block whose text alone is edited keeps its marker, spacing and closing as written", () => {
    const md = "#  Notas   \n\n* uno\n+   [x] hecho\n7) siete\n\n### Fin ###\n";
    const { blocks, source } = readMarkdown(md);
    const more = (i: number) =>
      blocks.map((b, j) => (j === i && "text" in b ? { ...b, text: `${b.text}s` } : b));
    expect(writeMarkdown(more(0), source)).toBe(md.replace("Notas", "Notass"));
    expect(writeMarkdown(more(1), source)).toBe(md.replace("* uno", "* unos"));
    expect(writeMarkdown(more(2), source)).toBe(md.replace("hecho", "hechos"));
    expect(writeMarkdown(more(3), source)).toBe(md.replace("siete", "sietes"));
    expect(writeMarkdown(more(4), source)).toBe(md.replace("Fin", "Fins"));
    // Its kind changed: written as Boni writes it.
    const turned = blocks.map((b, j) =>
      j === 1 ? { id: b.id, type: "text" as const, text: "uno" } : b,
    );
    expect(writeMarkdown(turned, source)).toBe(md.replace("* uno\n", "uno\n\n"));
  });

  it("blocks moved, added or taken away are written as the editor writes them; the rest keep their bytes", () => {
    const md = "* uno\n* dos\n\n\n7) siete\n";
    const { blocks, source } = readMarkdown(md);
    const [uno, dos, siete] = blocks as [
      (typeof blocks)[0],
      (typeof blocks)[0],
      (typeof blocks)[0],
    ];
    expect(writeMarkdown([dos, uno, siete], source)).toBe("* dos\n* uno\n\n7) siete\n");
    expect(writeMarkdown([uno, siete], source)).toBe("* uno\n\n7) siete\n");
    expect(writeMarkdown([uno, dos, { id: "n", type: "text", text: "nuevo" }, siete], source)).toBe(
      "* uno\n* dos\n\nnuevo\n\n7) siete\n",
    );
    // Written without its source, the note is the editor's own Markdown, as before.
    expect(writeMarkdown(blocks, null)).toBe(blocksToMarkdown(blocks));
    expect(blocksToMarkdown(blocks)).toBe("- uno\n- dos\n\n1. siete\n");
  });
});
