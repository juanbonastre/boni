// The editor's own state (docs/automatizaciones.md §5.7).
import { type Arrow, FORMAT, type Step } from "@boni/automations";
import { describe, expect, it } from "vitest";
import { translator } from "../i18n.ts";
import type { Opened, StepTest, TestAnswer } from "./client.ts";
import {
  addStep,
  changeAction,
  connect,
  removeSteps,
  rename,
  setParam,
  setSetting,
} from "./edit.ts";
import { outputSays } from "./panel.ts";
import {
  added,
  arrowCount,
  askTest,
  change,
  created,
  emptyEditor,
  failedAt,
  logLine,
  openedEditor,
  outputCount,
  owedPlaces,
  placesKept,
  redo,
  saved,
  saveFailed,
  tested,
  testLost,
  undo,
} from "./state.ts";
import { logWords, namer } from "./words.ts";

const names = namer(translator("es"), { gastos: "Gastos" });
const ids = () => {
  let n = 0;
  return () => `s_nuevo${++n}`;
};

const trigger = { id: "s_inicio", name: "Disparado por el usuario", type: "manual", params: {} };
const opened: Opened = {
  id: "a_01jexample",
  rev: 3,
  automation: {
    format: FORMAT,
    id: "a_01jexample",
    version: 0,
    name: "Revisar gastos",
    steps: [trigger],
    arrows: [],
    settings: {},
  },
  places: [{ step: "s_inicio", x: 0, y: 0 }],
  tests: {},
  tested: {},
  pins: {},
  device: "d_portatil",
  updated: 1,
};

describe("the draft saves itself", () => {
  it("AU-62 · «Nueva» owes the server nothing until its first step; every change after it is owed, and «Guardado» says saving, saved or failed", () => {
    const empty = emptyEditor("Nueva automatización");
    expect(empty.id).toBeNull();
    expect(empty.draft.name).toBe("Nueva automatización");
    expect(empty.owed).toEqual({ draft: false, places: [] });
    // Renamed before its first step: still nothing to send.
    const renamed = change(empty, { draft: { ...empty.draft, name: "Resumen" } });
    expect(renamed.owed.draft).toBe(false);
    expect(renamed.save).toBe("saved");
    // Its first step makes it.
    const first = change(renamed, { draft: { ...renamed.draft, steps: [trigger] } });
    expect(first.owed.draft).toBe(true);
    expect(first.save).toBe("saving");
    // Opened, every change is owed; one that changes nothing is nothing.
    const s = openedEditor(opened);
    expect(s.save).toBe("saved");
    expect(s.places).toEqual({ s_inicio: { x: 0, y: 0 } });
    expect(change(s, { draft: { ...s.draft } })).toBe(s);
    const edited = change(s, { draft: { ...s.draft, name: "Revisar gastos del mes" } });
    expect(edited.owed.draft).toBe(true);
    expect(edited.save).toBe("saving");
    expect(edited.past).toHaveLength(1);
    const kept = saved(edited, { rev: 4, stale: [] }, edited.draft);
    expect(kept.save).toBe("saved");
    expect(kept.rev).toBe(4);
    expect(kept.owed.draft).toBe(false);
    expect(saveFailed(edited).save).toBe("failed");
  });
  it("AU-62 · a save that fails leaves what is owed owed, and a change made while a save is out is sent after it, never lost and never before it", () => {
    const s = openedEditor(opened);
    const one = change(s, { draft: { ...s.draft, name: "Uno" } });
    const failed = saveFailed(one);
    expect(failed.owed.draft).toBe(true);
    expect(failed.draft.name).toBe("Uno");
    // Sent «Uno»; «Dos» typed while it was out: the answer to «Uno» leaves «Dos» owed, and «Dos» stays.
    const sent = failed.draft;
    const two = change(failed, { draft: { ...failed.draft, name: "Dos" } });
    const answered = saved(two, { rev: 4, stale: [] }, sent);
    expect(answered.draft.name).toBe("Dos");
    expect(answered.owed.draft).toBe(true);
    expect(answered.save).toBe("saving");
    const last = saved(answered, { rev: 5, stale: [] }, answered.draft);
    expect(last.owed.draft).toBe(false);
    expect(last.rev).toBe(5);
  });
  it("AU-05 · moving a box is owed as its place and not as a draft: the draft's rev does not change and no test becomes stale", () => {
    const s = { ...openedEditor(opened), tests: { s_inicio: { ok: true } as never } };
    const moved = change(s, { places: { s_inicio: { x: 40, y: 80 } } });
    expect(moved.owed).toEqual({ draft: false, places: ["s_inicio"] });
    expect(moved.save).toBe("saved");
    expect(moved.rev).toBe(3);
    expect(moved.tests).toBe(s.tests);
    expect(owedPlaces(moved)).toEqual([{ step: "s_inicio", x: 40, y: 80 }]);
    // Kept: owed no more; moved again while it was on its way: still owed, where it is now.
    expect(placesKept(moved, owedPlaces(moved)).owed.places).toEqual([]);
    const again = change(moved, { places: { s_inicio: { x: 60, y: 80 } } });
    const kept = placesKept(again, owedPlaces(moved));
    expect(kept.owed.places).toEqual(["s_inicio"]);
    expect(owedPlaces(kept)).toEqual([{ step: "s_inicio", x: 60, y: 80 }]);
  });
  it("AU-05, AU-62 · a box that did not arrive says «Sin guardar»; once the server keeps it, «Guardado», unless a draft is still owed", () => {
    const moved = change(openedEditor(opened), { places: { s_inicio: { x: 40, y: 80 } } });
    const failed = saveFailed(moved);
    expect(failed.save).toBe("failed");
    expect(placesKept(failed, owedPlaces(failed)).save).toBe("saved");
    // With the draft still owed it is the draft's save that says it.
    const both = saveFailed(change(moved, { draft: { ...moved.draft, name: "Otra" } }));
    expect(both.owed.draft).toBe(true);
    expect(placesKept(both, owedPlaces(both)).save).toBe("failed");
  });
  it("AU-05 · a step added has its place from then on, owed to the server like one Juan dropped: where the right click was, or where placeFor says; a later step never moves it", () => {
    const s = openedEditor(opened);
    const one = addStep(
      s.draft,
      "filter",
      undefined,
      { from: "output", step: "s_inicio", output: "main" },
      names,
      ids(),
    );
    const a = added(s, one, { from: "output", step: "s_inicio", output: "main" });
    expect(a.places.s_nuevo1).toEqual({ x: 300, y: 0 });
    expect(a.owed.places).toEqual(["s_nuevo1"]);
    expect(a.owed.draft).toBe(true);
    expect(a.selected).toEqual(["s_nuevo1"]);
    expect(a.open).toBe("s_nuevo1");
    expect(a.adding).toBeNull();
    // Right click: where it was.
    const two = addStep(
      a.draft,
      "sort",
      undefined,
      { from: "canvas", x: 40, y: 500 },
      names,
      () => "s_nuevo2",
    );
    const b = added(a, two, { from: "canvas", x: 40, y: 500 });
    expect(b.places.s_nuevo2).toEqual({ x: 40, y: 500 });
    // A later step moves none of them.
    const three = addStep(
      b.draft,
      "limit",
      undefined,
      { from: "output", step: "s_inicio", output: "main" },
      names,
      () => "s_nuevo3",
    );
    const c = added(b, three, { from: "output", step: "s_inicio", output: "main" });
    expect(c.places.s_inicio).toEqual(b.places.s_inicio);
    expect(c.places.s_nuevo1).toEqual(b.places.s_nuevo1);
    expect(c.places.s_nuevo2).toEqual(b.places.s_nuevo2);
    expect(c.places.s_nuevo3).toEqual({ x: 300, y: 104 });
    // One change each: one Deshacer takes the last away.
    expect(undo(c).draft).toEqual(b.draft);
  });
  it("AU-05 · on an empty canvas the first step makes the automation, and the boxes placed before the server answered are owed to it", () => {
    const empty = emptyEditor("Nueva automatización");
    const first = addStep(
      empty.draft,
      "manual",
      undefined,
      { from: "top" },
      names,
      () => "s_inicio",
    );
    const a = added(empty, first, { from: "top" });
    expect(a.owed).toEqual({ draft: true, places: [] });
    const made = created(a, { ...opened, places: [] }, a.draft);
    expect(made.id).toBe("a_01jexample");
    expect(made.places).toEqual({ s_inicio: { x: 0, y: 0 } });
    expect(owedPlaces(made)).toEqual([{ step: "s_inicio", x: 0, y: 0 }]);
    expect(made.selected).toEqual(["s_inicio"]);
    expect(made.past).toHaveLength(1);
    expect(made.past[0]?.draft.id).toBe("a_01jexample");
  });
});

describe("undo", () => {
  it("AU-68 · Deshacer walks back every change since the editor opened (a step added or removed, an arrow, a box moved, a name, a parameter, a setting) and Rehacer forward; a new change empties what could be redone", () => {
    let s = openedEditor(opened);
    const states = [s];
    const step = (next: Parameters<typeof change>[1]) => {
      s = change(s, next);
      states.push(s);
    };
    const made = addStep(
      s.draft,
      "collection",
      "find",
      { from: "output", step: "s_inicio", output: "main" },
      names,
      () => "s_b",
    );
    s = added(s, made, { from: "output", step: "s_inicio", output: "main" });
    states.push(s);
    step({ places: { ...s.places, s_b: { x: 320, y: 40 } } });
    step({ draft: rename(s.draft, "s_b", "Los gastos") });
    step({ draft: setParam(s.draft, "s_b", "collection", "gastos", names) });
    step({ draft: setSetting(s.draft, "s_b", "off", true) });
    const extra = addStep(s.draft, "filter", undefined, { from: "top" }, names, () => "s_c");
    s = added(s, extra, { from: "top" });
    states.push(s);
    const joined = connect(s.draft, {
      from: { step: "s_b", output: "main" },
      to: { step: "s_c", input: "main" },
    });
    if ("refused" in joined) throw new Error(joined.refused);
    step({ draft: joined });
    step({ draft: removeSteps(s.draft, ["s_c"]) });
    // Back, one by one, to the editor as it opened; then forward again to the end.
    for (let i = states.length - 2; i >= 0; i--) {
      s = undo(s);
      expect(s.draft).toEqual(states[i]?.draft);
      expect(s.places).toEqual(states[i]?.places);
    }
    expect(undo(s)).toBe(s);
    for (let i = 1; i < states.length; i++) {
      s = redo(s);
      expect(s.draft).toEqual(states[i]?.draft);
    }
    expect(redo(s)).toBe(s);
    // Two back and a new change: nothing to redo.
    s = change(undo(undo(s)), { draft: rename(s.draft, "s_b", "Otro") });
    expect(s.future).toEqual([]);
    expect(redo(s)).toBe(s);
  });
  it("AU-68 · what Deshacer brings back is owed to the server like any other change, and opening a step or selecting one is not a change", () => {
    const s = openedEditor(opened);
    const made = addStep(
      s.draft,
      "filter",
      undefined,
      { from: "output", step: "s_inicio", output: "main" },
      names,
      () => "s_b",
    );
    const a = added(s, made, { from: "output", step: "s_inicio", output: "main" });
    const kept = placesKept(saved(a, { rev: 4, stale: [] }, a.draft), owedPlaces(a));
    expect(kept.owed).toEqual({ draft: false, places: [] });
    const back = undo(kept);
    expect(back.draft).toEqual(opened.automation);
    expect(back.owed.draft).toBe(true);
    expect(back.save).toBe("saving");
    // What was selected or open of the step that is gone is let go.
    expect(back.selected).toEqual([]);
    expect(back.open).toBeNull();
    // Selecting and opening are no change: nothing to undo, nothing owed.
    const looked = { ...s, selected: ["s_inicio"], open: "s_inicio" };
    expect(looked.past).toEqual([]);
    expect(undo(looked)).toBe(looked);
    // Forward again: owed again too.
    expect(redo(back).owed.draft).toBe(true);
  });
  it("AU-82 · the notice of what a change of action took away undoes it in one step, parameters and name together", () => {
    const s0 = openedEditor(opened);
    const made = addStep(s0.draft, "collection", "find", { from: "top" }, names, ids());
    const s1 = change(s0, {
      draft: setParam(
        setParam(made.draft, made.step, "collection", "gastos", names),
        made.step,
        "limit",
        20,
        names,
      ),
    });
    const before = s1.draft;
    const { draft, dropped } = changeAction(before, made.step, "create", names);
    expect(dropped).toEqual(["limit"]);
    const s2 = { ...change(s1, { draft }), dropped: { step: made.step, params: dropped } };
    expect(s2.draft.steps.at(-1)?.name).toBe("Crear una fila en Gastos");
    // «Deshacer» in the notice: one step back, the parameters and the name together, and the notice gone.
    const back = undo(s2);
    expect(back.draft).toBe(before);
    expect(back.dropped).toBeNull();
    // Any other change after it, and the notice is gone too: it says the last change only.
    const later = change(s2, { draft: setParam(s2.draft, made.step, "fields", [], names) });
    expect(later.dropped).toBeNull();
  });
  it("AU-68 · typing in one field of the view is one step of Deshacer, and another field or a field entered again is another", () => {
    const s0 = openedEditor(opened);
    const made = addStep(s0.draft, "stop", undefined, { from: "top" }, names, ids());
    const s1 = change(s0, { draft: made.draft });
    let s = s1;
    for (const text of ["N", "No", "No h", "No hay"])
      s = change(s, { draft: setParam(s.draft, made.step, "message", text, names) }, "s.message#1");
    expect(s.past).toHaveLength(s1.past.length + 1);
    expect(undo(s).draft).toBe(s1.draft);
    // The field entered again: another step.
    const again = change(
      s,
      { draft: setParam(s.draft, made.step, "message", "No hay nada", names) },
      "s.message#2",
    );
    expect(again.past).toHaveLength(s.past.length + 1);
    expect(undo(again).draft.steps.at(-1)?.params.message).toBe("No hay");
    // A change of nothing typed in between ends the run.
    const off = change(s, { draft: setSetting(s.draft, made.step, "off", true) });
    const more = change(
      off,
      { draft: setParam(off.draft, made.step, "message", "No hay!", names) },
      "s.message#1",
    );
    expect(more.past).toHaveLength(off.past.length + 1);
    // Deshacer ends a run too.
    expect(undo(s).typing).toBeNull();
  });
});

describe("after a test", () => {
  const filter = { id: "s_filtro", name: "Filtrar", type: "filter", params: {} };
  const sort = { id: "s_orden", name: "Ordenar", type: "sort", params: {} };
  const three: Opened = {
    ...opened,
    automation: {
      ...opened.automation,
      steps: [trigger, filter, sort],
      arrows: [
        { from: { step: "s_inicio", output: "main" }, to: { step: "s_filtro", input: "main" } },
        { from: { step: "s_filtro", output: "yes" }, to: { step: "s_orden", input: "main" } },
      ],
    },
  };
  const stepTest = (over: Partial<StepTest>): StepTest => ({
    state: "done",
    at: 1_000,
    ms: 100,
    in: { main: 1 },
    out: { main: 1 },
    retries: 0,
    failed: 0,
    wouldWrite: 0,
    stale: false,
    ...over,
  });
  const done: TestAnswer = {
    state: "done",
    problems: [],
    ms: 4_100,
    ran: ["s_inicio", "s_filtro", "s_orden"],
    reused: [],
    tests: {
      s_inicio: stepTest({ in: {}, out: { main: 128 } }),
      s_filtro: stepTest({ in: { main: 128 }, out: { yes: 3, no: 125 } }),
      s_orden: stepTest({ in: { main: 3 }, out: { main: 3 }, wouldWrite: 0 }),
    },
  };
  const t = translator("es");
  const nameOf = (id: string) => three.automation.steps.find((s) => s.id === id)?.name ?? id;
  it("AU-203 · a test that reached a «Preguntar» says it waits; answered, it says how the test ended", () => {
    const ask = {
      answer: "yesNo" as const,
      mode: "all" as const,
      questions: [
        { text: "¿Sigo?", label: { integrity: "trusted", sensitivity: "private" } as never },
      ],
      until: 99_000,
    };
    const waiting = tested(
      askTest(openedEditor(three), null),
      {
        ...done,
        state: "waiting",
        ran: ["s_inicio", "s_filtro"],
        tests: { ...done.tests, s_filtro: stepTest({ state: "waiting", ask, out: {} }) },
      },
      40_000,
    );
    expect(logLine(waiting)).toEqual({ kind: "waiting", at: 40_000, step: "s_filtro" });
    expect(logWords(t, "es", logLine(waiting), nameOf, 40_000)).toBe(
      "Última prueba hace un momento · esperando respuesta",
    );
    // The answer goes on with the same test: its end is what the «Registro» says now.
    const answered = tested(askTest(waiting, null), done, 50_000);
    expect(logLine(answered)).toMatchObject({ kind: "tested", ok: true });
  });
  it("AU-64 · «Registro» says untested, then the last test in one line (when, how it ended, how many steps, how long, that it wrote nothing) or the step it failed in; with problems it says how many and tests nothing", () => {
    const s = openedEditor(three);
    expect(logLine(s)).toEqual({ kind: "untested" });
    expect(logWords(t, "es", logLine(s), nameOf, 0)).toBe("Sin probar");
    const asking = askTest(s, null);
    expect(asking.testing).toEqual({ step: null });
    const answered = tested(asking, done, 10_000, {
      trigger: "s_inicio",
      fields: { mes: "marzo" },
    });
    expect(answered.testing).toBeNull();
    expect(logLine(answered)).toEqual({
      kind: "tested",
      at: 10_000,
      ok: true,
      steps: 3,
      ms: 4_100,
      wouldWrite: 0,
    });
    expect(logWords(t, "es", logLine(answered), nameOf, 10_000 + 2 * 60_000 + 5_000)).toBe(
      "Última prueba hace 2 min · completada · 3 pasos · 4,1 s · no escribió nada",
    );
    // The fields it was tested with are what «Probar» offers next (AU-94).
    expect(answered.tested.s_inicio).toEqual({ mes: "marzo" });
    const failed = tested(
      askTest(answered, null),
      {
        ...done,
        state: "failed",
        failedAt: "s_filtro",
        ran: ["s_inicio", "s_filtro"],
        tests: {
          ...done.tests,
          s_filtro: stepTest({ state: "failed", out: {} }),
          s_orden: stepTest({ state: "stopped", in: {}, out: {} }),
        },
      },
      20_000,
    );
    expect(logWords(t, "es", logLine(failed), nameOf, 20_000)).toBe(
      "Última prueba hace un momento · falló en «Filtrar» · 2 pasos · 4,1 s",
    );
    expect(failedAt(failed)).toBe("s_filtro");
    // With problems nothing is tested: the tests kept stay, and «Registro» says how many and which step first.
    const invalid = tested(
      askTest(failed, null),
      {
        state: "invalid",
        problems: [
          { code: "param.required", severity: "error", step: "s_orden", param: "by" },
          { code: "param.required", severity: "error", step: "s_filtro", param: "where" },
        ],
        ms: 0,
        ran: [],
        reused: [],
        tests: {},
      },
      30_000,
    );
    expect(invalid.tests).toBe(failed.tests);
    expect(invalid.problems).toHaveLength(2);
    expect(logLine(invalid)).toEqual({ kind: "problems", count: 2, first: "s_orden" });
    expect(logWords(t, "es", logLine(invalid), nameOf, 30_000)).toBe("2 problemas");
    // A test that never arrived leaves things as they were, but no longer running.
    expect(testLost(askTest(failed, null)).testing).toBeNull();
    // Opened again on another device, «Registro» says what the kept tests say.
    const again = openedEditor({ ...three, tests: done.tests });
    expect(logLine(again)).toMatchObject({ kind: "tested", ok: true, steps: 3 });
  });
  it("AU-67 · every arrow has the rows that passed by it and every output with no arrow its count; a step the test did not reach because it stopped is «parado», and «saltado» only one that got no rows; the arrows and the outputs of a step that failed say no count", () => {
    const s = tested(askTest(openedEditor(three), null), done, 10_000);
    const [first, second] = three.automation.arrows;
    expect(arrowCount(openedEditor(three), first as Arrow)).toBeNull();
    expect(arrowCount(s, first as Arrow)).toEqual({ rows: 128, stale: false });
    expect(arrowCount(s, second as Arrow)).toEqual({ rows: 3, stale: false });
    // «no» has no arrow: its 125 rows are seen too.
    expect(outputCount(s, "s_filtro", "no")).toEqual({ rows: 125, stale: false });
    expect(outputCount(s, "s_orden", "main")).toEqual({ rows: 3, stale: false });
    const stopped = tested(
      s,
      {
        ...done,
        state: "failed",
        failedAt: "s_filtro",
        tests: {
          ...done.tests,
          s_filtro: stepTest({ state: "failed", out: {} }),
          s_orden: stepTest({ state: "stopped", in: {}, out: {} }),
        },
      },
      20_000,
    );
    // The failed step's arrows and its outputs with none say no count; nor does the one it stopped before.
    expect(arrowCount(stopped, second as Arrow)).toBeNull();
    expect(outputCount(stopped, "s_filtro", "no")).toBeNull();
    expect(outputCount(stopped, "s_orden", "main")).toBeNull();
    expect(outputSays(sort as Step, stopped.tests.s_orden)).toEqual({ kind: "stopped" });
    const skipped = {
      ...done.tests,
      s_orden: stepTest({ state: "skipped", in: { main: 0 }, out: {} }),
    };
    expect(outputSays(sort as Step, skipped.s_orden)).toEqual({ kind: "skipped" });
  });
  it("AU-92 · the steps the server says are stale after a save keep their counts, marked; a test of them clears the mark", () => {
    const s = tested(askTest(openedEditor(three), null), done, 10_000);
    const edited = change(s, { draft: setParam(s.draft, "s_filtro", "where", [], names) });
    const kept = saved(edited, { rev: 4, stale: ["s_filtro", "s_orden"] }, edited.draft);
    expect(kept.tests.s_filtro?.stale).toBe(true);
    expect(kept.tests.s_orden?.stale).toBe(true);
    expect(kept.tests.s_inicio?.stale).toBe(false);
    expect(arrowCount(kept, three.automation.arrows[1] as Arrow)).toEqual({ rows: 3, stale: true });
    expect(outputCount(kept, "s_filtro", "no")).toEqual({ rows: 125, stale: true });
    // A step the server does not name is left as it was; one with no test has nothing to mark.
    expect(saved(edited, { rev: 4, stale: ["s_nada"] }, edited.draft).tests).toEqual(s.tests);
    // Tested again: the server's tests are not stale.
    const again = tested(askTest(kept, "s_orden"), done, 30_000);
    expect(again.tests.s_orden?.stale).toBe(false);
    expect(arrowCount(again, three.automation.arrows[1] as Arrow)?.stale).toBe(false);
  });
  it("AU-83 (E, «Probar») · the problems shown after a test was asked leave a step as soon as it changes, and none is shown before one is asked", () => {
    const s = openedEditor(three);
    expect(s.problems).toEqual([]);
    expect(s.asked).toBe(false);
    const asked = askTest(s, null);
    expect(asked.asked).toBe(true);
    const invalid = tested(
      asked,
      {
        state: "invalid",
        problems: [
          { code: "param.required", severity: "error", step: "s_orden", param: "by" },
          { code: "param.required", severity: "error", step: "s_filtro", param: "where" },
          { code: "trigger.none", severity: "error" },
        ],
        ms: 0,
        ran: [],
        reused: [],
        tests: {},
      },
      1,
    );
    expect(invalid.problems).toHaveLength(3);
    // A change elsewhere keeps them; the step that changes loses its own, and only those.
    const renamed = change(invalid, { draft: { ...invalid.draft, name: "Otro nombre" } });
    expect(renamed.problems).toHaveLength(3);
    const changed = change(renamed, {
      draft: setParam(renamed.draft, "s_orden", "by", [{ field: "fecha" }], names),
    });
    expect(changed.problems.map((p) => p.step)).toEqual(["s_filtro", undefined]);
    // Deshacer gives the step back as it was, not its problem: it shows again with the next test.
    expect(undo(changed).problems.map((p) => p.step)).toEqual(["s_filtro", undefined]);
    // A step taken away takes its problems with it.
    const gone = change(changed, { draft: removeSteps(changed.draft, ["s_filtro"]) });
    expect(gone.problems.map((p) => p.step)).toEqual([undefined]);
  });
});
