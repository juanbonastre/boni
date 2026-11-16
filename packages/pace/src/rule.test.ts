// T-11: every test that bounds time goes through @boni/pace. It reads its clock there (`clock()`, `cpu()`), never
// `performance.now()`, `process.threadCpuUsage()` or an elapsed `Date.now() - start` of its own, keeps no clock helper
// of its own (`cpu.test-util.ts`), and checks an elapsed time with `under(ms, bound, kind)`, never with a bare
// `expect(ms).toBeLessThan(...)`. The files listed below are left, each with its reason.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../..");

/** Files left as they are, each with why. A new file is never added here to make a test pass. */
const LEFT: Record<string, string> = {
  "apps/boni-web/src/core/cpu.test-util.ts":
    "apps/boni-web: converted with the next batch that ships a desktop version",
  "apps/boni-web/src/core/docModel.test.ts": "apps/boni-web: as above",
  "apps/boni-web/src/core/inline.test.ts": "apps/boni-web: as above",
  "apps/boni-web/src/core/tableCalc.test.ts": "apps/boni-web: as above",
  "apps/boni-web/src/core/unsent.test.ts": "apps/boni-web: as above",
  "scripts/queue.test.mjs":
    "the queue's own waits, bounded by their limit or twenty free runs measured the same way (T-08, task 116)",
};

const SKIP = new Set([
  "node_modules",
  ".git",
  ".claude",
  "dist",
  "build",
  "out",
  "test-results",
  ".gradle",
]);
const TEST = /\.(test|spec)\.(ts|tsx|cjs|mjs)$|\.test-util\.ts$/;

function files(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) files(p, out);
    else if (TEST.test(e.name)) out.push(relative(ROOT, p));
  }
  return out;
}

/** What a test file does against T-11, as `file:line: what`. */
function breaks(file: string, text: string): string[] {
  const out: string[] = [];
  const lines = text.split("\n");
  if (file.endsWith("cpu.test-util.ts"))
    out.push(`${file}: a clock helper of its own; import @boni/pace`);
  const elapsed = new Set<string>();
  lines.forEach((l, i) => {
    const at = `${file}:${i + 1}`;
    if (/performance\.now\(/.test(l))
      out.push(`${at}: performance.now(); use clock() from @boni/pace`);
    if (/threadCpuUsage\(/.test(l))
      out.push(`${at}: process.threadCpuUsage(); use cpu() from @boni/pace`);
    if (/\bDate\.now\(\)\s*-\s*[a-z_]\w*/.test(l))
      out.push(`${at}: an elapsed Date.now(); use clock() from @boni/pace`);
    const m = /\b(?:const|let)\s+(\w+)\s*=\s*(?:cpu|clock)\(\)\s*-/.exec(l);
    if (m?.[1]) elapsed.add(m[1]);
  });
  // An expect() over the whole text, as the formatter may break it over lines: `expect(\n  ms,\n).toBeLessThan(`.
  const lineOf = (at: number) => text.slice(0, at).split("\n").length;
  for (const m of text.matchAll(/expect\(\s*(?:cpu|clock)\(\)\s*-[^)]*\)\s*\.toBeLessThan/g))
    out.push(
      `${file}:${lineOf(m.index)}: an elapsed time bounded with expect(); use under(ms, bound, kind)`,
    );
  for (const m of text.matchAll(/expect\(\s*(\w+)\s*,?\s*\)\s*\.toBeLessThan(?:OrEqual)?\(/g))
    if (m[1] && elapsed.has(m[1]))
      out.push(
        `${file}:${lineOf(m.index)}: «${m[1]}» is an elapsed time bounded with expect(); use under(ms, bound, kind)`,
      );
  return out;
}

describe("T-11: a test that bounds time goes through @boni/pace (task 134)", () => {
  it("T-11: every test file of the repo reads its clocks and checks its time bounds through @boni/pace", () => {
    const found = files(ROOT)
      .filter((f) => !f.startsWith("packages/pace/") && !(f in LEFT))
      .flatMap((f) => breaks(f, readFileSync(join(ROOT, f), "utf8")));
    expect(found).toEqual([]);
  });

  it("T-11: what it finds, and what it lets be", () => {
    const bad = [
      "const t0 = performance.now();",
      "const u = process.threadCpuUsage();",
      "expect(Date.now() - t0).toBeLessThan(1000);",
      "const ms = cpu() - t0;",
      "expect(ms).toBeLessThan(200);",
      "expect(cpu() - t0).toBeLessThan(5);",
      "expect(",
      "  ms,",
      ").toBeLessThan(300);",
    ].join("\n");
    expect(breaks("x.test.ts", bad)).toEqual([
      "x.test.ts:1: performance.now(); use clock() from @boni/pace",
      "x.test.ts:2: process.threadCpuUsage(); use cpu() from @boni/pace",
      "x.test.ts:3: an elapsed Date.now(); use clock() from @boni/pace",
      "x.test.ts:6: an elapsed time bounded with expect(); use under(ms, bound, kind)",
      "x.test.ts:5: «ms» is an elapsed time bounded with expect(); use under(ms, bound, kind)",
      "x.test.ts:7: «ms» is an elapsed time bounded with expect(); use under(ms, bound, kind)",
    ]);
    expect(breaks("a/cpu.test-util.ts", "")).toEqual([
      "a/cpu.test-util.ts: a clock helper of its own; import @boni/pace",
    ]);
    const fine = [
      "const ms = cpu() - t0;",
      'under(ms, 200, "cpu", "the sum");',
      "const yesterday = Date.now() - 86_400_000;",
      "db.run(Date.now() - SESSION_IDLE_MS);",
      "expect(rows.length).toBeLessThan(10);",
    ].join("\n");
    expect(breaks("x.test.ts", fine)).toEqual([]);
  });
});
