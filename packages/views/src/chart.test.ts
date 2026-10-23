import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type ChartSpec, computeChart, SpecError } from "./chart.ts";
import {
  type Debt,
  kindByName,
  kindFrom,
  type Movement,
  moneyProfile,
  moneyRecords,
  monthsWithData,
} from "./money.ts";
import { pyRound, pySum } from "./pyround.ts";

/**
 * The golden test of the port: golden/cases.json is what the ORIGINAL Python engine of the first Boni
 * computed for each spec on golden/money.json (invented data, golden/make_golden.py). Every number,
 * label, order, flag and error message must be the same.
 */
const read = (f: string) =>
  JSON.parse(readFileSync(new URL(`../golden/${f}`, import.meta.url), "utf8"));
const money = read("money.json") as { movements: Movement[]; debts: Debt[] };
const cases = read("cases.json") as {
  name: string;
  today: string;
  spec: ChartSpec;
  drill: string | null;
  result: unknown;
}[];
const recs = moneyRecords(money.movements, money.debts);
const months = monthsWithData(money.movements);

describe("the chart engine gives what the Python one gave", () => {
  it("has the golden cases", () => expect(cases.length).toBeGreaterThan(90));
  for (const c of cases)
    it(`${c.name} (today ${c.today})`, () => {
      const run = () =>
        computeChart(moneyProfile, { id: "c1", ...c.spec }, recs, {
          today: c.today,
          monthsWithData: months,
          drill: c.drill,
        });
      const want = c.result as { error?: string };
      if (want.error) {
        expect(run).toThrow(SpecError);
        expect(run).toThrow(want.error);
      } else expect(run()).toEqual(want);
    });
});

describe("the kind of each category", () => {
  it("by name gives the first Boni's records; the account's kinds change only what they say", () => {
    const same = moneyRecords(
      money.movements,
      money.debts,
      kindFrom(new Map(money.movements.map((m) => [m.category, kindByName(m.category)]))),
    );
    expect(same).toEqual(recs);
    const cat = money.movements.find((m) => m.amount < 0 && kindByName(m.category) === "gasto")
      ?.category as string;
    const other = moneyRecords(money.movements, money.debts, kindFrom(new Map([[cat, "otro"]])));
    const spent = (r: typeof recs) =>
      pySum(r.filter((x) => x.category === cat).map((x) => x.spending));
    expect(spent(recs)).toBeGreaterThan(0);
    expect(spent(other)).toBe(0);
    // The rest as they were.
    expect(other.filter((x) => x.category !== cat)).toEqual(recs.filter((x) => x.category !== cat));
  });
});

describe("Python's rounding", () => {
  it("rounds an exact tie to even and the rest to the nearest", () => {
    expect(pyRound(0.125, 2)).toBe(0.12); // toFixed would say 0.13
    expect(pyRound(0.375, 2)).toBe(0.38);
    expect(pyRound(2.675, 2)).toBe(2.67); // 2.675 is a bit below in binary
    expect(pyRound(-1.005, 2)).toBe(-1);
    expect(pyRound(12.3456, 1)).toBe(12.3);
    expect(Object.is(pyRound(-0.001, 2), 0)).toBe(true);
    expect(pyRound(2.5, 0)).toBe(2);
    expect(pyRound(3.5, 0)).toBe(4);
  });
});

describe("Python's sum", () => {
  it("compensates as CPython 3.12 does", () => {
    expect(pySum([0.1, 0.2, 0.3])).toBe(0.6); // plain addition gives 0.6000000000000001
    expect(0.1 + 0.2 + 0.3).not.toBe(0.6);
    expect(pySum([1e16, 1, -1e16])).toBe(1);
    expect(pySum([])).toBe(0);
  });
});
