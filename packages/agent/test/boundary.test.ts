import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Obsidian is an integration at the edge, never a limit of the core (docs/nucleo.md, 9.4): the core packages
 * know nothing of the vault or Obsidian. Their dependencies stay among themselves, and no source file of
 * theirs imports the vault import, the calendar, an app or Obsidian's API. Connectors (mail) are edges too:
 * the server uses them, the core never does.
 */
const PACKAGES = join(import.meta.dirname, "..", "..");
const CORE = ["entities", "store", "agent", "views"];
const CORE_NAMES = new Set(CORE.map((p) => `@boni/${p}`));
const ALLOWED_OUTSIDE = new Set(["@anthropic-ai/sdk"]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const path = join(dir, f);
    if (f === "node_modules") return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx|js|mjs|cjs)$/.test(f) ? [path] : [];
  });
}

describe("the core does not depend on Obsidian", () => {
  for (const pkg of CORE) {
    it(`@boni/${pkg} depends only on the core`, () => {
      const json = JSON.parse(readFileSync(join(PACKAGES, pkg, "package.json"), "utf8"));
      const deps = Object.keys(json.dependencies ?? {});
      expect(deps.filter((d) => !CORE_NAMES.has(d) && !ALLOWED_OUTSIDE.has(d))).toEqual([]);
    });

    it(`@boni/${pkg} imports nothing of the vault, the calendar, the apps or Obsidian`, () => {
      const bad: string[] = [];
      for (const file of sources(join(PACKAGES, pkg))) {
        const text = readFileSync(file, "utf8");
        for (const m of text.matchAll(
          /(?:from\s+|import\s*\(?\s*|require\s*\(\s*)["']([^"']+)["']/g,
        )) {
          const spec = m[1] as string;
          if (
            spec === "obsidian" ||
            spec.startsWith("@boni/vault-import") ||
            spec.startsWith("@boni/mail") ||
            spec.startsWith("@boni/calendar") ||
            spec.includes("vault-fs") ||
            /(^|\/)apps\//.test(spec) ||
            // A relative import that, resolved, leaves the core's packages.
            (spec.startsWith(".") &&
              !CORE.some((c) => resolve(dirname(file), spec).startsWith(join(PACKAGES, c) + sep)))
          )
            bad.push(`${file.slice(PACKAGES.length + 1)}: ${spec}`);
        }
      }
      expect(bad).toEqual([]);
    });
  }
});
