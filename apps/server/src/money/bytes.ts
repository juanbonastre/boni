/**
 * Bytes without Node (docs/extensiones.md, E4: the reconciliation runs in the box, a QuickJS interpreter that has none
 * of Node's): little-endian numbers, pieces joined, base64, raw DEFLATE (a .xlsx's entries), SHA-1 (a bank line's
 * reference) and the encodings statements come in, each read as Node's Buffer and the WHATWG decoders read it.
 */

const cut = () => new RangeError("el archivo se acaba antes de tiempo");

/** An unsigned 16-bit little-endian number; past the end it throws, as Buffer does. */
export function u16(b: Uint8Array, at: number): number {
  if (!(at >= 0 && at + 2 <= b.length)) throw cut();
  return (b[at] as number) | ((b[at + 1] as number) << 8);
}

/** An unsigned 32-bit little-endian number. */
export function u32(b: Uint8Array, at: number): number {
  if (!(at >= 0 && at + 4 <= b.length)) throw cut();
  return (
    ((b[at] as number) | ((b[at + 1] as number) << 8) | ((b[at + 2] as number) << 16)) +
    (b[at + 3] as number) * 0x1000000
  );
}

/** A signed 32-bit little-endian number. */
export const i32 = (b: Uint8Array, at: number): number => u32(b, at) | 0;

/** A little-endian double. */
export function f64(b: Uint8Array, at: number): number {
  if (!(at >= 0 && at + 8 <= b.length)) throw cut();
  return new DataView(b.buffer, b.byteOffset + at, 8).getFloat64(0, true);
}

/** Pieces as one. */
export function concat(parts: readonly Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Whether `b` starts with `head`. */
export const startsWith = (b: Uint8Array, head: Uint8Array): boolean =>
  b.length >= head.length && head.every((x, i) => b[i] === x);

/** UTF-16 code units as text, a piece at a time (an interpreter takes only so many arguments at once). */
function text(units: Uint16Array, n: number): string {
  const parts: string[] = [];
  for (let i = 0; i < n; i += 4096)
    parts.push(String.fromCharCode(...units.subarray(i, Math.min(n, i + 4096))));
  return parts.join("");
}

/** Each byte as the character of its code (Buffer's "latin1"). */
export const latin1 = (b: Uint8Array): string => text(Uint16Array.from(b), b.length);

/** UTF-16 little-endian (Buffer's "utf16le"): two bytes a unit, a last odd byte left out. */
export function utf16le(b: Uint8Array): string {
  const n = b.length >> 1;
  const units = new Uint16Array(n);
  for (let i = 0; i < n; i++) units[i] = (b[2 * i] as number) | ((b[2 * i + 1] as number) << 8);
  return text(units, n);
}

/** Windows-1252's 0x80–0x9F, as the WHATWG index has them (the five it leaves undefined are their own code). */
const CP1252 = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152,
  0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122,
  0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

/** Windows-1252 (TextDecoder's "windows-1252"). */
export function cp1252(b: Uint8Array): string {
  const units = Uint16Array.from(b, (x) =>
    x >= 0x80 && x < 0xa0 ? (CP1252[x - 0x80] as number) : x,
  );
  return text(units, units.length);
}

/**
 * UTF-8 as the WHATWG decoder reads it. With `fatal` (TextDecoder's `fatal: true`), an invalid sequence throws and a
 * first BOM is left out; without (Buffer's "utf8"), each invalid sequence is one U+FFFD and a BOM stays.
 */
export function utf8(b: Uint8Array, o: { fatal?: boolean } = {}): string {
  const units = new Uint16Array(b.length);
  let n = 0;
  let i = o.fatal && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0;
  const bad = () => {
    if (o.fatal) throw new TypeError("el texto no es UTF-8");
    units[n++] = 0xfffd;
  };
  while (i < b.length) {
    const c = b[i] as number;
    if (c < 0x80) {
      units[n++] = c;
      i++;
      continue;
    }
    let need = 0;
    let cp = 0;
    let lower = 0x80;
    let upper = 0xbf;
    if (c >= 0xc2 && c <= 0xdf) {
      need = 1;
      cp = c & 0x1f;
    } else if (c >= 0xe0 && c <= 0xef) {
      need = 2;
      cp = c & 0xf;
      if (c === 0xe0) lower = 0xa0;
      if (c === 0xed) upper = 0x9f;
    } else if (c >= 0xf0 && c <= 0xf4) {
      need = 3;
      cp = c & 7;
      if (c === 0xf0) lower = 0x90;
      if (c === 0xf4) upper = 0x8f;
    } else {
      bad();
      i++;
      continue;
    }
    let j = i + 1;
    let whole = true;
    for (let k = 0; k < need; k++, j++) {
      const x = b[j];
      if (x === undefined || x < lower || x > upper) {
        whole = false;
        break;
      }
      lower = 0x80;
      upper = 0xbf;
      cp = (cp << 6) | (x & 0x3f);
    }
    // A broken sequence is one U+FFFD, and the byte that broke it is read again.
    if (!whole) bad();
    else if (cp >= 0x10000) {
      cp -= 0x10000;
      units[n++] = 0xd800 + (cp >> 10);
      units[n++] = 0xdc00 + (cp & 0x3ff);
    } else units[n++] = cp;
    i = j;
  }
  return text(units, n);
}

/** Text as UTF-8 bytes; a lone surrogate as U+FFFD, as Node writes it. */
export function utf8Bytes(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      } else c = 0xfffd;
    } else if (c >= 0xdc00 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else
      out.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      );
  }
  return Uint8Array.from(out);
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_VALUE = new Map([...B64].map((ch, i) => [ch.charCodeAt(0), i]));

/** Base64 (spaces and padding aside) as bytes; throws on anything else. */
export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[\s=]+/g, "");
  if (/[^A-Za-z0-9+/]/.test(clean) || clean.length % 4 === 1) throw new Error("no es base64");
  const out = new Uint8Array((clean.length * 3) >> 2);
  let acc = 0;
  let bits = 0;
  let n = 0;
  for (let i = 0; i < clean.length; i++) {
    acc = ((acc << 6) | (B64_VALUE.get(clean.charCodeAt(i)) as number)) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

/** SHA-1 of a text's UTF-8 bytes, in hex (what `createHash("sha1").update(s, "utf8")` gives). */
export function sha1Hex(s: string): string {
  const m = utf8Bytes(s);
  const blocks = ((m.length + 8) >> 6) + 1;
  const w = new Uint32Array(blocks * 16);
  for (let i = 0; i < m.length; i++)
    w[i >> 2] = (w[i >> 2] as number) | ((m[i] as number) << (24 - (i & 3) * 8));
  w[m.length >> 2] = (w[m.length >> 2] as number) | (0x80 << (24 - (m.length & 3) * 8));
  w[blocks * 16 - 2] = Math.floor((m.length * 8) / 0x100000000);
  w[blocks * 16 - 1] = (m.length * 8) >>> 0;
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const x = new Int32Array(80);
  for (let at = 0; at < w.length; at += 16) {
    for (let t = 0; t < 16; t++) x[t] = w[at + t] as number;
    for (let t = 16; t < 80; t++) {
      const v =
        (x[t - 3] as number) ^ (x[t - 8] as number) ^ (x[t - 14] as number) ^ (x[t - 16] as number);
      x[t] = (v << 1) | (v >>> 31);
    }
    let [a, b, c, d, e] = h as [number, number, number, number, number];
    for (let t = 0; t < 80; t++) {
      const f =
        t < 20
          ? (b & c) | (~b & d)
          : t < 40
            ? b ^ c ^ d
            : t < 60
              ? (b & c) | (b & d) | (c & d)
              : b ^ c ^ d;
      const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const next = (((a << 5) | (a >>> 27)) + f + e + k + (x[t] as number)) | 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = next;
    }
    h[0] = ((h[0] as number) + a) | 0;
    h[1] = ((h[1] as number) + b) | 0;
    h[2] = ((h[2] as number) + c) | 0;
    h[3] = ((h[3] as number) + d) | 0;
    h[4] = ((h[4] as number) + e) | 0;
  }
  return h.map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
}

// ------------------------------------------------------------------ raw DEFLATE (RFC 1951)

const LEN_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LEN_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
const LENGTHS_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

const broken = () => new Error("los datos comprimidos están dañados");

/**
 * A Huffman code as a table: for every run of its longest code's bits, read from the stream's low bit first, its
 * symbol and its length (`symbol << 4 | length`; 0 where no code is).
 */
function huffman(lengths: ArrayLike<number>): { table: Uint16Array; bits: number } {
  let max = 0;
  for (let i = 0; i < lengths.length; i++) max = Math.max(max, lengths[i] as number);
  if (!max) return { table: new Uint16Array(1), bits: 0 };
  const count = new Uint16Array(max + 1);
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i] as number;
    if (len) count[len] = (count[len] as number) + 1;
  }
  // The first code of each length (RFC 1951 3.2.2).
  const next = new Uint16Array(max + 1);
  for (let len = 1, code = 0; len <= max; len++) {
    code = (code + (count[len - 1] as number)) << 1;
    next[len] = code;
  }
  const table = new Uint16Array(1 << max);
  for (let sym = 0; sym < lengths.length; sym++) {
    const len = lengths[sym] as number;
    if (!len) continue;
    const code = next[len] as number;
    next[len] = code + 1;
    let rev = 0;
    for (let k = 0; k < len; k++) rev |= ((code >> k) & 1) << (len - 1 - k);
    for (let at = rev; at < table.length; at += 1 << len) table[at] = (sym << 4) | len;
  }
  return { table, bits: max };
}

const FIXED_LIT = huffman(
  Array.from({ length: 288 }, (_x, i) => (i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8)),
);
const FIXED_DIST = huffman(Array.from({ length: 30 }, () => 5));

/** Raw DEFLATE data (a ZIP entry's) uncompressed, as zlib's `inflateRawSync` does; throws if it is damaged. */
export function inflateRaw(d: Uint8Array): Uint8Array {
  const end = d.length * 8;
  let pos = 0;
  let out = new Uint8Array(Math.max(1024, d.length * 4));
  let n = 0;
  const room = (k: number) => {
    if (n + k <= out.length) return;
    const bigger = new Uint8Array(Math.max(out.length * 2, n + k));
    bigger.set(out.subarray(0, n));
    out = bigger;
  };
  /** Up to 17 bits from the stream at `pos` (past its end, zeros: each read is then checked against the end). */
  const peek = (p: number) => {
    const o = p >> 3;
    return (((d[o] ?? 0) | ((d[o + 1] ?? 0) << 8) | ((d[o + 2] ?? 0) << 16)) >> (p & 7)) >>> 0;
  };
  const take = (k: number) => {
    if (!k) return 0;
    const v = peek(pos) & ((1 << k) - 1);
    pos += k;
    if (pos > end) throw broken();
    return v;
  };
  const symbol = (h: { table: Uint16Array; bits: number }) => {
    const c = h.table[peek(pos) & ((1 << h.bits) - 1)] as number;
    if (!(c & 15)) throw broken();
    pos += c & 15;
    if (pos > end) throw broken();
    return c >> 4;
  };
  for (let last = 0; !last; ) {
    last = take(1);
    const type = take(2);
    if (type === 0) {
      pos = (pos + 7) & ~7;
      const at = pos >> 3;
      if (at + 4 > d.length) throw broken();
      const len = (d[at] as number) | ((d[at + 1] as number) << 8);
      const nlen = (d[at + 2] as number) | ((d[at + 3] as number) << 8);
      if (len !== (~nlen & 0xffff) || at + 4 + len > d.length) throw broken();
      room(len);
      out.set(d.subarray(at + 4, at + 4 + len), n);
      n += len;
      pos = (at + 4 + len) * 8;
      continue;
    }
    let lit = FIXED_LIT;
    let dist = FIXED_DIST;
    if (type === 2) {
      const nlit = take(5) + 257;
      const ndist = take(5) + 1;
      const ncode = take(4) + 4;
      const codeLengths = new Uint8Array(19);
      for (let i = 0; i < ncode; i++) codeLengths[LENGTHS_ORDER[i] as number] = take(3);
      const lc = huffman(codeLengths);
      const lengths = new Uint8Array(nlit + ndist);
      for (let i = 0; i < nlit + ndist; ) {
        const s = symbol(lc);
        if (s < 16) lengths[i++] = s;
        else {
          const [repeat, value] =
            s === 16
              ? [3 + take(2), i ? (lengths[i - 1] as number) : -1]
              : s === 17
                ? [3 + take(3), 0]
                : [11 + take(7), 0];
          if (value < 0 || i + repeat > nlit + ndist) throw broken();
          lengths.fill(value, i, i + repeat);
          i += repeat;
        }
      }
      if (!lengths[256]) throw broken();
      lit = huffman(lengths.subarray(0, nlit));
      dist = huffman(lengths.subarray(nlit));
    } else if (type !== 1) throw broken();
    for (;;) {
      const s = symbol(lit);
      if (s < 256) {
        room(1);
        out[n++] = s;
        continue;
      }
      if (s === 256) break;
      const li = s - 257;
      if (li >= 29) throw broken();
      const len = (LEN_BASE[li] as number) + take(LEN_EXTRA[li] as number);
      if (!dist.bits) throw broken();
      const di = symbol(dist);
      if (di >= 30) throw broken();
      const back = (DIST_BASE[di] as number) + take(DIST_EXTRA[di] as number);
      if (back > n) throw broken();
      room(len);
      for (let k = 0; k < len; k++, n++) out[n] = out[n - back] as number;
    }
  }
  return out.slice(0, n);
}
