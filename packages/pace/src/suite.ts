// Which of a package's tests run in the serial run (T-12, task 155): every test file that imports `@boni/pace`, as
// every test that bounds a time does (T-11). `pnpm test` runs every package's other files in parallel first
// (`BONI_TESTS=parallel`), then these alone, one package and one file at a time (`BONI_TESTS=timed`), so no
// heavy sibling test shares the machine with a bound. Unset, a package's `vitest run` runs all of its files at once,
// as before. Vitest's own recipe for this is two projects ordered by `sequence.groupOrder`; that orders them inside
// one vitest only, and `pnpm -r` runs several packages at once, so the two runs are two passes over the workspace.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { configDefaults } from "vitest/config";

/** A test file of vitest's. */
const TEST = /\.test\.tsx?$/;
const SKIP = new Set(["node_modules", "dist", "build", "out", ".git", "test-results"]);
/** An import of `@boni/pace` (its clocks, `under`, or the bare import of a file whose limits are times). */
export const PACE_IMPORT = /(?:from|import)\s+["']@boni\/pace["']/;

/** The package's test files that import `@boni/pace`, relative to `dir`, sorted. */
export function timedFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (TEST.test(e.name) && PACE_IMPORT.test(readFileSync(p, "utf8")))
        out.push(relative(dir, p).split(sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

/** Which run vitest is in: the parallel one, the serial one, or (unset) the whole package at once. */
export type TestRun = "parallel" | "timed" | undefined;

/** What a package's vitest config adds for the run it is in (`dir`: the package's folder). */
export function suite(
  dir: string,
  run: string | undefined = process.env.BONI_TESTS,
): {
  exclude?: string[];
  include?: string[];
  fileParallelism?: boolean;
  passWithNoTests?: boolean;
} {
  // A package whose every file bounds time (the store's) has nothing here: it passes, and runs them all later.
  if (run === "parallel")
    return { exclude: [...configDefaults.exclude, ...timedFiles(dir)], passWithNoTests: true };
  if (run === "timed") {
    const timed = timedFiles(dir);
    // One file at a time, and a package with none passes with nothing to run.
    return {
      include: timed.length ? timed : ["no-test-of-this-package-bounds-time"],
      fileParallelism: false,
      passWithNoTests: true,
    };
  }
  if (run !== undefined)
    throw new Error(`BONI_TESTS is "parallel", "timed" or unset, not "${run}"`);
  return {};
}
