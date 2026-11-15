/**
 * A test of a draft and what it keeps (docs/automatizaciones.md §5.8: AU-90, AU-91, AU-92; phase F14b). «Probar» is
 * `run` with `test: true` (engine.ts): the whole draft from one trigger, reading for real and writing nothing.
 * «Probar paso» is `runTest` with `step`: that step and only what it lacks of the steps before it.
 *
 * What makes a step «changed» is its **print**: one digest per step, the same for a step that would do the same with
 * the same input. A step's print is made of
 * - its type, its action, its parameters and its settings but `note` (a setting it does not hold counts as its
 *   default), each citation counted by the id of the step it cites and never by that step's name;
 * - the print of every step an arrow reaches it from, with the arrow's output and input, in the order of
 *   `arrowsInto`, and the print of every step it cites;
 * - for a trigger, the fields it was last tested with (`tested`), or nothing when it never was.
 * Nothing else: not its name, not where its box is (AU-05), not the automation's name, id or version, not the order
 * its steps and arrows were saved in (AU-12), and not what the collections hold now (the output says when it was
 * tested: AU-72).
 *
 * The server keeps, per automation, the last test of each step (`Kept`), and decides with the prints what a test
 * reuses and what is «puede estar vieja» (AU-92). The app never computes a print.
 */
import { actionOf, inputsOf, isTrigger } from "./catalogue.ts";
import {
  CannotRun,
  checkTriggerRow,
  type Execution,
  type RunDeps,
  type RunInput,
  runPlanned,
  type StepRecord,
} from "./engine.ts";
import { type Citation, citationsIn, parseExpression } from "./expression.ts";
import {
  type Automation,
  isExpr,
  type ParamValue,
  SETTINGS_DEFAULTS,
  type Step,
} from "./format.ts";
import { arrowsInto, byCodeUnit, executionOrder } from "./graph.ts";
import type { Cell } from "./rows.ts";
import { canonical } from "./steps.ts";
import { canRun, validate } from "./validate.ts";

/** A step's print: a digest, compared only for equality. */
export type Print = string;

/** What is kept of the last test of a step: the record as the engine gave it, rows and lineage included. */
export interface Kept {
  print: Print;
  record: StepRecord;
  /** When that test ran (epoch ms): «probado hace 2 min». */
  at: number;
}

/**
 * The print of every step of an automation, by step id. `tested`: by trigger id, the fields that trigger was last
 * tested with. `digest` turns a text of any length into a short one (the server's SHA-256; the package stays pure).
 * The same automation with its steps and arrows saved in another order, a step moved or renamed (its citations
 * rewritten by `renameStep`), or a note changed, gives the same prints. A draft with a cycle still has a print per
 * step (a step in the cycle counts the steps it hangs from by their ids): it cannot be tested, but it is kept.
 */
export function stepPrints(
  automation: Automation,
  tested: Readonly<Record<string, Readonly<Record<string, Cell>>>>,
  digest: (text: string) => string,
): Record<string, Print> {
  const byId = new Map(automation.steps.map((s) => [s.id, s]));
  const idOf = new Map(automation.steps.map((s) => [s.name, s.id]));
  // What each step hangs from: the steps its arrows come from and the steps it cites.
  const from = new Map<string, Set<string>>();
  for (const s of automation.steps) {
    const set = new Set<string>();
    if (!isTrigger(s)) {
      for (const a of automation.arrows)
        if (a.to.step === s.id && byId.has(a.from.step)) set.add(a.from.step);
      for (const c of citationsIn(s.params))
        if (c.step !== null) {
          const id = idOf.get(c.step);
          if (id && id !== s.id) set.add(id);
        }
    }
    from.set(s.id, set);
  }
  const order = topological([...byId.keys()], from);
  const prints: Record<string, Print> = {};
  for (const id of order) {
    const s = byId.get(id) as Step;
    const printOf = (other: string) => prints[other] ?? `cycle:${other}`;
    const arrows = inputsOf(s).flatMap((input) =>
      arrowsInto(automation, order, id, input).map((a) => [
        printOf(a.from.step),
        a.from.output,
        input,
      ]),
    );
    const cited = [...(from.get(id) ?? [])]
      .filter((other) => !automation.arrows.some((a) => a.to.step === id && a.from.step === other))
      .sort(byCodeUnit)
      .map(printOf);
    const { note: _note, ...settings } = { ...SETTINGS_DEFAULTS, ...(s.settings ?? {}) };
    prints[id] = digest(
      canonical({
        type: s.type,
        action: actionOf(s)?.key ?? null,
        params: byIds(s.params, idOf),
        settings,
        arrows,
        cited,
        tested: isTrigger(s) ? (tested[id] ?? null) : null,
      }),
    );
  }
  return prints;
}

/** Every step: one comes after every step it hangs from, ties by id; the steps of a cycle last, by id. */
function topological(
  ids: readonly string[],
  from: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  const left = new Map(ids.map((id) => [id, new Set(from.get(id))]));
  const order: string[] = [];
  for (;;) {
    const ready = [...left.entries()].filter(([, f]) => !f.size).map(([id]) => id);
    if (!ready.length) break;
    const next = ready.sort(byCodeUnit)[0] as string;
    order.push(next);
    left.delete(next);
    for (const f of left.values()) f.delete(next);
  }
  return [...order, ...[...left.keys()].sort(byCodeUnit)];
}

/** A parameter's value with every citation naming the step it cites by id, never by name. */
function byIds(value: ParamValue, idOf: ReadonlyMap<string, string>): unknown {
  if (isExpr(value))
    return {
      expr: parseExpression(value.expr).map((p) =>
        p.kind === "cite"
          ? { cite: citeById(p.cite, idOf) }
          : p.kind === "text"
            ? { text: p.text }
            : { code: p.source },
      ),
    };
  if (Array.isArray(value)) return value.map((v) => byIds(v, idOf));
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, byIds(v, idOf)]));
  return value;
}

const citeById = (c: Citation, idOf: ReadonlyMap<string, string>) => ({
  step: c.step === null ? null : (idOf.get(c.step) ?? { unknown: c.step }),
  pick: c.pick,
  path: c.path,
});

/**
 * The steps whose kept test no longer stands for them (AU-92): kept with another print than the step has now, in
 * the order of their ids. A step that is no longer in the automation is not one: it has no print.
 */
export function staleSteps(
  prints: Readonly<Record<string, Print>>,
  kept: Readonly<Record<string, Kept>>,
): string[] {
  return Object.keys(kept)
    .filter((id) => prints[id] !== undefined && kept[id]?.print !== prints[id])
    .sort(byCodeUnit);
}

export interface TestInput extends Omit<RunInput, "test"> {
  /**
   * «Probar paso»: the id of the step to test. Only that step and the steps it hangs from, back to `trigger`, are
   * decided: nothing after it and nothing on another branch has a record. Absent: «Probar», the whole draft
   * from `trigger`, with nothing reused.
   */
  step?: string;
  /** With `step`: the last test of each step, as the server kept it. */
  kept?: Readonly<Record<string, Kept>>;
  /** The prints of the automation as it is now (`stepPrints`). */
  prints: Readonly<Record<string, Print>>;
}

export interface TestExecution extends Execution {
  /**
   * The steps decided in this test and not reused, in order (one skipped or stopped included). With `step`, it is
   * always among them: «Probar paso» runs it again.
   */
  ran: string[];
  /**
   * The steps before `step` that did not run: their kept record was `done`, their print is the one they have now,
   * and every step they hang from or cite was reused too, so their rows (with their lineage: `.item` still finds its
   * own across them) were taken as they were. A step before `step` with no kept record, a stale one, one that did
   * not end `done`, or one after a step that runs again, runs.
   */
  reused: string[];
}

/**
 * A test (AU-90, AU-91): `run` with `test: true`, so every read asks the policy and no write is done, and with
 * `step` only what «Probar paso» needs. Validation is the same as `run`'s for the steps it decides: a problem in a
 * step after `step`, or on another branch, does not stop it. Throws `CannotRun` like `run`, and when `step` does not
 * hang from `trigger`.
 */
export async function runTest(input: TestInput, deps: RunDeps): Promise<TestExecution> {
  const { automation, trigger, step } = input;
  const start = automation.steps.find((s) => s.id === trigger);
  if (!start || !isTrigger(start))
    throw new CannotRun(`${trigger} is not a trigger of the automation`);
  let order: string[];
  try {
    order = executionOrder(automation, trigger);
  } catch {
    throw new CannotRun("the automation has a cycle");
  }
  if (step !== undefined) {
    if (!order.includes(step)) throw new CannotRun(`${step} does not hang from ${trigger}`);
    const before = ancestors(automation, step);
    order = order.filter((id) => before.has(id));
  }
  const decided = new Set(order);
  const problems = validate(automation, {
    collection: (key) => deps.collections.shape(key),
  }).filter((p) => {
    if (p.step !== undefined && !decided.has(p.step)) return false;
    const arrow = p.arrow === undefined ? undefined : automation.arrows[p.arrow];
    return !arrow || decided.has(arrow.to.step);
  });
  if (!canRun(problems)) throw new CannotRun("the automation has errors", problems);
  checkTriggerRow(start, input.fields);

  const reuse = new Map<string, StepRecord>();
  if (step !== undefined) {
    const byId = new Map(automation.steps.map((s) => [s.id, s]));
    const idOf = new Map(automation.steps.map((s) => [s.name, s.id]));
    for (const id of order) {
      if (id === step) continue;
      const k = input.kept?.[id];
      if (k?.record.state !== "done" || k.print !== input.prints[id]) continue;
      const s = byId.get(id) as Step;
      const hangs = [
        ...automation.arrows.filter((a) => a.to.step === id).map((a) => a.from.step),
        ...citationsIn(s.params).flatMap((c) => (c.step === null ? [] : [idOf.get(c.step) ?? ""])),
      ].filter((other) => decided.has(other));
      if (hangs.every((other) => reuse.has(other))) reuse.set(id, k.record);
    }
  }
  const { step: _step, kept: _kept, prints: _prints, ...rest } = input;
  const execution = await runPlanned({ ...rest, test: true }, deps, start, { order, reuse });
  return {
    ...execution,
    ran: order.filter((id) => !reuse.has(id)),
    reused: order.filter((id) => reuse.has(id)),
  };
}

/** A step and every step an arrow path reaches it from. */
function ancestors(automation: Automation, step: string): Set<string> {
  const seen = new Set([step]);
  const queue = [step];
  while (queue.length) {
    const id = queue.pop() as string;
    for (const a of automation.arrows)
      if (a.to.step === id && !seen.has(a.from.step)) {
        seen.add(a.from.step);
        queue.push(a.from.step);
      }
  }
  return seen;
}
