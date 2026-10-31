/**
 * Reading bank statements as rows of cells (ported from `finanzas.py` of the gastos-app repo, 2026-10-23): CSV in
 * any of the usual encodings and separators, .xlsx (the first sheet) and the old binary .xls (BIFF8 inside an
 * OLE2 container, as ING still exports it). Numbers stay numbers (dates as Excel serials), text stays text. No
 * dependencies, and nothing of Node's (bytes.ts): the same code runs in the server and in the box (E4).
 */
import {
  concat,
  cp1252,
  f64,
  i32,
  inflateRaw,
  latin1,
  startsWith,
  u16,
  u32,
  utf8,
  utf16le,
} from "./bytes.ts";

export type Cell = string | number;
export type Row = Cell[];

/** Numbers as banks write them: -12.50, -12,50, 1.234,56, 1,234.56, "12,50 EUR". */
export function parseNum(v: unknown): number {
  if (typeof v === "number") return v;
  let s = String(v ?? "").replace(/[^0-9,.\-+]/g, "");
  if (!s || s === "+" || s === "-") return 0;
  if (s.includes(",") && s.includes(".")) {
    s =
      s.lastIndexOf(",") > s.lastIndexOf(".")
        ? s.replace(/\./g, "").replace(",", ".")
        : s.replace(/,/g, "");
  } else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Date formats the statements use, most specific first (finanzas.py's DT_FORMATS). */
const DATES: { re: RegExp; ymd: [number, number, number]; time: boolean; short?: boolean }[] = [
  { re: /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/, ymd: [1, 2, 3], time: true },
  { re: /^(\d{4})-(\d{2})-(\d{2})$/, ymd: [1, 2, 3], time: false },
  { re: /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/, ymd: [3, 2, 1], time: true },
  { re: /^(\d{2})\/(\d{2})\/(\d{4})$/, ymd: [3, 2, 1], time: false },
  { re: /^(\d{2})-(\d{2})-(\d{4})$/, ymd: [3, 2, 1], time: false },
  { re: /^(\d{2})\/(\d{2})\/(\d{2})$/, ymd: [3, 2, 1], time: false, short: true },
  { re: /^(\d{2})\.(\d{2})\.(\d{4})$/, ymd: [3, 2, 1], time: false },
];

/** A cell as (YYYY-MM-DD, "HH:MM" or "", "HH:MM:SS" or ""); text dates and Excel serial numbers. Throws if neither. */
export function parseDt(v: unknown): [string, string, string] {
  if (typeof v === "number") {
    const ms = Math.round((v - 25569) * 86400) * 1000; // 1899-12-30 is serial 0; 1970-01-01 is 25569
    const d = new Date(ms);
    const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const has = d.getUTCHours() || d.getUTCMinutes() || d.getUTCSeconds();
    const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    return [day, has ? hm : "", has ? `${hm}:${pad(d.getUTCSeconds())}` : ""];
  }
  const s = String(v ?? "")
    .trim()
    .replace(/\.\d+$/, "");
  for (const f of DATES) {
    const m = f.re.exec(s);
    if (!m) continue;
    let y = Number(m[f.ymd[0]]);
    if (f.short) y += y < 69 ? 2000 : 1900;
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

// ------------------------------------------------------------------ CSV

function decodeText(raw: Uint8Array): string {
  try {
    const t = utf8(raw, { fatal: true });
    return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
  } catch {
    return cp1252(raw);
  }
}

/** CSV with quotes, its separator guessed from the first lines (comma, semicolon or tab). */
export function readCsvRows(raw: Uint8Array): Row[] {
  const text = decodeText(raw);
  const sample = text.split(/\r?\n/).slice(0, 20).join("\n");
  const count = (d: string) => sample.split(d).length - 1;
  const delim = [",", ";", "\t"].reduce((a, b) => (count(b) > count(a) ? b : a));
  const rows: Row[] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
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
  return rows.map((r) => (r.length === 1 && r[0] === "" ? [] : r));
}

// ------------------------------------------------------------------ XLSX

/** The files of a ZIP by name (central directory; stored or deflated entries). */
function unzip(buf: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--)
    if (u32(buf, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error("xlsx sin directorio");
  const n = u16(buf, eocd + 10);
  let p = u32(buf, eocd + 16);
  for (let k = 0; k < n; k++) {
    if (u32(buf, p) !== 0x02014b50) throw new Error("xlsx dañado");
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

const xmlText = (s: string) =>
  s
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
const attr = (tag: string, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

function colIndex(ref: string | null): number | null {
  const m = /^[A-Z]+/.exec(ref ?? "");
  if (!m) return null;
  let n = 0;
  for (const ch of m[0]) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

/** The first worksheet of an .xlsx. */
export function readXlsxRows(raw: Uint8Array): Row[] {
  const files = unzip(raw);
  const shared: string[] = [];
  const sstBytes = files.get("xl/sharedStrings.xml");
  const sst = sstBytes ? utf8(sstBytes) : "";
  if (sst)
    for (const si of sst.match(/<si>[\s\S]*?<\/si>/g) ?? [])
      shared.push((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) ?? []).map(xmlText).join(""));
  const sheets = [...files.keys()]
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1]) - Number(/(\d+)\.xml$/.exec(b)?.[1]));
  if (!sheets.length) throw new Error("xlsx sin hojas");
  const sheet = files.get(sheets[0] as string);
  const xml = sheet ? utf8(sheet) : "";
  const rows: Row[] = [];
  for (const r of xml.match(/<row[\s>][\s\S]*?<\/row>|<row[^>]*\/>/g) ?? []) {
    const cells = new Map<number, Cell>();
    let next = 0;
    for (const c of r.match(/<c[\s>][\s\S]*?<\/c>|<c[^>]*\/>/g) ?? []) {
      const open = /^<c[^>]*>/.exec(c)?.[0] ?? c;
      const col = colIndex(attr(open, "r")) ?? next;
      next = col + 1;
      const t = attr(open, "t");
      const v = /<v>([\s\S]*?)<\/v>/.exec(c)?.[1];
      let val: Cell;
      if (t === "s") val = v !== undefined ? (shared[Number(v)] ?? "") : "";
      else if (t === "inlineStr")
        val = (c.match(/<t[^>]*>[\s\S]*?<\/t>/g) ?? []).map(xmlText).join("");
      else if (v === undefined) val = "";
      else if (t === "str" || t === "e" || t === "b") val = xmlText(v);
      else val = Number(v);
      cells.set(col, val);
    }
    const width = cells.size ? Math.max(...cells.keys()) + 1 : 0;
    rows.push(Array.from({ length: width }, (_x, i) => cells.get(i) ?? ""));
  }
  return rows;
}

// ------------------------------------------------------------------ XLS (BIFF8 in OLE2)

const OLE = Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
const END = 0xfffffffa;

/** One stream of an OLE2 compound file (the container of an old .xls). */
function oleStream(data: Uint8Array, names = ["Workbook", "Book"]): Uint8Array {
  if (!startsWith(data, OLE)) throw new Error("no es un archivo OLE2");
  const ssz = 1 << u16(data, 0x1e);
  const msz = 1 << u16(data, 0x20);
  const nFat = u32(data, 0x2c);
  const firstDir = u32(data, 0x30);
  const cutoff = u32(data, 0x38);
  const firstMfat = u32(data, 0x3c);
  const nMfat = u32(data, 0x40);
  const firstDifat = u32(data, 0x44);
  const nDifat = u32(data, 0x48);
  const sector = (n: number) => data.subarray((n + 1) * ssz, (n + 2) * ssz);
  const u32s = (b: Uint8Array) => Array.from({ length: b.length >> 2 }, (_x, i) => u32(b, i * 4));
  const difat = u32s(data.subarray(0x4c, 0x4c + 109 * 4));
  let s = firstDifat;
  const per = ssz / 4 - 1;
  for (let k = 0; k < nDifat && s < END; k++) {
    const vals = u32s(sector(s));
    difat.push(...vals.slice(0, per));
    s = vals[per] ?? END;
  }
  const fat: number[] = [];
  for (const x of difat.slice(0, nFat)) fat.push(...u32s(sector(x)));
  const chain = (start: number, table: number[]) => {
    const out: number[] = [];
    let c = start;
    for (let guard = 0; c < END && guard <= table.length; guard++) {
      out.push(c);
      c = c < table.length ? (table[c] as number) : 0xfffffffe;
    }
    return out;
  };
  const dirs = concat(chain(firstDir, fat).map(sector));
  const entries: { name: string; type: number; start: number; size: number }[] = [];
  for (let off = 0; off + 128 <= dirs.length; off += 128) {
    const nlen = u16(dirs, off + 0x40);
    entries.push({
      name: utf16le(dirs.subarray(off, off + Math.max(nlen - 2, 0))),
      type: dirs[off + 0x42] as number,
      start: u32(dirs, off + 0x74),
      size: u32(dirs, off + 0x78),
    });
  }
  const root = entries.find((e) => e.type === 5);
  for (const e of entries) {
    if (e.type !== 2 || !names.includes(e.name)) continue;
    if (e.size >= cutoff) return concat(chain(e.start, fat).map(sector)).subarray(0, e.size);
    const mfat: number[] = [];
    for (const x of chain(firstMfat, fat).slice(0, nMfat)) mfat.push(...u32s(sector(x)));
    const mini = concat(chain(root?.start ?? END, fat).map(sector));
    return concat(chain(e.start, mfat).map((m) => mini.subarray(m * msz, (m + 1) * msz))).subarray(
      0,
      e.size,
    );
  }
  throw new Error("el .xls no tiene hoja de calculo (stream Workbook)");
}

/** Bytes of a BIFF record and its CONTINUE records (strings may cross the boundary). */
class Pieces {
  private c: Uint8Array[];
  private i = 0;
  private p = 0;
  constructor(chunks: Uint8Array[]) {
    this.c = chunks.filter((x) => x.length);
  }
  private next() {
    while (this.i < this.c.length && this.p >= (this.c[this.i] as Uint8Array).length) {
      this.i++;
      this.p = 0;
    }
    if (this.i >= this.c.length) throw new Error("SST truncada");
  }
  read(n: number): Uint8Array {
    const out: Uint8Array[] = [];
    while (n) {
      this.next();
      const cur = this.c[this.i] as Uint8Array;
      const take = Math.min(n, cur.length - this.p);
      out.push(cur.subarray(this.p, this.p + take));
      this.p += take;
      n -= take;
    }
    return concat(out);
  }
  private chars(cch: number, high: number): string {
    let out = "";
    while (cch) {
      if (this.p >= (this.c[this.i] as Uint8Array).length) {
        // The characters go on in the next record, which starts with its own flags byte.
        this.i++;
        if (this.i >= this.c.length) throw new Error("SST truncada");
        high = ((this.c[this.i] as Uint8Array)[0] as number) & 1;
        this.p = 1;
      }
      const cur = this.c[this.i] as Uint8Array;
      const per = high ? 2 : 1;
      const take = Math.min(cch, Math.floor((cur.length - this.p) / per));
      const raw = cur.subarray(this.p, this.p + take * per);
      out += high ? utf16le(raw) : latin1(raw);
      this.p += take * per;
      cch -= take;
    }
    return out;
  }
  xlstring(cchSize = 2): string {
    const b = this.read(cchSize);
    const cch = cchSize === 2 ? u16(b, 0) : (b[0] as number);
    const flags = this.read(1)[0] as number;
    const runs = flags & 0x08 ? u16(this.read(2), 0) : 0;
    const ext = flags & 0x04 ? u32(this.read(4), 0) : 0;
    const s = this.chars(cch, flags & 0x01);
    if (4 * runs + ext) this.read(4 * runs + ext);
    return s;
  }
}

function rk(raw: Uint8Array): number {
  const u = u32(raw, 0);
  let x: number;
  if (u & 2) x = i32(raw, 0) >> 2;
  else {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setUint32(4, (u & 0xfffffffc) >>> 0, true);
    x = f64(b, 0);
  }
  return u & 1 ? x / 100 : x;
}

/** The first worksheet of an old binary .xls (BIFF8). */
export function readXlsRows(raw: Uint8Array): Row[] {
  const wb = oleStream(raw);
  const recs: [number, Uint8Array][] = [];
  for (let pos = 0; pos + 4 <= wb.length; ) {
    const type = u16(wb, pos);
    const len = u16(wb, pos + 2);
    recs.push([type, wb.subarray(pos + 4, pos + 4 + len)]);
    pos += 4 + len;
  }
  const sst: string[] = [];
  const cells = new Map<string, Cell>();
  let sheet = -1;
  let pending: string | null = null;
  const at = (r: number, c: number) => `${r},${c}`;
  for (let k = 0; k < recs.length; k++) {
    const [type, d] = recs[k] as [number, Uint8Array];
    if (type === 0x0809) {
      sheet++;
      continue;
    }
    if (type === 0x00fc) {
      const chunks = [d.subarray(8)];
      for (let j = k + 1; j < recs.length && (recs[j] as [number, Uint8Array])[0] === 0x003c; j++)
        chunks.push((recs[j] as [number, Uint8Array])[1]);
      const pieces = new Pieces(chunks);
      const n = u32(d, 4);
      for (let i = 0; i < n; i++) sst.push(pieces.xlstring());
      continue;
    }
    if (sheet !== 1) {
      if (sheet > 1) break;
      continue;
    }
    if (type === 0x00fd) {
      const idx = u32(d, 6);
      cells.set(at(u16(d, 0), u16(d, 2)), sst[idx] ?? "");
    } else if (type === 0x0203) {
      cells.set(at(u16(d, 0), u16(d, 2)), f64(d, 6));
    } else if (type === 0x027e) {
      cells.set(at(u16(d, 0), u16(d, 2)), rk(d.subarray(6, 10)));
    } else if (type === 0x00bd) {
      const r = u16(d, 0);
      const c0 = u16(d, 2);
      for (let n = 0; n < Math.floor((d.length - 6) / 6); n++)
        cells.set(at(r, c0 + n), rk(d.subarray(4 + n * 6 + 2, 4 + n * 6 + 6)));
    } else if (type === 0x0204 || type === 0x00d6) {
      cells.set(at(u16(d, 0), u16(d, 2)), new Pieces([d.subarray(6)]).xlstring());
    } else if (type === 0x0006) {
      const key = at(u16(d, 0), u16(d, 2));
      const res = d.subarray(6, 14);
      if (res[6] === 0xff && res[7] === 0xff) {
        pending = res[0] === 0 ? key : null;
        if (res[0] !== 0) cells.set(key, "");
      } else cells.set(key, f64(res, 0));
    } else if (type === 0x0207 && pending) {
      cells.set(pending, new Pieces([d]).xlstring());
      pending = null;
    }
  }
  if (!cells.size) return [];
  let maxR = 0;
  let maxC = 0;
  for (const k of cells.keys()) {
    const [r, c] = k.split(",").map(Number) as [number, number];
    maxR = Math.max(maxR, r);
    maxC = Math.max(maxC, c);
  }
  const rows: Row[] = [];
  for (let r = 0; r <= maxR; r++) {
    const any = Array.from({ length: maxC + 1 }, (_x, c) => cells.has(at(r, c))).some(Boolean);
    rows.push(any ? Array.from({ length: maxC + 1 }, (_x, c) => cells.get(at(r, c)) ?? "") : []);
  }
  return rows;
}

/** Any statement by its first bytes (and a .csv name for text). */
export function readRows(raw: Uint8Array, name: string): Row[] {
  if (raw[0] === 0x50 && raw[1] === 0x4b) return readXlsxRows(raw);
  if (startsWith(raw, OLE)) return readXlsRows(raw);
  if (name.toLowerCase().endsWith(".csv")) return readCsvRows(raw);
  const ext = /\.[^.]*$/.exec(name)?.[0] ?? "";
  throw new Error(`formato no soportado (${ext}): guardalo como .xlsx o .csv`);
}
