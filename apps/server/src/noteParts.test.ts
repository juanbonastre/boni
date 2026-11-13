import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSystemTypes } from "@boni/agent";
import { openUserStore, type UserStore } from "@boni/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mcpAnswer } from "./mcp.ts";
import { charCount, charSlice, OUTLINE_MAX, outlineOf, PART } from "./noteParts.ts";
import { seed } from "./seed.test-util.ts";

/**
 * A long note read in parts from the MCP (task 112, A-30), with notes shaped like Juan's and of his size (A-15): his
 * largest note, a log of handovers, is 212,000 characters; the plan was 103,000. Invented Spanish text with accents,
 * «», ñ and emoji, headings at four levels, one section of 50,000 characters, a code fence holding a «heading», a note
 * with no headings at all, and a short note whose answer must stay byte for byte what it was.
 */

/** Invented Spanish, deterministic (a small generator, never random between runs). */
function writer(seed0: number) {
  let s = seed0;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const words = [
    "revisión",
    "sesión",
    "migración",
    "año",
    "señal",
    "corrección",
    "«hecha»",
    "pequeño",
    "también",
    "después",
    "calendario",
    "página",
    "prueba",
    "rama",
    "fusión",
    "versión",
    "despliegue",
    "registro",
    "índice",
    "ejemplo",
    "✅",
    "🚀",
    "e_01m7ejemplo0000000000000000",
    "0.4.89",
  ];
  const sentence = () => {
    const n = 6 + Math.floor(rnd() * 14);
    const w = Array.from({ length: n }, () => words[Math.floor(rnd() * words.length)] as string);
    const t = w.join(" ");
    return `${t[0]?.toUpperCase()}${t.slice(1)}.`;
  };
  /** About `chars` characters of paragraphs and bullets. */
  return (chars: number) => {
    const out: string[] = [];
    let n = 0;
    while (n < chars) {
      const line =
        rnd() < 0.3
          ? `- ${sentence()}`
          : Array.from({ length: 2 + Math.floor(rnd() * 4) }, sentence).join(" ");
      out.push(line, "");
      n += charCount(line) + 2;
    }
    return out.join("\n");
  };
}

/** The registry-like note: about 212,000 characters, headings at levels 2 to 5, one section of 50,000. */
function bigNote() {
  const text = writer(7);
  const parts: string[] = [];
  parts.push(text(1500), "## Estado", "", text(2500));
  parts.push("## Relevos", "", text(1000));
  for (let i = 1; i <= 8; i++) {
    parts.push(`### Relevo ${i}`, "", text(3800));
    parts.push(`#### Qué quedó del relevo ${i}`, "", text(1700));
    if (i === 3) parts.push("##### Un detalle 🚀 con «comillas»", "", text(600));
    if (i <= 2) parts.push("##### Pendiente", "", text(300));
  }
  // A code fence: what looks like a heading inside it is not one.
  parts.push("```md", "## Esto no es un encabezado", "# Tampoco", "```", "");
  parts.push("## Historia", "", text(500));
  for (let d = 1; d <= 140; d++) {
    const day = `2026-${String(1 + (d % 11)).padStart(2, "0")}-${String(1 + (d % 28)).padStart(2, "0")}`;
    parts.push(`### ${day}: relevo número ${d} de la sesión`, "", text(880));
  }
  parts.push("## Errores y soluciones", "", text(3000));
  return parts.join("\n");
}

const LONG_PLAIN = writer(11)(100_000);
const SHORT =
  "## Estado\n\nUna nota corta e inventada, con «comillas», acentos y un emoji 🚀.\n\n## Siguiente\n\n- Probar.\n";

let dir: string;
let store: UserStore;
let ids: Map<string, string>;
let BIG: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "boni-parts-"));
  store = openUserStore(join(dir, "user.db"));
  ensureSystemTypes(store);
  BIG = bigNote();
  ids = seed(store, [{ key: "nota", name: "Nota", folder: "" }], {
    "registro.md": `# Boni: registro inventado\n\n${BIG}`,
    "plano.md": `# Una nota sin encabezados\n\n${LONG_PLAIN}`,
    "corta.md": `# Una nota corta\n\n${SHORT}`,
  });
});
afterAll(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
async function call(name: string, args: Record<string, unknown>) {
  const r = (await mcpAnswer(store, "claude-ejemplo", {
    jsonrpc: "2.0",
    id: ++seq,
    method: "tools/call",
    params: { name, arguments: args },
  })) as { result: { content: { text: string }[]; isError: boolean } };
  const text = r.result.content[0]?.text ?? "";
  return { error: r.result.isError, text, json: r.result.isError ? null : JSON.parse(text) };
}
const idOf = (path: string) => ids.get(path) as string;
/** What a part of the note is, cut by code points with nothing of ours (Array.from). */
const cps = (s: string, at: number, n: number) =>
  Array.from(s)
    .slice(at, at + n)
    .join("");

describe("a long note is always readable in parts (task 112, A-30)", () => {
  it("the data is his size and shape", () => {
    const body = store.get(idOf("registro.md"))?.entity.body as string;
    expect(body).toBe(BIG);
    expect(charCount(BIG)).toBeGreaterThan(205_000);
    expect(charCount(BIG)).toBeLessThan(220_000);
    expect(charCount(BIG)).toBeLessThan(BIG.length); // emoji: two UTF-16 units, one character
    const relevos = outlineOf(BIG).find((h) => h.heading === "Relevos");
    expect(relevos?.chars).toBeGreaterThan(48_000);
    expect(relevos?.chars).toBeLessThan(56_000);
  });

  it("the outline: every heading with its level, where it starts and its size; none inside a code fence", () => {
    const outline = outlineOf(BIG);
    const all = Array.from(BIG);
    expect(outline.filter((h) => h.level === 2).map((h) => h.heading)).toEqual([
      "Estado",
      "Relevos",
      "Historia",
      "Errores y soluciones",
    ]);
    expect(outline.length).toBe(4 + 8 * 2 + 1 + 2 + 140);
    expect(outline.some((h) => h.heading.includes("no es un encabezado"))).toBe(false);
    expect(outline.filter((h) => h.level === 5).map((h) => h.heading)).toEqual([
      "Pendiente",
      "Pendiente",
      "Un detalle 🚀 con «comillas»",
    ]);
    for (const [i, h] of outline.entries()) {
      // Its line starts where it says, and it runs to the next heading of its level or higher (or the end).
      expect(cps(BIG, h.at, charCount(h.heading) + h.level + 1)).toBe(
        `${"#".repeat(h.level)} ${h.heading}`,
      );
      const next = outline.slice(i + 1).find((n) => n.level <= h.level);
      expect(h.at + h.chars).toBe(next ? next.at : all.length);
    }
  });

  it("read over the limit: no body, the outline and the start, and an answer well under the client's limit", async () => {
    const r = await call("read", { id: idOf("registro.md") });
    expect(r.error).toBe(false);
    const out = r.json;
    expect(out.body).toBeUndefined();
    expect(out).toMatchObject({ collection: "Nota", title: "Boni: registro inventado" });
    expect(out.chars).toBe(charCount(BIG));
    expect(BIG.startsWith(out.text)).toBe(true);
    expect(charCount(out.text)).toBeLessThanOrEqual(PART);
    expect(charCount(out.text)).toBeGreaterThan(PART * 0.75);
    expect(out.text.endsWith("\n")).toBe(true); // cut after a line
    expect(out.next).toBe(charCount(out.text));
    // 163 headings do not fit: the deepest levels go first, and the answer says so.
    expect(JSON.stringify(out.outline, null, 1).length).toBeLessThanOrEqual(OUTLINE_MAX);
    expect(out.outline.map((h: { heading: string }) => h.heading)).toEqual([
      "Estado",
      "Relevos",
      "Historia",
      "Errores y soluciones",
    ]);
    expect(out.cut).toContain(`offset ${out.next}`);
    expect(out.cut).toContain("level 2");
    // The whole answer as the client gets it: JSON with its escapes.
    expect(r.text.length).toBeLessThan(40_000);
  });

  it("a section comes back whole and alone, its subsections included; one over the limit with its own outline", async () => {
    const outline = outlineOf(BIG);
    const one = outline.find((h) => h.heading === "Relevo 3") as (typeof outline)[number];
    const r = await call("read", { id: idOf("registro.md"), section: "### relevo 3" });
    expect(r.error).toBe(false);
    expect(r.json.section).toEqual(one);
    expect(r.json.text).toBe(cps(BIG, one.at, one.chars));
    expect(r.json.text.startsWith("### Relevo 3\n")).toBe(true);
    expect(r.json.text).toContain("#### Qué quedó del relevo 3");
    expect(r.json.text).toContain("##### Un detalle 🚀");
    expect(r.json.text).not.toContain("Relevo 4");
    expect(r.json.next).toBeUndefined();
    expect(r.json.body).toBeUndefined();

    // «Relevos» is 50,000 characters: its start, and its own outline down to its deepest level that fits.
    const big = await call("read", { id: idOf("registro.md"), section: "Relevos" });
    expect(big.json.section.chars).toBeGreaterThan(PART);
    expect(BIG.slice(BIG.indexOf("## Relevos")).startsWith(big.json.text)).toBe(true);
    expect(big.json.outline.map((h: { heading: string }) => h.heading)).toContain("Relevo 8");
    expect(big.json.outline.map((h: { heading: string }) => h.heading)).toContain(
      "Qué quedó del relevo 8",
    );
    expect(big.json.cut).toContain("the section ends at");
    expect(big.text.length).toBeLessThan(40_000);

    // A heading that is not there, two of the same, and a section with a range: each says what to do.
    expect((await call("read", { id: idOf("registro.md"), section: "Nada" })).text).toContain(
      'no heading "Nada"',
    );
    const twice = await call("read", { id: idOf("registro.md"), section: "Pendiente" });
    expect(twice.text).toContain('2 headings are "Pendiente"');
    expect(
      (await call("read", { id: idOf("registro.md"), section: "Estado", offset: 0 })).text,
    ).toContain("not both");
  });

  it("read by range from next to next gives the whole note back, every part under the limit", async () => {
    let offset = 0;
    let got = "";
    let parts = 0;
    for (;;) {
      const r = await call("read", { id: idOf("registro.md"), offset });
      expect(r.error).toBe(false);
      expect(r.text.length).toBeLessThan(40_000);
      got += r.json.text;
      parts++;
      if (r.json.next === undefined) break;
      offset = r.json.next;
    }
    expect(got).toBe(BIG);
    expect(parts).toBe(Math.ceil(charCount(BIG) / PART));
  });

  it("a range cuts at characters, never bytes: an accent and an emoji stay whole", async () => {
    const at = Array.from(BIG).indexOf("🚀");
    const r = await call("read", { id: idOf("registro.md"), offset: at, length: 1 });
    expect(r.json).toMatchObject({ offset: at, length: 1, text: "🚀", next: at + 1 });
    const accent = Array.from(BIG).indexOf("ó");
    const a = await call("read", { id: idOf("registro.md"), offset: accent - 2, length: 5 });
    expect(a.json.text).toBe(cps(BIG, accent - 2, 5));
    expect(charSlice("añ🚀b", 1, 2)).toBe("ñ🚀");
    for (const bad of [-1, 1.5, "10"])
      expect((await call("read", { id: idOf("registro.md"), offset: bad })).text).toContain(
        "a whole number",
      );
    expect(
      (await call("read", { id: idOf("registro.md"), offset: 0, length: PART + 1 })).error,
    ).toBe(true);
  });

  it("a long note with no headings: an empty outline, its start, the rest by range", async () => {
    const r = await call("read", { id: idOf("plano.md") });
    expect(r.json.outline).toEqual([]);
    expect(LONG_PLAIN.startsWith(r.json.text)).toBe(true);
    const rest = await call("read", { id: idOf("plano.md"), offset: r.json.next, length: 100 });
    expect(rest.json.text).toBe(cps(LONG_PLAIN, r.json.next, 100));
    expect((await call("read", { id: idOf("plano.md"), section: "Estado" })).error).toBe(true);
  });

  it("a short note's answer is what it always was, byte for byte; its parts can be asked for too", async () => {
    const s = store.get(idOf("corta.md"));
    const r = await call("read", { id: idOf("corta.md") });
    expect(r.text).toBe(
      JSON.stringify(
        {
          id: s?.entity.id,
          collection: "Nota",
          title: "Una nota corta",
          updated: new Date(s?.entity.updated as number).toISOString(),
          version: s?.entity.version,
          properties: { Título: "Una nota corta" },
          body: SHORT,
        },
        null,
        1,
      ),
    );
    const sec = await call("read", { id: idOf("corta.md"), section: "Siguiente" });
    expect(sec.json.text).toBe("## Siguiente\n\n- Probar.\n");
  });

  it("edit: old_text and append as always on a long note; a whole body only over a note read whole", async () => {
    const id = idOf("registro.md");
    const s = store.get(id);
    const whole = await call("edit", { id, body: "Todo nuevo.", version: s?.entity.version });
    expect(whole.error).toBe(true);
    expect(whole.text).toContain("old_text");
    expect(store.get(id)?.entity.body).toBe(BIG);
    expect(
      (await call("edit", { id, old_text: "## Estado\n", new_text: "## Estado actual\n" })).error,
    ).toBe(false);
    expect((await call("append", { id, text: "- Una línea más." })).error).toBe(false);
    const now = store.get(id)?.entity.body as string;
    expect(now).toContain("## Estado actual\n");
    expect(now.endsWith("- Una línea más.")).toBe(true);
    // A short note's whole body, as always.
    const short = store.get(idOf("corta.md"));
    expect(
      (
        await call("edit", {
          id: idOf("corta.md"),
          body: `${SHORT}- Otra.\n`,
          version: short?.entity.version,
        })
      ).error,
    ).toBe(false);
  });

  it("is quick on his largest note (A-15)", async () => {
    const time = async (args: Record<string, unknown>) => {
      const t0 = performance.now();
      for (let i = 0; i < 10; i++) await call("read", { id: idOf("registro.md"), ...args });
      return (performance.now() - t0) / 10;
    };
    const outline = await time({});
    const section = await time({ section: "Historia" });
    const range = await time({ offset: 180_000 });
    // Printed for the PR; the bound is loose (a slow CI runner), the number is what matters.
    console.log(
      `read of a ${charCount(BIG)}-character note: outline ${outline.toFixed(1)} ms, section ${section.toFixed(1)} ms, range ${range.toFixed(1)} ms`,
    );
    for (const ms of [outline, section, range]) expect(ms).toBeLessThan(250);
  });
});
