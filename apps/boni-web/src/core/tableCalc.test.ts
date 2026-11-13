// Tests of a table's calculations and groups (task 76), with rows shaped like Juan's and at his volume.
import { describe, expect, it } from "vitest";
import type { DataField, DataRow } from "./agent.ts";
import { cpu } from "./cpu.test-util.ts";
import { calcsFor, calcValue, groupRows } from "./tableCalc.ts";

const estado: DataField = {
  id: "f_estado",
  name: "Estado",
  type: "select",
  options: [
    { id: "o_pendiente", name: "Pendiente" },
    { id: "o_hecho", name: "Hecho" },
  ],
};
const horas: DataField = { id: "f_horas", name: "Horas", type: "number" };
const dia: DataField = { id: "f_dia", name: "Día", type: "date" };
const hecha: DataField = { id: "f_hecha", name: "Hecha", type: "checkbox" };
const area: DataField = {
  id: "f_area",
  name: "Área",
  type: "relation",
  relation: { target: "t_area", many: true },
};
const etiquetas: DataField = { id: "f_tags", name: "Etiquetas", type: "multiselect" };
const row = (i: number, values: DataRow["values"]): DataRow => ({
  id: `e_01m6p4${String(i).padStart(6, "0")}abcd`,
  values,
  updated: 0,
});

describe("a table's calculations (task 76)", () => {
  const rows = [
    row(1, { f_horas: 2, f_dia: "2026-11-03", f_hecha: true, f_estado: "o_hecho" }),
    row(2, { f_horas: 5, f_dia: "2026-11-01", f_estado: "o_pendiente" }),
    row(3, { f_horas: 3, f_hecha: false, f_estado: "o_pendiente" }),
    row(4, { f_dia: "2026-11-10" }),
  ];
  it("offers what each kind of column can calculate", () => {
    expect(calcsFor(estado)).toEqual([
      "count",
      "filled",
      "empty",
      "unique",
      "percentFilled",
      "percentEmpty",
    ]);
    expect(calcsFor(horas)).toContain("median");
    expect(calcsFor(dia)).toEqual(expect.arrayContaining(["earliest", "latest", "range"]));
    expect(calcsFor(dia)).not.toContain("sum");
    expect(calcsFor(hecha)).toEqual(["count", "checked", "unchecked", "percentChecked"]);
  });
  it("counts, measures numbers and dates, and says nothing over nothing", () => {
    expect(calcValue("count", estado, rows)).toEqual({ kind: "count", n: 4 });
    expect(calcValue("filled", estado, rows)).toEqual({ kind: "count", n: 3 });
    expect(calcValue("empty", estado, rows)).toEqual({ kind: "count", n: 1 });
    expect(calcValue("unique", estado, rows)).toEqual({ kind: "count", n: 2 });
    expect(calcValue("percentEmpty", estado, rows)).toEqual({ kind: "percent", n: 25 });
    expect(calcValue("sum", horas, rows)).toEqual({ kind: "number", n: 10 });
    expect(calcValue("average", horas, rows)).toMatchObject({ n: 10 / 3 });
    expect(calcValue("median", horas, rows)).toMatchObject({ n: 3 });
    expect(calcValue("range", horas, rows)).toMatchObject({ n: 3 });
    expect(calcValue("earliest", dia, rows)).toEqual({ kind: "date", value: "2026-11-01" });
    expect(calcValue("latest", dia, rows)).toEqual({ kind: "date", value: "2026-11-10" });
    expect(calcValue("range", dia, rows)).toEqual({ kind: "days", n: 9 });
    expect(calcValue("checked", hecha, rows)).toEqual({ kind: "count", n: 1 });
    expect(calcValue("percentChecked", hecha, rows)).toEqual({ kind: "percent", n: 25 });
    expect(calcValue("sum", horas, [])).toBeNull();
    expect(calcValue("percentFilled", estado, [])).toEqual({ kind: "percent", n: 0 });
    // Money sums its amounts, in its currency.
    const gasto: DataField = { id: "f_importe", name: "Importe", type: "money" };
    expect(
      calcValue("sum", gasto, [
        row(5, { f_importe: { amount: -12.5, currency: "EUR" } }),
        row(6, { f_importe: { amount: -7.5, currency: "EUR" } }),
      ]),
    ).toEqual({ kind: "number", n: -20, currency: "EUR" });
  });
});

describe("a table's rows grouped by a column (task 76)", () => {
  it("in the options' order, ticked first, by the titles a relation points to, the empty last", () => {
    const rows = [
      row(1, { f_estado: "o_hecho", f_hecha: true, f_area: ["e_b"], f_tags: ["casa", "ya"] }),
      row(2, { f_estado: "o_pendiente", f_area: ["e_a", "e_b"], f_tags: ["casa"] }),
      row(3, { f_estado: null }),
    ];
    const keys = (f: DataField, titles?: Record<string, string>) =>
      groupRows(rows, f, titles).map((g) => [g.key, g.rows.length]);
    expect(keys(estado)).toEqual([
      ["o_pendiente", 1],
      ["o_hecho", 1],
      ["", 1],
    ]);
    expect(keys(hecha)).toEqual([
      ["true", 1],
      ["false", 2],
    ]);
    expect(keys(area, { e_a: "Trabajo", e_b: "Casa" })).toEqual([
      ["e_b", 2],
      ["e_a", 1],
      ["", 1],
    ]);
    expect(keys(etiquetas)).toEqual([
      ["casa", 2],
      ["ya", 1],
      ["", 1],
    ]);
    expect(keys(dia)).toEqual([["", 3]]);
  });

  it("at Juan's volume: 3,000 tasks grouped and calculated in a few milliseconds (A-15)", () => {
    const many = Array.from({ length: 3000 }, (_, i) =>
      row(i, {
        f_estado: i % 3 ? "o_pendiente" : "o_hecho",
        f_horas: i % 7,
        f_dia: `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
        f_hecha: i % 2 === 0,
      }),
    );
    const t0 = cpu();
    for (let k = 0; k < 10; k++) {
      groupRows(many, estado);
      groupRows(many, dia);
      for (const c of calcsFor(horas)) calcValue(c, horas, many);
      for (const c of calcsFor(dia)) calcValue(c, dia, many);
    }
    // A few ms of CPU: the bound, in the thread's CPU time (task 116), catches worse than linear (3,000² is seconds).
    expect((cpu() - t0) / 10).toBeLessThan(250);
    expect(groupRows(many, estado).map((g) => g.rows.length)).toEqual([2000, 1000]);
  }, 120_000);

  it("measures a list too long to spread into Math.max (a stack's worth of values)", () => {
    const long = Array.from({ length: 300_000 }, (_, i) =>
      row(i, { f_horas: i % 1000, f_dia: i % 2 ? "2026-01-01" : "2026-12-31" }),
    );
    expect(calcValue("max", horas, long)).toEqual({ kind: "number", n: 999 });
    expect(calcValue("range", horas, long)).toEqual({ kind: "number", n: 999 });
    expect(calcValue("range", dia, long)).toEqual({ kind: "days", n: 364 });
  });
});
