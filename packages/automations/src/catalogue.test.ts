// The catalogue's rules (docs/automatizaciones.md §5.9, §5.10) and the shape of its data: one test per rule, its id
// in the name (`make check` reads them). The tests below without an id hold today: they are what lets
// the canvas paint any step with the same controls and a test count its parameters (AU-75, F14b).
import { describe, expect, it } from "vitest";
import { cite, collection, ids, knowing, sketch } from "./automation.test-util.ts";
import {
  type ActionSpec,
  actionOf,
  CATALOGUE,
  CATEGORIES,
  CONTROLS,
  inputsOf,
  isTrigger,
  type ParamSpec,
  paramsOf,
  RUN,
  type StepTypeSpec,
  stepType,
} from "./catalogue.ts";
import type { FindQuery } from "./effects.ts";
import { CannotRun } from "./engine.ts";
import { ACTION, type Automation, MAIN, OUT, type Step } from "./format.ts";
import { touches } from "./graph.ts";
import { OUTSIDE, OWN, outOf, policy, start, store } from "./run.test-util.ts";
import { validate } from "./validate.ts";

describe("the rules of the steps", () => {
  it("AU-19 · what a step reads, writes and destroys comes from its action in the catalogue: the policy's call and touches() say the same, with no other list", async () => {
    // Only «Colección» reads or writes, and only «Eliminar filas» destroys.
    for (const t of CATALOGUE)
      for (const a of t.actions) {
        expect(a.effect !== "none", `${t.type}.${a.key}`).toBe(t.type === "collection");
        expect(a.destroys, `${t.type}.${a.key}`).toBe(t.type === "collection" && a.key === "trash");
      }
    const next = ids(19);
    const items = collection(next, ["text", "number"]);
    const [name, n] = items.fields.map((f) => f.key) as [string, string];
    const db = store([items], { [items.key]: [{ [name]: "una", [n]: 1 }] }, next);
    const saved = db.rows(items.key)[0]?.origin.id as string;
    const on = (action: string, params: Step["params"] = {}) => ({
      collection: items.key,
      [ACTION]: action,
      ...params,
    });
    const s = sketch()
      .step("Inicio", "manual")
      .step("Buscar", "collection", on("find"))
      .step("Leer", "collection", on("get", { row: saved }))
      .step("Contar", "collection", on("aggregate"))
      .step("Modificar", "collection", on("update", { fields: [{ field: n, value: 2 }] }))
      .step(
        "Guardar",
        "collection",
        on("upsert", { match: [{ field: name }], fields: [{ field: name, value: "otra" }] }),
      )
      .step("Crear", "collection", on("create", { fields: [{ field: name, value: "nueva" }] }))
      .step("Eliminar", "collection", on("trash"))
      .arrow("Inicio", "Buscar")
      .arrow("Inicio", "Leer")
      .arrow("Inicio", "Contar")
      .arrow("Buscar", "Modificar")
      .arrow("Inicio", "Guardar")
      .arrow("Inicio", "Crear")
      .arrow("Modificar", "Eliminar");
    const a = s.build();
    const judged = policy();
    const e = await start(a, s.id("Inicio"), {}, { collections: db, policy: judged });
    expect(e.state).toBe("done");

    // Every call the policy judged is a step's touch, with the same collection and action; a write says what the
    // touch says about destroying, and a read (the one «Crear o modificar» makes to find its row) destroys nothing.
    const touch = new Map(touches(a).map((t) => [t.step, t]));
    expect(touch.size).toBe(7);
    for (const c of judged.calls) {
      const t = touch.get(c.step);
      expect([c.collection, c.type, c.action], c.step).toEqual([
        t?.collection,
        "collection",
        t?.action,
      ]);
      expect(c.destroys).toBe(c.effect === "write" && t?.destroys === true);
    }
    const effects = (step: string) =>
      judged.calls
        .filter((c) => c.step === s.id(step))
        .map((c) => `${c.effect}${c.destroys ? " destroys" : ""}`);
    expect(effects("Buscar")).toEqual(["read"]);
    expect(effects("Leer")).toEqual(["read"]);
    expect(effects("Contar")).toEqual(["read"]);
    expect(effects("Modificar")).toEqual(["write"]);
    expect(effects("Guardar")).toEqual(["read", "write"]);
    expect(effects("Crear")).toEqual(["write"]);
    expect(effects("Eliminar")).toEqual(["write destroys"]);
  });
  it("AU-110 · a trigger is a step, the first: «Disparado por el usuario» declares the fields it asks for, and a run starts with them as its one row", async () => {
    const s = sketch()
      .step("Inicio", "manual", {
        fields: [
          { key: "quien", name: "Quién", type: "text" },
          { key: "cuanto", name: "Cuánto", type: "number" },
          { key: "dia", name: "Día", type: "date" },
          { key: "hecho", name: "Hecho", type: "checkbox" },
        ],
      })
      .step("Tras", "limit", { count: 1 })
      .arrow("Inicio", "Tras");
    const a = s.build();
    const e = await start(
      a,
      s.id("Inicio"),
      { quien: "ejemplo", cuanto: 3 },
      {},
      {
        quien: { label: OUTSIDE, derived: false },
      },
    );
    // One row, with every field it asks for (null where none was given), the label of who gave them and no path.
    expect(e.steps[s.id("Inicio")]?.out[MAIN]).toEqual([
      {
        json: { quien: "ejemplo", cuanto: 3, dia: null, hecho: null },
        label: OWN,
        fields: { quien: { label: OUTSIDE, derived: false } },
        path: null,
        parent: null,
      },
    ]);
    expect(e.order[0]).toBe(s.id("Inicio"));
    expect(outOf(e, s.id("Tras"))).toEqual([
      { quien: "ejemplo", cuanto: 3, dia: null, hecho: null },
    ]);

    // What it does not ask for, a value of another type, a step that is not a trigger: refused before anything runs.
    for (const [json, trigger] of [
      [{ otro: 1 }, s.id("Inicio")],
      [{ cuanto: "tres" }, s.id("Inicio")],
      [{ dia: "2 de noviembre" }, s.id("Inicio")],
      [{}, s.id("Tras")],
      [{}, "s_ninguno"],
    ] as const)
      await expect(start(a, trigger, json)).rejects.toBeInstanceOf(CannotRun);
    // An automation with errors does not run, and says why.
    const broken = sketch()
      .step("Inicio", "manual")
      .step("Mal", "limit", {})
      .arrow("Inicio", "Mal");
    const refused = await start(broken.build(), broken.id("Inicio")).catch((x: unknown) => x);
    expect(refused).toBeInstanceOf(CannotRun);
    expect((refused as CannotRun).problems.map((p) => p.code)).toEqual(["param.required"]);
  });
  it("AU-120 · in «Colección» the collection and the action come first and the rest follows: find has its conditions, sort and a limit of 50, and related rows one level as an option", async () => {
    const find: Step = {
      id: "s_x",
      name: "Buscar",
      type: "collection",
      params: { collection: "t_x", [ACTION]: "find" },
    };
    expect(paramsOf(find).map((p) => [p.key, p.place, p.default])).toEqual([
      ["collection", "shown", undefined],
      [ACTION, "shown", undefined],
      ["where", "shown", undefined],
      ["sort", "shown", undefined],
      ["limit", "shown", 50],
      ["related", "option", false],
    ]);
    // With no action chosen, only the collection and the action show.
    expect(paramsOf({ ...find, params: { collection: "t_x" } }).map((p) => p.key)).toEqual([
      "collection",
      ACTION,
    ]);

    // A search asks for 50 rows unless told otherwise; with «Incluir relacionadas», a relation holds the related row.
    const next = ids(120);
    const kinds = collection(next, ["text"]);
    const items = collection(next, ["text", "relation"]);
    const [kindName] = kinds.fields.map((f) => f.key) as [string];
    const [name, kind] = items.fields.map((f) => f.key) as [string, string];
    (items.fields[1] as { target?: string }).target = kinds.key;
    const db = store([kinds, items], { [kinds.key]: [{ [kindName]: "tipo uno" }] }, next);
    const kindId = db.rows(kinds.key)[0]?.origin.id as string;
    for (let i = 0; i < 60; i++)
      db.rows(items.key).push({
        json: { [name]: `fila ${String(i).padStart(2, "0")}`, [kind]: kindId },
        label: OWN,
        origin: { collection: items.key, id: next("o"), version: 1 },
      });
    const asked: FindQuery[] = [];
    const spy = {
      ...db,
      find: (q: FindQuery) => {
        asked.push(q);
        return db.find(q);
      },
    };
    const found = async (related: boolean) => {
      const s = sketch()
        .step("Inicio", "manual")
        .step("Buscar", "collection", {
          collection: items.key,
          [ACTION]: "find",
          sort: [{ field: name, direction: "desc" }],
          ...(related ? { related: true } : {}),
        })
        .step("Tipo", "edit", {
          keep: "none",
          fields: [{ field: "tipo", value: cite(`$json.${kind}.${kindName}`) }],
        })
        .arrow("Inicio", "Buscar")
        .arrow("Buscar", "Tipo");
      const e = await start(s.build(), s.id("Inicio"), {}, { collections: spy });
      return { rows: outOf(e, s.id("Buscar")), tipo: outOf(e, s.id("Tipo")) };
    };
    const plain = await found(false);
    expect(plain.rows).toHaveLength(50);
    expect(plain.rows?.[0]?.[name]).toBe("fila 59");
    expect(plain.tipo?.[0]).toEqual({ tipo: null });
    expect((await found(true)).tipo?.[0]).toEqual({ tipo: "tipo uno" });
    expect(asked.map((q) => [q.limit, q.related, q.sort])).toEqual([
      [50, false, [{ field: name, direction: "desc" }]],
      [50, true, [{ field: name, direction: "desc" }]],
    ]);
  });
  it("AU-121 · create and modify write only the fields added; modify and trash act on the rows that arrive or on the ones that match, which without a condition does not validate", async () => {
    const next = ids(121);
    const items = collection(next, ["text", "number", "date"]);
    const [name, n, day] = items.fields.map((f) => f.key) as [string, string, string];
    const db = store(
      [items],
      {
        [items.key]: [1, 2, 3].map((v) => ({ [name]: `fila ${v}`, [n]: v, [day]: "2026-11-02" })),
      },
      next,
    );
    const s = sketch()
      .step("Inicio", "manual")
      .step("Crear", "collection", {
        collection: items.key,
        [ACTION]: "create",
        fields: [{ field: name, value: "nueva" }],
      })
      .step("Modificar", "collection", {
        collection: items.key,
        [ACTION]: "update",
        target: "matching",
        where: [{ field: n, op: "gt", value: 1 }],
        fields: [{ field: day, value: "2026-11-03" }],
      })
      .arrow("Inicio", "Crear")
      .arrow("Crear", "Modificar");
    const a = s.build();
    expect(validate(a, knowing(items))).toEqual([]);
    const e = await start(a, s.id("Inicio"), {}, { collections: db });
    expect(e.state).toBe("done");
    // Only what was added: the new row has one field; the modified ones keep the rest of theirs.
    expect(db.applied[0]).toEqual({
      kind: "create",
      collection: items.key,
      fields: { [name]: "nueva" },
    });
    expect(db.rows(items.key).map((r) => r.json)).toEqual([
      { [name]: "fila 1", [n]: 1, [day]: "2026-11-02" },
      { [name]: "fila 2", [n]: 2, [day]: "2026-11-03" },
      { [name]: "fila 3", [n]: 3, [day]: "2026-11-03" },
      { [name]: "nueva" },
    ]);

    // «Las filas que llegan» is the default; «Las que cumplan…» with no condition, or none at all, is not valid.
    const after = (step: Step): Automation => {
      const b = sketch().step("Inicio", "manual").build();
      const from = b.steps[0]?.id as string;
      return {
        ...b,
        steps: [...b.steps, step],
        arrows: [{ from: { step: from, output: MAIN }, to: { step: step.id, input: MAIN } }],
      };
    };
    for (const action of ["update", "trash"]) {
      const step = (params: Step["params"]): Step => ({
        id: "s_x",
        name: "Paso",
        type: "collection",
        params: {
          collection: items.key,
          [ACTION]: action,
          ...(action === "update" ? { fields: [{ field: n, value: 1 }] } : {}),
          ...params,
        },
      });
      const problems = (params: Step["params"]) =>
        validate(after(step(params)), knowing(items)).map((p) => [p.code, p.param]);
      expect(problems({ target: "matching" }), action).toEqual([["param.condition", "where"]]);
      expect(problems({ target: "matching", where: [] }), action).toEqual([
        ["param.condition", "where"],
      ]);
      expect(problems({}), action).toEqual([]);
      expect(paramsOf(step({})).find((p) => p.key === "target")?.default).toBe("incoming");
    }
  });
  it("AU-122 · «Eliminar filas» sends rows to the trash: no action of the catalogue and no change of the gate deletes for good", async () => {
    const next = ids(122);
    const items = collection(next, ["text"]);
    const [name] = items.fields.map((f) => f.key) as [string];
    const db = store([items], { [items.key]: [{ [name]: "una" }, { [name]: "dos" }] }, next);
    const s = sketch()
      .step("Inicio", "manual")
      .step("Eliminar", "collection", {
        collection: items.key,
        [ACTION]: "trash",
        target: "matching",
        where: [{ field: name, op: "is", value: "una" }],
      })
      .arrow("Inicio", "Eliminar");
    const e = await start(s.build(), s.id("Inicio"), {}, { collections: db });
    // To the trash, as it was; and out of the step, so a later one can say what went.
    expect(db.applied.map((c) => c.kind)).toEqual(["trash"]);
    expect(db.trashed.map((r) => r.json)).toEqual([{ [name]: "una" }]);
    expect(db.rows(items.key).map((r) => r.json)).toEqual([{ [name]: "dos" }]);
    expect(outOf(e, s.id("Eliminar"))).toEqual([{ [name]: "una" }]);
    // No action deletes for good: these are the writes of «Colección», and nothing else in the catalogue writes.
    const writes = CATALOGUE.flatMap((t) =>
      t.actions.filter((a) => a.effect === "write").map((a) => `${t.type}.${a.key}`),
    );
    expect(writes).toEqual([
      "collection.create",
      "collection.update",
      "collection.upsert",
      "collection.trash",
    ]);

    // Trashing asks Juan first when the policy says so (P5): nothing goes, and it waits in the run.
    const db2 = store([items], { [items.key]: [{ [name]: "una" }] }, ids(123));
    const asks = policy((c) =>
      c.destroys
        ? { kind: "confirm", rule: "test.confirm" }
        : { kind: "allow", rule: "test.allow" },
    );
    const e2 = await start(s.build(), s.id("Inicio"), {}, { collections: db2, policy: asks });
    expect(db2.applied).toEqual([]);
    expect(e2.asked).toEqual([
      {
        step: s.id("Eliminar"),
        kind: "confirm",
        rule: "test.confirm",
        change: { kind: "trash", row: db2.rows(items.key)[0]?.origin },
      },
    ]);
    expect(e2.steps[s.id("Eliminar")]).toMatchObject({
      state: "done",
      asked: 1,
      out: { main: [] },
    });
  });
  it("AU-123 · «Si» sends each row by «sí» or «no»; «Elegir rama» has one output per rule, «otras» when asked, and the first rule that matches or all of them", async () => {
    const rules = [
      { id: "r_bajo", name: "Bajo", where: [{ field: "n", op: "lt", value: 3 }] },
      { id: "r_par", name: "Par", where: [{ field: "par", op: "checked" }] },
    ];
    /** Rows 1 to 4, each saying whether it is even, through «Si» and «Elegir rama». */
    const branches = async (params: Record<string, Step["params"][string]>) => {
      const s = sketch()
        .step("Inicio", "manual")
        .step("Lista", "edit", {
          fields: [{ field: "l", value: [1, 2, 3, 4].map((n) => ({ n, par: n % 2 === 0 })) }],
        })
        .step("Partir", "split", { field: "l" })
        .step("Abrir", "edit", {
          keep: "none",
          fields: [
            { field: "n", value: cite("$json.l.n") },
            { field: "par", value: cite("$json.l.par") },
          ],
        })
        .step("Si", "if", { where: [{ field: "n", op: "gt", value: 2 }] })
        .step("Elegir", "switch", { rules, ...params })
        .arrow("Inicio", "Lista")
        .arrow("Lista", "Partir")
        .arrow("Partir", "Abrir")
        .arrow("Abrir", "Si")
        .arrow("Abrir", "Elegir");
      const e = await start(s.build(), s.id("Inicio"));
      const ns = (step: string) =>
        Object.fromEntries(
          Object.entries(e.steps[s.id(step)]?.out ?? {}).map(([k, rows]) => [
            k,
            rows.map((r) => r.json.n),
          ]),
        );
      return { si: ns("Si"), elegir: ns("Elegir") };
    };
    const first = await branches({});
    expect(first.si).toEqual({ [OUT.yes]: [3, 4], [OUT.no]: [1, 2] });
    // One output per rule, by its id; with no «otras», what matches none goes nowhere; the first rule that matches.
    expect(first.elegir).toEqual({ r_bajo: [1, 2], r_par: [4] });
    expect((await branches({ match: "all" })).elegir).toEqual({ r_bajo: [1, 2], r_par: [2, 4] });
    expect((await branches({ fallback: "other" })).elegir).toEqual({
      r_bajo: [1, 2],
      r_par: [4],
      [OUT.other]: [3],
    });
  });
  it("AU-124 · «Combinar» has two named inputs and joins by a field, by position or all with all; joining branches needs no step", async () => {
    const combined = async (params: Record<string, Step["params"][string]>) => {
      const s = sketch()
        .step("Inicio", "manual")
        .step("Unos", "edit", {
          fields: [
            {
              field: "l",
              value: [
                { k: 1, a: "uno" },
                { k: 2, a: "dos" },
                { k: 3, a: "tres" },
              ],
            },
          ],
        })
        .step("Partir unos", "split", { field: "l" })
        .step("Abrir unos", "edit", {
          keep: "none",
          fields: [
            { field: "k", value: cite("$json.l.k") },
            { field: "a", value: cite("$json.l.a") },
          ],
        })
        .step("Otros", "edit", {
          fields: [
            {
              field: "l",
              value: [
                { k: 2, b: "B2" },
                { k: 4, b: "B4" },
              ],
            },
          ],
        })
        .step("Partir otros", "split", { field: "l" })
        .step("Abrir otros", "edit", {
          keep: "none",
          fields: [
            { field: "k", value: cite("$json.l.k") },
            { field: "b", value: cite("$json.l.b") },
          ],
        })
        .step("Combinar", "combine", params)
        .arrow("Inicio", "Unos")
        .arrow("Unos", "Partir unos")
        .arrow("Partir unos", "Abrir unos")
        .arrow("Inicio", "Otros")
        .arrow("Otros", "Partir otros")
        .arrow("Partir otros", "Abrir otros")
        .arrow("Abrir unos", "Combinar", MAIN, "a")
        .arrow("Abrir otros", "Combinar", MAIN, "b");
      const e = await start(s.build(), s.id("Inicio"));
      expect(e.steps[s.id("Combinar")]?.in).toEqual({ a: 3, b: 2 });
      return outOf(e, s.id("Combinar"));
    };
    const byField = { by: "field", fieldA: "k", fieldB: "k" };
    expect(await combined(byField)).toEqual([{ k: 2, a: "dos", b: "B2" }]);
    expect(await combined({ ...byField, keep: "a" })).toEqual([
      { k: 1, a: "uno" },
      { k: 2, a: "dos", b: "B2" },
      { k: 3, a: "tres" },
    ]);
    expect(await combined({ ...byField, keep: "both" })).toEqual([
      { k: 1, a: "uno" },
      { k: 2, a: "dos", b: "B2" },
      { k: 3, a: "tres" },
      { k: 4, b: "B4" },
    ]);
    // By position, «a»'s fields win where both have one.
    expect(await combined({ by: "position" })).toEqual([
      { k: 1, a: "uno", b: "B2" },
      { k: 2, a: "dos", b: "B4" },
    ]);
    expect(await combined({ by: "all" })).toHaveLength(6);
    // Two branches into one input join with no step (AU-11): «Combinar» is only for crossing.
    expect(stepType("combine")?.inputs).toEqual(["a", "b"]);
    const joined = sketch()
      .step("Inicio", "manual")
      .step("A", "edit", { fields: [{ field: "x", value: 1 }] })
      .step("B", "edit", { fields: [{ field: "x", value: 2 }] })
      .step("Juntas", "limit", { count: 5 })
      .arrow("Inicio", "A")
      .arrow("Inicio", "B")
      .arrow("A", "Juntas")
      .arrow("B", "Juntas");
    expect(validate(joined.build(), knowing())).toEqual([]);
    expect(outOf(await start(joined.build(), joined.id("Inicio")), joined.id("Juntas"))).toEqual([
      { x: 1 },
      { x: 2 },
    ]);
  });
});

describe("«Colección», action by action", () => {
  const next = ids(125);
  const items = collection(next, ["text", "number", "select"]);
  const [name, n, kind] = items.fields.map((f) => f.key) as [string, string, string];
  const fresh = () =>
    store(
      [items],
      {
        [items.key]: [
          { [name]: "una", [n]: 1, [kind]: "a" },
          { [name]: "dos", [n]: 2, [kind]: "b" },
          { [name]: "dos", [n]: 3, [kind]: "a" },
        ],
      },
      ids(126),
    );
  const one = (params: Step["params"]) =>
    sketch()
      .step("Inicio", "manual")
      .step("Paso", "collection", { collection: items.key, ...params })
      .arrow("Inicio", "Paso");

  it("«Crear o modificar» modifies the one row that matches, makes one when none does, and fails when more than one does, saying how many", async () => {
    const upsert = (value: string) =>
      one({
        [ACTION]: "upsert",
        match: [{ field: name }],
        fields: [
          { field: name, value },
          { field: n, value: 9 },
        ],
      });
    const db = fresh();
    for (const value of ["una", "tres"]) {
      const s = upsert(value);
      expect((await start(s.build(), s.id("Inicio"), {}, { collections: db })).state).toBe("done");
    }
    expect(db.applied.map((c) => c.kind)).toEqual(["update", "create"]);
    expect(db.rows(items.key).map((r) => [r.json[name], r.json[n]])).toEqual([
      ["una", 9],
      ["dos", 2],
      ["dos", 3],
      ["tres", 9],
    ]);
    // Three rows match (more than the two it reads to know): it fails, and says how many.
    db.rows(items.key).push({
      json: { [name]: "dos", [n]: 4, [kind]: "b" },
      label: OWN,
      origin: { collection: items.key, id: "o_tercera", version: 1 },
    });
    const twice = upsert("dos");
    const e = await start(twice.build(), twice.id("Inicio"), {}, { collections: db });
    expect(e.error?.message).toBe(
      `3 rows of the collection ${items.key} match: it modifies one or none`,
    );
  });

  it("«Las que cumplan…» reaches every row that matches, more than a search's 50", async () => {
    const db = store(
      [items],
      {
        [items.key]: Array.from({ length: 70 }, (_, i) => ({
          [name]: `fila ${i}`,
          [n]: i,
          [kind]: "a",
        })),
      },
      ids(127),
    );
    const s = one({
      [ACTION]: "update",
      target: "matching",
      where: [{ field: n, op: "gt", value: 4 }],
      fields: [{ field: kind, value: "b" }],
    });
    expect((await start(s.build(), s.id("Inicio"), {}, { collections: db })).state).toBe("done");
    expect(db.applied).toHaveLength(65);
    expect(db.rows(items.key).filter((r) => r.json[kind] === "b")).toHaveLength(65);
  });

  it("«Contar o sumar» gives one row, or one per group, with its result derived; «Leer una fila» fails on a row that is not there", async () => {
    const count = one({ [ACTION]: "aggregate", measure: "sum", field: n, groupBy: kind });
    const e = await start(count.build(), count.id("Inicio"), {}, { collections: fresh() });
    expect(e.steps[count.id("Paso")]?.out.main?.map((r) => [r.json, r.fields])).toEqual([
      [{ [kind]: "a", [`sum_${n}`]: 4 }, { [`sum_${n}`]: { label: OWN, derived: true } }],
      [{ [kind]: "b", [`sum_${n}`]: 2 }, { [`sum_${n}`]: { label: OWN, derived: true } }],
    ]);
    const all = one({ [ACTION]: "aggregate", where: [{ field: n, op: "gt", value: 1 }] });
    const e2 = await start(all.build(), all.id("Inicio"), {}, { collections: fresh() });
    expect(outOf(e2, all.id("Paso"))).toEqual([{ count: 2 }]);

    const db = fresh();
    const id = db.rows(items.key)[1]?.origin.id as string;
    const get = (row: string) => one({ [ACTION]: "get", row });
    const found = await start(get(id).build(), get(id).id("Inicio"), {}, { collections: db });
    expect(found.steps[get(id).id("Paso")]?.out.main?.map((r) => [r.json[n], r.origin])).toEqual([
      [2, db.rows(items.key)[1]?.origin],
    ]);
    const missing = await start(
      get("o_ninguna").build(),
      get("o_ninguna").id("Inicio"),
      {},
      { collections: db },
    );
    expect(missing.error?.message).toBe(`the row o_ninguna is not in the collection ${items.key}`);
  });
});

const step = (type: string, params: Step["params"] = {}): Step => ({
  id: "s1",
  name: "Step",
  type,
  params,
});

interface ParamList {
  at: string;
  params: readonly ParamSpec[];
  own: StepTypeSpec;
  action?: ActionSpec;
}

/** Every list of parameters of the catalogue, with where it is, a list's columns included. */
function paramLists(): ParamList[] {
  const lists: ParamList[] = [];
  for (const own of CATALOGUE) {
    lists.push({ at: own.type, params: own.params, own });
    for (const action of own.actions) {
      const at = `${own.type}.${action.key}`;
      lists.push({ at, params: action.params, own, action });
      for (const p of action.params)
        if (p.control === "list")
          lists.push({ at: `${at}.${p.key}`, params: p.columns, own, action });
    }
  }
  return lists;
}

describe("the catalogue as data", () => {
  it("has the trigger and the steps of Datos, Transformar and Lógica of F14a, each once", () => {
    const types = CATALOGUE.map((t) => t.type);
    expect(new Set(types).size).toBe(types.length);
    expect(types).toEqual([
      "manual",
      "collection",
      "edit",
      "filter",
      "sort",
      "limit",
      "dedupe",
      "group",
      "split",
      "join",
      "date",
      "combine",
      "if",
      "switch",
      "stop",
    ]);
    expect(stepType("collection")?.actions.map((a) => a.key)).toEqual([
      "find",
      "get",
      "create",
      "update",
      "upsert",
      "trash",
      "aggregate",
    ]);
    for (const t of CATALOGUE) expect(CATEGORIES, t.type).toContain(t.category);
  });

  it("a type has one action called run, or several with their own keys", () => {
    for (const t of CATALOGUE) {
      const keys = t.actions.map((a) => a.key);
      expect(keys.length, t.type).toBeGreaterThan(0);
      expect(new Set(keys).size, t.type).toBe(keys.length);
      if (keys.length === 1) expect(keys, t.type).toEqual([RUN]);
      else expect(keys, t.type).not.toContain(RUN);
    }
  });

  it("only a trigger has no input, and only a data step reads or writes", () => {
    for (const t of CATALOGUE) {
      expect(t.inputs.length === 0, t.type).toBe(t.category === "trigger");
      expect(new Set(t.inputs).size, t.type).toBe(t.inputs.length);
      for (const a of t.actions) {
        if (a.effect !== "none") expect(t.category, `${t.type}.${a.key}`).toBe("data");
        if (a.destroys) expect(a.effect, `${t.type}.${a.key}`).toBe("write");
        if (a.mode === "perRow") expect(a.pairs, `${t.type}.${a.key}`).toBe(true);
      }
    }
  });

  it("AU-80 · every parameter is one of the controls there are, with a key of its own where it is painted: a step type brings no control of its own", () => {
    for (const { at, params, own, action } of paramLists()) {
      for (const p of params) expect(CONTROLS, `${at}.${p.key}`).toContain(p.control);
      // Two parameters may share a key only if they are never painted together (their `when` differ).
      const always = [...(action ? own.params : []), ...params].filter((p) => !p.when);
      const keys = always.map((p) => p.key);
      expect(new Set(keys).size, at).toBe(keys.length);
      expect(keys, at).not.toContain(ACTION);
    }
  });

  it("a parameter painted only sometimes depends on a fixed choice of its own step", () => {
    for (const { at, params, own } of paramLists()) {
      for (const p of params) {
        if (!p.when) continue;
        const on = [...own.params, ...params].find((q) => q.key === p.when?.param);
        expect(on, `${at}.${p.key}`).toBeDefined();
        expect(on?.shape, `${at}.${p.key}`).toBe(true);
        expect(on?.control, `${at}.${p.key}`).toBe("choice");
        if (on?.control === "choice" && Array.isArray(on.options))
          for (const v of p.when.in) expect(on.options, `${at}.${p.key}`).toContain(v);
      }
    }
  });

  it("AU-77 · what gives a step its shape or changes which rows come out is never behind «Añadir opción»", () => {
    for (const { at, params } of paramLists())
      for (const p of params)
        if (p.shape || p.changesRows || p.required)
          expect(p.place, `${at}.${p.key}`).not.toBe("option");
  });

  it("AU-75 · no action of any step shows more than seven parameters before «Añadir opción», with any combination of the choices that change its shape", () => {
    // What the phase's criterion calls «cosas»: the rows of «Parámetros» in sight (`place: "shown"` and its `when`
    // holding). A list counts as one; an option Juan added is his own, and is not counted here.
    let most = 0;
    for (const t of CATALOGUE)
      for (const action of t.actions) {
        const fixed = [...t.params, ...action.params].filter(
          (q): q is ParamSpec & { control: "choice"; options: readonly string[] } =>
            q.shape === true && q.control === "choice" && Array.isArray(q.options),
        );
        // Every combination of its fixed choices: the parameters painted depend only on them (the test above).
        let shapes: Step["params"][] = [t.actions.length > 1 ? { [ACTION]: action.key } : {}];
        for (const q of fixed)
          shapes = shapes.flatMap((s) => q.options.map((v) => ({ ...s, [q.key]: v })));
        for (const params of shapes) {
          const step: Step = { id: "s_x", name: "x", type: t.type, params };
          const shown = paramsOf(step).filter((q) => q.place === "shown");
          most = Math.max(most, shown.length);
          expect(
            shown.length,
            `${t.type}.${action.key} ${JSON.stringify(params)}: ${shown.map((q) => q.key).join(", ")}`,
          ).toBeLessThanOrEqual(7);
        }
      }
    expect(most).toBeGreaterThan(2);
  });

  it("a choice with a default offers it", () => {
    for (const { at, params } of paramLists())
      for (const p of params)
        if (p.control === "choice" && Array.isArray(p.options) && p.default !== undefined)
          expect(p.options, `${at}.${p.key}`).toContain(p.default);
  });

  it("a step's action is its type's only one, or the one it names with a fixed value", () => {
    expect(actionOf(step("filter"))?.key).toBe(RUN);
    expect(actionOf(step("collection", { [ACTION]: "find" }))?.effect).toBe("read");
    expect(actionOf(step("collection", { [ACTION]: "trash" }))?.destroys).toBe(true);
    expect(actionOf(step("collection"))).toBeUndefined();
    expect(actionOf(step("collection", { [ACTION]: { expr: "{{ $json.a }}" } }))).toBeUndefined();
    expect(actionOf(step("collection", { [ACTION]: "nothing" }))).toBeUndefined();
    expect(actionOf(step("unknown"))).toBeUndefined();
  });

  it("a trigger is a step of the catalogue with no input", () => {
    expect(isTrigger(step("manual"))).toBe(true);
    expect(isTrigger(step("if"))).toBe(false);
    expect(inputsOf(step("manual"))).toEqual([]);
    expect(inputsOf(step("combine"))).toEqual(["a", "b"]);
    expect(inputsOf(step("unknown"))).toEqual([]);
  });
});
