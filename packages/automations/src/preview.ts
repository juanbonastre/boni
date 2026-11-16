/**
 * What an expression is worth with one row of its step's input, for the line under it (docs/automatizaciones.md AU-23,
 * AU-27): «= 5 · con la fila 3 de 128». It is the run's own evaluation and not another one: the same `evaluate`, the
 * same box, the rows the step's test kept and that test's instant and seed, so what it shows is what the run gave.
 * It reads no collection (an expression cannot) and writes nothing. Built in F14c's E3.
 */
import type { Label } from "@boni/entities";
import { type Box, type EvaluateInput, evaluate, seedOf } from "./box.ts";
import { actionOf, inputsOf, isTrigger, outputsOf } from "./catalogue.ts";
import { type CodeFailure, CodeFault } from "./code.ts";
import { CLOSED } from "./engine.ts";
import { type Citation, CiteError, codeParts, resolve, type Scope } from "./expression.ts";
import { type StepFailure, StepFault } from "./failures.ts";
import {
  type Automation,
  isExpr,
  OUT,
  type ParamValue,
  SETTINGS_DEFAULTS,
  type Step,
} from "./format.ts";
import { arrowsInto, byCodeUnit, executionOrder } from "./graph.ts";
import { readCode } from "./javascript.ts";
import { citedBy, type Kept, type Print } from "./partial.ts";
import type { Cell, Row } from "./rows.ts";

export interface PreviewInput {
  /** The draft as it is now, with the expression as it is being written. */
  automation: Automation;
  /** The step's id and, in it, the path to the value (as `Problem.param`). */
  step: string;
  param: string;
  /** Which row of the step's kept input, from 0. One past the last is the last. */
  row: number;
  /** What the draft's tests kept, by step id (partial.ts). */
  kept: Readonly<Record<string, Kept>>;
  /** The prints of the draft as it is now (`stepPrints`): what says that a kept test is stale. */
  prints: Readonly<Record<string, Print>>;
  /** The instant and the seed of the test that kept them (`Kept.clock`), and the zone and language it ran with. */
  now: number;
  seed: number;
  zone: string;
  locale: string;
}

export type Preview =
  /** `of`: how many rows the step's input has. */
  | { state: "value"; value: Cell; row: number; of: number }
  /** The step's input has no rows: there is nothing to show a value with. */
  | { state: "noRows" }
  /** It cannot be calculated yet: these steps (ids, in the order to test them) were never tested or are stale. */
  | { state: "untested"; steps: string[] }
  | { state: "failed"; failure: StepFailure | CodeFailure; row: number; of: number };

/**
 * Never throws for what the expression does; it throws only when `step` or `param` is not in the draft. With no
 * JavaScript in it, it asks the box for nothing. The steps before it are the ones it hangs from by arrows and the
 * ones it cites; each must be kept `done` with the print it has now, or it says which to test. The rows are put
 * together as the run put them: by the order of the first trigger (by id) it hangs from.
 */
export async function preview(input: PreviewInput, box: Box): Promise<Preview> {
  const { automation, kept, prints } = input;
  const byId = new Map(automation.steps.map((s) => [s.id, s]));
  const byName = new Map(automation.steps.map((s) => [s.name, s]));
  const step = byId.get(input.step);
  if (!step) throw new Error(`no step has the id ${input.step}`);
  const value = valueAt(step.params, input.param);
  if (value === undefined) throw new Error(`${input.step} has no parameter ${input.param}`);

  // What it needs kept: every step before it, by arrows or by citation, and what those hang from in turn.
  const order = orderTo(automation, step.id);
  const needed = before(automation, step, byName);
  const place = new Map((order ?? []).map((id, i) => [id, i]));
  const missing = [...needed]
    .filter((id) => {
      const k = kept[id];
      return k?.record.state !== "done" || k.print !== prints[id];
    })
    .sort((a, b) => (place.get(a) ?? Infinity) - (place.get(b) ?? Infinity) || byCodeUnit(a, b));
  if (!order || missing.length)
    return { state: "untested", steps: missing.length ? missing : [step.id] };

  // The rows as the run had them: each kept step's input, and which step each row is of (for `.item`).
  const owner = new Map<Row, string>();
  for (const [id, k] of Object.entries(kept))
    for (const rows of Object.values(k.record.out)) for (const r of rows) owner.set(r, id);
  const arriving = (s: Step): Row[] => {
    const firstOnly = s.settings?.firstRowOnly ?? SETTINGS_DEFAULTS.firstRowOnly;
    return inputsOf(s).flatMap((name) => {
      const rows = arrowsInto(automation, order, s.id, name).flatMap(
        (a) => kept[a.from.step]?.record.out[a.from.output] ?? [],
      );
      return firstOnly ? rows.slice(0, 1) : rows;
    });
  };
  const pair = (row: Row, target: string): Row | undefined => {
    let r: Row | undefined = row;
    while (r) {
      const id = owner.get(r);
      if (!id) return undefined;
      if (id === target) return r;
      const s = byId.get(id);
      r = r.parent === null || !s ? undefined : arriving(s)[r.parent];
    }
    return undefined;
  };
  const outOf = (s: Step): Row[] =>
    outputsOf(s)
      .filter((o) => o !== OUT.error)
      .flatMap((o) => kept[s.id]?.record.out[o] ?? []);

  const rows = arriving(step);
  if (!rows.length) return { state: "noRows" };
  const n = Math.min(Math.max(0, Math.trunc(input.row)), rows.length - 1);
  const of = rows.length;
  const perRow = actionOf(step)?.mode !== "all";
  const current = perRow ? (rows[n] as Row) : null;
  const literal = (rows[n] as Row).label;
  const failed = (failure: StepFailure | CodeFailure): Preview => ({
    state: "failed",
    failure,
    row: n,
    of,
  });

  const scope: Scope = {
    current,
    literal,
    row: (name, pick) => {
      const cite: Citation = { step: name, pick, path: [] };
      const s = byName.get(name);
      if (!s || !kept[s.id]) throw new CiteError(s ? "notRun" : "unknownStep", cite);
      if (pick !== "item") {
        const out = outOf(s);
        const r = pick === "first" ? out[0] : out[out.length - 1];
        if (!r) throw new CiteError("noRows", cite);
        return r;
      }
      if (!current) throw new CiteError("noCurrentRow", cite);
      const r = pair(current, s.id);
      if (!r) throw new CiteError("noPair", cite);
      return r;
    },
  };

  try {
    const sources = [...new Set(sourcesIn(value))];
    if (sources.length) {
      const readings = sources.map((s) => readCode(s, "expression"));
      // `$input.all()` needs every row, as in the run; else only row n, counted from its place.
      const whole = readings.some((r) => r.input?.all);
      const sent = !perRow ? [] : whole ? rows : [rows[n] as Row];
      const steps: EvaluateInput["steps"] = {};
      for (const r of readings)
        for (const c of r.steps) {
          const s = byName.get(c.name);
          if (!s || !kept[s.id]) continue;
          const cited = outOf(s);
          const at = new Map(cited.map((x, i) => [x, i]));
          const item = c.item || steps[c.name]?.item;
          steps[c.name] = {
            rows: cited,
            ...(item && perRow
              ? {
                  item: sent.map((x) => {
                    const p = pair(x, s.id);
                    return p ? (at.get(p) ?? null) : null;
                  }),
                }
              : {}),
          };
        }
      const evaluation = await evaluate(
        {
          kind: "expressions",
          sources,
          mode: "perRow",
          input: sent,
          steps,
          literal,
          // An expression reads no collection: `today` is what a connection's filter would use, and it has none.
          connections: [],
          collectionNamed: () => undefined,
          now: input.now,
          zone: input.zone,
          locale: input.locale,
          today: "",
          seed: seedOf(input.seed, step.id),
          run: { test: true, startedBy: "user" },
          offset: whole || !perRow ? 0 : n,
        },
        box,
        CLOSED,
      );
      const at = whole && perRow ? n : 0;
      const e = evaluation.evaluations[at];
      if (!e) return failed({ code: "code.unavailable" });
      if (e.state === "failed") return failed({ ...e.failure, param: input.param });
      // An expression reads no collection, so this cannot be; said as the run says it.
      if (e.state === "denied")
        return failed({ code: e.denied.waits ? "policy.waits" : "policy.denied" });
      const values = e.values;
      scope.code = (source) => ({
        value: values[sources.indexOf(source)] ?? null,
        label: evaluation.labels[at] as Label,
        derived: true,
      });
    }
    return { state: "value", value: resolve(value, scope).value, row: n, of };
  } catch (e) {
    if (e instanceof CodeFault) return failed(e.why);
    if (e instanceof StepFault) return failed(e.failure);
    if (e instanceof CiteError)
      return failed({
        code: `cite.${e.failure}`,
        param: input.param,
        ...(e.cite.step === null ? {} : { detail: { step: e.cite.step } }),
      } as StepFailure);
    return failed({ code: "other", param: input.param });
  }
}

/** The value at a path written as `Problem.param` writes one («where.0.value»). */
function valueAt(params: Step["params"], path: string): ParamValue | undefined {
  let v: ParamValue | undefined = params as ParamValue;
  for (const k of path.split(".")) {
    if (Array.isArray(v)) v = v[Number(k)];
    else if (typeof v === "object" && v !== null && !isExpr(v) && Object.hasOwn(v, k))
      v = (v as Record<string, ParamValue>)[k];
    else return undefined;
  }
  return v;
}

/** The JavaScript of every `{{ }}` in a value that is not a simple citation. */
function sourcesIn(v: ParamValue): string[] {
  if (isExpr(v)) return codeParts(v.expr).parts.map((p) => p.source);
  if (Array.isArray(v)) return v.flatMap(sourcesIn);
  if (typeof v === "object" && v !== null) return Object.values(v).flatMap(sourcesIn);
  return [];
}

/** The order of the first trigger, by id, that the step hangs from: how its rows were put together. */
function orderTo(automation: Automation, step: string): string[] | undefined {
  const triggers = automation.steps
    .filter(isTrigger)
    .map((s) => s.id)
    .sort(byCodeUnit);
  for (const t of triggers)
    try {
      const order = executionOrder(automation, t);
      if (order.includes(step)) return order;
    } catch {
      return undefined;
    }
  return undefined;
}

/** Every step before `step`: by an arrow path or a citation, and what those hang from in turn. */
function before(
  automation: Automation,
  step: Step,
  byName: ReadonlyMap<string, Step>,
): Set<string> {
  const byId = new Map(automation.steps.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const queue = [step.id];
  while (queue.length) {
    const id = queue.pop() as string;
    const s = byId.get(id);
    if (!s) continue;
    const from = [
      ...automation.arrows.filter((a) => a.to.step === id).map((a) => a.from.step),
      ...citedBy(s).flatMap((name) => {
        const c = byName.get(name);
        return c ? [c.id] : [];
      }),
    ];
    for (const f of from)
      if (f !== step.id && !seen.has(f)) {
        seen.add(f);
        queue.push(f);
      }
  }
  return seen;
}
