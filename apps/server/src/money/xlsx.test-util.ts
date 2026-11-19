/**
 * .xlsx archives for tests, built in the test: a ZIP holding the parts the sheet reader opens (a worksheet and,
 * if given, the shared strings). Invented sheets only.
 */
import { deflateRawSync } from "node:zlib";

const le = (n: number, bytes: number) => {
  const b = Buffer.alloc(bytes);
  if (bytes === 2) b.writeUInt16LE(n);
  else b.writeUInt32LE(n >>> 0);
  return b;
};

/** A ZIP of these files, each deflated (the CRC is left 0: the reader does not check it). */
export function zip(files: Record<string, string | Uint8Array>): Uint8Array {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
    const data = deflateRawSync(raw);
    const n = Buffer.from(name, "utf8");
    const head = (sig: number, central: boolean) =>
      Buffer.concat([
        le(sig, 4),
        ...(central ? [le(20, 2)] : []),
        le(20, 2), // version needed
        le(0, 2), // flags
        le(8, 2), // deflated
        le(0, 4), // time and date
        le(0, 4), // CRC
        le(data.length, 4),
        le(raw.length, 4),
        le(n.length, 2),
        le(0, 2), // extra
        ...(central ? [le(0, 2), le(0, 2), le(0, 2), le(0, 4), le(offset, 4)] : []),
        n,
      ]);
    const local = Buffer.concat([head(0x04034b50, false), data]);
    central.push(head(0x02014b50, true));
    locals.push(local);
    offset += local.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.concat([
    le(0x06054b50, 4),
    le(0, 4),
    le(central.length, 2),
    le(central.length, 2),
    le(dir.length, 4),
    le(offset, 4),
    le(0, 2),
  ]);
  return new Uint8Array(Buffer.concat([...locals, dir, end]));
}

/** An .xlsx whose first sheet's `<sheetData>` holds `rows` (XML as written), with these shared strings. */
export const xlsx = (rows: string, shared?: string[]): Uint8Array =>
  zip({
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`,
    ...(shared
      ? {
          "xl/sharedStrings.xml": `<sst>${shared.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`,
        }
      : {}),
  });
