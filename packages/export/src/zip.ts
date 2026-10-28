import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * A minimal ZIP (PKWARE APPNOTE 6.3): deflated entries, UTF-8 names, no ZIP64 (an export is far below
 * 4 GB) and no extra fields. Enough for an export any system opens, and for reading one back.
 * An entry's data may be a function: it is called only when that entry is written, so a big export (the
 * attachments) never needs all its files in memory at once (the server's container has 384 MB). An entry too big
 * to hold even alone (the operation log) gives its bytes a piece at a time (`chunks`).
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

/**
 * The zip as a sequence of chunks, one entry at a time (its header, then its packed data), then the central
 * directory: what is in memory at any moment is one entry and the directory's small headers.
 */
export function* zipChunks(entries: Iterable<ZipEntry>, at = Date.now()): Generator<Buffer> {
  const { time, date } = dosTime(at);
  const centrals: Buffer[] = [];
  let offset = 0;
  let count = 0;
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
        crc = crc32(piece, crc);
        size += piece.length;
        yield piece;
      }
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(size, 8);
      descriptor.writeUInt32LE(size, 12);
      yield descriptor;
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(0x0808, 8);
      central.writeUInt16LE(0, 10);
      central.writeUInt16LE(time, 12);
      central.writeUInt16LE(date, 14);
      central.writeUInt32LE(crc, 16);
      central.writeUInt32LE(size, 20);
      central.writeUInt32LE(size, 24);
      central.writeUInt16LE(name.length, 28);
      central.writeUInt32LE(offset, 42);
      centrals.push(central, name);
      offset += 30 + name.length + size + 16;
      count++;
      continue;
    }
    const plain = entryData(e);
    const method = e.stored ? 0 : 8;
    const packed = e.stored ? plain : deflateRawSync(plain);
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
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(plain.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + packed.length;
    count++;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  yield dir;
  yield end;
}

/**
 * For a loop that sends `zipChunks`: call it with each chunk's size; every `every` bytes it asks V8 to free
 * what was sent (only when node runs with --expose-gc, as the server's container does). Attachments are read
 * one at a time, but each one is an external buffer V8 frees late: without this they add up (400 MB of
 * attachments peaked at 288 MB, 185 MB with it).
 */
export function releaseSent(every = 32 * 1024 * 1024): (bytes: number) => void {
  const gc = (globalThis as { gc?: () => void }).gc;
  let since = 0;
  return (bytes) => {
    since += bytes;
    if (since < every || !gc) return;
    since = 0;
    gc();
  };
}

/** The whole zip in memory (small ones: tests, a few files). Big exports go through `zipChunks`. */
export function writeZip(entries: ZipEntry[], at = Date.now()): Buffer {
  return Buffer.concat([...zipChunks(entries, at)]);
}

export class ZipError extends Error {}

/**
 * The entries of a zip (from its central directory), checked: deflate or stored only, CRC verified,
 * names that stay inside (no absolute paths, no `..`), and a cap on the unpacked size against zip bombs.
 */
export function readZip(buf: Buffer, maxBytes = 2 * 1024 ** 3): Map<string, Buffer> {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new ZipError("not a zip");
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map<string, Buffer>();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError("bad central directory");
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const packedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (name.startsWith("/") || name.includes("\\") || name.split("/").includes(".."))
      throw new ZipError(`bad name: ${name}`);
    total += size;
    if (total > maxBytes) throw new ZipError("too large");
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new ZipError("bad entry");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const packed = buf.subarray(start, start + packedSize);
    const data =
      method === 8
        ? inflateRawSync(packed, { maxOutputLength: Math.max(size, 1) })
        : method === 0
          ? Buffer.from(packed)
          : null;
    if (!data) throw new ZipError(`unsupported method ${method}`);
    if (data.length !== size || crc32(data) !== crc) throw new ZipError(`damaged: ${name}`);
    out.set(name, data);
  }
  return out;
}
