import { describe, expect, it } from "vitest";
import { blocksToMarkdown, leadingTitle, markdownToBlocks } from "./markdown.ts";
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
