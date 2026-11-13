import { describe, expect, it } from "vitest";
import { cpu } from "./cpu.test-util.ts";
import { filterErrors, matchesFilters } from "./filter.ts";

const TYPES: Record<string, string> = {
  f_titulo: "text",
  f_cat: "select",
  f_tags: "multiselect",
  f_importe: "money",
  f_fecha: "date",
  f_hecha: "checkbox",
};
const typeOf = (id: string) => TYPES[id];
const row = {
  f_titulo: "Cita en el Médico",
  f_cat: "o_salud",
  f_tags: ["o_a", "o_b"],
  f_importe: { amount: -40, currency: "EUR" },
  f_fecha: "2026-10-20",
  f_hecha: true,
};

describe("filters", () => {
  it("match as Notion's: text without accents or case, options, money, dates, today", () => {
    const m = (rules: Parameters<typeof matchesFilters>[2]) =>
      matchesFilters(row, typeOf, rules, "2026-10-22");
    expect(m([{ field: "f_titulo", op: "contains", value: "medico" }])).toBe(true);
    expect(m([{ field: "f_cat", op: "is", value: "o_salud" }])).toBe(true);
    expect(m([{ field: "f_tags", op: "contains", value: "o_b" }])).toBe(true);
    expect(m([{ field: "f_importe", op: "lt", value: 0 }])).toBe(true);
    expect(m([{ field: "f_fecha", op: "before", value: "today" }])).toBe(true);
    expect(m([{ field: "f_hecha", op: "unchecked" }])).toBe(false);
    expect(
      m([
        { field: "f_cat", op: "is", value: "o_salud" },
        { field: "f_importe", op: "gt", value: 0 },
      ]),
    ).toBe(false);
  });

  it("a rule on a field that is gone: left out, a match or no match, as asked", () => {
    const gone = [{ field: "f_borrado", op: "is" as const, value: "x" }];
    expect(matchesFilters(row, typeOf, gone, "2026-10-22")).toBe(true);
    expect(matchesFilters(row, typeOf, gone, "2026-10-22", "match")).toBe(true);
    expect(matchesFilters(row, typeOf, gone, "2026-10-22", "fail")).toBe(false);
  });

  it("checks the shape of a list of rules", () => {
    expect(filterErrors([{ field: "f_cat", op: "is", value: "o_salud" }])).toEqual([]);
    expect(filterErrors("x")).not.toEqual([]);
    expect(filterErrors([{ field: "f_cat", op: "drop" }])).not.toEqual([]);
    expect(filterErrors([{ field: "f_cat", op: "is", extra: 1 }])).not.toEqual([]);
    expect(filterErrors(new Array(21).fill({ field: "f_cat", op: "empty" }))).not.toEqual([]);
  });

  it("groups (task 75): «o» holds when one rule does, «y» when all do, beside the plain rules", () => {
    const m = (items: Parameters<typeof matchesFilters>[2]) =>
      matchesFilters(row, typeOf, items, "2026-10-22");
    const salud = { field: "f_cat", op: "is" as const, value: "o_salud" };
    const ingreso = { field: "f_importe", op: "gt" as const, value: 0 };
    const hecha = { field: "f_hecha", op: "checked" as const };
    expect(m([{ join: "or", rules: [ingreso, salud] }])).toBe(true);
    expect(m([{ join: "or", rules: [ingreso, { ...salud, value: "o_ocio" }] }])).toBe(false);
    expect(m([{ join: "and", rules: [salud, hecha] }])).toBe(true);
    expect(m([{ join: "and", rules: [salud, ingreso] }])).toBe(false);
    // The plain rules and the group all hold.
    expect(m([hecha, { join: "or", rules: [ingreso, salud] }])).toBe(true);
    expect(
      m([
        { ...hecha, op: "unchecked" },
        { join: "or", rules: [ingreso, salud] },
      ]),
    ).toBe(false);
  });

  it("a group's rule on a field that is gone: left out, a match or no match, as for a plain rule", () => {
    const gone = { field: "f_borrado", op: "is" as const, value: "x" };
    const no = { field: "f_importe", op: "gt" as const, value: 0 };
    const or = [{ join: "or" as const, rules: [gone, no] }];
    expect(matchesFilters(row, typeOf, or, "2026-10-22")).toBe(false);
    expect(matchesFilters(row, typeOf, or, "2026-10-22", "match")).toBe(true);
    expect(matchesFilters(row, typeOf, or, "2026-10-22", "fail")).toBe(false);
    const allGone = [{ join: "or" as const, rules: [gone] }];
    expect(matchesFilters(row, typeOf, allGone, "2026-10-22")).toBe(true);
    expect(matchesFilters(row, typeOf, allGone, "2026-10-22", "fail")).toBe(false);
  });

  it("a view saved before groups (a list of plain rules) checks and matches as before", () => {
    const old = JSON.parse(
      '[{"field":"f_cat","op":"is","value":"o_salud"},{"field":"f_hecha","op":"checked"}]',
    );
    expect(filterErrors(old)).toEqual([]);
    expect(matchesFilters(row, typeOf, old, "2026-10-22")).toBe(true);
  });

  it("checks the shape of a group: «y» or «o», one or more rules, one level, 20 rules in all", () => {
    const r = { field: "f_cat", op: "is", value: "o_salud" };
    expect(filterErrors([r, { join: "or", rules: [r, r] }])).toEqual([]);
    expect(filterErrors([{ join: "xor", rules: [r] }])).not.toEqual([]);
    expect(filterErrors([{ join: "or", rules: [] }])).not.toEqual([]);
    expect(filterErrors([{ join: "or", rules: [r], extra: 1 }])).not.toEqual([]);
    expect(filterErrors([{ join: "or", rules: [{ join: "and", rules: [r] }] }])).not.toEqual([]);
    expect(filterErrors([{ join: "or", rules: [{ field: "f_cat", op: "drop" }] }])).not.toEqual([]);
    expect(
      filterErrors([...new Array(10).fill(r), { join: "or", rules: new Array(11).fill(r) }]),
    ).not.toEqual([]);
    expect(
      filterErrors([...new Array(10).fill(r), { join: "or", rules: new Array(10).fill(r) }]),
    ).toEqual([]);
  });

  it("a group over his volume (A-15): 5,000 records shaped like his, each read of the view in a few ms", () => {
    // Generated ids and keys as his store makes them, a task's fields: title, project, area, done, a date.
    const id = (p: string, i: number) => `${p}_01m6${i.toString(36).padStart(10, "0")}`;
    const f = {
      title: id("f", 1),
      project: id("f", 2),
      area: id("f", 3),
      done: id("f", 4),
      day: id("f", 5),
    };
    const types: Record<string, string> = {
      [f.title]: "text",
      [f.project]: "relation",
      [f.area]: "select",
      [f.done]: "checkbox",
      [f.day]: "date",
    };
    const areas = [id("o", 1), id("o", 2), id("o", 3), id("o", 4)];
    const rows = Array.from({ length: 5000 }, (_, i) => ({
      [f.title]: `${i}. Tarea inventada número ${i}`,
      [f.project]: [id("e", i % 80)],
      [f.area]: areas[i % 4],
      [f.done]: i % 3 === 0,
      [f.day]: `2026-${String((i % 12) + 1).padStart(2, "0")}-15`,
    }));
    const items: Parameters<typeof matchesFilters>[2] = [
      { field: f.done, op: "unchecked" },
      {
        join: "or",
        rules: [
          { field: f.title, op: "contains", value: "inventada número 1" },
          { field: f.area, op: "is", value: areas[2] },
          { field: f.day, op: "after", value: "2026-10-31" },
        ],
      },
    ];
    const typeOf = (x: string) => types[x];
    // Timed in this thread's CPU time, not on the clock: a busy machine stops the thread while the clock goes on, and
    // the clock read 110-147 ms for what takes a few (task 113: `make check` beside seven other sessions' checks).
    const start = cpu();
    let kept = 0;
    for (let n = 0; n < 10; n++)
      kept = rows.filter((r) => matchesFilters(r, typeOf, items, "2026-11-12")).length;
    const each = (cpu() - start) / 10;
    console.log(`a group over 5,000 records: ${each.toFixed(1)} ms of CPU each read`);
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(5000);
    // Measured at 2026-11-12 on the laptop: see the PR; the bound only catches a change of order.
    expect(each).toBeLessThan(100);
  }, 120_000);
});
