/* Boni's reconciliation for the box (docs/extensiones.md, E4), built by `make conciliacion` from apps/server/src/money/preset.ts: not edited by hand. */
"use strict";
var conciliacion = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // preset.ts
  var preset_exports = {};
  __export(preset_exports, {
    DEBT: () => DEBT,
    MOVEMENT: () => MOVEMENT,
    cerrar_mes: () => cerrar_mes,
    importar: () => importar,
    keyOf: () => keyOf,
    plain: () => plain,
    reportOf: () => reportOf
  });

  // bytes.ts
  var cut = () => new RangeError("el archivo se acaba antes de tiempo");
  function u16(b, at) {
    if (!(at >= 0 && at + 2 <= b.length)) throw cut();
    return b[at] | b[at + 1] << 8;
  }
  function u32(b, at) {
    if (!(at >= 0 && at + 4 <= b.length)) throw cut();
    return (b[at] | b[at + 1] << 8 | b[at + 2] << 16) + b[at + 3] * 16777216;
  }
  var i32 = (b, at) => u32(b, at) | 0;
  function f64(b, at) {
    if (!(at >= 0 && at + 8 <= b.length)) throw cut();
    return new DataView(b.buffer, b.byteOffset + at, 8).getFloat64(0, true);
  }
  function concat(parts) {
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
  var startsWith = (b, head) => b.length >= head.length && head.every((x, i) => b[i] === x);
  function text(units, n) {
    const parts = [];
    for (let i = 0; i < n; i += 4096)
      parts.push(String.fromCharCode(...units.subarray(i, Math.min(n, i + 4096))));
    return parts.join("");
  }
  var latin1 = (b) => text(Uint16Array.from(b), b.length);
  function utf16le(b) {
    const n = b.length >> 1;
    const units = new Uint16Array(n);
    for (let i = 0; i < n; i++) units[i] = b[2 * i] | b[2 * i + 1] << 8;
    return text(units, n);
  }
  var CP1252 = [
    8364,
    129,
    8218,
    402,
    8222,
    8230,
    8224,
    8225,
    710,
    8240,
    352,
    8249,
    338,
    141,
    381,
    143,
    144,
    8216,
    8217,
    8220,
    8221,
    8226,
    8211,
    8212,
    732,
    8482,
    353,
    8250,
    339,
    157,
    382,
    376
  ];
  function cp1252(b) {
    const units = Uint16Array.from(
      b,
      (x) => x >= 128 && x < 160 ? CP1252[x - 128] : x
    );
    return text(units, units.length);
  }
  function utf8(b, o = {}) {
    const units = new Uint16Array(b.length);
    let n = 0;
    let i = o.fatal && b[0] === 239 && b[1] === 187 && b[2] === 191 ? 3 : 0;
    const bad = () => {
      if (o.fatal) throw new TypeError("el texto no es UTF-8");
      units[n++] = 65533;
    };
    while (i < b.length) {
      const c = b[i];
      if (c < 128) {
        units[n++] = c;
        i++;
        continue;
      }
      let need = 0;
      let cp = 0;
      let lower = 128;
      let upper = 191;
      if (c >= 194 && c <= 223) {
        need = 1;
        cp = c & 31;
      } else if (c >= 224 && c <= 239) {
        need = 2;
        cp = c & 15;
        if (c === 224) lower = 160;
        if (c === 237) upper = 159;
      } else if (c >= 240 && c <= 244) {
        need = 3;
        cp = c & 7;
        if (c === 240) lower = 144;
        if (c === 244) upper = 143;
      } else {
        bad();
        i++;
        continue;
      }
      let j = i + 1;
      let whole = true;
      for (let k = 0; k < need; k++, j++) {
        const x = b[j];
        if (x === void 0 || x < lower || x > upper) {
          whole = false;
          break;
        }
        lower = 128;
        upper = 191;
        cp = cp << 6 | x & 63;
      }
      if (!whole) bad();
      else if (cp >= 65536) {
        cp -= 65536;
        units[n++] = 55296 + (cp >> 10);
        units[n++] = 56320 + (cp & 1023);
      } else units[n++] = cp;
      i = j;
    }
    return text(units, n);
  }
  function utf8Bytes(s) {
    const out = [];
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c >= 55296 && c <= 56319) {
        const d = s.charCodeAt(i + 1);
        if (d >= 56320 && d <= 57343) {
          c = 65536 + (c - 55296 << 10) + (d - 56320);
          i++;
        } else c = 65533;
      } else if (c >= 56320 && c <= 57343) c = 65533;
      if (c < 128) out.push(c);
      else if (c < 2048) out.push(192 | c >> 6, 128 | c & 63);
      else if (c < 65536) out.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
      else
        out.push(
          240 | c >> 18,
          128 | c >> 12 & 63,
          128 | c >> 6 & 63,
          128 | c & 63
        );
    }
    return Uint8Array.from(out);
  }
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var B64_VALUE = new Map([...B64].map((ch, i) => [ch.charCodeAt(0), i]));
  function fromBase64(s) {
    const clean = s.replace(/[\s=]+/g, "");
    if (/[^A-Za-z0-9+/]/.test(clean) || clean.length % 4 === 1) throw new Error("no es base64");
    const out = new Uint8Array(clean.length * 3 >> 2);
    let acc = 0;
    let bits = 0;
    let n = 0;
    for (let i = 0; i < clean.length; i++) {
      acc = (acc << 6 | B64_VALUE.get(clean.charCodeAt(i))) & 16777215;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[n++] = acc >> bits & 255;
      }
    }
    return out;
  }
  function sha1Hex(s) {
    const m = utf8Bytes(s);
    const blocks = (m.length + 8 >> 6) + 1;
    const w = new Uint32Array(blocks * 16);
    for (let i = 0; i < m.length; i++)
      w[i >> 2] = w[i >> 2] | m[i] << 24 - (i & 3) * 8;
    w[m.length >> 2] = w[m.length >> 2] | 128 << 24 - (m.length & 3) * 8;
    w[blocks * 16 - 2] = Math.floor(m.length * 8 / 4294967296);
    w[blocks * 16 - 1] = m.length * 8 >>> 0;
    const h = [1732584193, 4023233417, 2562383102, 271733878, 3285377520];
    const x = new Int32Array(80);
    for (let at = 0; at < w.length; at += 16) {
      for (let t = 0; t < 16; t++) x[t] = w[at + t];
      for (let t = 16; t < 80; t++) {
        const v = x[t - 3] ^ x[t - 8] ^ x[t - 14] ^ x[t - 16];
        x[t] = v << 1 | v >>> 31;
      }
      let [a, b, c, d, e] = h;
      for (let t = 0; t < 80; t++) {
        const f = t < 20 ? b & c | ~b & d : t < 40 ? b ^ c ^ d : t < 60 ? b & c | b & d | c & d : b ^ c ^ d;
        const k = t < 20 ? 1518500249 : t < 40 ? 1859775393 : t < 60 ? 2400959708 : 3395469782;
        const next = (a << 5 | a >>> 27) + f + e + k + x[t] | 0;
        e = d;
        d = c;
        c = b << 30 | b >>> 2;
        b = a;
        a = next;
      }
      h[0] = h[0] + a | 0;
      h[1] = h[1] + b | 0;
      h[2] = h[2] + c | 0;
      h[3] = h[3] + d | 0;
      h[4] = h[4] + e | 0;
    }
    return h.map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
  }
  var LEN_BASE = [
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    11,
    13,
    15,
    17,
    19,
    23,
    27,
    31,
    35,
    43,
    51,
    59,
    67,
    83,
    99,
    115,
    131,
    163,
    195,
    227,
    258
  ];
  var LEN_EXTRA = [
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    1,
    1,
    1,
    2,
    2,
    2,
    2,
    3,
    3,
    3,
    3,
    4,
    4,
    4,
    4,
    5,
    5,
    5,
    5,
    0
  ];
  var DIST_BASE = [
    1,
    2,
    3,
    4,
    5,
    7,
    9,
    13,
    17,
    25,
    33,
    49,
    65,
    97,
    129,
    193,
    257,
    385,
    513,
    769,
    1025,
    1537,
    2049,
    3073,
    4097,
    6145,
    8193,
    12289,
    16385,
    24577
  ];
  var DIST_EXTRA = [
    0,
    0,
    0,
    0,
    1,
    1,
    2,
    2,
    3,
    3,
    4,
    4,
    5,
    5,
    6,
    6,
    7,
    7,
    8,
    8,
    9,
    9,
    10,
    10,
    11,
    11,
    12,
    12,
    13,
    13
  ];
  var LENGTHS_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  var broken = () => new Error("los datos comprimidos están dañados");
  function huffman(lengths) {
    let max = 0;
    for (let i = 0; i < lengths.length; i++) max = Math.max(max, lengths[i]);
    if (!max) return { table: new Uint16Array(1), bits: 0 };
    const count2 = new Uint16Array(max + 1);
    for (let i = 0; i < lengths.length; i++) {
      const len = lengths[i];
      if (len) count2[len] = count2[len] + 1;
    }
    const next = new Uint16Array(max + 1);
    for (let len = 1, code = 0; len <= max; len++) {
      code = code + count2[len - 1] << 1;
      next[len] = code;
    }
    const table = new Uint16Array(1 << max);
    for (let sym = 0; sym < lengths.length; sym++) {
      const len = lengths[sym];
      if (!len) continue;
      const code = next[len];
      next[len] = code + 1;
      let rev = 0;
      for (let k = 0; k < len; k++) rev |= (code >> k & 1) << len - 1 - k;
      for (let at = rev; at < table.length; at += 1 << len) table[at] = sym << 4 | len;
    }
    return { table, bits: max };
  }
  var FIXED_LIT = huffman(
    Array.from({ length: 288 }, (_x, i) => i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8)
  );
  var FIXED_DIST = huffman(Array.from({ length: 30 }, () => 5));
  function inflateRaw(d) {
    const end = d.length * 8;
    let pos = 0;
    let out = new Uint8Array(Math.max(1024, d.length * 4));
    let n = 0;
    const room = (k) => {
      if (n + k <= out.length) return;
      const bigger = new Uint8Array(Math.max(out.length * 2, n + k));
      bigger.set(out.subarray(0, n));
      out = bigger;
    };
    const peek = (p) => {
      const o = p >> 3;
      return ((d[o] ?? 0) | (d[o + 1] ?? 0) << 8 | (d[o + 2] ?? 0) << 16) >> (p & 7) >>> 0;
    };
    const take = (k) => {
      if (!k) return 0;
      const v = peek(pos) & (1 << k) - 1;
      pos += k;
      if (pos > end) throw broken();
      return v;
    };
    const symbol = (h) => {
      const c = h.table[peek(pos) & (1 << h.bits) - 1];
      if (!(c & 15)) throw broken();
      pos += c & 15;
      if (pos > end) throw broken();
      return c >> 4;
    };
    for (let last = 0; !last; ) {
      last = take(1);
      const type = take(2);
      if (type === 0) {
        pos = pos + 7 & ~7;
        const at = pos >> 3;
        if (at + 4 > d.length) throw broken();
        const len = d[at] | d[at + 1] << 8;
        const nlen = d[at + 2] | d[at + 3] << 8;
        if (len !== (~nlen & 65535) || at + 4 + len > d.length) throw broken();
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
        for (let i = 0; i < ncode; i++) codeLengths[LENGTHS_ORDER[i]] = take(3);
        const lc = huffman(codeLengths);
        const lengths = new Uint8Array(nlit + ndist);
        for (let i = 0; i < nlit + ndist; ) {
          const s = symbol(lc);
          if (s < 16) lengths[i++] = s;
          else {
            const [repeat, value] = s === 16 ? [3 + take(2), i ? lengths[i - 1] : -1] : s === 17 ? [3 + take(3), 0] : [11 + take(7), 0];
            if (value < 0 || i + repeat > nlit + ndist) throw broken();
            lengths.fill(value, i, i + repeat);
            i += repeat;
          }
        }
        if (!lengths[256]) throw broken();
        lit = huffman(lengths.subarray(0, nlit));
        dist = huffman(lengths.subarray(nlit));
      } else if (type !== 1) throw broken();
      for (; ; ) {
        const s = symbol(lit);
        if (s < 256) {
          room(1);
          out[n++] = s;
          continue;
        }
        if (s === 256) break;
        const li = s - 257;
        if (li >= 29) throw broken();
        const len = LEN_BASE[li] + take(LEN_EXTRA[li]);
        if (!dist.bits) throw broken();
        const di = symbol(dist);
        if (di >= 30) throw broken();
        const back = DIST_BASE[di] + take(DIST_EXTRA[di]);
        if (back > n) throw broken();
        room(len);
        for (let k = 0; k < len; k++, n++) out[n] = out[n - back];
      }
    }
    return out.slice(0, n);
  }

  // sheets.ts
  function parseNum(v) {
    if (typeof v === "number") return v;
    let s = String(v ?? "").replace(/[^0-9,.\-+]/g, "");
    if (!s || s === "+" || s === "-") return 0;
    if (s.includes(",") && s.includes(".")) {
      s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    } else if (s.includes(",")) s = s.replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  var pad = (n) => String(n).padStart(2, "0");
  var DATES = [
    { re: /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/, ymd: [1, 2, 3], time: true },
    { re: /^(\d{4})-(\d{2})-(\d{2})$/, ymd: [1, 2, 3], time: false },
    { re: /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/, ymd: [3, 2, 1], time: true },
    { re: /^(\d{2})\/(\d{2})\/(\d{4})$/, ymd: [3, 2, 1], time: false },
    { re: /^(\d{2})-(\d{2})-(\d{4})$/, ymd: [3, 2, 1], time: false },
    { re: /^(\d{2})\/(\d{2})\/(\d{2})$/, ymd: [3, 2, 1], time: false, short: true },
    { re: /^(\d{2})\.(\d{2})\.(\d{4})$/, ymd: [3, 2, 1], time: false }
  ];
  function parseDt(v) {
    if (typeof v === "number") {
      const ms = Math.round((v - 25569) * 86400) * 1e3;
      const d = new Date(ms);
      const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
      const has = d.getUTCHours() || d.getUTCMinutes() || d.getUTCSeconds();
      const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
      return [day, has ? hm : "", has ? `${hm}:${pad(d.getUTCSeconds())}` : ""];
    }
    const s = String(v ?? "").trim().replace(/\.\d+$/, "");
    for (const f of DATES) {
      const m = f.re.exec(s);
      if (!m) continue;
      let y = Number(m[f.ymd[0]]);
      if (f.short) y += y < 69 ? 2e3 : 1900;
      const mo = Number(m[f.ymd[1]]);
      const d = Number(m[f.ymd[2]]);
      const date = new Date(Date.UTC(y, mo - 1, d));
      if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) continue;
      const day = `${y}-${pad(mo)}-${pad(d)}`;
      if (!f.time) return [day, "", ""];
      const hm = `${m[4]}:${m[5]}`;
      return [day, hm, `${hm}:${m[6] ?? "00"}`];
    }
    throw new Error(`fecha no reconocida: '${s}'`);
  }
  function decodeText(raw) {
    try {
      const t = utf8(raw, { fatal: true });
      return t.charCodeAt(0) === 65279 ? t.slice(1) : t;
    } catch {
      return cp1252(raw);
    }
  }
  function readCsvRows(raw) {
    const text2 = decodeText(raw);
    const sample = text2.split(/\r?\n/).slice(0, 20).join("\n");
    const count2 = (d) => sample.split(d).length - 1;
    const delim = [",", ";", "	"].reduce((a, b) => count2(b) > count2(a) ? b : a);
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < text2.length; i++) {
      const ch = text2[i];
      if (quoted) {
        if (ch === '"') {
          if (text2[i + 1] === '"') {
            cell += '"';
            i++;
          } else quoted = false;
        } else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delim) {
        row.push(cell);
        cell = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text2[i + 1] === "\n") i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else cell += ch;
    }
    if (cell !== "" || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.map((r) => r.length === 1 && r[0] === "" ? [] : r);
  }
  function unzip(buf) {
    const out = /* @__PURE__ */ new Map();
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
      if (u32(buf, i) === 101010256) {
        eocd = i;
        break;
      }
    if (eocd < 0) throw new Error("xlsx sin directorio");
    const n = u16(buf, eocd + 10);
    let p = u32(buf, eocd + 16);
    for (let k = 0; k < n; k++) {
      if (u32(buf, p) !== 33639248) throw new Error("xlsx dañado");
      const method = u16(buf, p + 10);
      const size = u32(buf, p + 20);
      const nameLen = u16(buf, p + 28);
      const extra = u16(buf, p + 30);
      const comment = u16(buf, p + 32);
      const local = u32(buf, p + 42);
      const name = utf8(buf.subarray(p + 46, p + 46 + nameLen));
      const lh = local + 30 + u16(buf, local + 26) + u16(buf, local + 28);
      const data = buf.subarray(lh, lh + size);
      out.set(name, method === 8 ? inflateRaw(data) : data);
      p += 46 + nameLen + extra + comment;
    }
    return out;
  }
  var xmlText = (s) => s.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(Number.parseInt(h, 16))).replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, "&");
  var attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
  function colIndex(ref) {
    const m = /^[A-Z]+/.exec(ref ?? "");
    if (!m) return null;
    let n = 0;
    for (const ch of m[0]) n = n * 26 + ch.charCodeAt(0) - 64;
    return n - 1;
  }
  function readXlsxRows(raw) {
    const files = unzip(raw);
    const shared = [];
    const sstBytes = files.get("xl/sharedStrings.xml");
    const sst = sstBytes ? utf8(sstBytes) : "";
    if (sst)
      for (const si of sst.match(/<si>[\s\S]*?<\/si>/g) ?? [])
        shared.push((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) ?? []).map(xmlText).join(""));
    const sheets = [...files.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1]) - Number(/(\d+)\.xml$/.exec(b)?.[1]));
    if (!sheets.length) throw new Error("xlsx sin hojas");
    const sheet = files.get(sheets[0]);
    const xml = sheet ? utf8(sheet) : "";
    const rows = [];
    for (const r of xml.match(/<row[\s>][\s\S]*?<\/row>|<row[^>]*\/>/g) ?? []) {
      const cells = /* @__PURE__ */ new Map();
      let next = 0;
      for (const c of r.match(/<c[\s>][\s\S]*?<\/c>|<c[^>]*\/>/g) ?? []) {
        const open = /^<c[^>]*>/.exec(c)?.[0] ?? c;
        const col = colIndex(attr(open, "r")) ?? next;
        next = col + 1;
        const t = attr(open, "t");
        const v = /<v>([\s\S]*?)<\/v>/.exec(c)?.[1];
        let val;
        if (t === "s") val = v !== void 0 ? shared[Number(v)] ?? "" : "";
        else if (t === "inlineStr")
          val = (c.match(/<t[^>]*>[\s\S]*?<\/t>/g) ?? []).map(xmlText).join("");
        else if (v === void 0) val = "";
        else if (t === "str" || t === "e" || t === "b") val = xmlText(v);
        else val = Number(v);
        cells.set(col, val);
      }
      const width = cells.size ? Math.max(...cells.keys()) + 1 : 0;
      rows.push(Array.from({ length: width }, (_x, i) => cells.get(i) ?? ""));
    }
    return rows;
  }
  var OLE = Uint8Array.of(208, 207, 17, 224, 161, 177, 26, 225);
  var END = 4294967290;
  function oleStream(data, names = ["Workbook", "Book"]) {
    if (!startsWith(data, OLE)) throw new Error("no es un archivo OLE2");
    const ssz = 1 << u16(data, 30);
    const msz = 1 << u16(data, 32);
    const nFat = u32(data, 44);
    const firstDir = u32(data, 48);
    const cutoff = u32(data, 56);
    const firstMfat = u32(data, 60);
    const nMfat = u32(data, 64);
    const firstDifat = u32(data, 68);
    const nDifat = u32(data, 72);
    const sector = (n) => data.subarray((n + 1) * ssz, (n + 2) * ssz);
    const u32s = (b) => Array.from({ length: b.length >> 2 }, (_x, i) => u32(b, i * 4));
    const difat = u32s(data.subarray(76, 76 + 109 * 4));
    let s = firstDifat;
    const per = ssz / 4 - 1;
    for (let k = 0; k < nDifat && s < END; k++) {
      const vals = u32s(sector(s));
      difat.push(...vals.slice(0, per));
      s = vals[per] ?? END;
    }
    const fat = [];
    for (const x of difat.slice(0, nFat)) fat.push(...u32s(sector(x)));
    const chain = (start, table) => {
      const out = [];
      let c = start;
      for (let guard = 0; c < END && guard <= table.length; guard++) {
        out.push(c);
        c = c < table.length ? table[c] : 4294967294;
      }
      return out;
    };
    const dirs = concat(chain(firstDir, fat).map(sector));
    const entries = [];
    for (let off = 0; off + 128 <= dirs.length; off += 128) {
      const nlen = u16(dirs, off + 64);
      entries.push({
        name: utf16le(dirs.subarray(off, off + Math.max(nlen - 2, 0))),
        type: dirs[off + 66],
        start: u32(dirs, off + 116),
        size: u32(dirs, off + 120)
      });
    }
    const root = entries.find((e) => e.type === 5);
    for (const e of entries) {
      if (e.type !== 2 || !names.includes(e.name)) continue;
      if (e.size >= cutoff) return concat(chain(e.start, fat).map(sector)).subarray(0, e.size);
      const mfat = [];
      for (const x of chain(firstMfat, fat).slice(0, nMfat)) mfat.push(...u32s(sector(x)));
      const mini = concat(chain(root?.start ?? END, fat).map(sector));
      return concat(chain(e.start, mfat).map((m) => mini.subarray(m * msz, (m + 1) * msz))).subarray(
        0,
        e.size
      );
    }
    throw new Error("el .xls no tiene hoja de calculo (stream Workbook)");
  }
  var Pieces = class {
    c;
    i = 0;
    p = 0;
    constructor(chunks) {
      this.c = chunks.filter((x) => x.length);
    }
    next() {
      while (this.i < this.c.length && this.p >= this.c[this.i].length) {
        this.i++;
        this.p = 0;
      }
      if (this.i >= this.c.length) throw new Error("SST truncada");
    }
    read(n) {
      const out = [];
      while (n) {
        this.next();
        const cur = this.c[this.i];
        const take = Math.min(n, cur.length - this.p);
        out.push(cur.subarray(this.p, this.p + take));
        this.p += take;
        n -= take;
      }
      return concat(out);
    }
    chars(cch, high) {
      let out = "";
      while (cch) {
        if (this.p >= this.c[this.i].length) {
          this.i++;
          if (this.i >= this.c.length) throw new Error("SST truncada");
          high = this.c[this.i][0] & 1;
          this.p = 1;
        }
        const cur = this.c[this.i];
        const per = high ? 2 : 1;
        const take = Math.min(cch, Math.floor((cur.length - this.p) / per));
        const raw = cur.subarray(this.p, this.p + take * per);
        out += high ? utf16le(raw) : latin1(raw);
        this.p += take * per;
        cch -= take;
      }
      return out;
    }
    xlstring(cchSize = 2) {
      const b = this.read(cchSize);
      const cch = cchSize === 2 ? u16(b, 0) : b[0];
      const flags = this.read(1)[0];
      const runs = flags & 8 ? u16(this.read(2), 0) : 0;
      const ext = flags & 4 ? u32(this.read(4), 0) : 0;
      const s = this.chars(cch, flags & 1);
      if (4 * runs + ext) this.read(4 * runs + ext);
      return s;
    }
  };
  function rk(raw) {
    const u = u32(raw, 0);
    let x;
    if (u & 2) x = i32(raw, 0) >> 2;
    else {
      const b = new Uint8Array(8);
      new DataView(b.buffer).setUint32(4, (u & 4294967292) >>> 0, true);
      x = f64(b, 0);
    }
    return u & 1 ? x / 100 : x;
  }
  function readXlsRows(raw) {
    const wb = oleStream(raw);
    const recs = [];
    for (let pos = 0; pos + 4 <= wb.length; ) {
      const type = u16(wb, pos);
      const len = u16(wb, pos + 2);
      recs.push([type, wb.subarray(pos + 4, pos + 4 + len)]);
      pos += 4 + len;
    }
    const sst = [];
    const cells = /* @__PURE__ */ new Map();
    let sheet = -1;
    let pending = null;
    const at = (r, c) => `${r},${c}`;
    for (let k = 0; k < recs.length; k++) {
      const [type, d] = recs[k];
      if (type === 2057) {
        sheet++;
        continue;
      }
      if (type === 252) {
        const chunks = [d.subarray(8)];
        for (let j = k + 1; j < recs.length && recs[j][0] === 60; j++)
          chunks.push(recs[j][1]);
        const pieces = new Pieces(chunks);
        const n = u32(d, 4);
        for (let i = 0; i < n; i++) sst.push(pieces.xlstring());
        continue;
      }
      if (sheet !== 1) {
        if (sheet > 1) break;
        continue;
      }
      if (type === 253) {
        const idx = u32(d, 6);
        cells.set(at(u16(d, 0), u16(d, 2)), sst[idx] ?? "");
      } else if (type === 515) {
        cells.set(at(u16(d, 0), u16(d, 2)), f64(d, 6));
      } else if (type === 638) {
        cells.set(at(u16(d, 0), u16(d, 2)), rk(d.subarray(6, 10)));
      } else if (type === 189) {
        const r = u16(d, 0);
        const c0 = u16(d, 2);
        for (let n = 0; n < Math.floor((d.length - 6) / 6); n++)
          cells.set(at(r, c0 + n), rk(d.subarray(4 + n * 6 + 2, 4 + n * 6 + 6)));
      } else if (type === 516 || type === 214) {
        cells.set(at(u16(d, 0), u16(d, 2)), new Pieces([d.subarray(6)]).xlstring());
      } else if (type === 6) {
        const key = at(u16(d, 0), u16(d, 2));
        const res = d.subarray(6, 14);
        if (res[6] === 255 && res[7] === 255) {
          pending = res[0] === 0 ? key : null;
          if (res[0] !== 0) cells.set(key, "");
        } else cells.set(key, f64(res, 0));
      } else if (type === 519 && pending) {
        cells.set(pending, new Pieces([d]).xlstring());
        pending = null;
      }
    }
    if (!cells.size) return [];
    let maxR = 0;
    let maxC = 0;
    for (const k of cells.keys()) {
      const [r, c] = k.split(",").map(Number);
      maxR = Math.max(maxR, r);
      maxC = Math.max(maxC, c);
    }
    const rows = [];
    for (let r = 0; r <= maxR; r++) {
      const any = Array.from({ length: maxC + 1 }, (_x, c) => cells.has(at(r, c))).some(Boolean);
      rows.push(any ? Array.from({ length: maxC + 1 }, (_x, c) => cells.get(at(r, c)) ?? "") : []);
    }
    return rows;
  }
  function readRows(raw, name) {
    if (raw[0] === 80 && raw[1] === 75) return readXlsxRows(raw);
    if (startsWith(raw, OLE)) return readXlsRows(raw);
    if (name.toLowerCase().endsWith(".csv")) return readCsvRows(raw);
    const ext = /\.[^.]*$/.exec(name)?.[0] ?? "";
    throw new Error(`formato no soportado (${ext}): guardalo como .xlsx o .csv`);
  }

  // statements.ts
  var asciiLow = (s) => String(s ?? "").normalize("NFKD").replace(/[^\p{ASCII}]/gu, "").toLowerCase();
  var fixed2 = (x) => x.toFixed(2);
  function headerMap(row, aliases) {
    const norm = row.map(
      (h) => asciiLow(h).replace(/[^a-z0-9. ]/g, "").trim()
    );
    const out = /* @__PURE__ */ new Map();
    for (const [field, names] of Object.entries(aliases))
      norm.forEach((h, i) => {
        if (out.has(field)) return;
        if (names.some((n) => h === n || n.endsWith("*") && h.startsWith(n.slice(0, -1))))
          out.set(field, i);
      });
    return out;
  }
  function makeRef(prefix, parts, seen) {
    let key = parts.join("|");
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1) key += `#${n}`;
    return prefix + sha1Hex(key).slice(0, 12);
  }
  var REVOLUT = {
    type: ["type", "tipo"],
    product: ["product", "producto"],
    started: ["started date", "fecha de inicio"],
    completed: ["completed date", "fecha de finalizacion", "fecha de fin"],
    description: ["description", "descripcion"],
    amount: ["amount", "importe", "cantidad"],
    fee: ["fee", "comision", "tarifa"],
    currency: ["currency", "divisa", "moneda"],
    state: ["state", "estado"],
    balance: ["balance", "saldo"]
  };
  var REVOLUT_WAIT = /* @__PURE__ */ new Set(["pending", "pendiente"]);
  var REVOLUT_SKIP = new Set(
    "reverted declined failed cancelled canceled revertida revertido rechazada rechazado fallida fallido cancelada cancelado".split(
      " "
    )
  );
  var REVOLUT_SKIP_PRODUCTS = ["saving", "ahorro", "deposit", "deposito", "hucha", "vault"];
  var ING = {
    date: ["f. valor", "f.valor", "fecha valor", "fecha", "fecha operacion", "f. operacion"],
    description: ["descripcion", "concepto", "descripcion de la operacion"],
    amount: ["importe*"],
    balance: ["saldo*"],
    category: ["categoria"],
    subcategory: ["subcategoria"],
    comment: ["comentario"]
  };
  var inc = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
  var getter = (r, hdr) => (k) => {
    const i = hdr.get(k);
    return i !== void 0 && i < r.length ? r[i] : "";
  };
  var blank = (r) => !r.some((x) => String(x).trim());
  var euro = (x) => fixed2(Math.abs(x)).replace(".", ",");
  function parseRevolut(rows, hdr) {
    const lines = [];
    const skipped = /* @__PURE__ */ new Map();
    const products = /* @__PURE__ */ new Map();
    const seen = /* @__PURE__ */ new Map();
    for (const r of rows) {
      if (blank(r)) continue;
      const g = getter(r, hdr);
      const state = asciiLow(g("state")).trim();
      const product = String(g("product")).trim();
      inc(products, product || "?");
      if (REVOLUT_SKIP.has(state)) {
        inc(skipped, `estado ${state}`);
        continue;
      }
      if (REVOLUT_WAIT.has(state)) {
        inc(skipped, "sin completar (entrara en el proximo extracto)");
        continue;
      }
      if (REVOLUT_SKIP_PRODUCTS.some((w) => asciiLow(product).includes(w))) {
        inc(skipped, `producto ${product}`);
        continue;
      }
      const [date, hhmm, hhmmss] = parseDt(g("started") || g("completed"));
      const fee = Math.abs(parseNum(g("fee")));
      const amount = parseNum(g("amount")) - fee;
      const text2 = String(g("description")).split(/\s+/).filter(Boolean).join(" ");
      const currency = String(g("currency")).trim().toUpperCase() || "EUR";
      const ref = makeRef(
        "rev-",
        [date, hhmmss, asciiLow(text2), fixed2(parseNum(g("amount"))), currency],
        seen
      );
      lines.push({
        account: "revolut",
        date,
        time: hhmm,
        amount: Math.round(amount * 100) / 100,
        currency,
        text: text2,
        ref,
        body: fee > 0 ? [`Incluye comision de ${euro(fee)} ${currency}.`] : [],
        kind: String(g("type")).trim()
      });
    }
    return { lines, skipped, products };
  }
  function parseIng(rows, hdr) {
    const lines = [];
    const skipped = /* @__PURE__ */ new Map();
    const seen = /* @__PURE__ */ new Map();
    for (const r of rows) {
      const g = getter(r, hdr);
      if (blank(r) || String(g("amount")).trim() === "") continue;
      let date;
      try {
        [date] = parseDt(g("date"));
      } catch {
        inc(skipped, "fila sin fecha");
        continue;
      }
      const amount = parseNum(g("amount"));
      const text2 = String(g("description")).split(/\s+/).filter(Boolean).join(" ");
      const balance = String(g("balance")).trim() ? fixed2(parseNum(g("balance"))) : "";
      const ref = makeRef("ing-", [date, asciiLow(text2), fixed2(amount), balance], seen);
      const body = [];
      const cat = [String(g("category")).trim(), String(g("subcategory")).trim()].filter(Boolean).join(" > ");
      if (cat) body.push(`Categoria segun ING: ${cat}.`);
      if (String(g("comment")).trim()) body.push(`Comentario en ING: ${String(g("comment")).trim()}`);
      lines.push({
        account: "ing",
        date,
        time: "",
        amount: Math.round(amount * 100) / 100,
        currency: "EUR",
        text: text2,
        ref,
        body,
        kind: ""
      });
    }
    return { lines, skipped, products: /* @__PURE__ */ new Map() };
  }
  function parseStatement(rows) {
    for (const [i, row] of rows.slice(0, 30).entries()) {
      let hdr = headerMap(row, REVOLUT);
      if (hdr.has("started") && hdr.has("amount") && hdr.has("description"))
        return { bank: "revolut", ...parseRevolut(rows.slice(i + 1), hdr) };
      hdr = headerMap(row, ING);
      if (hdr.has("date") && hdr.has("amount") && hdr.has("description"))
        return { bank: "ing", ...parseIng(rows.slice(i + 1), hdr) };
    }
    const preview = rows.slice(0, 12).map(
      (row, i) => row.length ? `    fila ${i + 1}: ${row.map((x) => String(x).slice(0, 30)).join(" | ")}` : ""
    ).filter(Boolean);
    throw new Error(
      `no reconozco las columnas (ni Revolut ni ING). Primeras filas:
${preview.join("\n")}`
    );
  }

  // reconcile.ts
  var UNKNOWN = "otros/desconocido";
  var NOT_EXPENSE = ["ingreso/", "inversion", "transferencia/"];
  var MATCH_DAYS = 3;
  var fmt = (x) => x.toFixed(2);
  function logger() {
    const lines = [];
    return Object.assign((s) => void lines.push(s), { lines });
  }
  var euro2 = (x) => Math.abs(x).toFixed(2).replace(".", ",");
  var toFloat = (v) => {
    if (v === null || v === void 0 || v === "" || typeof v === "boolean") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  var asList = (v) => v === null || v === void 0 || v === "" ? [] : Array.isArray(v) ? v : [v];
  var ids = (v) => asList(v).map((x) => String(x).trim()).filter(Boolean);
  var rulePattern = (s) => asciiLow(s).trim();
  var sortRules = (rules) => [...rules].sort((a, b) => b[0].length - a[0].length);
  function matchRule(rules, text2) {
    const t = asciiLow(text2).split(/\s+/).filter(Boolean).join(" ");
    return rules.find((r) => r[0].startsWith("=") ? t === r[0].slice(1).trim() : t.includes(r[0])) ?? null;
  }
  function prettyMerchant(text2) {
    const t = (text2 ?? "").normalize("NFKD").replace(/[^\p{ASCII}]/gu, "").replace(/[*#]+/g, " ").replace(/\s+/g, " ").trim();
    return /[A-Z]/.test(t) && t === t.toUpperCase() ? t.toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_m, a, b) => a + b.toUpperCase()) : t;
  }
  function minutesApart(aDate, aTime, bDate, bTime) {
    const da = Date.parse(`${aDate}T00:00:00Z`);
    const db = Date.parse(`${bDate}T00:00:00Z`);
    if (Number.isNaN(da) || Number.isNaN(db)) throw new Error("bad date");
    let m = Math.abs(Math.round((da - db) / 864e5)) * 1440;
    if (aTime && bTime && da === db) {
      const [ah, am] = aTime.split(":").map(Number);
      const [bh, bm] = bTime.split(":").map(Number);
      m = Math.abs(ah * 60 + am - (bh * 60 + bm));
    }
    return m;
  }
  function joinCandidates(lines, notes) {
    const pairs = [];
    lines.forEach((ln, i) => {
      for (const n of notes) {
        const acc = String(n.fm.account ?? "");
        if (acc !== "" && acc !== ln.account) continue;
        const amt = toFloat(n.fm.amount);
        if (amt === null || Math.abs(amt - ln.amount) > 5e-3) continue;
        let gap;
        try {
          gap = minutesApart(ln.date, ln.time, String(n.fm.date ?? ""), String(n.fm.time ?? ""));
        } catch {
          continue;
        }
        if (gap <= MATCH_DAYS * 1440) pairs.push([gap, i, n.id]);
      }
    });
    pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0));
    const usedL = /* @__PURE__ */ new Set();
    const usedN = /* @__PURE__ */ new Set();
    const unclearNotes = /* @__PURE__ */ new Set();
    const joined = /* @__PURE__ */ new Map();
    const unclear = /* @__PURE__ */ new Map();
    for (const [gap, i, p] of pairs) {
      if (usedL.has(i) || usedN.has(p)) continue;
      const tie = pairs.filter(
        (q) => q[0] === gap && q[1] === i !== (q[2] === p) && !usedL.has(q[1]) && !usedN.has(q[2])
      );
      if (tie.length) {
        const groupLines = /* @__PURE__ */ new Set([i, ...tie.map((q) => q[1])]);
        const groupNotes = /* @__PURE__ */ new Set([p, ...tie.map((q) => q[2])]);
        for (const l of groupLines) {
          const cand = new Set(pairs.filter((q) => q[1] === l && !usedN.has(q[2])).map((q) => q[2]));
          if (l === i) for (const n of groupNotes) cand.add(n);
          unclear.set(l, [...cand].sort());
        }
        for (const l of groupLines) usedL.add(l);
        for (const n of groupNotes) {
          usedN.add(n);
          unclearNotes.add(n);
        }
        continue;
      }
      joined.set(i, p);
      usedL.add(i);
      usedN.add(p);
    }
    for (const [, i, p] of pairs)
      if (!joined.has(i) && unclearNotes.has(p)) {
        const list = unclear.get(i) ?? [];
        if (!list.includes(p)) list.push(p);
        unclear.set(i, list);
      }
    return { joined, unclear };
  }
  function newMovement(ln, rule, created) {
    const merchant = rule?.[1] || prettyMerchant(ln.text) || "Movimiento";
    const category = rule?.[2] || UNKNOWN;
    const values = {
      date: ln.date,
      time: ln.time || null,
      amount: Number(fmt(ln.amount)),
      currency: ln.currency,
      account: ln.account,
      category,
      merchant,
      status: "pendiente",
      source: ln.account,
      bank_ref: ln.ref,
      bank_text: ln.text,
      created
    };
    const movement = {
      title: `${merchant} ${euro2(ln.amount)} EUR`,
      values,
      body: ln.body.join("\n")
    };
    return { category, movement };
  }
  function planImport(book, files, o) {
    const out = logger();
    const all = book.movements();
    const known = new Set(
      all.map((n) => n.fm.bank_ref).filter(Boolean).map(String)
    );
    const openApp = all.filter(
      (n) => !n.fm.bank_ref && n.fm.status === "pendiente" && n.fm.account !== "efectivo"
    );
    if (!files.length) {
      out("No hay extractos");
      return {
        edits: [],
        creates: [],
        unclear: [],
        result: { created: [], joined: [], unclear: [], report: out.lines }
      };
    }
    const lines = [];
    for (const f of files) {
      try {
        const st = parseStatement(readRows(f.bytes, f.name));
        let msg = `${f.name}: ${st.bank}, ${st.lines.length} lineas`;
        const list = (m) => [...m.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([k, v]) => `${k} ${v}`).join(", ");
        if (st.skipped.size) msg += `; descartadas: ${list(st.skipped)}`;
        if (st.products.size) msg += `; productos: ${list(st.products)}`;
        out(msg);
        lines.push(...st.lines.map((l) => ({ ...l, file: f.name })));
      } catch (e) {
        out(`ERROR ${f.name}: ${e.message}`);
      }
    }
    const fresh = [];
    const seen = /* @__PURE__ */ new Set();
    let already = 0;
    for (const ln of lines) {
      if (known.has(ln.ref)) already++;
      else if (!seen.has(ln.ref)) {
        seen.add(ln.ref);
        fresh.push(ln);
      }
    }
    fresh.sort(
      (a, b) => a.date !== b.date ? a.date < b.date ? -1 : 1 : a.time !== b.time ? a.time < b.time ? -1 : 1 : a.ref < b.ref ? -1 : 1
    );
    const { joined, unclear } = joinCandidates(fresh, openApp);
    const byId = new Map(openApp.map((n) => [n.id, n]));
    const edits = /* @__PURE__ */ new Map();
    const creates = [];
    let byRule = 0;
    let unknown = 0;
    fresh.forEach((ln, i) => {
      const rule = matchRule(o.rules, ln.text);
      const p = joined.get(i);
      if (p !== void 0) {
        const note = byId.get(p);
        const props = { bank_ref: ln.ref, bank_text: ln.text };
        if (!note.fm.account) props.account = ln.account;
        if (!note.fm.merchant) props.merchant = rule?.[1] || prettyMerchant(ln.text);
        if (!note.fm.time && ln.time) props.time = ln.time;
        edits.set(p, { note, props, file: ln.file });
      } else if (!unclear.has(i)) {
        const { category, movement } = newMovement(ln, rule, o.today);
        creates.push({ movement, file: ln.file });
        if (category === UNKNOWN) unknown++;
        else byRule++;
      }
    });
    const named = (id) => byId.get(id)?.title || book.title(id) || id;
    out(`Lineas del banco: ${lines.length}; ya importadas: ${already}; nuevas: ${fresh.length}`);
    out(
      `Unidas a notas de la app: ${edits.size}; notas nuevas: ${creates.length} (categoria por regla ${byRule}, sin categoria ${unknown}); dudosas: ${unclear.size}`
    );
    for (const [i, p] of [...joined.entries()].sort((a, b) => a[0] - b[0])) {
      const ln = fresh[i];
      out(`  UNIDA   ${ln.date} ${fmt(ln.amount)} ${ln.text}  ->  ${named(p)}`);
    }
    for (const [i, cands] of [...unclear.entries()].sort((a, b) => a[0] - b[0])) {
      const ln = fresh[i];
      out(
        `  DUDOSA  ${ln.date} ${fmt(ln.amount)} ${ln.text} [${ln.ref}]  posibles notas: ${cands.map(named).join(", ")}`
      );
    }
    if (unclear.size)
      out(
        "  (las dudosas no se importan: en la nota correcta pon bank_ref y vuelve a importar, o pon 'separadas')"
      );
    const doubtful = [...unclear.entries()].sort((a, b) => a[0] - b[0]);
    return {
      edits: [...edits.entries()].map(([id, e]) => ({ id, props: e.props, file: e.file })),
      creates,
      unclear: doubtful.map(([i, candidates]) => ({ line: fresh[i], candidates })),
      result: {
        created: creates.map((c) => c.movement.title),
        joined: [...edits.keys()].map(named),
        unclear: doubtful.map(([i]) => fresh[i].ref),
        report: out.lines
      }
    };
  }
  var byName = (category) => category.startsWith("ingreso/") ? "ingreso" : NOT_EXPENSE.some((p) => category.startsWith(p)) ? "otro" : "gasto";
  function movementProblems(fm, id, cats, debtsByMovement, targets, kindOf = byName, nameOf = (x) => x) {
    const isSpending = (c) => kindOf(c) === "gasto";
    const probs = [];
    const cat = String(fm.category ?? "");
    const amount = toFloat(fm.amount) ?? 0;
    if (!cat || cat === UNKNOWN) probs.push("sin categoria");
    else if (cats.length && !cats.includes(cat))
      probs.push(`categoria '${cat}' no esta en las categorias`);
    if ((fm.account === "revolut" || fm.account === "ing") && !fm.bank_ref)
      probs.push("sin linea del banco (no esta en los extractos importados)");
    const invited = new Set(ids(fm.invited));
    const owing = ids(fm.people).filter((x) => !invited.has(x));
    if (amount < 0 && owing.length && isSpending(cat)) {
      if (toFloat(fm.my_share) === null)
        probs.push(`compartido sin my_share (${owing.map(nameOf).join(", ")})`);
      const have = new Set((debtsByMovement.get(id) ?? []).flatMap((d) => ids(d.person)));
      const missing = owing.filter((x) => !have.has(x));
      if (missing.length) probs.push(`faltan deudas de: ${missing.map(nameOf).join(", ")}`);
    }
    const settles = ids(fm.settles)[0];
    if (amount > 0 && isSpending(cat) && !settles)
      probs.push(
        "ingreso de una categoria de gasto sin settles (de que deuda o gasto es el reembolso?)"
      );
    if (settles && !targets.has(settles))
      probs.push(`settles apunta a un registro que no existe: ${settles}`);
    return probs;
  }
  function planClose(book, month, o) {
    const out = logger();
    const notes = book.movements();
    const debts = book.debts();
    const debtsByMovement = /* @__PURE__ */ new Map();
    for (const d of debts) {
      const k = ids(d.fm.movement)[0] ?? "";
      debtsByMovement.set(k, [...debtsByMovement.get(k) ?? [], d.fm]);
    }
    const targets = new Set([...notes, ...debts].map((n) => n.id));
    const nameOf = (id) => book.title(id) || id;
    const pending = notes.filter(
      (n) => n.fm.status === "pendiente" && (!month || String(n.fm.date ?? "").startsWith(month))
    );
    const ready = [];
    const blocked = [];
    const noRule = /* @__PURE__ */ new Set();
    for (const n of pending) {
      const probs = movementProblems(n.fm, n.id, o.cats, debtsByMovement, targets, o.kindOf, nameOf);
      if (probs.length) blocked.push([n, probs]);
      else ready.push(n);
      if (n.fm.bank_text && !probs.length && !matchRule(o.rules, n.fm.bank_text))
        noRule.add(
          `${String(n.fm.bank_text)}  ->  ${String(n.fm.merchant ?? "")}, ${String(n.fm.category ?? "")}`
        );
    }
    out(
      `Movimientos pendientes${month ? ` de ${month}` : ""}: ${pending.length}; listos para conciliar: ${ready.length}; siguen pendientes: ${blocked.length}`
    );
    for (const [n, probs] of blocked)
      out(
        `  PENDIENTE ${String(n.fm.date)} ${fmt(toFloat(n.fm.amount) ?? 0)} ${n.title}: ${probs.join("; ")}`
      );
    if (noRule.size) {
      out("Textos del banco sin regla (candidatos para Reglas):");
      for (const r of [...noRule].sort()) out(`  ${r}`);
    }
    const owed = /* @__PURE__ */ new Map();
    const owe = /* @__PURE__ */ new Map();
    for (const d of debts) {
      if (d.fm.status !== "pendiente") continue;
      const m = (d.fm.direction ?? "me-deben") === "me-deben" ? owed : owe;
      const who = nameOf(ids(d.fm.person)[0] ?? "");
      m.set(who, (m.get(who) ?? 0) + (toFloat(d.fm.amount) ?? 0));
    }
    const sum = (m) => [...m.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([k, v]) => `${k} ${euro2(v)} EUR`).join(", ");
    if (owed.size) out(`Te deben: ${sum(owed)}`);
    if (owe.size) out(`Debes: ${sum(owe)}`);
    return {
      ready: ready.map((n) => n.id),
      result: {
        ready: ready.map((n) => n.title),
        blocked: blocked.map(([n, p]) => [n.title, p]),
        report: out.lines
      }
    };
  }

  // preset.ts
  var MOVEMENT = [
    "date",
    "time",
    "amount",
    "currency",
    "account",
    "category",
    "merchant",
    "status",
    "source",
    "bank_ref",
    "bank_text",
    "created",
    "people",
    "invited",
    "my_share",
    "settles"
  ];
  var DEBT = ["movement", "person", "amount", "direction", "status"];
  var keyOf = (name) => name.replace(/_/g, "-");
  var one = (v) => Array.isArray(v) ? v[0] : v;
  var LINK = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/;
  var KIND = {
    gasto: "gasto",
    ingreso: "ingreso",
    otro: "otro",
    "ni gasto ni ingreso": "otro"
  };
  function accountOf(input) {
    const list = (k) => input.rows?.[k] ?? [];
    const titles = /* @__PURE__ */ new Map();
    for (const rows of Object.values(input.rows ?? {}))
      for (const r of rows) titles.set(r.id, String(r.values.$title ?? ""));
    const categories = list("categoria");
    const nombre = new Map(categories.map((c) => [c.id, String(c.values.nombre ?? "")]));
    const byTitle = /* @__PURE__ */ new Map();
    for (const c of categories) {
      const t = String(c.values.$title ?? "").trim().toLowerCase();
      if (t && !byTitle.has(t)) byTitle.set(t, c.id);
    }
    const categoryId = (v) => {
      const s = v.trim();
      if (!s) return null;
      if (nombre.has(s)) return s;
      return byTitle.get((LINK.exec(s)?.[1]?.trim() ?? s).toLowerCase()) ?? null;
    };
    const fm = (r, names) => {
      const out = {};
      for (const n of names) out[n] = r.values[keyOf(n)] ?? null;
      return out;
    };
    const movements = list("movimiento").map((r) => {
      const f = fm(r, MOVEMENT);
      const c = one(f.category);
      f.category = typeof c === "string" && nombre.has(c) ? nombre.get(c) || null : null;
      return { id: r.id, title: String(r.values.$title ?? ""), fm: f };
    });
    const debts = list("deuda").map((r) => ({
      id: r.id,
      title: String(r.values.$title ?? ""),
      fm: fm(r, DEBT)
    }));
    const kinds = categories.map((c) => {
      const name = String(c.values.nombre ?? "").trim();
      return { name, kind: KIND[asciiLow(c.values.tipo).trim()] ?? byName(name) };
    }).filter((c) => c.name).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    const kindOf = new Map(kinds.map((c) => [c.name, c.kind]));
    const rules = sortRules(
      list("regla").map(
        (r) => [
          rulePattern(String(r.values.texto ?? "")),
          String(r.values.comercio ?? "").trim(),
          typeof r.values.categoria === "string" ? titles.get(r.values.categoria) ?? "" : ""
        ]
      )
    ).filter((r) => r[0]);
    const never = () => {
      throw new Error("una función no escribe: devuelve sus cambios");
    };
    const book = {
      movements: () => movements,
      debts: () => debts,
      title: (id) => titles.get(id) ?? "",
      create: never,
      update: never
    };
    const versions = new Map(list("movimiento").map((r) => [r.id, r.version]));
    const valuesOf = (props) => {
      const out = {};
      for (const [n, v] of Object.entries(props)) {
        if (v === null || v === "" || Array.isArray(v) && !v.length) continue;
        out[keyOf(n)] = n === "category" ? categoryId(String(v)) : v;
      }
      return out;
    };
    return {
      book,
      cats: kinds.map((c) => c.name),
      rules,
      kindOf: (category) => kindOf.get(category) ?? byName(category),
      create: (m) => ({
        op: "create",
        collection: "movimiento",
        values: { $title: m.title, ...valuesOf(m.values), ...m.body ? { $text: m.body } : {} }
      }),
      update: (id, props) => ({
        op: "update",
        id,
        version: versions.get(id) ?? 0,
        values: valuesOf(props)
      })
    };
  }
  function plain(s, max = 300) {
    const t = s.replace(/(https?):\/\//gi, "$1 ").replace(/www\./gi, "www ").replace(/<(?=\s*\/?\s*[a-z!])/gi, "‹").replace(/\]\(/g, "] (").replace(/(javascript|data):/gi, "$1 ").replace(/[\t\n\v\f\r]+/g, " ").trimEnd();
    const cut2 = t.length > max ? `${t.slice(0, max - 1)}…` : t;
    return cut2.trim() ? cut2 : "?";
  }
  function reportOf(lines, max = 200) {
    const out = lines.flatMap((l) => l.split("\n")).filter((l) => l.trim()).map((l) => plain(l));
    return out.length > max ? [...out.slice(0, max - 1), `… y ${out.length - max + 1} líneas más`] : out;
  }
  var count = (n, one2, many) => `${n} ${n === 1 ? one2 : many}`;
  function filesOf(data) {
    const files = data?.files;
    if (files === void 0 || files === null) return [];
    if (!Array.isArray(files)) throw new Error("data.files: una lista de extractos { name, base64 }");
    return files.map((f, i) => {
      if (typeof f?.name !== "string" || typeof f.base64 !== "string")
        throw new Error(`data.files[${i}]: { name, base64 }`);
      return { name: f.name, bytes: fromBase64(f.base64) };
    });
  }
  function importar(input, ctx) {
    const a = accountOf(input);
    const files = filesOf(input.data);
    const plan = planImport(a.book, files, { rules: a.rules, today: ctx.day });
    const asks = plan.unclear.map(
      (u) => ({
        op: "ask",
        question: plain(
          `Línea del banco dudosa: ${u.line.date} ${u.line.amount.toFixed(2)} ${u.line.text}. ¿Cuál de estas notas es?`
        ),
        options: [
          ...u.candidates.slice(0, 5).map((id) => plain(a.book.title(id) || id, 80)),
          "Ninguna: es otro movimiento"
        ]
      })
    );
    return {
      summary: files.length ? [
        count(plan.creates.length, "nueva", "nuevas"),
        count(plan.edits.length, "unida", "unidas"),
        count(plan.unclear.length, "dudosa", "dudosas")
      ].join(", ") : "No hay extractos",
      report: reportOf(plan.result.report),
      changes: [
        ...plan.edits.map((e) => a.update(e.id, e.props)),
        ...plan.creates.map((c) => a.create(c.movement)),
        ...asks
      ]
    };
  }
  function cerrar_mes(input) {
    const m = input.data?.month;
    if (m !== void 0 && m !== null && (typeof m !== "string" || !/^\d{4}-\d{2}$/.test(m)))
      throw new Error("data.month: un mes como 2026-09");
    const month = typeof m === "string" ? m : null;
    const a = accountOf(input);
    const plan = planClose(a.book, month, { cats: a.cats, rules: a.rules, kindOf: a.kindOf });
    return {
      summary: `${month ?? "Todos los meses"}: ${plan.ready.length} para conciliar, ${count(plan.result.blocked.length, "sigue pendiente", "siguen pendientes")}`,
      report: reportOf(plan.result.report),
      changes: plan.ready.map((id) => a.update(id, { status: "conciliado" }))
    };
  }
  return __toCommonJS(preset_exports);
})();
var importar = conciliacion.importar;
var cerrar_mes = conciliacion.cerrar_mes;
