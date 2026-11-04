import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { openUserStore } from "./store.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

const DAY = 86_400_000;

describe("the journal's model calls by when (task 43)", () => {
  it("reads the last days' calls and the spending from the index, never the rows with their texts", () => {
    const dir = mkdtempSync(join(tmpdir(), "boni-journal-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "user.db");
    const store = openUserStore(path);
    cleanups.push(() => store.close());
    // Invented calls shaped like his: 400 of them over 40 days, each carrying a 40 KB prompt and answer.
    const big = "x".repeat(40_000);
    const start = Date.UTC(2026, 9, 1);
    store.batch(() => {
      for (let i = 0; i < 400; i++)
        store.journal.modelCall({
          run: `r${i % 50}`,
          role: i % 3 ? "reader" : "planner",
          provider: "fake",
          model: i % 2 ? "m-uno" : "m-dos",
          promptHash: "h",
          request: { text: big },
          response: { text: big },
          usage: { input: 1000, output: 100, cost: 0.01 },
          at: start + (i % 40) * DAY + i,
        });
    });
    const from = start + 10 * DAY;
    const to = start + 41 * DAY;
    const t0 = performance.now();
    const calls = store.journal.modelCallsIn(from, to);
    const spend = store.journal.spending(from, to);
    const ms = performance.now() - t0;
    console.log(`400 calls of 80 KB each: the last 30 days read and summed in ${ms.toFixed(1)} ms`);
    expect(calls).toHaveLength(300);
    expect(calls[0]).toMatchObject({
      role: "reader",
      model: "m-dos",
      input: 1000,
      output: 100,
      cost: 0.01,
    });
    expect(spend.reduce((n, r) => n + r.calls, 0)).toBe(300);
    expect(ms).toBeLessThan(200);
    store.close();
    cleanups.pop();
    // The plan: both queries served by the covering index (the rows, with their texts, are never read).
    const db = new DatabaseSync(path);
    try {
      expect(
        (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      ).toBeGreaterThanOrEqual(13);
      const plan = (sql: string) =>
        (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[])
          .map((r) => r.detail)
          .join("; ");
      expect(
        plan(
          `SELECT rowid AS n, run, role, provider, model, at, coalesce(json_extract(usage, '$.input'), 0) AS input
           FROM model_calls WHERE at >= ? AND at < ? ORDER BY at, rowid`,
        ),
      ).toContain("COVERING INDEX model_calls_at");
      expect(
        plan(
          `SELECT role, provider, model, count(*) AS calls, coalesce(sum(json_extract(usage, '$.cost')), 0) AS cost
           FROM model_calls WHERE at >= ? AND at < ? GROUP BY role, provider, model`,
        ),
      ).toContain("COVERING INDEX model_calls_at");
    } finally {
      db.close();
    }
    // An existing store opens again and keeps its calls (the migration ran once).
    const again = openUserStore(path);
    cleanups.push(() => again.close());
    expect(again.journal.modelCallsIn(from, to)).toHaveLength(300);
  });
});
