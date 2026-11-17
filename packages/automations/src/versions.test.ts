// What «Publicar» and «Versiones» show, as pure functions (docs/automatizaciones.md §5.8, AU-96, AU-98, AU-182, AU-47,
// AU-192; phase F14d): the difference between two documents, what stops a publish and what is worth a look, what the
// automation will be able to do, and the names a version keeps. Invented collections with generated keys; where a
// test says what the engine would accept, it runs the engine over the fakes of run.test-util.ts.
import { describe, expect, it } from "vitest";
import { AGENT_PARAMS } from "./agent.ts";
import { cite, collection, ids, sketch } from "./automation.test-util.ts";
import type { Box, BoxJob, Evaluated } from "./box.ts";
import { AGENT_TYPE, CODE_TYPE } from "./code.ts";
import { type Connection, newConnection } from "./connections.ts";
import type { CollectionShape } from "./effects.ts";
import { run } from "./engine.ts";
import type { Automation, Step } from "./format.ts";
import { renameCollectionInCode } from "./javascript.ts";
import { deps, OWN, policy, store } from "./run.test-util.ts";
import { validate } from "./validate.ts";
import {
  abilities,
  diffAutomations,
  isSame,
  keptNames,
  namedFor,
  publishChecks,
} from "./versions.ts";
import { stepChanges, WRITE_ACTIONS, type WriteAction, type WriteRequest } from "./writes.ts";

const next = ids(21);
const alfa = collection(next, ["number", "text"]);
const beta = collection(next, ["number", "text"]);
const gamma = collection(next, ["number", "text"]);
const SHAPES = [alfa, beta, gamma];
const NAMES: Record<string, string> = { Alfa: alfa.key, Beta: beta.key, Gamma: gamma.key };
const collectionNamed = (name: string) => NAMES[name];
const collectionName = (key: string) => Object.keys(NAMES).find((n) => NAMES[n] === key);
const context = { collection: (key: string) => SHAPES.find((s) => s.key === key) };
const codeContext = { ...context, collectionNamed, collectionName };
const fieldOf = (c: CollectionShape, i = 0) => c.fields[i]?.key as string;

const YES = { mode: "yes" } as const;
const ASK = { mode: "ask" } as const;
type Cell = false | typeof YES | typeof ASK;
const connect = (
  c: CollectionShape,
  cells: Partial<Record<WriteAction, Cell>> = {},
  read: Connection["read"] = {},
): Connection => ({ ...newConnection(c.key), read, ...cells });

/** «Inicio» → «Código» (with this source and these connections), and whatever `more` adds. */
function withCode(source: string, connections: Connection[], seed = 30) {
  const s = sketch(seed)
    .step("Inicio", "manual", { fields: [] })
    .step("Código", CODE_TYPE, { mode: "all", source })
    .arrow("Inicio", "Código");
  const a = s.build();
  (a.steps.find((x) => x.name === "Código") as Step).connections = connections;
  return { s, a };
}

describe("the difference between two versions (F14d)", () => {
  const base = () =>
    sketch(40)
      .step("Inicio", "manual")
      .step("Leer", "collection", { collection: alfa.key, action: "find" })
      .step("Crear", "collection", {
        collection: beta.key,
        action: "create",
        fields: [{ field: fieldOf(beta), value: cite("$json.x") }],
        permission: "ask",
      })
      .arrow("Inicio", "Leer")
      .arrow("Leer", "Crear");

  it("AU-96 · `diffAutomations` names each step added, removed and changed (which parameters, which connections, which settings), the arrows, the name, the trigger and the limits; moving a box is no difference", () => {
    const s = base();
    const a = s.build();
    // Saved in another order (and the layout is not in the document, AU-05): no difference.
    const shuffled = { ...a, steps: [...a.steps].reverse(), arrows: [...a.arrows].reverse() };
    expect(isSame(diffAutomations(a, shuffled))).toBe(true);

    const b = structuredClone(a);
    b.name = "Otra";
    const crear = b.steps.find((x) => x.name === "Crear") as Step;
    crear.params.permission = "yes";
    crear.settings = { onError: "continue" };
    const inicio = b.steps.find((x) => x.name === "Inicio") as Step;
    inicio.params = { fields: [{ key: "de", name: "De", type: "text" }] };
    b.steps = b.steps.filter((x) => x.name !== "Leer");
    b.steps.push({ id: "s_nuevo", name: "Nuevo", type: "edit", params: {} });
    b.arrows = [
      { from: { step: s.id("Inicio"), output: "main" }, to: { step: "s_nuevo", input: "main" } },
      { from: { step: "s_nuevo", output: "main" }, to: { step: s.id("Crear"), input: "main" } },
    ];
    b.settings = { limits: { rowsWritten: 5_000 } };
    const code = withCode("return []", [connect(alfa)]).a;
    const codeB = structuredClone(code);
    (codeB.steps[1] as Step).connections = [connect(alfa, { create: ASK }), connect(beta)];

    const d = diffAutomations(a, b);
    expect(d.name).toEqual({ from: "Prueba", to: "Otra" });
    expect(d.added).toEqual(["s_nuevo"]);
    expect(d.removed).toEqual([s.id("Leer")]);
    expect(d.changed).toEqual(
      [
        { step: s.id("Inicio"), params: ["fields"], connections: [], settings: [] },
        { step: s.id("Crear"), params: ["permission"], connections: [], settings: ["onError"] },
      ].sort((x, y) => (x.step < y.step ? -1 : 1)),
    );
    expect(d.arrows.added).toHaveLength(2);
    expect(d.arrows.removed).toHaveLength(2);
    expect(d.triggers).toEqual([s.id("Inicio")]);
    expect(d.limits).toEqual([{ limit: "rowsWritten", from: 1_000, to: 5_000 }]);
    expect(diffAutomations(code, codeB).changed).toEqual([
      {
        step: (code.steps[1] as Step).id,
        params: [],
        connections: [alfa.key, beta.key].sort(),
        settings: [],
      },
    ]);
    // A limit written out at its default is the same limit.
    expect(diffAutomations(a, { ...a, settings: { limits: { ms: 60_000 } } }).limits).toEqual([]);
    // A fixed value of modify (decision 18 of §10) changes the connection, as one of create does.
    const fixedA = withCode("return []", [
      { ...connect(alfa), update: { ...YES, fixed: { [fieldOf(alfa)]: "uno" } } },
    ]).a;
    const fixedB = structuredClone(fixedA);
    const upd = (fixedB.steps[1] as Step).connections?.[0]?.update;
    if (upd) upd.fixed = { [fieldOf(alfa)]: "dos" };
    expect(diffAutomations(fixedA, fixedB).changed).toEqual([
      { step: (fixedA.steps[1] as Step).id, params: [], connections: [alfa.key], settings: [] },
    ]);
    expect(diffAutomations(fixedA, structuredClone(fixedA)).changed).toEqual([]);
  });

  it("AU-98 · the same difference serves two published versions: comparing the 2 with the 4 marks what «Versiones» paints as added, removed and changed, and a version compared with itself has none", () => {
    const two = { ...base().build(), version: 2 };
    const four = structuredClone(two);
    four.version = 4;
    four.steps.push({ id: "s_cuarta", name: "Cuarta", type: "edit", params: {} });
    (four.steps.find((x) => x.name === "Leer") as Step).params.collection = gamma.key;
    const d = diffAutomations(two, four);
    expect(d.added).toEqual(["s_cuarta"]);
    expect(d.removed).toEqual([]);
    expect(d.changed.map((c) => c.params)).toEqual([["collection"]]);
    // The version number is not part of what changed.
    expect(isSame(diffAutomations(four, four))).toBe(true);
    expect(isSame(diffAutomations(two, structuredClone(two)))).toBe(true);
  });
});

describe("what stops a publish and what is worth a look (F14d)", () => {
  it("AU-96 · a problem of the validation, or an empty required parameter, on a step a trigger reaches stops the publish and names the step; the same on a step no trigger reaches does not", async () => {
    const reached = sketch(50)
      .step("Inicio", "manual")
      .step("Crear", "collection", { action: "create" })
      .arrow("Inicio", "Crear");
    const blocked = publishChecks(reached.build(), context);
    expect(blocked.blocks.map((p) => [p.code, p.step])).toContainEqual([
      "param.required",
      reached.id("Crear"),
    ]);
    expect(blocked.blocks.every((p) => p.step === reached.id("Crear"))).toBe(true);

    const loose = sketch(51)
      .step("Inicio", "manual")
      .step("Hecho", "edit", { fields: [{ field: "x", value: 1 }] })
      .step("Suelto", "collection", { action: "create" })
      .arrow("Inicio", "Hecho");
    const a = loose.build();
    const checks = publishChecks(a, context);
    expect(checks.blocks).toEqual([]);
    expect(checks.looks).toContainEqual({ code: "step.unreachable", step: loose.id("Suelto") });
    // What publishes runs: the engine refuses with the same function, so the loose step's error does not stop it.
    const e = await run(
      { automation: a, trigger: loose.id("Inicio"), fields: { json: {}, label: OWN }, test: false },
      deps(),
    );
    expect(e.state).toBe("done");
    // A problem of the whole automation stops it too.
    const over = publishChecks({ ...a, settings: { limits: { steps: 1_001 } } }, context);
    expect(over.blocks.map((p) => p.code)).toEqual(["limit.over"]);
  });

  it("AU-96 · what is worth a look and stops nothing: an output not connected, a step no trigger reaches, a step never tested or with a stale test, a pinned output, a limit that is not its default", () => {
    const s = sketch(52)
      .step("Inicio", "manual")
      .step("Si", "if", { where: [{ field: "a", op: "not_empty" }] })
      .step("Sí", "edit", { fields: [{ field: "x", value: 1 }] })
      .step("Otro", "edit", { fields: [{ field: "x", value: 2 }] })
      .step("Viejo", "edit", { fields: [{ field: "x", value: 3 }] })
      .step("Suelto", "limit", { count: 1 })
      .arrow("Inicio", "Si")
      .arrow("Si", "Sí", "yes")
      .arrow("Inicio", "Otro")
      .arrow("Inicio", "Viejo");
    const a = { ...s.build(), settings: { limits: { ms: 120_000, steps: 200 } } };
    const checks = publishChecks(a, context, {
      kept: { [s.id("Si")]: "p1", [s.id("Sí")]: "p2", [s.id("Viejo")]: "p3" },
      prints: { [s.id("Si")]: "p1", [s.id("Sí")]: "p2", [s.id("Viejo")]: "p3-otra" },
      pinned: [s.id("Sí")],
    });
    expect(checks.blocks).toEqual([]);
    expect(checks.looks).toEqual([
      { code: "output.unconnected", step: s.id("Si"), detail: { output: "no" } },
      { code: "step.unreachable", step: s.id("Suelto") },
      ...[
        { code: "step.untested", step: s.id("Otro") },
        { code: "step.stale", step: s.id("Viejo") },
      ].sort((x, y) => (x.step < y.step ? -1 : 1)),
      { code: "output.pinned", step: s.id("Sí") },
      // `steps` written at its default is not a change.
      { code: "limit.changed", detail: { limit: "ms", value: 120_000, default: 60_000 } },
    ]);
  });
});

// ---------------------------------------------------------------- the engine, to know what it would accept

/** A box that answers every «Código» with these requests to save: a real interpreter's answer, without one. */
function asking(requests: readonly WriteRequest[]): Box {
  return {
    async run(job: BoxJob) {
      const all = job.kind === "code" && job.mode === "all";
      const evaluations: Evaluated[] = Array.from({ length: all ? 1 : job.input.length }, () => ({
        state: "done",
        values: [[]],
        clock: false,
        random: false,
        ...(requests.length ? { writes: requests } : {}),
      }));
      return { evaluations, console: [], dropped: 0, ms: 1 };
    },
  };
}

/** What a run of `a` did, as collection and write action: what it saved and what it asked for. */
async function accepted(a: Automation, trigger: string, requests: readonly WriteRequest[]) {
  const st = store(SHAPES, { [alfa.key]: [{ [fieldOf(alfa)]: 1 }] }, ids(60));
  const e = await run(
    { automation: a, trigger, fields: { json: {}, label: OWN }, test: false },
    deps({ collections: st, policy: policy(), box: asking(requests), collectionNamed }),
  );
  const of = (kind: "create" | "update" | "trash"): WriteAction =>
    kind === "trash" ? "remove" : kind;
  const saved = st.applied.map((c) => ({
    collection: c.kind === "create" ? c.collection : c.row.collection,
    action: of(c.kind),
    saved: true,
  }));
  const asked = e.asked.map((x) => ({
    collection: x.change.kind === "create" ? x.change.collection : x.change.row.collection,
    action: of(x.change.kind),
    saved: false,
  }));
  return { e, st, did: [...saved, ...asked], row: st.rows(alfa.key)[0]?.origin.id as string };
}

/** Every combination of three cells. */
const CELLS: Cell[] = [false, ASK, YES];
const combos = CELLS.flatMap((create) =>
  CELLS.flatMap((update) => CELLS.map((remove) => ({ create, update, remove }))),
);
const SOURCE: Record<WriteAction, string> = {
  create: "$col('Alfa').create({ a: 1 })",
  update: "$col('Alfa').update('x', { a: 1 })",
  remove: "$col('Alfa').remove('x')",
};

describe("what it will be able to do (F14d)", () => {
  it("AU-96 · `abilities` says, by collection, what the automation reads and what it creates, modifies and removes, and of each write whether it saves on its own or asks, one line per collection and action", () => {
    const s = sketch(70)
      .step("Inicio", "manual")
      .step("Leer", "collection", { collection: alfa.key, action: "find" })
      .step("Contar", "collection", { collection: alfa.key, action: "aggregate" })
      .step("Crear uno", "collection", {
        collection: beta.key,
        action: "create",
        permission: "ask",
      })
      .step("Crear dos", "collection", {
        collection: beta.key,
        action: "create",
        permission: "yes",
      })
      .step("Poner", "collection", { collection: gamma.key, action: "upsert", permission: "ask" })
      .step("Quitar", "collection", { collection: gamma.key, action: "trash", permission: "ask" })
      .arrow("Inicio", "Leer")
      .arrow("Leer", "Contar")
      .arrow("Contar", "Crear uno")
      .arrow("Contar", "Crear dos")
      .arrow("Contar", "Poner")
      .arrow("Contar", "Quitar");
    const lines = abilities(s.build(), { collectionNamed });
    const sorted = (...names: string[]) => names.map((n) => s.id(n)).sort();
    const expected = [
      { collection: alfa.key, action: "read", steps: sorted("Leer", "Contar") },
      // Two steps create in it: one asks, one saves; the line says the most it can do without asking.
      {
        collection: beta.key,
        action: "create",
        how: "saves",
        steps: sorted("Crear uno", "Crear dos"),
      },
      { collection: gamma.key, action: "create", how: "asks", steps: sorted("Poner") },
      { collection: gamma.key, action: "update", how: "asks", steps: sorted("Poner") },
      { collection: gamma.key, action: "remove", how: "asks", steps: sorted("Quitar") },
    ];
    const order = (x: { collection: string }) => x.collection;
    expect(lines).toEqual(
      [...expected].sort((x, y) => (order(x) < order(y) ? -1 : order(x) > order(y) ? 1 : 0)),
    );
    // One line per collection and action: never two.
    const keys = lines.map((l) => `${l.collection}:${l.action}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("AU-182 · for every example of the catalogue that saves, each change the engine would accept from a «Código» (what its analysis saw and its connection allows) is named in `abilities` with its collection and its action, and one the connection does not allow is not", async () => {
    const lineOf = (a: Automation, action: WriteAction) =>
      abilities(a, { collectionNamed }).find(
        (l) => l.collection === alfa.key && l.action === action,
      );
    // «Código»: every cell of each action, and the code asking for each action.
    for (const cells of combos) {
      const used = WRITE_ACTIONS.filter((x) => cells[x] !== false);
      const { s, a } = withCode([...used.map((x) => SOURCE[x]), "return []"].join("\n"), [
        connect(alfa, cells),
      ]);
      for (const action of WRITE_ACTIONS) {
        const cell = cells[action];
        const line = lineOf(a, action);
        if (cell === false) expect(line, `${action} ${JSON.stringify(cells)}`).toBeUndefined();
        else
          expect(line?.how, `${action} ${JSON.stringify(cells)}`).toBe(
            cell.mode === "ask" ? "asks" : action === "remove" ? "noAsk" : "saves",
          );
      }
      // What the engine does with one request of each action used: every change it accepts is named so.
      const probe = await accepted(a, s.id("Inicio"), []);
      const requests: WriteRequest[] = used.map((action) =>
        action === "create"
          ? { collection: "Alfa", action, fields: { [fieldOf(alfa)]: 2 } }
          : action === "update"
            ? { collection: "Alfa", action, id: probe.row, fields: { [fieldOf(alfa)]: 3 } }
            : { collection: "Alfa", action, id: probe.row },
      );
      const { did } = await accepted(a, s.id("Inicio"), requests);
      for (const d of did) {
        const line = lineOf(a, d.action);
        expect(line, JSON.stringify(d)).toBeDefined();
        // What it saved is never named as asking. The step's changes wait together when one of its cells asks
        // (`applyWrites`), so a «Sí» may wait too: the line is the most it can do, never less.
        if (d.saved)
          expect(line?.how, `${JSON.stringify(d)} ${JSON.stringify(cells)}`).not.toBe("asks");
        if (line?.how === "asks") expect(d.saved, JSON.stringify(d)).toBe(false);
      }
      // With no cell asking, what a «Sí» connection asks for is saved.
      if (!used.some((x) => cells[x] !== false && (cells[x] as { mode: string }).mode === "ask"))
        expect(
          did.every((d) => d.saved),
          JSON.stringify(cells),
        ).toBe(true);
      expect(did.map((d) => d.action).sort()).toEqual([...used].sort());
    }
    // The code asks for an action its connection does not give: not named (and it does not validate, AU-176).
    const refused = withCode(`${SOURCE.remove}\nreturn []`, [connect(alfa, { remove: false })]).a;
    expect(lineOf(refused, "remove")).toBeUndefined();
    expect(validate(refused, codeContext).map((p) => p.code)).toContain("code.write.notAllowed");
    // A cell its code never uses: the analysis did not see it, so it is not named.
    const unused = withCode("return []", [connect(alfa, { create: YES })]).a;
    expect(lineOf(unused, "create")).toBeUndefined();

    // «Colección»: each write action with each «Permiso»; what a run saves or asks is named so.
    for (const action of ["create", "update", "upsert", "trash"] as const)
      for (const permission of ["yes", "ask"] as const) {
        const s = sketch(80)
          .step("Inicio", "manual")
          .step("Leer", "collection", { collection: alfa.key, action: "find" })
          .step("Escribir", "collection", {
            collection: alfa.key,
            action,
            permission,
            ...(action === "trash" ? {} : { fields: [{ field: fieldOf(alfa), value: 4 }] }),
            ...(action === "upsert" ? { match: [{ field: fieldOf(alfa) }] } : {}),
          })
          .arrow("Inicio", "Leer")
          .arrow("Leer", "Escribir");
        const a = s.build();
        const { did } = await accepted(a, s.id("Inicio"), []);
        expect(did.length, `${action} ${permission}`).toBe(1);
        for (const d of did) {
          const line = lineOf(a, d.action);
          expect(line?.how === "asks", `${action} ${permission}`).toBe(!d.saved);
        }
        const named = abilities(a, { collectionNamed })
          .filter((l) => l.action !== "read")
          .map((l) => l.action);
        expect(named, `${action} ${permission}`).toEqual(
          stepChanges(a.steps[2] as Step, { collectionNamed })[0]?.actions.map((x) => x.action),
        );
      }
  });

  it("AU-182 · a removal with «Sí», of a connection or of «Eliminar filas», is named with «sin preguntar», and one with «Preguntar» is not", () => {
    const how = (a: Automation) =>
      abilities(a, { collectionNamed }).find((l) => l.action === "remove")?.how;
    const code = (cell: Cell) =>
      withCode(`${SOURCE.remove}\nreturn []`, [connect(alfa, { remove: cell })]).a;
    expect(how(code(YES))).toBe("noAsk");
    expect(how(code(ASK))).toBe("asks");
    const trash = (permission: "yes" | "ask") =>
      sketch(90)
        .step("Inicio", "manual")
        .step("Quitar", "collection", { collection: alfa.key, action: "trash", permission })
        .arrow("Inicio", "Quitar")
        .build();
    expect(how(trash("yes"))).toBe("noAsk");
    expect(how(trash("ask"))).toBe("asks");
    // Creating and modifying with «Sí» never carry it (AU-189): they «las guardan».
    const creates = withCode(`${SOURCE.create}\n${SOURCE.update}\nreturn []`, [
      connect(alfa, { create: YES, update: YES }),
    ]).a;
    expect(abilities(creates, { collectionNamed }).map((l) => l.how)).toEqual([
      undefined,
      "saves",
      "saves",
    ]);
  });

  it("AU-182 · a write with «Sí» whose step can receive something from outside (a source of outside in its path of rows or of control, or a read of a collection given as holding outside values) says «con datos de fuera», for create, update and remove alike; one with «Preguntar», or with no such path, does not", () => {
    const outside = new Set([alfa.key]);
    const flagged = (a: Automation, set: ReadonlySet<string> = outside) =>
      abilities(a, { collectionNamed, outside: set })
        .filter((l) => l.action !== "read")
        .map((l) => [l.collection, l.action, l.how, l.outside ?? false]);

    // A read of a collection that holds outside values, before the write in its rows' path.
    for (const [action, permission, flag] of [
      ["create", "yes", true],
      ["update", "yes", true],
      ["trash", "yes", true],
      ["create", "ask", false],
      ["trash", "ask", false],
    ] as const) {
      const s = sketch(100)
        .step("Inicio", "manual")
        .step("Leer", "collection", { collection: alfa.key, action: "find" })
        .step("Escribir", "collection", { collection: beta.key, action, permission })
        .arrow("Inicio", "Leer")
        .arrow("Leer", "Escribir");
      const [line] = flagged(s.build());
      expect(line?.[3], `${action} ${permission}`).toBe(flag);
      // The same read, of a collection that holds nothing from outside today: nothing.
      expect(flagged(s.build(), new Set())[0]?.[3], `${action} ${permission}`).toBe(false);
    }

    // No such path: the read is on another branch, and the write does not cite it.
    const apart = sketch(101)
      .step("Inicio", "manual")
      .step("Leer", "collection", { collection: alfa.key, action: "find" })
      .step("Crear", "collection", { collection: beta.key, action: "create", permission: "yes" })
      .arrow("Inicio", "Leer")
      .arrow("Inicio", "Crear");
    expect(flagged(apart.build())).toEqual([[beta.key, "create", "saves", false]]);
    // Citing what was read is part of its path.
    const cites = sketch(102)
      .step("Inicio", "manual")
      .step("Leer", "collection", { collection: alfa.key, action: "find" })
      .step("Crear", "collection", {
        collection: beta.key,
        action: "create",
        permission: "yes",
        fields: [{ field: fieldOf(beta, 1), value: cite("$('Leer').first().x") }],
      })
      .arrow("Inicio", "Leer")
      .arrow("Inicio", "Crear");
    expect(flagged(cites.build())).toEqual([[beta.key, "create", "saves", true]]);
    // A step that decides whether it runs («Si») is in the path of control, its reads too.
    const control = sketch(103)
      .step("Inicio", "manual")
      .step("Leer", "collection", { collection: alfa.key, action: "find" })
      .step("Si", "if", { where: [{ field: "a", op: "not_empty" }] })
      .step("Quitar", "collection", { collection: beta.key, action: "trash", permission: "yes" })
      .arrow("Inicio", "Leer")
      .arrow("Leer", "Si")
      .arrow("Si", "Quitar", "yes");
    expect(flagged(control.build())).toEqual([[beta.key, "remove", "noAsk", true]]);

    // A «Código» that reads it through its connection and writes elsewhere with «Sí», for each action.
    for (const action of WRITE_ACTIONS) {
      const source = `$col('Alfa').find()\n${SOURCE[action].replace("Alfa", "Beta")}\nreturn []`;
      const yes = withCode(source, [connect(alfa), connect(beta, { [action]: YES })]).a;
      const ask = withCode(source, [connect(alfa), connect(beta, { [action]: ASK })]).a;
      const noRead = withCode(source, [
        connect(alfa, {}, false),
        connect(beta, { [action]: YES }),
      ]).a;
      expect(flagged(yes)[0]?.[3], action).toBe(true);
      expect(flagged(ask)[0]?.[3], action).toBe(false);
      expect(flagged(noRead)[0]?.[3], action).toBe(false);
    }
  });

  it("AU-47 · every change a step can make (`stepChanges`) and every read of a connection is in `abilities`, which is what the map reads: nothing a published version can touch is missing from it", () => {
    const s = sketch(110)
      .step("Inicio", "manual")
      .step("Leer", "collection", { collection: gamma.key, action: "find" })
      .step("Código", CODE_TYPE, {
        mode: "all",
        source: [
          "$col('Alfa').find()",
          SOURCE.create,
          SOURCE.remove,
          "$col('Beta').update('x', { a: 1 })",
          "return []",
        ].join("\n"),
      })
      .step("Poner", "collection", { collection: beta.key, action: "upsert", permission: "yes" })
      .step("Suelto", "collection", { collection: gamma.key, action: "trash", permission: "ask" })
      .arrow("Inicio", "Leer")
      .arrow("Leer", "Código")
      .arrow("Código", "Poner");
    const a = s.build();
    (a.steps.find((x) => x.name === "Código") as Step).connections = [
      connect(alfa, { create: ASK, remove: YES }),
      connect(beta, { update: YES }),
    ];
    const lines = abilities(a, { collectionNamed });
    const has = (step: string, collection: string, action: string) =>
      lines.some(
        (l) => l.collection === collection && l.action === action && l.steps.includes(step),
      );
    for (const step of a.steps) {
      for (const change of stepChanges(step, { collectionNamed }))
        for (const x of change.actions)
          if (x.mode !== false)
            expect(has(step.id, change.collection, x.action), `${step.name} ${x.action}`).toBe(
              true,
            );
      for (const c of step.connections ?? [])
        if (c.read !== false) expect(has(step.id, c.collection, "read"), step.name).toBe(true);
    }
    // A «Colección» that reads is there too, and a step no trigger reaches (it never says less).
    expect(has(s.id("Leer"), gamma.key, "read")).toBe(true);
    expect(has(s.id("Suelto"), gamma.key, "remove")).toBe(true);
  });
});

describe("the names a version keeps (F14d)", () => {
  const source = "const n = $col('Alfa').count()\n$col('Beta').find()\nreturn [{ n }]";

  it("AU-192 · a version keeps, for each collection its code cites by name, the key that name was when it was published, and only for the collections connected to that step", () => {
    const { a, s } = withCode(source, [connect(alfa)]);
    const step = a.steps.find((x) => x.name === "Código") as Step;
    const kept = keptNames(a, collectionNamed);
    // «Beta» is cited and not connected: not kept. A step with no code keeps nothing.
    expect(kept).toEqual({ [step.id]: { Alfa: alfa.key } });
    expect(kept[s.id("Inicio")]).toBeUndefined();

    // Later, «Alfa» is called «Delta», and a new collection takes the name «Alfa».
    const now = (name: string) => ({ Delta: alfa.key, Alfa: gamma.key, Beta: beta.key })[name];
    const named = namedFor(step, kept, now);
    expect(named("Alfa")).toBe(alfa.key);
    expect(named("Beta")).toBe(beta.key);
    // It never widens: with the connection gone, the kept key is not used.
    expect(namedFor({ ...step, connections: [] }, kept, now)("Alfa")).toBe(gamma.key);
  });

  it("AU-192 · AU-51 · AU-58 · an «Agente»'s own code and its code tools keep their names as a «Código» does, and a step its code cites is in its path (AU-182)", () => {
    const tools = [{ name: "contar", inputs: [], code: "return $col('Beta').count()" }];
    const s = sketch(41)
      .step("Inicio", "manual", { fields: [] })
      .step("Leer", "collection", { collection: gamma.key, action: "find" })
      .step("Analista", AGENT_TYPE, {
        instructions: "Resume",
        [AGENT_PARAMS.reads]: "code",
        [AGENT_PARAMS.code]: "return [$('Leer').first().json, $col('Alfa').count()]",
        [AGENT_PARAMS.tools]: tools as never,
      })
      .arrow("Inicio", "Leer")
      .arrow("Inicio", "Analista");
    const a = s.build();
    const step = a.steps.find((x) => x.name === "Analista") as Step;
    step.connections = [connect(alfa, { create: YES }), connect(beta)];
    // The names of its code and of its tool's, only for its connections.
    expect(keptNames(a, collectionNamed)).toEqual({
      [step.id]: { Alfa: alfa.key, Beta: beta.key },
    });
    // No arrow comes from «Leer», but its code cites it: «Gamma» holding outside values reaches its write.
    const flag = (code: string) => {
      const b = structuredClone(a);
      (b.steps.find((x) => x.name === "Analista") as Step).params[AGENT_PARAMS.code] = code;
      return abilities(b, { collectionNamed, outside: new Set([gamma.key]) }).find(
        (l) => l.action === "create",
      )?.outside;
    };
    expect(flag("return [$('Leer').first().json]")).toBe(true);
    expect(flag("return [$col('Alfa').count()]")).toBeUndefined();
  });

  it("AU-192 · in the draft, a code that cites a collection by a name it no longer has is a problem that says the name of today, and the fix rewrites that citation and nothing else", () => {
    const { a } = withCode(source, [connect(alfa), connect(beta)]);
    const step = a.steps.find((x) => x.name === "Código") as Step;
    const kept = keptNames(a, collectionNamed);
    // «Alfa» is now «Delta».
    const renamed = { Delta: alfa.key, Beta: beta.key } as Record<string, string>;
    const now = {
      ...context,
      collectionNamed: (name: string) => renamed[name],
      collectionName: (key: string) => Object.keys(renamed).find((n) => renamed[n] === key),
      keptKey: (id: string, name: string) => kept[id]?.[name],
    };
    const problems = validate(a, now).filter((p) => p.step === step.id);
    expect(
      problems.map((p) => [p.code, p.detail?.name, p.detail?.now, p.detail?.collection]),
    ).toEqual([["code.collectionRenamed", "Alfa", "Delta", alfa.key]]);
    // Without what the version kept, it is a name no collection has, as before.
    const { keptKey: _k, ...unknown } = now;
    expect(validate(a, unknown).map((p) => p.code)).toContain("code.unknownCollection");

    // The fix: `$col('Alfa')` and only that; a text, a comment and a step called the same stay.
    const text =
      "// Alfa\nconst x = $('Alfa').first()\nconst t = 'Alfa'\nreturn [{ n: $col(\"Alfa\").count(), t }]";
    expect(renameCollectionInCode(text, "Alfa", "Delta")).toBe(
      "// Alfa\nconst x = $('Alfa').first()\nconst t = 'Alfa'\nreturn [{ n: $col(\"Delta\").count(), t }]",
    );
    const fixed = structuredClone(a);
    const code = fixed.steps.find((x) => x.name === "Código") as Step;
    code.params.source = renameCollectionInCode(source, "Alfa", "Delta");
    expect(validate(fixed, now).filter((p) => p.step === step.id)).toEqual([]);
  });
});
