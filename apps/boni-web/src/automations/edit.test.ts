// What the canvas does to a draft (docs/automatizaciones.md §5.7). The tests of D's rules stay pending, each with
// its rule's id in its name (`make check` reads them).
import { type Automation, FORMAT, type Step } from "@boni/automations";
import { describe, expect, it } from "vitest";
import { translator } from "../i18n.ts";
import {
  addStep,
  connect,
  copySteps,
  disconnect,
  pasteSteps,
  removeSteps,
  rename,
  setParam,
  setSetting,
} from "./edit.ts";
import { namer } from "./words.ts";

const names = namer(translator("es"), { gastos: "Gastos", ingresos: "Ingresos" });
const ids = () => {
  let n = 0;
  return () => `s_nuevo${++n}`;
};
const step = (id: string, type: string, name: string, params: Step["params"] = {}): Step => ({
  id,
  name,
  type,
  params,
});
const automation = (steps: Step[], arrows: Automation["arrows"] = []): Automation => ({
  format: FORMAT,
  id: "a_01jejemplo",
  version: 0,
  name: "Revisar gastos",
  steps,
  arrows,
  settings: {},
});
const arrow = (from: string, to: string, output = "main", input = "main") => ({
  from: { step: from, output },
  to: { step: to, input },
});
const trigger = step("s_inicio", "manual", "Disparado por el usuario");
const buscar = step("s_buscar", "collection", "Buscar filas en Gastos", {
  action: "find",
  collection: "gastos",
});
const filtrar = step("s_filtrar", "filter", "Filtrar");
const chain = automation(
  [trigger, buscar, filtrar],
  [arrow("s_inicio", "s_buscar"), arrow("s_buscar", "s_filtrar")],
);

describe("adding, connecting and removing", () => {
  it("AU-65 · a step is added in four ways and each gives the same step: from the top (connected to nothing), from an output (hung from it), on an arrow (between its two ends, the arrow made two) and on the canvas (connected to nothing)", () => {
    const top = addStep(chain, "sort", undefined, { from: "top" }, names, ids());
    const output = addStep(
      chain,
      "sort",
      undefined,
      { from: "output", step: "s_filtrar", output: "main" },
      names,
      ids(),
    );
    const between = addStep(
      chain,
      "sort",
      undefined,
      { from: "arrow", arrow: arrow("s_buscar", "s_filtrar") },
      names,
      ids(),
    );
    const canvas = addStep(
      chain,
      "sort",
      undefined,
      { from: "canvas", x: 40, y: 400 },
      names,
      ids(),
    );
    // The same step each time.
    const made = (r: { draft: Automation; step: string }) =>
      r.draft.steps.find((s) => s.id === r.step);
    for (const r of [top, output, between, canvas])
      expect(made(r)).toEqual({ id: "s_nuevo1", name: "Ordenar", type: "sort", params: {} });
    expect(top.draft.arrows).toEqual(chain.arrows);
    expect(canvas.draft.arrows).toEqual(chain.arrows);
    expect(output.draft.arrows).toEqual([...chain.arrows, arrow("s_filtrar", "s_nuevo1")]);
    expect(between.draft.arrows).toEqual([
      arrow("s_inicio", "s_buscar"),
      arrow("s_buscar", "s_nuevo1"),
      arrow("s_nuevo1", "s_filtrar"),
    ]);
    // Two outputs: the step hangs from the one asked.
    const si = automation([trigger, step("s_si", "if", "Si")], [arrow("s_inicio", "s_si")]);
    const no = addStep(
      si,
      "filter",
      undefined,
      { from: "output", step: "s_si", output: "no" },
      names,
      ids(),
    );
    expect(no.draft.arrows.at(-1)).toEqual(arrow("s_si", "s_nuevo1", "no"));
    // A step with no output on an arrow ends that way, and the arrow stays.
    const stop = addStep(
      chain,
      "stop",
      undefined,
      { from: "arrow", arrow: arrow("s_buscar", "s_filtrar") },
      names,
      ids(),
    );
    expect(stop.draft.arrows).toEqual([...chain.arrows, arrow("s_buscar", "s_nuevo1")]);
  });

  it("AU-65 · the first step of an empty canvas is a trigger, and adding another trigger connects it to nothing", () => {
    const empty = automation([]);
    const first = addStep(empty, "manual", undefined, { from: "top" }, names, ids());
    expect(first.draft.steps).toEqual([
      { id: "s_nuevo1", name: "Disparado por el usuario", type: "manual", params: {} },
    ]);
    // Another trigger, even asked from an output or an arrow: connected to nothing, its name with a number.
    const fromOutput = addStep(
      chain,
      "manual",
      undefined,
      { from: "output", step: "s_filtrar", output: "main" },
      names,
      ids(),
    );
    const fromArrow = addStep(
      chain,
      "manual",
      undefined,
      { from: "arrow", arrow: arrow("s_inicio", "s_buscar") },
      names,
      ids(),
    );
    for (const r of [fromOutput, fromArrow]) {
      expect(r.draft.arrows).toEqual(chain.arrows);
      expect(r.draft.steps.at(-1)?.name).toBe("Disparado por el usuario 2");
    }
  });

  it("AU-87 · a new step has the catalogue's defaults and nothing else: no option is added, no step is added with it, and no edit adds a step that was not asked for", () => {
    // Every type of the panel: one step more, its params only the action where the type has several.
    for (const [type, action] of [
      ["collection", "find"],
      ["collection", "aggregate"],
      ["date", undefined],
      ["filter", undefined],
      ["switch", undefined],
      ["combine", undefined],
    ] as const) {
      const r = addStep(
        chain,
        type,
        action,
        { from: "output", step: "s_filtrar", output: "main" },
        names,
        ids(),
      );
      expect(r.draft.steps).toHaveLength(chain.steps.length + 1);
      const made = r.draft.steps.at(-1);
      expect(made?.params).toEqual(
        type === "collection" ? { action } : type === "date" ? { action: "add" } : {},
      );
      expect(made?.settings).toBeUndefined();
    }
    // No other edit adds a step.
    const n = chain.steps.length;
    expect(connect(chain, arrow("s_inicio", "s_filtrar"))).toMatchObject({ steps: { length: n } });
    expect(disconnect(chain, arrow("s_inicio", "s_buscar")).steps).toHaveLength(n);
    expect(removeSteps(chain, ["s_buscar"]).steps).toHaveLength(n - 1);
    expect(rename(chain, "s_filtrar", "Solo los grandes").steps).toHaveLength(n);
    expect(setParam(chain, "s_buscar", "limit", 5, names).steps).toHaveLength(n);
    expect(setSetting(chain, "s_buscar", "off", true).steps).toHaveLength(n);
  });

  it("AU-66 · removing a step with one arrow in and one out joins its two neighbours by the output and the input they used; in any other case its arrows go with it", () => {
    expect(removeSteps(chain, ["s_buscar"]).arrows).toEqual([arrow("s_inicio", "s_filtrar")]);
    // «Combinar»'s input «b» and «Si»'s «no»: the join keeps both ends as they were.
    const cross = automation(
      [trigger, step("s_si", "if", "Si"), filtrar, step("s_combinar", "combine", "Combinar")],
      [
        arrow("s_inicio", "s_si"),
        arrow("s_si", "s_filtrar", "no"),
        arrow("s_filtrar", "s_combinar", "main", "b"),
      ],
    );
    expect(removeSteps(cross, ["s_filtrar"]).arrows).toEqual([
      arrow("s_inicio", "s_si"),
      arrow("s_si", "s_combinar", "no", "b"),
    ]);
    // Two arrows out: its arrows go, nothing is joined.
    const two = automation(
      [trigger, buscar, filtrar, step("s_ordenar", "sort", "Ordenar")],
      [
        arrow("s_inicio", "s_buscar"),
        arrow("s_buscar", "s_filtrar"),
        arrow("s_buscar", "s_ordenar"),
      ],
    );
    expect(removeSteps(two, ["s_buscar"]).arrows).toEqual([]);
    // No arrow in (a trigger): its arrows go.
    expect(removeSteps(chain, ["s_inicio"]).arrows).toEqual([arrow("s_buscar", "s_filtrar")]);
    // Several at once, the chain's middle and its end.
    expect(removeSteps(chain, ["s_buscar", "s_filtrar"])).toEqual(automation([trigger]));
  });

  it("AU-66 · turning a step off and on changes only its setting «Apagado», and an arrow that would close a cycle is refused saying why", () => {
    const off = setSetting(chain, "s_buscar", "off", true);
    expect(off.steps[1]).toEqual({ ...buscar, settings: { off: true } });
    expect(off.steps.filter((s) => s.id !== "s_buscar")).toEqual([trigger, filtrar]);
    expect(off.arrows).toEqual(chain.arrows);
    // On again: back to the default, so the setting leaves the step.
    expect(setSetting(off, "s_buscar", "off", false)).toEqual(chain);
    // Arrows refused, each saying why.
    expect(connect(chain, arrow("s_filtrar", "s_buscar"))).toEqual({ refused: "cycle" });
    expect(connect(chain, arrow("s_filtrar", "s_filtrar"))).toEqual({ refused: "same" });
    expect(connect(chain, arrow("s_filtrar", "s_inicio"))).toEqual({ refused: "toTrigger" });
    expect(connect(chain, arrow("s_filtrar", "s_nadie"))).toEqual({ refused: "noSuchEnd" });
    expect(connect(chain, arrow("s_filtrar", "s_buscar", "yes"))).toEqual({ refused: "noSuchEnd" });
    // One that is there already changes nothing; a new one is drawn.
    expect(connect(chain, arrow("s_inicio", "s_buscar"))).toBe(chain);
    expect(connect(chain, arrow("s_inicio", "s_filtrar"))).toEqual({
      ...chain,
      arrows: [...chain.arrows, arrow("s_inicio", "s_filtrar")],
    });
  });
});

describe("copying, pasting and undoing", () => {
  const cites = step("s_marcar", "edit", "Marcar", {
    fields: [
      {
        field: "nota",
        value: {
          expr: "{{ $('Filtrar').item.json.concepto }} y {{ $('Buscar filas en Gastos').item.json.importe }}",
        },
      },
    ],
  });
  const withCite = automation(
    [trigger, buscar, filtrar, cites],
    [arrow("s_inicio", "s_buscar"), arrow("s_buscar", "s_filtrar"), arrow("s_filtrar", "s_marcar")],
  );
  const places = {
    s_inicio: { x: 0, y: 0 },
    s_buscar: { x: 300, y: 0 },
    s_filtrar: { x: 600, y: 0 },
    s_marcar: { x: 900, y: 104 },
  };

  it("AU-68 · copied steps take the arrows between them and no other; pasted, each has a new id, a name with a number where the name is taken, and the citations inside the clip follow the new names", () => {
    const clip = copySteps(withCite, ["s_marcar", "s_filtrar"], places);
    expect(clip.steps.map((s) => s.id)).toEqual(["s_filtrar", "s_marcar"]);
    expect(clip.arrows).toEqual([arrow("s_filtrar", "s_marcar")]);
    expect(clip.offsets).toEqual({ s_filtrar: { x: 0, y: 0 }, s_marcar: { x: 300, y: 104 } });
    const pasted = pasteSteps(withCite, clip, ids());
    expect(pasted.steps).toEqual({ s_filtrar: "s_nuevo1", s_marcar: "s_nuevo2" });
    const [f2, m2] = pasted.draft.steps.slice(4);
    expect(f2?.name).toBe("Filtrar 2");
    expect(m2?.name).toBe("Marcar 2");
    // The citation of a step of the clip follows it; the one of a step outside stays as written.
    expect(m2?.params.fields).toEqual([
      {
        field: "nota",
        value: {
          expr: "{{ $('Filtrar 2').item.json.concepto }} y {{ $('Buscar filas en Gastos').item.json.importe }}",
        },
      },
    ]);
    expect(pasted.draft.arrows.slice(withCite.arrows.length)).toEqual([
      arrow("s_nuevo1", "s_nuevo2"),
    ]);
    // The originals are as they were.
    expect(pasted.draft.steps.slice(0, 4)).toEqual(withCite.steps);
    // A clip whose own names cross («Filtrar» and «Filtrar 2») keeps each citation on its own step.
    const crossing = automation([
      filtrar,
      step("s_f2", "filter", "Filtrar 2"),
      step("s_cita", "edit", "Cita", {
        fields: [{ field: "a", value: { expr: "{{ $('Filtrar').item.json.x }}" } }],
      }),
    ]);
    const again = pasteSteps(
      crossing,
      copySteps(crossing, ["s_filtrar", "s_f2", "s_cita"], {}),
      ids(),
    );
    expect(again.draft.steps.slice(3).map((s) => s.name)).toEqual([
      "Filtrar 3",
      "Filtrar 4",
      "Cita 2",
    ]);
    expect(again.draft.steps[5]?.params.fields).toEqual([
      { field: "a", value: { expr: "{{ $('Filtrar 3').item.json.x }}" } },
    ]);
  });

  it("AU-68 · a clip pastes into another automation, and «Duplicar» is copy and paste in one", () => {
    const clip = copySteps(withCite, ["s_filtrar", "s_marcar"], places);
    const other = automation([step("s_otro", "manual", "Disparado por el usuario")]);
    const pasted = pasteSteps({ ...other, id: "a_01jotra" }, clip, ids());
    // No name is taken there: they keep theirs, with new ids, and nothing of the first automation comes along.
    expect(pasted.draft.id).toBe("a_01jotra");
    expect(pasted.draft.steps.map((s) => s.name)).toEqual([
      "Disparado por el usuario",
      "Filtrar",
      "Marcar",
    ]);
    expect(pasted.draft.steps.map((s) => s.id)).toEqual(["s_otro", "s_nuevo1", "s_nuevo2"]);
    expect(pasted.draft.arrows).toEqual([arrow("s_nuevo1", "s_nuevo2")]);
    // «Duplicar»: the same as copying and pasting the step where it is.
    const dup = pasteSteps(chain, copySteps(chain, ["s_filtrar"], {}), ids());
    expect(dup.draft.steps.at(-1)).toEqual({ ...filtrar, id: "s_nuevo1", name: "Filtrar 2" });
    expect(dup.draft.arrows).toEqual(chain.arrows);
  });
});

describe("a step's parameters and its name", () => {
  it.todo(
    "AU-76 · an option is added by setting it and taken away by removing its key: it is its default again, and it is offered again",
  );
  it.todo(
    "AU-82 · changing the action keeps the parameters the two share and names the ones that go, in the panel's order: only those that had a value Juan wrote",
  );
  it("AU-86 · the name follows the parameters while it is the automatic one (the collection changes, the name changes) and stops once Juan writes another; a rename rewrites every citation of the step", () => {
    const fresh = addStep(
      chain,
      "collection",
      "find",
      { from: "output", step: "s_filtrar", output: "main" },
      names,
      ids(),
    );
    expect(fresh.draft.steps.at(-1)?.name).toBe("Buscar filas");
    // The collection chosen: «Buscar filas en Gastos» is taken, so it is «… 2»; then another collection.
    const gastos = setParam(fresh.draft, fresh.step, "collection", "gastos", names);
    expect(gastos.steps.at(-1)?.name).toBe("Buscar filas en Gastos 2");
    const ingresos = setParam(gastos, fresh.step, "collection", "ingresos", names);
    expect(ingresos.steps.at(-1)?.name).toBe("Buscar filas en Ingresos");
    // A parameter that is not in the name leaves it as it is.
    expect(setParam(ingresos, fresh.step, "limit", 10, names).steps.at(-1)?.name).toBe(
      "Buscar filas en Ingresos",
    );
    // Juan's own name stays.
    const mine = rename(ingresos, fresh.step, "  Lo que entra  ");
    expect(mine.steps.at(-1)?.name).toBe("Lo que entra");
    expect(setParam(mine, fresh.step, "collection", "gastos", names).steps.at(-1)?.name).toBe(
      "Lo que entra",
    );
    // An empty name is refused; one that is taken takes a number; the citations follow it.
    expect(rename(chain, "s_filtrar", "   ")).toBe(chain);
    const cited = automation(
      [
        ...chain.steps,
        step("s_marcar", "edit", "Marcar", {
          fields: [{ field: "n", value: { expr: "{{ $('Filtrar').item.json.n }}" } }],
        }),
      ],
      chain.arrows,
    );
    const renamed = rename(cited, "s_filtrar", "Disparado por el usuario");
    expect(renamed.steps[2]?.name).toBe("Disparado por el usuario 2");
    expect(renamed.steps[3]?.params.fields).toEqual([
      { field: "n", value: { expr: "{{ $('Disparado por el usuario 2').item.json.n }}" } },
    ]);
  });
});
