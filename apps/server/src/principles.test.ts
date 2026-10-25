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
});
