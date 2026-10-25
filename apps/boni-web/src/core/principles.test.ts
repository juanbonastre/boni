import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BONI_SOURCES,
  CATALOGUE,
  HEIGHTS,
  PERIODS,
  PLACE_SETTINGS,
  TIME_GROUPS,
} from "@boni/views";
import { describe, expect, it } from "vitest";
import { translator } from "../i18n.ts";

/**
 * Boni's principles that the app can check (docs/principios.md). A change that breaks one fails here, so the rule is
 * not forgotten between changes (Juan, 2026-10-25).
 */
const SRC = join(import.meta.dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(dir, e.name))
      : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && e.name !== "i18n.ts"
        ? [join(dir, e.name)]
        : [],
  );

describe("principles (docs/principios.md)", () => {
  it("I-02: the interface's texts are only in i18n.ts (no Spanish written in a component)", () => {
    // Letters only Spanish text has; «» are quotes, «Español» is the language's own name.
    const spanish = /[áéíóúñÁÉÍÓÚÑ¿¡]/;
    const found: string[] = [];
    for (const f of files(SRC)) {
      const code = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      code.split("\n").forEach((line, i) => {
        const l = line.replace(/\/\/.*$/, "");
        if (spanish.test(l) && !l.includes('"Español"'))
          found.push(`${f.slice(SRC.length)}:${i + 1}`);
      });
    }
    expect(found).toEqual([]);
  });

  it("I-02: every label of the block catalogue has its text in both languages", () => {
    const labels = new Set<string>();
    for (const k of CATALOGUE) {
      labels.add(k.name).add(k.group);
      for (const s of k.settings) {
        labels.add(s.label);
        if (Array.isArray(s.options)) for (const o of s.options) labels.add(o.label);
      }
    }
    for (const s of PLACE_SETTINGS) {
      labels.add(s.label);
      if (Array.isArray(s.options)) for (const o of s.options) labels.add(o.label);
    }
    for (const o of [...PERIODS, ...TIME_GROUPS, ...HEIGHTS, ...Object.values(BONI_SOURCES).flat()])
      labels.add(o.label);
    for (const lang of ["es", "en"] as const) {
      const t = translator(lang);
      const missing = [...labels].filter((l) => t(`cat.${l}`) === `cat.${l}`);
      expect(missing, lang).toEqual([]);
    }
  });
});
