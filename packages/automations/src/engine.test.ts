// The engine's rules (docs/automatizaciones.md §5.2). Real tests use the repo's invented seeds and fakes of `Policy`,
// `Collections`, `Clock` and `Dates` (run.test-util.ts): never a store.
import { describe, expect, it } from "vitest";
import { rng } from "../../entities/src/random.test-util.ts";
import { cite, collection, ids, knowing, sketch } from "./automation.test-util.ts";
import { CATALOGUE, isTrigger } from "./catalogue.ts";
import type { Dates } from "./effects.ts";
import { CannotRun, ERROR_FIELD, EXECUTORS, executorKey, STEP_STATES } from "./engine.ts";
import { MAIN, OUT } from "./format.ts";
import { executionOrder, findCycle, wouldCycle } from "./graph.ts";
import { clock, dates, OWN, outOf, start, store } from "./run.test-util.ts";
import { canRun, validate } from "./validate.ts";

/** A list of numbers as rows: a fixed list in one field, then «Separar» over it. */
const numbers = (s: ReturnType<typeof sketch>, list: number[]) =>
  s
    .step("Inicio", "manual")
    .step("Lista", "edit", { fields: [{ field: "n", value: list }] })
    .step("Partir", "split", { field: "n" })
    .arrow("Inicio", "Lista")
    .arrow("Lista", "Partir");

describe("how an automation runs", () => {
  it("AU-04 · rows pass along the arrows, and a row read from a collection still knows its saved row: a later step modifies it without searching again", async () => {
    const next = ids(4);
    const items = collection(next, ["text", "number"]);
    const [name, n] = items.fields.map((f) => f.key) as [string, string];
    const s = sketch()
      .step("Inicio", "manual")
      .step("Buscar", "collection", {
        collection: items.key,
        action: "find",
        where: [{ field: n, op: "gt", value: 1 }],
      })
      .step("Filtrar", "filter", { where: [{ field: n, op: "lt", value: 4 }] })
      .step("Modificar", "collection", {
        collection: items.key,
        action: "update",
        fields: [{ field: name, value: "vista" }],
      })
      .arrow("Inicio", "Buscar")
      .arrow("Buscar", "Filtrar")
      .arrow("Filtrar", "Modificar");
    const db = store(
      [items],
      { [items.key]: [1, 2, 3, 4].map((v) => ({ [name]: `fila ${v}`, [n]: v })) },
      next,
    );
    const found = db
      .rows(items.key)
      .slice(1, 3)
      .map((r) => r.origin);
    const e = await start(s.build(), s.id("Inicio"), {}, { collections: db });

    // One search; the rows keep where they are saved through «Filtrar», and «Modificar» writes those two.
    expect(db.calls.map((c) => c.method)).toEqual(["find", "apply", "apply"]);
    expect(e.steps[s.id("Filtrar")]?.out[MAIN]?.map((r) => r.origin)).toEqual(found);
    expect(db.applied).toEqual(
      found.map((row) => ({ kind: "update", row, fields: { [name]: "vista" } })),
    );
    expect(outOf(e, s.id("Modificar"))).toEqual([
      { [name]: "vista", [n]: 2 },
      { [name]: "vista", [n]: 3 },
    ]);
    expect(e.steps[s.id("Modificar")]?.out[MAIN]?.map((r) => r.origin?.version)).toEqual([2, 2]);

    // A step that remakes the rows drops where they came from: modifying what it gives fails, saying why.
    const grouped = sketch()
      .step("Inicio", "manual")
      .step("Buscar", "collection", { collection: items.key, action: "find" })
      .step("Agrupar", "group", {
        by: [{ field: n }],
        measures: [{ to: "filas", measure: "count" }],
      })
      .step("Modificar", "collection", {
        collection: items.key,
        action: "update",
        fields: [{ field: name, value: "vista" }],
      })
      .arrow("Inicio", "Buscar")
      .arrow("Buscar", "Agrupar")
      .arrow("Agrupar", "Modificar");
    const failed = await start(grouped.build(), grouped.id("Inicio"), {}, { collections: db });
    expect(failed.error).toEqual({
      step: grouped.id("Modificar"),
      message: `the row that arrives is not a saved row of the collection ${items.key}`,
      row: 0,
    });
  });
  it("AU-06 · with two triggers a run starts in one: the steps that hang only from the other have no record and do not hold back a step both reach", async () => {
    const asks = { fields: [{ key: "de", name: "De", type: "text" }] };
    const s = sketch()
      .step("Uno", "manual", asks)
      .step("Dos", "manual", asks)
      .step("Juntos", "limit", { count: 5 })
      .step("Solo de dos", "edit", { fields: [{ field: "x", value: 1 }] })
      .arrow("Uno", "Juntos")
      .arrow("Dos", "Juntos")
      .arrow("Dos", "Solo de dos");
    const a = s.build();
    const one = await start(a, s.id("Uno"), { de: "uno" });
    expect(one.trigger).toBe(s.id("Uno"));
    expect(one.order).toEqual([s.id("Uno"), s.id("Juntos")]);
    expect(Object.keys(one.steps).sort()).toEqual([s.id("Uno"), s.id("Juntos")].sort());
    expect(one.steps[s.id("Juntos")]?.state).toBe("done");
    expect(outOf(one, s.id("Juntos"))).toEqual([{ de: "uno" }]);

    const two = await start(a, s.id("Dos"), { de: "dos" });
    expect(two.order).toEqual([s.id("Dos"), s.id("Juntos"), s.id("Solo de dos")]);
    expect(outOf(two, s.id("Juntos"))).toEqual([{ de: "dos" }]);
    expect(outOf(two, s.id("Solo de dos"))).toEqual([{ de: "dos", x: 1 }]);
  });
  it("AU-07 · an arrow that goes back is a cycle: wouldCycle says so before it is added and validation refuses the automation", () => {
    const s = sketch()
      .step("Inicio", "manual")
      .step("Uno", "limit", { count: 3 })
      .step("Dos", "limit", { count: 2 })
      .step("Tres", "limit", { count: 1 })
      .arrow("Inicio", "Uno")
      .arrow("Uno", "Dos")
      .arrow("Dos", "Tres");
    const a = s.build();
    const back = {
      from: { step: s.id("Tres"), output: MAIN },
      to: { step: s.id("Uno"), input: MAIN },
    };
    const self = {
      from: { step: s.id("Dos"), output: MAIN },
      to: { step: s.id("Dos"), input: MAIN },
    };
    const ahead = {
      from: { step: s.id("Uno"), output: MAIN },
      to: { step: s.id("Tres"), input: MAIN },
    };
    expect(wouldCycle(a, back)).toBe(true);
    expect(wouldCycle(a, self)).toBe(true);
    expect(wouldCycle(a, ahead)).toBe(false);
    expect(findCycle(a)).toBeNull();
    expect(validate(a, knowing())).toEqual([]);

    a.arrows.push(back);
    expect(findCycle(a)).toEqual([s.id("Uno"), s.id("Dos"), s.id("Tres")]);
    const cycle = validate(a, knowing()).filter((p) => p.code === "arrow.cycle");
    // Every arrow of the cycle is marked, and none outside it.
    expect(cycle.map((p) => p.arrow)).toEqual([1, 2, 3]);
    expect(canRun(validate(a, knowing()))).toBe(false);
    expect(() => executionOrder(a, s.id("Inicio"))).toThrow(/cycle/);
  });
  it("AU-10 · a step is decided when every step that reaches it has finished: it runs if some arrow brings rows, and if none does it is skipped with what hangs only from it", async () => {
    const s = sketch()
      .step("Inicio", "manual", { fields: [{ key: "n", name: "N", type: "number" }] })
      .step("Ninguna", "filter", { where: [{ field: "n", op: "gt", value: 100 }] })
      .step("Tras ninguna", "edit", { fields: [{ field: "a", value: 1 }] })
      .step("Y después", "edit", { fields: [{ field: "b", value: 2 }] })
      .step("Marca", "edit", { fields: [{ field: "c", value: 3 }] })
      .step("Las dos", "limit", { count: 10 })
      .arrow("Inicio", "Ninguna")
      .arrow("Ninguna", "Tras ninguna")
      .arrow("Tras ninguna", "Y después")
      .arrow("Inicio", "Marca")
      .arrow("Marca", "Las dos")
      .arrow("Ninguna", "Las dos");
    const e = await start(s.build(), s.id("Inicio"), { n: 5 });
    const state = (name: string) => e.steps[s.id(name)]?.state;
    expect(state("Ninguna")).toBe("done");
    expect(outOf(e, s.id("Ninguna"))).toEqual([]);
    expect(state("Tras ninguna")).toBe("skipped");
    expect(state("Y después")).toBe("skipped");
    expect(e.steps[s.id("Tras ninguna")]?.in).toEqual({ [MAIN]: 0 });
    // «Las dos» waits for both, and runs with what «Marca» brought.
    const place = (name: string) => e.order.indexOf(s.id(name));
    expect(place("Las dos")).toBeGreaterThan(place("Ninguna"));
    expect(place("Las dos")).toBeGreaterThan(place("Marca"));
    expect(state("Las dos")).toBe("done");
    expect(outOf(e, s.id("Las dos"))).toEqual([{ n: 5, c: 3 }]);
    expect(e.state).toBe("done");
  });
  it("AU-11 · rows that reach a step by several arrows are put together in a fixed order and the step runs once", async () => {
    const s = numbers(sketch(), [1, 2, 3, 4])
      .step("Si", "if", { where: [{ field: "n", op: "gt", value: 2 }] })
      .step("Grandes", "edit", { fields: [{ field: "t", value: "grande" }] })
      .step("Pequeñas", "edit", { fields: [{ field: "t", value: "pequeña" }] })
      .step("Juntas", "limit", { count: 10 })
      .step("Las dos salidas", "limit", { count: 10 })
      .arrow("Partir", "Si")
      .arrow("Si", "Grandes", OUT.yes)
      .arrow("Si", "Pequeñas", OUT.no)
      // Saved in the other order: the order is the steps' and the outputs', never the arrows'.
      .arrow("Pequeñas", "Juntas")
      .arrow("Grandes", "Juntas")
      .arrow("Si", "Las dos salidas", OUT.no)
      .arrow("Si", "Las dos salidas", OUT.yes);
    const e = await start(s.build(), s.id("Inicio"));
    expect(e.order.indexOf(s.id("Grandes"))).toBeLessThan(e.order.indexOf(s.id("Pequeñas")));
    expect(outOf(e, s.id("Juntas"))).toEqual([
      { n: 3, t: "grande" },
      { n: 4, t: "grande" },
      { n: 1, t: "pequeña" },
      { n: 2, t: "pequeña" },
    ]);
    expect(e.steps[s.id("Juntas")]?.in).toEqual({ [MAIN]: 4 });
    expect(outOf(e, s.id("Las dos salidas"))).toEqual([{ n: 3 }, { n: 4 }, { n: 1 }, { n: 2 }]);
    expect(e.order.filter((id) => id === s.id("Juntas"))).toHaveLength(1);
  });
  it("AU-12 · the same automation with its steps and arrows saved in another order runs the same steps in the same order with the same rows", async () => {
    const s = numbers(sketch(9), [5, 1, 4, 2, 3, 1])
      .step("Elegir", "switch", {
        rules: [
          { id: "r_pocas", name: "Pocas", where: [{ field: "n", op: "lt", value: 3 }] },
          { id: "r_muchas", name: "Muchas", where: [{ field: "n", op: "gt", value: 3 }] },
        ],
        fallback: "other",
      })
      .step("Pocas", "edit", { fields: [{ field: "t", value: "pocas" }] })
      .step("Muchas", "sort", { by: [{ field: "n", direction: "desc" }] })
      .step("Otras", "dedupe", {})
      .step("Juntas", "dedupe", { by: "fields", fields: [{ field: "n" }] })
      .step("Cruzar", "combine", { by: "position", keep: "both" })
      .arrow("Partir", "Elegir")
      .arrow("Elegir", "Pocas", "r_pocas")
      .arrow("Elegir", "Muchas", "r_muchas")
      .arrow("Elegir", "Otras", OUT.other)
      .arrow("Pocas", "Juntas")
      .arrow("Muchas", "Juntas")
      .arrow("Otras", "Juntas")
      .arrow("Juntas", "Cruzar", MAIN, "a")
      .arrow("Muchas", "Cruzar", MAIN, "b");
    const a = s.build();
    const want = await start(a, s.id("Inicio"));
    expect(want.state).toBe("done");
    expect(outOf(want, s.id("Juntas"))).toEqual([
      { n: 1, t: "pocas" },
      { n: 2, t: "pocas" },
      { n: 5 },
      { n: 4 },
      { n: 3 },
    ]);
    const r = rng(12);
    const shuffle = <T>(xs: readonly T[]) =>
      xs
        .map((x) => [r.next(), x] as const)
        .sort((x, y) => x[0] - y[0])
        .map(([, x]) => x);
    for (let i = 0; i < 10; i++) {
      const b = { ...a, steps: shuffle(a.steps), arrows: shuffle(a.arrows) };
      expect(await start(b, s.id("Inicio"))).toEqual(want);
    }
  });
  it("AU-13 · the engine loops for a step that works per row, and each row out finds its own with .item; after a step that remakes the rows .item says it cannot and proposes .first() or .all()", async () => {
    const s = numbers(sketch(), [1, 2, 3])
      .step("Ordenar", "sort", { by: [{ field: "n", direction: "desc" }] })
      .step("Suya", "edit", {
        keep: "none",
        fields: [
          { field: "de", value: cite("$('Partir').item.n") },
          { field: "primera", value: cite("$('Partir').first().n") },
          { field: "lista", value: cite("$('Lista').item.n") },
        ],
      })
      .arrow("Partir", "Ordenar")
      .arrow("Ordenar", "Suya");
    const e = await start(s.build(), s.id("Inicio"));
    // Sorting passes the same rows on: each still finds the row of «Partir» it is.
    expect(outOf(e, s.id("Suya"))).toEqual([
      { de: 3, primera: 1, lista: [1, 2, 3] },
      { de: 2, primera: 1, lista: [1, 2, 3] },
      { de: 1, primera: 1, lista: [1, 2, 3] },
    ]);
    expect(e.steps[s.id("Suya")]?.out[MAIN]?.map((r) => r.parent)).toEqual([0, 1, 2]);
    expect(e.steps[s.id("Ordenar")]?.out[MAIN]?.map((r) => r.parent)).toEqual([2, 1, 0]);

    // After «Agrupar», `.item` cannot pair: validation says which step stands between, and `.first()` works.
    const grouped = numbers(sketch(), [1, 2, 3])
      .step("Agrupar", "group", { measures: [{ to: "total", measure: "sum", field: "n" }] })
      .step("Tras", "edit", { fields: [{ field: "de", value: cite("$('Partir').first().n") }] })
      .arrow("Partir", "Agrupar")
      .arrow("Agrupar", "Tras");
    const g = await start(grouped.build(), grouped.id("Inicio"));
    expect(outOf(g, grouped.id("Tras"))).toEqual([{ total: 6, de: 1 }]);
    const bad = grouped.build();
    (bad.steps.find((x) => x.name === "Tras") as (typeof bad.steps)[number]).params.fields = [
      { field: "de", value: cite("$('Partir').item.n") },
    ];
    expect(validate(bad, knowing()).map((p) => [p.code, p.detail])).toEqual([
      [
        "expr.cannotPair",
        { name: "Partir", by: "Agrupar", first: "$('Partir').first().n", all: "$('Partir').all()" },
      ],
    ]);
    await expect(start(bad, grouped.id("Inicio"))).rejects.toBeInstanceOf(CannotRun);

    // A row that did not pass through the step it cites: `.item` fails for that row, with `noPair`.
    const branches = numbers(sketch(), [1, 2, 3])
      .step("Si", "if", { where: [{ field: "n", op: "gt", value: 1 }] })
      .step("Marca", "edit", { fields: [{ field: "x", value: "marca" }] })
      .step(
        "Junta",
        "edit",
        { fields: [{ field: "y", value: cite("$('Marca').item.x") }] },
        { onError: "continue" },
      )
      .arrow("Partir", "Si")
      .arrow("Si", "Marca", OUT.yes)
      .arrow("Si", "Junta", OUT.no)
      .arrow("Marca", "Junta");
    const b = await start(branches.build(), branches.id("Inicio"));
    const junta = b.steps[branches.id("Junta")];
    expect(outOf(b, branches.id("Junta"))).toEqual([
      { n: 2, x: "marca", y: "marca" },
      { n: 3, x: "marca", y: "marca" },
    ]);
    expect(junta?.failed).toBe(1);
    // «Si» comes before «Marca» (AU-11): its row is the first of «Junta».
    expect(junta?.error).toEqual({ message: "noPair: Marca", row: 0 });
  });
  it("AU-14 · an arrow with no rows does not start what follows; with «Seguir sin filas» what follows runs with an empty list, never with an invented row: a step that writes runs once with no current row", async () => {
    const next = ids(14);
    const items = collection(next, ["text", "number"]);
    const notes = collection(next, ["text"]);
    const [name, n] = items.fields.map((f) => f.key) as [string, string];
    const [text] = notes.fields.map((f) => f.key) as [string];
    const flow = (continueEmpty: boolean, value: ReturnType<typeof cite> | string) => {
      const s = sketch()
        .step("Inicio", "manual")
        .step(
          "Buscar",
          "collection",
          { collection: items.key, action: "find", where: [{ field: n, op: "gt", value: 100 }] },
          { continueEmpty },
        )
        .step("Filtrar", "filter", { where: [{ field: n, op: "gt", value: 0 }] })
        .step("Tras filtrar", "limit", { count: 1 })
        .step("Avisar", "collection", {
          collection: notes.key,
          action: "create",
          fields: [{ field: text, value }],
        })
        .arrow("Inicio", "Buscar")
        .arrow("Buscar", "Filtrar")
        .arrow("Filtrar", "Tras filtrar")
        .arrow("Buscar", "Avisar");
      return s;
    };
    const fresh = () =>
      store([items, notes], { [items.key]: [{ [name]: "una", [n]: 1 }] }, ids(15));

    // No rows and no «Seguir sin filas»: what follows is skipped, and nothing is written.
    const off = flow(false, "no hay nada");
    const db = fresh();
    const e = await start(off.build(), off.id("Inicio"), {}, { collections: db });
    for (const step of ["Filtrar", "Tras filtrar", "Avisar"])
      expect(e.steps[off.id(step)]?.state, step).toBe("skipped");
    expect(db.applied).toEqual([]);

    // With it: «Crear una fila» runs once with its fixed values; «Filtrar» gets an empty list and gives no row, so
    // what hangs from it is skipped.
    const on = flow(true, "no hay nada");
    const db2 = fresh();
    const e2 = await start(on.build(), on.id("Inicio"), {}, { collections: db2 });
    expect(e2.steps[on.id("Filtrar")]).toMatchObject({
      state: "done",
      in: { main: 0 },
      out: { main: [] },
    });
    expect(e2.steps[on.id("Tras filtrar")]?.state).toBe("skipped");
    expect(db2.applied).toEqual([
      { kind: "create", collection: notes.key, fields: { [text]: "no hay nada" } },
    ]);
    expect(outOf(e2, on.id("Avisar"))).toEqual([{ [text]: "no hay nada" }]);

    // There is no row to cite: `$json` fails, and says so.
    const cites = flow(true, cite(`$json.${name}`));
    const e3 = await start(cites.build(), cites.id("Inicio"), {}, { collections: fresh() });
    expect(e3.state).toBe("failed");
    expect(e3.error).toMatchObject({
      step: cites.id("Avisar"),
      message: expect.stringMatching(/noCurrentRow/),
    });
  });
  it("AU-15 · a run records, per step, its state, the rows in and the rows out by each output, how long it took and what came out", async () => {
    const s = sketch()
      .step("Inicio", "manual", { fields: [{ key: "n", name: "N", type: "number" }] })
      .step(
        "Si",
        "if",
        { where: [{ field: "n", op: "gt", value: 0 }] },
        { retry: { times: 1, waitMs: 0 } },
      )
      .step("Sí", "edit", { fields: [{ field: "t", value: "sí" }] })
      .step("No", "edit", { fields: [{ field: "t", value: "no" }] })
      .arrow("Inicio", "Si")
      .arrow("Si", "Sí", OUT.yes)
      .arrow("Si", "No", OUT.no);
    const a = s.build();
    const c = clock();
    const e = await start(a, s.id("Inicio"), { n: 5 }, { clock: c });
    const row = (json: Record<string, unknown>) => ({
      json,
      label: OWN,
      path: expect.anything(),
      parent: 0,
    });
    expect(e).toEqual({
      automation: { id: a.id, version: 0 },
      trigger: s.id("Inicio"),
      test: false,
      state: "done",
      started: c.now(),
      ms: 0,
      order: [s.id("Inicio"), s.id("Si"), s.id("Sí"), s.id("No")],
      steps: {
        [s.id("Inicio")]: {
          state: "done",
          in: {},
          out: { [MAIN]: [{ json: { n: 5 }, label: OWN, path: null, parent: null }] },
          ms: 0,
          retries: 0,
          failed: 0,
          asked: 0,
        },
        [s.id("Si")]: {
          state: "done",
          in: { [MAIN]: 1 },
          out: { [OUT.yes]: [row({ n: 5 })], [OUT.no]: [] },
          ms: 0,
          retries: 0,
          failed: 0,
          asked: 0,
        },
        [s.id("Sí")]: {
          state: "done",
          in: { [MAIN]: 1 },
          out: { [MAIN]: [row({ n: 5, t: "sí" })] },
          ms: 0,
          retries: 0,
          failed: 0,
          asked: 0,
        },
        [s.id("No")]: {
          state: "skipped",
          in: { [MAIN]: 0 },
          out: { [MAIN]: [] },
          ms: 0,
          retries: 0,
          failed: 0,
          asked: 0,
        },
      },
      asked: [],
    });
    for (const r of Object.values(e.steps)) expect(STEP_STATES).toContain(r.state);
  });
  it("AU-16 · a failing step stops the run by default, drops its rows with «Seguir» or sends them out by «error» with the reason; it is retried up to 5 times with a wait", async () => {
    const failing = (settings?: Parameters<ReturnType<typeof sketch>["step"]>[3]) =>
      sketch()
        .step("Inicio", "manual", { fields: [{ key: "t", name: "T", type: "text" }] })
        .step("Partir", "split", { field: "t" }, settings)
        .step("Después", "edit", { fields: [{ field: "x", value: 1 }] })
        .step("Arreglo", "edit", { fields: [{ field: "x", value: 2 }] })
        .arrow("Inicio", "Partir")
        .arrow("Partir", "Después");
    const reason = "the field t does not hold a list";

    // «Parar», the default: the run fails there and what was not decided is stopped.
    const s = failing();
    const stop = await start(s.build(), s.id("Inicio"), { t: "no es una lista" });
    expect(stop.state).toBe("failed");
    expect(stop.error).toEqual({ step: s.id("Partir"), message: reason, row: 0 });
    expect(stop.steps[s.id("Partir")]?.state).toBe("failed");
    expect(stop.steps[s.id("Después")]?.state).toBe("stopped");

    // «Seguir»: the row is dropped, counted, and the run goes on.
    const go = failing({ onError: "continue" });
    const on = await start(go.build(), go.id("Inicio"), { t: "no es una lista" });
    expect(on.state).toBe("done");
    expect(on.steps[go.id("Partir")]).toMatchObject({
      state: "done",
      failed: 1,
      error: { message: reason, row: 0 },
    });
    expect(on.steps[go.id("Después")]?.state).toBe("skipped");

    // «Salir por error»: the row goes out by «error» with the reason, a field of the engine's.
    const out = failing({ onError: "errorOutput" }).arrow("Partir", "Arreglo", OUT.error);
    const err = await start(out.build(), out.id("Inicio"), { t: "no es una lista" });
    expect(outOf(err, out.id("Arreglo"))).toEqual([
      { t: "no es una lista", [ERROR_FIELD]: { message: reason }, x: 2 },
    ]);
    expect(err.steps[out.id("Partir")]?.out[OUT.error]?.[0]?.fields).toEqual({
      [ERROR_FIELD]: { label: OWN, derived: true },
    });

    // «Reintentar»: up to 5 more tries, waiting before each; the wait is in the step's time.
    const again = failing({ retry: { times: 5, waitMs: 1000 } });
    const c = clock();
    const tried = await start(again.build(), again.id("Inicio"), { t: "no" }, { clock: c });
    expect(tried.steps[again.id("Partir")]).toMatchObject({
      state: "failed",
      retries: 5,
      ms: 5000,
    });
    expect(c.slept).toEqual([1000, 1000, 1000, 1000, 1000]);
    expect(tried.ms).toBe(5000);

    // A try that works ends the retrying.
    let calls = 0;
    const flaky: Dates = {
      ...dates,
      add(...args) {
        calls++;
        if (calls === 1) throw new Error("not now");
        return dates.add(...args);
      },
    };
    const later = sketch()
      .step("Inicio", "manual", { fields: [{ key: "d", name: "D", type: "date" }] })
      .step(
        "Mañana",
        "date",
        { action: "add", date: cite("$json.d"), amount: 1, to: "mañana" },
        { retry: { times: 2, waitMs: 10 } },
      )
      .arrow("Inicio", "Mañana");
    const ok = await start(
      later.build(),
      later.id("Inicio"),
      { d: "2026-11-02" },
      { dates: flaky },
    );
    expect(ok.steps[later.id("Mañana")]).toMatchObject({ state: "done", retries: 1 });
    expect(outOf(ok, later.id("Mañana"))).toEqual([{ d: "2026-11-02", mañana: "2026-11-03" }]);

    // «Parar con error» ends the run with its message, whatever its own settings say.
    const halt = sketch()
      .step("Inicio", "manual")
      .step(
        "Basta",
        "stop",
        { message: "Basta" },
        { onError: "continue", retry: { times: 3, waitMs: 1 } },
      )
      .arrow("Inicio", "Basta");
    const halted = await start(halt.build(), halt.id("Inicio"));
    expect(halted.state).toBe("failed");
    expect(halted.error).toEqual({ step: halt.id("Basta"), message: "Basta" });
    expect(halted.steps[halt.id("Basta")]?.retries).toBe(0);
  });

  // The criterion of done of the phase (§8). Its timings are printed, not asserted against the machine's speed.
  it("F14a criterion · trigger → find → group → if → create over 3,000 rows runs twice with the same result, timed", async () => {
    // Data shaped like Juan's: generated ids for collections, fields and rows; a year of rows with money, dates and
    // a relation to a second collection.
    const build = () => {
      const next = ids(3000);
      const kinds = collection(next, ["text"]);
      const moves = collection(next, ["text", "money", "date", "relation"]);
      const totals = collection(next, ["relation", "money", "number"]);
      const [concept, amount, day, kind] = moves.fields.map((f) => f.key) as [
        string,
        string,
        string,
        string,
      ];
      (moves.fields[3] as { target?: string }).target = kinds.key;
      const [tKind, tSum, tCount] = totals.fields.map((f) => f.key) as [string, string, string];
      const r = rng(3000);
      const db = store(
        [kinds, moves, totals],
        {
          [kinds.key]: Array.from({ length: 12 }, (_, i) => ({
            [kinds.fields[0]?.key as string]: `tipo ${i}`,
          })),
        },
        next,
      );
      const kindIds = db.rows(kinds.key).map((k) => k.origin.id);
      for (let i = 0; i < 3000; i++)
        db.rows(moves.key).push({
          json: {
            [concept]: `movimiento ${i}`,
            [amount]: { amount: r.int(20000) / 100, currency: "EUR" },
            [day]: new Date(Date.UTC(2026, 0, 1) + r.int(365) * 86_400_000)
              .toISOString()
              .slice(0, 10),
            [kind]: kindIds[r.int(kindIds.length)] as string,
          },
          label: OWN,
          origin: { collection: moves.key, id: next("o"), version: 1 },
        });
      const s = sketch(3000)
        .step("Inicio", "manual")
        .step("Buscar", "collection", {
          collection: moves.key,
          action: "find",
          where: [{ field: day, op: "after", value: "2026-01-31" }],
          sort: [{ field: day }],
          limit: 5000,
        })
        .step("Agrupar", "group", {
          by: [{ field: kind }],
          measures: [
            { to: "total", measure: "sum", field: amount },
            { to: "filas", measure: "count" },
          ],
        })
        .step("Si", "if", { where: [{ field: "filas", op: "gt", value: 200 }] })
        .step("Crear", "collection", {
          collection: totals.key,
          action: "create",
          fields: [
            { field: tKind, value: cite(`$json.${kind}`) },
            { field: tSum, value: cite("$json.total") },
            { field: tCount, value: cite("$json.filas") },
          ],
        })
        .arrow("Inicio", "Buscar")
        .arrow("Buscar", "Agrupar")
        .arrow("Agrupar", "Si")
        .arrow("Si", "Crear", OUT.yes);
      return { s, db, totals };
    };
    const once = async () => {
      const { s, db, totals } = build();
      const t = performance.now();
      const e = await start(s.build(), s.id("Inicio"), {}, { collections: db });
      return { e, s, saved: db.rows(totals.key), ms: performance.now() - t };
    };
    const a = await once();
    const b = await once();
    const timeless = (e: typeof a.e) => ({
      ...e,
      ms: 0,
      steps: Object.fromEntries(Object.entries(e.steps).map(([k, r]) => [k, { ...r, ms: 0 }])),
    });
    expect(a.e.state).toBe("done");
    expect(a.e.steps[a.s.id("Buscar")]?.out[MAIN]?.length).toBeGreaterThan(2500);
    expect(a.e.steps[a.s.id("Agrupar")]?.out[MAIN]).toHaveLength(12);
    expect(a.saved.length).toBeGreaterThan(0);
    expect(timeless(b.e)).toEqual(timeless(a.e));
    expect(b.saved).toEqual(a.saved);
    console.info(`F14a criterion: 3,000 rows in ${a.ms.toFixed(0)} ms, then ${b.ms.toFixed(0)} ms`);
    // Not a benchmark: a ceiling far above what it takes, so a slip of the engine into quadratic work shows.
    expect(a.ms).toBeLessThan(5000);
  });

  it("every action of the catalogue that is not a trigger's has an executor of its mode", () => {
    for (const t of CATALOGUE) {
      if (isTrigger({ id: "s_x", name: "x", type: t.type, params: {} })) continue;
      for (const a of t.actions) {
        const key = executorKey(t.type, a.key);
        expect(EXECUTORS[key]?.mode, key).toBe(a.mode);
      }
    }
  });

  it("the states of a step are the seven of the design", () => {
    expect(STEP_STATES).toHaveLength(7);
    expect(new Set(STEP_STATES).size).toBe(7);
  });

  it("an executor registered is one of the catalogue's actions", () => {
    const known = new Set(
      CATALOGUE.flatMap((t) => t.actions.map((a) => executorKey(t.type, a.key))),
    );
    for (const key of Object.keys(EXECUTORS)) expect(known.has(key), key).toBe(true);
  });
});
