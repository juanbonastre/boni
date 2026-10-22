import type { App } from "obsidian";

/**
 * A stand-in for the parts of Obsidian's API the bridge uses (tests only): a vault of notes and
 * folders in memory with modification times, the vault's events, the file manager (rename, trash)
 * and the workspace's tabs. Notes start from `initial` (path -> text).
 */
interface Node {
  path: string;
  name: string;
  parent: Folder | null;
}
interface File extends Node {
  extension: string;
  basename: string;
  stat: { ctime: number; mtime: number; size: number };
}
interface Folder extends Node {
  children: (File | Folder)[];
}
type Listener = (...args: unknown[]) => void;

export function fakeObsidian(initial: Record<string, string>) {
  let clock = 1_000_000;
  /** Every change gets a later modification time. */
  const tick = () => {
    clock += 1000;
    return clock;
  };
  const text = new Map<string, string>();
  const nodes = new Map<string, File | Folder>();
  const root: Folder = { path: "/", name: "", parent: null, children: [] };
  const listeners = new Map<string, Set<Listener>>();
  const log = {
    renamed: [] as [string, string][],
    trashed: [] as string[],
    opened: [] as string[],
    revealed: [] as string[],
  };
  const leaves: { view: { file: File | null } }[] = [];

  const size = (t: string) => new TextEncoder().encode(t).length;
  const emit = (name: string, ...args: unknown[]) => {
    for (const l of listeners.get(name) ?? []) l(...args);
  };
  const split = (path: string) => {
    const i = path.lastIndexOf("/");
    return { dir: i < 0 ? "" : path.slice(0, i), name: path.slice(i + 1) };
  };
  const folderAt = (path: string): Folder | null => {
    if (path === "") return root;
    const n = nodes.get(path);
    return n && "children" in n ? n : null;
  };
  const attach = (node: File | Folder) => {
    const parent = folderAt(split(node.path).dir);
    if (!parent) throw new Error(`Folder does not exist: ${split(node.path).dir}`);
    node.parent = parent;
    parent.children.push(node);
    nodes.set(node.path, node);
  };
  const detach = (node: File | Folder) => {
    if (node.parent) node.parent.children = node.parent.children.filter((c) => c !== node);
    nodes.delete(node.path);
  };
  const mkdirs = (dir: string) => {
    let at = "";
    for (const part of dir.split("/").filter(Boolean)) {
      at = at ? `${at}/${part}` : part;
      if (!nodes.has(at)) attach({ path: at, name: part, parent: null, children: [] });
    }
  };
  const addFile = (path: string, t: string): File => {
    const { name } = split(path);
    const dot = name.lastIndexOf(".");
    const file: File = {
      path,
      name,
      parent: null,
      extension: dot < 0 ? "" : name.slice(dot + 1),
      basename: dot < 0 ? name : name.slice(0, dot),
      stat: { ctime: clock, mtime: tick(), size: size(t) },
    };
    text.set(path, t);
    attach(file);
    return file;
  };
  const fileAt = (path: string): File => {
    const n = nodes.get(path);
    if (!n || "children" in n) throw new Error(`No such file: ${path}`);
    return n;
  };

  for (const [path, t] of Object.entries(initial)) {
    mkdirs(split(path).dir);
    addFile(path, t);
  }

  const app = {
    vault: {
      getName: () => "Vault de ejemplo",
      getAbstractFileByPath: (path: string) => nodes.get(path) ?? null,
      read: async (f: File) => text.get(f.path) as string,
      process: async (f: File, fn: (data: string) => string) => {
        const before = text.get(f.path) as string;
        const after = fn(before);
        if (after === before) return before;
        text.set(f.path, after);
        f.stat = { ...f.stat, mtime: tick(), size: size(after) };
        emit("modify", f);
        return after;
      },
      create: async (path: string, t: string) => {
        if (nodes.has(path)) throw new Error("File already exists.");
        const f = addFile(path, t);
        emit("create", f);
        return f;
      },
      createFolder: async (path: string) => {
        if (nodes.has(path)) throw new Error("Folder already exists.");
        const { dir, name } = split(path);
        if (!folderAt(dir)) throw new Error(`Folder does not exist: ${dir}`);
        attach({ path, name, parent: null, children: [] });
      },
      adapter: {
        stat: async (path: string) => {
          const n = nodes.get(path);
          return n && !("children" in n) ? { type: "file", ...n.stat } : null;
        },
      },
      on: (name: string, cb: Listener) => {
        const set = listeners.get(name) ?? new Set<Listener>();
        set.add(cb);
        listeners.set(name, set);
        return { name, cb };
      },
      offref: (ref: { name: string; cb: Listener }) => listeners.get(ref.name)?.delete(ref.cb),
    },
    fileManager: {
      renameFile: async (f: File, to: string) => {
        if (nodes.has(to)) throw new Error("Destination file already exists!");
        const from = f.path;
        detach(f);
        const { name } = split(to);
        f.path = to;
        f.name = name;
        f.basename = name.replace(/\.[^.]*$/, "");
        attach(f);
        text.set(to, text.get(from) as string);
        text.delete(from);
        log.renamed.push([from, to]);
        emit("rename", f, from);
      },
      trashFile: async (f: File) => {
        detach(f);
        text.delete(f.path);
        log.trashed.push(f.path);
        emit("delete", f);
      },
    },
    workspace: {
      getLeavesOfType: (type: string) => (type === "markdown" ? leaves : []),
      revealLeaf: async (leaf: { view: { file: File | null } }) => {
        log.revealed.push(leaf.view.file?.path ?? "");
      },
      getLeaf: () => {
        const leaf = { view: { file: null as File | null } };
        return {
          openFile: async (f: File) => {
            leaf.view.file = f;
            leaves.push(leaf);
            log.opened.push(f.path);
          },
        };
      },
    },
  };

  return {
    app: app as unknown as App,
    text,
    log,
    listenerCount: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
    /** A change made outside the calendar (Obsidian's editor, Syncthing): new text and time. */
    editOutside(path: string, t: string) {
      const f = fileAt(path);
      text.set(path, t);
      f.stat = { ...f.stat, mtime: tick(), size: size(t) };
      emit("modify", f);
    },
    /** A note created outside the calendar. */
    createOutside(path: string, t: string) {
      mkdirs(split(path).dir);
      emit("create", addFile(path, t));
    },
  };
}
