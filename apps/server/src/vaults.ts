import { createRequire } from "node:module";
import {
  type CalEvent,
  type CollectionProvider,
  type CollectionSnapshot,
  diffRows,
  extendSeries,
  makeModel,
  type Row,
  type RowChange,
  reconcileRows,
  rowToEvent,
  systemTimeZone,
  todayIn,
} from "@boni/calendar";
import { patchCollectionReminders } from "@boni/calendar-web/src/vault/definitions.ts";
import type { IgnoredNote } from "@boni/calendar-web/src/vault/loadVault.ts";
import { makeVaultProvider, VaultWriteError } from "@boni/calendar-web/src/vault/provider.ts";
import { aliases, readVault, withLock } from "@boni/calendar-web/src/vault/sync.ts";
import type { VaultBridge, VaultResult } from "@boni/calendar-web/src/vaultBridge.ts";

/**
 * The vault access of the desktop shell, reused as is: confined to the vault, never `private/` or
 * `restricted/`, atomic writes with a conflict check, a recursive watcher. Deleted notes go to the
 * vault's own `.trash` (there is no system trash on a server).
 */
const require = createRequire(import.meta.url);
const { openVault } = require("../../calendar-desktop/vault-fs.cjs") as {
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

/** What a write through the server came to. */
export type ApplyResult =
  | { ok: true; version: number; aliases: Record<string, string> }
  | { ok: false; conflict: string[] };

/**
 * One vault on the server: read once, then kept current by its watcher. Unchanged notes keep their
 * very same row object (the loader's index), so what changed is found by comparing row identity.
 */
export class VaultService {
  readonly bridge: VaultBridge;
  private fs: VaultFs;
  private readonly write: boolean;
  private provider: CollectionProvider | null = null;
  /** The version each row last changed in, and which session changed it (null: outside the server). */
  private changedAt = new Map<string, { version: number; by: string | null }>();
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
  private topUpTimer: ReturnType<typeof setTimeout> | null = null;
  private daily: ReturnType<typeof setInterval> | null = null;

  constructor(root: string, opts: { write?: boolean } = {}) {
    this.fs = openVault(root);
    this.bridge = bridgeOver(this.fs);
    this.write = !!opts.write;
    if (this.write) {
      // Series keep going as time passes, also on days nothing changes in the vault.
      this.daily = setInterval(() => this.scheduleTopUp(), 6 * 3_600_000);
      this.daily.unref?.();
    }
  }

  /**
   * Open-ended series kept as separate notes get the notes they are missing, up to the apps' horizon
   * (the same rule as the desktop app with a vault folder: never refilling gaps). Done here once for
   * every device, so phones and browsers in server mode do not have to (and two of them never make the
   * same notes). Returns how many notes were made.
   */
  async topUpSeries(): Promise<number> {
    if (!this.write) return 0;
    const snap = await this.snapshot();
    const tz = systemTimeZone();
    const model = makeModel(snap.collections, snap.views, { defaultTz: tz });
    const events: CalEvent[] = [];
    for (const row of snap.rows) {
      const ev = rowToEvent(model, row);
      if (ev) events.push(ev);
    }
    const now = Date.now();
    const more = extendSeries(events, {
      newId: () => `ev-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      now,
      today: todayIn(tz, now),
    });
    if (more.length === 0) return 0;
    const rows = reconcileRows(model, snap.rows, events, [...events, ...more]);
    this.provider ??= makeVaultProvider(this.bridge);
    await this.provider.apply(diffRows(snap.rows, rows));
    await this.refresh();
    return more.length;
  }

  private scheduleTopUp(): void {
    if (!this.write || this.topUpTimer) return;
    this.topUpTimer = setTimeout(() => {
      this.topUpTimer = null;
      this.topUpSeries().catch((e) => console.warn("series", e instanceof Error ? e.message : e));
    }, 2000);
    this.topUpTimer.unref?.();
  }

  get writable(): boolean {
    return this.write;
  }

  /**
   * Writes a device's row changes to the notes, with the apps' writer (only edited properties, new
   * notes named from the definition, moves, trash; never over a note that changed on disk). `base` is
   * the version the device had: a row that changed after it, by someone else (Obsidian, another
   * device), is a conflict and nothing is written. New rows come back with their note path (`aliases`).
   */
  async apply(base: number, changes: readonly RowChange[], who: string): Promise<ApplyResult> {
    if (!this.write) throw new Error("This server does not write to the vault (BONI_WRITE)");
    await this.refresh();
    const idOf = (c: RowChange) => (c.op === "upsert" ? c.row.id : c.id);
    const pathOf = (id: string) => aliases.get(id) ?? id;
    const conflict = changes.map(idOf).filter((id) => {
      const c = this.changedAt.get(pathOf(id));
      return !!c && c.version > base && c.by !== who;
    });
    if (conflict.length > 0) return { ok: false, conflict: [...new Set(conflict)] };
    this.provider ??= makeVaultProvider(this.bridge);
    try {
      await this.provider.apply(changes);
    } catch (e) {
      if (e instanceof VaultWriteError && e.kind === "conflict")
        return { ok: false, conflict: [e.message] };
      throw e;
    }
    await this.refresh();
    const out: Record<string, string> = {};
    for (const id of changes.map(idOf)) {
      const path = pathOf(id);
      if (path !== id) out[id] = path;
      // What this device just wrote is not a conflict for its next write.
      const c = this.changedAt.get(path);
      if (c) c.by = who;
    }
    return { ok: true, version: this.version, aliases: out };
  }

  /**
   * Changes a calendar's reminders in its definition note (phase 5), with the apps' writer: its defaults
   * (`null`: none) and, if asked, the column for an event's own reminders. Devices get the new definition
   * through the stream (a definition change asks them for a new snapshot).
   */
  async setReminders(
    collectionId: string,
    edit: { reminders?: { timed: string; allDay: string } | null; eventColumn?: boolean },
  ): Promise<"ok" | "conflict"> {
    if (!this.write) throw new Error("This server does not write to the vault (BONI_WRITE)");
    try {
      await patchCollectionReminders(this.bridge, collectionId, edit);
    } catch (e) {
      if (e instanceof VaultWriteError && e.kind === "conflict") return "conflict";
      throw e;
    }
    await this.refresh();
    return "ok";
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
    // The apps' reader, with its index of parsed notes (shared with the writer, under the same lock).
    const r = await withLock(() => readVault(this.bridge, { readOnly: !this.write }));
    const defsKey = JSON.stringify([r.snapshot.collections, r.snapshot.views, r.snapshot.accounts]);
    const next = new Map(r.snapshot.rows.map((row) => [row.id, row]));
    const upserts = r.snapshot.rows.filter((row) => this.rows.get(row.id) !== row);
    const removes = [...this.rows.keys()].filter((id) => !next.has(id));
    const full = this.current !== null && defsKey !== this.defsKey;
    const first = this.current === null;
    const changed = first || full || upserts.length > 0 || removes.length > 0;
    this.rows = next;
    this.defsKey = defsKey;
    // Versions start from the clock, so they keep growing over restarts: a device that had a version
    // of an earlier run is behind (takes a new snapshot), never "ahead" and stuck.
    if (changed) this.version = first ? Math.max(Date.now(), this.version + 1) : this.version + 1;
    if (changed && !first) {
      for (const row of full ? r.snapshot.rows : upserts)
        this.changedAt.set(row.id, { version: this.version, by: null });
      for (const id of removes) this.changedAt.set(id, { version: this.version, by: null });
    }
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
    if (changed) this.scheduleTopUp();
    if (!changed || first) return;
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
    if (this.topUpTimer) clearTimeout(this.topUpTimer);
    if (this.daily) clearInterval(this.daily);
  }
}

/**
 * The vault the server serves, shared by its users. One vault per server for now: the apps' reader and
 * writer keep their index in module state (several vaults per server come with multi-user, phase 6).
 */
export class Vaults {
  private byRoot = new Map<string, VaultService>();
  private readonly opts: { write?: boolean };
  constructor(opts: { write?: boolean } = {}) {
    this.opts = opts;
  }
  /** Whether devices may change notes (BONI_WRITE). */
  get writable(): boolean {
    return this.opts.write === true;
  }
  get(root: string): VaultService {
    let v = this.byRoot.get(root);
    if (!v) {
      if (this.byRoot.size > 0) throw new Error("This server serves a single vault");
      v = new VaultService(root, this.opts);
      this.byRoot.set(root, v);
    }
    return v;
  }
  close(): void {
    for (const v of this.byRoot.values()) v.close();
    this.byRoot.clear();
  }
}
