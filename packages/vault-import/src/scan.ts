import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The vault's notes the import may read (docs/nucleo.md, 9.1). The same zones as everywhere else:
 * never `private/` or `restricted/` (at any depth, any case), never a folder that starts with a dot
 * (`.obsidian`, `.trash`, `.git`), never `_system/` (rules; only its collection definitions are read,
 * by `readDefinitions`), never a symbolic link (it could point out of the vault). Markdown only.
 */
const FORBIDDEN = new Set(["private", "restricted"]);

/** Whether the import reads a note at `path` (vault-relative, "/"): the rules of `scanVault`. */
export function importable(path: string): boolean {
  const parts = path.split("/");
  const name = parts[parts.length - 1] ?? "";
  if (!name.toLowerCase().endsWith(".md") || name === "README.md") return false;
  if (parts.length > 1 && parts[0] === "_system") return false;
  return parts
    .slice(0, -1)
    .every((p) => p !== "" && !FORBIDDEN.has(p.toLowerCase()) && !p.startsWith("."));
}

export interface Scanned {
  /** Vault-relative paths with "/". */
  notes: string[];
  /** Other files (attachments), same rules; only a zone's import takes them (`importVault` with `zone`). */
  files: string[];
  /** What was passed over and why (counts by reason; never the contents). */
  skipped: Record<string, number>;
}

export function scanVault(root: string): Scanned {
  const notes: string[] = [];
  const files: string[] = [];
  const skipped: Record<string, number> = {};
  const skip = (why: string) => {
    skipped[why] = (skipped[why] ?? 0) + 1;
  };
  const walk = (rel: string) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) {
        skip("symbolic link");
        continue;
      }
      if (e.isDirectory()) {
        const low = e.name.toLowerCase();
        if (FORBIDDEN.has(low)) continue; // not even counted: these folders are not looked at
        if (e.name.startsWith(".")) continue;
        if (!rel && e.name === "_system") continue;
        walk(path);
        continue;
      }
      if (!e.isFile()) continue;
      if (!e.name.toLowerCase().endsWith(".md")) {
        if (!e.name.startsWith(".")) files.push(path);
        skip("not a note (attachment or other file)");
      } else if (e.name === "README.md") skip("folder index (README.md)");
      else notes.push(path);
    }
  };
  walk("");
  notes.sort();
  files.sort();
  return { notes, files, skipped };
}
