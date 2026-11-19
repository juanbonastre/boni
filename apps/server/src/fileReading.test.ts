// A mail's attached sheet read in time proportional to its size, within its caps (task 164): invented sheets only.
import { deflateRawSync } from "node:zlib";
import { cpu, under } from "@boni/pace";
import { describe, expect, it } from "vitest";
import { attachmentText, ROWS_MAX, SHEET_READ_MAX } from "./fileReading.ts";
import { InflateCapError, inflateRaw } from "./money/bytes.ts";
import { readRows, SHEET_UNPACKED_MAX } from "./money/sheets.ts";
import { xlsx } from "./money/xlsx.test-util.ts";
import { readPdf } from "./pdf.ts";

/** `f`'s result and this thread's CPU time for it. */
const timed = <T>(f: () => T): [T, number] => {
  const t0 = cpu();
  const out = f();
  return [out, cpu() - t0];
};
const cell = (ref: string, v: string | number, t?: string) =>
  `<c r="${ref}"${t ? ` t="${t}"` : ""}><v>${v}</v></c>`;

// The broken reader took minutes on (a) at a few MB and hung the server; these run in tens of ms. The bounds only
// tell a hang from a pass, orders of magnitude apart.
const COARSE = 5000;

describe("an .xlsx is read in one pass (task 164)", () => {
  it("(a) many self-closing rows and no closing row tag: one empty row each", () => {
    const n = 200_000;
    const raw = xlsx(Array.from({ length: n }, (_x, i) => `<row r="${i + 1}"/>`).join(""));
    const [rows, ms] = timed(() => readRows(raw, "hoja.xlsx"));
    expect(rows).toHaveLength(n);
    expect(rows.every((r) => r.length === 0)).toBe(true);
    under(ms, COARSE, "cpu", "200,000 self-closing rows");
  });

  it("(b) an opening row with no closing tag ends the scan, the rows before it kept", () => {
    const tail = Array.from(
      { length: 100_000 },
      (_x, i) => `<row r="${i + 2}">${cell(`A${i + 2}`, i)}`,
    ).join("");
    const raw = xlsx(`<row r="1">${cell("A1", 7)}</row>${tail}`);
    const [rows, ms] = timed(() => readRows(raw, "hoja.xlsx"));
    expect(rows).toEqual([[7]]);
    under(ms, COARSE, "cpu", "a row left open before a long tail");
  });

  it("(c) a large ordinary sheet: every row and cell as written", () => {
    const n = 20_000;
    const shared = ["Concepto", "Pago con tarjeta", "Transferencia"];
    const body = [
      `<row r="1">${cell("A1", 0, "s")}<c r="B1" t="inlineStr"><is><t>Importe</t></is></c></row>`,
      ...Array.from(
        { length: n - 1 },
        (_x, i) =>
          `<row r="${i + 2}" spans="1:4">${cell(`A${i + 2}`, 1 + (i % 2), "s")}${cell(`B${i + 2}`, -(i + 0.5))}<c r="C${i + 2}" s="1"/>${cell(`D${i + 2}`, 46000 + i)}</row>`,
      ),
    ].join("");
    const [rows, ms] = timed(() => readRows(xlsx(body, shared), "hoja.xlsx"));
    expect(rows).toHaveLength(n);
    expect(rows[0]).toEqual(["Concepto", "Importe"]);
    expect(rows[1]).toEqual(["Pago con tarjeta", -0.5, "", 46000]);
    expect(rows[n - 1]).toEqual([shared[1 + ((n - 2) % 2)], -(n - 2 + 0.5), "", 46000 + n - 2]);
    under(ms, COARSE, "cpu", "20,000 ordinary rows");
  });

  it("a self-closing cell or row is empty, not merged with the next one", () => {
    const raw = xlsx(`<row r="1"/><row r="2"><c r="A2" s="1"/>${cell("B2", 5)}</row>`);
    expect(readRows(raw, "hoja.xlsx")).toEqual([[], ["", 5]]);
  });

  it("(d) an archive that unpacks past the cap throws before it is held whole; attached, it gives nothing", () => {
    const raw = xlsx(`<row r="1">${cell("A1", 1)}</row>${" ".repeat(SHEET_UNPACKED_MAX + 1024)}`);
    expect(raw.byteLength).toBeLessThan(200_000);
    expect(() => readRows(raw, "hoja.xlsx")).toThrow(InflateCapError);
    const attached = xlsx(`<row r="1">${cell("A1", 1)}</row>${" ".repeat(SHEET_READ_MAX + 1024)}`);
    expect(attachmentText({ name: "hoja.xlsx", type: "", content: attached })).toBe("");
    // Under the cap, the same sheet reads.
    const small = xlsx(`<row r="1">${cell("A1", 1)}</row>${" ".repeat(1024)}`);
    expect(attachmentText({ name: "hoja.xlsx", type: "", content: small })).toBe("1");
  });

  it("an attached sheet gives its first ROWS_MAX rows", () => {
    const raw = xlsx(
      Array.from({ length: ROWS_MAX + 50 }, (_x, i) => `<row>${cell(`A${i + 1}`, i)}</row>`).join(
        "",
      ),
    );
    const text = attachmentText({ name: "hoja.xlsx", type: "", content: raw });
    expect(text.split("\n")).toHaveLength(ROWS_MAX);
    const csv = new TextEncoder().encode("a\n".repeat(ROWS_MAX + 50));
    expect(
      attachmentText({ name: "hoja.csv", type: "text/csv", content: csv }).split("\n"),
    ).toHaveLength(ROWS_MAX);
  });

  it("inflating stops at its max", () => {
    const packed = deflateRawSync(Buffer.alloc(1_000_000));
    expect(inflateRaw(packed)).toHaveLength(1_000_000);
    expect(() => inflateRaw(packed, 999_999)).toThrow(InflateCapError);
  });
});

describe("a PDF's objects are found in one pass (task 164)", () => {
  it("a long run of digits", () => {
    const pdf = new TextEncoder().encode(
      `%PDF-1.4\n${"9".repeat(1_000_000)}\n1 0 obj\n<<>>\nendobj\n`,
    );
    const [, ms] = timed(() => readPdf(pdf));
    under(ms, COARSE, "cpu", "a PDF with a million digits in a row");
  });
});
