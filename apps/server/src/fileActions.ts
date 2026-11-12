/**
 * Reading a file Juan dropped on Boni's window (docs/sistema.md §4.7, A-24): `files.read`, the action of the one list
 * that gives a reader a file's text, or its images to a model that sees them. Only a file on his screen (the chip he
 * dropped, or one he points at), in his own turn, of his files when they are open to the AI whole (P23); what it reads
 * is outside text (data for the reader, never instructions) and never reaches the planner.
 */
import {
  codeLabel,
  leaf,
  list,
  readStore,
  rec,
  ToolError,
  type ToolRegistry,
  type Val,
} from "@boni/agent";
import { join, type Label, label } from "@boni/entities";
import type { UserStore } from "@boni/store";
import { dropsReadable } from "./drops.ts";
import {
  type FileReading,
  type FileState,
  fileState,
  IMAGE_MAX,
  IMAGE_TYPES,
  READ_MAX,
  readFile,
} from "./fileReading.ts";
import { filesType } from "./mail.ts";
import { FILE_FIELD, FOLDER_FIELD } from "./paths.ts";

/** What the server gives `files.read` for its run (`ToolDef.service` "files"). */
export interface FilesService {
  /** A row of his files read for a reader; refused when it is not one, or its collection is not open whole. */
  read(row: string): FileRead;
}
export interface FileRead {
  sha: string;
  name: string;
  mime: string;
  size: number;
  folder: string;
  state: FileState;
  /** The text read (a PDF's, a sheet's rows, a text file), capped; empty when there is none. */
  text: string;
  cut: boolean;
  pages: number | null;
  /** The images a seeing model may be shown, by reference (`sha` or `sha#n`, a scan's n-th page). */
  images: string[];
  /** The row's own label (its sensitivity, where it came from). */
  label: Label;
}

const SHA = /^[0-9a-f]{64}$/;

/**
 * The last scanned PDF read, by store: its pages' images, so that showing them to a reader (one `imageOf` a page,
 * five at most) does not parse the PDF again each time (up to 20 MB, on the event loop). Only the last one is kept.
 */
const lastScan = new WeakMap<UserStore, { sha: string; images: FileReading["images"] }>();
function scanned(store: UserStore, sha: string, read: () => FileReading | null) {
  const kept = lastScan.get(store);
  if (kept?.sha === sha) return kept.images;
  const r = read();
  if (!r) return [];
  lastScan.set(store, { sha, images: r.images });
  return r.images;
}
/** A file's facts and what can be read of it, from the row's id; null when it is not one of his files. */
function fileRow(store: UserStore, row: string) {
  const def = filesType(store);
  const s = store.get(row);
  if (!def || !s || s.entity.deleted !== undefined || s.entity.type !== def.id) return null;
  const sha = s.entity.values[FILE_FIELD];
  const info = typeof sha === "string" && SHA.test(sha) ? store.fileInfo(sha) : null;
  if (!info || typeof sha !== "string") return null;
  return {
    def,
    entity: s,
    sha,
    info,
    name: String(s.entity.values[def.titleField] ?? ""),
    folder: String(s.entity.values[FOLDER_FIELD] ?? ""),
  };
}

/** The files' service for one account: the same checks the screen's facts and the image loader make. */
export function filesService(store: UserStore): FilesService {
  return {
    read(row) {
      const f = fileRow(store, row);
      if (!f) throw new ToolError("not-a-file");
      // The models' own view of it: a collection closed, opaque or a rule keeping the row from them gives nothing.
      const seen = readStore(store).get(row);
      if (
        !seen ||
        !dropsReadable(store, f.def.id) ||
        Object.values(seen.labels).some((l) => l.noModel)
      )
        throw new ToolError("file-closed");
      const rowLabel = join(
        f.def.label,
        ...[f.def.titleField, FILE_FIELD].map((k) => seen.labels[k]).filter((l): l is Label => !!l),
      );
      const state = fileState(f.name, f.info.mime, f.info.size);
      const out: FileRead = {
        sha: f.sha,
        name: f.name,
        mime: f.info.mime,
        size: f.info.size,
        folder: f.folder,
        state,
        text: "",
        cut: false,
        pages: null,
        images: [],
        label: rowLabel,
      };
      if (state !== "text" && state !== "image") return out;
      const bytes = store.getFile(f.sha)?.data;
      if (!bytes) return out;
      const r = readFile(f.name, f.info.mime, bytes);
      if (!IMAGE_TYPES.has(f.info.mime) && r.images.length)
        lastScan.set(store, { sha: f.sha, images: r.images });
      return {
        ...out,
        state: r.state,
        text: r.text,
        cut: r.cut,
        pages: r.pages ?? null,
        images: IMAGE_TYPES.has(f.info.mime)
          ? r.images.length
            ? [f.sha]
            : []
          : r.images.map((_, n) => `${f.sha}#${n}`),
      };
    },
  };
}

/**
 * The image a reference names, for a seeing model (the agent's `image` option): a photo of his files as it is, or the
 * n-th image of a scanned PDF; nothing past the caps (IMAGE_MAX, READ_MAX) or of a type the APIs do not take.
 */
export function imageOf(store: UserStore, ref: string): { mime: string; data: Uint8Array } | null {
  const m = /^([0-9a-f]{64})(?:#(\d{1,3}))?$/.exec(ref);
  if (!m) return null;
  const sha = m[1] as string;
  const info = store.fileInfo(sha);
  if (!info) return null;
  if (m[2] === undefined) {
    if (!IMAGE_TYPES.has(info.mime) || info.size > IMAGE_MAX) return null;
    const f = store.getFile(sha);
    return f ? { mime: info.mime, data: f.data } : null;
  }
  if (info.mime !== "application/pdf" || info.size > READ_MAX) return null;
  const img = scanned(store, sha, () => {
    const f = store.getFile(sha);
    return f ? readFile("scan.pdf", info.mime, f.data) : null;
  })[Number(m[2])];
  return img ? { mime: img.mime, data: img.data } : null;
}

/**
 * The file's facts for the screen (its chip, a row of his files pointed at): name, type, size, folder and what a
 * reader would get, as code's facts; null when the row is not one of his files.
 */
export function fileFacts(store: UserStore, row: string): Record<string, Val> | null {
  const f = fileRow(store, row);
  if (!f) return null;
  const code = codeLabel("screen");
  return {
    file: rec(
      {
        mime: leaf(f.info.mime, code),
        size: leaf(f.info.size, code),
        folder: leaf(f.folder, f.entity.labels[FOLDER_FIELD] ?? code),
        state: leaf(
          dropsReadable(store, f.def.id)
            ? fileState(f.name, f.info.mime, f.info.size)
            : "unreadable",
          code,
        ),
      },
      code,
    ),
  };
}

const serviceOf = (s: unknown): FilesService => {
  if (!s || typeof s !== "object" || !("read" in s)) throw new ToolError("not-available");
  return s as FilesService;
};
const code = codeLabel("files");
/** A row of his files from the screen: the screen's own place (`at`), never an id a model or a mail wrote. */
const rowOf = (v: Val | undefined): string => {
  const at = v?.t === "rec" ? v.fields.at : undefined;
  if (
    at?.t !== "v" ||
    at.label.integrity !== "own" ||
    typeof at.value !== "string" ||
    !at.value.startsWith("row:")
  )
    throw new ToolError("file-not-on-screen");
  return at.value.slice(4);
};

/** The files' action of the one list (docs/sistema.md §4.1, §4.7). */
export function withFileActions(r: ToolRegistry): ToolRegistry {
  r.register({
    name: "files.read",
    icon: "Paperclip",
    effect: "read",
    area: "data",
    service: "files",
    sees: true,
    title: "Leer archivo",
    describe:
      'Read a file the user dropped on the conversation or points at (a value of "screen" whose "file" says its type, size and state), to answer what he asks of it: give the result to a reader (answer_about) with his question. Its "text" is the file\'s text (a PDF, a sheet, a text file); "images" the photo or a scan\'s pages, which the reader sees. state "too-big" or "unreadable": only its name, type and size are there',
    args: {
      file: {
        role: "target",
        required: true,
        describe: 'the file, as "screen" gave it, whole',
      },
    },
    run(c, a) {
      const f = serviceOf(c.service).read(rowOf(a.file));
      // What the file says is from outside, as a mail's words: the reader reads it as data.
      const outside = join(
        f.label,
        label("external", f.label.sensitivity === "public" ? "personal" : f.label.sensitivity, [
          { kind: "file", id: f.sha },
        ]),
      );
      return rec(
        {
          name: leaf(f.name, f.label),
          mime: leaf(f.mime, code),
          size: leaf(f.size, code),
          folder: leaf(f.folder, f.label),
          state: leaf(f.state, code),
          text: leaf(f.text, outside),
          cut: leaf(f.cut, code),
          pages: leaf(f.pages, code),
          // Its images are what the file says, as its text: they carry its label to the reader (A-24).
          images: list(
            f.images.map((ref) => rec({ image: leaf(ref, outside) }, outside)),
            outside,
          ),
        },
        code,
      );
    },
  });
  return r;
}
