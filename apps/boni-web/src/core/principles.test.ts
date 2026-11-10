import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CATALOGUE,
  DATA_BLOCKS,
  HEIGHTS,
  PERIODS,
  PLACE_SETTINGS,
  RETIRED_BLOCKS,
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

  it("I-32: Boni acts on the screen with the app's own actions, never with a simulated click", () => {
    // What Boni does on the screen (F9: it opens a collection, a record, a place) calls what a button of the app
    // calls. So no code of the app makes a pointer's event, and `.click()` is only where a file is chosen or saved
    // (the browser's own dialog, started by Juan's click).
    const allowed = new Set(["/host.ts", "/components/MobileCreate.tsx"]);
    const found: string[] = [];
    for (const f of files(SRC)) {
      const code = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      const name = f.slice(SRC.length);
      if (/new\s+(Mouse|Pointer)Event\s*\(/.test(code))
        found.push(`${name}: a pointer's event made by code`);
      if (/\.click\(\)/.test(code) && !allowed.has(name)) found.push(`${name}: .click()`);
    }
    expect(found).toEqual([]);
  });

  it("I-25: «Ver en el mapa» is in the menus of what the map knows; a run's «Recorrido» is that run on the map", () => {
    // A collection and a page in the sidebar, a row, a block, a flow's «⋯».
    for (const file of [
      "components/CollectionTree.tsx",
      "components/Sidebar.tsx",
      "components/DatabaseBlock.tsx",
      "components/PageView.tsx",
      "components/FlowEditor.tsx",
    ])
      expect(readFileSync(join(SRC, file), "utf8"), file).toContain('t("map.show")');
    // A run's «Recorrido» (the Registro, an Inbox card and its page) opens it on the map; no drawing of its own
    // (task 90; Juan, 2026-11-06: «teniendo el mapa, no tiene sentido tener lo del recorrido»).
    for (const file of ["components/Chat.tsx", "components/InboxCards.tsx"]) {
      const src = readFileSync(join(SRC, file), "utf8");
      expect(src, file).toContain("showRun(");
      expect(src, file).toContain('t("log.trace")');
      expect(src, file).not.toMatch(/RunCanvas|openTrace/);
    }
    expect(existsSync(join(SRC, "components/RunCanvas.tsx"))).toBe(false);
    // And a row's «¿De dónde viene?»: the run that made it, drawn on the map.
    expect(readFileSync(join(SRC, "components/DatabaseBlock.tsx"), "utf8")).toContain(
      't("origin.ask")',
    );
    for (const lang of ["es", "en"] as const)
      for (const k of ["map.show", "log.trace", "origin.ask", "origin.title", "map.node.inbox"])
        expect(translator(lang)(k), `${lang} ${k}`).not.toBe(k);
  });

  it("I-27: a step has one name everywhere, from one place, and what a run did is said in words", () => {
    // The editor, the map, a flow's preview and the Registro name a step through core/runText.ts; nothing else maps
    // a reader to its name, so they cannot drift apart (task 90: «Crear», «Regla del remitente», `entities.get`).
    for (const file of [
      "components/FlowStepPanel.tsx",
      "components/FlowEditor.tsx",
      "components/FlowMap.tsx",
      "components/FlowPreview.tsx",
      "components/Chat.tsx",
    ])
      expect(readFileSync(join(SRC, file), "utf8"), file).toContain('from "../core/runText.ts"');
    const naming = files(SRC).filter(
      (f) =>
        /\.tsx?$/.test(f) &&
        !f.endsWith(".test.ts") &&
        readFileSync(f, "utf8").includes("`flow.node.${"),
    );
    expect(naming.map((f) => f.slice(SRC.length + 1))).toEqual(["core/runText.ts"]);
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
    for (const o of [...PERIODS, ...TIME_GROUPS, ...HEIGHTS]) labels.add(o.label);
    for (const lang of ["es", "en"] as const) {
      const t = translator(lang);
      const missing = [...labels].filter((l) => t(`cat.${l}`) === `cat.${l}`);
      expect(missing, lang).toEqual([]);
    }
  });

  it("D-04: every number, bar list and chart counts a collection; none has a source of its own", () => {
    for (const type of DATA_BLOCKS) {
      const keys = CATALOGUE.find((k) => k.type === type)?.settings.map((s) => s.key) ?? [];
      expect(keys, type).toContain("collection");
      expect(keys, type).not.toContain("from");
      expect(keys, type).not.toContain("source");
    }
  });

  it("D-05: configuring Boni is not a block: its models' parts are only in Ajustes", () => {
    for (const r of RETIRED_BLOCKS) expect(CATALOGUE.some((k) => k.type === r)).toBe(false);
    const users = files(SRC).filter((f) => /from "\.\/Models\.tsx"/.test(readFileSync(f, "utf8")));
    expect(users.map((f) => f.slice(SRC.length))).toEqual(["/components/ModelsSettings.tsx"]);
  });

  it("D-06: a note is a page: the row's editor is the page's own, not a text-only one", () => {
    // One kind of page (Juan, 2026-10-26): a note's text is edited with the full editor (every block, «/» and «+»).
    const found = files(SRC).filter((f) => /TextOnly|text-only/.test(readFileSync(f, "utf8")));
    expect(found).toEqual([]);
  });
});
