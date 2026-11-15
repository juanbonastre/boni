// Why a step failed, as a key (docs/automatizaciones.md AU-67, AU-84). Real tests use the fakes of run.test-util.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cite, collection, ids, sketch } from "./automation.test-util.ts";
import type { Collections, Decision } from "./effects.ts";
import type { Execution } from "./engine.ts";
import { run } from "./engine.ts";
import { STEP_FAILURES, type StepFailure } from "./failures.ts";
import { deps, OWN, policy, store } from "./run.test-util.ts";

const next = ids(20);
const items = collection(next, ["text", "number"]);
const [name, n] = items.fields.map((f) => f.key) as [string, string];
const rows = () =>
  store([items], { [items.key]: [1, 2].map((v) => ({ [name]: "igual", [n]: v })) }, next);

/** «Inicio» → the step, run (a test when `test`), with these collections and this policy. */
async function failing(
  params: Record<string, unknown>,
  type: string,
  over: {
    collections?: Collections;
    decide?: (k: "read" | "write") => Decision;
    test?: boolean;
    before?: boolean;
  } = {},
): Promise<StepFailure | undefined> {
  let s = sketch(20).step("Inicio", "manual");
  if (over.before)
    s = s
      .step("Lista", "edit", { fields: [{ field: "n", value: [] }] })
      .step("Partir", "split", { field: "n" }, { continueEmpty: true })
      .arrow("Inicio", "Lista")
      .arrow("Lista", "Partir");
  s = s.step("Paso", type, params as never).arrow(over.before ? "Partir" : "Inicio", "Paso");
  const e: Execution = await run(
    {
      automation: s.build(),
      trigger: s.id("Inicio"),
      fields: { json: {}, label: OWN },
      test: over.test ?? false,
    },
    deps({
      collections: over.collections ?? rows(),
      policy: policy((call) => over.decide?.(call.effect) ?? { kind: "allow", rule: "test.allow" }),
    }),
  );
  expect(e.state).toBe("failed");
  return e.error?.failure;
}

describe("a step's failure", () => {
  it("AU-84 · every failure of a step of the catalogue carries a code of STEP_FAILURES, and the parameter at fault when it is one parameter's: a citation that gives no value names the parameter it is written in", async () => {
    const create = (value: unknown) => ({
      collection: items.key,
      action: "create",
      fields: [{ field: name, value }],
    });
    const cases: [string, Promise<StepFailure | undefined>, StepFailure][] = [
      [
        "no current row",
        failing(create(cite("$json.n")), "collection", { before: true }),
        { code: "cite.noCurrentRow", param: "fields.0.value" },
      ],
      [
        "no rows",
        failing(create(cite("$('Partir').first().n")), "collection", { before: true }),
        { code: "cite.noRows", param: "fields.0.value", detail: { step: "Partir" } },
      ],
      [
        "no such row",
        failing({ collection: items.key, action: "get", row: "o_ejemplo" }, "collection"),
        { code: "row.missing", param: "row", detail: { collection: items.key } },
      ],
      [
        "several match",
        failing(
          {
            collection: items.key,
            action: "upsert",
            fields: [{ field: name, value: "igual" }],
            match: [{ field: name }],
          },
          "collection",
        ),
        { code: "row.many", param: "match", detail: { count: 2 } },
      ],
    ];
    for (const [what, got, want] of cases) {
      const failure = await got;
      expect(failure, what).toEqual(want);
      expect(STEP_FAILURES).toContain(failure?.code);
    }

    // No executor throws a failure without its code: every throw in them is a `StepFault` (or «Parar con error»).
    for (const file of ["steps.ts", "collection.ts", "effects.ts"]) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(source.match(/throw new Error\(/g) ?? [], file).toEqual([]);
    }
  });

  it("AU-67 · a refusal of the policy fails the step with its rule, a row that changed since it was read says so, and «Parar con error» carries what Juan wrote; none of them is said only in English", async () => {
    const find = { collection: items.key, action: "find" };
    expect(
      await failing(find, "collection", {
        decide: () => ({ kind: "deny", rule: "regla.ejemplo", reason: "no" }),
      }),
    ).toEqual({ code: "policy.denied" });
    expect(
      await failing(find, "collection", {
        decide: () => ({ kind: "confirm", rule: "regla.ejemplo" }),
      }),
    ).toEqual({
      code: "policy.waits",
    });

    // A row read, then changed before the write would be done: the test says so, as a run would.
    const db = rows();
    const older: Collections = {
      ...db,
      get: async (c, id) => {
        const r = await db.get(c, id);
        return r && { ...r, origin: { ...r.origin, version: r.origin.version + 1 } };
      },
    };
    let s = sketch(21)
      .step("Inicio", "manual")
      .step("Buscar", "collection", find)
      .step("Modificar", "collection", {
        collection: items.key,
        action: "update",
        fields: [{ field: name, value: "nuevo" }],
      })
      .arrow("Inicio", "Buscar")
      .arrow("Buscar", "Modificar");
    const changed = await run(
      {
        automation: s.build(),
        trigger: s.id("Inicio"),
        fields: { json: {}, label: OWN },
        test: true,
      },
      deps({ collections: older }),
    );
    expect(changed.error?.failure).toEqual({ code: "row.changed" });
    expect(changed.error?.step).toBe(s.id("Modificar"));

    s = sketch(22)
      .step("Inicio", "manual")
      .step("Basta", "stop", { message: "Falta la categoría" })
      .arrow("Inicio", "Basta");
    const stopped = await run(
      {
        automation: s.build(),
        trigger: s.id("Inicio"),
        fields: { json: {}, label: OWN },
        test: false,
      },
      deps(),
    );
    expect(stopped.error?.failure).toEqual({
      code: "stopped",
      detail: { message: "Falta la categoría" },
    });
    // The rule of the policy stays where the log reads it.
    s = sketch(23)
      .step("Inicio", "manual")
      .step("Buscar", "collection", find)
      .arrow("Inicio", "Buscar");
    const denied = await run(
      {
        automation: s.build(),
        trigger: s.id("Inicio"),
        fields: { json: {}, label: OWN },
        test: false,
      },
      deps({
        collections: rows(),
        policy: policy(() => ({ kind: "deny", rule: "regla.ejemplo", reason: "no" })),
      }),
    );
    expect(denied.error).toMatchObject({
      rule: "regla.ejemplo",
      failure: { code: "policy.denied" },
    });
  });
});
