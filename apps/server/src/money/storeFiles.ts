import type { UserStore } from "@boni/store";
import { FILE_FIELD, FOLDER_FIELD } from "../paths.ts";
import type { MoneyFiles } from "./service.ts";

/** The account's files: a row each, with the file, its name (its title) and the folder it is in. */
const FILES = "t_archivo";

/**
 * The reconciliation's statements from Boni itself: rows of "Archivos", each a file with its name (its title) and
 * the folder it is in, read here by folder and name. A new statement becomes such a row (MCP `upload_file`).
 */
export function storeFiles(store: UserStore): MoneyFiles {
  const nameOf = (e: { type: string; values: Record<string, unknown> }) => {
    const t = store.schema().types[e.type];
    return t ? String(e.values[t.titleField] ?? "") : "";
  };
  const byName = (rel: string) => {
    const dir = rel.slice(0, rel.lastIndexOf("/"));
    const name = rel.slice(rel.lastIndexOf("/") + 1);
    return store.entities(FILES).find((e) => e.values[FOLDER_FIELD] === dir && nameOf(e) === name);
  };
  return {
    files(dir, exts) {
      return store
        .entities(FILES)
        .filter((e) => e.values[FOLDER_FIELD] === dir)
        .map(nameOf)
        .filter((n) => n && exts.some((x) => n.toLowerCase().endsWith(x)))
        .sort();
    },
    readBytes(rel) {
      const sha = byName(rel)?.values[FILE_FIELD];
      const file = typeof sha === "string" ? store.getFile(sha) : null;
      if (!file) throw new Error(`${rel}: not in Boni`);
      return Buffer.from(file.data.buffer, file.data.byteOffset, file.data.byteLength);
    },
  };
}
