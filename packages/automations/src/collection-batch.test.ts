// A «Colección» step's change of many rows for one unit (task 137, AU-17, AU-174): the policy is asked for each row
// as one write at a time asks it, before any is written; then the rows it allows are saved in one transaction, all or
// nothing, and a unit stopped partway leaves what earlier units saved (decision 14).
import { describe, expect, it } from "vitest";
import { cite, collection, ids, sketch } from "./automation.test-util.ts";
import { PERMISSION } from "./catalogue.ts";
import type { Collections, Decision, PolicyCall } from "./effects.ts";
import { guard } from "./effects.ts";
import type { Execution } from "./engine.ts";
import { ACTION, MAIN } from "./format.ts";
import { OWN, policy, start, store } from "./run.test-util.ts";

const next = ids(137);
const items = collection(next, ["text", "number"]);
const groups = collection(next, ["text"]);
const [note, amount] = items.fields.map((f) => f.key) as [string, string];
const [tag] = groups.fields.map((f) => f.key) as [string];
const OPEN = [{ field: note, op: "is", value: "abierto" }];

/** Three open rows, and two more of each tag for the steps that run once per arriving row. */
const db = () =>
  store(
    [items, groups],
    {
      [items.key]: [
        ...[0, 1, 2].map((i) => ({ [note]: "abierto", [amount]: i })),
        ...["a", "a", "b", "b"].map((t, i) => ({ [note]: t, [amount]: 10 + i })),
      ],
      [groups.key]: [{ [tag]: "a" }, { [tag]: "b" }],
    },
    ids(1370),
  );

/** The store, noting each transaction it is asked for (how many changes) and when, among the policy's calls. */
function noted(st: ReturnType<typeof db>, log: string[], over: Partial<Collections> = {}) {
  const batches: number[] = [];
  const collections: Collections = {
    ...st,
    apply: (c, v) => {
      log.push("apply");
      return st.apply(c, v);
    },
    applyAll: (cs) => {
      log.push(`applyAll:${cs.length}`);
      batches.push(cs.length);
      return (over.applyAll ?? st.applyAll)(cs);
    },
  };
  return { collections, batches };
}
const logged = (log: string[], decide?: (c: PolicyCall) => Decision) =>
  policy((c) => {
    log.push(`decide:${c.effect}`);
    return decide?.(c) ?? { kind: "allow", rule: "test.allow" };
  });

/** «Modificar filas» or «Eliminar filas» over «Las que cumplan…»: every open row, with «Permiso: Sí». */
function matching(action: "update" | "trash", more: Record<string, unknown> = {}) {
  return sketch(137)
    .step("Inicio", "manual")
    .step("Guardar", "collection", {
      collection: items.key,
      [ACTION]: action,
      [PERMISSION]: "yes",
      target: "matching",
      where: OPEN,
      ...(action === "update" ? { fields: [{ field: amount, value: 5 }] } : {}),
      ...more,
    })
    .arrow("Inicio", "Guardar");
}
const writesOf = (calls: PolicyCall[]) => calls.filter((c) => c.effect === "write");
const amounts = (st: ReturnType<typeof db>) =>
  st.rows(items.key).map((r) => [r.json[note], r.json[amount]]);
const failureOf = (e: Execution) => e.error?.failure;

describe("a step's change of many rows (task 137)", () => {
  it("AU-17 · AU-174 · «Las que cumplan…» asks the policy for every row before any is written, with exactly the call a write of one row makes, then saves them in one transaction", async () => {
    for (const action of ["update", "trash"] as const) {
      const log: string[] = [];
      const st = db();
      const { collections, batches } = noted(st, log);
      const p = logged(log);
      const s = matching(action);
      const e = await start(s.build(), s.id("Inicio"), {}, { collections, policy: p });
      expect(e.state, action).toBe("done");
      // The search, the three asked, then one transaction of three.
      expect(log, action).toEqual([
        "decide:read",
        "decide:write",
        "decide:write",
        "decide:write",
        "applyAll:3",
      ]);
      expect(batches, action).toEqual([3]);
      expect(e.steps[s.id("Guardar")]?.out[MAIN], action).toHaveLength(3);
      // The call of each row is the one the gate's `write` makes for the same change of the same unit: the same
      // action, destroys, rows, values and label of the path, and no `row` nor `written` (only an «Agente»'s carry
      // them). The engine's unit for this step, as `Run.gate` builds it.
      const writes = writesOf(p.calls);
      expect(writes, action).toHaveLength(3);
      for (const c of writes) {
        const one = policy();
        const refuse: Collections = {
          ...st,
          apply: () => Promise.reject(new Error("not written")),
        };
        const g = guard(one, refuse, {
          automation: c.automation,
          step: s.id("Guardar"),
          type: "collection",
          action,
          effect: "write",
          destroys: action === "trash",
          control: c.control,
          test: false,
          own: OWN,
        });
        const row = { collection: items.key, id: "o_ejemplo", version: 1 };
        await expect(
          g.write(
            action === "update"
              ? { kind: "update", row, fields: { [amount]: 5 } }
              : { kind: "trash", row },
            c.values,
          ),
        ).rejects.toThrow("not written");
        expect(c, action).toEqual(one.calls[0]);
        expect(c, action).not.toHaveProperty("row");
        expect(c, action).not.toHaveProperty("written");
      }
    }
  });

  it("AU-174 · a row of the change the policy refuses, or one that changed since it was read, leaves none of the change written", async () => {
    // Refused: the third row. The first two were asked and allowed, and are not saved either.
    {
      const log: string[] = [];
      const st = db();
      const before = amounts(st);
      let n = 0;
      const p = logged(log, (c) =>
        c.effect === "write" && ++n === 3
          ? { kind: "deny", rule: "test.deny", reason: "no" }
          : { kind: "allow", rule: "test.allow" },
      );
      const { collections } = noted(st, log);
      const s = matching("update");
      const e = await start(s.build(), s.id("Inicio"), {}, { collections, policy: p });
      expect(e.state).toBe("failed");
      expect(writesOf(p.calls)).toHaveLength(3);
      expect(log.filter((l) => l.startsWith("apply"))).toEqual([]);
      expect(st.applied).toEqual([]);
      expect(amounts(st)).toEqual(before);
    }
    // Changed: the store refuses the second row of the transaction, and takes back the first.
    {
      const log: string[] = [];
      const st = db();
      const before = amounts(st);
      const { collections } = noted(st, log, {
        applyAll: (cs) =>
          st.applyAll(
            cs.map((c, i) =>
              i === 1 && c.change.kind === "update"
                ? { ...c, change: { ...c.change, row: { ...c.change.row, version: 99 } } }
                : c,
            ),
          ),
      });
      const s = matching("update");
      const e = await start(s.build(), s.id("Inicio"), {}, { collections, policy: logged(log) });
      expect(e.state).toBe("failed");
      expect(failureOf(e)).toMatchObject({ code: "row.changed" });
      expect(st.applied).toEqual([]);
      expect(amounts(st)).toEqual(before);
    }
  });

  it("AU-174 · the rows the policy would ask Juan about wait for him, the rest of the change is saved in one transaction, in order; with «Permiso: Preguntar» all of them wait", async () => {
    {
      const log: string[] = [];
      const st = db();
      let n = 0;
      const p = logged(log, (c) =>
        c.effect === "write" && ++n === 2
          ? { kind: "propose", rule: "test.propose" }
          : { kind: "allow", rule: "test.allow" },
      );
      const { collections, batches } = noted(st, log);
      const s = matching("update");
      const e = await start(s.build(), s.id("Inicio"), {}, { collections, policy: p });
      expect(e.state).toBe("done");
      expect(batches).toEqual([2]);
      expect(e.asked).toHaveLength(1);
      expect(e.asked[0]).toMatchObject({ kind: "propose", rule: "test.propose" });
      const [first, , third] = st.rows(items.key);
      const proposed = e.asked[0]?.change;
      expect(proposed?.kind === "update" && proposed.row.id).not.toBe(first?.origin.id);
      expect([first?.json[amount], third?.json[amount]]).toEqual([5, 5]);
      expect(e.steps[s.id("Guardar")]?.out[MAIN]?.map((r) => r.origin?.id)).toEqual([
        first?.origin.id,
        third?.origin.id,
      ]);
    }
    {
      const log: string[] = [];
      const st = db();
      const { collections } = noted(st, log);
      const p = logged(log);
      const s = matching("trash", { [PERMISSION]: "ask" });
      const e = await start(s.build(), s.id("Inicio"), {}, { collections, policy: p });
      expect(e.state).toBe("done");
      expect(writesOf(p.calls)).toHaveLength(3);
      expect(e.asked.map((a) => a.kind)).toEqual(["confirm", "confirm", "confirm"]);
      expect(st.applied).toEqual([]);
    }
  });

  it("AU-17 · a change that would pass «rows written» asks the policy nothing and writes nothing", async () => {
    const log: string[] = [];
    const st = db();
    const { collections } = noted(st, log);
    const p = logged(log);
    const s = matching("update");
    const a = s.build();
    a.settings = { limits: { rowsWritten: 2 } };
    const e = await start(a, s.id("Inicio"), {}, { collections, policy: p });
    expect(e.state).toBe("failed");
    expect(failureOf(e)).toEqual({
      code: "run.limit",
      detail: { limit: "rowsWritten", max: 2, got: 3 },
    });
    expect(writesOf(p.calls)).toEqual([]);
    expect(st.applied).toEqual([]);
  });

  it("AU-174 · one transaction per unit: a run stopped at the second arriving row keeps what the first one saved (decision 14)", async () => {
    const log: string[] = [];
    const st = db();
    let n = 0;
    // The fourth write asked is the second row of the second unit.
    const p = logged(log, (c) =>
      c.effect === "write" && ++n === 4
        ? { kind: "deny", rule: "test.deny", reason: "no" }
        : { kind: "allow", rule: "test.allow" },
    );
    const { collections, batches } = noted(st, log);
    const s = sketch(138)
      .step("Inicio", "manual")
      .step("Grupos", "collection", {
        collection: groups.key,
        [ACTION]: "find",
        where: [],
        sort: [{ field: tag, direction: "asc" }],
        limit: 10,
      })
      .step("Guardar", "collection", {
        collection: items.key,
        [ACTION]: "update",
        [PERMISSION]: "yes",
        target: "matching",
        where: [{ field: note, op: "is", value: cite(`$json.${tag}`) }],
        fields: [{ field: amount, value: 5 }],
      })
      .arrow("Inicio", "Grupos")
      .arrow("Grupos", "Guardar");
    const e = await start(s.build(), s.id("Inicio"), {}, { collections, policy: p });
    expect(e.state).toBe("failed");
    expect(batches).toEqual([2]);
    expect(
      st
        .rows(items.key)
        .filter((r) => r.json[note] !== "abierto")
        .map((r) => [r.json[note], r.json[amount]]),
    ).toEqual([
      ["a", 5],
      ["a", 5],
      ["b", 12],
      ["b", 13],
    ]);
  });
});
