import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * A minimal ZIP (PKWARE APPNOTE 6.3): deflated entries, UTF-8 names, no ZIP64 (an export is far below
 * 4 GB) and no extra fields. Enough for an export any system opens, and for reading one back.
 */
export interface ZipEntry {
  path: string;
  data: Buffer;
}

const DOS_EPOCH = Date.UTC(1980, 0, 1);

/** The MS-DOS time and date of `ms` (UTC, as nothing in a zip says the zone). */
function dosTime(ms: number): { time: number; date: number } {
  const d = new Date(Math.max(ms, DOS_EPOCH));
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

export function writeZip(entries: ZipEntry[], at = Date.now()): Buffer {
  const { time, date } = dosTime(at);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.path, "utf8");
    const packed = deflateRawSync(e.data);
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
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
