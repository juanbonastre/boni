/**
 * D-17: nothing finds a record by the path its note had in the vault. Only the reshape reads that hidden field, to
 * clear it away (`reshape.ts`); the tests' seed writes it to have something to clear.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = import.meta.dirname;
const ALLOWED = new Set(["paths.ts", "reshape.ts", "seed.test-util.ts"]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

describe("records are known by their id (D-17)", () => {
  it("no server code but the reshape reads the vault's path", () => {
    const readers = sources(ROOT)
      .filter((p) => !ALLOWED.has(relative(ROOT, p)))
      .filter((p) =>
        /PATH_FIELD|HASH_FIELD|f_vault_path|f_vault_hash/.test(readFileSync(p, "utf8")),
      )
      .map((p) => relative(ROOT, p));
    expect(readers).toEqual([]);
  });
});
