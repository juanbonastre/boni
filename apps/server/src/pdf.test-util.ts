import { deflateSync } from "node:zlib";

/**
 * PDFs for tests, built the way writers lay them out (objects, an xref table, a trailer): the PDF reader's tests and a
 * dropped invoice's (A-24). Invented documents only.
 */
export type Obj = string | { dict: string; data: Uint8Array } | null;
export const latin = (s: string) => Buffer.from(s, "latin1");
/** A PDF of these objects (1 is the catalogue, 2 the page tree), with an xref table like a writer's. */
export function pdf(objs: Obj[], trailer = ""): Uint8Array {
  const parts: Buffer[] = [latin("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")];
  const offsets: number[] = [];
  let at = parts[0]?.length ?? 0;
  objs.forEach((o, i) => {
    offsets.push(o === null ? -1 : at);
    if (o === null) return;
    const body =
      typeof o === "string"
        ? latin(`${i + 1} 0 obj\n${o}\nendobj\n`)
        : Buffer.concat([
            latin(`${i + 1} 0 obj\n<< ${o.dict} /Length ${o.data.length} >>\nstream\n`),
            Buffer.from(o.data),
            latin("\nendstream\nendobj\n"),
          ]);
    parts.push(body);
    at += body.length;
  });
  const xref = [
    "xref",
    `0 ${objs.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.map((o) =>
      o < 0 ? "0000000000 00001 f " : `${String(o).padStart(10, "0")} 00000 n `,
    ),
    "trailer",
    `<< /Size ${objs.length + 1} /Root 1 0 R ${trailer}>>`,
    "startxref",
    String(at),
    "%%EOF",
  ].join("\n");
  parts.push(latin(xref));
  return new Uint8Array(Buffer.concat(parts));
}
export const flate = (s: string) => ({ dict: "/Filter /FlateDecode", data: deflateSync(latin(s)) });

/** A one-page invoice in Helvetica (WinAnsi: «€» is byte 0x80), one line of text per entry, top to bottom. */
export function textPdf(lines: string[]): Uint8Array {
  const esc = (t: string) => t.replace(/[\\()]/g, (c) => `\\${c}`).replace(/€/g, "\\200");
  const content = lines
    .map((l, i) => `BT /F1 11 Tf 50 ${780 - i * 16} Td (${esc(l)}) Tj ET`)
    .join("\n");
  return pdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>",
    flate(content),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ]);
}

/** A scanned page: an image only, as a scanner app writes it (the JPEG's bytes as they are). */
export function scanPdf(jpeg: Uint8Array): Uint8Array {
  return pdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>",
    flate("q 595 0 0 842 0 0 cm /Im0 Do Q"),
    {
      dict: "/Type /XObject /Subtype /Image /Width 10 /Height 10 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode",
      data: jpeg,
    },
  ]);
}
