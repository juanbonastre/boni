// Boni's own automations on the new engine (docs/automatizaciones.md §5.9, §5.10 and §5.15, phase F16): the four it
// ships as automations «De: Boni» with their versions, their triggers fired through the same path as any other, the
// pieces behind the port, and the reviewer that needs a model (AU-127, AU-211, AU-220, AU-221).
//
// Pending: the phase's first PR brings one test per rule and its builders make each real, the rule's id kept in its
// name (`make check` reads them, T-10). They will run the real server with a store per test, invented mail and a
// scripted model, and a year of mail for the times (A-15: 11,000 runs, their clock from `@boni/pace`).
import { type Agent, leaf } from "@boni/agent";
import type { BoniCall } from "@boni/automations";
import { afterEach, describe, expect, it } from "vitest";
import { BoniFault, boniPortFor, unitPlan, wireBoni } from "./boni.ts";
import { folder, OUTSIDE } from "./run.test-util.ts";

const f = folder("boni");
afterEach(() => wireBoni(null));

const HAND = {
  integrity: "user",
  sensitivity: "personal",
  thirdParty: false,
  sources: [],
} as const;
const cell = (value: BoniCall["args"][string]["value"], label = HAND) => ({
  value,
  label,
  derived: false,
});
const call = (o: Partial<BoniCall>): BoniCall => ({
  automation: "a-ejemplo",
  step: "s1",
  type: "boni.action",
  name: "otra.accion",
  values: {},
  args: {},
  row: null,
  test: false,
  ...o,
});

describe("Boni's own automations (F16)", () => {
  it.todo(
    "AU-221 · the four that were flows are automations with Boni as the author of its versions; the person's changes are their own versions, «Volver al de Boni» publishes Boni's last one, and none can be deleted",
  );
  it.todo(
    "AU-221 · the version of Boni's that ships with the phase is drawn by hand in the new format and, on invented mail, asks for the same as the old flow did",
  );
  it.todo(
    "AU-221 · a deploy with a new version of Boni's runs it only where Boni's was running; over the person's own it waits in «Versiones»",
  );
  it.todo(
    "AU-220 · each of Boni's triggers starts its run through the published path and none through the old scheduler; a look at the mailbox with no mail is not a run, the review runs once a day at most and the spending notice once a month",
  );
  it.todo(
    "AU-220 · with a year of mail, starting a run, listing them and pruning them stay within their times",
  );
  it.todo(
    "AU-127 · the mail automation, converted, reads an invented mail and proposes what the old flow proposed, with the same cards; its caps cannot be changed from a step",
  );
  it.todo(
    "AU-211 · the reviewer of an «Agente» is an automation of Boni of its own, with its switch; it starts from decisions made by hand on that step's proposals, measures its change dry on up to 20 of those cases, and suggests a draft change at most once a day, never a published one",
  );
  it.todo(
    "AU-211 · with «Aprender» off, or its automation off, the reviewer suggests nothing; the signals, the counts and the pause stay where F15 put them",
  );
});

describe("the port of Boni's code on the server (F16 S1)", () => {
  it("AU-230 · S1: a unit is one plan of one step whose arguments code binds as $x0, $x1… with their labels; a key of the document is never a name of the plan, and a reader reads its input", () => {
    const u = unitPlan(
      call({
        args: { $texto: cell("de ejemplo", OUTSIDE as never), b: cell(2) },
        values: { why: cell("porque sí") },
      }),
    );
    expect(u.plan).toEqual({
      version: 1,
      steps: [
        {
          id: "a",
          op: "call",
          tool: "otra.accion",
          args: { $texto: { ref: "$x0" }, b: { ref: "$x1" } },
          why: { ref: "$why" },
        },
      ],
    });
    expect(u.bind.x0?.label).toEqual(OUTSIDE);
    expect(Object.keys(u.bind).sort()).toEqual(["why", "x0", "x1"]);
    const r = unitPlan(
      call({
        name: "classify",
        values: { input: cell("un texto") },
        args: { options: cell(["a", "b"]) },
      }),
    );
    expect((r.plan as { steps: unknown[] }).steps[0]).toMatchObject({
      op: "read",
      reader: "classify",
      input: { ref: "$input" },
    });
  });

  it("AU-230 · S1: the port answers with the label of what Boni's code made, fails with its code when the agent stops, and is null with no agent wired, so a Boni step does not validate", async () => {
    const store = f.store();
    try {
      expect(boniPortFor(store, "a-ejemplo")).toBeNull();
      let answer: Awaited<ReturnType<Agent["boniCall"]>> = {
        status: "done",
        error: null,
        value: leaf("respuesta", OUTSIDE),
        proposals: [],
        would: [],
      };
      const agent = { boniCall: async () => answer } as unknown as Agent;
      wireBoni({ reaches: () => true, agentOf: () => agent });
      const port = boniPortFor(store, "a-ejemplo");
      expect(port?.automation).toBeUndefined();
      expect(await port?.run(call({}))).toEqual({ value: "respuesta", label: OUTSIDE });
      answer = { ...answer, status: "stopped", error: "R3-kept-from-models", value: null };
      await expect(port?.run(call({}))).rejects.toBeInstanceOf(BoniFault);
    } finally {
      store.close();
      f.done();
    }
  });
});
