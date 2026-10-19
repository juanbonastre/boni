import { describe, expect, it } from "vitest";
import { label } from "./label.ts";
import type { FieldDef, FieldType } from "./schema.ts";
import { checkValue, convertValue } from "./values.ts";

const L = label("user", "public", []);
const field = (type: FieldType, extra: Partial<FieldDef> = {}): FieldDef => ({
  id: "f_x",
  key: "x",
  name: "X",
  type,
  label: L,
  ...(type === "select" || type === "multiselect"
    ? {
        options: [
          { id: "o_a", name: "Leyendo", label: L },
          { id: "o_b", name: "Leído", label: L },
        ],
      }
    : {}),
  ...extra,
});

const good = (type: FieldType, v: unknown, extra?: Partial<FieldDef>) =>
  checkValue(field(type, extra), v);

describe("checkValue", () => {
  it("accepts what fits and normalises it", () => {
    expect(good("text", "  hola ")).toEqual({ ok: true, value: "hola" });
    expect(good("number", 12.5)).toEqual({ ok: true, value: 12.5 });
    expect(good("money", { amount: -1.6, currency: "EUR" })).toEqual({
      ok: true,
      value: { amount: -1.6, currency: "EUR" },
    });
    expect(good("select", "o_a")).toEqual({ ok: true, value: "o_a" });
    expect(good("multiselect", ["o_b", "o_a", "o_b"])).toEqual({ ok: true, value: ["o_a", "o_b"] });
    expect(good("date", "2024-02-29")).toEqual({ ok: true, value: "2024-02-29" });
    expect(good("time", "09:05")).toEqual({ ok: true, value: "09:05" });
    expect(good("datetime", "2026-10-19T20:14:00+02:00").ok).toBe(true);
    expect(good("dates", ["2026-10-20", "2026-10-19"])).toEqual({
      ok: true,
      value: ["2026-10-19", "2026-10-20"],
    });
    expect(good("duration", 90).ok).toBe(true);
    expect(good("url", "https://example.com/a").ok).toBe(true);
    expect(good("email", "ejemplo.ana@example.com").ok).toBe(true);
    expect(good("phone", "+34 600 000 000").ok).toBe(true);
    expect(good("relation", "e_1", { relation: { target: "t_libro", many: false } }).ok).toBe(true);
    expect(
      good("relation", ["e_1", "e_1", "e_2"], { relation: { target: "t_libro", many: true } }),
    ).toEqual({ ok: true, value: ["e_1", "e_2"] });
    expect(good("file", "a".repeat(64)).ok).toBe(true);
    for (const t of ["text", "number", "date", "relation"] as const)
      expect(good(t, null)).toEqual({ ok: true, value: null });
  });

  it("refuses what does not fit, never storing it half-right", () => {
    const refused: [FieldType, unknown][] = [
      ["text", 3],
      ["text", "x".repeat(10_001)],
      ["number", Number.NaN],
      ["number", "3"],
      ["money", { amount: 1, currency: "eur" }],
      ["money", { amount: 1, currency: "EUR", extra: 1 }],
      ["select", "Leyendo"], // the option's name is not its id
      ["multiselect", ["o_a", "o_z"]],
      ["checkbox", "true"],
      ["date", "2025-02-29"],
      ["date", "2026-13-01"],
      ["time", "24:00"],
      ["datetime", "2026-10-19T20:14"], // no zone: not an instant
      ["duration", 1.5],
      ["url", "javascript:alert(1)"],
      ["url", "file:///etc/passwd"],
      ["email", "no es correo"],
      ["file", "https://example.com/x.png"], // never a URL
    ];
    for (const [t, v] of refused)
      expect(good(t, v).ok, `${t} ${JSON.stringify(v)?.slice(0, 40)}`).toBe(false);
  });
});

describe("convertValue", () => {
  it("converts what has an obvious meaning and refuses the rest", () => {
    const sel = field("select");
    expect(convertValue(sel, field("text"), "o_b")).toEqual({ ok: true, value: "Leído" });
    expect(convertValue(field("text"), sel, "leído")).toEqual({ ok: true, value: "o_b" });
    expect(convertValue(field("text"), field("number"), "12,5")).toEqual({ ok: true, value: 12.5 });
    expect(convertValue(field("money"), field("number"), { amount: 3, currency: "EUR" })).toEqual({
      ok: true,
      value: 3,
    });
    expect(convertValue(field("text"), field("checkbox"), "sí")).toEqual({ ok: true, value: true });
    expect(convertValue(field("text"), field("date"), "2026-10-19")).toEqual({
      ok: true,
      value: "2026-10-19",
    });
    expect(convertValue(field("text"), field("number"), "doce").ok).toBe(false);
    expect(convertValue(field("text"), sel, "Pendiente").ok).toBe(false);
  });
});
