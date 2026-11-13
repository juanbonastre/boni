import { describe, expect, it } from "vitest";
import { parseNumber } from "./answers.ts";

describe("a number typed on a question's card (§3.4)", () => {
  it("reads Spanish: a comma decimal and dots in thousands", () => {
    expect(parseNumber("12,5", "es")).toBe(12.5);
    expect(parseNumber("1.250", "es")).toBe(1250);
    expect(parseNumber("1.250,75", "es")).toBe(1250.75);
    expect(parseNumber("1 250", "es")).toBe(1250);
    expect(parseNumber("-3", "es")).toBe(-3);
    expect(parseNumber(",5", "es")).toBe(0.5);
    // A dot as a decimal, as people also write it.
    expect(parseNumber("12.5", "es")).toBe(12.5);
  });

  it("reads English: a dot decimal and commas in thousands", () => {
    expect(parseNumber("12.5", "en")).toBe(12.5);
    expect(parseNumber("1,250", "en")).toBe(1250);
    expect(parseNumber("1,250.75", "en")).toBe(1250.75);
    expect(parseNumber("12,5", "en")).toBe(12.5);
  });

  it("refuses what is not a number", () => {
    for (const x of ["", " ", "doce", "12a", "5,", "1,2,3", "1.250,5.3", "--3", "1e5", "Infinity"])
      expect(parseNumber(x, "es")).toBeNull();
    expect(parseNumber("9".repeat(17), "es")).toBeNull();
  });
});
