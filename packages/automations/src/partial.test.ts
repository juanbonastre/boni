// A test of a draft and what it keeps (docs/automatizaciones.md §5.8; partial.ts). Real tests use the fakes of
// run.test-util.ts and a digest that is the text itself: never a store. What a test keeps travels through the
// server as JSON, so every kept record here is a copy made the way the server reads it back.
import { describe, expect, it } from "vitest";
import { cite, collection, ids, sketch, T0 } from "./automation.test-util.ts";
import { CATALOGUE } from "./catalogue.ts";
import type { RunDeps } from "./engine.ts";
import { type Automation, MAIN, OUT, type ParamValue, renameStep } from "./format.ts";
import {
  type Kept,
  type Print,
  runTest,
  staleSteps,
  stepPrints,
  type TestExecution,
} from "./partial.ts";
import { deps, OWN, outOf, policy, store } from "./run.test-util.ts";

const same = (text: string) => text;
const prints = (a: Automation, tested: Record<string, Record<string, never>> = {}) =>
  stepPrints(a, tested, same);

/** What the server keeps of a test: every record it gave, with the print of its step, as JSON comes back. */
const keep = (e: TestExecution, p: Readonly<Record<string, Print>>): Record<string, Kept> =>
  JSON.parse(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(e.steps).map(([id, record]) => [id, { print: p[id], record, at: T0 }]),
      ),
    ),
  );

const test = (
  automation: Automation,
  trigger: string,
  over: { step?: string; kept?: Record<string, Kept>; deps?: RunDeps } = {},
) =>
  runTest(
    {
      automation,
      trigger,
      fields: { json: {}, label: OWN },
      prints: prints(automation),
      ...(over.step ? { step: over.step } : {}),
      ...(over.kept ? { kept: over.kept } : {}),
    },
    over.deps ?? deps(),
  );

/** «Inicio» → «Buscar» (3 rows of a collection) → «Filtrar» → «Marca», with a store that counts its reads. */
function searching() {
  const next = ids(7);
  const items = collection(next, ["text", "number"]);
  const [name, n] = items.fields.map((f) => f.key) as [string, string];
  const db = store(
    [items],
    { [items.key]: [1, 2, 3].map((v) => ({ [name]: `fila ${v}`, [n]: v })) },
    next,
  );
  const s = sketch(7)
    .step("Inicio", "manual")
    .step("Buscar", "collection", { collection: items.key, action: "find" })
    .step("Filtrar", "filter", { where: [{ field: n, op: "gt", value: 1 }] })
    .step("Marca", "edit", { fields: [{ field: "x", value: "marca" }] })
    .arrow("Inicio", "Buscar")
    .arrow("Buscar", "Filtrar")
    .arrow("Filtrar", "Marca");
  return { s, db, n, name };
}

describe("«Probar paso» and what a test keeps", () => {
  it("AU-91 · «Probar paso» runs that step and only what it lacks of the steps before it: a step before it whose kept test ended well and has the print it has now is not run again, and its rows are taken as they were", async () => {
    const { s, db } = searching();
    const a = s.build();
    const first = await test(a, s.id("Inicio"), { deps: deps({ collections: db }) });
    const kept = keep(first, prints(a));
    expect(db.calls.filter((c) => c.method === "find")).toHaveLength(1);

    // «Marca» changes; «Probar paso» on it reads nothing again.
    const changed = structuredClone(a);
    const marca = changed.steps.find((x) => x.id === s.id("Marca"));
    if (marca) marca.params = { fields: [{ field: "x", value: "otra" }] };
    const again = await test(changed, s.id("Inicio"), {
      step: s.id("Marca"),
      kept,
      deps: deps({ collections: db }),
    });
    expect(again.reused).toEqual([s.id("Inicio"), s.id("Buscar"), s.id("Filtrar")]);
    expect(again.ran).toEqual([s.id("Marca")]);
    expect(db.calls.filter((c) => c.method === "find")).toHaveLength(1);
    expect(again.steps[s.id("Filtrar")]).toEqual(kept[s.id("Filtrar")]?.record);
    expect(outOf(again, s.id("Marca"))?.map((j) => j.x)).toEqual(["otra", "otra"]);
    expect(again.state).toBe("done");
    expect(again.test).toBe(true);
  });

  it("AU-91 · «Probar paso» always runs the step itself again, decides nothing after it or on another branch, and a step before it that was never tested, is stale or did not end well runs", async () => {
    const s = sketch(8)
      .step("Inicio", "manual")
      .step("Lista", "edit", { fields: [{ field: "n", value: [1, 2, 3] }] })
      .step("Partir", "split", { field: "n" })
      .step("Si", "if", { where: [{ field: "n", op: "gt", value: 1 }] })
      .step("Sí", "edit", { fields: [{ field: "r", value: "sí" }] })
      .step("Tras sí", "edit", { fields: [{ field: "t", value: 1 }] })
      .step("No", "edit", { fields: [{ field: "r", value: "no" }] })
      .arrow("Inicio", "Lista")
      .arrow("Lista", "Partir")
      .arrow("Partir", "Si")
      .arrow("Si", "Sí", OUT.yes)
      .arrow("Sí", "Tras sí")
      .arrow("Si", "No", OUT.no);
    const a = s.build();
    const p = prints(a);
    const kept = keep(await test(a, s.id("Inicio")), p);
    const before = [s.id("Inicio"), s.id("Lista"), s.id("Partir"), s.id("Si")];

    // Nothing changed: the step runs again, and only it.
    const same = await test(a, s.id("Inicio"), { step: s.id("Sí"), kept });
    expect(same.ran).toEqual([s.id("Sí")]);
    expect(same.reused).toEqual(before);
    expect(Object.keys(same.steps).sort()).toEqual([...before, s.id("Sí")].sort());
    expect(same.steps[s.id("Tras sí")]).toBeUndefined();
    expect(same.steps[s.id("No")]).toBeUndefined();

    // «Partir» never tested: it runs, and so does what hangs from it.
    const { [s.id("Partir")]: _never, ...lacking } = kept;
    const never = await test(a, s.id("Inicio"), { step: s.id("Sí"), kept: lacking });
    expect(never.reused).toEqual([s.id("Inicio"), s.id("Lista")]);
    expect(never.ran).toEqual([s.id("Partir"), s.id("Si"), s.id("Sí")]);

    // «Partir» kept with a test that failed: it runs.
    const failed = structuredClone(kept);
    const partir = failed[s.id("Partir")];
    if (partir) partir.record.state = "failed";
    const bad = await test(a, s.id("Inicio"), { step: s.id("Sí"), kept: failed });
    expect(bad.ran).toEqual([s.id("Partir"), s.id("Si"), s.id("Sí")]);

    // «Lista» changed since: it is stale and runs with what follows it; its new rows reach «Sí».
    const changed = structuredClone(a);
    const lista = changed.steps.find((x) => x.id === s.id("Lista"));
    if (lista) lista.params = { fields: [{ field: "n", value: [5, 6] }] };
    const stale = await test(changed, s.id("Inicio"), { step: s.id("Sí"), kept });
    expect(stale.reused).toEqual([s.id("Inicio")]);
    expect(outOf(stale, s.id("Sí"))?.map((j) => j.n)).toEqual([5, 6]);
  });

  it("AU-91 · a citation with .item finds its own row across a step that was reused: the kept rows keep their lineage", async () => {
    const s = sketch(9)
      .step("Inicio", "manual")
      .step("Lista", "edit", { fields: [{ field: "n", value: [1, 2, 3] }] })
      .step("Partir", "split", { field: "n" })
      .step("Marca", "edit", { fields: [{ field: "n", value: "marca" }] })
      .step("Cita", "edit", { fields: [{ field: "y", value: cite("$('Partir').item.n") }] })
      .arrow("Inicio", "Lista")
      .arrow("Lista", "Partir")
      .arrow("Partir", "Marca")
      .arrow("Marca", "Cita");
    const a = s.build();
    const kept = keep(await test(a, s.id("Inicio")), prints(a));
    const changed = structuredClone(a);
    const cita = changed.steps.find((x) => x.id === s.id("Cita"));
    if (cita) cita.params = { fields: [{ field: "z", value: cite("$('Partir').item.n") }] };
    const e = await test(changed, s.id("Inicio"), { step: s.id("Cita"), kept });
    expect(e.reused).toEqual([s.id("Inicio"), s.id("Lista"), s.id("Partir"), s.id("Marca")]);
    expect(e.state).toBe("done");
    expect(outOf(e, s.id("Cita"))?.map((j) => [j.n, j.z])).toEqual([
      ["marca", 1],
      ["marca", 2],
      ["marca", 3],
    ]);
  });

  /** Two branches from «Inicio»: «A» → «Usa», and «B» → «C», which cites «A» with no arrow from it. */
  const prints0 = () =>
    sketch(10)
      .step("Inicio", "manual", { fields: [{ key: "q", name: "Q", type: "text" }] })
      .step("A", "edit", { fields: [{ field: "a", value: 1 }] })
      .step("Usa", "filter", { where: [{ field: "a", op: "gt", value: 0 }] })
      .step("B", "edit", { fields: [{ field: "b", value: 2 }] })
      .step("C", "edit", { fields: [{ field: "c", value: cite("$('A').first().a") }] })
      .arrow("Inicio", "A")
      .arrow("A", "Usa")
      .arrow("Inicio", "B")
      .arrow("B", "C");

  it("AU-91 · a step's print changes with its type, its action, a parameter or a setting other than the note, with a change in a step it hangs from or cites, and with the fields its trigger was tested with", () => {
    const s = prints0();
    const a = s.build();
    const p = prints(a);
    const at = (x: Automation, name: string) =>
      x.steps.find((st) => st.id === s.id(name)) as Automation["steps"][number];
    const changes: [string, (x: Automation) => void, string[]][] = [
      [
        "type",
        (x) => {
          at(x, "Usa").type = "sort";
        },
        ["Usa"],
      ],
      [
        "parameter",
        (x) => {
          at(x, "B").params = { fields: [{ field: "b", value: 3 }] };
        },
        ["B", "C"],
      ],
      [
        "setting",
        (x) => {
          at(x, "Usa").settings = { continueEmpty: true };
        },
        ["Usa"],
      ],
      [
        "retry",
        (x) => {
          at(x, "B").settings = { retry: { times: 2, waitMs: 0 } };
        },
        ["B", "C"],
      ],
      [
        "hangs from",
        (x) => {
          at(x, "A").params = { fields: [{ field: "a", value: 9 }] };
        },
        ["A", "Usa", "C"],
      ],
    ];
    for (const [what, change, moved] of changes) {
      const x = structuredClone(a);
      change(x);
      const q = prints(x);
      const differ = Object.keys(p).filter((id) => p[id] !== q[id]);
      expect(differ.sort(), what).toEqual(moved.map((n) => s.id(n)).sort());
    }

    // The action of a step with several.
    const next = ids(10);
    const items = collection(next, ["text"]);
    const r = sketch(11)
      .step("Inicio", "manual")
      .step("Leer", "collection", { collection: items.key, action: "find" })
      .arrow("Inicio", "Leer");
    const ra = r.build();
    const rb = structuredClone(ra);
    const leer = rb.steps.find((st) => st.id === r.id("Leer"));
    if (leer) leer.params = { collection: items.key, action: "get", row: "o_ejemplo" };
    expect(prints(rb)[r.id("Leer")]).not.toBe(prints(ra)[r.id("Leer")]);

    // The fields «Inicio» was tested with: it and every step change.
    const tested = stepPrints(a, { [s.id("Inicio")]: { q: "ejemplo" } }, same);
    expect(Object.keys(p).filter((id) => p[id] === tested[id])).toEqual([]);
    expect(stepPrints(a, { [s.id("Inicio")]: { q: "ejemplo" } }, same)).toEqual(tested);
  });

  it("AU-91 · a step's print does not change when a step is moved or renamed (its citations rewritten), a note changes, or the steps and arrows are saved in another order", () => {
    const s = prints0();
    const a = s.build();
    const p = prints(a);
    // Renamed: «C» cites it by its new name, and nothing changes.
    const renamed = renameStep(a, s.id("A"), "Otra");
    expect(JSON.stringify(renamed)).toContain("$('Otra')");
    expect(prints(renamed)).toEqual(p);
    // A note, the automation's name and version.
    const noted = structuredClone(a);
    for (const st of noted.steps) st.settings = { ...st.settings, note: "una nota" };
    noted.name = "Otro nombre";
    noted.version = 3;
    expect(prints(noted)).toEqual(p);
    // Saved in another order.
    const shuffled = { ...a, steps: [...a.steps].reverse(), arrows: [...a.arrows].reverse() };
    expect(prints(shuffled)).toEqual(p);
    // A print is short with a real digest: the package does not choose it.
    expect(Object.values(stepPrints(a, {}, (t) => String(t.length)))).not.toContain(undefined);
  });

  it("AU-92 · a step changed after its test is stale, and so is every step that hangs from it or cites it; a step never tested is not stale: it has nothing kept", () => {
    const s = prints0();
    const a = s.build();
    const p = prints(a);
    // Every step kept with the print it had when tested (`C` cites `A` across branches: a draft may, it is kept).
    const record = {
      state: "done",
      in: {},
      out: {},
      ms: 0,
      retries: 0,
      failed: 0,
      asked: 0,
    } as const;
    const kept: Record<string, Kept> = Object.fromEntries(
      Object.entries(p).map(([id, print]) => [id, { print, record: { ...record }, at: T0 }]),
    );
    expect(staleSteps(p, kept)).toEqual([]);

    const changed = structuredClone(a);
    const st = changed.steps.find((x) => x.id === s.id("A"));
    if (st) st.params = { fields: [{ field: "a", value: 2 }] };
    // A new step after «Usa», never tested.
    changed.steps.push({ id: "s_nuevo", name: "Nuevo", type: "edit", params: {} });
    changed.arrows.push({
      from: { step: s.id("Usa"), output: MAIN },
      to: { step: "s_nuevo", input: MAIN },
    });
    const q = prints(changed);
    expect(staleSteps(q, kept)).toEqual([s.id("A"), s.id("C"), s.id("Usa")].sort());
    // A step taken out of the automation is not stale: it is not there.
    const { [s.id("B")]: _b, ...left } = q;
    expect(staleSteps(left, kept)).not.toContain(s.id("B"));
  });

  it("AU-90 · a whole test reuses nothing: every step the trigger reaches runs, and a step that would write gives the row it would make so that what follows goes on", async () => {
    const next = ids(12);
    const items = collection(next, ["text"]);
    const [name] = items.fields.map((f) => f.key) as [string];
    const db = store([items], { [items.key]: [] }, next);
    const asked = policy();
    const s = sketch(12)
      .step("Inicio", "manual")
      .step("Crear", "collection", {
        collection: items.key,
        action: "create",
        fields: [{ field: name, value: "nueva" }],
      })
      .step("Después", "edit", { fields: [{ field: "visto", value: true }] })
      .arrow("Inicio", "Crear")
      .arrow("Crear", "Después");
    const a = s.build();
    const first = await test(a, s.id("Inicio"), { deps: deps({ collections: db, policy: asked }) });
    const kept = keep(first, prints(a));
    const e = await runTest(
      {
        automation: a,
        trigger: s.id("Inicio"),
        fields: { json: {}, label: OWN },
        prints: prints(a),
        kept,
      },
      deps({ collections: db, policy: asked }),
    );
    expect(e.reused).toEqual([]);
    expect(e.ran).toEqual([s.id("Inicio"), s.id("Crear"), s.id("Después")]);
    expect(outOf(e, s.id("Después"))).toEqual([{ [name]: "nueva", visto: true }]);
    expect(db.applied).toEqual([]);
    expect(db.rows(items.key)).toEqual([]);
    expect(asked.calls.length).toBeGreaterThan(0);
    expect(asked.calls.every((c) => c.test)).toBe(true);
  });

  it("AU-115 · every trigger of the catalogue can start a test by hand with the fields it declares: no type of trigger is refused by runTest", async () => {
    const triggers = CATALOGUE.filter((t) => t.category === "trigger");
    expect(triggers.length).toBeGreaterThan(0);
    for (const t of triggers) {
      const declared: Record<string, ParamValue> =
        t.type === "manual" ? { fields: [{ key: "q", name: "Q", type: "text" }] } : {};
      const s = sketch(13)
        .step("Inicio", t.type, declared)
        .step("Después", "edit", { fields: [{ field: "x", value: 1 }] })
        .arrow("Inicio", "Después");
      const a = s.build();
      const e = await runTest(
        {
          automation: a,
          trigger: s.id("Inicio"),
          fields: { json: t.type === "manual" ? { q: "ejemplo" } : {}, label: OWN },
          prints: prints(a),
        },
        deps(),
      );
      expect(e.state, t.type).toBe("done");
      expect(e.test).toBe(true);
    }
  });
});
