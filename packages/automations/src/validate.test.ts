// Validation (docs/automatizaciones.md §5.1, §5.3, §5.10): every problem points at its step, its parameter or its
// arrow, in a fixed order, and the same automation saved in another order gives the same list.
import { describe, expect, it } from "vitest";
import { rng } from "../../entities/src/random.test-util.ts";
import { cite, collection, ids, knowing, sketch } from "./automation.test-util.ts";
import { CATALOGUE } from "./catalogue.ts";
import { MAIN, OUT, type ParamValue, parseAutomation } from "./format.ts";
import { canRun, PROBLEMS, validate, WARNINGS } from "./validate.ts";

const next = ids(3);
const items = collection(next, ["text", "number", "date", "checkbox"]);
const [NAME, TOTAL, WHEN] = items.fields.map((f) => f.key) as [string, string, string];

/** A trigger, a search in a collection, a «Si» over what it found and an edit on each branch. */
function sample() {
  return sketch(4)
    .step("Inicio", "manual", { fields: [{ key: "minimo", name: "Mínimo", type: "number" }] })
    .step("Buscar", "collection", {
      collection: items.key,
      action: "find",
      where: [{ field: TOTAL, op: "gt", value: cite("$json.minimo") }],
      sort: [{ field: WHEN, direction: "desc" }],
    })
    .step("Si", "if", { where: [{ field: TOTAL, op: "gt", value: 100 }] })
    .step("Grandes", "edit", {
      fields: [{ field: "nombre", value: cite(`$('Buscar').item.${NAME}`) }],
    })
    .step("Resto", "edit", {
      fields: [{ field: "desde", value: cite("$('Inicio').first().minimo") }],
    })
    .arrow("Inicio", "Buscar")
    .arrow("Buscar", "Si")
    .arrow("Si", "Grandes", OUT.yes)
    .arrow("Si", "Resto", OUT.no);
}

describe("validation", () => {
  it("an automation that makes sense has no problem", () => {
    expect(validate(sample().build(), knowing(items))).toEqual([]);
  });

  it("the same automation with its steps, arrows and keys saved in another order gives the same problems", () => {
    const s = sample()
      .step("Suelto", "limit", { count: "tres", extra: 1 })
      .step("Otro", "limit", {})
      .arrow("Suelto", "Otro");
    const a = s.build();
    a.steps[3] = { ...(a.steps[3] as (typeof a.steps)[number]), name: "Si" };
    a.arrows.push({
      from: { step: s.id("Si"), output: "talvez" },
      to: { step: s.id("Resto"), input: MAIN },
    });
    const want = validate(a, knowing(items));
    expect(want.length).toBeGreaterThan(5);
    const r = rng(11);
    const shuffle = <T>(xs: T[]) =>
      xs
        .map((x) => [r.next(), x] as const)
        .sort((x, y) => x[0] - y[0])
        .map(([, x]) => x);
    for (let i = 0; i < 20; i++) {
      const order = shuffle(a.arrows.map((_, j) => j));
      const b = {
        ...a,
        steps: shuffle(a.steps).map((st) => ({
          ...st,
          params: Object.fromEntries(shuffle(Object.entries(st.params))),
        })),
        arrows: order.map((j) => a.arrows[j] as (typeof a.arrows)[number]),
      };
      // Arrows are pointed at by their index: the same problems, at the arrows' new places.
      const moved = want.map((p) =>
        p.arrow === undefined ? p : { ...p, arrow: order.indexOf(p.arrow) },
      );
      const got = validate(b, knowing(items));
      const key = (p: (typeof want)[number]) => JSON.stringify(p);
      expect(got.filter((p) => p.arrow === undefined)).toEqual(
        moved.filter((p) => p.arrow === undefined),
      );
      expect(
        got
          .filter((p) => p.arrow !== undefined)
          .map(key)
          .sort(),
      ).toEqual(
        moved
          .filter((p) => p.arrow !== undefined)
          .map(key)
          .sort(),
      );
    }
  });

  it("steps: no trigger, a repeated id, an empty or repeated name, a setting out of range", () => {
    const s = sketch()
      .step("Uno", "limit", { count: 1 }, { retry: { times: 6, waitMs: 0 } })
      .step("Uno", "limit", { count: 1 }, { retry: { times: 2, waitMs: -1 } })
      .step(" ", "limit", { count: 1 })
      .arrow("Uno", " ");
    const a = s.build();
    a.steps.push(structuredClone(a.steps[2] as (typeof a.steps)[number]));
    const codes = validate(a, knowing()).map((p) => [p.code, p.step, p.param ?? null]);
    const [first, second, blank] = a.steps.map((x) => x.id) as [string, string, string];
    expect(codes).toEqual([
      ["trigger.none", undefined, null],
      ["step.duplicateName", first, null],
      ["step.settings", first, "retry"],
      ["step.unreachable", first, null],
      ["step.duplicateName", second, null],
      ["step.settings", second, "retry"],
      ["step.unreachable", second, null],
      ["step.emptyName", blank, null],
      ["step.unreachable", blank, null],
      ["step.duplicateId", blank, null],
    ]);
  });

  it("parameters: required, of the wrong kind, a list too short, a condition missing, fields and collections unknown", () => {
    const s = sketch()
      .step("Inicio", "manual")
      .step("Sin colección", "collection", { action: "find" })
      .step("Otra colección", "collection", { collection: "t_ninguna", action: "get", row: "e_x" })
      .step("Mal campo", "collection", {
        collection: items.key,
        action: "update",
        target: "matching",
        where: [{ field: "f_ninguno", op: "is", value: "x" }],
        fields: [{ field: TOTAL, value: 1 }, { field: TOTAL, value: 2 }, { field: "f_otro" }],
      })
      .step("Sin condición", "collection", {
        collection: items.key,
        action: "trash",
        target: "matching",
      })
      .step("Mal valor", "limit", { count: "tres", from: "medio" })
      .step("Sin reglas", "switch", { rules: [] })
      .step("Mala regla", "filter", {
        where: [
          { field: "a", op: "más", value: [1] },
          { join: "and", rules: [{ join: "or", rules: [] }] },
        ],
      })
      .arrow("Inicio", "Sin colección")
      .arrow("Inicio", "Otra colección")
      .arrow("Inicio", "Mal campo")
      .arrow("Inicio", "Sin condición")
      .arrow("Inicio", "Mal valor")
      .arrow("Inicio", "Sin reglas")
      .arrow("Inicio", "Mala regla");
    const got = validate(s.build(), knowing(items)).map((p) => [p.code, p.param, p.detail]);
    const by = (name: string) =>
      validate(s.build(), knowing(items))
        .filter((p) => p.step === s.id(name))
        .map((p) => [p.code, p.param, p.detail]);
    expect(by("Sin colección")).toEqual([["param.required", "collection", undefined]]);
    expect(by("Otra colección")).toEqual([
      ["collection.unknown", "collection", { collection: "t_ninguna" }],
    ]);
    expect(by("Mal campo")).toEqual([
      ["field.unknown", "where.0.field", { field: "f_ninguno" }],
      ["param.value", "fields.1.field", undefined],
      ["field.unknown", "fields.2.field", { field: "f_otro" }],
    ]);
    expect(by("Sin condición")).toEqual([["param.condition", "where", undefined]]);
    expect(by("Mal valor")).toEqual([
      ["param.value", "count", undefined],
      ["param.value", "from", undefined],
    ]);
    expect(by("Sin reglas")).toEqual([["param.value", "rules", undefined]]);
    expect(by("Mala regla")).toEqual([
      ["param.value", "where.0.op", undefined],
      ["param.value", "where.0.value", undefined],
      ["param.value", "where.1.rules.0", undefined],
    ]);
    expect(got.length).toBe(12);
  });

  it("expressions: code, a step that does not exist or does not come before, no current row, .item across rows remade", () => {
    const s = sketch()
      .step("Inicio", "manual", { fields: [{ key: "n", name: "N", type: "number" }] })
      .step("Agrupar", "group", { measures: [{ to: "cuantas", measure: "count" }] })
      .step("Después", "edit", {
        fields: [
          { field: "a", value: cite("$json.n * 2") },
          { field: "b", value: cite("$('Nadie').item.n") },
          { field: "c", value: cite("$('Al lado').item.n") },
          { field: "d", value: cite("$('Inicio').item.n") },
          { field: "e", value: cite("$('Inicio').first().n") },
          { field: "f", value: cite("$('Agrupar').item.cuantas") },
        ],
      })
      .step("Al lado", "limit", { count: cite("$('Inicio').first().n") })
      .step("Todas", "limit", { count: cite("$json.n") })
      .arrow("Inicio", "Agrupar")
      .arrow("Agrupar", "Después")
      .arrow("Inicio", "Al lado")
      .arrow("Agrupar", "Todas");
    const by = (name: string) =>
      validate(s.build(), knowing())
        .filter((p) => p.step === s.id(name))
        .map((p) => [p.code, p.param, p.detail]);
    expect(by("Después")).toEqual([
      ["expr.code", "fields.0.value", undefined],
      ["expr.unknownStep", "fields.1.value", { name: "Nadie" }],
      ["expr.notBefore", "fields.2.value", { name: "Al lado" }],
      [
        "expr.cannotPair",
        "fields.3.value",
        { name: "Inicio", by: "Agrupar", first: "$('Inicio').first().n", all: "$('Inicio').all()" },
      ],
    ]);
    expect(by("Al lado")).toEqual([]);
    expect(by("Todas")).toEqual([["expr.noCurrentRow", "count", undefined]]);
  });

  it("warnings: a step no trigger reaches, a branch left unconnected; neither stops a run", () => {
    const s = sketch()
      .step("Inicio", "manual")
      .step("Si", "if", { where: [{ field: "a", op: "not_empty" }] })
      .step("Suelto", "limit", { count: 1 })
      .arrow("Inicio", "Si");
    const problems = validate(s.build(), knowing());
    expect(problems).toEqual([
      {
        code: "output.unconnected",
        severity: "warning",
        step: s.id("Si"),
        detail: { output: OUT.yes },
      },
      {
        code: "output.unconnected",
        severity: "warning",
        step: s.id("Si"),
        detail: { output: OUT.no },
      },
      { code: "step.unreachable", severity: "warning", step: s.id("Suelto") },
    ]);
    expect(canRun(problems)).toBe(true);
    for (const w of WARNINGS) expect(PROBLEMS).toContain(w);
  });

  it("never throws on what parseAutomation reads, whatever its parameters hold", () => {
    const r = rng(5);
    const types = [...CATALOGUE.map((t) => t.type), "nada"];
    const keys = [
      "collection",
      "action",
      "where",
      "fields",
      "rules",
      "by",
      "count",
      "measures",
      "target",
      "x",
    ];
    const value = (depth: number): ParamValue => {
      switch (r.int(depth > 2 ? 5 : 8)) {
        case 0:
          return null;
        case 1:
          return r.int(100) - 50;
        case 2:
          return r.pick(["", "find", "matching", "a", items.key, NAME, "and"]);
        case 3:
          return r.int(2) === 0;
        case 4:
          return cite(r.pick(["$json.a", "$('S0').item.a", "$('S1').first().b", "$json.a + 1"]));
        case 5:
          return Array.from({ length: r.int(4) }, () => value(depth + 1));
        default:
          return Object.fromEntries(
            Array.from({ length: r.int(4) }, () => [
              r.pick([...keys, "field", "op", "value", "join", "id"]),
              value(depth + 1),
            ]),
          );
      }
    };
    for (let i = 0; i < 300; i++) {
      const s = sketch(i);
      const n = 1 + r.int(6);
      for (let j = 0; j < n; j++)
        s.step(
          `S${j}`,
          r.pick(types),
          Object.fromEntries(Array.from({ length: r.int(5) }, () => [r.pick(keys), value(0)])),
          r.int(3)
            ? undefined
            : { onError: "errorOutput", retry: { times: r.int(9) - 2, waitMs: 0 } },
        );
      for (let j = 0; j < r.int(8); j++)
        s.arrow(
          `S${r.int(n)}`,
          `S${r.int(n)}`,
          r.pick([MAIN, OUT.yes, OUT.error, "r1"]),
          r.pick([MAIN, "a", "b"]),
        );
      const a = parseAutomation(JSON.parse(JSON.stringify(s.build())));
      expect(() => validate(a, knowing(items))).not.toThrow();
    }
  });
});
