/**
 * The text of a PDF and the photos of its scanned pages, read by code with no library (docs/sistema.md §4.7, A-24):
 * what a file Juan drops on Boni's window, or a mail's attachment, gives a reader. It reads the page tree, each page's
 * content (text shown with its font's ToUnicode map, or its simple encoding) and the JPEG images a scanner leaves;
 * an encrypted PDF gives nothing. Everything it reads is capped: pages, bytes inflated, images.
 */
import { constants, inflateSync } from "node:zlib";

/** Pages read of one PDF, at most; the rest are left out and the reading says so. */
export const PDF_PAGES_MAX = 50;
/** Bytes inflated from one PDF, all its streams together: a «zip bomb» stops here. */
export const PDF_INFLATE_MAX = 64 * 1024 * 1024;
/** Images kept from one PDF (a scan's pages), each a JPEG as it is inside. */
export const PDF_IMAGES_MAX = 5;

export interface PdfReading {
  text: string;
  /** JPEG images of its pages, in order (a scan), at most `PDF_IMAGES_MAX`. */
  images: Uint8Array[];
  pages: number;
  /** More pages than were read. */
  cut: boolean;
  encrypted: boolean;
}

type PdfVal =
  | null
  | boolean
  | number
  | { name: string }
  | { str: Uint8Array }
  | { ref: number }
  | PdfVal[]
  | Dict
  | Stream;
class Dict {
  m: Record<string, PdfVal> = {};
}
class Stream {
  dict: Dict;
  raw: Uint8Array;
  constructor(dict: Dict, raw: Uint8Array) {
    this.dict = dict;
    this.raw = raw;
  }
}
interface Kw {
  kw: string;
}

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);

/** A lexer over bytes: PDF's tokens (and a content stream's operators, as keywords). */
class Lexer {
  b: Uint8Array;
  pos: number;
  constructor(b: Uint8Array, pos = 0) {
    this.b = b;
    this.pos = pos;
  }
  skip() {
    const b = this.b;
    while (this.pos < b.length) {
      const c = b[this.pos] as number;
      if (WS.has(c)) this.pos++;
      else if (c === 37) {
        while (this.pos < b.length && b[this.pos] !== 10 && b[this.pos] !== 13) this.pos++;
      } else break;
    }
  }
  /** The next token: a value, a keyword, or a structural mark («[», «]», «<<», «>>»); null at the end. */
  next(): PdfVal | Kw | null {
    this.skip();
    const b = this.b;
    if (this.pos >= b.length) return null;
    const c = b[this.pos] as number;
    if (c === 47) {
      // A name, with its #xx escapes.
      let s = "";
      this.pos++;
      while (this.pos < b.length) {
        const d = b[this.pos] as number;
        if (WS.has(d) || DELIM.has(d)) break;
        if (d === 35 && this.pos + 2 < b.length) {
          const h = Number.parseInt(
            String.fromCharCode(b[this.pos + 1] ?? 0, b[this.pos + 2] ?? 0),
            16,
          );
          if (!Number.isNaN(h)) {
            s += String.fromCharCode(h);
            this.pos += 3;
            continue;
          }
        }
        s += String.fromCharCode(d);
        this.pos++;
      }
      return { name: s };
    }
    if (c === 40) return { str: this.literal() };
    if (c === 60) {
      if (b[this.pos + 1] === 60) {
        this.pos += 2;
        return { kw: "<<" };
      }
      this.pos++;
      const out: number[] = [];
      let half = -1;
      while (this.pos < b.length && b[this.pos] !== 62) {
        const h = hexVal(b[this.pos] as number);
        this.pos++;
        if (h < 0) continue;
        if (half < 0) half = h;
        else {
          out.push(half * 16 + h);
          half = -1;
        }
      }
      if (half >= 0) out.push(half * 16);
      this.pos++;
      return { str: Uint8Array.from(out) };
    }
    if (c === 62 && b[this.pos + 1] === 62) {
      this.pos += 2;
      return { kw: ">>" };
    }
    if (c === 91 || c === 93 || c === 123 || c === 125) {
      this.pos++;
      return { kw: String.fromCharCode(c) };
    }
    let s = "";
    while (this.pos < b.length) {
      const d = b[this.pos] as number;
      if (WS.has(d) || DELIM.has(d)) break;
      s += String.fromCharCode(d);
      this.pos++;
    }
    if (!s) {
      this.pos++; // a stray delimiter (a lone «)» or «>»)
      return { kw: "" };
    }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return Number(s);
    if (s === "true") return true;
    if (s === "false") return false;
    if (s === "null") return null;
    return { kw: s };
  }
  literal(): Uint8Array {
    const b = this.b;
    const out: number[] = [];
    let depth = 0;
    this.pos++;
    while (this.pos < b.length) {
      const c = b[this.pos++] as number;
      if (c === 92) {
        const d = b[this.pos++] as number;
        const esc: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 };
        if (d in esc) out.push(esc[d] as number);
        else if (d >= 48 && d <= 55) {
          let v = d - 48;
          for (
            let i = 0;
            i < 2 && (b[this.pos] as number) >= 48 && (b[this.pos] as number) <= 55;
            i++
          )
            v = v * 8 + ((b[this.pos++] as number) - 48);
          out.push(v & 255);
        } else if (d === 13) {
          if (b[this.pos] === 10) this.pos++;
        } else if (d !== 10) out.push(d);
      } else if (c === 40) {
        depth++;
        out.push(c);
      } else if (c === 41) {
        if (depth === 0) break;
        depth--;
        out.push(c);
      } else out.push(c);
    }
    return Uint8Array.from(out);
  }
}
const hexVal = (c: number) =>
  c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1;
const isKw = (t: unknown, k?: string): t is Kw =>
  !!t && typeof t === "object" && "kw" in t && (k === undefined || (t as Kw).kw === k);

/** A value from the lexer: arrays and dictionaries whole, `n g R` as a reference (when `refs`). */
function parseValue(lx: Lexer, refs: boolean, depth = 0): PdfVal | Kw | null {
  if (depth > 64) throw new Error("too deep");
  const t = lx.next();
  if (isKw(t, "[")) {
    const out: PdfVal[] = [];
    for (;;) {
      const v = parseValue(lx, refs, depth + 1);
      if (v === null && lx.pos >= lx.b.length) break;
      if (isKw(v, "]")) break;
      if (isKw(v)) continue;
      out.push(v as PdfVal);
    }
    return out;
  }
  if (isKw(t, "<<")) {
    const d = new Dict();
    for (;;) {
      const k = lx.next();
      if (k === null || isKw(k, ">>")) break;
      if (!k || typeof k !== "object" || !("name" in k)) continue;
      const v = parseValue(lx, refs, depth + 1);
      if (isKw(v, ">>")) break;
      if (!isKw(v)) d.m[k.name] = v as PdfVal;
    }
    return d;
  }
  if (refs && typeof t === "number" && Number.isInteger(t)) {
    const at = lx.pos;
    const g = lx.next();
    if (typeof g === "number" && Number.isInteger(g)) {
      const r = lx.next();
      if (isKw(r, "R")) return { ref: t };
    }
    lx.pos = at;
  }
  return t;
}

const asName = (v: PdfVal | undefined): string | null =>
  v && typeof v === "object" && "name" in v ? v.name : null;

/** One PDF's objects, read when asked (the last definition of a number wins, as incremental updates mean). */
class Doc {
  b: Uint8Array;
  offsets = new Map<number, number>();
  cache = new Map<number, PdfVal>();
  inner = new Map<number, { stm: number; index: number }>();
  inflated = 0;
  constructor(b: Uint8Array) {
    this.b = b;
    const s = Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("latin1");
    for (const m of s.matchAll(/(\d+)\s+(\d+)\s+obj\b/g))
      this.offsets.set(Number(m[1]), (m.index ?? 0) + m[0].length);
    // The objects kept compressed inside object streams.
    for (const n of [...this.offsets.keys()]) {
      const o = this.get(n);
      if (!(o instanceof Stream) || asName(o.dict.m.Type) !== "ObjStm") continue;
      const data = this.decode(o);
      if (!data) continue;
      const first = this.num(o.dict.m.First);
      const head = new Lexer(data);
      const count = Math.min(this.num(o.dict.m.N), 100_000);
      const nums: number[] = [];
      for (let i = 0; i < count; i++) {
        const num = head.next();
        head.next();
        if (typeof num !== "number") break;
        nums.push(num);
      }
      nums.forEach((num, index) => {
        if (!this.offsets.has(num) && !this.inner.has(num)) this.inner.set(num, { stm: n, index });
      });
      this.cacheInner(n, data, first, nums);
    }
  }
  private cacheInner(_stm: number, data: Uint8Array, first: number, nums: number[]) {
    const head = new Lexer(data);
    const offs: number[] = [];
    for (let i = 0; i < nums.length; i++) {
      head.next();
      const off = head.next();
      offs.push(typeof off === "number" ? off : 0);
    }
    nums.forEach((num, i) => {
      if (this.offsets.has(num) || this.cache.has(num)) return;
      try {
        const v = parseValue(new Lexer(data, first + (offs[i] ?? 0)), true);
        this.cache.set(num, isKw(v) ? null : (v as PdfVal));
      } catch {
        this.cache.set(num, null);
      }
    });
  }
  num(v: PdfVal | undefined): number {
    const x = this.res(v);
    return typeof x === "number" ? x : 0;
  }
  /** A value with its reference followed. */
  res(v: PdfVal | undefined, depth = 0): PdfVal | undefined {
    if (depth > 8) return undefined;
    if (v && typeof v === "object" && "ref" in v)
      return this.res(this.get(v.ref) ?? undefined, depth + 1);
    return v;
  }
  dict(v: PdfVal | undefined): Dict | null {
    const x = this.res(v);
    return x instanceof Dict ? x : x instanceof Stream ? x.dict : null;
  }
  get(n: number): PdfVal {
    if (this.cache.has(n)) return this.cache.get(n) ?? null;
    const at = this.offsets.get(n);
    if (at === undefined) return null;
    this.cache.set(n, null); // a cycle through itself reads nothing
    let v: PdfVal = null;
    try {
      const lx = new Lexer(this.b, at);
      const x = parseValue(lx, true);
      v = isKw(x) ? null : (x as PdfVal);
      if (v instanceof Dict) {
        const save = lx.pos;
        const k = lx.next();
        if (isKw(k, "stream")) {
          let p = lx.pos;
          if (this.b[p] === 13) p++;
          if (this.b[p] === 10) p++;
          const len = this.lengthOf(v.m.Length);
          const end = this.endOf(p, len);
          v = new Stream(v, this.b.subarray(p, end));
        } else lx.pos = save;
      }
    } catch {
      v = null;
    }
    this.cache.set(n, v);
    return v;
  }
  private lengthOf(v: PdfVal | undefined): number {
    if (typeof v === "number") return v;
    if (v && typeof v === "object" && "ref" in v) {
      const at = this.offsets.get(v.ref);
      if (at !== undefined) {
        const x = new Lexer(this.b, at).next();
        if (typeof x === "number") return x;
      }
    }
    return -1;
  }
  /** Where a stream's data ends: by its length when «endstream» follows it, else by «endstream». */
  private endOf(p: number, len: number): number {
    const b = this.b;
    if (len >= 0 && p + len <= b.length) {
      let q = p + len;
      while (q < b.length && WS.has(b[q] as number)) q++;
      if (
        Buffer.from(b.buffer, b.byteOffset + q, Math.min(9, b.length - q)).toString("latin1") ===
        "endstream"
      )
        return p + len;
    }
    const at = Buffer.from(b.buffer, b.byteOffset, b.byteLength).indexOf("endstream", p, "latin1");
    let end = at < 0 ? b.length : at;
    if (b[end - 1] === 10) end--;
    if (b[end - 1] === 13) end--;
    return end;
  }
  /** The filters of a stream, as names. */
  filters(s: Stream): string[] {
    const f = this.res(s.dict.m.Filter);
    return Array.isArray(f) ? f.map((x) => asName(this.res(x)) ?? "") : f ? [asName(f) ?? ""] : [];
  }
  /** A stream's bytes, decoded; null for a filter it does not read (an image's, an unknown one). */
  decode(s: Stream): Uint8Array | null {
    let data = s.raw;
    const parms = this.res(s.dict.m.DecodeParms);
    const fs = this.filters(s);
    for (const [i, f] of fs.entries()) {
      if (f === "FlateDecode" || f === "Fl") {
        const room = PDF_INFLATE_MAX - this.inflated;
        if (room <= 0) return null;
        data = inflate(data, room);
        this.inflated += data.byteLength;
        const p = this.dict(Array.isArray(parms) ? parms[i] : parms);
        const predictor = p ? this.num(p.m.Predictor) : 0;
        if (predictor >= 10) {
          const out = unpredict(
            data,
            p ? this.num(p.m.Columns) || 1 : 1,
            p ? this.num(p.m.Colors) || 1 : 1,
          );
          if (!out) return null;
          data = out;
        } else if (predictor > 1) return null;
      } else if (f === "ASCIIHexDecode" || f === "AHx") data = asciiHex(data);
      else if (f === "ASCII85Decode" || f === "A85") data = ascii85(data);
      else return null;
    }
    return data;
  }
}

function inflate(data: Uint8Array, max: number): Uint8Array {
  try {
    return inflateSync(data, { maxOutputLength: max });
  } catch {
    // A stream cut short still gives what it had.
    try {
      return inflateSync(data, { finishFlush: constants.Z_SYNC_FLUSH, maxOutputLength: max });
    } catch {
      return new Uint8Array();
    }
  }
}
/** PNG predictors (10 to 15), each row with its own filter byte. */
function unpredict(data: Uint8Array, columns: number, colors: number): Uint8Array | null {
  const bpp = colors;
  const row = columns * colors;
  const rows = Math.floor(data.length / (row + 1));
  const out = new Uint8Array(rows * row);
  for (let r = 0; r < rows; r++) {
    const f = data[r * (row + 1)] as number;
    for (let i = 0; i < row; i++) {
      const x = data[r * (row + 1) + 1 + i] as number;
      const a = i >= bpp ? (out[r * row + i - bpp] as number) : 0;
      const up = r > 0 ? (out[(r - 1) * row + i] as number) : 0;
      const c = r > 0 && i >= bpp ? (out[(r - 1) * row + i - bpp] as number) : 0;
      let v: number;
      if (f === 0) v = x;
      else if (f === 1) v = x + a;
      else if (f === 2) v = x + up;
      else if (f === 3) v = x + ((a + up) >> 1);
      else if (f === 4) {
        const p = a + up - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c);
      } else return null;
      out[r * row + i] = v & 255;
    }
  }
  return out;
}
function asciiHex(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let half = -1;
  for (const c of data) {
    if (c === 62) break;
    const h = hexVal(c);
    if (h < 0) continue;
    if (half < 0) half = h;
    else {
      out.push(half * 16 + h);
      half = -1;
    }
  }
  if (half >= 0) out.push(half * 16);
  return Uint8Array.from(out);
}
function ascii85(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let group: number[] = [];
  const flush = (n: number) => {
    while (group.length < 5) group.push(84);
    let v = 0;
    for (const g of group) v = v * 85 + g;
    const bytes = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    out.push(...bytes.slice(0, n));
    group = [];
  };
  for (const c of data) {
    if (c === 126) break; // ~>
    if (WS.has(c)) continue;
    if (c === 122 && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    if (c < 33 || c > 117) continue;
    group.push(c - 33);
    if (group.length === 5) flush(4);
  }
  if (group.length) flush(group.length - 1);
  return Uint8Array.from(out);
}

/** How a font's codes become text: its ToUnicode map, or its simple encoding. */
interface Font {
  bytes: 1 | 2;
  map: Map<number, string>;
  /** A simple font's code with no map: its encoding (WinAnsi, or its Differences). */
  simple: boolean;
  /** Each code's advance, in thousandths of the size (`Widths`, or a CID font's `W`); `dw` for the rest. */
  widths: Map<number, number>;
  dw: number;
}

/** Glyph names a font's Differences give, as text (the Adobe Glyph List, the part European text uses). */
const GLYPHS: Record<string, string> = {
  space: " ",
  exclam: "!",
  quotedbl: '"',
  numbersign: "#",
  dollar: "$",
  percent: "%",
  ampersand: "&",
  quotesingle: "'",
  parenleft: "(",
  parenright: ")",
  asterisk: "*",
  plus: "+",
  comma: ",",
  hyphen: "-",
  period: ".",
  slash: "/",
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  colon: ":",
  semicolon: ";",
  less: "<",
  equal: "=",
  greater: ">",
  question: "?",
  at: "@",
  bracketleft: "[",
  backslash: "\\",
  bracketright: "]",
  underscore: "_",
  braceleft: "{",
  bar: "|",
  braceright: "}",
  asciitilde: "~",
  quoteright: "’",
  quoteleft: "‘",
  quotedblleft: "“",
  quotedblright: "”",
  endash: "–",
  emdash: "—",
  bullet: "•",
  ellipsis: "…",
  Euro: "€",
  euro: "€",
  ordfeminine: "ª",
  ordmasculine: "º",
  degree: "°",
  exclamdown: "¡",
  questiondown: "¿",
  guillemotleft: "«",
  guillemotright: "»",
  periodcentered: "·",
  minus: "−",
  multiply: "×",
  divide: "÷",
  copyright: "©",
  registered: "®",
  section: "§",
  paragraph: "¶",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Uacute: "Ú",
  ntilde: "ñ",
  Ntilde: "Ñ",
  udieresis: "ü",
  Udieresis: "Ü",
  agrave: "à",
  egrave: "è",
  igrave: "ì",
  ograve: "ò",
  ugrave: "ù",
  Agrave: "À",
  Egrave: "È",
  ccedilla: "ç",
  Ccedilla: "Ç",
  adieresis: "ä",
  odieresis: "ö",
  Adieresis: "Ä",
  Odieresis: "Ö",
  germandbls: "ß",
  acircumflex: "â",
  ecircumflex: "ê",
  icircumflex: "î",
  ocircumflex: "ô",
  ucircumflex: "û",
  idieresis: "ï",
  edieresis: "ë",
  atilde: "ã",
  otilde: "õ",
  fi: "fi",
  fl: "fl",
  nbspace: " ",
  sterling: "£",
  yen: "¥",
  cent: "¢",
};
const glyphText = (name: string): string => {
  if (name in GLYPHS) return GLYPHS[name] as string;
  if (/^[A-Za-z]$/.test(name)) return name;
  const u = /^uni([0-9A-Fa-f]{4})$/.exec(name) ?? /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  return u ? String.fromCodePoint(Number.parseInt(u[1] as string, 16)) : "";
};
/** Windows-1252's bytes 0x80–0x9F (WinAnsiEncoding, the usual simple font's); the rest is Latin-1. */
const CP1252: Record<number, string> = {
  128: "€",
  130: "‚",
  131: "ƒ",
  132: "„",
  133: "…",
  134: "†",
  135: "‡",
  136: "ˆ",
  137: "‰",
  138: "Š",
  139: "‹",
  140: "Œ",
  142: "Ž",
  145: "‘",
  146: "’",
  147: "“",
  148: "”",
  149: "•",
  150: "–",
  151: "—",
  152: "˜",
  153: "™",
  154: "š",
  155: "›",
  156: "œ",
  158: "ž",
  159: "Ÿ",
};

function utf16be(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i + 1 < b.length; i += 2)
    s += String.fromCharCode(((b[i] as number) << 8) | (b[i + 1] as number));
  return s;
}
const codeOf = (b: Uint8Array): number => b.reduce((v, x) => v * 256 + x, 0);

/** A font's ToUnicode CMap: its code size and what each code says. */
function readCMap(data: Uint8Array): { bytes: 1 | 2; map: Map<number, string> } {
  const lx = new Lexer(data);
  const map = new Map<number, string>();
  let bytes: 1 | 2 = 1;
  const ops: (PdfVal | Kw)[] = [];
  for (let t = lx.next(); t !== null; t = lx.next()) {
    if (isKw(t, "[")) {
      lx.pos--;
      const arr = parseValue(lx, false);
      ops.push(arr as PdfVal);
      continue;
    }
    if (isKw(t, "endcodespacerange")) {
      const lens = ops.filter(
        (x): x is { str: Uint8Array } => !!x && typeof x === "object" && "str" in x,
      );
      if (lens.length && lens.every((x) => x.str.length === 2)) bytes = 2;
      ops.length = 0;
    } else if (isKw(t, "endbfchar")) {
      for (let i = 0; i + 1 < ops.length; i += 2) {
        const a = ops[i];
        const v = ops[i + 1];
        if (a && typeof a === "object" && "str" in a && v && typeof v === "object" && "str" in v)
          map.set(codeOf(a.str), utf16be(v.str));
      }
      ops.length = 0;
    } else if (isKw(t, "endbfrange")) {
      for (let i = 0; i + 2 < ops.length; i += 3) {
        const lo = ops[i];
        const hi = ops[i + 1];
        const v = ops[i + 2];
        if (
          !(
            lo &&
            typeof lo === "object" &&
            "str" in lo &&
            hi &&
            typeof hi === "object" &&
            "str" in hi
          )
        )
          continue;
        const a = codeOf(lo.str);
        const z = Math.min(codeOf(hi.str), a + 65_535);
        if (Array.isArray(v))
          v.forEach((x, k) => {
            if (x && typeof x === "object" && "str" in x && a + k <= z)
              map.set(a + k, utf16be(x.str));
          });
        else if (v && typeof v === "object" && "str" in v) {
          const base = v.str;
          for (let c = a; c <= z; c++) {
            const d = Uint8Array.from(base);
            const last = d.length - 1;
            if (last >= 0) {
              const sum = (d[last] as number) + (c - a);
              d[last] = sum & 255;
              if (last >= 1) d[last - 1] = ((d[last - 1] as number) + (sum >> 8)) & 255;
            }
            map.set(c, utf16be(d));
          }
        }
      }
      ops.length = 0;
    } else if (
      isKw(t, "begincodespacerange") ||
      isKw(t, "beginbfchar") ||
      isKw(t, "beginbfrange")
    ) {
      ops.length = 0;
    } else if (!isKw(t)) ops.push(t);
    else ops.length = 0;
  }
  return { bytes, map };
}

function fontOf(doc: Doc, v: PdfVal | undefined, cache: Map<unknown, Font>): Font {
  const key = v && typeof v === "object" && "ref" in v ? v.ref : v;
  const hit = cache.get(key);
  if (hit) return hit;
  const d = doc.dict(v);
  const font: Font = { bytes: 1, map: new Map(), simple: true, widths: new Map(), dw: 500 };
  if (d) {
    const type0 = asName(d.m.Subtype) === "Type0";
    readWidths(doc, d, type0, font);
    const tu = doc.res(d.m.ToUnicode);
    if (tu instanceof Stream) {
      const data = doc.decode(tu);
      if (data) {
        const c = readCMap(data);
        font.bytes = type0 ? 2 : c.bytes;
        font.map = c.map;
      }
    } else if (type0) font.bytes = 2;
    font.simple = !type0;
    const enc = doc.res(d.m.Encoding);
    const diffs = enc instanceof Dict ? doc.res(enc.m.Differences) : undefined;
    if (!type0 && Array.isArray(diffs)) {
      let code = 0;
      for (const x of diffs) {
        const y = doc.res(x);
        if (typeof y === "number") code = y;
        else {
          const n = asName(y);
          if (n !== null) {
            const t = glyphText(n);
            if (t && !font.map.has(code)) font.map.set(code, t);
            code++;
          }
        }
      }
    }
  }
  cache.set(key, font);
  return font;
}
/** How far each code moves the pen: what tells a space from a pen moved between two pieces of one word. */
function readWidths(doc: Doc, d: Dict, type0: boolean, font: Font) {
  if (type0) {
    const desc = doc.res(d.m.DescendantFonts);
    const cid = doc.dict(Array.isArray(desc) ? desc[0] : undefined);
    if (!cid) return;
    font.dw = cid.m.DW !== undefined ? doc.num(cid.m.DW) : 1000;
    const w = doc.res(cid.m.W);
    if (!Array.isArray(w)) return;
    for (let i = 0; i < w.length && font.widths.size < 70_000; ) {
      const first = doc.num(w[i]);
      const next = doc.res(w[i + 1]);
      if (Array.isArray(next)) {
        for (const [k, x] of next.entries()) font.widths.set(first + k, doc.num(x));
        i += 2;
      } else {
        const last = Math.min(doc.num(next), first + 65_535);
        const width = doc.num(w[i + 2]);
        for (let c = first; c <= last; c++) font.widths.set(c, width);
        i += 3;
      }
    }
    return;
  }
  const fd = doc.dict(d.m.FontDescriptor);
  if (fd?.m.MissingWidth !== undefined) font.dw = doc.num(fd.m.MissingWidth);
  const ws = doc.res(d.m.Widths);
  const first = doc.num(d.m.FirstChar);
  if (Array.isArray(ws)) for (const [k, x] of ws.entries()) font.widths.set(first + k, doc.num(x));
}
/** How far a string moves the pen, in text space at size `size`. */
function advance(font: Font | null, s: Uint8Array, size: number): number {
  let w = 0;
  if (font?.bytes === 2)
    for (let i = 0; i + 1 < s.length; i += 2)
      w += font.widths.get(((s[i] as number) << 8) | (s[i + 1] as number)) ?? font.dw;
  else for (const c of s) w += font?.widths.get(c) ?? font?.dw ?? 500;
  return (w / 1000) * size;
}
function show(font: Font | null, s: Uint8Array): string {
  if (!font) return Buffer.from(s).toString("latin1");
  let out = "";
  if (font.bytes === 2) {
    for (let i = 0; i + 1 < s.length; i += 2)
      out += font.map.get(((s[i] as number) << 8) | (s[i + 1] as number)) ?? "";
    return out;
  }
  for (const c of s)
    out +=
      font.map.get(c) ??
      (font.simple ? (CP1252[c] ?? (c >= 32 ? String.fromCharCode(c) : "")) : "");
  return out;
}

interface Run {
  doc: Doc;
  lines: string[];
  line: string;
  /** Where the last piece shown ended, in the page's text space. */
  end: { x: number; y: number } | null;
  images: Uint8Array[];
  fonts: Map<unknown, Font>;
}
const newline = (r: Run) => {
  const t = r.line.replace(/\s+/g, " ").trim();
  if (t) r.lines.push(t);
  r.line = "";
};

/** Runs a content stream for its text (and its images), Form XObjects inside it up to depth 3. */
function runContent(r: Run, data: Uint8Array, res: Dict | null, depth: number) {
  const { doc } = r;
  const lx = new Lexer(data);
  const stack: (PdfVal | Kw)[] = [];
  let font: Font | null = null;
  let size = 1;
  // The text matrix's scale and origin (Tm, moved by Td), and where the last piece shown ended: a piece on the same
  // line that starts further than a fifth of the size from there follows a space; one on another line, a new line.
  let tm = [1, 0, 0, 1, 0, 0];
  let line = [0, 0];
  let pen = 0;
  const at = (s0: Uint8Array) => {
    const x = (tm[4] as number) + pen * (tm[0] as number);
    const y = tm[5] as number;
    const scale = Math.abs(tm[0] as number) || 1;
    if (r.end) {
      if (Math.abs(y - r.end.y) > Math.max(1, size * scale * 0.4)) newline(r);
      else if (x - r.end.x > size * scale * 0.2 || r.end.x - x > size * scale * 4) r.line += " ";
    }
    pen += advance(font, s0, size);
    r.end = { x: (tm[4] as number) + pen * (tm[0] as number), y };
  };
  const resDict = (k: string) => (res ? doc.dict(res.m[k]) : null);
  for (let t = lx.next(); t !== null; t = lx.next()) {
    if (isKw(t, "[") || isKw(t, "<<")) {
      lx.pos -= t.kw.length;
      stack.push(parseValue(lx, false) as PdfVal);
      continue;
    }
    if (!isKw(t)) {
      stack.push(t);
      if (stack.length > 1000) stack.shift();
      continue;
    }
    const op = t.kw;
    const arg = (i: number) => stack[stack.length - 1 - i];
    switch (op) {
      case "BT":
        tm = [1, 0, 0, 1, 0, 0];
        line = [0, 0];
        pen = 0;
        break;
      case "Tf": {
        const n = asName(arg(1) as PdfVal);
        const fonts = resDict("Font");
        font = n && fonts ? fontOf(doc, fonts.m[n], r.fonts) : null;
        const z = arg(0);
        size = typeof z === "number" && z !== 0 ? Math.abs(z) : 1;
        break;
      }
      case "Td":
      case "TD": {
        const tx = arg(1);
        const ty = arg(0);
        if (typeof tx !== "number" || typeof ty !== "number") break;
        line = [
          (line[0] as number) + tx * (tm[0] as number) + ty * (tm[2] as number),
          (line[1] as number) + tx * (tm[1] as number) + ty * (tm[3] as number),
        ];
        tm = [tm[0], tm[1], tm[2], tm[3], line[0], line[1]] as number[];
        pen = 0;
        break;
      }
      case "Tm": {
        const m = [5, 4, 3, 2, 1, 0].map((k) => arg(k));
        if (!m.every((x) => typeof x === "number")) break;
        tm = m as number[];
        line = [tm[4] as number, tm[5] as number];
        pen = 0;
        break;
      }
      case "T*":
        newline(r);
        r.end = null;
        pen = 0;
        break;
      case "Tj":
      case "'":
      case '"': {
        if (op !== "Tj") {
          newline(r);
          r.end = null;
          pen = 0;
        }
        const s = arg(0);
        if (s && typeof s === "object" && "str" in s) {
          at(s.str);
          r.line += show(font, s.str);
        }
        break;
      }
      case "TJ": {
        const a = arg(0);
        if (Array.isArray(a))
          for (const x of a) {
            if (x && typeof x === "object" && "str" in x) {
              at(x.str);
              r.line += show(font, x.str);
            } else if (typeof x === "number") pen -= (x / 1000) * size;
          }
        break;
      }
      case "Do": {
        const n = asName(arg(0) as PdfVal);
        const xs = resDict("XObject");
        const x = n && xs ? doc.res(xs.m[n]) : undefined;
        if (!(x instanceof Stream)) break;
        const sub = asName(x.dict.m.Subtype);
        if (sub === "Form" && depth < 3) {
          const data2 = doc.decode(x);
          if (data2) runContent(r, data2, doc.dict(x.dict.m.Resources) ?? res, depth + 1);
        } else if (sub === "Image" && r.images.length < PDF_IMAGES_MAX) {
          const fs = doc.filters(x);
          if (fs.length === 1 && (fs[0] === "DCTDecode" || fs[0] === "DCT")) r.images.push(x.raw);
        }
        break;
      }
      case "BI": {
        // An inline image: its data is skipped to its «EI».
        const b = lx.b;
        const id = Buffer.from(b.buffer, b.byteOffset, b.byteLength).indexOf(
          "ID",
          lx.pos,
          "latin1",
        );
        if (id < 0) return;
        let p = id + 3;
        for (; p < b.length - 2; p++)
          if (
            WS.has(b[p - 1] as number) &&
            b[p] === 69 &&
            b[p + 1] === 73 &&
            (p + 2 >= b.length || WS.has(b[p + 2] as number))
          )
            break;
        lx.pos = p + 2;
        break;
      }
    }
    stack.length = 0;
  }
}

/** The pages in order, each with the resources it inherits. */
function pagesOf(doc: Doc): { page: Dict; res: Dict | null }[] {
  const out: { page: Dict; res: Dict | null }[] = [];
  const seen = new Set<Dict>();
  const walk = (v: PdfVal | undefined, res: Dict | null, depth: number) => {
    const d = doc.dict(v);
    if (!d || seen.has(d) || depth > 32 || out.length > PDF_PAGES_MAX) return;
    seen.add(d);
    const here = doc.dict(d.m.Resources) ?? res;
    const kids = doc.res(d.m.Kids);
    if (Array.isArray(kids)) for (const k of kids) walk(k, here, depth + 1);
    else if (asName(d.m.Type) === "Page" || d.m.Contents !== undefined)
      out.push({ page: d, res: here });
  };
  for (const n of [...doc.offsets.keys(), ...doc.inner.keys()]) {
    const d = doc.dict(doc.get(n));
    if (d && asName(d.m.Type) === "Catalog") {
      walk(d.m.Pages, null, 0);
      if (out.length) return out;
    }
  }
  // No catalogue to follow (a broken file): its pages in the order of their numbers.
  for (const n of [...doc.offsets.keys()].sort((a, b) => a - b)) {
    const d = doc.dict(doc.get(n));
    if (d && asName(d.m.Type) === "Page") out.push({ page: d, res: doc.dict(d.m.Resources) });
  }
  return out;
}

/** What code reads of a PDF: its pages' text, and its scanned pages' JPEGs. */
export function readPdf(bytes: Uint8Array): PdfReading {
  const head = Buffer.from(
    bytes.buffer,
    bytes.byteOffset,
    Math.min(bytes.byteLength, 1024),
  ).toString("latin1");
  const none = (encrypted: boolean): PdfReading => ({
    text: "",
    images: [],
    pages: 0,
    cut: false,
    encrypted,
  });
  if (!head.includes("%PDF-")) return none(false);
  const all = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (/\/Encrypt\s*(\d+\s+\d+\s+R|<<)/.test(all.toString("latin1"))) return none(true);
  const doc = new Doc(bytes);
  const pages = pagesOf(doc);
  const r: Run = { doc, lines: [], line: "", end: null, images: [], fonts: new Map() };
  for (const { page, res } of pages.slice(0, PDF_PAGES_MAX)) {
    const c = doc.res(page.m.Contents);
    const parts = Array.isArray(c) ? c.map((x) => doc.res(x)) : [c];
    const data = parts.flatMap((p) => {
      const d = p instanceof Stream ? doc.decode(p) : null;
      return d ? [d, Uint8Array.of(10)] : [];
    });
    if (data.length) runContent(r, Buffer.concat(data), res, 0);
    newline(r);
    r.end = null;
    r.lines.push("");
  }
  return {
    // A ligature («ﬁ») is its letters.
    text: r.lines
      .join("\n")
      .replace(/[\uFB00-\uFB06]/g, (c) => c.normalize("NFKC"))
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    images: r.images,
    pages: pages.length,
    cut: pages.length > PDF_PAGES_MAX,
    encrypted: false,
  };
}
