// The security floor across F16 (docs/automatizaciones.md §6, phase F16): moving the saved flows, Boni's own and the
// conversation's turn to the new engine changes who interprets, never who decides (AU-230, with AU-143's turn).
//
// Here, E1's part: every way a cell of a translated automation could come to say «Sí» (the plan's arguments, a
// piece's arguments, a turn's plan, a copy of Boni's, an earlier version), covered; a converted flow's run proposes
// what it writes; what Boni's code answers keeps its label from outside. Pending, with the server's ports (S1): one
// test per row of AU-230's table, as `automation-origin.test.ts` does for P28, the same plans run in both engines and
// every call to `decide`, with its answer, compared.

import {
  type Automation,
  BONI_PIECES,
  cellsOfStep,
  isBoniType,
  lowerYes,
  run,
  writeCells,
} from "@boni/automations";
import { label } from "@boni/entities";
import { describe, expect, it } from "vitest";
import { clock, dates, OUTSIDE, policy, store } from "../../automations/src/run.test-util.ts";
import { planToAutomation } from "../src/convert.ts";
import type { Plan } from "../src/plan.ts";
import {
  boniPort,
  jsBox,
  NOTE_TEXT,
  NOTE_TITLE,
  NOTES,
  next,
  TASK_TITLE,
  TASKS,
  values,
} from "./convert.test-util.ts";

const lit = (v: unknown) => ({ lit: v });
const ref = (r: string) => ({ ref: r });
const fn = (name: string, ...args: unknown[]) => ({ fn: name, args });
const plan = (...steps: unknown[]) => ({ version: 1, steps }) as Plan;
const OWN = label("user", "personal", [{ kind: "flow", id: "e_ejemplo" }]);

/** The plan of a flow that creates a note: its versions, each a little different, as a user edits one. */
const versions: Plan[] = [
  plan({
    id: "c",
    op: "call",
    tool: "entities.create",
    args: { type: lit(NOTES.key), values: fn("obj", lit(NOTE_TITLE), lit("Nota de ejemplo")) },
  }),
  plan(
    { id: "q", op: "call", tool: "entities.query", args: { type: lit(TASKS.key) } },
    {
      id: "c",
      op: "call",
      tool: "entities.create",
      each: ref("$q"),
      // What a model or a pasted plan could try: a permission among the arguments.
      args: {
        type: lit(NOTES.key),
        values: fn("obj", lit(NOTE_TITLE), ref(`$item.${TASK_TITLE}`)),
        permission: lit("yes"),
      },
    },
  ),
  plan(
    {
      id: "w",
      op: "call",
      tool: "otra.accion",
      args: { permission: lit("yes"), texto: lit("yes") },
    },
    {
      id: "c",
      op: "call",
      tool: "entities.create",
      args: {
        type: lit(NOTES.key),
        values: fn("obj", lit(NOTE_TITLE), lit("yes"), lit("permission"), lit("yes")),
      },
    },
  ),
];

/** Every place of a document a «Sí» could hide in: a permission, and every write cell. */
function yeses(a: Automation): string[] {
  const out: string[] = [];
  for (const s of a.steps) {
    if (s.params.permission !== undefined && s.params.permission !== "ask")
      out.push(`${s.id}.permission`);
    for (const c of cellsOfStep(s))
      if (c.mode !== "ask") out.push(`${s.id}:${c.collection}:${c.action}`);
    for (const c of s.connections ?? [])
      for (const v of Object.values(c))
        if (v && typeof v === "object" && "mode" in v && v.mode !== "ask")
          out.push(`${s.id}.connection`);
  }
  return out;
}

describe("the policy for what came from before (F16)", () => {
  it("AU-230 · a converted flow that writes is born with «Preguntar» in every write cell, in each of its versions, and its run proposes", async () => {
    for (const [i, p] of versions.entries())
      for (const trigger of [{ manual: true }, { schedule: { every: "day" } }, undefined])
        for (const from of ["flow", "turn"] as const) {
          const c = planToAutomation({
            id: "e_flujo_ejemplo",
            name: `Versión ${i + 1}`,
            plan: p,
            trigger,
            from,
          });
          const a = c.automation;
          expect(writeCells(a).length, `version ${i + 1}`).toBeGreaterThan(0);
          expect(yeses(a), `version ${i + 1}`).toEqual([]);
          // Lowering it changes nothing: there was nothing to lower.
          expect(lowerYes(a)).toEqual(a);
          // A permission of the plan's arguments is said as what has no place, never a parameter.
          if (i === 1)
            expect(c.untranslated).toContainEqual({
              step: "c",
              what: "tool:entities.create.permission",
              reason: "notExpressible",
            });
        }
    // Its run proposes, by Juan's hand as well: nothing is saved.
    const a = planToAutomation({
      id: "e_flujo_ejemplo",
      name: "Notas",
      plan: versions[1] as Plan,
      trigger: { manual: true },
      from: "flow",
    }).automation;
    const s = store(
      [TASKS, NOTES],
      {
        [TASKS.key]: [
          { [TASK_TITLE]: "Tarea de ejemplo 1" },
          { [TASK_TITLE]: "Tarea de ejemplo 2" },
        ],
      },
      next,
    );
    const e = await run(
      { automation: a, trigger: "trigger", fields: { json: {}, label: OWN }, test: false },
      {
        policy: policy(),
        collections: s,
        clock: clock(),
        dates,
        own: OWN,
        locale: "es",
        box: jsBox(),
      },
    );
    expect(e.state).toBe("done");
    expect(s.applied).toEqual([]);
    expect(e.asked.map((x) => [x.kind, x.values[NOTE_TITLE]?.value])).toEqual([
      ["propose", "Tarea de ejemplo 1"],
      ["propose", "Tarea de ejemplo 2"],
    ]);
  });

  it("AU-230 · no conversion reaches a «Sí»: not from a piece's arguments, «Acción de Boni», «Lector de Boni» or a copy of Boni's, and what Boni's code answers keeps its label from outside", async () => {
    // Boni's steps have no cells: what they write is decided by the server's port, with the background's origin.
    for (const owner of ["readMail", "reviewGuide", "fetchMail", "budgetNotice"] as const)
      for (const p of BONI_PIECES.filter((x) => x.owner === owner)) {
        const step =
          p.old === "entities.create"
            ? {
                id: "x",
                op: "call",
                tool: p.old,
                args: {
                  type: p.params.length
                    ? lit(NOTES.key)
                    : fn("case", lit("a"), lit("a"), lit(NOTES.key)),
                  values: fn("obj", lit(NOTE_TITLE), lit("yes")),
                  permission: lit("yes"),
                },
              }
            : ["read_message", "review_reading", "classify", "fill"].includes(p.old)
              ? {
                  id: "x",
                  op: "read",
                  reader: p.old,
                  input: lit("yes"),
                  params: { permission: lit("yes") },
                }
              : { id: "x", op: "call", tool: p.old, args: { permission: lit("yes") } };
        const c = planToAutomation({
          id: "e_boni",
          name: owner,
          plan: plan(step),
          trigger: undefined,
          from: "flow",
          boni: owner,
          decides: [NOTES.key],
        });
        const x = c.automation.steps.find((s) => s.id === "p-x");
        expect(x && isBoniType(x.type), p.type).toBe(true);
        expect(cellsOfStep(x as never), p.type).toEqual([]);
        expect(yeses(c.automation), p.type).toEqual([]);
        // The «yes» it was given is an argument, data for Boni's code: never a parameter of permission.
        expect(x?.params.permission, p.type).toBeUndefined();
      }
    // «Acción de Boni» and «Lector de Boni», in any automation.
    const c = planToAutomation({
      id: "e_flujo_ejemplo",
      name: "Con Boni",
      plan: plan(
        {
          id: "w",
          op: "call",
          tool: "otra.accion",
          args: { permission: lit("yes") },
          why: lit("Para el ejemplo"),
        },
        { id: "r", op: "read", reader: "answer_about", input: ref("$w.texto") },
        {
          id: "c",
          op: "call",
          tool: "entities.create",
          args: {
            type: lit(NOTES.key),
            values: fn("obj", lit(NOTE_TITLE), ref("$w.texto"), lit(NOTE_TEXT), ref("$r")),
          },
        },
      ),
      trigger: { manual: true },
      from: "flow",
    });
    expect(c.untranslated).toEqual([]);
    expect(yeses(c.automation)).toEqual([]);
    // The one «yes» of the document is the argument «Acción de Boni» passes on, inside its list of arguments.
    const w = c.automation.steps.find((s) => s.id === "p-w");
    expect(values(c.automation).filter((v) => v === "yes")).toHaveLength(1);
    expect(w?.params.args).toEqual([{ key: "permission", value: "yes" }]);
    // Run it with a scripted way to Boni's code: what it answers is from outside, and the write asks with that label.
    const port = boniPort(undefined, (call) =>
      call.name === "otra.accion" ? { texto: "Texto de fuera" } : "Respuesta de fuera",
    );
    const s = store([TASKS, NOTES], {}, next);
    const e = await run(
      {
        automation: c.automation,
        trigger: "trigger",
        fields: { json: {}, label: OWN },
        test: false,
      },
      {
        policy: policy(),
        collections: s,
        clock: clock(),
        dates,
        own: OWN,
        locale: "es",
        box: jsBox(),
        boni: port,
      },
    );
    expect(e.state, JSON.stringify(e.error ?? null)).toBe("done");
    expect(port.calls.map((x) => [x.type, x.name])).toEqual([
      ["boni.action", "otra.accion"],
      ["boni.reader", "answer_about"],
    ]);
    // Its why reaches Boni's code as the plan wrote it, and its arguments as data.
    expect(port.calls[0]?.values.why?.value).toBe("Para el ejemplo");
    expect(port.calls[0]?.args.permission?.value).toBe("yes");
    // From outside, whatever else it passed through: the reader's input, and the value the write asks for.
    const outside = {
      integrity: "external",
      sources: expect.arrayContaining([...OUTSIDE.sources]),
    };
    expect(port.calls[1]?.values.input).toMatchObject({ value: "Texto de fuera", label: outside });
    expect(s.applied).toEqual([]);
    const asked = e.asked[0];
    expect(asked?.kind).toBe("propose");
    expect(asked?.values[NOTE_TITLE]).toMatchObject({ value: "Texto de fuera", label: outside });
    expect(asked?.values[NOTE_TEXT]?.value).toBe("Respuesta de fuera");
  });

  it.todo(
    "AU-230 · a piece of Boni, «Acción de Boni» and «Lector de Boni» are decided as the old background was: reads run, changes are proposed, egress is denied, and none has a «Sí»",
  );
  it.todo(
    "AU-230 · the same turn plans in both engines get the same answer from `decide` for every act, and the turn's origin is never `automation`",
  );
  it.todo(
    "AU-143 · a turn on the new engine keeps the turn's limits and its record in the turn's own tables, not in an automation's runs",
  );
});
