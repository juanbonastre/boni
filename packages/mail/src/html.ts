/**
 * HTML as plain text, for a mail whose only body is HTML. What a person would see, nothing more: scripts,
 * styles and the head are dropped, and so is every element hidden with inline CSS or the `hidden` attribute
 * (where prompt injections hide: white text is not caught, but a hidden block is). Their count is reported.
 * No DOM: a small tokenizer that never fails on broken markup (what it cannot parse stays text).
 */

const SKIP = new Set(["script", "style", "head", "title", "noscript", "template", "svg", "math"]);
const VOID = new Set([
  "br",
  "img",
  "hr",
  "meta",
  "link",
  "input",
  "area",
  "base",
  "col",
  "embed",
  "source",
  "track",
  "wbr",
  "param",
]);
const BLOCK = new Set([
  "p",
  "div",
  "br",
  "li",
  "tr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "table",
  "blockquote",
  "section",
  "article",
  "header",
  "footer",
  "ul",
  "ol",
  "pre",
  "hr",
]);
const HIDDEN =
  /display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?![.\d]*[1-9])|opacity\s*:\s*0(?![.\d]*[1-9])|max-height\s*:\s*0(?![.\d]*[1-9])|(?:^|;)\s*(?:width|height)\s*:\s*0(?:px)?\s*(?:;|$)/i;

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  iexcl: "¡",
  iquest: "¿",
  laquo: "«",
  raquo: "»",
  euro: "€",
  copy: "©",
  reg: "®",
  deg: "°",
  middot: "·",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  ordf: "ª",
  ordm: "º",
};
for (const [n, c] of Object.entries({
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  uuml: "ü",
  agrave: "à",
  egrave: "è",
  ccedil: "ç",
})) {
  NAMED[n] = c;
  NAMED[n[0]?.toUpperCase() + n.slice(1)] = c.toUpperCase();
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});?/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m;
  });
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}(?:\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+))?`, "i").exec(tag);
  if (!m) return null;
  return (m[1] ?? "").replace(/^["']|["']$/g, "");
};

export function htmlToText(html: string): { text: string; hidden: number } {
  const out: string[] = [];
  const stack: { tag: string; hide: boolean }[] = [];
  let hiddenDepth = 0;
  let hidden = 0;
  const src = html.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let at = 0;
  const text = (s: string) => {
    if (hiddenDepth === 0 && s) out.push(decodeEntities(s));
  };
  for (let m = re.exec(src); m; m = re.exec(src)) {
    text(src.slice(at, m.index));
    at = re.lastIndex;
    const closing = m[1] === "/";
    const tag = (m[2] as string).toLowerCase();
    if (BLOCK.has(tag) && hiddenDepth === 0) out.push("\n");
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--)
        if (stack[i]?.tag === tag) {
          for (const s of stack.splice(i)) if (s.hide) hiddenDepth--;
          break;
        }
      continue;
    }
    if (VOID.has(tag) || /\/\s*$/.test(m[3] ?? "")) continue;
    const style = attr(m[0], "style") ?? "";
    const hide = SKIP.has(tag) || HIDDEN.test(style) || attr(m[0], "hidden") !== null;
    stack.push({ tag, hide });
    if (hide) {
      if (!SKIP.has(tag) && hiddenDepth === 0) hidden++;
      hiddenDepth++;
    }
    // The content of a script or style is not markup: skip to its end tag.
    if (SKIP.has(tag)) {
      const end = src.toLowerCase().indexOf(`</${tag}`, at);
      at = end < 0 ? src.length : end;
      re.lastIndex = at;
    }
  }
  text(src.slice(at));
  const t = out
    .join("")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: t, hidden };
}
