// The format's rules (docs/automatizaciones.md §5.1, §5.3): each test keeps its rule's id first in its name
// (`make check` reads them).
import { describe, expect, it } from "vitest";
import { cite, collection, ids, knowing, sketch } from "./automation.test-util.ts";
import { CATALOGUE, IN, inputsOf, outputsOf } from "./catalogue.ts";
import { citationsIn } from "./expression.ts";
import {
  ACTION,
  FORMAT,
  FormatError,
  isExpr,
  MAIN,
  type Migration,
  OUT,
  parseAutomation,
  renameStep,
  SETTINGS_DEFAULTS,
  type Step,
} from "./format.ts";
import { byCodeUnit } from "./graph.ts";
import { validate } from "./validate.ts";

/** A small automation that validates: a trigger, a search and an edit. */
function searchAndCreate() {
  return sketch()
    .step("Inicio", "manual", { fields: [{ key: "desde", name: "Desde", type: "date" }] })
    .step("Limitar", "limit", { count: 5, from: "last" })
    .step("Editar", "edit", {
      fields: [{ field: "desde", value: cite("$('Inicio').first().desde") }],
    })
    .arrow("Inicio", "Limitar")
    .arrow("Limitar", "Editar");
}

describe("the format of an automation", () => {
  it("AU-01 · an automation is steps and arrows as data: what parseAutomation gives survives JSON and reads back equal, with its version", () => {
    const saved = { ...searchAndCreate().build(), version: 3 };
    const read = parseAutomation(JSON.parse(JSON.stringify(saved)));
    expect(read).toEqual(saved);
    expect(read.version).toBe(3);
    expect(parseAutomation(JSON.parse(JSON.stringify(read)))).toEqual(read);
    // What it is not, it does not read: the version and the arrows are checked too.
    expect(() => parseAutomation({ ...saved, version: -1 })).toThrow(FormatError);
    expect(() => parseAutomation({ ...saved, version: 1.5 })).toThrow(FormatError);
    expect(() => parseAutomation({ ...saved, arrows: [{ from: { step: "x" } }] })).toThrow(
      FormatError,
    );
    expect(() => parseAutomation({ ...saved, steps: {} })).toThrow(FormatError);
    expect(() => parseAutomation(null)).toThrow(FormatError);
  });

  it("AU-02 · arrows use the step's fixed id and expressions its name: renameStep rewrites every citation of it and nothing else changes", () => {
    const s = sketch()
      .step("Inicio", "manual")
      .step("Buscar", "edit", {
        fields: [{ field: "nota", value: { expr: "texto {{ $json.nota }}" } }],
      })
      .step("Editar", "edit", {
        fields: [
          { field: "a", value: cite("$('Buscar').item.total") },
          {
            field: "b",
            value: { expr: `{{$("Buscar").first()["mi campo"]}} y {{ $('Buscarlo').item.x }}` },
          },
          { field: "c", value: { expr: "Buscar, sin citar" } },
          { field: "d", value: { lista: [cite("$('Buscar').last().x")] } },
        ],
      })
      .arrow("Inicio", "Buscar")
      .arrow("Buscar", "Editar");
    const before = s.build();
    const after = renameStep(before, s.id("Buscar"), "Buscar 'otras'");
    const edit = after.steps.find((x) => x.id === s.id("Editar"));
    expect(edit?.params.fields).toEqual([
      { field: "a", value: cite("$('Buscar \\'otras\\'').item.total") },
      {
        field: "b",
        value: {
          expr: `{{$('Buscar \\'otras\\'').first()["mi campo"]}} y {{ $('Buscarlo').item.x }}`,
        },
      },
      { field: "c", value: { expr: "Buscar, sin citar" } },
      { field: "d", value: { lista: [cite("$('Buscar \\'otras\\'').last().x")] } },
    ]);
    // The new name reads back as the same citation, now of the renamed step.
    const cited = citationsIn(edit?.params.fields ?? null).map((c) => c.step);
    expect(cited).toEqual(["Buscar 'otras'", "Buscar 'otras'", "Buscarlo", "Buscar 'otras'"]);
    expect(after.arrows).toEqual(before.arrows);
    expect(after.steps.map((x) => x.id)).toEqual(before.steps.map((x) => x.id));
    expect(after.steps.map((x) => x.name)).toEqual(["Inicio", "Buscar 'otras'", "Editar"]);
    expect(after.steps[1]?.params).toEqual(before.steps[1]?.params);
    expect(before.steps[1]?.name).toBe("Buscar");
    expect(validate(after, knowing())).toEqual(validate(before, knowing()));
    expect(() => renameStep(before, "s_ninguno", "x")).toThrow();
    // The name is unique: two steps with one name cannot be told apart in an expression.
    expect(
      validate(renameStep(before, s.id("Editar"), "Buscar"), knowing()).map((p) => p.code),
      // «Buscarlo» is cited and does not exist, before and after.
    ).toEqual(["step.duplicateName", "step.duplicateName", "expr.unknownStep"]);
  });

  it("AU-03 · a step has its inputs and one or more named outputs, «error» when asked; several arrows may reach an input and leave an output, and an arrow to a name the step lacks does not validate", () => {
    const s = sketch()
      .step("Inicio", "manual")
      .step(
        "Si",
        "if",
        { where: [{ field: "total", op: "gt", value: 10 }] },
        { onError: "errorOutput" },
      )
      .step("Grandes", "edit", { fields: [{ field: "grande", value: "sí" }] })
      .step("Pequeñas", "edit", { fields: [{ field: "grande", value: "no" }] })
      .step("Todas", "limit", { count: 10 })
      .step("Cruzar", "combine", { by: "position" })
      .arrow("Inicio", "Si")
      .arrow("Si", "Grandes", OUT.yes)
      .arrow("Si", "Pequeñas", OUT.no)
      .arrow("Si", "Pequeñas", OUT.error)
      .arrow("Grandes", "Todas")
      .arrow("Pequeñas", "Todas")
      .arrow("Grandes", "Cruzar", MAIN, IN.a)
      .arrow("Pequeñas", "Cruzar", MAIN, IN.b);
    const a = s.build();
    const step = (name: string) => a.steps.find((x) => x.id === s.id(name)) as Step;
    expect(outputsOf(step("Si"))).toEqual([OUT.yes, OUT.no, OUT.error]);
    expect(outputsOf(step("Grandes"))).toEqual([MAIN]);
    expect(inputsOf(step("Cruzar"))).toEqual([IN.a, IN.b]);
    expect(inputsOf(step("Inicio"))).toEqual([]);
    // «Parar con error» has no way out.
    expect(
      outputsOf({ id: "s_parar", name: "Parar", type: "stop", params: { message: "x" } }),
    ).toEqual([]);
    expect(validate(a, knowing()).filter((p) => p.code.startsWith("arrow."))).toEqual([]);

    const broken = s.build();
    broken.arrows.push(
      {
        from: { step: s.id("Grandes"), output: OUT.yes },
        to: { step: s.id("Todas"), input: MAIN },
      },
      { from: { step: s.id("Grandes"), output: MAIN }, to: { step: s.id("Cruzar"), input: MAIN } },
      { from: { step: s.id("Grandes"), output: MAIN }, to: { step: s.id("Inicio"), input: MAIN } },
      { from: { step: s.id("Grandes"), output: MAIN }, to: { step: "s_ninguno", input: MAIN } },
      { from: { step: s.id("Grandes"), output: MAIN }, to: { step: s.id("Todas"), input: MAIN } },
    );
    expect(validate(broken, knowing()).filter((p) => p.code.startsWith("arrow."))).toEqual([
      {
        code: "arrow.unknownOutput",
        severity: "error",
        arrow: 8,
        step: s.id("Grandes"),
        detail: { output: OUT.yes },
      },
      {
        code: "arrow.unknownInput",
        severity: "error",
        arrow: 9,
        step: s.id("Grandes"),
        detail: { input: MAIN },
      },
      { code: "arrow.intoTrigger", severity: "error", arrow: 10, step: s.id("Grandes") },
      { code: "arrow.unknownStep", severity: "error", arrow: 11, step: s.id("Grandes") },
      { code: "arrow.duplicate", severity: "error", arrow: 12, step: s.id("Grandes") },
    ]);
    // Without «Salir por error» the step has no such output, and an arrow from it does not validate.
    const noError = s.build();
    delete noError.steps[1]?.settings;
    expect(validate(noError, knowing()).map((p) => p.code)).toContain("arrow.unknownOutput");
  });

  it("AU-08 · a step carries no version of its type: a saved automation of an older format is migrated when read, and an unknown type does not validate", () => {
    const now = searchAndCreate().build();
    // An invented format 0 that called the steps «boxes».
    const { steps, ...rest } = now;
    const old = { ...rest, format: 0, boxes: steps };
    const migration: Migration = {
      from: 0,
      apply: ({ boxes, ...other }) => ({ ...other, steps: boxes }),
    };
    expect(parseAutomation(old, [migration])).toEqual(now);
    expect(() => parseAutomation(old, [])).toThrow(/no migration from 0/);
    expect(() => parseAutomation({ ...now, format: FORMAT + 1 })).toThrow(FormatError);
    expect(() => parseAutomation({ ...now, format: "1" })).toThrow(FormatError);
    // Each type exists once, and its key has no version in it.
    expect(new Set(CATALOGUE.map((t) => t.type)).size).toBe(CATALOGUE.length);
    for (const t of CATALOGUE) expect(t.type).toMatch(/^[a-z]+$/);
    const s = sketch().step("Inicio", "manual").step("Viejo", "edit@1").arrow("Inicio", "Viejo");
    expect(validate(s.build(), knowing())).toEqual([
      {
        code: "step.unknownType",
        severity: "error",
        step: s.id("Viejo"),
        detail: { type: "edit@1" },
      },
    ]);
  });

  it("AU-26 · a parameter that gives the step its shape (the collection, the action, the mode) holding an expression does not validate", () => {
    const next = ids(2);
    const c = collection(next, ["text", "number"]);
    const s = sketch()
      .step("Inicio", "manual")
      .step("Por colección", "collection", { collection: cite("$json.cual"), action: "find" })
      .step("Por acción", "collection", { collection: c.key, action: cite("$json.cual") })
      .step("Por modo", "dedupe", { by: cite("$json.cual") })
      .step("Por valor", "limit", { count: cite("$json.cuantas") })
      .arrow("Inicio", "Por colección")
      .arrow("Inicio", "Por acción")
      .arrow("Inicio", "Por modo")
      .arrow("Inicio", "Por valor");
    const problems = validate(s.build(), knowing(c)).filter((p) => p.code === "param.shape");
    expect(problems.map((p) => [p.step, p.param])).toEqual(
      [
        [s.id("Por colección"), "collection"],
        [s.id("Por acción"), ACTION],
        [s.id("Por modo"), "by"],
      ].sort((x, y) => byCodeUnit(x[0] as string, y[0] as string)),
    );
    // A parameter that is not of the shape takes an expression: «Limitar» to what the row says.
    expect(problems.some((p) => p.step === s.id("Por valor"))).toBe(false);
    // Every `shape` parameter of the catalogue is a choice, a picker, a list or a fixed text: none is free.
    for (const t of CATALOGUE)
      for (const action of t.actions)
        for (const p of [...t.params, ...action.params])
          if (p.shape) expect(["choice", "picker", "list", "value"]).toContain(p.control);
  });

  it("AU-126 · a step is a closed shape: a saved step with «when», «each» or «with», or any other key, is refused", () => {
    const saved = searchAndCreate().build();
    for (const key of ["when", "each", "with", "color"]) {
      const bad = structuredClone(saved) as unknown as { steps: Record<string, unknown>[] };
      (bad.steps[1] as Record<string, unknown>)[key] = true;
      expect(() => parseAutomation(bad)).toThrow(FormatError);
      expect(() => parseAutomation(bad)).toThrow(/steps\.1/);
    }
    const settings = structuredClone(saved) as unknown as { steps: { settings: object }[] };
    (settings.steps[1] as { settings: object }).settings = { each: "row" };
    expect(() => parseAutomation(settings)).toThrow(FormatError);
    const top = { ...saved, when: "siempre" };
    expect(() => parseAutomation(top)).toThrow(FormatError);
    // A parameter its action does not declare is a problem of validation, pointed at the control.
    const s = sketch()
      .step("Inicio", "manual")
      .step("Limitar", "limit", { count: 3, each: "fila" })
      .arrow("Inicio", "Limitar");
    expect(validate(s.build(), knowing())).toEqual([
      { code: "param.unknown", severity: "error", step: s.id("Limitar"), param: "each" },
    ]);
  });

  it("an expression is an object whose only key is expr", () => {
    expect(isExpr({ expr: "{{ $json.total }}" })).toBe(true);
    expect(isExpr({ expr: "x", other: 1 })).toBe(false);
    expect(isExpr({ expr: 3 })).toBe(false);
    expect(isExpr("{{ $json.total }}")).toBe(false);
    expect(isExpr(null)).toBe(false);
  });

  it("a step with no settings stops on a failure, tries once and does not go on without rows", () => {
    expect(SETTINGS_DEFAULTS).toMatchObject({ onError: "stop", continueEmpty: false, off: false });
    expect(SETTINGS_DEFAULTS.retry.times).toBe(0);
    expect(OUT.error).toBe("error");
  });
});
