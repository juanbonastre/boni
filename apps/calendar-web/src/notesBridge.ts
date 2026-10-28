import { getHost } from "./host.ts";

/**
 * Where an event's note opens, as the host provides it: the desktop shell exposes this as `window.boniNotes`
 * (absent in a plain browser and on Android); another host passes its own (see `host.ts`).
 */
export type NotesResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

export interface NotesBridge {
  /**
   * Opens a note: in Boni (the desktop app, a `boni://` link; `peek`: in its small window instead of the main one)
   * or in Obsidian (`noteApp` says which).
   */
  openNote?(path: string, opts?: { peek?: boolean }): Promise<NotesResult<null>>;
  /**
   * Opens a proposal waiting in Boni's inbox (a `ghost:` row drawn in the calendar) in Boni's peek, where it is
   * accepted or rejected (plan b2). Only where Boni opens notes (`noteApp: "boni"`).
   */
  openProposal?(id: string): Promise<NotesResult<null>>;
  /** Where `openNote` opens a note; Obsidian when not said. */
  noteApp?: "boni" | "obsidian";
}

export function notesBridge(): NotesBridge | null {
  return getHost().notes;
}
