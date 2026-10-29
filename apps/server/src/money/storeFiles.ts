import type { UserStore } from "@boni/store";
import { FILE_FIELD, FOLDER_FIELD } from "../paths.ts";
import { StoreMoney } from "../v1/storeMoney.ts";
import type { MoneyFiles } from "./service.ts";

/** The import's type for the vault's other files (a row each: the file, its folder, its path). */
const FILES = "t_archivo";

/**
 * The reconciliation's inputs from Boni itself (Juan, 2026-10-23: no more vault): the bank statements and
 * `reglas.csv` are rows of "Archivos", each a file with its name (its title) and the folder it is in, so they are read
 * here by folder and name. A new statement becomes such a row (MCP `upload_file`).
 */
export function storeFiles(store: UserStore): MoneyFiles {
  const nameOf = (e: { type: string; values: Record<string, unknown> }) => {
    const t = store.schema().types[e.type];
    return t ? String(e.values[t.titleField] ?? "") : "";
  };
  const byPath = (rel: string) => {
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
      const sha = byPath(rel)?.values[FILE_FIELD];
      const file = typeof sha === "string" ? store.getFile(sha) : null;
      if (!file) throw new Error(`${rel}: not in Boni`);
      return Buffer.from(file.data.buffer, file.data.byteOffset, file.data.byteLength);
    },
    read(rel) {
      throw new Error(`${rel}: a note is read through Boni, not as a file`);
    },
    categories: () => new StoreMoney(store).categories(),
  };
}
