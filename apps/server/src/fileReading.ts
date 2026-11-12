/**
 * What code reads of a file for a reader (docs/sistema.md §4.7, docs/correo.md §4.6; A-24): a sheet's rows, a text
 * file, a PDF's text, or the image itself (a photo, a scan's pages). One reader for a mail's attachments and for a
 * file Juan drops on Boni's window. Each cap is here, and each says what the reading left out.
 */
import { readRows } from "./money/sheets.ts";
import { readPdf } from "./pdf.ts";

/** Text handed to a reader of one file, at most (as of a mail's attachments together). */
export const TEXT_MAX = 50_000;
/** Bytes of a file opened to be read, at most: a bigger one stays a reference (its name, type, size and folder). */
export const READ_MAX = 20_000_000;
/** One image shown to a model, at most (the Anthropic API's own limit); a bigger photo stays a reference. */
export const IMAGE_MAX = 5_000_000;
/** The images a model is shown: what the APIs take. A HEIC photo, a TIFF, stay references. */
export const IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
/** Rows of a sheet read, at most. */
export const ROWS_MAX = 2000;
/**
 * What a reader gets of a file, as a word the chip says: its text, its image, or only the file (too big to read,
 * or of a kind code does not read).
 */
export type FileState = "text" | "image" | "too-big" | "unreadable";

const SHEET = /\.(csv|xlsx|xls)$/;
const TEXT = /\.(txt|md)$/;
const isPdf = (name: string, mime: string) => mime === "application/pdf" || /\.pdf$/.test(name);

/** What a file will give a reader, from its name, type and size, before reading it (the chip says it at once). */
export function fileState(name: string, mime: string, size: number): FileState {
  const n = name.toLowerCase();
  if (IMAGE_TYPES.has(mime)) return size > IMAGE_MAX ? "too-big" : "image";
  if (
    !(
      SHEET.test(n) ||
      TEXT.test(n) ||
      mime === "text/csv" ||
      mime === "text/plain" ||
      isPdf(n, mime)
    )
  )
    return "unreadable";
  return size > READ_MAX ? "too-big" : "text";
}

/** A file's reading: the text (cut at `TEXT_MAX`), the images, and whether anything was left out. */
export interface FileReading {
  state: FileState;
  text: string;
  images: { mime: string; data: Uint8Array }[];
  /** Text or pages left out by a cap. */
  cut: boolean;
  pages?: number;
}

/** A PDF whose pages say almost nothing is a scan: its pages' images are what can be read. */
const SCAN_CHARS_PER_PAGE = 20;

/** What code reads of a file's bytes. */
export function readFile(name: string, mime: string, bytes: Uint8Array): FileReading {
  const nothing = (state: FileState): FileReading => ({ state, text: "", images: [], cut: false });
  const before = fileState(name, mime, bytes.byteLength);
  if (before !== "text" && before !== "image") return nothing(before);
  if (before === "image") return { ...nothing("image"), images: [{ mime, data: bytes }] };
  const n = name.toLowerCase();
  if (isPdf(n, mime)) {
    const p = readPdf(bytes);
    const scan = p.text.replace(/\s+/g, "").length < SCAN_CHARS_PER_PAGE * Math.max(1, p.pages);
    const images = scan
      ? p.images
          .filter((d) => d.byteLength <= IMAGE_MAX)
          .map((data) => ({ mime: "image/jpeg", data }))
      : [];
    if (!p.text.trim() && !images.length) return { ...nothing("unreadable"), pages: p.pages };
    return {
      state: p.text.trim() && !scan ? "text" : images.length ? "image" : "text",
      text: p.text.slice(0, TEXT_MAX),
      images,
      cut: p.cut || p.text.length > TEXT_MAX,
      pages: p.pages,
    };
  }
  const text = attachmentText({ name, type: mime, content: bytes });
  if (!text.trim()) return nothing("unreadable");
  return { state: "text", text: text.slice(0, TEXT_MAX), images: [], cut: text.length > TEXT_MAX };
}

/**
 * What the code reads of an attachment for the reader: a sheet's rows (csv, xlsx, xls), a text file or a PDF's
 * text; else nothing.
 */
export function attachmentText(a: { name: string; type: string; content?: Uint8Array }): string {
  if (!a.content) return "";
  const name = a.name.toLowerCase();
  try {
    if (SHEET.test(name) || a.type === "text/csv")
      return readRows(a.content, name.endsWith(".csv") || a.type === "text/csv" ? "x.csv" : name)
        .slice(0, ROWS_MAX)
        .map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c))).join("\t"))
        .join("\n");
    if (TEXT.test(name) || a.type === "text/plain")
      return new TextDecoder("utf-8").decode(a.content);
    if (isPdf(name, a.type) && a.content.byteLength <= READ_MAX) return readPdf(a.content).text;
  } catch {
    // an attachment the reader cannot parse: its name is still in the mail
  }
  return "";
}
