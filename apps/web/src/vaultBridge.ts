/** The vault bridge the desktop shell exposes as `window.boniVault` (absent in a plain browser). */
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
  ): Promise<VaultResult<{ conflict: boolean; mtimeMs: number }>>;
  /** `exists: true` means a note with that path is already there and nothing was written. */
  create(
    path: string,
    text: string,
  ): Promise<VaultResult<{ exists: true } | { exists: false; mtimeMs: number }>>;
}

export function vaultBridge(): VaultBridge | null {
  return (window as unknown as { boniVault?: VaultBridge }).boniVault ?? null;
}
