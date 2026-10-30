import { markdownToBlocks } from "@boni/views";
import { describe, expect, it } from "vitest";
import type { RowHistory } from "./audit.ts";
import { alignBlame, fieldMarks } from "./blame.ts";

/** A text's lines with who wrote each and when, as the server's blame gives them. */
const blamed = (lines: [string, string, number][]): RowHistory["blame"] =>
  lines.map(([text, by, at], seq) => ({ text, by, at, seq }));

describe("who wrote each block of a record's page", () => {
  const body = [
    "Un fin de semana en la sierra con los amigos del club.",
    "",
    "## Qué llevar",
    "- Botas de montaña",
    "- Bastones",
    "- [ ] Reservar el refugio",
    "",
    "Subida por el barranco,",
    "unas cuatro horas y media.",
  ].join("\n");
  const blocks = markdownToBlocks(body);
  const marks = alignBlame(
    blocks,
    blamed([
      ["Un fin de semana en la sierra con los amigos del club.", "user:portatil", 3],
      ["", "import", 1],
      ["## Qué llevar", "import", 1],
      ["- Botas de montaña", "import", 1],
      ["- Bastones", "user:portatil", 3],
      ["- [ ] Reservar el refugio", "user:movil", 5],
      ["", "import", 1],
      ["Subida por el barranco,", "import", 1],
      ["unas cuatro horas y media.", "model:planner:anthropic/claude-opus-5-5", 4],
    ]),
  );
  const by = (text: string) => {
    const b = blocks.find((x) => (x as { text?: string }).text === text);
    return b ? marks[b.id] : undefined;
  };

  it("finds each block's lines by their words, whatever marks them as a list, a to-do or a heading", () => {
    expect(by("Un fin de semana en la sierra con los amigos del club.")?.by).toBe("user:portatil");
    expect(by("Qué llevar")?.by).toBe("import");
    expect(by("Botas de montaña")?.by).toBe("import");
    expect(by("Bastones")?.by).toBe("user:portatil");
    expect(by("Reservar el refugio")?.by).toBe("user:movil");
  });

  it("a block of several lines goes to who wrote it last, the others kept", () => {
    expect(by("Subida por el barranco,\nunas cuatro horas y media.")).toEqual({
      by: "model:planner:anthropic/claude-opus-5-5",
      at: 4,
      others: ["import"],
    });
  });

  it("a block the blame does not have (written since it was read) has no one", () => {
    const more = [...blocks, ...markdownToBlocks("Algo escrito ahora mismo.")];
    const again = alignBlame(more, blamed([["Un fin de semana", "import", 1]]));
    expect(Object.keys(again)).toHaveLength(0);
  });

  it("each property by who changed it last", () => {
    const d = {
      changes: [
        {
          seq: 1,
          at: 1,
          kind: "create",
          by: "import",
          fields: ["f_estado", "f_inicio"],
          body: true,
        },
        {
          seq: 2,
          at: 3,
          kind: "update",
          by: "mcp:claude-ejemplo",
          fields: ["f_estado"],
          body: false,
        },
      ],
    } as RowHistory;
    expect(fieldMarks(d)).toEqual({
      f_estado: { by: "mcp:claude-ejemplo", at: 3, others: [] },
      f_inicio: { by: "import", at: 1, others: [] },
    });
  });
});
