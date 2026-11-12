import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * A minimal ZIP (PKWARE APPNOTE 6.3): deflated or stored entries, UTF-8 names, and ZIP64 where a 32-bit field runs
 * out (an entry past 4 GB, more than 65,535 entries, a directory past 4 GB): a backup holds files of up to 1 GB
 * each and may pass 4 GB in total (task 101). Enough for an export any system opens, and for reading one back.
 * An entry's data may be a function: it is called only when that entry is written, so a big export (the
 * attachments) never needs all its files in memory at once (the server's container has 384 MB). An entry too big
 * to hold even alone (an attachment, the operation log) gives its bytes a piece at a time (`chunks`). Reading
 * works the same way: `openZipFile` reads the directory and then each entry a part at a time (`chunks`).
 */
export interface ZipEntry {
  path: string;
  /** Its bytes, or a function called only when the entry is written. */
  data?: Buffer | (() => Buffer);
  /**
   * Its bytes a piece at a time, written as they come: kept as they are (stored), with the CRC and sizes after
   * them (a data descriptor), so only one piece is ever in memory.
   */
  chunks?: () => Iterable<Buffer>;
  /** Kept as it is, not deflated (attachments: PDF, images and video are compressed already). */
  stored?: boolean;
}

/**
 * Where the zip's fields run out. A position or the directory's size from `bytes` on, or a count from `entries`
 * on, goes in ZIP64 records; an entry bigger than `entry` is refused (its sizes stay 32-bit: no file reaches
 * it, the drop limit is 1 GB). The defaults are the format's; a test lowers them to take the ZIP64 path with a
 * few kilobytes.
 */
export interface ZipLimits {
  bytes: number;
  entries: number;
  entry: number;
}
const LIMITS: ZipLimits = { bytes: 0xffffffff, entries: 0xffff, entry: 0xfffffffe };
const MAX32 = 0xffffffff;

/** An entry's bytes (calling its function, or putting its pieces together, when it has them). */
export const entryData = (e: ZipEntry): Buffer =>
  e.chunks
    ? Buffer.concat([...e.chunks()])
    : typeof e.data === "function"
      ? e.data()
      : (e.data ?? Buffer.alloc(0));

const DOS_EPOCH = Date.UTC(1980, 0, 1);

/** The MS-DOS time and date of `ms` (UTC, as nothing in a zip says the zone). */
function dosTime(ms: number): { time: number; date: number } {
  const d = new Date(Math.max(ms, DOS_EPOCH));
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

export class ZipError extends Error {}

interface Header {
  name: Buffer;
  flags: number;
  method: number;
  time: number;
  date: number;
  crc: number;
  packed: number;
  size: number;
  offset: number;
}

/**
 * An entry's record in the central directory; its offset in a ZIP64 extra field when it is past `bytes`. Kept
 * until the zip ends, so in memory of its own (`Buffer.alloc`), never a slice of Node's pool: a pooled one kept
 * the whole 64 KB slab it was cut from, and each deflated entry takes 16 KB of the pool, so an export of 3,200
 * records held 67 MB until its end (task 101, measured).
 */
function centralOf(h: Header, lim: ZipLimits): Buffer {
  const far = h.offset >= lim.bytes;
  const central = Buffer.alloc(46 + h.name.length + (far ? 12 : 0));
  h.name.copy(central, 46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(far ? 45 : 20, 4); // made by (4.5: ZIP64)
  central.writeUInt16LE(far ? 45 : 20, 6); // version needed
  central.writeUInt16LE(h.flags, 8);
  central.writeUInt16LE(h.method, 10);
  central.writeUInt16LE(h.time, 12);
  central.writeUInt16LE(h.date, 14);
  central.writeUInt32LE(h.crc, 16);
  central.writeUInt32LE(h.packed, 20);
  central.writeUInt32LE(h.size, 24);
  central.writeUInt16LE(h.name.length, 28);
  if (!far) {
    central.writeUInt32LE(h.offset, 42);
    return central;
  }
  central.writeUInt16LE(12, 30);
  central.writeUInt32LE(MAX32, 42);
  const x = 46 + h.name.length;
  central.writeUInt16LE(0x0001, x); // ZIP64 extended information
  central.writeUInt16LE(8, x + 2);
  central.writeBigUInt64LE(BigInt(h.offset), x + 4);
  return central;
}

/** The end of the zip: ZIP64's end record and locator when a field runs out, then the classic end record. */
function endOf(count: number, dirSize: number, dirOffset: number, lim: ZipLimits): Buffer {
  const wide = count >= lim.entries || dirSize >= lim.bytes || dirOffset >= lim.bytes;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count >= lim.entries ? 0xffff : count, 8);
  end.writeUInt16LE(count >= lim.entries ? 0xffff : count, 10);
  end.writeUInt32LE(dirSize >= lim.bytes ? MAX32 : dirSize, 12);
  end.writeUInt32LE(dirOffset >= lim.bytes ? MAX32 : dirOffset, 16);
  if (!wide) return end;
  const rec = Buffer.alloc(56);
  rec.writeUInt32LE(0x06064b50, 0);
  rec.writeBigUInt64LE(44n, 4); // the record's size after this field
  rec.writeUInt16LE(45, 12);
  rec.writeUInt16LE(45, 14);
  rec.writeBigUInt64LE(BigInt(count), 24);
  rec.writeBigUInt64LE(BigInt(count), 32);
  rec.writeBigUInt64LE(BigInt(dirSize), 40);
  rec.writeBigUInt64LE(BigInt(dirOffset), 48);
  const loc = Buffer.alloc(20);
  loc.writeUInt32LE(0x07064b50, 0);
  loc.writeBigUInt64LE(BigInt(dirOffset + dirSize), 8); // where `rec` starts
  loc.writeUInt32LE(1, 16); // disks
  return Buffer.concat([rec, loc, end]);
}

/**
 * The zip as a sequence of chunks, one entry at a time (its header, then its packed data), then the central
 * directory: what is in memory at any moment is one entry (or one piece of it) and the directory's small headers.
 * The last 22 bytes are always the classic end record (the desktop's copy checks them to tell a cut download).
 */
export function* zipChunks(
  entries: Iterable<ZipEntry>,
  at = Date.now(),
  limits: Partial<ZipLimits> = {},
): Generator<Buffer> {
  const lim = { ...LIMITS, ...limits };
  const { time, date } = dosTime(at);
  const centrals: Buffer[] = [];
  let offset = 0;
  let count = 0;
  const tooBig = (e: ZipEntry) => new ZipError(`entry too large: ${e.path}`);
  for (const e of entries) {
    const name = Buffer.from(e.path, "utf8");
    if (e.chunks) {
      // Its header first, with no CRC or sizes yet (bit 3: they follow the data), then each piece as it comes.
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0808, 6); // UTF-8 names, sizes in a data descriptor
      local.writeUInt16LE(0, 8); // stored
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      local.writeUInt16LE(name.length, 26);
      yield Buffer.concat([local, name]);
      let crc = 0;
      let size = 0;
      for (const piece of e.chunks()) {
        if (!piece.length) continue;
        size += piece.length;
        if (size > lim.entry) throw tooBig(e);
        crc = crc32(piece, crc);
        yield piece;
      }
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(size, 8);
      descriptor.writeUInt32LE(size, 12);
      yield descriptor;
      centrals.push(
        centralOf(
          { name, flags: 0x0808, method: 0, time, date, crc, packed: size, size, offset },
          lim,
        ),
      );
      offset += 30 + name.length + size + 16;
      count++;
      continue;
    }
    const plain = entryData(e);
    if (plain.length > lim.entry) throw tooBig(e);
    const method = e.stored ? 0 : 8;
    const packed = e.stored ? plain : deflateRawSync(plain);
    if (packed.length > lim.entry) throw tooBig(e);
    const crc = crc32(plain);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8); // 8 deflate, 0 stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(plain.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    yield Buffer.concat([local, name]);
    yield packed;
    centrals.push(
      centralOf(
        {
          name,
          flags: 0x0800,
          method,
          time,
          date,
          crc,
          packed: packed.length,
          size: plain.length,
          offset,
        },
        lim,
      ),
    );
    offset += 30 + name.length + packed.length;
    count++;
  }
  const dir = Buffer.concat(centrals);
  yield dir;
  yield endOf(count, dir.length, offset, lim);
}

/**
 * For a loop that sends `zipChunks`: call it with each chunk's size; every `every` bytes it asks V8 to free
 * what was sent. Attachments are read one at a time, but each one is an external buffer V8 frees late: without
 * this they add up (400 MB of attachments peaked at 288 MB, 185 MB with it; task 101, a 5 GB export through the
 * CLI: 379 MB without, a flat 275 MB with it). The server's container runs node with --expose-gc; where it does
 * not (the CLI, as `docs/servidor.md` says to run it), the collector is turned on here.
 */
export function releaseSent(every = 32 * 1024 * 1024): (bytes: number) => void {
  const gc = collector();
  let since = 0;
  return (bytes) => {
    since += bytes;
    if (since < every) return;
    since = 0;
    gc();
  };
}

/** V8's collector: the global one with --expose-gc, else the one a fresh context gets once the flag is set. */
function collector(): () => void {
  const global = (globalThis as { gc?: () => void }).gc;
  if (global) return global;
  setFlagsFromString("--expose-gc");
  return runInNewContext("gc") as () => void;
}

/** The whole zip in memory (small ones: tests, a few files). Big exports go through `zipChunks`. */
export function writeZip(
  entries: ZipEntry[],
  at = Date.now(),
  limits?: Partial<ZipLimits>,
): Buffer {
  return Buffer.concat([...zipChunks(entries, at, limits)]);
}

/** Where a zip's bytes come from: a buffer, or a file read where asked. */
interface Source {
  size: number;
  /** `len` bytes at `pos`, into `into` when given (reused by the caller), else a new buffer. */
  read(pos: number, len: number, into?: Buffer): Buffer;
  close(): void;
}

const bufferSource = (buf: Buffer): Source => ({
  size: buf.length,
  read: (pos, len, into) => {
    const part = buf.subarray(pos, pos + len);
    if (part.length < len) throw new ZipError("cut short");
    if (!into) return Buffer.from(part);
    part.copy(into);
    return into.subarray(0, len);
  },
  close: () => {},
});

function fileSource(path: string): Source {
  const fd = openSync(path, "r");
  return {
    size: fstatSync(fd).size,
    read: (pos, len, into) => {
      const out = into ? into.subarray(0, len) : Buffer.allocUnsafe(len);
      for (let got = 0; got < len; ) {
        const n = readSync(fd, out, got, len - got, pos + got);
        if (!n) throw new ZipError("cut short");
        got += n;
      }
      return out;
    },
    close: () => closeSync(fd),
  };
}

interface Entry {
  method: number;
  crc: number;
  packed: number;
  size: number;
  local: number;
  start: number;
}

/** A zip opened for reading: its directory read and checked, its entries read only when asked. */
export interface ZipArchive {
  /** The names of its files (folders left out), in the directory's order. */
  readonly names: string[];
  has(name: string): boolean;
  /** An entry's unpacked size, or null when it is not there. */
  size(name: string): number | null;
  /** A small entry whole (the schema, a type's NDJSON), its CRC checked; null when it is not there. */
  read(name: string): Buffer | null;
  /**
   * An entry a part at a time, its CRC checked after the last one (a damaged entry throws then, before the loop
   * ends). Each part is one reused buffer, valid until the next is asked for: one part is in memory at once.
   */
  chunks(name: string, part?: number): Generator<Buffer>;
  close(): void;
}

/** What `read` hands back whole: a type's records and the schema, never an attachment. */
const READ_WHOLE_MAX = 256 * 1024 * 1024;
/** A central directory bigger than this is not one of ours (60,000 entries take under 10 MB). */
const DIRECTORY_MAX = 64 * 1024 * 1024;
const PART = 1024 * 1024;

/**
 * Reads a zip's central directory, the classic one or ZIP64's, and checks it before anything is unpacked:
 * deflate or stored only, names that stay inside (no absolute paths, no `..`, none twice), every entry inside
 * the file and none overlapping another (stored entries then add up to at most the file), and a cap on what the
 * deflated ones unpack to, against zip bombs.
 */
function open(src: Source, maxBytes: number): ZipArchive {
  try {
    const tailLen = Math.min(src.size, 22 + 0xffff);
    const tail = src.read(src.size - tailLen, tailLen);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--)
      if (tail.readUInt32LE(i) === 0x06054b50) {
        end = i;
        break;
      }
    if (end < 0) throw new ZipError("not a zip");
    let count = tail.readUInt16LE(end + 10);
    let dirSize = tail.readUInt32LE(end + 12);
    let dirOffset = tail.readUInt32LE(end + 16);
    const endAt = src.size - tailLen + end;
    let dirEnd = endAt;
    if (end >= 20 && tail.readUInt32LE(end - 20) === 0x07064b50) {
      const recAt = Number(tail.readBigUInt64LE(end - 12));
      if (recAt + 56 > endAt - 20) throw new ZipError("bad zip64 end");
      const rec = src.read(recAt, 56);
      if (rec.readUInt32LE(0) !== 0x06064b50) throw new ZipError("bad zip64 end");
      count = Number(rec.readBigUInt64LE(32));
      dirSize = Number(rec.readBigUInt64LE(40));
      dirOffset = Number(rec.readBigUInt64LE(48));
      dirEnd = recAt;
    }
    if (dirSize > DIRECTORY_MAX || dirOffset + dirSize > dirEnd)
      throw new ZipError("bad central directory");
    const dir = src.read(dirOffset, dirSize);
    const entries = new Map<string, Entry>();
    let inflated = 0;
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (p + 46 > dir.length || dir.readUInt32LE(p) !== 0x02014b50)
        throw new ZipError("bad central directory");
      const method = dir.readUInt16LE(p + 10);
      const crc = dir.readUInt32LE(p + 16);
      let packed = dir.readUInt32LE(p + 20);
      let size = dir.readUInt32LE(p + 24);
      const nameLen = dir.readUInt16LE(p + 28);
      const extraLen = dir.readUInt16LE(p + 30);
      const commentLen = dir.readUInt16LE(p + 32);
      let local = dir.readUInt32LE(p + 42);
      const name = dir.toString("utf8", p + 46, p + 46 + nameLen);
      // ZIP64's extra field holds, in this order, each of these that the record left at 0xFFFFFFFF.
      for (let x = p + 46 + nameLen; x + 4 <= p + 46 + nameLen + extraLen; ) {
        const id = dir.readUInt16LE(x);
        const len = dir.readUInt16LE(x + 2);
        if (id === 0x0001) {
          let q = x + 4;
          const next = () => {
            if (q + 8 > x + 4 + len) throw new ZipError("bad zip64 field");
            const v = Number(dir.readBigUInt64LE(q));
            q += 8;
            return v;
          };
          if (size === MAX32) size = next();
          if (packed === MAX32) packed = next();
          if (local === MAX32) local = next();
        }
        x += 4 + len;
      }
      p += 46 + nameLen + extraLen + commentLen;
      if (name.endsWith("/")) continue;
      if (name.startsWith("/") || name.includes("\\") || name.split("/").includes(".."))
        throw new ZipError(`bad name: ${name}`);
      if (entries.has(name)) throw new ZipError(`twice: ${name}`);
      if (method !== 0 && method !== 8) throw new ZipError(`unsupported method ${method}`);
      if (method === 0 && packed !== size) throw new ZipError(`damaged: ${name}`);
      if (method === 8) {
        inflated += size;
        if (inflated > maxBytes) throw new ZipError("too large");
      }
      if (local + 30 > dirOffset) throw new ZipError("bad entry");
      const head = src.read(local, 30);
      if (head.readUInt32LE(0) !== 0x04034b50) throw new ZipError("bad entry");
      const start = local + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
      entries.set(name, { method, crc, packed, size, local, start });
    }
    // Every entry inside the file and none over another: two names over the same bytes are a zip bomb.
    const sorted = [...entries.values()].sort((a, b) => a.local - b.local);
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i] as Entry;
      if (e.start + e.packed > (sorted[i + 1]?.local ?? dirOffset))
        throw new ZipError("overlapping entries");
    }
    const at = (name: string) => entries.get(name);
    const whole = (name: string, e: Entry): Buffer => {
      if (e.size > READ_WHOLE_MAX) throw new ZipError(`too large to read whole: ${name}`);
      const packed = src.read(e.start, e.packed);
      const data =
        e.method === 8 ? inflateRawSync(packed, { maxOutputLength: Math.max(e.size, 1) }) : packed;
      if (data.length !== e.size || crc32(data) !== e.crc) throw new ZipError(`damaged: ${name}`);
      return data;
    };
    return {
      names: [...entries.keys()],
      has: (name) => entries.has(name),
      size: (name) => at(name)?.size ?? null,
      read: (name) => {
        const e = at(name);
        return e ? whole(name, e) : null;
      },
      *chunks(name, part = PART) {
        const e = at(name);
        if (!e) return;
        if (e.method === 8) {
          const data = whole(name, e);
          for (let i = 0; i < data.length; i += part) yield data.subarray(i, i + part);
          return;
        }
        const buf = Buffer.allocUnsafe(Math.min(part, Math.max(e.size, 1)));
        let crc = 0;
        for (let done = 0; done < e.size; ) {
          const piece = src.read(e.start + done, Math.min(buf.length, e.size - done), buf);
          crc = crc32(piece, crc);
          done += piece.length;
          if (done === e.size && crc !== e.crc) throw new ZipError(`damaged: ${name}`);
          yield piece;
        }
        if (!e.size && e.crc !== 0) throw new ZipError(`damaged: ${name}`);
      },
      close: () => src.close(),
    };
  } catch (e) {
    src.close();
    if (e instanceof RangeError) throw new ZipError("bad zip");
    throw e;
  }
}

/** A zip in memory, opened for reading (`ZipArchive`). */
export const openZip = (buf: Buffer, maxBytes = 2 * 1024 ** 3): ZipArchive =>
  open(bufferSource(buf), maxBytes);

/** A zip on disk, opened for reading: its directory now, each entry only when asked, a part at a time. */
export const openZipFile = (path: string, maxBytes = 2 * 1024 ** 3): ZipArchive =>
  open(fileSource(path), maxBytes);

/** The entries of a zip in memory, every one read and checked (small zips: tests, a few files). */
export function readZip(buf: Buffer, maxBytes = 2 * 1024 ** 3): Map<string, Buffer> {
  const z = openZip(buf, maxBytes);
  return new Map(z.names.map((n) => [n, z.read(n) as Buffer]));
}
