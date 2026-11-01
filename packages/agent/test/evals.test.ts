import { describe, expect, it } from "vitest";
import { evalDecider, evalPlanner, evalReader } from "../eval/lib/index.ts";
import { fakePlanner, ScriptedProvider } from "../src/providers.ts";

/** The evaluations score by code: checked here with scripted models (no network, nothing spent). */
describe("the evaluations a model passes before it takes a role", () => {
  it("the reader: a model that keeps nothing misses what it should keep and gets the rest right", async () => {
    const r = await evalReader(new ScriptedProvider("fake", () => ({ items: [] })));
    expect(r.total).toBeGreaterThan(5);
    expect(r.wrong).toBe(0);
    expect(r.right).toBeGreaterThan(0);
    expect(r.right).toBeLessThan(r.total);
  });

  it("the decider: unsure asks (not wrong); sure and wrong is wrong", async () => {
    const unsure = await evalDecider(
      new ScriptedProvider("jev", () => ({
        c: { choice: "Docencia", confidence: 0.9 },
        r: { choice: "Planes", confidence: 0.9 },
      })),
    );
    expect([unsure.right, unsure.wrong]).toEqual([0, 0]);
    expect(unsure.cases.every((c) => c.note === "would ask Juan")).toBe(true);
    const sure = await evalDecider(
      new ScriptedProvider("jev", () => ({
        c: { choice: "Docencia", confidence: 0.9 },
        r: { choice: "Docencia", confidence: 0.9 },
      })),
    );
    expect(sure.right + sure.wrong).toBe(sure.total);
    expect(sure.right).toBeGreaterThan(0);
  });

  it("the planner: a planner that answers nothing useful fails, and each case runs in a store of its own", async () => {
    const r = await evalPlanner(fakePlanner([{ version: 1, steps: [] }]), fakePlanner([]));
    expect(r.total).toBe(9);
    expect(r.right).toBe(0);
  });

  it("the planner's answers are also scored by how they are shown: numbers to compare in a chart", async () => {
    const lit = (x: string | number) => ({ lit: x });
    const sum = (id: string, categoria: string) => ({
      id,
      op: "call",
      tool: "entities.aggregate",
      args: {
        type: lit("movimiento"),
        op: lit("sum"),
        of: lit("importe"),
        field: lit("categoria"),
        equals: lit(categoria),
      },
    });
    const plan = (component: "chart" | "table") => ({
      version: 1,
      steps: [
        sum("a", "restaurante"),
        sum("b", "supermercado"),
        sum("c", "ocio"),
        component === "chart"
          ? {
              id: "r",
              op: "reply",
              component: "chart",
              data: {
                labels: {
                  fn: "list",
                  args: [lit("restaurante"), lit("supermercado"), lit("ocio")],
                },
                values: { fn: "list", args: [{ ref: "$a" }, { ref: "$b" }, { ref: "$c" }] },
                kind: lit("bar"),
              },
            }
          : {
              id: "r",
              op: "reply",
              component: "table",
              data: {
                rows: { fn: "list", args: [{ ref: "$a" }, { ref: "$b" }, { ref: "$c" }] },
              },
            },
      ],
    });
    const only = "cada categoría";
    const chart = await evalPlanner(fakePlanner([plan("chart")]), fakePlanner([]), { only });
    expect(chart).toMatchObject({ total: 1, right: 1, shown: 1 });
    const table = await evalPlanner(fakePlanner([plan("table")]), fakePlanner([]), { only });
    expect(table).toMatchObject({ total: 1, right: 1, shown: 0 });
    expect(table.cases[0]?.format).toBe("a table, not a chart");
  });

  it("the planner by hand: one case several times, and a failure says how it ended and its plan", async () => {
    const plan = {
      version: 1,
      steps: [{ id: "r", op: "reply", component: "text", data: { template: { lit: "Nada" } } }],
    };
    const r = await evalPlanner(fakePlanner([plan, plan]), fakePlanner([]), {
      only: "correos? Apúntalo",
      times: 2,
    });
    expect(r.total).toBe(2);
    expect(r.cases.map((c) => c.note)).toEqual(["nothing proposed", "nothing proposed"]);
    expect(r.cases[0]?.detail).toContain("done, 0 proposals, 1 replies");
    expect(r.cases[0]?.detail).toContain("plan: r:reply text");
  });
});
