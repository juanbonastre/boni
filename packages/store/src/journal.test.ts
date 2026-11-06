import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { CALLS_BY_STEP } from "./journal.ts";
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

describe("a flow's steps: their model calls (task 90)", () => {
  it("counts each step's calls and cost in a period, its tries and other flows apart, from an index (A-15)", () => {
    const dir = mkdtempSync(join(tmpdir(), "boni-journal-"));
    const path = join(dir, "user.db");
    const store = openUserStore(path);
    cleanups.push(() => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    });
    const j = store.journal;
    const start = Date.UTC(2026, 9, 1);
    // A model's texts as big as a mail's reading: the rows that hold them must not be read to count.
    const big = "x".repeat(20_000);
    const run = (id: string, flow: string, origin: string, at: number) =>
      j.startRun({ id, turn: null, origin, device: null, started: at, flow, flowVersion: 1 });
    const call = (r: string, step: string | null, cost: number, at: number) =>
      j.modelCall({
        run: r,
        role: step ? "reader" : "planner",
        provider: "anthropic",
        model: "claude-haiku-4-5",
        promptHash: "h",
        request: { text: big },
        response: { text: big },
        usage: { input: 1000, output: 100, cost },
        at,
        step,
      });
    store.batch(() => {
      for (let i = 0; i < 30; i++) {
        const at = start + i * DAY;
        run(`m${i}`, "leer-correo", "background", at);
        call(`m${i}`, "r", 0.002, at + 10);
        if (i % 3 === 0) call(`m${i}`, "n0_tasks_f", 0.001, at + 20);
      }
      // A try of the editor, another flow, a planner's call and one before the period: none counts.
      run("t1", "leer-correo", "test", start + DAY);
      call("t1", "r", 0.5, start + DAY + 10);
      run("o1", "otro", "background", start + DAY);
      call("o1", "r", 0.5, start + DAY + 10);
      run("p1", "leer-correo", "background", start + 2 * DAY);
      call("p1", null, 0.5, start + 2 * DAY + 10);
      run("old", "leer-correo", "background", start - DAY);
      call("old", "r", 0.5, start - DAY + 10);
    });
    const got = j
      .callsByStep("leer-correo", start, start + 30 * DAY)
      .sort((a, b) => a.step.localeCompare(b.step));
    expect(got.map((x) => ({ ...x, cost: Math.round(x.cost * 1000) / 1000 }))).toEqual([
      { step: "n0_tasks_f", calls: 10, cost: 0.01 },
      { step: "r", calls: 30, cost: 0.06 },
    ]);
    // Served by the index that covers what it sums: the rows with the texts are never read.
    const db = new DatabaseSync(path);
    try {
      // The method's own statement, not a copy of it.
      const plan = (
        db.prepare(`EXPLAIN QUERY PLAN ${CALLS_BY_STEP}`).all("leer-correo", 0, 1) as {
          detail: string;
        }[]
      )
        .map((r) => r.detail)
        .join("; ");
      expect(plan).toContain("COVERING INDEX model_calls_step");
      expect(plan).toContain("runs_flow");
    } finally {
      db.close();
    }
  });
});

describe("flows (docs/flujos.md, F1)", () => {
  it("keeps a flow as versions, the latest being the flow; a run says which it executed", () => {
    const dir = mkdtempSync(join(tmpdir(), "boni-journal-"));
    const store = openUserStore(join(dir, "user.db"));
    cleanups.push(() => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    });
    const j = store.journal;
    const plan = { version: 1, steps: [{ id: "m", op: "call", tool: "entities.get", args: {} }] };
    const first = j.saveFlow({
      id: "leer-correo",
      name: "Leer correo",
      trigger: { created: "correo" },
      inputs: [{ id: "mail", what: "record" }],
      plan,
      layout: null,
      by: "preset",
      enabled: true,
      created: 1000,
    });
    expect(first).toMatchObject({ version: 1, hash: expect.any(String) });
    expect(j.flows().map((f) => [f.id, f.version])).toEqual([["leer-correo", 1]]);
    // The same plan again is still the same hash; a changed one is a new version, and the flow is the latest.
    const again = j.saveFlow({
      ...first,
      plan: { ...plan, steps: [...plan.steps, { id: "r", op: "read" }] },
    });
    expect(again.version).toBe(2);
    expect(again.hash).not.toBe(first.hash);
    expect(j.flow("leer-correo")?.version).toBe(2);
    expect(j.flow("leer-correo", 1)?.plan).toEqual(plan);
    expect(j.flowVersions("leer-correo").map((f) => f.version)).toEqual([2, 1]);
    expect(j.flow("nadie")).toBeNull();
    j.setFlowEnabled("leer-correo", false);
    expect(j.flow("leer-correo")?.enabled).toBe(false);
    expect(j.flow("leer-correo", 1)?.enabled).toBe(true);
    // Runs of the flow, and their steps counted per step.
    j.startRun({
      id: "run-1",
      turn: null,
      origin: "background",
      device: null,
      started: 2000,
      flow: "leer-correo",
      flowVersion: 2,
      input: "e_mail1",
    });
    j.startRun({
      id: "run-2",
      turn: null,
      origin: "background",
      device: null,
      started: 3000,
      flow: "leer-correo",
      flowVersion: 2,
      input: "e_mail2",
    });
    j.startRun({ id: "run-3", turn: null, origin: "background", device: null, started: 3500 });
    expect(j.run("run-1")).toMatchObject({ flow: "leer-correo", flowVersion: 2, input: "e_mail1" });
    expect(j.run("run-3")).toMatchObject({ flow: null, flowVersion: null, input: null });
    expect(j.flowRuns("leer-correo")).toEqual({ runs: 2, last: 3000 });
    expect(j.flowRuns("nadie")).toEqual({ runs: 0, last: null });
    for (const [run, step, decision] of [
      ["run-1", "m", "allow"],
      ["run-1", "r", "allow"],
      ["run-2", "m", "allow"],
      ["run-2", "r", "deny"],
      ["run-3", "m", "allow"],
    ] as const)
      j.step({ run, step, kind: "call", decision, rule: null, detail: null, at: 4000 });
    expect(j.stepCountsOf("leer-correo", 0, 10_000)).toEqual([
      { step: "m", decision: "allow", n: 2 },
      { step: "r", decision: "allow", n: 1 },
      { step: "r", decision: "deny", n: 1 },
    ]);
    expect(j.stepCountsOf("leer-correo", 2500, 10_000)).toEqual([
      { step: "m", decision: "allow", n: 1 },
      { step: "r", decision: "deny", n: 1 },
    ]);
  });
});
