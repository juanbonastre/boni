import { openUserStore } from "@boni/store";
import { describe, expect, it, vi } from "vitest";
import { listTypes } from "./data.ts";
import { SYS_DATA, SYSTEM_COLLECTIONS, systemCollections } from "./systemCollections.ts";

/**
 * Boni's own records (calls to models, its activity, its runs) are dated by the account's day, as the blocks take
 * «today»: a call in the first minutes of a month counts in that month. Invented calls only.
 */
describe("Boni's own records", () => {
  it("date a call at 00:30 in Madrid on the 1st on the 1st, not on the 31st (UTC)", () => {
    const store = openUserStore(":memory:");
    const at = Date.UTC(2026, 9, 31, 23, 30); // 00:30 on 1 November in Madrid.
    store.journal.startRun({
      id: "r_ejemplo",
      turn: null,
      origin: "other",
      device: "portatil-ejemplo",
      started: at,
    });
    store.journal.finishRun("r_ejemplo", "done", null, at);
    store.journal.modelCall({
      run: "r_ejemplo",
      role: "planner",
      provider: "openrouter",
      model: "ejemplo/modelo-de-prueba",
      promptHash: "h",
      request: {},
      response: {},
      usage: { input: 100, output: 20, cost: 1 },
      at,
    });
    const day = (type: string, tz: string) =>
      systemCollections(store, { now: at + 60_000, usdToEur: 0.9, tz }).rows(type)[0]?.values
        .f_fecha;
    expect(day("t_sys_llamadas", "Europe/Madrid")).toBe("2026-11-01");
    expect(day("t_sys_runs", "Europe/Madrid")).toBe("2026-11-01");
    expect(day("t_sys_llamadas", "UTC")).toBe("2026-10-31");
    store.close();
  });

  it("are counted without being made, and made again only when something new is recorded (task 43)", () => {
    const store = openUserStore(":memory:");
    const at = Date.UTC(2026, 10, 3, 12);
    store.journal.startRun({
      id: "r_ejemplo",
      turn: null,
      origin: "background",
      device: null,
      started: at,
    });
    store.journal.finishRun("r_ejemplo", "done", null, at + 1000);
    const read = (when: number) =>
      store.audit.record({
        at: when,
        by: "mcp:claude-ejemplo",
        tool: "entities.search",
        target: { type: "t_ejemplo" },
        decision: "allow",
        result: { rows: 1 },
        seen: [
          {
            entity: "e_ejemplo",
            type: "t_ejemplo",
            version: 1,
            fields: [],
            shapes: [],
            body: "shape",
            files: [],
          },
        ],
      });
    read(at + 2000);
    const o = { now: at + 60_000, usdToEur: 0.9, tz: "UTC" };
    const sys = systemCollections(store, o);
    let made = 0;
    const types = listTypes(store, {
      ...sys,
      rows: (t) => {
        made++;
        return sys.rows(t);
      },
    });
    expect(made).toBe(0);
    // «Mis datos» is made apart, over these (myData.test.ts).
    for (const id of SYSTEM_COLLECTIONS.filter((x) => x !== SYS_DATA))
      expect(types.find((t) => t.id === id)?.count).toBe(sys.rows(id).length);
    expect(sys.rows("t_sys_runs")).toHaveLength(1);
    // Minutes later with nothing new: the same; a new read recorded: made again.
    expect(systemCollections(store, { ...o, now: o.now + 4 * 60_000 })).toBe(sys);
    read(o.now + 4 * 60_000);
    expect(systemCollections(store, { ...o, now: o.now + 4 * 60_000 + 1 })).not.toBe(sys);
    store.close();
  });

  it("keep the activity as a running sum: once counted, only what was recorded since is (task 43)", () => {
    const store = openUserStore(":memory:");
    const at = Date.UTC(2026, 10, 3, 12);
    const read = (when: number, n: number) =>
      store.audit.record({
        at: when,
        by: "mcp:claude-ejemplo",
        tool: "entities.search",
        target: { type: "t_ejemplo" },
        decision: "allow",
        result: { rows: n },
        seen: Array.from({ length: n }, (_, i) => ({
          entity: `e_${when}_${i}`,
          type: "t_ejemplo",
          version: 1,
          fields: [],
          shapes: [],
          body: "shape" as const,
          files: [],
        })),
      });
    read(at - 3 * 86_400_000, 2);
    read(at - 1000, 3);
    const o = { now: at, usdToEur: 0.9, tz: "Europe/Madrid" };
    const activity = (now: number) =>
      systemCollections(store, { ...o, now })
        .rows("t_sys_actividad")
        .map((r) => [r.values.f_fecha, r.values.f_filas]);
    expect(activity(at)).toEqual([
      ["2026-10-31", 2],
      ["2026-11-03", 3],
    ]);
    const since = vi.spyOn(store.audit, "activitySince");
    const last = store.audit.lastAction();
    read(at + 60_000, 4);
    expect(activity(at + 120_000)).toEqual([
      ["2026-10-31", 2],
      ["2026-11-03", 7],
    ]);
    // Only what came after the last one counted was asked for.
    expect(since.mock.calls[0]?.[0]).toBe(last);
    since.mockRestore();
    store.close();
  });
});
