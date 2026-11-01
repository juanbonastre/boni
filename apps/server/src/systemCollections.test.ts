import { openUserStore } from "@boni/store";
import { describe, expect, it } from "vitest";
import { systemCollections } from "./systemCollections.ts";

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
});
