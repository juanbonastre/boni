import type { UserStore } from "@boni/store";
import { FILE_FIELD, FOLDER_FIELD, PATH_FIELD } from "../paths.ts";
import { StoreMoney } from "../v1/storeMoney.ts";
import type { MoneyFiles } from "./service.ts";

/** The import's type for the vault's other files (a row each: the file, its folder, its path). */
const FILES = "t_archivo";

/**
 * The reconciliation's inputs from Boni itself (Juan, 2026-10-23: no more vault): the bank statements, `reglas.csv`
 * and the categories the vault had are rows of "Archivos" (each with the folder and path it had) and a note, so
 * they are read here by those paths. A new statement becomes such a row (MCP `upload_file`).
 */
export function storeFiles(store: UserStore): MoneyFiles {
  const byPath = (rel: string) =>
    store
      .findByValue(PATH_FIELD, rel)
      .map((h) => store.get(h.id)?.entity)
      .find((e) => e && e.deleted === undefined);
  return {
    files(dir, exts) {
      return store
        .list(FILES)
        .filter((s) => s.entity.values[FOLDER_FIELD] === dir)
        .map(
          (s) =>
            String(s.entity.values[PATH_FIELD] ?? "")
              .split("/")
              .pop() ?? "",
        )
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
