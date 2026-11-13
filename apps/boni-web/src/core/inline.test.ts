import { describe, expect, it } from "vitest";
import {
  applyEdits,
  inlineSpans,
  linkHref,
  plainText,
  setLink,
  toggleWrap,
  unlink,
  type WrapKind,
} from "./inline.ts";

/** The formats of a text as `kind:what shows`. */
const shown = (text: string) =>
  inlineSpans(text)
    .filter((s) => s.kind !== "image")
    .map((s) => `${s.kind}:${text.slice(s.inner[0], s.inner[1])}`);

/** A text with a format toggled around `[`…`]` (or at `|`): the new text with the range marked the same way. */
function toggled(marked: string, kind: WrapKind): string {
  const caret = marked.indexOf("|");
  const text = marked.replace(/[[\]|]/g, "");
  const from = caret >= 0 ? caret : marked.indexOf("[");
  const to = caret >= 0 ? caret : marked.indexOf("]") - 1;
  const r = toggleWrap(text, from, to, kind);
  if (!r) return "null";
  const out = applyEdits(text, r.edits);
  return r.from === r.to
    ? `${out.slice(0, r.from)}|${out.slice(r.from)}`
    : `${out.slice(0, r.from)}[${out.slice(r.from, r.to)}]${out.slice(r.to)}`;
}

describe("inline formats read from a block's Markdown (task 2f)", () => {
  it("finds every format, in every spelling a person writes", () => {
    expect(shown("**negrita** y __negrita__")).toEqual(["strong:negrita", "strong:negrita"]);
    expect(shown("*cursiva* y _cursiva_")).toEqual(["em:cursiva", "em:cursiva"]);
    expect(shown("~~tachado~~")).toEqual(["strike:tachado"]);
    expect(shown("`código` y ``con ` dentro``")).toEqual(["code:código", "code:con ` dentro"]);
    expect(shown("[enlace](https://example.com/a?b=c&d=e)")).toEqual(["link:enlace"]);
    expect(shown('[con título](https://example.com "Título")')).toEqual(["link:con título"]);
    expect(shown("[con espacios](<https://example.com/a b>)")).toEqual(["link:con espacios"]);
    expect(shown("[[Nota enlazada]] y [[Nota|alias]]")).toEqual([
      "mention:Nota enlazada",
      "mention:alias",
    ]);
    expect(shown("<https://example.com> y https://example.com/x.")).toEqual([
      "url:https://example.com",
      "url:https://example.com/x",
    ]);
  });

  it("nests and sits side by side as CommonMark reads it", () => {
    expect(shown("***las dos***")).toEqual(["em:**las dos**", "strong:las dos"]);
    expect(shown("**negrita con *cursiva* dentro**")).toEqual([
      "strong:negrita con *cursiva* dentro",
      "em:cursiva",
    ]);
    // The rule of three: the middle run both opens and closes, so it is no closer of the first.
    expect(shown("**a****b**")).toEqual(["strong:a****b"]);
    expect(shown("*a*_b_")).toEqual(["em:a", "em:b"]);
    expect(shown("[**negrita** en un enlace](https://example.com)")).toEqual([
      "link:**negrita** en un enlace",
      "strong:negrita",
    ]);
    expect(shown("**`código` en negrita**")).toEqual(["strong:`código` en negrita", "code:código"]);
  });

  it("leaves alone what is not a format", () => {
    for (const t of [
      "2 * 3 * 4",
      "un_nombre_de_fichero",
      "\\*no es cursiva\\*",
      "`sin cerrar",
      "** no ** es negrita",
      "![imagen](adjuntos/foto.jpg)",
      "![[incrustada.png]]",
      "[^1] nota al pie",
      "<u>subrayado</u>",
      "~uno~",
      "[texto] (sin enlace)",
    ])
      expect(shown(t), t).toEqual([]);
    expect(shown("`**no es negrita**`")).toEqual(["code:**no es negrita**"]);
  });

  it("the words a person reads, without the marks", () => {
    expect(plainText("Una **idea** con [enlace](https://example.com) y [[Nota|alias]]")).toBe(
      "Una idea con enlace y alias",
    );
    expect(plainText("sin formato")).toBe("sin formato");
  });

  it("is quick on a long paragraph full of marks (A-15)", () => {
    const long = "palabra **negrita** *cursiva* `x` [e](https://example.com) 2 * 3 ".repeat(400);
    const t0 = performance.now();
    const spans = inlineSpans(long);
    expect(performance.now() - t0).toBeLessThan(150);
    expect(spans.length).toBe(1600);
  });
});

describe("a format's shortcut or button on the text", () => {
  it("wraps a selection, without its edge spaces, and takes it off again", () => {
    expect(toggled("Una [idea] suelta", "strong")).toBe("Una **[idea]** suelta");
    expect(toggled("Una[ idea ]suelta", "em")).toBe("Una *[idea]* suelta");
    expect(toggled("Una **[idea]** suelta", "strong")).toBe("Una [idea] suelta");
    expect(toggled("Una ~~[idea]~~", "strike")).toBe("Una [idea]");
    expect(toggled("[  ]", "strong")).toBe("null");
  });

  it("with the caret: off in a format, else its marks to type between", () => {
    expect(toggled("Una **id|ea**", "strong")).toBe("Una id|ea");
    expect(toggled("Una |", "em")).toBe("Una *|*");
    expect(toggled("Una |", "code")).toBe("Una `|`");
  });

  it("on and off again gives back the very bytes", () => {
    for (const kind of ["strong", "em", "strike", "code"] as const) {
      const text = "Un párrafo con una palabra en medio.";
      const on = toggleWrap(text, 19, 26, kind);
      if (!on) throw new Error("no edit");
      const once = applyEdits(text, on.edits);
      const off = toggleWrap(once, on.from, on.to, kind);
      if (!off) throw new Error("no edit");
      expect(applyEdits(once, off.edits)).toBe(text);
    }
  });

  it("takes in whole a format it cuts into, and melts one of its kind inside", () => {
    expect(toggled("[a **b] c**", "em")).toBe("*[a **b c**]*");
    expect(toggled("[a **b** c]", "strong")).toBe("**[a b c]**");
    expect(toggled("[una `x` más]", "strong")).toBe("**[una `x` más]**");
    // An image's words are no text: a format takes the image whole, and comes off it again.
    const image = "Mira ![captura](https://example.com/a.png) hoy";
    const on = toggleWrap(image, 8, 12, "strong");
    if (!on) throw new Error("no edit");
    const bold = applyEdits(image, on.edits);
    expect(bold).toBe("Mira **![captura](https://example.com/a.png)** hoy");
    const off = toggleWrap(bold, on.from, on.to, "strong");
    if (!off) throw new Error("no edit");
    expect(applyEdits(bold, off.edits)).toBe(image);
  });

  it("code holds backticks with a longer fence", () => {
    expect(toggled("[a`b]", "code")).toBe("``[a`b]``");
    expect(toggled("[`a]", "code")).toBe("`` [`a] ``");
  });
});

describe("links", () => {
  it("wraps the words, changes the address of the link the caret is in, and comes off", () => {
    const text = "Mira esta web hoy";
    const on = setLink(text, 5, 13, "https://example.com");
    if (!on) throw new Error("no edit");
    const linked = applyEdits(text, on.edits);
    expect(linked).toBe("Mira [esta web](https://example.com) hoy");
    expect(linked.slice(on.from, on.to)).toBe("esta web");
    const moved = setLink(linked, 8, 8, "https://example.org/a b");
    if (!moved) throw new Error("no edit");
    const again = applyEdits(linked, moved.edits);
    expect(again).toBe("Mira [esta web](<https://example.org/a b>) hoy");
    const span = inlineSpans(again)[0];
    if (!span) throw new Error("no link");
    expect(span.href).toBe("https://example.org/a b");
    expect(applyEdits(again, unlink(span))).toBe(text);
    expect(setLink(text, 3, 3, "https://example.com")).toBeNull();
  });

  it("an address as typed", () => {
    expect(linkHref("example.com/a")).toBe("https://example.com/a");
    expect(linkHref("mailto:ejemplo@example.com")).toBe("mailto:ejemplo@example.com");
    expect(linkHref("no es una dirección")).toBeNull();
    expect(linkHref("palabra")).toBeNull();
  });
});
