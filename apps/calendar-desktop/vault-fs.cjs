// File access to the user's vault (a folder of Markdown notes). Used by the main process only; the
// UI reaches it through IPC. Everything is relative to the vault root and confined to it.
const fs = require("node:fs");
const path = require("node:path");

/** Top-level folders the app never reads or writes (zones the vault reserves for the owner). */
const DENIED_TOP = new Set(["private", "restricted"]);

class VaultError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
  }
}

/** The parts of a vault-relative note path, or a VaultError if it leaves the allowed area. */
function notePath(rel, { markdown = true } = {}) {
  if (typeof rel !== "string" || rel === "" || path.isAbsolute(rel) || rel.includes("\0")) {
    throw new VaultError("bad-path", `Bad path: ${rel}`);
  }
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  if (parts.some((p) => p === ".." || p.startsWith("."))) {
    throw new VaultError("bad-path", `Not allowed: ${rel}`);
  }
  if (DENIED_TOP.has(parts[0])) throw new VaultError("denied", `Not allowed: ${rel}`);
  if (markdown && !rel.toLowerCase().endsWith(".md")) {
    throw new VaultError("bad-path", `Only Markdown notes: ${rel}`);
  }
  return parts;
}

/**
 * `trashItem(absPath)` moves a file to the system trash (Electron's `shell.trashItem`); without it
 * deleted notes go to a `.trash` folder inside the vault, like Obsidian's own trash.
 */
function openVault(root, { trashItem } = {}) {
  let real;
  try {
    real = fs.realpathSync(root);
    if (!fs.statSync(real).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new VaultError("bad-root", `Not a folder: ${root}`);
  }

  /** Absolute path of a relative note path, or a VaultError if it leaves the allowed area. */
  function resolve(rel, { markdown = true } = {}) {
    return path.join(real, ...notePath(rel, { markdown }));
  }

  /** Checks that the real location (after symlinks) is still inside the vault. */
  function confined(abs) {
    const target = fs.realpathSync(abs);
    if (target !== real && !target.startsWith(real + path.sep)) {
      throw new VaultError("bad-path", "Outside the vault");
    }
  }

  const statOf = (abs) => {
    try {
      return fs.statSync(abs);
    } catch {
      return null;
    }
  };

  return {
    root: real,

    /** Every `.md` under `dir` (a folder relative to the root): path, mtime and size. */
    scan(dir) {
      const base = resolve(dir, { markdown: false });
      const st = statOf(base);
      if (!st?.isDirectory()) throw new VaultError("not-found", `No such folder: ${dir}`);
      confined(base);
      const out = [];
      const walk = (abs, rel) => {
        for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
          if (e.name.startsWith(".")) continue;
          const childAbs = path.join(abs, e.name);
          const childRel = `${rel}/${e.name}`;
          if (e.isDirectory()) walk(childAbs, childRel);
          else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
            const s = fs.statSync(childAbs);
            out.push({ path: childRel, mtimeMs: s.mtimeMs, size: s.size });
          }
        }
      };
      walk(base, dir.replace(/[\\/]+$/, ""));
      return out;
    },

    /**
     * `scan` without blocking: the same list, read with the asynchronous calls (64 at a time), so a server
     * keeps answering while a large folder on a slow disk is listed (Boni's mirror, every 30 s).
     */
    async scanAsync(dir) {
      const base = resolve(dir, { markdown: false });
      const st = await fs.promises.stat(base).catch(() => null);
      if (!st?.isDirectory()) throw new VaultError("not-found", `No such folder: ${dir}`);
      confined(base);
      const files = [];
      const walk = async (abs, rel) => {
        for (const e of await fs.promises.readdir(abs, { withFileTypes: true })) {
          if (e.name.startsWith(".")) continue;
          const childAbs = path.join(abs, e.name);
          const childRel = `${rel}/${e.name}`;
          if (e.isDirectory()) await walk(childAbs, childRel);
          else if (e.isFile() && e.name.toLowerCase().endsWith(".md"))
            files.push([childAbs, childRel]);
        }
      };
      await walk(base, dir.replace(/[\\/]+$/, ""));
      const out = [];
      for (let i = 0; i < files.length; i += 64) {
        const batch = files.slice(i, i + 64);
        const stats = await Promise.all(
          batch.map(([abs]) => fs.promises.stat(abs).catch(() => null)),
        );
        stats.forEach((s, j) => {
          if (s) out.push({ path: batch[j][1], mtimeMs: s.mtimeMs, size: s.size });
        });
      }
      return out;
    },

    read(rel) {
      const abs = resolve(rel);
      const st = statOf(abs);
      if (!st?.isFile()) throw new VaultError("not-found", `No such note: ${rel}`);
      confined(abs);
      return { text: fs.readFileSync(abs, "utf8"), mtimeMs: st.mtimeMs };
    },

    /**
     * Replaces a note. `expectedMtimeMs` is the modification time the caller read; when the file
     * changed since (Obsidian, sync), nothing is written and `{ conflict: true }` comes back.
     */
    write(rel, text, expectedMtimeMs) {
      const abs = resolve(rel);
      const st = statOf(abs);
      if (!st?.isFile()) throw new VaultError("not-found", `No such note: ${rel}`);
      confined(abs);
      if (expectedMtimeMs != null && Math.abs(st.mtimeMs - expectedMtimeMs) > 1) {
        return { conflict: true, mtimeMs: st.mtimeMs };
      }
      const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}.tmp`);
      try {
        fs.writeFileSync(tmp, text, { mode: st.mode });
        fs.renameSync(tmp, abs);
      } catch (e) {
        fs.rmSync(tmp, { force: true });
        throw e;
      }
      const after = fs.statSync(abs);
      return { conflict: false, mtimeMs: after.mtimeMs, size: after.size };
    },

    /**
     * Calls `onChange` (once per burst of changes, after `delayMs` of quiet) when a note below any of
     * `dirs` is created, changed or removed. Returns a function that stops watching.
     */
    watch(dirs, onChange, delayMs = 300) {
      let timer = null;
      const fire = () => {
        clearTimeout(timer);
        timer = setTimeout(onChange, delayMs);
      };
      const watchers = [];
      for (const dir of dirs) {
        const abs = resolve(dir, { markdown: false });
        if (!statOf(abs)?.isDirectory()) continue;
        confined(abs);
        try {
          const w = fs.watch(abs, { recursive: true, persistent: false }, (_ev, name) => {
            const file = name ? String(name) : "";
            if (file.split(/[\\/]/).some((p) => p.startsWith("."))) return; // temp files and dot folders
            if (file && !file.toLowerCase().endsWith(".md") && file.includes(".")) return;
            fire();
          });
          w.on("error", () => {});
          watchers.push(w);
        } catch {
          // A folder that cannot be watched is still refreshed when the window gets focus.
        }
      }
      return () => {
        clearTimeout(timer);
        for (const w of watchers) w.close();
      };
    },

    /** Moves a note to another path (parent folders are created); never overwrites. */
    rename(from, to) {
      const src = resolve(from);
      const dst = resolve(to);
      if (!statOf(src)?.isFile()) throw new VaultError("not-found", `No such note: ${from}`);
      confined(src);
      if (statOf(dst)) return { exists: true };
      let anchor = path.dirname(dst);
      while (!statOf(anchor)) anchor = path.dirname(anchor);
      confined(anchor);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.renameSync(src, dst);
      const moved = fs.statSync(dst);
      return { exists: false, mtimeMs: moved.mtimeMs, size: moved.size };
    },

    /** Sends a note to the trash (never deletes it for good). */
    async trash(rel) {
      const abs = resolve(rel);
      if (!statOf(abs)?.isFile()) throw new VaultError("not-found", `No such note: ${rel}`);
      confined(abs);
      if (trashItem) return void (await trashItem(abs));
      const dir = path.join(real, ".trash");
      fs.mkdirSync(dir, { recursive: true });
      let target = path.join(dir, path.basename(abs));
      for (let i = 2; statOf(target); i++) {
        target = path.join(dir, path.basename(abs).replace(/(\.md)$/i, ` ${i}$1`));
      }
      fs.renameSync(abs, target);
    },

    /** The absolute path of a note that exists (for opening it in another app). */
    locate(rel) {
      const abs = resolve(rel);
      if (!statOf(abs)?.isFile()) throw new VaultError("not-found", `No such note: ${rel}`);
      confined(abs);
      return abs;
    },

    /** Creates a note that must not exist yet (parent folders are created). */
    create(rel, text) {
      const abs = resolve(rel);
      // The nearest folder that already exists must be inside the vault before anything is created below it.
      let anchor = path.dirname(abs);
      while (!statOf(anchor)) anchor = path.dirname(anchor);
      confined(anchor);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      try {
        fs.writeFileSync(abs, text, { flag: "wx" });
      } catch (e) {
        if (e.code === "EEXIST") return { exists: true };
        throw e;
      }
      const made = fs.statSync(abs);
      return { exists: false, mtimeMs: made.mtimeMs, size: made.size };
    },
  };
}

module.exports = { notePath, openVault, VaultError };
