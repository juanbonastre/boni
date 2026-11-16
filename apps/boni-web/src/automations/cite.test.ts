// Dragging a field into a parameter (docs/automatizaciones.md AU-20, AU-21): the citation it writes, the value it
// leaves, how an expression is painted as chips and what it previews with the last test's first row.
import {
  type Automation,
  FORMAT,
  parseExpression,
  printCitation,
  type Step,
} from "@boni/automations";
import { describe, expect, it } from "vitest";
import {
  citationFor,
  dragFrom,
  dropCitation,
  paint,
  preview,
  toExpression,
  toFixed,
} from "./cite.ts";
import type { RowView, Sample } from "./client.ts";

const step = (id: string, name: string, type: string, params: Step["params"] = {}): Step => ({
  id,
  name,
  type,
  params,
});
const arrow = (from: string, to: string, input = "main", output = "main") => ({
  from: { step: from, output },
  to: { step: to, input },
});

/** Inicio → Buscar gastos → Filtrar → Ordenar → Agrupar → Limitar; Buscar ingresos and Buscar gastos → Combinar. */
const draft: Automation = {
  format: FORMAT,
  id: "a_01jcitas",
  name: "Citas",
  steps: [
    step("s_inicio", "Inicio", "manual"),
    step("s_gastos", "Buscar gastos", "collection", { action: "find", collection: "gastos" }),
    step("s_filtro", "Filtrar", "filter"),
    step("s_orden", "Ordenar", "sort"),
    step("s_agrupar", "Agrupar", "group"),
    step("s_limite", "Limitar", "limit"),
    step("s_ingresos", "Buscar ingresos", "collection", { action: "find", collection: "ingresos" }),
    step("s_combinar", "Combinar", "combine"),
  ],
  arrows: [
    arrow("s_inicio", "s_gastos"),
    arrow("s_gastos", "s_filtro"),
    arrow("s_filtro", "s_orden", "main", "yes"),
    arrow("s_orden", "s_agrupar"),
    arrow("s_agrupar", "s_limite"),
    arrow("s_inicio", "s_ingresos"),
    arrow("s_gastos", "s_combinar", "a"),
    arrow("s_ingresos", "s_combinar", "b"),
  ],
  settings: {},
} as unknown as Automation;

const names = {
  Inicio: { minimo: "Importe mínimo" },
  "Buscar gastos": { importe: "Importe", fecha: "Fecha", categoria: "Categoría" },
  Filtrar: { importe: "Importe", fecha: "Fecha", categoria: "Categoría" },
  Ordenar: { importe: "Importe", fecha: "Fecha", categoria: "Categoría" },
  "Buscar ingresos": { importe: "Importe", cuenta: "Cuenta" },
  Agrupar: { categoria: "Categoría", sum_importe: "Suma de Importe" },
};

const LABEL = {
  integrity: "own",
  sensitivity: "personal",
  thirdParty: false,
  sources: [],
} as const;
const row = (json: RowView["json"]): RowView => ({ json, label: LABEL });

describe("the citation a dragged field writes", () => {
  it("AU-21 · a field of the step it hangs from is written $json.campo, one of an earlier step $('Paso').item.campo, and one with a step that remakes the rows in between $('Paso').first().campo; what is written parses back to the same citation", () => {
    const own = citationFor(draft, "s_orden", "s_filtro", ["importe"]);
    expect(printCitation(own)).toBe("$json.importe");
    const earlier = citationFor(draft, "s_orden", "s_gastos", ["importe"]);
    expect(printCitation(earlier)).toBe("$('Buscar gastos').item.importe");
    // «Agrupar» remakes the rows: from «Limitar», a row of «Ordenar» cannot be followed back.
    const remade = citationFor(draft, "s_limite", "s_orden", ["fecha"]);
    expect(printCitation(remade)).toBe("$('Ordenar').first().fecha");
    // A key inside a related row, and one that is not an identifier.
    const deep = citationFor(draft, "s_orden", "s_gastos", ["cuenta", "nombre completo"]);
    expect(printCitation(deep)).toBe(`$('Buscar gastos').item.cuenta["nombre completo"]`);
    for (const c of [own, earlier, remade, deep]) {
      const [part] = parseExpression(`{{ ${printCitation(c)} }}`);
      expect(part).toEqual({ kind: "cite", cite: c });
    }
  });

  it("AU-21 · a citation is painted as a chip with its field's name, and one of a step or a field that is not there as a broken chip saying which", () => {
    const parts = paint(
      "Más de {{ $json.importe }} desde {{ $('Inicio').item.minimo }}",
      draft,
      "s_orden",
      names,
    );
    expect(
      parts
        .map((p) => (p.kind === "chip" ? `[${p.name}]` : p.kind === "text" ? p.text : ""))
        .join(""),
    ).toBe("Más de [Importe] desde [Importe mínimo]");
    const [gone, missing] = paint(
      "{{ $('Ya no está').item.importe }}{{ $json.nada }}",
      draft,
      "s_orden",
      names,
    );
    expect(gone).toMatchObject({
      kind: "chip",
      broken: "step.unknown",
      step: null,
      name: "importe",
    });
    expect(missing).toMatchObject({ kind: "chip", broken: "field.unknown", name: "nada" });
    // Where no test or collection has said a step's shape, the key is all there is: never broken for that.
    const [unknown] = paint("{{ $json.algo }}", draft, "s_limite", {});
    expect(unknown).toMatchObject({ kind: "chip", name: "algo" });
    expect(unknown).not.toHaveProperty("broken");
    // Code is not a citation: shown as typed (F14c).
    expect(paint("{{ $json.a + 1 }}", draft, "s_orden", names)).toEqual([
      { kind: "code", source: "$json.a + 1" },
    ]);
  });

  it("AU-21 · a chip knows the step its field is of, for its icon ($json: the step the edited one hangs from), and says the step too only when another step of the path has a field of the same name", () => {
    const [own] = paint("{{ $json.fecha }}", draft, "s_orden", names);
    expect(own).toMatchObject({ kind: "chip", step: "s_filtro", name: "Fecha", withStep: false });
    // «Importe» only passes through «Filtrar»: in «Ordenar» it is one field, no step said.
    const [passed] = paint("{{ $json.importe }}", draft, "s_orden", names);
    expect(passed).toMatchObject({ withStep: false });
    // In «Combinar», «Buscar gastos» and «Buscar ingresos» both have an «Importe»: the chip says which.
    const [a, b, c] = paint(
      "{{ $('Buscar gastos').first().importe }}{{ $('Buscar ingresos').first().importe }}{{ $('Buscar ingresos').first().cuenta }}",
      draft,
      "s_combinar",
      names,
    );
    expect(a).toMatchObject({ step: "s_gastos", name: "Importe", withStep: true });
    expect(b).toMatchObject({ step: "s_ingresos", name: "Importe", withStep: true });
    expect(c).toMatchObject({ step: "s_ingresos", name: "Cuenta", withStep: false });
  });

  it("AU-21 · in a step with two inputs a field of either is cited by its step with first(), never as $json", () => {
    expect(printCitation(citationFor(draft, "s_combinar", "s_gastos", ["importe"]))).toBe(
      "$('Buscar gastos').first().importe",
    );
    expect(printCitation(citationFor(draft, "s_combinar", "s_ingresos", ["cuenta"]))).toBe(
      "$('Buscar ingresos').first().cuenta",
    );
  });

  it("AU-21 · the fields of a step's own input can be dragged when two arrows bring it: cited as $json, its row's; two arrows into one input of «Combinar» say no step", () => {
    const into = (id: string) => draft.arrows.filter((a) => a.to.step === id);
    // «Ordenar» fed by «Filtrar» and also by «Buscar ingresos»: a field of its row is `$json`, whichever arrow.
    const two = {
      ...draft,
      arrows: [
        ...draft.arrows,
        arrow("s_ingresos", "s_orden"),
        arrow("s_filtro", "s_combinar", "a"),
      ],
    } as Automation;
    const fromOrden = dragFrom(
      two,
      "s_orden",
      two.arrows.filter((a) => a.to.step === "s_orden"),
    );
    expect(fromOrden).toBe("s_filtro");
    expect(printCitation(citationFor(two, "s_orden", fromOrden ?? "", ["importe"]))).toBe(
      "$json.importe",
    );
    // One arrow: its step.
    expect(dragFrom(draft, "s_filtro", into("s_filtro"))).toBe("s_gastos");
    // «Combinar»'s input «a» brought by two steps: none, and the step is chosen in the header.
    expect(
      dragFrom(
        two,
        "s_combinar",
        two.arrows.filter((a) => a.to.step === "s_combinar" && a.to.input === "a"),
      ),
    ).toBeUndefined();
  });

  it("AU-20 · dropped on text, a field goes in at the caret (at the end with no caret) and the value becomes an expression; dropped on a number, a date or a choice, it replaces the value", () => {
    const cite = citationFor(draft, "s_orden", "s_filtro", ["importe"]);
    expect(dropCitation("Hola mundo", { text: true, start: 5, end: 5 }, cite)).toEqual({
      expr: "Hola {{ $json.importe }}mundo",
    });
    // What is selected is replaced.
    expect(dropCitation("Hola mundo", { text: true, start: 5, end: 10 }, cite)).toEqual({
      expr: "Hola {{ $json.importe }}",
    });
    // No caret: at the end; nothing written: the citation alone.
    expect(dropCitation("Total: ", { text: true, start: 7, end: 7 }, cite)).toEqual({
      expr: "Total: {{ $json.importe }}",
    });
    expect(dropCitation(undefined, { text: true, start: 0, end: 0 }, cite)).toEqual({
      expr: "{{ $json.importe }}",
    });
    // Into an expression, at its caret.
    expect(
      dropCitation({ expr: "{{ $json.fecha }} y " }, { text: true, start: 20, end: 20 }, cite),
    ).toEqual({ expr: "{{ $json.fecha }} y {{ $json.importe }}" });
    for (const v of [42, "2026-11-16", "opt_comida", { expr: "{{ $json.fecha }}" }])
      expect(dropCitation(v, { text: false }, cite)).toEqual({ expr: "{{ $json.importe }}" });
  });

  it("AU-20 · «{ }» to «Expresión» keeps what was written as the expression's text, and back to «Fijo» leaves the value empty", () => {
    expect(toExpression("Hola")).toEqual({ expr: "Hola" });
    expect(toExpression(10)).toEqual({ expr: "10" });
    expect(toExpression("2026-11-16")).toEqual({ expr: "2026-11-16" });
    expect(toExpression(undefined)).toEqual({ expr: "" });
    expect(toExpression(null)).toEqual({ expr: "" });
    expect(toExpression({ expr: "{{ $json.a }}" })).toEqual({ expr: "{{ $json.a }}" });
    expect(toFixed({ expr: "{{ $json.a }}" })).toBeNull();
  });

  it("AU-20 · an expression is previewed with the first row of the last test, saying which row and of how many; with no test there is no preview, and a citation that gives no value says why", () => {
    const sample: Sample = {
      current: row({ importe: 5, fecha: "2026-11-02" }),
      total: 128,
      steps: {
        Inicio: { item: row({ minimo: 3 }), first: row({ minimo: 3 }), last: row({ minimo: 3 }) },
        "Buscar gastos": { item: null, first: null, last: null },
        Agrupar: { item: null, first: row({ sum_importe: 9 }), last: row({ sum_importe: 9 }) },
      },
    };
    expect(preview({ expr: "{{ $json.importe }}" }, sample)).toEqual({ value: 5, row: 1, of: 128 });
    expect(preview({ expr: "Más de {{ $('Inicio').item.minimo }} €" }, sample)).toEqual({
      value: "Más de 3 €",
      row: 1,
      of: 128,
    });
    // No test: nothing under it. A fixed value has no preview.
    expect(preview({ expr: "{{ $json.importe }}" }, null)).toBeNull();
    expect(preview(5, sample)).toBeNull();
    // Why not, with the step it cites.
    expect(preview({ expr: "{{ $('Buscar gastos').first().importe }}" }, sample)).toEqual({
      failure: "noRows",
      step: "Buscar gastos",
    });
    expect(preview({ expr: "{{ $('Agrupar').item.sum_importe }}" }, sample)).toEqual({
      failure: "noPair",
      step: "Agrupar",
    });
    expect(preview({ expr: "{{ $('Otro').item.x }}" }, sample)).toEqual({
      failure: "notRun",
      step: "Otro",
    });
    expect(
      preview({ expr: "{{ $json.importe }}" }, { ...sample, current: null, total: 0 }),
    ).toEqual({
      failure: "noCurrentRow",
    });
    expect(preview({ expr: "{{ $json.importe * 2 }}" }, sample)).toEqual({ failure: "expr.code" });
  });

  it("AU-20 · previewing an expression on every keystroke makes no call and stays within its time with a row of 200 fields (A-15)", () => {
    const json: RowView["json"] = {};
    for (let i = 0; i < 200; i++) json[`campo_${i}`] = i % 3 ? `texto ${i}` : i;
    const sample: Sample = {
      current: row(json),
      total: 3000,
      steps: { Inicio: { item: row(json), first: row(json), last: row(json) } },
    };
    const calls: unknown[] = [];
    const was = globalThis.fetch;
    globalThis.fetch = ((...a: unknown[]) => {
      calls.push(a);
      return Promise.reject(new Error("no calls"));
    }) as typeof fetch;
    try {
      // A person typing a long expression, one key at a time: each key previews and paints it again.
      const typed =
        "Hola {{ $json.campo_10 }}, {{ $('Inicio').item.campo_199 }} y {{ $json.campo_42 }} más";
      const many: Record<string, string> = {};
      for (let i = 0; i < 200; i++) many[`campo_${i}`] = `Campo ${i}`;
      const start = performance.now();
      for (let n = 1; n <= typed.length; n++) {
        const expr = typed.slice(0, n);
        preview({ expr }, sample);
        paint(expr, draft, "s_orden", { Filtrar: many, Inicio: many });
      }
      const ms = performance.now() - start;
      expect(preview({ expr: typed }, sample)).toEqual({
        value: "Hola texto 10, texto 199 y 42 más",
        row: 1,
        of: 3000,
      });
      expect(calls).toHaveLength(0);
      // About a millisecond for the whole run here; a frame (16 ms) per key is the bound.
      expect(ms / typed.length).toBeLessThan(16);
    } finally {
      globalThis.fetch = was;
    }
  });
});
