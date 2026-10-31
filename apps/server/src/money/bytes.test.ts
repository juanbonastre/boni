import { createHash } from "node:crypto";
import { constants, deflateRawSync, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  concat,
  cp1252,
  f64,
  fromBase64,
  i32,
  inflateRaw,
  latin1,
  sha1Hex,
  u16,
  u32,
  utf8,
  utf8Bytes,
  utf16le,
} from "./bytes.ts";

/**
 * The bytes the reconciliation reads in the box, without Node, checked against Node itself: the same numbers, the
 * same text from the same bytes (broken ones too), the same hashes, the same uncompressed data, on fixed cases and on
 * many random ones (a fixed seed: the same every run).
 */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = random(20261031);
const int = (n: number) => Math.floor(rnd() * n);
/** Bytes mostly above 0x7f, where encodings differ, with now and then a well-formed UTF-8 character. */
function bytes(n: number): Uint8Array {
  const out: number[] = [];
  while (out.length < n) {
    const r = rnd();
    if (r < 0.3) out.push(int(0x80));
    else if (r < 0.7) out.push(0x80 + int(0x80));
    else out.push(...Buffer.from(String.fromCodePoint(int(0x110000)), "utf8"));
  }
  return Uint8Array.from(out.slice(0, n));
}

describe("bytes without Node", () => {
  it("reads numbers as Buffer does, and throws past the end", () => {
    const b = Buffer.from(bytes(64));
    for (let at = 0; at + 8 <= b.length; at++) {
      expect(u16(b, at)).toBe(b.readUInt16LE(at));
      expect(u32(b, at)).toBe(b.readUInt32LE(at));
      expect(i32(b, at)).toBe(b.readInt32LE(at));
      expect(Object.is(f64(b, at), b.readDoubleLE(at))).toBe(true);
    }
    expect(() => u32(b, 61)).toThrow(RangeError);
    expect(() => u16(b, -1)).toThrow(RangeError);
    expect(concat([Uint8Array.of(1), Uint8Array.of(), Uint8Array.of(2, 3)])).toEqual(
      Uint8Array.of(1, 2, 3),
    );
  });

  it("decodes text as Buffer and TextDecoder do, broken bytes and BOMs included", () => {
    const strict = new TextDecoder("utf-8", { fatal: true });
    const w1252 = new TextDecoder("windows-1252");
    const all = Uint8Array.from({ length: 256 }, (_x, i) => i);
    expect(cp1252(all)).toBe(w1252.decode(all));
    expect(latin1(all)).toBe(Buffer.from(all).toString("latin1"));
    const cases = [
      Uint8Array.of(0xef, 0xbb, 0xbf, 0x41),
      Uint8Array.of(0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x41),
      Uint8Array.of(0xe0, 0x80, 0x80),
      Uint8Array.of(0xed, 0xa0, 0x80),
      Uint8Array.of(0xf4, 0x90, 0x80, 0x80),
      Uint8Array.of(0xf0, 0x9f, 0x98),
      Uint8Array.of(0xc3),
      Buffer.from("año, café, 12,50 €", "utf8"),
      ...Array.from({ length: 3000 }, () => bytes(1 + int(40))),
    ];
    for (const b of cases) {
      expect(utf8(b)).toBe(Buffer.from(b).toString("utf8"));
      let want: string | null = null;
      try {
        want = strict.decode(b);
      } catch {
        want = null;
      }
      let got: string | null = null;
      try {
        got = utf8(b, { fatal: true });
      } catch {
        got = null;
      }
      expect(got).toBe(want);
      expect(cp1252(b)).toBe(w1252.decode(b));
      expect(utf16le(b)).toBe(Buffer.from(b).toString("utf16le"));
    }
  });

  it("writes UTF-8 and hashes it as Node does", () => {
    const texts = [
      "",
      "abc",
      "2026-09-05|21:43:09|la tasca ejemplo|-60.00|EUR",
      "café ñ € 😀",
      "\ud800 lone",
      "lone \udc00",
      "x".repeat(55),
      "x".repeat(56),
      "x".repeat(64),
      ...Array.from({ length: 300 }, () =>
        String.fromCharCode(...Array.from({ length: int(150) }, () => int(0x10000))),
      ),
    ];
    for (const s of texts) {
      expect(utf8Bytes(s)).toEqual(Uint8Array.from(Buffer.from(s, "utf8")));
      expect(sha1Hex(s)).toBe(createHash("sha1").update(s, "utf8").digest("hex"));
    }
  });

  it("reads base64 as Buffer does", () => {
    for (let n = 0; n < 70; n++) {
      const b = Buffer.from(bytes(n));
      expect(fromBase64(b.toString("base64"))).toEqual(Uint8Array.from(b));
    }
    expect(() => fromBase64("a*b")).toThrow();
  });

  it("uncompresses what zlib compresses, every way it compresses, and refuses what is cut", () => {
    const text = Buffer.from(
      Array.from(
        { length: 4000 },
        (_x, i) => `<row r="${i}"><c r="A${i}" t="s"><v>${i % 97}</v></c></row>`,
      ).join(""),
    );
    const inputs = [
      Buffer.alloc(0),
      Buffer.from("a"),
      text,
      Buffer.from(bytes(70_000)),
      Buffer.alloc(300_000, 7),
    ];
    const ways = [
      {},
      { level: 0 },
      { level: 1 },
      { level: 9 },
      { strategy: constants.Z_FIXED },
      { strategy: constants.Z_HUFFMAN_ONLY },
      { strategy: constants.Z_RLE },
      { level: 9, memLevel: 1, windowBits: 9 },
    ];
    for (const input of inputs)
      for (const way of ways) {
        const packed = deflateRawSync(input, way);
        expect(Buffer.from(inflateRaw(packed)).equals(inflateRawSync(packed))).toBe(true);
      }
    const packed = deflateRawSync(text);
    expect(() => inflateRaw(packed.subarray(0, packed.length >> 1))).toThrow();
  });
});
