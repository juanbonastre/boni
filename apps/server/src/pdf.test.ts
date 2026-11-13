import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { cpu } from "./cpu.test-util.ts";
import {
  attachmentText,
  fileState,
  IMAGE_MAX,
  READ_MAX,
  readFile,
  TEXT_MAX,
} from "./fileReading.ts";
import { flate, latin, type Obj, pdf, scanPdf } from "./pdf.test-util.ts";
import { PDF_IMAGES_MAX, PDF_PAGES_MAX, readPdf } from "./pdf.ts";

/**
 * The PDF reader and the file reader over it (docs/sistema.md §4.7, A-24): PDFs built here the way generators write
 * them (compressed content, fonts with ToUnicode maps inside object streams, a scan's JPEG pages), invented invoices.
 */
/** An invoice of one page in Helvetica (WinAnsi): «Descripción», «€» as byte 0x80, kerning in TJ. */
const INVOICE = pdf([
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 /Resources << /Font << /F1 5 0 R >> >> >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>",
  flate(
    [
      "BT /F1 18 Tf 50 780 Td (Factura FAC-2026-0142) Tj ET",
      "BT /F1 10 Tf 50 740 Td (Taller Ejemplo S.L. \\(B00000000\\)) Tj",
      "0 -14 Td [(Descripci) 20 (\\363n)] TJ",
      "0 -14 Td [(Revisi\\363n anual) -3000 (120,00 \\200)] TJ",
      "T* (IVA 21 %) Tj ET",
      "BT 1 0 0 1 50 600 Tm /F1 12 Tf (Total: 1.234,56 \\200) Tj ET",
    ].join("\n"),
  ),
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
]);

/** A font as a browser writes it: Type0, two-byte codes, a ToUnicode map, its dictionaries in an object stream. */
function type0Invoice(): Uint8Array {
  const cmap = [
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap",
    "1 begincodespacerange <0000> <FFFF> endcodespacerange",
    "2 beginbfchar <0003> <0020> <0010> <20AC> endbfchar",
    "1 beginbfrange <0020> <0039> <0041> endbfrange",
    "1 beginbfrange <0040> <0042> [<00C1> <00C9> <00D3>] endbfrange",
    "endcmap CMapName currentdict /CMap defineresource pop end end",
  ].join("\n");
  // Codes 0x20.. are «A».., 0x40 «Á», 0x41 «É», 0x42 «Ó», 0x03 a space, 0x10 «€».
  const code = (s: string) =>
    [...s]
      .map((ch) => {
        if (ch === " ") return "0003";
        if (ch === "€") return "0010";
        const special = ({ Á: 0x40, É: 0x41, Ó: 0x42 } as Record<string, number>)[ch];
        const c = special ?? 0x20 + (ch.charCodeAt(0) - 65);
        return c.toString(16).padStart(4, "0");
      })
      .join("");
  const objStm = [
    "<< /Type /Font /Subtype /Type0 /BaseFont /Ejemplo /Encoding /Identity-H /ToUnicode 6 0 R >>",
  ];
  const head = "5 0 ";
  return pdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F7 5 0 R >> >> /Contents [4 0 R 7 0 R] >>",
    flate(`BT /F7 11 Tf 40 700 Td <${code("TOTAL")}> Tj ET`),
    // Object 5 lives only inside the object stream (8).
    null,
    flate(cmap),
    flate(`BT /F7 11 Tf 40 680 Td [<${code("CÓDIGO")}> -400 <${code("FAÉ")}>] TJ ET`),
    {
      dict: `/Type /ObjStm /N 1 /First ${head.length} /Filter /FlateDecode`,
      data: deflateSync(latin(head + objStm[0])),
    },
  ]);
}

/** A scanned page: an image only, as a scanner app writes it. */
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...latin("JFIF invented"), 0xff, 0xd9]);
const SCAN = scanPdf(JPEG);

describe("the PDF reader (A-24)", () => {
  it("reads an invoice's text: accents, the euro, kerning, lines in order", () => {
    const r = readPdf(INVOICE);
    expect(r).toMatchObject({ pages: 1, cut: false, encrypted: false, images: [] });
    const lines = r.text.split("\n");
    expect(lines[0]).toBe("Factura FAC-2026-0142");
    expect(lines).toContain("Taller Ejemplo S.L. (B00000000)");
    expect(lines).toContain("Descripción");
    expect(lines).toContain("Revisión anual 120,00 €");
    expect(lines).toContain("IVA 21 %");
    expect(lines.at(-1)).toBe("Total: 1.234,56 €");
  });

  it("reads a browser's fonts: two-byte codes through ToUnicode, inside an object stream, contents in parts", () => {
    const r = readPdf(type0Invoice());
    expect(r.text.split("\n")).toEqual(["TOTAL", "CÓDIGO FAÉ"]);
  });

  it("gives a scan's pages as their JPEGs, and an encrypted PDF nothing", () => {
    const s = readPdf(SCAN);
    expect(s.text).toBe("");
    expect(s.images.map((i) => Buffer.from(i).equals(Buffer.from(JPEG)))).toEqual([true]);
    const enc = pdf(
      ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [] /Count 0 >>"],
      "/Encrypt << /Filter /Standard /V 2 >> ",
    );
    expect(readPdf(enc)).toMatchObject({ text: "", encrypted: true });
    expect(readPdf(latin("not a pdf at all"))).toMatchObject({ text: "", pages: 0 });
  });

  it(`reads ${PDF_PAGES_MAX} pages at most and ${PDF_IMAGES_MAX} images, and stops a stream that inflates past its cap`, () => {
    const n = PDF_PAGES_MAX + 10;
    const objs: Obj[] = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      `<< /Type /Pages /Kids [${Array.from({ length: n }, (_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${n} /Resources << /Font << /F1 3 0 R >> /XObject << /Im 999 0 R >> >> >>`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    for (let i = 0; i < n; i++)
      objs.push(
        `<< /Type /Page /Parent 2 0 R /Contents ${5 + i * 2} 0 R >>`,
        flate(`BT /F1 9 Tf (Hoja ${i + 1}) Tj ET`),
      );
    const r = readPdf(pdf(objs));
    expect(r.cut).toBe(true);
    expect(r.text.split("\n").filter(Boolean)).toHaveLength(PDF_PAGES_MAX);
    // 200 MB of zeros in 200 KB: what is inflated stops at the cap, and the reading goes on without it.
    const bomb = pdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>",
      { dict: "/Filter /FlateDecode", data: deflateSync(Buffer.alloc(200 * 1024 * 1024)) },
    ]);
    expect(readPdf(bomb).text).toBe("");
  });
});

describe("the file reader, shared with the mail's attachments (A-24)", () => {
  it("says what each file gives before reading it, by its type and size", () => {
    expect(fileState("factura.pdf", "application/pdf", 80_000)).toBe("text");
    expect(fileState("tique.jpg", "image/jpeg", 2_000_000)).toBe("image");
    expect(fileState("tique.jpg", "image/jpeg", IMAGE_MAX + 1)).toBe("too-big");
    expect(fileState("foto.heic", "image/heic", 2_000_000)).toBe("unreadable");
    expect(fileState("vídeo.mp4", "video/mp4", 900_000_000)).toBe("unreadable");
    expect(fileState("extracto.pdf", "application/pdf", READ_MAX + 1)).toBe("too-big");
    expect(fileState("movimientos.xlsx", "application/octet-stream", 30_000)).toBe("text");
  });

  it("reads a PDF's text, a scan's images, a sheet's rows, and caps the text", () => {
    expect(readFile("factura.pdf", "application/pdf", INVOICE)).toMatchObject({
      state: "text",
      images: [],
      cut: false,
      pages: 1,
    });
    const scan = readFile("tique escaneado.pdf", "application/pdf", SCAN);
    expect(scan.state).toBe("image");
    expect(scan.images.map((i) => i.mime)).toEqual(["image/jpeg"]);
    const photo = readFile("tique.jpg", "image/jpeg", JPEG);
    expect([photo.state, photo.images.length]).toEqual(["image", 1]);
    const csv = readFile(
      "gastos.csv",
      "text/csv",
      latin("Fecha;Concepto;Importe\n2026-11-03;Café;2,10\n"),
    );
    expect(csv.text).toContain("Café");
    const long = readFile("notas.txt", "text/plain", latin("á".repeat(TEXT_MAX + 10)));
    expect([long.text.length, long.cut]).toEqual([TEXT_MAX, true]);
    expect(readFile("foto.heic", "image/heic", JPEG).state).toBe("unreadable");
    expect(readFile("roto.pdf", "application/pdf", latin("%PDF-1.4 nothing")).state).toBe(
      "unreadable",
    );
  });

  it("with his volume (A-15): fifty pages of invoices, and a scan of five pages of 3 MB, read in well under a second", () => {
    const page = (n: number) =>
      Array.from(
        { length: 45 },
        (_, i) =>
          `BT /F1 10 Tf 40 ${800 - i * 17} Td (Factura FAC-2026-${String(n * 45 + i).padStart(4, "0")} Revisi\\363n 1.020,30 \\200) Tj ET`,
      ).join("\n");
    const N = PDF_PAGES_MAX;
    const kids = Array.from({ length: N }, (_, i) => `${4 + i * 2} 0 R`).join(" ");
    const book = pdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      `<< /Type /Pages /Kids [${kids}] /Count ${N} /Resources << /Font << /F1 3 0 R >> >> >>`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      ...Array.from({ length: N }, (_, i) => [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${5 + i * 2} 0 R >>`,
        flate(page(i)),
      ]).flat(),
    ]);
    let t = cpu();
    const r = readFile("facturas 2026.pdf", "application/pdf", book);
    const textMs = cpu() - t;
    expect(r.pages).toBe(N);
    expect(r.text).toContain("Factura FAC-2026-0000 Revisión 1.020,30 €");
    expect(r.cut).toBe(true);
    // A scanner's five pages, 3 MB each (15 MB, under READ_MAX).
    const jpeg = (k: number) =>
      Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Uint8Array(3_000_000).fill(k), 0xff, 0xd9]);
    const scan = pdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      `<< /Type /Pages /Kids [${Array.from({ length: 5 }, (_, i) => `${3 + i * 3} 0 R`).join(" ")}] /Count 5 >>`,
      ...Array.from({ length: 5 }, (_, i) => [
        `<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im0 ${5 + i * 3} 0 R >> >> /Contents ${4 + i * 3} 0 R >>`,
        flate("q 595 0 0 842 0 0 cm /Im0 Do Q"),
        {
          dict: "/Type /XObject /Subtype /Image /Width 10 /Height 10 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode",
          data: jpeg(i + 1),
        },
      ]).flat(),
    ]);
    t = cpu();
    const s = readFile("escaneo.pdf", "application/pdf", scan);
    const scanMs = cpu() - t;
    expect(s.images.length).toBe(5);
    expect(s.images.every((i) => i.data.byteLength === 3_000_006)).toBe(true);
    console.log(
      `A-15: ${N} pages of text ${textMs.toFixed(0)} ms; a 15 MB scan ${scanMs.toFixed(0)} ms`,
    );
    expect(textMs).toBeLessThan(800);
    expect(scanMs).toBeLessThan(800);
  }, 120_000);

  it("a mail's PDF attachment gives its text too", () => {
    expect(
      attachmentText({ name: "Factura.PDF", type: "application/pdf", content: INVOICE }),
    ).toContain("Total: 1.234,56 €");
  });
});
