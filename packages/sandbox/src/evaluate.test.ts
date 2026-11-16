// Protocol 2 of the box (evaluate.ts; docs/automatizaciones.md §7, AU-160). Pending: the first PR of F14c brings one
// test per rule, and the builder turns each into a real one, keeping the rule's id in its name (`make check` reads
// them). The one that runs holds what lets both protocols share a socket.
import { describe, expect, it } from "vitest";
import {
  EVAL_DEFAULT_LIMITS,
  EVAL_MAX_LIMITS,
  EVALUATE,
  type EvalRequest,
  evalLimitsOf,
  evalRequestErrors,
  isEvalRequest,
  MAX_READ_KEY,
} from "./evaluate.ts";
import { requestErrors } from "./protocol.ts";

const twelve = Array.from({ length: 12 }, (_, i) => `m${i}`);
const seven = Array.from({ length: 7 }, (_, i) => `d${i}`);
/** A request that is one, as Boni's server makes them (invented rows). */
const good = (): EvalRequest => ({
  id: "prueba",
  v: EVALUATE,
  kind: "expressions",
  mode: "perRow",
  sources: ["$json.importe * 2"],
  hash: "a".repeat(64),
  input: [{ importe: 1 }, { importe: 2 }],
  from: 0,
  steps: { "Buscar gastos": { rows: [{ b: 1 }], item: [0, null] } },
  now: Date.UTC(2026, 10, 16, 8, 30),
  zone: {
    zone: "Europe/Madrid",
    offsets: [
      [0, 60],
      [Date.UTC(2026, 2, 29, 1), 120],
    ],
  },
  names: { months: twelve, monthsShort: twelve, days: seven, daysShort: seven },
  seed: 42,
  run: { test: true, startedBy: "user" },
  reads: { [`${"f".repeat(64)}`]: [{ a: 1 }] },
});
const errorsWith = (change: Record<string, unknown>) => evalRequestErrors({ ...good(), ...change });

describe("protocol 2: an evaluation's request", () => {
  it("a line with `v` is an evaluation and one without is a function call: neither is taken for the other", () => {
    expect(isEvalRequest({ id: "a", v: EVALUATE })).toBe(true);
    expect(isEvalRequest({ id: "a", code: "", fn: "f" })).toBe(false);
    expect(isEvalRequest(null)).toBe(false);
    expect(requestErrors({ id: "a", v: EVALUATE }).length).toBeGreaterThan(0);
  });

  it("AU-160 · `evalRequestErrors` says what is wrong with a request, by its member: a kind or a mode that is not one, sources that are not texts, rows that are not objects, a pairing out of range, a zone table that is not ordered, a key of a read over `MAX_READ_KEY`; a request that is one gives none", () => {
    expect(evalRequestErrors(good())).toEqual([]);
    expect(
      evalRequestErrors({ ...good(), kind: "code", mode: "all", sources: ["return 1"] }),
    ).toEqual([]);
    const wrong: [Record<string, unknown>, string][] = [
      [{ kind: "programa" }, "kind"],
      [{ mode: "todas" }, "mode"],
      [{ sources: [1] }, "sources"],
      [{ sources: [] }, "sources"],
      [{ sources: [""] }, "sources"],
      [{ kind: "code", mode: "all", sources: ["return 1", "return 2"] }, "sources"],
      [{ input: [{ a: 1 }, "fila"], steps: {} }, "input"],
      [{ input: [[1]], steps: {} }, "input"],
      [{ from: -1 }, "from"],
      [{ from: 1.5 }, "from"],
      [
        { steps: { "Buscar gastos": { rows: [{ b: 1 }], item: [1, null] } } },
        "steps.Buscar gastos.item",
      ],
      [{ steps: { "Buscar gastos": { rows: [{ b: 1 }], item: [0] } } }, "steps.Buscar gastos.item"],
      [{ steps: { "Buscar gastos": { rows: [{ b: 1 }], url: "x" } } }, "steps.Buscar gastos.url"],
      [{ steps: { "Buscar gastos": { rows: "x" } } }, "steps.Buscar gastos"],
      [
        {
          zone: {
            zone: "Europe/Madrid",
            offsets: [
              [5, 60],
              [5, 120],
            ],
          },
        },
        "zone",
      ],
      [
        {
          zone: {
            zone: "Europe/Madrid",
            offsets: [
              [9, 60],
              [5, 120],
            ],
          },
        },
        "zone",
      ],
      [{ zone: { zone: "Europe/Madrid", offsets: [[0, 60 * 25]] } }, "zone"],
      [{ zone: { zone: "Europe/Madrid", offsets: [] } }, "zone"],
      [{ names: { months: twelve, monthsShort: twelve, days: twelve, daysShort: seven } }, "names"],
      [{ now: "hoy" }, "now"],
      [{ seed: 0.5 }, "seed"],
      [{ hash: "abc" }, "hash"],
      [{ id: "no vale" }, "id"],
      [{ v: 3 }, "v"],
      [{ reads: { ["k".repeat(MAX_READ_KEY + 1)]: 1 } }, `reads.${"k".repeat(16)}`],
      [{ reads: [] }, "reads"],
      [{ limits: { ms: 0 } }, "limits.ms"],
      [{ limits: { disco: 1 } }, "limits.disco"],
    ];
    for (const [change, member] of wrong)
      expect(errorsWith(change), JSON.stringify(change)).toEqual([member]);
    expect(evalRequestErrors({ ...good(), reads: { ["k".repeat(MAX_READ_KEY)]: 1 } })).toEqual([]);
    expect(evalRequestErrors([])).toEqual(["no es un objeto"]);
  });
  it("AU-160 · a request names nothing of the server but what it holds: no path, no address and no function to call back; expressions are always per row, and a request that says otherwise is refused", () => {
    for (const member of ["path", "socket", "url", "callback", "fn", "code", "env"])
      expect(errorsWith({ [member]: "x" }), member).toEqual([member]);
    expect(errorsWith({ run: { test: true, startedBy: "user", url: "x" } })).toEqual(["run"]);
    expect(errorsWith({ mode: "all" })).toEqual(["mode"]);
    expect(errorsWith({ kind: "code", sources: ["return 1"], mode: "perRow" })).toEqual([]);
  });
  it("AU-35 · `evalLimitsOf` gives a request's limits where it says them and the defaults where it does not, never over the most the box allows (`MAX_LIMITS`), and a limit of zero or less is not one", () => {
    expect(evalLimitsOf({})).toEqual(EVAL_DEFAULT_LIMITS);
    const asked = evalLimitsOf({
      limits: { ms: 1_234.7, reads: 3, consoleLines: 10 ** 9, steps: 0, memoryBytes: -1 },
    });
    expect(asked).toEqual({
      ...EVAL_DEFAULT_LIMITS,
      ms: 1_234,
      reads: 3,
      consoleLines: EVAL_MAX_LIMITS.consoleLines,
    });
    expect(evalLimitsOf({ limits: { reads: 0.5 } }).reads).toBe(1);
    for (const k of Object.keys(EVAL_MAX_LIMITS) as (keyof typeof EVAL_MAX_LIMITS)[]) {
      expect(EVAL_DEFAULT_LIMITS[k], k).toBeLessThanOrEqual(EVAL_MAX_LIMITS[k]);
      expect(evalLimitsOf({ limits: { [k]: Number.MAX_SAFE_INTEGER } })[k], k).toBe(
        EVAL_MAX_LIMITS[k],
      );
    }
  });
});
