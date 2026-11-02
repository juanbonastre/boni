// The Registro's «Acierto»: Boni's decisions counted per area and per level of confidence (docs/fiabilidad.md §3.3).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openUserStore } from "@boni/store";
import { afterEach, describe, expect, it } from "vitest";
import { accuracy } from "./accuracy.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

describe("how right Boni's decisions are (docs/fiabilidad.md)", () => {
  it("counts each area's last decisions: alone, asked, left, judged and right, and by level", () => {
    const dir = mkdtempSync(join(tmpdir(), "boni-accuracy-"));
    const store = openUserStore(join(dir, "user.db"));
    cleanups.push(() => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    });
    const j = store.journal;
    const base = { run: "r", area: "choice", cost: "A" as const, detail: null };
    j.addDecision({ ...base, id: "d1", p: 0.95, outcome: "do", at: 1 });
    j.addDecision({ ...base, id: "d2", p: 0.65, outcome: "do", at: 2 });
    j.addDecision({ ...base, id: "d3", p: 0.4, outcome: "ask", at: 3 });
    j.addDecision({ ...base, id: "d4", p: 0.7, outcome: "do", at: 4 });
    j.addDecision({ ...base, id: "d5", area: "fill", p: 0.2, outcome: "nothing", at: 5 });
    j.setDecisionResult("d1", "right", 6);
    j.setDecisionResult("d2", "wrong", 7);
    const [choice, fill] = accuracy(store);
    expect(choice).toMatchObject({
      area: "choice",
      total: 4,
      done: 3,
      asked: 1,
      nothing: 0,
      judged: 2,
      right: 1,
    });
    expect(choice?.levels.filter((l) => l.judged).map((l) => [l.from, l.judged, l.right])).toEqual([
      [0.6, 1, 0],
      [0.9, 1, 1],
    ]);
    expect(fill).toMatchObject({ area: "fill", total: 1, done: 0, nothing: 1, judged: 0 });
    expect(accuracy(openUserStore(":memory:"))).toEqual([]);
  });
});
