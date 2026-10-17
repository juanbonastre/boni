import { createRequire } from "node:module";
import type { CollectionSnapshot, Row } from "@boni-calendar/core";
import type { VaultIndex } from "@boni-calendar/web/src/vault/index.ts";
import { type IgnoredNote, loadVault } from "@boni-calendar/web/src/vault/loadVault.ts";
import type { VaultBridge, VaultResult } from "@boni-calendar/web/src/vaultBridge.ts";

/**
 * The vault access of the desktop shell, reused as is: confined to the vault, never `private/` or
 * `restricted/`, atomic writes with a conflict check, a recursive watcher. Deleted notes go to the
 * vault's own `.trash` (there is no system trash on a server).
 */
const require = createRequire(import.meta.url);
const { openVault } = require("../../desktop-electron/vault-fs.cjs") as {
  openVault: (root: string) => VaultFs;
};

interface VaultFs {
  root: string;
  scan(dir: string): unknown;
  read(path: string): unknown;
  write(path: string, text: string, expected: number | null): unknown;
  create(path: string, text: string): unknown;
  rename(from: string, to: string): unknown;
  trash(path: string): Promise<void>;
  watch(dirs: string[], onChange: () => void, delayMs?: number): () => void;
}

/** vault-fs throws; the calendar's loader wants `{ ok, value }` results like the desktop IPC gives. */
function bridgeOver(fs: VaultFs): VaultBridge {
  const wrap = async <T>(fn: () => unknown): Promise<VaultResult<T>> => {
    try {
      return { ok: true, value: (await fn()) as T };
    } catch (e) {
      const err = e as { code?: string; message?: string };
      return { ok: false, code: err.code ?? "error", message: String(err.message ?? e) };
    }
  };
  return {
    getRoot: () => wrap(() => fs.root),
    chooseRoot: () => wrap(() => fs.root),
    scan: (dir) => wrap(() => fs.scan(dir)),
    read: (path) => wrap(() => fs.read(path)),
    write: (path, text, expected) => wrap(() => fs.write(path, text, expected)),
    create: (path, text) => wrap(() => fs.create(path, text)),
    rename: (from, to) => wrap(() => fs.rename(from, to)),
    trash: (path) =>
      wrap(async () => {
        await fs.trash(path);
        return null;
      }),
  };
}

/** What a client needs to show the calendar: definitions, rows and what could not be placed. */
export interface Snapshot extends CollectionSnapshot {
  version: number;
  ignored: IgnoredNote[];
  problems: string[];
}

/**
 * What changed between two versions: rows added or changed, rows gone. `full` when the definitions
 * changed (or the version is too old to know): the client takes a new snapshot instead.
 */
export interface Changes {
  version: number;
  full?: boolean;
  upserts: Row[];
  removes: string[];
}

const KEEP = 500;

/**
 * One vault on the server: read once, then kept current by its watcher. Unchanged notes keep their
 * very same row object (the loader's index), so what changed is found by comparing row identity.
 */
export class VaultService {
  readonly bridge: VaultBridge;
  private fs: VaultFs;
  private index: VaultIndex = new Map();
  private rows = new Map<string, Row>();
  private defsKey = "";
  private current: Snapshot | null = null;
  private log: { version: number; upserts: Row[]; removes: string[]; full: boolean }[] = [];
  private version = 0;
  private stopWatch: (() => void) | null = null;
  private watched = "";
  private running: Promise<void> | null = null;
  private again = false;
  private listeners = new Set<(c: Changes) => void>();

  constructor(root: string) {
    this.fs = openVault(root);
    this.bridge = bridgeOver(this.fs);
  }

  /** The calendar as it is now (reads the vault the first time). */
  async snapshot(): Promise<Snapshot> {
    if (!this.current) await this.refresh();
    return this.current as Snapshot;
  }

  /** What changed after `since`; `full` when the client must take a new snapshot. */
  changes(since: number): Changes {
    if (since === this.version) return { version: this.version, upserts: [], removes: [] };
    const after = this.log.filter((c) => c.version > since);
    if (
      since > this.version ||
      after.length === 0 ||
      after[0]?.version !== since + 1 ||
      after.some((c) => c.full)
    ) {
      return { version: this.version, full: true, upserts: [], removes: [] };
    }
    const up = new Map<string, Row>();
    const gone = new Set<string>();
    for (const c of after) {
      for (const r of c.upserts) {
        up.set(r.id, r);
        gone.delete(r.id);
      }
      for (const id of c.removes) {
        up.delete(id);
        gone.add(id);
      }
    }
    return { version: this.version, upserts: [...up.values()], removes: [...gone] };
  }

  /** Called with every new version (live updates). Returns the function that stops it. */
  subscribe(fn: (c: Changes) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Reads the vault again (only changed notes are read); one refresh at a time, none lost. */
  refresh(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.readOnce();
      } while (this.again);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async readOnce(): Promise<void> {
    const r = await loadVault(this.bridge, { readOnly: true }, this.index);
    this.index = r.index;
    const defsKey = JSON.stringify([r.snapshot.collections, r.snapshot.views, r.snapshot.accounts]);
    const next = new Map(r.snapshot.rows.map((row) => [row.id, row]));
    const upserts = r.snapshot.rows.filter((row) => this.rows.get(row.id) !== row);
    const removes = [...this.rows.keys()].filter((id) => !next.has(id));
    const full = this.current !== null && defsKey !== this.defsKey;
    const changed = this.current === null || full || upserts.length > 0 || removes.length > 0;
    this.rows = next;
    this.defsKey = defsKey;
    if (changed) this.version++;
    this.current = {
      ...r.snapshot,
      version: this.version,
      ignored: r.ignored,
      problems: r.problems,
    };
    const key = r.folders.join("\n");
    if (key !== this.watched) {
      this.watched = key;
      this.stopWatch?.();
      this.stopWatch = this.fs.watch(r.folders, () => void this.refresh());
    }
    if (!changed || this.version === 1) return;
    this.log.push({ version: this.version, upserts, removes, full });
    if (this.log.length > KEEP) this.log.shift();
    const c: Changes = full
      ? { version: this.version, full: true, upserts: [], removes: [] }
      : { version: this.version, upserts, removes };
    for (const l of this.listeners) l(c);
  }

  close(): void {
    this.stopWatch?.();
    this.stopWatch = null;
    this.listeners.clear();
  }
}

/** One service per vault folder, shared by the users of that vault. */
export class Vaults {
  private byRoot = new Map<string, VaultService>();
  get(root: string): VaultService {
    let v = this.byRoot.get(root);
    if (!v) {
      v = new VaultService(root);
      this.byRoot.set(root, v);
    }
    return v;
  }
  close(): void {
    for (const v of this.byRoot.values()) v.close();
    this.byRoot.clear();
  }
}
