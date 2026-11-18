// T-12: the tests that bound time run alone, after the rest. Every package whose tests import `@boni/pace` splits its
// files with `suite()`, has the serial run's script, and the workspace's `pnpm test` (which `make check` and CI's
// `check` run) runs the parallel pass first and then the serial one, one package at a time.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { PACE_IMPORT, suite, timedFiles } from "./suite.ts";

const ROOT = join(import.meta.dirname, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
// Spelt in two, so this file's own text does not import the package and stays in the parallel run.
const PACE = ["@boni", "pace"].join("/");

describe("the serial run of the tests that bound time (T-12, task 155)", () => {
  const dir = mkdtempSync(join(tmpdir(), "boni-pace-suite-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src/a"), { recursive: true });
  mkdirSync(join(dir, "node_modules/x"), { recursive: true });
  writeFileSync(join(dir, "src/a/bounds.test.ts"), `import { clock, under } from "${PACE}";\n`);
  writeFileSync(join(dir, "src/marked.test.tsx"), `import "${PACE}";\n`);
  writeFileSync(join(dir, "src/plain.test.ts"), 'import { it } from "vitest";\n');
  writeFileSync(join(dir, "src/helper.ts"), `import { clock } from "${PACE}";\n`);
  writeFileSync(join(dir, "node_modules/x/dep.test.ts"), `import "${PACE}";\n`);

  it("T-12 · a test file that imports @boni/pace is in the serial run, alone; every other file in the parallel one; unset, the package runs whole", () => {
    expect(timedFiles(dir)).toEqual(["src/a/bounds.test.ts", "src/marked.test.tsx"]);
    const parallel = suite(dir, "parallel");
    expect(parallel.exclude).toEqual(
      expect.arrayContaining(["src/a/bounds.test.ts", "src/marked.test.tsx"]),
    );
    expect(parallel.exclude).toContain("**/node_modules/**");
    const timed = suite(dir, "timed");
    expect(timed).toEqual({
      include: ["src/a/bounds.test.ts", "src/marked.test.tsx"],
      fileParallelism: false,
      passWithNoTests: true,
    });
    vi.stubEnv("BONI_TESTS", undefined);
    try {
      expect(suite(dir)).toEqual({});
    } finally {
      vi.unstubAllEnvs();
    }
    expect(() => suite(dir, "todo")).toThrow(/BONI_TESTS/);
  });

  it("T-12 · every package whose tests import @boni/pace splits them with suite() and has the serial run's script, and `pnpm test` runs the parallel pass and then the serial one, one package at a time", () => {
    const packages = ["apps", "packages"].flatMap((top) =>
      readdirSync(join(ROOT, top)).map((d) => `${top}/${d}`),
    );
    const timedPackages = packages.filter((p) => {
      try {
        return timedFiles(join(ROOT, p)).length > 0;
      } catch {
        return false;
      }
    });
    expect(timedPackages).toEqual(
      expect.arrayContaining(["apps/server", "apps/sandbox", "packages/store"]),
    );
    for (const p of timedPackages) {
      const config = ["vitest.config.ts", "vite.config.ts"]
        .map((f) => {
          try {
            return read(`${p}/${f}`);
          } catch {
            return "";
          }
        })
        .join("\n");
      expect(config, `${p}'s vitest config`).toMatch(/\.\.\.suite\(import\.meta\.dirname\)/);
      const scripts = JSON.parse(read(`${p}/package.json`)).scripts as Record<string, string>;
      expect(scripts["test:timed"], `${p}'s test:timed`).toBe("BONI_TESTS=timed vitest run");
    }
    const root = JSON.parse(read("package.json")).scripts.test as string;
    expect(root).toMatch(
      /^BONI_TESTS=parallel pnpm -r --if-present test && pnpm -r --if-present --workspace-concurrency=1 test:timed && /,
    );
    // CI's check and make check run that same script.
    expect(read(".github/workflows/ci.yml")).toMatch(/- run: pnpm test\n/);
    expect(read("Makefile")).toMatch(/\$\(QUEUE\) pnpm test\n/);
    expect(PACE_IMPORT.test(`import "${PACE}";`)).toBe(true);
  });
});
