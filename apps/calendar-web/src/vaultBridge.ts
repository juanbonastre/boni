import { getHost } from "./host.ts";

/**
 * The notes of the vault, as the host provides them: the desktop shell exposes this as
 * `window.boniVault` (absent in a plain browser); another host passes its own (see `host.ts`).
 */
export type VaultResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

export interface NoteStat {
  path: string;
  mtimeMs: number;
  size: number;
}

export interface VaultBridge {
  getRoot(): Promise<VaultResult<string | null>>;
  /** Opens a folder picker; resolves to the chosen root, or null when cancelled. */
  chooseRoot(): Promise<VaultResult<string | null>>;
  scan(dir: string): Promise<VaultResult<NoteStat[]>>;
  read(path: string): Promise<VaultResult<{ text: string; mtimeMs: number }>>;
  /** `conflict: true` means the note changed since `expectedMtimeMs` and nothing was written. */
  write(
    path: string,
    text: string,
    expectedMtimeMs: number | null,
  ): Promise<VaultResult<{ conflict: boolean; mtimeMs: number; size: number }>>;
  /** `exists: true` means a note with that path is already there and nothing was written. */
  create(
    path: string,
    text: string,
  ): Promise<VaultResult<{ exists: true } | { exists: false; mtimeMs: number; size: number }>>;
  /** Moves a note (to another folder); `exists: true` means the target is taken and nothing moved. */
  rename?(
    from: string,
    to: string,
  ): Promise<VaultResult<{ exists: true } | { exists: false; mtimeMs: number; size: number }>>;
  /** Sends a note to the system trash. */
  trash?(path: string): Promise<VaultResult<null>>;
  /**
   * Opens a note: in Boni (the desktop app, a `boni://` link; `peek`: in its small window instead of the main one)
   * or in Obsidian (`noteApp` says which).
   */
  openNote?(path: string, opts?: { peek?: boolean }): Promise<VaultResult<null>>;
  /**
   * Opens a proposal waiting in Boni's inbox (a `ghost:` row drawn in the calendar) in Boni's peek, where it is
   * accepted or rejected (plan b2). Only where Boni opens notes (`noteApp: "boni"`).
   */
  openProposal?(id: string): Promise<VaultResult<null>>;
  /** Where `openNote` opens a note; Obsidian when not said. */
  noteApp?: "boni" | "obsidian";
  /** Starts watching these folders (replacing any earlier set); `onChanged` fires after a burst of changes. */
  watch?(dirs: string[]): Promise<VaultResult<null>>;
  onChanged?(callback: () => void): () => void;
  /** The saved index of parsed notes (kept outside the vault), or null on a cold start. */
  cacheRead?(): Promise<VaultResult<string | null>>;
  cacheWrite?(text: string): Promise<VaultResult<null>>;
}

export function vaultBridge(): VaultBridge | null {
  return getHost().vault;
}
