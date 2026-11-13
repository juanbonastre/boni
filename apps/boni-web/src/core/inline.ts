/**
 * Inline format in a block's text (task 2f): the text stays the Markdown a person writes by hand (`**negrita**`,
 * `*cursiva*`, `~~tachado~~`, `` `código` ``, `[enlace](https://…)`, `[[Nota]]`), so a note keeps its bytes; this
 * finds where each format is in it (what the editor paints) and works out the edits a format's shortcut or button
 * makes to it. Emphasis follows CommonMark's delimiter rules (a `*` beside a space opens nothing, `_` inside a word
 * neither), so the text reads as any other Markdown reader shows it. Nothing here knows the screen.
 */

export type InlineKind = "strong" | "em" | "strike" | "code" | "link" | "url" | "mention" | "image";
/** The formats a shortcut or a button turns on and off around a selection. */
export type WrapKind = "strong" | "em" | "strike" | "code";

/** A format found in a text: its whole extent, what it shows, and the marks around that (hidden away from the caret). */
export interface Span {
  kind: InlineKind;
  from: number;
  to: number;
  /** What shows formatted (a link's words, a mention's name or alias). */
  inner: readonly [number, number];
  /** The Markdown around it: `**`, a link's `[` and `](…)`, a mention's `[[`, `Nota|` and `]]`. */
  marks: readonly (readonly [number, number])[];
  /** A link's address (link, url). */
  href?: string;
  /** Where a link's address is in the text, to change it. */
  dest?: readonly [number, number];
  /** A mention's note title. */
  target?: string;
}

const isWS = (c: string | undefined) => c === undefined || /\s/u.test(c);
const isPunct = (c: string | undefined) => c !== undefined && /[\p{P}\p{S}]/u.test(c);
const ESCAPABLE = /[!-/:-@[-`{-~]/;

interface Delim {
  char: string;
  /** Where its run starts, how long it was and how much of it is still unmatched (openers use their end). */
  pos: number;
  orig: number;
  len: number;
  /** How much of its start has been used as a closer. */
  used: number;
  open: boolean;
  close: boolean;
}

/** A run of backticks at `i`: its length. */
const runAt = (s: string, i: number, c: string) => {
  let k = i;
  while (s[k] === c) k++;
  return k - i;
};

/** Where the `)` of a link's destination at `i` (just after its `(`) ends, and the address; null when it is none. */
function destAt(
  s: string,
  i: number,
  end: number,
): { close: number; href: string; dest: [number, number] } | null {
  let k = i;
  while (k < end && (s[k] === " " || s[k] === "\t")) k++;
  let href: string;
  let dest: [number, number];
  if (s[k] === "<") {
    const gt = s.indexOf(">", k + 1);
    if (gt < 0 || gt >= end || /[\n<]/.test(s.slice(k + 1, gt))) return null;
    href = s.slice(k + 1, gt);
    dest = [k + 1, gt];
    k = gt + 1;
  } else {
    const start = k;
    let depth = 0;
    while (k < end) {
      const c = s[k] as string;
      if (c === "\\" && k + 1 < end && ESCAPABLE.test(s[k + 1] as string)) {
        k += 2;
        continue;
      }
      if (/\s/.test(c)) break;
      if (c === "(") depth++;
      else if (c === ")") {
        if (!depth) break;
        depth--;
      }
      k++;
    }
    if (depth) return null;
    href = s.slice(start, k);
    dest = [start, k];
  }
  while (k < end && (s[k] === " " || s[k] === "\t")) k++;
  // An optional title: "…", '…' or (…).
  const q = s[k];
  if ((q === '"' || q === "'" || q === "(") && k > dest[1]) {
    const shut = q === "(" ? ")" : q;
    const e = s.indexOf(shut, k + 1);
    if (e < 0 || e >= end) return null;
    k = e + 1;
    while (k < end && (s[k] === " " || s[k] === "\t")) k++;
  }
  if (s[k] !== ")") return null;
  return { close: k, href, dest };
}

/** The `]` closing the `[` at `i` (brackets nest, escapes and code spans skip); -1 when none before `end`. */
function closeBracket(s: string, i: number, end: number): number {
  let depth = 0;
  for (let k = i; k < end; k++) {
    const c = s[k];
    if (c === "\\") {
      k++;
      continue;
    }
    if (c === "`") {
      const n = runAt(s, k, "`");
      const shut = findRun(s, k + n, end, n);
      if (shut >= 0) k = shut + n - 1;
      else k += n - 1;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return k;
  }
  return -1;
}

/** The next run of exactly `n` backticks from `i`; -1 when none before `end`. */
function findRun(s: string, i: number, end: number, n: number): number {
  for (let k = i; k < end; ) {
    if (s[k] !== "`") {
      k++;
      continue;
    }
    const m = runAt(s, k, "`");
    if (m === n && k + m <= end) return k;
    k += m;
  }
  return -1;
}

const URL_START = /^(?:https?:\/\/|www\.)[^\s<>]/i;

/** The formats of a text (one block's), outermost first where they nest. */
export function inlineSpans(text: string): Span[] {
  const out: Span[] = [];
  scan(text, 0, text.length, out, true);
  return out.sort((a, b) => a.from - b.from || b.to - a.to);
}

/** Finds the formats in `s` between `start` and `end`; `links`: links and mentions may start here (not in a link). */
function scan(s: string, start: number, end: number, out: Span[], links: boolean) {
  const delims: Delim[] = [];
  let i = start;
  while (i < end) {
    const c = s[i] as string;
    if (c === "\\") {
      i += i + 1 < end && ESCAPABLE.test(s[i + 1] as string) ? 2 : 1;
      continue;
    }
    if (c === "`") {
      const n = runAt(s, i, "`");
      const shut = findRun(s, i + n, end, n);
      if (shut < 0) {
        i += n;
        continue;
      }
      out.push({
        kind: "code",
        from: i,
        to: shut + n,
        inner: [i + n, shut],
        marks: [
          [i, i + n],
          [shut, shut + n],
        ],
      });
      i = shut + n;
      continue;
    }
    if (c === "!" && s[i + 1] === "[") {
      // An image (`![alt](src)`) or an embed (`![[…]]`): kept as it is written, nothing in it formatted.
      const shut = closeBracket(s, i + 1, end);
      if (shut < 0) {
        i += 2;
        continue;
      }
      const d = s[shut + 1] === "(" ? destAt(s, shut + 2, end) : null;
      const to = d ? d.close + 1 : shut + 1;
      // Not painted; a format put on around it takes it whole (its words are no text of the note's).
      out.push({ kind: "image", from: i, to, inner: [i, i], marks: [] });
      i = to;
      continue;
    }
    if (links && c === "[" && s[i + 1] === "[") {
      const shut = s.indexOf("]]", i + 2);
      const body = shut < 0 || shut >= end ? "" : s.slice(i + 2, shut);
      if (body.trim() && !/[[\]\n]/.test(body)) {
        const bar = body.indexOf("|");
        const target = (bar < 0 ? body : body.slice(0, bar)).trim();
        const marks: [number, number][] = [[i, i + 2]];
        if (bar >= 0) marks.push([i + 2, i + 3 + bar]);
        marks.push([shut, shut + 2]);
        out.push({
          kind: "mention",
          from: i,
          to: shut + 2,
          inner: bar < 0 ? [i + 2, shut] : [i + 3 + bar, shut],
          marks,
          target,
        });
        i = shut + 2;
        continue;
      }
    }
    if (links && c === "[") {
      const shut = closeBracket(s, i, end);
      const d = shut > i + 1 && s[shut + 1] === "(" ? destAt(s, shut + 2, end) : null;
      if (d) {
        out.push({
          kind: "link",
          from: i,
          to: d.close + 1,
          inner: [i + 1, shut],
          marks: [
            [i, i + 1],
            [shut, d.close + 1],
          ],
          href: d.href,
          dest: d.dest,
        });
        scan(s, i + 1, shut, out, false);
        i = d.close + 1;
        continue;
      }
    }
    if (links && c === "<") {
      const m = /^<([a-z][a-z0-9+.-]{1,31}:[^\s<>]*)>/i.exec(s.slice(i, end));
      if (m) {
        const to = i + m[0].length;
        out.push({
          kind: "url",
          from: i,
          to,
          inner: [i + 1, to - 1],
          marks: [
            [i, i + 1],
            [to - 1, to],
          ],
          href: m[1] as string,
        });
        i = to;
        continue;
      }
    }
    if (
      links &&
      (c === "h" || c === "H" || c === "w" || c === "W") &&
      !/[\p{L}\p{N}]/u.test(s[i - 1] ?? " ")
    ) {
      if (URL_START.test(s.slice(i, i + 9))) {
        let k = i;
        while (k < end && !/[\s<>]/.test(s[k] as string)) k++;
        // Trailing punctuation is the sentence's, and a «)» the link did not open.
        while (k > i) {
          const t = s[k - 1] as string;
          if (/[.,;:!?'"*_~]/.test(t)) k--;
          else if (t === ")") {
            const part = s.slice(i, k);
            if ((part.match(/\(/g)?.length ?? 0) < (part.match(/\)/g)?.length ?? 0)) k--;
            else break;
          } else break;
        }
        const raw = s.slice(i, k);
        if (k > i + 4 && raw.includes(".")) {
          out.push({
            kind: "url",
            from: i,
            to: k,
            inner: [i, k],
            marks: [],
            href: /^www\./i.test(raw) ? `https://${raw}` : raw,
          });
          i = k;
          continue;
        }
      }
    }
    if (c === "*" || c === "_" || c === "~") {
      const n = runAt(s, i, c);
      const before = i > start ? s[i - 1] : undefined;
      const after = i + n < end ? s[i + n] : undefined;
      const left = !isWS(after) && (!isPunct(after) || isWS(before) || isPunct(before));
      const right = !isWS(before) && (!isPunct(before) || isWS(after) || isPunct(after));
      let open = left;
      let close = right;
      if (c === "_") {
        open = left && (!right || isPunct(before));
        close = right && (!left || isPunct(after));
      }
      if (c !== "~" || n === 2)
        delims.push({ char: c, pos: i, orig: n, len: n, used: 0, open, close });
      i += n;
      continue;
    }
    i++;
  }
  emphasis(delims, out);
}

/** CommonMark's «process emphasis»: each closer with the nearest opener of its kind before it. */
function emphasis(delims: Delim[], out: Span[]) {
  for (let ci = 0; ci < delims.length; ci++) {
    const closer = delims[ci] as Delim;
    while (closer.close && closer.len > 0) {
      let oi = ci - 1;
      for (; oi >= 0; oi--) {
        const o = delims[oi] as Delim;
        if (o.char !== closer.char || !o.open || o.len <= 0) continue;
        if (o.char === "~" && (o.len !== 2 || closer.len !== 2)) continue;
        // The «rule of three»: a run that can both open and close does not match one whose lengths add to a
        // multiple of three, unless both are.
        if (
          o.char !== "~" &&
          (o.close || closer.open) &&
          (o.orig + closer.orig) % 3 === 0 &&
          (o.orig % 3 !== 0 || closer.orig % 3 !== 0)
        )
          continue;
        break;
      }
      if (oi < 0) break;
      const opener = delims[oi] as Delim;
      const use = closer.char === "~" ? 2 : closer.len >= 2 && opener.len >= 2 ? 2 : 1;
      const oEnd = opener.pos + opener.len;
      const cStart = closer.pos + closer.used;
      out.push({
        kind: closer.char === "~" ? "strike" : use === 2 ? "strong" : "em",
        from: oEnd - use,
        to: cStart + use,
        inner: [oEnd, cStart],
        marks: [
          [oEnd - use, oEnd],
          [cStart, cStart + use],
        ],
      });
      opener.len -= use;
      closer.len -= use;
      closer.used += use;
      for (let k = oi + 1; k < ci; k++) (delims[k] as Delim).len = 0;
    }
  }
}

/** The text without its formats' marks: what a person reads (a chip's title, a screen reader's words). */
export function plainText(text: string): string {
  const cut: (readonly [number, number])[] = inlineSpans(text).flatMap((s) => s.marks);
  if (!cut.length) return text;
  cut.sort((a, b) => a[0] - b[0]);
  let out = "";
  let at = 0;
  for (const [a, b] of cut) {
    if (a > at) out += text.slice(at, a);
    at = Math.max(at, b);
  }
  return out + text.slice(at);
}

/** An edit of a text: `del` characters at `at` replaced by `ins`. */
export interface Edit {
  at: number;
  del: number;
  ins: string;
}

/** Edits from the last to the first, as they are made: at one place, what is taken away before what is put in. */
export const descending = (edits: readonly Edit[]): Edit[] =>
  [...edits].sort((a, b) => b.at - a.at || (a.del ? -1 : 0) - (b.del ? -1 : 0));

/** The text with these edits made (none overlapping). */
export function applyEdits(text: string, edits: readonly Edit[]): string {
  let out = text;
  for (const e of descending(edits)) out = out.slice(0, e.at) + e.ins + out.slice(e.at + e.del);
  return out;
}

/** Where a place of the text is after the edits; `before`: a place where text is inserted stays before it. */
export function mapThrough(pos: number, edits: readonly Edit[], before = false): number {
  let shift = 0;
  for (const e of edits) {
    if (e.at + e.del <= pos && !(e.del === 0 && e.at === pos && before))
      shift += e.ins.length - e.del;
    else if (e.at < pos) return e.at + shift + (before ? 0 : e.ins.length);
  }
  return pos + shift;
}

const MARK: Record<Exclude<WrapKind, "code">, string> = { strong: "**", em: "*", strike: "~~" };

/** The smallest format of this kind the range is in, its marks included (a caret anywhere in it); null when none. */
export function spanAround(
  spans: readonly Span[],
  kind: InlineKind,
  from: number,
  to: number,
): Span | null {
  let best: Span | null = null;
  for (const s of spans)
    if (s.kind === kind && s.from <= from && to <= s.to)
      if (!best || s.to - s.from < best.to - best.from) best = s;
  return best;
}

/** Whether every one of these ranges of the text is in a format of this kind (a button shown pressed). */
export function isFormatted(text: string, kind: InlineKind, from: number, to: number): boolean {
  return spanAround(inlineSpans(text), kind, from, to) !== null;
}

/**
 * A format turned on or off around a range of the text (its shortcut or its button): off when the range is in one of
 * that kind (its marks taken away); else on: its marks around the range, which grows to take in whole any format it
 * cuts into, without the spaces at its edges (`** a**` is no bold). An empty range takes the marks with the caret
 * between them, to type in. Returns the edits and where the range is after them; null when there is nothing to do.
 */
export function toggleWrap(
  text: string,
  from: number,
  to: number,
  kind: WrapKind,
): { edits: Edit[]; from: number; to: number; on: boolean } | null {
  const spans = inlineSpans(text);
  const had = spanAround(spans, kind, from, to);
  if (had) {
    const edits = had.marks.map(([a, b]) => ({ at: a, del: b - a, ins: "" }));
    return {
      edits,
      from: mapThrough(from, edits, true),
      to: mapThrough(to, edits, false),
      on: false,
    };
  }
  if (from === to) {
    const m = kind === "code" ? "`" : MARK[kind];
    const edits = [{ at: from, del: 0, ins: m + m }];
    return { edits, from: from + m.length, to: from + m.length, on: true };
  }
  let a = from;
  let b = to;
  while (a < b && /\s/.test(text[a] as string)) a++;
  while (b > a && /\s/.test(text[b - 1] as string)) b--;
  if (a === b) return null;
  // Any format the range cuts into is taken whole; one of the same kind inside it melts into the new one.
  for (let changed = true; changed; ) {
    changed = false;
    for (const s of spans) {
      const cuts = (s.from < a && s.to > a) || (s.from < b && s.to > b);
      const inner = s.inner[0] <= a && b <= s.inner[1];
      if (cuts && !inner) {
        a = Math.min(a, s.from);
        b = Math.max(b, s.to);
        changed = true;
      }
    }
  }
  const melt =
    kind === "code"
      ? []
      : spans.filter((s) => s.kind === kind && s.from >= a && s.to <= b).flatMap((s) => s.marks);
  const edits: Edit[] = melt.map(([x, y]) => ({ at: x, del: y - x, ins: "" }));
  let open: string;
  let close: string;
  if (kind === "code") {
    const body = text.slice(a, b);
    let longest = 0;
    for (const m of body.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
    const fence = "`".repeat(longest + 1);
    const pad = body.startsWith("`") || body.endsWith("`") ? " " : "";
    open = fence + pad;
    close = pad + fence;
  } else {
    open = MARK[kind];
    close = MARK[kind];
  }
  edits.push({ at: a, del: 0, ins: open }, { at: b, del: 0, ins: close });
  edits.sort((x, y) => x.at - y.at || (x.del ? -1 : 1));
  const na = mapThrough(a, edits, false);
  const nb = mapThrough(b, edits, true);
  return { edits, from: na, to: nb, on: true };
}

/** An address as typed (`example.com`) made one a link can hold (`https://example.com`); null when it is none. */
export function linkHref(typed: string): string | null {
  const s = typed.trim();
  if (!s || /\s/.test(s)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  if (/^[^\s/]+\.[^\s/]+/.test(s)) return `https://${s}`;
  return null;
}

/** A link's address as Markdown writes it: in `<…>` when it has spaces or parentheses that do not match. */
const destText = (href: string) => {
  const open = href.match(/\(/g)?.length ?? 0;
  const shut = href.match(/\)/g)?.length ?? 0;
  return /[\s<>]/.test(href) || open !== shut ? `<${href.replace(/[<>]/g, "")}>` : href;
};

/**
 * A link around a range of the text (`[words](address)`), or a new address for the link the range is in. Returns the
 * edits and where the link's words are after them; null when the range is empty and in no link.
 */
export function setLink(
  text: string,
  from: number,
  to: number,
  href: string,
): { edits: Edit[]; from: number; to: number } | null {
  const spans = inlineSpans(text);
  const had = spanAround(spans, "link", from, to);
  if (had?.dest) {
    const [x, y] = had.dest;
    const wrapped = text[x - 1] === "<";
    const edits = [
      wrapped
        ? { at: x - 1, del: y - x + 2, ins: destText(href) }
        : { at: x, del: y - x, ins: destText(href) },
    ];
    return { edits, from: had.inner[0], to: had.inner[1] };
  }
  let a = from;
  let b = to;
  while (a < b && /\s/.test(text[a] as string)) a++;
  while (b > a && /\s/.test(text[b - 1] as string)) b--;
  if (a === b) return null;
  for (let changed = true; changed; ) {
    changed = false;
    for (const s of spans) {
      const cuts = (s.from < a && s.to > a) || (s.from < b && s.to > b);
      if (cuts && !(s.inner[0] <= a && b <= s.inner[1] && s.kind !== "link" && s.kind !== "url")) {
        a = Math.min(a, s.from);
        b = Math.max(b, s.to);
        changed = true;
      }
    }
  }
  // Links do not hold links: one inside the range leaves its words.
  const inside = spans.filter(
    (s) => (s.kind === "link" || s.kind === "mention") && s.from >= a && s.to <= b,
  );
  const edits: Edit[] = inside.flatMap((s) =>
    s.marks.map(([x, y]) => ({ at: x, del: y - x, ins: "" })),
  );
  edits.push({ at: a, del: 0, ins: "[" }, { at: b, del: 0, ins: `](${destText(href)})` });
  edits.sort((x, y) => x.at - y.at || (x.del ? -1 : 1));
  return { edits, from: mapThrough(a, edits, false), to: mapThrough(b, edits, true) };
}

/** A link (or a mention) taken away, its words left as they were. */
export function unlink(span: Span): Edit[] {
  return span.marks.map(([x, y]) => ({ at: x, del: y - x, ins: "" }));
}
