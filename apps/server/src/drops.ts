/**
 * A file Juan drops on Boni's window (docs/sistema.md §4.7, A-24): taken as it arrives, a part at a time, into his
 * store (never whole in memory: a file may be 1 GB and the server has 384 MB), and kept as a row of his files in a
 * folder by month, whether or not the message it was dropped on is sent.
 */
import type { IncomingMessage } from "node:http";
import { MAX_UPLOAD_BYTES, StoreError, type UserStore } from "@boni/store";
import { createRow } from "./data.ts";
import { type FileState, fileState } from "./fileReading.ts";
import { filesType } from "./mail.ts";
import { FILE_FIELD, FOLDER_FIELD, mimeOf } from "./paths.ts";

/** The folder of the files dropped in a conversation, by month (as a mail's are under «correo/»). */
export const DROP_FOLDER = "conversación";

export interface Dropped {
  /** The row of his files the drop made. */
  id: string;
  name: string;
  type: string;
  mime: string;
  size: number;
  folder: string;
  /** What a reader will get of it, the chip's word. */
  state: FileState;
}
export type DropRefused = { status: number; error: string };

/** Whether a reader may be given the files of this collection: only when it is open to the AI whole (A-24). */
export function dropsReadable(store: UserStore, type: string): boolean {
  return (store.aiAccess()[type] ?? "visible") === "visible";
}

/** A name a file may have: one name, no folder, not hidden. */
export function dropName(raw: string | null): string | null {
  const name = (raw ?? "").trim();
  if (!name || name.length > 200 || /[/\\\0]/.test(name) || name.startsWith(".")) return null;
  return name;
}

/**
 * Takes the request's body as the file `name`, streamed into the store; refused before anything is read when it
 * says it is bigger than the cap, and stopped (what came dropped) when it grows past it.
 */
export async function receiveDrop(
  store: UserStore,
  req: IncomingMessage,
  rawName: string | null,
  device: string | undefined,
  now: number,
): Promise<Dropped | DropRefused> {
  const name = dropName(rawName);
  if (!name) return { status: 400, error: "bad-name" };
  const def = filesType(store);
  if (!def) return { status: 409, error: "no-files" };
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES)
    return { status: 413, error: "too-big" };
  const mime = mimeOf(name);
  const w = store.fileWriter(mime, MAX_UPLOAD_BYTES);
  try {
    for await (const chunk of req) w.write(chunk as Buffer);
  } catch (e) {
    w.abort();
    if (e instanceof StoreError && e.code === "too-big") return { status: 413, error: "too-big" };
    // The device went away mid-file: nothing of it is kept.
    if (req.destroyed || (e as { code?: string }).code === "ECONNRESET")
      return { status: 400, error: "aborted" };
    throw e;
  }
  if (!w.size) {
    w.abort();
    return { status: 400, error: "empty" };
  }
  const size = w.size;
  const sha = w.finish();
  const folder = `${DROP_FOLDER}/${new Date(now).toISOString().slice(0, 7)}`;
  const taken = new Set(
    store
      .entities(def.id)
      .filter((e) => e.values[FOLDER_FIELD] === folder)
      .map((e) => String(e.values[def.titleField] ?? "")),
  );
  const dot = name.lastIndexOf(".");
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  let unique = name;
  for (let n = 2; taken.has(unique); n++) unique = `${base} (${n})${ext}`;
  const row = createRow(
    store,
    def.id,
    { [def.titleField]: unique, [FILE_FIELD]: sha, [FOLDER_FIELD]: folder },
    device,
  );
  // A collection not open to the AI whole keeps the file; no reader is given it (files.read refuses it too).
  const state = dropsReadable(store, def.id) ? fileState(unique, mime, size) : "unreadable";
  return { id: row.id, name: unique, type: def.id, mime, size, folder, state };
}
