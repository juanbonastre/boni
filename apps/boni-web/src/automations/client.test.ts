/** What the editor asks the server, as the apps' allowed paths see it (paths.cjs, Net.kt). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { automationsClient, PREVIEW_QUERY_CHARS, previewFits } from "./client.ts";

/**
 * The paths the desktop app and Android let through, read out of their own files (`API_PATH` in paths.cjs and in
 * Net.kt), so a change in either is a change here: never a copy that could drift.
 */
const APPS = join(import.meta.dirname, "..", "..", "..");
const desktop = (() => {
  const src = readFileSync(join(APPS, "boni-desktop", "paths.cjs"), "utf8");
  const m = /const API_PATH =\s*\/(.+)\/;/.exec(src);
  if (!m?.[1]) throw new Error("paths.cjs: no API_PATH");
  return new RegExp(m[1]);
})();
const android = (() => {
  const src = readFileSync(
    join(
      APPS,
      "boni-android",
      "app",
      "src",
      "main",
      "java",
      "io",
      "github",
      "juanbonastre",
      "boni",
      "Net.kt",
    ),
    "utf8",
  );
  const m = /API_PATH =\s*Regex\("(.+)"\)/.exec(src);
  if (!m?.[1]) throw new Error("Net.kt: no API_PATH");
  return new RegExp(m[1].replaceAll("\\\\", "\\"));
})();
/** What both apps let through: their pattern, and no `..` anywhere. */
const allowed = (p: string) => desktop.test(p) && android.test(p) && !p.includes("..");

describe("the line under an expression asked of the server", () => {
  it("AU-23 · any expression goes in a path the apps let through, and the server reads it back as it was typed", async () => {
    const asked: string[] = [];
    const client = automationsClient({
      automations: async (_method: string, path: string) => {
        asked.push(`api/agent/automations/${path}`);
        return { state: "value", value: 1, row: 0, of: 1 };
      },
    } as never);
    const typed = [
      "{{ $json.importe * 2 }}",
      "{{ [...$input.all()].map((p) => p.nota ?? '—').join(', ') }}",
      "Total: {{ $json.a + $json.b }} € (sin IVA) ~ ¡ya! ...",
    ];
    for (const expr of typed) {
      await client.preview("a_01kx3m9q2a7v", {
        step: "s_01kx3doblar",
        param: "fields.0.value",
        row: 41,
        expr,
      });
      const p = asked.at(-1) as string;
      expect(allowed(p), p).toBe(true);
      const q = new URLSearchParams(p.split("?")[1]);
      expect(q.get("expr")).toBe(expr);
      expect([q.get("step"), q.get("param"), q.get("row")]).toEqual([
        "s_01kx3doblar",
        "fields.0.value",
        "41",
      ]);
    }
  });
  it("AU-23 · both apps' patterns are read and are the same: a path outside them is refused by both", () => {
    expect(desktop.source).toBe(android.source);
    expect(allowed("api/agent/automations/a_01/test/preview?expr=%7B%7B")).toBe(true);
    expect(allowed("api/agent/automations/a_01/test/preview?expr={{")).toBe(false);
    expect(allowed("api/agent/../../etc")).toBe(false);
  });
  it("AU-23 · an expression within its 2,000 characters that would not fit a request once escaped is not asked", () => {
    expect(previewFits(`{{ ${"$json.a + ".repeat(180)}1 }}`)).toBe(true);
    // 2,000 characters of three bytes each: about 18 KB once escaped.
    const wide = `{{ '${"—".repeat(1990)}' }}`;
    expect(wide.length).toBeLessThanOrEqual(2000);
    expect(previewFits(wide)).toBe(false);
    expect(PREVIEW_QUERY_CHARS).toBeLessThan(16 * 1024);
  });
});
