import type { NoteStat, VaultBridge, VaultResult } from "@boni-calendar/web/src/vaultBridge.ts";
import type { App, EventRef, TAbstractFile, TFile, TFolder } from "obsidian";

/** Top-level folders the calendar never reads or writes (zones the vault reserves for its owner). */
const DENIED_TOP = new Set(["private", "restricted"]);

/** Where the index of parsed notes is kept on this device (never inside the vault: see cache.ts). */
export interface IndexCache {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
}

class BridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const ok = <T>(value: T): VaultResult<T> => ({ ok: true, value });

/** Runs `task`, turning anything it throws into a failed result (the app never sees an exception). */
async function attempt<T>(task: () => Promise<T> | T): Promise<VaultResult<T>> {
  try {
    return ok(await task());
  } catch (e) {
    const code = e instanceof BridgeError ? e.code : "failed";
    return { ok: false, code, message: e instanceof Error ? e.message : String(e) };
  }
}

const isFolder = (f: TAbstractFile | null): f is TFolder => !!f && "children" in f;
const isFile = (f: TAbstractFile | null): f is TFile => !!f && "stat" in f && "extension" in f;
const isNote = (f: TAbstractFile | null): f is TFile =>
  isFile(f) && f.extension.toLowerCase() === "md";

/** Checks a vault-relative path the app asks for: same rules as the desktop shell (vault-fs.cjs). */
function checkPath(path: string, { markdown = true } = {}): string {
  if (typeof path !== "string" || path === "" || path.startsWith("/") || path.includes("\0")) {
    throw new BridgeError("bad-path", `Bad path: ${path}`);
  }
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (parts.some((p) => p === ".." || p.startsWith("."))) {
    throw new BridgeError("bad-path", `Not allowed: ${path}`);
  }
  if (DENIED_TOP.has(parts[0] ?? "")) throw new BridgeError("denied", `Not allowed: ${path}`);
  if (markdown && !path.toLowerCase().endsWith(".md")) {
    throw new BridgeError("bad-path", `Only Markdown notes: ${path}`);
  }
  return parts.join("/");
}

const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf("/")));

/** True when `path` is a note below one of `dirs` (or was, for a rename). */
function concerns(path: string, dirs: readonly string[]): boolean {
  if (!path.toLowerCase().endsWith(".md")) return false;
  if (path.split("/").some((p) => p.startsWith("."))) return false;
  return dirs.some((d) => path.startsWith(`${d}/`));
}

export interface ObsidianBridge extends Required<VaultBridge> {
  /** Stops listening to the vault (the plugin is unloading). */
  dispose(): void;
}

/**
 * The vault bridge of the Obsidian plugin: the same contract as the desktop shell's
 * `window.boniVault`, over Obsidian's vault API. Writes go through `vault.process` (and never
 * replace a note that changed since it was read), moves through `fileManager.renameFile` (links
 * are updated), deletions through `fileManager.trashFile` (the user's "deleted files" setting
 * decides where they go), and the vault's own events replace the file watcher.
 */
export function obsidianBridge(
  app: App,
  opts: { cache?: IndexCache; delayMs?: number } = {},
): ObsidianBridge {
  const { vault, fileManager, workspace } = app;
  const delayMs = opts.delayMs ?? 300;
  let dirs: string[] = [];
  const listeners = new Set<() => void>();
  let refs: EventRef[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const note = (path: string): TFile => {
    const f = vault.getAbstractFileByPath(checkPath(path));
    if (!isNote(f)) throw new BridgeError("not-found", `No such note: ${path}`);
    return f;
  };
  /** The modification time and size on disk now (the vault's own copy can lag behind an outside edit). */
  const statOf = async (file: TFile) => {
    const s = await vault.adapter.stat(file.path);
    return { mtimeMs: s?.mtime ?? file.stat.mtime, size: s?.size ?? file.stat.size };
  };
  /** Creates the folders of `path` that are missing. */
  const ensureFolder = async (folder: string) => {
    if (!folder) return;
    let at = "";
    for (const part of folder.split("/")) {
      at = at ? `${at}/${part}` : part;
      const f = vault.getAbstractFileByPath(at);
      if (!f) await vault.createFolder(at);
      else if (!isFolder(f)) throw new BridgeError("bad-path", `Not a folder: ${at}`);
    }
  };

  const fire = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const l of listeners) l();
    }, delayMs);
  };
  const listen = () => {
    if (refs.length > 0) return;
    const onFile = (file: TAbstractFile) => {
      if (concerns(file.path, dirs)) fire();
    };
    refs = [
      vault.on("create", onFile),
      vault.on("modify", onFile),
      vault.on("delete", onFile),
      vault.on("rename", (file, oldPath) => {
        if (concerns(file.path, dirs) || concerns(oldPath, dirs)) fire();
      }),
    ];
  };
  const unlisten = () => {
    clearTimeout(timer);
    for (const r of refs) vault.offref(r);
    refs = [];
  };

  return {
    getRoot: () => attempt(() => vault.getName()),
    chooseRoot: () => attempt(() => vault.getName()),

    scan: (dir) =>
      attempt(() => {
        const base = checkPath(dir.replace(/\/+$/, ""), { markdown: false });
        const folder = vault.getAbstractFileByPath(base);
        if (!isFolder(folder)) throw new BridgeError("not-found", `No such folder: ${dir}`);
        const out: NoteStat[] = [];
        const walk = (f: TFolder) => {
          for (const child of f.children) {
            if (child.name.startsWith(".")) continue;
            if (isFolder(child)) walk(child);
            else if (isNote(child)) {
              out.push({ path: child.path, mtimeMs: child.stat.mtime, size: child.stat.size });
            }
          }
        };
        walk(folder);
        return out;
      }),

    read: (path) =>
      attempt(async () => {
        const file = note(path);
        const text = await vault.read(file);
        return { text, mtimeMs: (await statOf(file)).mtimeMs };
      }),

    write: (path, text, expectedMtimeMs) =>
      attempt(async () => {
        const file = note(path);
        const before = await statOf(file);
        if (expectedMtimeMs != null && Math.abs(before.mtimeMs - expectedMtimeMs) > 1) {
          return { conflict: true, mtimeMs: before.mtimeMs, size: before.size };
        }
        await vault.process(file, () => text);
        return { conflict: false, ...(await statOf(file)) };
      }),

    create: (path, text) =>
      attempt(async () => {
        const clean = checkPath(path);
        if (vault.getAbstractFileByPath(clean)) return { exists: true as const };
        await ensureFolder(parentOf(clean));
        const file = await vault.create(clean, text);
        return { exists: false as const, ...(await statOf(file)) };
      }),

    rename: (from, to) =>
      attempt(async () => {
        const file = note(from);
        const target = checkPath(to);
        if (vault.getAbstractFileByPath(target)) return { exists: true as const };
        await ensureFolder(parentOf(target));
        await fileManager.renameFile(file, target);
        return { exists: false as const, ...(await statOf(file)) };
      }),

    trash: (path) =>
      attempt(async () => {
        await fileManager.trashFile(note(path));
        return null;
      }),

    openNote: (path) =>
      attempt(async () => {
        const file = note(path);
        // A tab that already shows the note is brought forward instead of opening another one.
        const open = workspace
          .getLeavesOfType("markdown")
          .find((l) => (l.view as { file?: TFile | null }).file?.path === file.path);
        if (open) await workspace.revealLeaf(open);
        else await workspace.getLeaf("tab").openFile(file);
        return null;
      }),

    watch: (next) =>
      attempt(() => {
        dirs = next.map((d) => checkPath(d.replace(/\/+$/, ""), { markdown: false }));
        return null;
      }),

    onChanged(callback) {
      listeners.add(callback);
      listen();
      return () => {
        listeners.delete(callback);
        if (listeners.size === 0) unlisten();
      };
    },

    cacheRead: () => attempt(async () => (opts.cache ? await opts.cache.read() : null)),
    cacheWrite: (text) =>
      attempt(async () => {
        await opts.cache?.write(text);
        return null;
      }),

    dispose() {
      listeners.clear();
      unlisten();
    },
  };
}
