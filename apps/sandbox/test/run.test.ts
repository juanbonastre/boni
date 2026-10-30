import { describe, expect, it } from "vitest";
import { runCall } from "../src/run.ts";
import { call } from "./call.ts";

describe("one call of an extension's function", () => {
  it("gets its input and gives back JSON", async () => {
    const r = await runCall(
      call(
        "function suma(i) { return { total: i.a + i.b, nombres: i.n.map((x) => x.toUpperCase()) } }",
        "suma",
        {
          a: 2,
          b: 3,
          n: ["ana", "luis"],
        },
      ),
    );
    expect(r).toMatchObject({ ok: true, output: { total: 5, nombres: ["ANA", "LUIS"] } });
  });

  it("knows only the day and a seed: the same call gives the same, step for step", async () => {
    const code =
      "function f(i, ctx) { let s = 0; for (let k = 0; k < 20000; k++) s += k % 7; return [ctx.day, ctx.random(), ctx.random(), s] }";
    const a = await runCall(call(code, "f", {}));
    const b = await runCall(call(code, "f", {}));
    const other = await runCall(call(code, "f", {}, { seed: 43 }));
    expect(a.ok && b.ok && other.ok).toBe(true);
    if (!a.ok || !b.ok || !other.ok) return;
    expect(a.output).toEqual(b.output);
    expect(a.steps).toBe(b.steps);
    expect((a.output as unknown[])[0]).toBe("2026-10-30");
    expect(other.output).not.toEqual(a.output);
  });

  it("dates from what it is given work; the clock and chance do not", async () => {
    const r = await runCall(
      call("function f(i) { return new Date(Date.UTC(2026, 9, 30, 12)).toISOString() }", "f", {}),
    );
    expect(r).toMatchObject({ ok: true, output: "2026-10-30T12:00:00.000Z" });
    for (const body of ["return Date.now()", "return new Date()", "return Math.random()"])
      expect(await runCall(call(`function f() { ${body} }`, "f", {}))).toMatchObject({
        ok: false,
        error: "exception",
        message: expect.stringContaining("no está disponible"),
      });
  });

  it("an output is checked against its schema", async () => {
    const r = await runCall(
      call(
        "function f() { return { total: 'mucho' } }",
        "f",
        {},
        {
          output: { type: "object", properties: { total: { type: "number" } } },
        },
      ),
    );
    expect(r).toMatchObject({
      ok: false,
      error: "output",
      message: "salida.total: se esperaba number",
    });
  });

  it("refuses code that is not the one its hash names, and says what is missing", async () => {
    const wrong = { ...call("function f() { return 1 }", "f", {}), hash: "0".repeat(64) };
    expect(await runCall(wrong)).toMatchObject({ ok: false, error: "invalid" });
    expect(await runCall(call("function f() { return 1 }", "g", {}))).toMatchObject({
      ok: false,
      error: "exception",
      message: expect.stringContaining("no hay ninguna función «g»"),
    });
  });

  it("stops at its own steps when it asks for fewer", async () => {
    const r = await runCall(
      call(
        "function f() { let s = 0; for (let k = 0; k < 1e7; k++) s += k; return s }",
        "f",
        {},
        {
          limits: { steps: 3 },
        },
      ),
    );
    expect(r).toMatchObject({ ok: false, error: "steps" });
  });
});
