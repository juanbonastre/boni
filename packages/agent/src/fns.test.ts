import { describe, expect, it } from "vitest";
import { callFn } from "./fns.ts";
import { codeLabel, leaf, modelLabel, plain, rec } from "./values.ts";

describe("the plan's functions", () => {
  it("case: the result for the option the value is, else null; it carries what chose it («Crear en la elegida»)", () => {
    const choice = leaf("Evento (p. ej.: Dentista)", modelLabel("run-1"));
    const lit = (v: string) => leaf(v, codeLabel("plan"));
    const args = [
      lit("Tarea (p. ej.: Llamar)"),
      lit("tarea"),
      lit("Evento (p. ej.: Dentista)"),
      lit("evento"),
    ];
    const got = callFn("case", [choice, ...args], "2026-11-06");
    expect(plain(got)).toBe("evento");
    expect(got.label.integrity).toBe("model");
    expect(got.t === "v" && got.derived).toBe(true);
    expect(
      plain(callFn("case", [leaf("Otra", modelLabel("run-1")), ...args], "2026-11-06")),
    ).toBeNull();
    // An option without its result is refused.
    expect(() => callFn("case", [choice, lit("Tarea")], "2026-11-06")).toThrow("wrong-arguments");
  });
  it("obj leaves out a pair whose key is null: a field the chosen collection does not have", () => {
    const code = codeLabel("plan");
    const got = callFn(
      "obj",
      [leaf("title", code), leaf("Dentista", code), leaf(null, code), leaf("2026-11-07", code)],
      "2026-11-06",
    );
    expect(plain(got)).toEqual({ title: "Dentista" });
  });
  it("first: the first value that is not empty, keeping its own label; none: null (task 51)", () => {
    const reader = leaf("e_reader", codeLabel("reader"));
    const code = leaf("e_code", codeLabel("prefill"));
    expect(plain(callFn("first", [leaf(null, codeLabel("x")), code], "2026-11-04"))).toBe("e_code");
    expect(plain(callFn("first", [reader, code], "2026-11-04"))).toBe("e_reader");
    expect(
      plain(callFn("first", [leaf("", codeLabel("x")), leaf(false, codeLabel("y"))], "2026-11-04")),
    ).toBeNull();
  });
  it("merge: one record from several, a later field with a value winning; each field keeps its label (docs/flujos.md)", () => {
    const code = codeLabel("prefill");
    const reader = modelLabel("run-1");
    const prefill = rec({ proyecto: leaf("e_code", code), persona: leaf("e_ana", code) }, code);
    const filled = rec(
      {
        proyecto: leaf("e_reader", reader),
        persona: leaf(null, reader),
        prioridad: leaf("Alta", reader),
      },
      reader,
    );
    const own = rec({ title: leaf("Enviar el informe", reader), body: leaf("", reader) }, reader);
    const m = callFn("merge", [prefill, filled, own], "2026-11-05");
    expect(plain(m)).toEqual({
      proyecto: "e_reader",
      persona: "e_ana",
      prioridad: "Alta",
      title: "Enviar el informe",
    });
    // The code's value keeps the code's label: what the reader left empty did not take it away.
    expect(m.t === "rec" && m.fields.persona?.label).toEqual(code);
    // A skipped part (null) adds nothing; anything else that is not a record is refused.
    expect(plain(callFn("merge", [leaf(null, code), own], "2026-11-05"))).toEqual({
      title: "Enviar el informe",
    });
    expect(() => callFn("merge", [leaf("x", code), own], "2026-11-05")).toThrow("not-a-record");
  });
});
