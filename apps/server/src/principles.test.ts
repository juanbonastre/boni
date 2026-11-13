import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "./db.ts";
import { V1Store } from "./v1/store.ts";

/**
 * Boni's principles that the server can check (docs/principios.md). A change that breaks one fails here, so the rule
 * is not forgotten between changes (Juan, 2026-10-25).
 */
describe("principles (docs/principios.md)", () => {
  it("D-02: system.db keeps only accounts, devices, sessions and keys; the first Boni's tables only shrink", () => {
    const db = openDb(":memory:");
    new V1Store(db);
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as {
        name: string;
      }[]
    )
      .map((t) => t.name)
      .sort();
    // The server's own: who may enter and with which key. Everything of the user goes in their store.
    const server = ["account_data", "accounts", "data_keys", "devices", "push", "sessions"];
    // Inherited from the first Boni (API v1), to move into each user's store (plan PR 16): never a new one.
    const inherited = [
      "v1_captures",
      "v1_charts",
      "v1_prefs",
      "v1_seeded",
      "v1_shortcuts",
      "v1_widgets",
    ];
    const unknown = tables.filter((t) => !server.includes(t) && !inherited.includes(t));
    expect(
      unknown,
      "a table of the user's data in system.db: it belongs in the user's store",
    ).toEqual([]);
    db.close();
  });

  it("A-07: no vault mode: neither the server, the packages nor Boni Calendar's apps read or write a folder of notes", () => {
    const root = join(import.meta.dirname, "..", "..", "..");
    const sources = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.name === "node_modules"
          ? []
          : e.isDirectory()
            ? sources(join(dir, e.name))
            : /\.(ts|tsx|cjs|mjs)$/.test(e.name) && !/\.test\.|test-util/.test(e.name)
              ? [join(dir, e.name)]
              : [],
      );
    const dirs = [
      join(root, "apps", "server", "src"),
      join(root, "apps", "calendar-web", "src"),
      join(root, "apps", "calendar-desktop"),
      ...readdirSync(join(root, "packages")).map((p) => join(root, "packages", p, "src")),
    ].filter((d) => existsSync(d));
    const bad = dirs
      .flatMap(sources)
      .filter((f) =>
        /vault-fs\.cjs|@boni\/vault-import|@boni\/mirror|calendar-web\/src\/vault\/|boniVault|VaultSaf/.test(
          readFileSync(f, "utf8"),
        ),
      )
      .map((f) => f.slice(root.length + 1));
    expect(bad).toEqual([]);
    expect(existsSync(join(root, "packages", "mirror"))).toBe(false);
    expect(existsSync(join(root, "packages", "vault-import"))).toBe(false);
    for (const gone of [
      ["apps", "calendar-web", "src", "vault"],
      ["apps", "calendar-desktop", "vault-fs.cjs"],
      [
        "apps",
        "calendar-android",
        "app",
        "src",
        "main",
        "java",
        "io",
        "github",
        "juanbonastre",
        "bonicalendar",
        "VaultSaf.kt",
      ],
      ["legacy", "obsidian"],
    ])
      expect(existsSync(join(root, ...gone)), gone.join("/")).toBe(false);
  });

  it("D-55: a flow's draft never runs: only the flow editor's functions in flows.ts read it, only the journal touches its table", () => {
    const root = join(import.meta.dirname, "..", "..", "..");
    const sources = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.name === "node_modules"
          ? []
          : e.isDirectory()
            ? sources(join(dir, e.name))
            : /\.(ts|tsx)$/.test(e.name) && !/\.test\.|test-util/.test(e.name)
              ? [join(dir, e.name)]
              : [],
      );
    const files = [
      join(root, "apps", "server", "src"),
      ...readdirSync(join(root, "packages")).map((p) => join(root, "packages", p, "src")),
    ]
      .filter((d) => existsSync(d))
      .flatMap(sources);
    const where = (re: RegExp) =>
      files.filter((f) => re.test(readFileSync(f, "utf8"))).map((f) => f.slice(root.length + 1));
    // The scheduler, a run, the mail, «Probar», the MCP and the map read `journal.flow` (the saved version); the
    // draft is read only to show it in the editor (`flowView`) and to keep or move it (`keepDraft`, `renameFlow`).
    expect(where(/\.flowDraft\(/)).toEqual(["apps/server/src/flows.ts"]);
    expect(where(/\bflow_drafts\b/).sort()).toEqual([
      "packages/store/src/journal.ts",
      "packages/store/src/migrations.ts",
    ]);
  });

  it("A-28: the history, the audit and the models' calls only grow: nothing deletes their rows (the storage figures count each row once)", () => {
    const root = join(import.meta.dirname, "..", "..", "..");
    const sources = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.name === "node_modules"
          ? []
          : e.isDirectory()
            ? sources(join(dir, e.name))
            : /\.(ts|tsx|cjs|mjs)$/.test(e.name) && !/\.test\.|test-util/.test(e.name)
              ? [join(dir, e.name)]
              : [],
      );
    // Where those tables are written: the server, the packages, and the scripts run by hand.
    const bad = [
      join(root, "apps", "server", "src"),
      ...readdirSync(join(root, "packages")).map((p) => join(root, "packages", p, "src")),
      join(root, "scripts"),
    ]
      .filter((d) => existsSync(d))
      .flatMap(sources)
      .filter((f) =>
        ((text: string) =>
          // Deleted, replaced, or a text emptied in place (only the hash chain is ever written after the fact).
          /\b(DELETE\s+FROM|DROP\s+TABLE|REPLACE\s+INTO)\s+(ops|actions|access|model_calls)\b/i.test(
            text,
          ) ||
          /\bUPDATE\s+(ops|actions|access|model_calls)\s+SET\s+(?!hash\s*=\s*\?\s+WHERE)/i.test(
            text,
          ))(readFileSync(f, "utf8")),
      )
      .map((f) => f.slice(root.length + 1));
    // Removing them (the advice «model-texts» or «history», if Juan ever says so) must take their kept sums down too.
    expect(bad, "rows deleted from a table the storage figures keep summed (migration 23)").toEqual(
      [],
    );
  });
});
