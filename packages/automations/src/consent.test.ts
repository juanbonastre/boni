// What saves without asking, in the engine (docs/automatizaciones.md §5.8, §5.10, §6: AU-186, AU-187, AU-188, AU-170;
// phase F14d): the two doors of a write (the user's cell, then the policy), the «Permiso» of a «Colección» step, a «Sí»
// lowered when it did not come from the user's hand, and the label each asked value carries. The server's half (the
// «Sí» read from the version it keeps, the origin `automation`) is apps/server's automations.test.ts; the policy's
// rows are packages/agent's automation-origin.test.ts.
import { describe, expect, it } from "vitest";
import { collection, ids, sketch } from "./automation.test-util.ts";
import { actionOf, bornParams, CATALOGUE, PERMISSION, PERMISSION_BORN } from "./catalogue.ts";
import { CODE_TYPE } from "./code.ts";
import { type Connection, newConnection } from "./connections.ts";
import { type Decision, Denied, guard, type PolicyCall } from "./effects.ts";
import { ACTION, type Automation, type Step } from "./format.ts";
import { OUTSIDE, OWN, policy, start, store } from "./run.test-util.ts";
import {
  applyWrites,
  CONNECTION_ASKS,
  consentOf,
  grantsOf,
  lowerYes,
  permissionOf,
  readWrites,
  stepChanges,
  type WriteGate,
  type WriteInput,
  type WriteRequest,
} from "./writes.ts";

const next = ids(301);
const items = collection(next, ["number", "text"]);
const [amount, note] = items.fields.map((f) => f.key) as [string, string];
const NAMES: Record<string, string> = { Cosas: items.key };
const named = (name: string) => NAMES[name];
const db = (n = 3, of = OWN) =>
  store(
    [items],
    { [items.key]: Array.from({ length: n }, (_, i) => ({ [amount]: i, [note]: "abierto" })) },
    ids(302),
    of,
  );
const idsIn = (st: ReturnType<typeof db>) => st.rows(items.key).map((r) => r.origin.id);
const SOURCE = [
  "$col('Cosas').create({ a: 1 })",
  "$col('Cosas').update('x', { a: 1 })",
  "$col('Cosas').remove('x')",
  "return []",
].join("\n");
const YES = { mode: "yes" } as const;
const ASK = { mode: "ask" } as const;
const cells = (c: Partial<Pick<Connection, "create" | "update" | "remove">>): Connection => ({
  ...newConnection(items.key),
  ...c,
});
const create = (fields: Record<string, unknown>): WriteRequest => ({
  collection: "Cosas",
  action: "create",
  fields: fields as WriteRequest["fields"],
});
const update = (id: string, fields: Record<string, unknown>): WriteRequest => ({
  collection: "Cosas",
  action: "update",
  id,
  fields: fields as WriteRequest["fields"],
});
const remove = (id: string): WriteRequest => ({ collection: "Cosas", action: "remove", id });
const input = (
  requests: WriteRequest[],
  connections: Connection[],
  more: Partial<WriteInput> = {},
): WriteInput => ({
  step: "s_ejemplo",
  requests,
  labels: requests.map(() => OWN),
  grants: grantsOf(readWrites(SOURCE, "code"), named),
  connections,
  collectionNamed: named,
  today: "2026-11-16",
  test: false,
  ...more,
});
const gateOf = (
  st: ReturnType<typeof db>,
  decide?: (c: PolicyCall) => Decision,
  test = false,
): WriteGate => {
  const g = guard(policy(decide), st, {
    automation: { id: "e_ejemplo", version: 1 },
    step: "s_ejemplo",
    type: CODE_TYPE,
    action: "",
    effect: "write",
    destroys: false,
    control: null,
    test,
    own: OWN,
  });
  return {
    shape: (c) => st.shape(c),
    get: (c, id) => st.get(c, id),
    decideAll: (cs) => g.decideAll(cs),
    writeAll: (cs) => g.writeAll(cs),
  };
};
const ALL = (st: ReturnType<typeof db>) => {
  const [a, b] = idsIn(st) as [string, string];
  return [create({ [amount]: 9 }), update(a, { [amount]: 7 }), remove(b)];
};

/** Every row of `db`: «Modificar filas» and «Eliminar filas» need a condition to search by. */
const OPEN = [{ field: note, op: "is", value: "abierto" }];

/** A «Colección» step that writes, with its «Permiso» as given (none: as a document saved without it). */
function colStep(action: string, permission?: "yes" | "ask", more: Record<string, unknown> = {}) {
  const s = sketch(310)
    .step("Inicio", "manual")
    .step("Guardar", "collection", {
      collection: items.key,
      [ACTION]: action,
      ...(action === "create" ? { fields: [{ field: amount, value: 5 }] } : {}),
      ...(action === "update"
        ? { target: "matching", where: OPEN, fields: [{ field: amount, value: 5 }] }
        : {}),
      ...(action === "trash" ? { target: "matching", where: OPEN } : {}),
      ...(permission ? { [PERMISSION]: permission } : {}),
      ...more,
    })
    .arrow("Inicio", "Guardar");
  return s;
}

describe("the two doors of a write (F14d)", () => {
  it("AU-186 · the cell first: «No» fails the step, «Preguntar» makes the step's whole change wait as one proposal in any run (one started by hand too), and «Sí» goes on to the policy", async () => {
    // A «Código»: «No» is a failure before anything is read or asked.
    const st = db();
    const [, b] = idsIn(st) as [string, string];
    await expect(
      applyWrites(input([remove(b)], [cells({ remove: false })]), gateOf(st)),
    ).rejects.toMatchObject({ why: { code: "code.write.notAllowed" } });
    // One «Preguntar» among «Sí»: the whole change waits, nothing saved.
    const waits = await applyWrites(
      input(ALL(st), [cells({ create: YES, update: YES, remove: ASK })]),
      gateOf(st),
    );
    expect(waits.kind).toBe("asked");
    expect(waits.kind === "asked" ? waits.asked.map((a) => a.rule) : []).toEqual(
      Array(3).fill(CONNECTION_ASKS),
    );
    expect(st.applied).toEqual([]);
    // A «Colección» step: «Preguntar» waits whatever the policy says; «Sí» goes to the policy.
    for (const action of ["create", "update", "trash"]) {
      const asking = db();
      const s = colStep(action, "ask");
      const e = await start(s.build(), s.id("Inicio"), {}, { collections: asking });
      expect(asking.applied, action).toEqual([]);
      expect(e.asked.length, action).toBeGreaterThan(0);
      expect(new Set(e.asked.map((a) => a.rule)), action).toEqual(new Set([CONNECTION_ASKS]));
      const saving = db();
      const p = policy();
      const y = colStep(action, "yes");
      const done = await start(y.build(), y.id("Inicio"), {}, { collections: saving, policy: p });
      expect(done.asked, action).toEqual([]);
      expect(saving.applied.length, action).toBeGreaterThan(0);
      expect(
        p.calls.some((c) => c.effect === "write"),
        action,
      ).toBe(true);
    }
  });
  it("AU-186 · with «Sí» and a policy that allows, a real run saves the step's change and asks nothing: no constant makes a «Sí» ask (`YES_SAVES` is gone)", async () => {
    const st = db();
    const out = await applyWrites(
      input(ALL(st), [cells({ create: YES, update: YES, remove: YES })]),
      gateOf(st),
    );
    expect(out.kind).toBe("applied");
    expect(st.applied.map((c) => c.kind)).toEqual(["create", "update", "trash"]);
    expect(await import("./writes.ts")).not.toHaveProperty("YES_SAVES");
  });
  it("AU-186 · a cell never turns the policy's answer: with «Sí», a change the policy proposes is proposed and one it denies fails the step, for create, update and remove alike", async () => {
    const yes = [cells({ create: YES, update: YES, remove: YES })];
    for (const action of ["create", "update", "trash"]) {
      const proposing = db();
      const proposed = await applyWrites(
        input(ALL(proposing), yes),
        gateOf(proposing, (c) =>
          c.action === action
            ? { kind: "propose", rule: "test.propose" }
            : { kind: "allow", rule: "test.allow" },
        ),
      );
      expect(proposed.kind, action).toBe("asked");
      expect(proposing.applied, action).toEqual([]);
      const denying = db();
      await expect(
        applyWrites(
          input(ALL(denying), yes),
          gateOf(denying, (c) =>
            c.action === action
              ? { kind: "deny", rule: "test.deny", reason: "no" }
              : { kind: "allow", rule: "test.allow" },
          ),
        ),
        action,
      ).rejects.toBeInstanceOf(Denied);
      expect(denying.applied, action).toEqual([]);
    }
    // And a «Colección» step with «Sí»: what the policy proposes waits with the policy's rule.
    const st = db();
    const s = colStep("update", "yes");
    const e = await start(
      s.build(),
      s.id("Inicio"),
      {},
      {
        collections: st,
        policy: policy((c) =>
          c.effect === "write"
            ? { kind: "propose", rule: "test.propose" }
            : { kind: "allow", rule: "test.allow" },
        ),
      },
    );
    expect(new Set(e.asked.map((a) => a.rule))).toEqual(new Set(["test.propose"]));
    expect(st.applied).toEqual([]);
  });
  it("AU-186 · in a test, a step asks when its cell says «Preguntar» or when the policy would ask a real run, whoever starts it: create and update with «Sí» add nothing to «Haría esto», remove with «Sí» says «sin preguntar»", async () => {
    const st = db();
    const test = (connections: Connection[], decide?: (c: PolicyCall) => Decision) =>
      applyWrites(input(ALL(st), connections, { test: true }), gateOf(st, decide, true));
    const yes = await test([cells({ create: YES, update: YES, remove: YES })]);
    expect(yes).toMatchObject({ kind: "tested", asks: false });
    const ask = await test([cells({ create: YES, update: YES, remove: ASK })]);
    expect(ask).toMatchObject({ kind: "tested", asks: true });
    const policyAsks = await test([cells({ create: YES, update: YES, remove: YES })], (c) =>
      c.destroys
        ? { kind: "confirm", rule: "test.confirm" }
        : { kind: "allow", rule: "test.allow" },
    );
    expect(policyAsks).toMatchObject({ kind: "tested", asks: true });
    expect(st.applied).toEqual([]);
  });
});

describe("«Permiso» of a «Colección» step (F14d)", () => {
  it("AU-187 · «Crear una fila», «Modificar filas» and «Eliminar filas» each have a parameter «Permiso», «Preguntar» or «Sí», in view and with the words of a connection's cells; a step saved without it reads «Preguntar», whatever its action and wherever it came from: a «Sí» is never a missing value", () => {
    const col = CATALOGUE.find((t) => t.type === "collection");
    const writes = (col?.actions ?? []).filter((a) => a.effect === "write");
    expect(writes.map((a) => a.key).sort()).toEqual(Object.keys(PERMISSION_BORN).sort());
    for (const a of writes) {
      const spec = a.params.find((p) => p.key === PERMISSION);
      expect(spec, a.key).toMatchObject({
        control: "choice",
        options: ["ask", "yes"],
        place: "shown",
        shape: true,
      });
      expect(spec?.default, a.key).toBe("ask");
    }
    // The words: «Preguntar» and «Sí», as a connection's cells say them (apps/boni-web's i18n, AU-86 words.test).
    // A step stored without the parameter (one kept before it existed, a converted old flow, an import that left it
    // out) asks on every action, create and update too.
    for (const action of Object.keys(PERMISSION_BORN)) {
      const bare: Step = {
        id: "s_ejemplo1",
        name: action,
        type: "collection",
        params: { collection: items.key, [ACTION]: action },
      };
      expect(permissionOf(bare), action).toBe("ask");
      expect(
        stepChanges(bare, { collectionNamed: named })[0]?.actions.map((x) => x.mode),
        action,
      ).not.toContain("yes");
    }
  });
  it("AU-187 · `stepChanges` gives each write of a «Colección» step with the mode of its «Permiso», so its card and «Haría esto» say «sin preguntar» of a removal exactly as for a «Código» with «Sí»", () => {
    for (const permission of ["yes", "ask"] as const) {
      const trash = colStep("trash", permission).build().steps[1] as Step;
      expect(stepChanges(trash, { collectionNamed: named }), permission).toEqual([
        { collection: items.key, actions: [{ action: "remove", mode: permission }] },
      ]);
      expect(consentOf(trash, items.key, "remove")).toBe(permission);
      const upsert = colStep("upsert", permission).build().steps[1] as Step;
      expect(consentOf(upsert, items.key, "create")).toBe(permission);
      expect(consentOf(upsert, items.key, "update")).toBe(permission);
    }
  });
  it("AU-187 · the value each action is born with is one constant of the catalogue, written into the step by the code when the user's hand adds it (`bornParams`): «Preguntar» on remove and «Sí» on create and update; one that arrives any other way has «Preguntar» on the three, written", () => {
    expect(PERMISSION_BORN).toEqual({ create: "yes", update: "yes", upsert: "yes", trash: "ask" });
    for (const [action, born] of Object.entries(PERMISSION_BORN))
      expect(bornParams("collection", action), action).toEqual({ [PERMISSION]: born });
    // Nothing for a reading action or another type: every other parameter is its default (AU-87).
    expect(bornParams("collection", "find")).toEqual({});
    expect(bornParams(CODE_TYPE, undefined)).toEqual({});
    const s = sketch(320).step("Inicio", "manual");
    for (const action of ["create", "update", "trash"])
      s.step(action, "collection", { collection: items.key, [ACTION]: action });
    const byHand = s.build();
    expect(byHand.steps.slice(1).map(permissionOf)).toEqual(["yes", "yes", "ask"]);
    // Arriving any other way (a proposal, a package, the MCP): through `lowerYes`, «Preguntar» on all three.
    expect(lowerYes(byHand).steps.slice(1).map(permissionOf)).toEqual(["ask", "ask", "ask"]);
    // A step that arrives without the parameter gets «Preguntar» written, not left to be read.
    const bare = structuredClone(byHand);
    for (const st of bare.steps.slice(1)) delete st.params[PERMISSION];
    expect(
      lowerYes(bare)
        .steps.slice(1)
        .map((st) => st.params[PERMISSION]),
    ).toEqual(["ask", "ask", "ask"]);
  });
});

describe("a «Sí» only from the user's hand (F14d)", () => {
  /** A «Código» with a connection of every cell, and a «Colección» trash step, as a document arrives. */
  const arriving = (connection: Connection, permission: "yes" | "ask" = "yes"): Automation => {
    const s = sketch(330)
      .step("Inicio", "manual")
      .step("Código", CODE_TYPE, { source: SOURCE, mode: "all" })
      .step("Quitar", "collection", {
        collection: items.key,
        [ACTION]: "trash",
        target: "matching",
        where: OPEN,
        [PERMISSION]: permission,
      })
      .arrow("Inicio", "Código")
      .arrow("Código", "Quitar");
    const a = s.build();
    (a.steps[1] as Step).connections = [connection];
    return a;
  };
  const modes = (a: Automation) => ({
    code: (a.steps[1] as Step).connections?.map((c) => [
      c.create && c.create.mode,
      c.update && c.update.mode,
      c.remove && c.remove.mode,
    ]),
    col: permissionOf(a.steps[2] as Step),
  });
  it("AU-188 · `lowerYes` lowers every «Sí» of a document that arrives without the user having written it to «Preguntar»: create, update and remove of each connection, and the «Permiso» of the three write actions of a «Colección» step", () => {
    const a = arriving(cells({ create: YES, update: YES, remove: YES }));
    expect(modes(lowerYes(a))).toEqual({ code: [["ask", "ask", "ask"]], col: "ask" });
    // Not in place: the document given is as it was.
    expect(modes(a)).toEqual({ code: [["yes", "yes", "yes"]], col: "yes" });
  });
  it("AU-188 · with the draft it replaces, a «Sí» that draft already had for the same step, collection and action stays when the step arrives unchanged; one on another collection, another action or a new step is lowered", () => {
    const current = arriving(cells({ create: ASK, update: YES, remove: false }));
    expect(lowerYes(current, current)).toBe(current);
    // The same «Código» with one more «Sí» (another action): the step changed, so all its «Sí» go down.
    const more = arriving(cells({ create: YES, update: YES, remove: false }));
    expect(modes(lowerYes(more, current)).code).toEqual([["ask", "ask", false]]);
    // A new step, with an id the draft did not have.
    const fresh = structuredClone(current);
    (fresh.steps[2] as Step).id = "s_ejemplonuevo";
    fresh.arrows = fresh.arrows.map((r) =>
      r.to.step === current.steps[2]?.id ? { ...r, to: { ...r.to, step: "s_ejemplonuevo" } } : r,
    );
    expect(modes(lowerYes(fresh, current))).toEqual({ code: [["ask", "yes", false]], col: "ask" });
  });
  it("AU-188 · a «Sí» of a step whose code, parameters, connection or incoming arrows the arrival changed is lowered: a «Sí» given to one code does not pass to another", () => {
    const current = arriving(cells({ create: YES, update: YES, remove: YES }));
    const code = structuredClone(current);
    (code.steps[1] as Step).params.source = `${SOURCE}\n// otra`;
    expect(modes(lowerYes(code, current)).code).toEqual([["ask", "ask", "ask"]]);
    const where = structuredClone(current);
    (where.steps[2] as Step).params.where = [{ field: amount, op: "is", value: 1 }];
    expect(modes(lowerYes(where, current)).col).toBe("ask");
    // Its rows come now from elsewhere: the «Sí» of the trash goes down, the code's stays.
    const rewired = structuredClone(current);
    rewired.arrows = rewired.arrows.map((r) =>
      r.to.step === current.steps[2]?.id
        ? { ...r, from: { ...r.from, step: current.steps[0]?.id as string } }
        : r,
    );
    expect(modes(lowerYes(rewired, current))).toEqual({
      code: [["yes", "yes", "yes"]],
      col: "ask",
    });
  });
  it("AU-188 · decision 18 · a fixed value of modify that the arrival adds or changes lowers the step's «Sí», as one of create does; the same fixed values keep it", () => {
    const current = arriving(
      cells({
        create: { ...YES, fixed: { [note]: "nueva" } },
        update: { ...YES, fixed: { [note]: "revisada" } },
      }),
    );
    expect(lowerYes(structuredClone(current), current)).toEqual(current);
    for (const fixed of [{ [note]: "otra" }, { [note]: "revisada", [amount]: 1 }]) {
      const changed = structuredClone(current);
      const c = (changed.steps[1] as Step).connections?.[0];
      if (c?.update) c.update.fixed = fixed;
      expect(modes(lowerYes(changed, current)).code, JSON.stringify(fixed)).toEqual([
        ["ask", "ask", false],
      ]);
    }
    // Arriving with no draft, its fixed values stay as they came: only the «Sí» goes down.
    const lowered = lowerYes(current);
    expect((lowered.steps[1] as Step).connections?.[0]?.update).toEqual({
      mode: "ask",
      fixed: { [note]: "revisada" },
    });
  });
  it("AU-188 · `lowerYes` changes nothing else: «No» and «Preguntar» stay, reading stays, and a document with no «Sí» comes back equal", () => {
    const a = arriving(
      {
        ...cells({ create: false, update: ASK, remove: YES }),
        read: { rows: [{ field: note, op: "is", value: "abierto" }] },
      } as Connection,
      "ask",
    );
    const lowered = lowerYes(a);
    expect((lowered.steps[1] as Step).connections?.[0]).toEqual({
      ...(a.steps[1] as Step).connections?.[0],
      remove: ASK,
    });
    expect({ ...lowered, steps: lowered.steps.map((s, i) => (i === 1 ? a.steps[1] : s)) }).toEqual(
      a,
    );
    const none = arriving(cells({ create: ASK, update: false, remove: ASK }), "ask");
    expect(lowerYes(none)).toBe(none);
  });
});

describe("what is asked keeps where it came from (F14d)", () => {
  it("AU-170 · each change a run asks about (`Asked`) carries its values with the label of each, the same the engine gives a change it saves: a value from outside is asked as from outside", async () => {
    // A «Código» whose evaluation received something from outside: its values carry it (AU-169).
    const st = db();
    const [a] = idsIn(st) as [string];
    const out = await applyWrites(
      input([update(a, { [amount]: 4 })], [cells({ update: ASK })], { labels: [OUTSIDE] }),
      gateOf(st),
    );
    const asked = out.kind === "asked" ? out.asked : [];
    expect(asked[0]?.values[amount]).toMatchObject({ value: 4, derived: true });
    expect(asked[0]?.values[amount]?.label.integrity).toBe(OUTSIDE.integrity);
    // A «Colección» step: a field from the row that arrives keeps that row's label; a fixed one is the automation's.
    const s = sketch(340)
      .step("Inicio", "manual", { fields: [{ key: "nota", name: "Nota", type: "text" }] })
      .step("Crear", "collection", {
        collection: items.key,
        [ACTION]: "create",
        fields: [
          { field: amount, value: 1 },
          { field: note, value: { expr: "{{ $json.nota }}" } },
        ],
        [PERMISSION]: "ask",
      })
      .arrow("Inicio", "Crear");
    const st2 = db(0);
    const doc = s.build();
    expect(actionOf(doc.steps[1] as Step)?.key).toBe("create");
    const e = await start(
      doc,
      s.id("Inicio"),
      { nota: "de fuera" },
      { collections: st2 },
      {
        nota: { label: OUTSIDE, derived: false },
      },
    );
    expect(e.asked).toHaveLength(1);
    expect(e.asked[0]?.values[note]?.label.integrity).toBe(OUTSIDE.integrity);
    expect(e.asked[0]?.values[amount]?.label.integrity).not.toBe(OUTSIDE.integrity);
    expect(st2.applied).toEqual([]);
  });
});
