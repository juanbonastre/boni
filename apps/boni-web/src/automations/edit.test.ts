// What the canvas and the step's view do to a draft (docs/automatizaciones.md §5.7), each test with its rule's id in
// its name (`make check` reads them).
import { type Automation, FORMAT, type Step } from "@boni/automations";
import { describe, expect, it } from "vitest";
import { translator } from "../i18n.ts";
import {
  addStep,
  changeAction,
  connect,
  copySteps,
  disconnect,
  pasteSteps,
  removeOption,
  removeSteps,
  rename,
  setParam,
  setSetting,
} from "./edit.ts";
import { optionsLeft, rowsOf } from "./panel.ts";
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

describe("the «Permiso» a «Colección» step is born with (AU-187, AU-188, decision 13)", () => {
  it("AU-187 · a «Colección» write step his hand adds carries its «Permiso» written in the step: «Sí» on create, update and create-or-update, «Preguntar» on remove; a reading one and another type carry none", () => {
    const born = (action: string) =>
      addStep(automation([trigger]), "collection", action, { from: "top" }, names, ids()).draft
        .steps[1]?.params;
    expect(born("create")).toEqual({ action: "create", permission: "yes" });
    expect(born("update")).toEqual({ action: "update", permission: "yes" });
    expect(born("upsert")).toEqual({ action: "upsert", permission: "yes" });
    expect(born("trash")).toEqual({ action: "trash", permission: "ask" });
    expect(born("find")).toEqual({ action: "find" });
    expect(
      addStep(automation([trigger]), "sort", undefined, { from: "top" }, names, ids()).draft
        .steps[1]?.params,
    ).toEqual({});
  });
  it("AU-188 · another action never carries the «Permiso» of the one it had: a «Sí» given to create is not one given to remove; the new action gets the one it is born with, and losing it is not named", () => {
    const yes = automation([
      step("s_c", "collection", "Crear una fila en Gastos", {
        action: "create",
        collection: "gastos",
        permission: "yes",
      }),
    ]);
    const trash = changeAction(yes, "s_c", "trash", names);
    expect(trash.draft.steps[0]?.params.permission).toBe("ask");
    expect(trash.dropped).not.toContain("permission");
    expect(changeAction(yes, "s_c", "find", names).draft.steps[0]?.params).not.toHaveProperty(
      "permission",
    );
    expect(changeAction(yes, "s_c", "find", names).dropped).not.toContain("permission");
    // Back from remove to update by his hand: born again, «Sí».
    expect(
      changeAction(trash.draft, "s_c", "update", names).draft.steps[0]?.params.permission,
    ).toBe("yes");
  });
});

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
      expect(made(r)).toEqual({ id: "s_nuevo1", name: "Ordenar filas", type: "sort", params: {} });
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
  it("AU-76 · an option is added by setting it and taken away by removing its key: it is its default again, and it is offered again", () => {
    const withOption = setParam(chain, "s_buscar", "related", true, names);
    const added = withOption.steps[1] as Step;
    expect(added.params.related).toBe(true);
    expect(optionsLeft(added)).toEqual([]);
    expect(rowsOf(added).at(-1)).toMatchObject({ added: true });
    const gone = removeOption(withOption, "s_buscar", "related");
    expect(gone.steps[1]).toEqual(buscar);
    expect(optionsLeft(gone.steps[1] as Step).map((p) => p.key)).toEqual(["related"]);
    // Taking away what is not there changes nothing.
    expect(removeOption(gone, "s_buscar", "related")).toBe(gone);
  });
  it("AU-82 · changing the action keeps the parameters the two share and names the ones that go, in the panel's order: only those that had a value Juan wrote", () => {
    const written = automation([
      step("s_buscar", "collection", "Buscar filas en Gastos", {
        // Written in another order: what goes is named in the panel's.
        limit: 20,
        related: true,
        sort: [{ field: "fecha", direction: "desc" }],
        where: [{ field: "importe", op: "gt", value: 5 }],
        action: "find",
        collection: "gastos",
      }),
    ]);
    // «Contar o sumar» shares the collection and the conditions (the same control over the same fields).
    const counted = changeAction(written, "s_buscar", "aggregate", names);
    expect(counted.dropped).toEqual(["sort", "limit", "related"]);
    expect(counted.draft.steps[0]?.params).toEqual({
      action: "aggregate",
      collection: "gastos",
      where: [{ field: "importe", op: "gt", value: 5 }],
    });
    // The automatic name follows the action.
    expect(counted.draft.steps[0]?.name).toBe("Contar o sumar en Gastos");
    // What had no value goes without a word: a new step names nothing.
    const bare = automation([
      step("s_b", "collection", "Buscar filas", { action: "find", sort: [], limit: "" }),
    ]);
    const created = changeAction(bare, "s_b", "create", names);
    expect(created.dropped).toEqual([]);
    // «Crear una fila» gets the «Permiso» it is born with (AU-187), written; nothing else.
    expect(created.draft.steps[0]?.params).toEqual({ action: "create", permission: "yes" });
    expect(created.draft.steps[0]?.name).toBe("Crear una fila");
    // A name Juan wrote stays; the same action again is no change.
    const mine = rename(written, "s_buscar", "Lo de este mes");
    expect(changeAction(mine, "s_buscar", "get", names).draft.steps[0]?.name).toBe(
      "Lo de este mes",
    );
    expect(changeAction(written, "s_buscar", "find", names)).toEqual({
      draft: written,
      dropped: [],
    });
    // «Modificar» and «Eliminar» share which rows and their conditions.
    const update = automation([
      step("s_m", "collection", "Modificar filas en Gastos", {
        action: "update",
        collection: "gastos",
        target: "matching",
        where: [{ field: "importe", op: "gt", value: 5 }],
        fields: [{ field: "nota", value: "x" }],
      }),
    ]);
    const trashed = changeAction(update, "s_m", "trash", names);
    expect(trashed.dropped).toEqual(["fields"]);
    expect(Object.keys(trashed.draft.steps[0]?.params ?? {}).sort()).toEqual(
      ["action", "collection", "permission", "target", "where"].sort(),
    );
  });
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
    // The steps that do not cite it are the same objects: their cards are not drawn again (A-15).
    expect(renamed.steps[0]).toBe(cited.steps[0]);
    expect(renamed.steps[1]).toBe(cited.steps[1]);
  });

  it("AU-86 · a parameter that is not in the name keeps a numbered name as it is, and changes only its own step", () => {
    const two = automation(
      [
        step("s_limitar", "limit", "Limitar 2", { count: 5 }),
        step("s_otro", "limit", "Limitar 3", { count: 5 }),
      ],
      [],
    );
    const after = setParam(two, "s_limitar", "count", 7, names);
    expect(after.steps[0]?.name).toBe("Limitar 2");
    expect(after.steps[0]?.params.count).toBe(7);
    expect(after.steps[1]).toBe(two.steps[1]);
  });
});
