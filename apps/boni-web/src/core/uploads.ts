/**
 * Files dropped on Boni's window (docs/sistema.md §4.7, A-24): each goes up the moment it is dropped, its chip showing
 * how much has gone, and once the server has it, it is a chip of the draft like anything pointed at (a row of his
 * files, `{kind: "row"}`), with a word when a reader will not get its contents. One list per conversation, as drafts.
 * A file past the cap is never sent: its chip says so.
 */
import type { Pointed } from "./pointing.ts";

/** The most a dropped file may weigh (the server's MAX_UPLOAD_BYTES; the desktop's uploads.cjs). */
export const MAX_DROP_BYTES = 1_000_000_000;

/** A file going up, or one that could not: "too-big" (refused here or by the server), "failed" (anything else). */
export interface Upload {
  key: string;
  name: string;
  size: number;
  sent: number;
  state: "uploading" | "too-big" | "failed";
}
/** The uploads, by conversation id (`"new"` for the one not made yet, as drafts). */
export type Uploads = Readonly<Record<string, readonly Upload[]>>;

/** What a host answers to an upload: the server's answer, or why it never got one. */
export type UploadAnswer =
  | { status: number; body: string }
  | { error: "too-big" | "unreadable" | "bad-name" | "offline" };

/** The word a dropped file's chip shows when a reader will not get it (the server's `state`): none when it will. */
export type FileWord = "too-big" | "unreadable";

const keyOf = (conversation: string | null) => conversation ?? "new";

/** The same empty list for every conversation without uploads (a selector must not make a new one each time). */
const NONE: readonly Upload[] = Object.freeze([]);
export const uploadsIn = (u: Uploads, conversation: string | null): readonly Upload[] =>
  u[keyOf(conversation)] ?? NONE;

/** The uploads with one conversation's changed; an empty list is none. */
export function withUploads(
  u: Uploads,
  conversation: string | null,
  change: (l: readonly Upload[]) => readonly Upload[],
): Uploads {
  const k = keyOf(conversation);
  const next = change(u[k] ?? []);
  const { [k]: _was, ...rest } = u;
  return next.length ? { ...rest, [k]: next } : rest;
}

/** A file just dropped: going up, or refused at once when it is past the cap or empty. */
export function dropped(key: string, file: { name: string; size: number }): Upload {
  return {
    key,
    name: file.name,
    size: file.size,
    sent: 0,
    state: file.size > MAX_DROP_BYTES ? "too-big" : file.size === 0 ? "failed" : "uploading",
  };
}

/** How much has gone, in whole percent (never 100 until the server has answered). */
export const percent = (u: Upload): number =>
  u.size ? Math.min(99, Math.floor((u.sent * 100) / u.size)) : 0;

/** A file's name as the upload's query: every character but letters, digits and `-_.` escaped (the shells allow these). */
export const queryName = (name: string): string =>
  encodeURIComponent(name).replace(
    /[!'()*~]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** The path the browser's upload goes to, or null when the name is not one a file may have (as the server says). */
export function uploadPath(name: string): string | null {
  const n = name.trim();
  if (!n || n.length > 200 || /[/\\\0]/.test(n) || n.startsWith(".")) return null;
  return `api/data/files/upload?name=${queryName(n)}`;
}

/** What an upload ended in: the chip of the draft (the row the server made), or the word of a failed one. */
export function uploadEnd(a: UploadAnswer): { chip: Pointed } | { state: "too-big" | "failed" } {
  if ("error" in a) return { state: a.error === "too-big" ? "too-big" : "failed" };
  if (a.status === 413) return { state: "too-big" };
  if (a.status !== 200) return { state: "failed" };
  let x: unknown;
  try {
    x = JSON.parse(a.body);
  } catch {
    return { state: "failed" };
  }
  const r = x as { id?: unknown; name?: unknown; state?: unknown } | null;
  if (!r || typeof r.id !== "string" || !r.id || r.id.length > 80 || typeof r.name !== "string")
    return { state: "failed" };
  const word = r.state === "too-big" || r.state === "unreadable" ? r.state : undefined;
  return {
    chip: {
      ref: { kind: "row", id: r.id },
      title: r.name.slice(0, 120),
      ...(word ? { file: word } : { file: "read" }),
    },
  };
}
