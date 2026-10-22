import { describe, expect, it } from "vitest";
import { blocksToMarkdown, leadingTitle, markdownToBlocks } from "./markdown.ts";
import { pageErrors } from "./page.ts";

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

  it("takes a note's first heading as its title", () => {
    expect(leadingTitle("# Redacción y corrección de TFG/TFM\n\nTexto.\n")).toEqual({
      title: "Redacción y corrección de TFG/TFM",
      rest: "Texto.\n",
    });
    expect(leadingTitle("Texto.\n# No es el primero\n")).toBeNull();
    expect(leadingTitle("## Un segundo nivel\n")).toBeNull();
  });
});
