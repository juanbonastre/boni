// The executors of «Transformar» and «Lógica» one by one (steps.ts), with a context built by hand: what each gives
// for some rows, its edge cases (empty values, an empty list, money), and the labels of what it computes.
import { join } from "@boni/entities";
import { describe, expect, it } from "vitest";
import { EXECUTORS, executorKey, type StepContext, type StepOutput } from "./engine.ts";
import { resolve, type Scope } from "./expression.ts";
import { MAIN, type ParamValue, type Step } from "./format.ts";
import type { Row } from "./rows.ts";
import { dates, OUTSIDE, OWN } from "./run.test-util.ts";
import { compare } from "./steps.ts";

const NOW = Date.UTC(2026, 10, 2, 23, 30);
const row = (json: Row["json"], fields?: Row["fields"]): Row => ({
  json,
  label: OWN,
  ...(fields ? { fields } : {}),
  path: null,
  parent: null,
});

/** Runs one step's executor on these rows, as the engine would (row by row, or all at once). */
async function exec(
  type: string,
  params: Record<string, ParamValue>,
  rows: Row[],
  inputs?: Record<string, Row[]>,
): Promise<StepOutput> {
  const step: Step = { id: "s_1", name: "Paso", type, params };
  const action = typeof params.action === "string" ? params.action : "run";
  const executor = EXECUTORS[executorKey(type, action)];
  if (!executor) throw new Error(`no executor for ${type}.${action}`);
  const ctx = (current: Row | null): StepContext => {
    const scope: Scope = {
      current,
      literal: OWN,
      row: () => {
        throw new Error("no steps here");
      },
    };
    return {
      step,
      action,
      gate: undefined as never,
      dates,
      zone: "Europe/Madrid",
      locale: "es",
      now: NOW,
      value: (p) => resolve(p, scope),
      scope,
    };
  };
  if (executor.mode === "all") return executor.run(ctx(null), inputs ?? { [MAIN]: rows });
  const out: Record<string, StepOutput[string][number][]> = {};
  for (const [i, r] of rows.entries())
    for (const [k, v] of Object.entries(await executor.run(ctx(r), r, i)))
      out[k] = [...(out[k] ?? []), ...v];
  return out;
}
const jsons = (o: StepOutput, output = MAIN) => o[output]?.map((r) => r.json);

describe("Transformar", () => {
  it("sorts in a fixed order, never the locale's: empty values last either way, ties as they came", async () => {
    const rows = [
      { n: 2, t: "b" },
      { n: null, t: "a" },
      { n: 10, t: "Á" },
      { n: 2, t: "a" },
    ].map((j) => row(j));
    const asc = await exec("sort", { by: [{ field: "n" }] }, rows);
    expect(jsons(asc)?.map((j) => j.t)).toEqual(["b", "a", "Á", "a"]);
    expect(asc[MAIN]?.map((r) => r.from)).toEqual([0, 3, 2, 1]);
    const desc = await exec(
      "sort",
      { by: [{ field: "n", direction: "desc" }, { field: "t" }] },
      rows,
    );
    expect(jsons(desc)?.map((j) => j.t)).toEqual(["Á", "a", "b", "a"]);
    expect(compare("Z", "a")).toBeLessThan(0);
    expect(compare({ amount: 3, currency: "EUR" }, 2)).toBeGreaterThan(0);
  });

  it("limits to the first or the last rows, and refuses a count that is not a whole number", async () => {
    const rows = [1, 2, 3, 4].map((n) => row({ n }));
    expect(jsons(await exec("limit", { count: 2 }, rows))).toEqual([{ n: 1 }, { n: 2 }]);
    const last = await exec("limit", { count: 2, from: "last" }, rows);
    expect(jsons(last)).toEqual([{ n: 3 }, { n: 4 }]);
    expect(last[MAIN]?.map((r) => r.from)).toEqual([2, 3]);
    expect(jsons(await exec("limit", { count: 9 }, rows))).toHaveLength(4);
    await expect(exec("limit", { count: 1.5 }, rows)).rejects.toThrow(/whole number/);
  });

  it("removes duplicates by the whole row, whatever the order of its keys, or by some fields", async () => {
    const rows = [
      row({ a: 1, b: { x: 1, y: 2 } }),
      row({ b: { y: 2, x: 1 }, a: 1 }),
      row({ a: 1, b: 3 }),
    ];
    expect(jsons(await exec("dedupe", {}, rows))).toHaveLength(2);
    const byA = await exec("dedupe", { by: "fields", fields: [{ field: "a" }] }, rows);
    expect(byA[MAIN]?.map((r) => r.from)).toEqual([0]);
  });

  it("groups in the order groups first appear, with every measure named <measure>_<field> (a count of rows is count); with nothing to group by, one row even with none", async () => {
    const eur = (amount: number) => ({ amount, currency: "EUR" });
    const rows = [
      row({ k: "b", n: 4, m: eur(1), t: "x" }, { n: { label: OUTSIDE, derived: false } }),
      row({ k: "a", n: 1, m: eur(2), t: null }),
      row({ k: "b", n: 2, m: eur(3), t: "y" }),
    ];
    const measures: ParamValue[] = [
      { measure: "count" },
      { measure: "count", field: "t" },
      { measure: "sum", field: "n" },
      { measure: "average", field: "n" },
      { measure: "min", field: "n" },
      { measure: "max", field: "n" },
      { measure: "sum", field: "m" },
      { measure: "list", field: "t" },
    ];
    const out = await exec("group", { by: [{ field: "k" }], measures }, rows);
    expect(jsons(out)).toEqual([
      {
        k: "b",
        count: 2,
        count_t: 2,
        sum_n: 6,
        average_n: 3,
        min_n: 2,
        max_n: 4,
        sum_m: eur(4),
        list_t: ["x", "y"],
      },
      {
        k: "a",
        count: 1,
        count_t: 0,
        sum_n: 1,
        average_n: 1,
        min_n: 1,
        max_n: 1,
        sum_m: eur(2),
        list_t: [null],
      },
    ]);
    // What was computed from a field from outside carries its label, and is derived.
    expect(out[MAIN]?.[0]?.fields?.sum_n).toEqual({ label: join(OWN, OUTSIDE), derived: true });
    expect(out[MAIN]?.[1]?.fields?.sum_n).toEqual({ label: OWN, derived: true });

    expect(jsons(await exec("group", { measures: [{ measure: "count" }] }, []))).toEqual([
      { count: 0 },
    ]);
    expect(jsons(await exec("group", { by: [{ field: "k" }], measures }, []))).toEqual([]);
    const mixed = [row({ m: eur(1) }), row({ m: { amount: 1, currency: "USD" } })];
    await expect(
      exec("group", { measures: [{ measure: "sum", field: "m" }] }, mixed),
    ).rejects.toThrow(/currencies/);
  });

  it("splits a list into rows, keeping the rest of the row or not; an empty value gives none", async () => {
    const r = row({ l: ["a", "b"], o: 1 });
    expect(jsons(await exec("split", { field: "l" }, [r]))).toEqual([
      { l: "a", o: 1 },
      { l: "b", o: 1 },
    ]);
    expect(jsons(await exec("split", { field: "l", keep: "none" }, [r]))).toEqual([
      { l: "a" },
      { l: "b" },
    ]);
    expect(jsons(await exec("split", { field: "l" }, [row({ l: null })]))).toEqual([]);
  });

  it("joins every row into one: each field a list, or the rows themselves in one field", async () => {
    const rows = [row({ a: 1 }), row({ a: 2, b: "x" })];
    expect(jsons(await exec("join", {}, rows))).toEqual([{ a: [1, 2], b: ["x"] }]);
    expect(jsons(await exec("join", { into: "rows", to: "filas" }, rows))).toEqual([
      { filas: [{ a: 1 }, { a: 2, b: "x" }] },
    ]);
  });

  it("date arithmetic writes its result in a field of its own, derived, and leaves the rest of the row", async () => {
    const r = [row({ d: "2026-01-31" })];
    const date = { expr: "{{ $json.d }}" };
    const one = async (params: Record<string, ParamValue>) =>
      (await exec("date", { date, to: "r", ...params }, r))[MAIN]?.[0];
    expect((await one({ action: "add", amount: 1, unit: "months" }))?.json).toEqual({
      d: "2026-01-31",
      r: "2026-03-03",
    });
    expect((await one({ action: "diff", until: "2026-02-10" }))?.json.r).toBe(10);
    expect((await one({ action: "startOf" }))?.json.r).toBe("2026-01-01");
    expect((await one({ action: "part", part: "day" }))?.json.r).toBe(31);
    expect((await one({ action: "format" }))?.json.r).toBe("date:2026-01-31");
    expect((await one({ action: "part", part: "day" }))?.fields).toEqual({
      r: { label: OWN, derived: true },
    });
  });

  it("a condition reads «today» in Juan's time zone", async () => {
    // 23:30 UTC on the 2nd is already the 3rd in Madrid.
    const rows = [row({ d: "2026-11-02" }), row({ d: "2026-11-03" })];
    expect(
      jsons(await exec("filter", { where: [{ field: "d", op: "is", value: "today" }] }, rows)),
    ).toEqual([{ d: "2026-11-03" }]);
  });
});
