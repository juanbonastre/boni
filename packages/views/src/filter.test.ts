import { describe, expect, it } from "vitest";
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
});
