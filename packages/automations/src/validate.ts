/**
 * Validation: whether an automation makes sense, said as a list of problems that each point at their step and their
 * parameter (docs/automatizaciones.md §5.1, §5.3, §5.10). The canvas paints them on the box and on the control
 * (F14b), publishing refuses an automation with an error (F14d), and the engine refuses to run one. A draft with
 * problems is still an automation: it is read, saved and edited.
 *
 * It needs no run and no data: only the automation, the catalogue and the shape of the collections it names.
 */
import { FILTER_OPS } from "@boni/views";
import {
  actionOf,
  inputsOf,
  isTrigger,
  OUTPUT_BRANCHES,
  outputsOf,
  type ParamSpec,
  paramsOf,
  resultName,
  stepType,
} from "./catalogue.ts";
import type { CollectionShape } from "./effects.ts";
import { parseExpression, printCitation } from "./expression.ts";
import { type Automation, isExpr, MAX_RETRIES, type ParamValue, type Step } from "./format.ts";
import { byCodeUnit, downstream, findCycle } from "./graph.ts";

/**
 * Every problem there is. A code is a key: each app says it to Juan in its `i18n.ts`, with what `detail` carries.
 * Adding one is a change of the contract: the canvas has a text for each.
 */
export const PROBLEMS = [
  // The automation
  "trigger.none", // no step is a trigger
  // A step
  "step.duplicateId",
  "step.emptyName",
  "step.duplicateName", // names are what expressions cite (AU-02). detail: name
  "step.unknownType", // not in the catalogue (AU-08). detail: type
  "step.settings", // a setting out of range (more than MAX_RETRIES tries, a negative wait). param: the setting
  // An arrow (`arrow` is its index)
  "arrow.unknownStep",
  "arrow.unknownOutput", // the step has no such output as it is now (AU-03). detail: output
  "arrow.unknownInput", // detail: input
  "arrow.intoTrigger", // a trigger has no input
  "arrow.duplicate",
  "arrow.cycle", // AU-07: on every arrow of the cycle
  // A parameter (`param` is its key, or the path to the value inside it)
  "param.required",
  "param.unknown", // a key its type's action does not declare, or one whose `when` does not hold (AU-126)
  "param.shape", // a `shape` parameter holds an expression (AU-26)
  "param.value", // not what its control takes: not one of the options, not a number, a list with too few rows
  "param.condition", // «Las que cumplan…» with no condition (AU-121)
  "param.sameName", // two results of «Agrupar» or «Contar o sumar» get one name, or one is named like a field it groups by (AU-120). detail: name
  // An expression (`param` is the path to it)
  "expr.code", // not a simple citation: JavaScript arrives in F14c (AU-22)
  "expr.unknownStep", // cites a name no step has. detail: name
  "expr.notBefore", // cites a step that does not always run before this one. detail: name
  "expr.cannotPair", // `.item` across a step that remakes the rows (AU-13). detail: name, by (the step between), first and all (the citations it proposes instead)
  "expr.noCurrentRow", // `$json` or `.item` in a parameter of a step that works with all the rows
  // The collections
  "collection.unknown", // detail: collection
  "field.unknown", // a field its collection does not have. detail: field
  // Warnings: it runs, and something is probably missing
  "step.unreachable", // no trigger reaches it
  "output.unconnected", // «sí» or «no» of a «Si», or a rule of «Elegir rama», goes nowhere. detail: output
] as const;
export type ProblemCode = (typeof PROBLEMS)[number];

/** The codes that are only warnings; every other is an error. */
export const WARNINGS: readonly ProblemCode[] = ["step.unreachable", "output.unconnected"];

export interface Problem {
  code: ProblemCode;
  /** An error stops publishing and running; a warning does neither. */
  severity: "error" | "warning";
  /** The id of the step it is about: the box the canvas marks. Absent for a problem of the automation as a whole. */
  step?: string;
  /**
   * Where in the step: a parameter's key («where»), or the path to the value inside it with dots («rules.2.where.0.
   * value», «fields.3.value»): the control the canvas marks. For `step.settings`, the setting's key.
   */
  param?: string;
  /** The index of the arrow it is about, in `automation.arrows`. With `step`, the step the arrow leaves from. */
  arrow?: number;
  /** What the message needs, by fixed keys (the ones each code lists above). Never text for a person. */
  detail?: Record<string, string | number>;
}

/** What validation may ask about the data: the shape of a collection by its key, or undefined when there is none. */
export interface ValidationContext {
  collection(key: string): CollectionShape | undefined;
}

/**
 * Every problem of an automation, in a fixed order (the automation's, then each step's in the steps' id order with
 * its parameters in the catalogue's order, then the arrows' by index), the same for the same automation whatever
 * the order its steps were saved in. Empty when it can be published. Never throws on an automation `parseAutomation`
 * gave.
 */
export function validate(automation: Automation, context: ValidationContext): Problem[] {
  const problems: Problem[] = [];
  const add = (code: ProblemCode, at: Omit<Problem, "code" | "severity"> = {}) =>
    problems.push({ code, severity: WARNINGS.includes(code) ? "warning" : "error", ...at });

  // The steps in id order; two saved with one id, in a fixed order too.
  const steps = [...automation.steps].sort(
    (a, b) => byCodeUnit(a.id, b.id) || byCodeUnit(JSON.stringify(a), JSON.stringify(b)),
  );
  const byId = new Map<string, Step>();
  const byName = new Map<string, Step[]>();
  for (const s of steps) {
    if (!byId.has(s.id)) byId.set(s.id, s);
    byName.set(s.name, [...(byName.get(s.name) ?? []), s]);
  }
  const down = downstream(automation);
  const reached = new Set<string>();
  for (const s of byId.values())
    if (isTrigger(s)) for (const id of [s.id, ...(down.get(s.id) ?? [])]) reached.add(id);

  if (!steps.some(isTrigger)) add("trigger.none");

  const done = new Set<string>();
  for (const step of steps) {
    if (done.has(step.id)) {
      if (
        byId.get(step.id) !== step &&
        !problems.some((p) => p.code === "step.duplicateId" && p.step === step.id)
      )
        add("step.duplicateId", { step: step.id });
      continue;
    }
    done.add(step.id);
    const at = { step: step.id };
    if (!step.name.trim()) add("step.emptyName", at);
    else if ((byName.get(step.name)?.length ?? 0) > 1)
      add("step.duplicateName", { ...at, detail: { name: step.name } });
    if (!stepType(step.type)) {
      add("step.unknownType", { ...at, detail: { type: step.type } });
      continue;
    }
    const retry = step.settings?.retry;
    if (
      retry &&
      (!Number.isInteger(retry.times) ||
        retry.times < 0 ||
        retry.times > MAX_RETRIES ||
        retry.waitMs < 0)
    )
      add("step.settings", { ...at, param: "retry" });
    if (!isTrigger(step) && !reached.has(step.id)) add("step.unreachable", at);
    new StepCheck(step, context, byId, byName, down, add).run();
    for (const out of outputsOf(step))
      if (
        OUTPUT_BRANCHES.has(step.type) &&
        out !== "error" &&
        !automation.arrows.some((a) => a.from.step === step.id && a.from.output === out)
      )
        add("output.unconnected", { ...at, detail: { output: out } });
  }

  const cycle = findCycle(automation);
  const inCycle = (from: string, to: string) => {
    if (!cycle) return false;
    const i = cycle.indexOf(from);
    return i >= 0 && cycle[(i + 1) % cycle.length] === to;
  };
  const seen = new Set<string>();
  automation.arrows.forEach((arrow, i) => {
    const from = byId.get(arrow.from.step);
    const to = byId.get(arrow.to.step);
    if (!from || !to) {
      add("arrow.unknownStep", { arrow: i, ...(from ? { step: from.id } : {}) });
      return;
    }
    const at = { arrow: i, step: from.id };
    // A step of a type the catalogue lacks has no known outputs or inputs: its own problem says so, once.
    if (stepType(from.type) && !outputsOf(from).includes(arrow.from.output))
      add("arrow.unknownOutput", { ...at, detail: { output: arrow.from.output } });
    if (isTrigger(to)) add("arrow.intoTrigger", at);
    else if (stepType(to.type) && !inputsOf(to).includes(arrow.to.input))
      add("arrow.unknownInput", { ...at, detail: { input: arrow.to.input } });
    const key = JSON.stringify([arrow.from.step, arrow.from.output, arrow.to.step, arrow.to.input]);
    if (seen.has(key)) add("arrow.duplicate", at);
    seen.add(key);
    if (inCycle(from.id, to.id)) add("arrow.cycle", at);
  });
  return problems;
}

type Add = (code: ProblemCode, at: Omit<Problem, "code" | "severity">) => void;

/** The parameters of one step, in the catalogue's order, then the keys it does not declare. */
class StepCheck {
  private readonly step: Step;
  private readonly context: ValidationContext;
  private readonly byId: Map<string, Step>;
  private readonly byName: Map<string, Step[]>;
  private readonly down: Map<string, Set<string>>;
  private readonly add: Add;
  private readonly shape: CollectionShape | undefined;
  private readonly perRow: boolean;

  constructor(
    step: Step,
    context: ValidationContext,
    byId: Map<string, Step>,
    byName: Map<string, Step[]>,
    down: Map<string, Set<string>>,
    add: Add,
  ) {
    this.step = step;
    this.context = context;
    this.byId = byId;
    this.byName = byName;
    this.down = down;
    this.add = add;
    const c = step.params.collection;
    this.shape = typeof c === "string" ? context.collection(c) : undefined;
    this.perRow = actionOf(step)?.mode === "perRow";
  }

  run(): void {
    const shown = paramsOf(this.step);
    for (const p of shown) this.param(p, this.step.params[p.key], p.key);
    // With no valid action, its parameters are not known yet: only keys no action of its type has are unknown.
    const spec = stepType(this.step.type);
    const known = new Set(
      actionOf(this.step) || !spec
        ? shown.map((p) => p.key)
        : [...shown.map((p) => p.key), ...spec.actions.flatMap((a) => a.params.map((p) => p.key))],
    );
    for (const k of Object.keys(this.step.params).sort(byCodeUnit))
      if (!known.has(k)) this.problem("param.unknown", k);
    this.results();
  }

  /** The fields «Agrupar» and «Contar o sumar» give: what they group by, then each result by `resultName`. */
  private results(): void {
    const p = this.step.params;
    const text = (v: ParamValue | undefined) => (typeof v === "string" ? v : undefined);
    const rows = (v: ParamValue | undefined) =>
      (Array.isArray(v) ? v : []).map((x) =>
        typeof x === "object" && x !== null && !Array.isArray(x) && !isExpr(x) ? x : {},
      );
    let grouped: (string | undefined)[] = [];
    let results: { name: string; at: string }[] = [];
    if (this.step.type === "group") {
      grouped = rows(p.by).map((b) => text(b.field));
      results = rows(p.measures).map((m, i) => ({
        name: resultName(text(m.measure) ?? "count", text(m.field)),
        at: `measures.${i}`,
      }));
    } else if (this.step.type === "collection" && actionOf(this.step)?.key === "aggregate") {
      const measure = text(p.measure) ?? "count";
      grouped = [text(p.groupBy)];
      results = [
        {
          name: resultName(measure, measure === "count" ? undefined : text(p.field)),
          at: "measure",
        },
      ];
    }
    const taken = new Set(grouped.filter((g) => g !== undefined));
    for (const r of results) {
      if (taken.has(r.name)) this.problem("param.sameName", r.at, { name: r.name });
      taken.add(r.name);
    }
  }

  private problem(code: ProblemCode, param: string, detail?: Problem["detail"]): void {
    this.add(code, { step: this.step.id, param, ...(detail ? { detail } : {}) });
  }

  private param(p: ParamSpec, saved: ParamValue | undefined, path: string): void {
    const v = saved ?? p.default;
    if (v === undefined || v === null || v === "") {
      if (p.required)
        this.problem(p.control === "conditions" ? "param.condition" : "param.required", path);
      return;
    }
    if (isExpr(v)) {
      if (p.shape) this.problem("param.shape", path);
      else if (p.control === "list" || p.control === "conditions" || p.control === "fields")
        this.problem("param.value", path);
      else this.expression(v.expr, path);
      return;
    }
    switch (p.control) {
      case "value": {
        const ok =
          p.of === "any" ||
          (p.of === "number"
            ? typeof v === "number"
            : p.of === "date"
              ? typeof v === "string" || typeof v === "number"
              : typeof v === "string");
        if (!ok) this.problem("param.value", path);
        else this.nested(v, path);
        return;
      }
      case "toggle":
        if (typeof v !== "boolean") this.problem("param.value", path);
        return;
      case "choice":
        if (typeof v !== "string") this.problem("param.value", path);
        else if ("of" in p.options) this.field(p.options.of === "collection", v, path);
        else if (!p.options.includes(v)) this.problem("param.value", path);
        return;
      case "picker":
        if (typeof v !== "string") this.problem("param.value", path);
        else if (p.of === "collection" && !this.context.collection(v))
          this.problem("collection.unknown", path, { collection: v });
        return;
      case "list":
        this.list(p, v, path);
        return;
      case "conditions":
        this.conditions(p.over.of === "collection", p.min ?? 0, v, path);
        return;
      case "fields":
        this.fields(p.over.of === "collection", v, path);
        return;
    }
  }

  /** A field of the step's collection, when it names one it knows. */
  private field(ofCollection: boolean, key: string, path: string): void {
    if (ofCollection && this.shape && !this.shape.fields.some((f) => f.key === key))
      this.problem("field.unknown", path, { field: key });
  }

  private list(p: Extract<ParamSpec, { control: "list" }>, v: ParamValue, path: string): void {
    if (!Array.isArray(v)) {
      this.problem("param.value", path);
      return;
    }
    if (v.length < (p.min ?? 0)) this.problem("param.value", path);
    // A hidden fixed column is the row's id (a rule's output, a field's key): one per row.
    const ids = p.columns.filter((c) => c.place === "hidden" && c.shape).map((c) => c.key);
    const seen = new Map<string, Set<string>>(ids.map((k) => [k, new Set()]));
    for (const [i, row] of v.entries()) {
      const at = `${path}.${i}`;
      if (typeof row !== "object" || row === null || Array.isArray(row) || isExpr(row)) {
        this.problem("param.value", at);
        continue;
      }
      for (const c of p.columns) this.param(c, row[c.key], `${at}.${c.key}`);
      for (const k of Object.keys(row).sort(byCodeUnit))
        if (!p.columns.some((c) => c.key === k)) this.problem("param.unknown", `${at}.${k}`);
      for (const k of ids) {
        const id = row[k];
        if (typeof id !== "string") continue;
        if (seen.get(k)?.has(id)) this.problem("param.value", `${at}.${k}`);
        seen.get(k)?.add(id);
      }
    }
  }

  private conditions(ofCollection: boolean, min: number, v: ParamValue, path: string): void {
    if (!Array.isArray(v)) {
      this.problem("param.value", path);
      return;
    }
    if (v.length < min) this.problem("param.condition", path);
    for (const [i, item] of v.entries()) {
      const at = `${path}.${i}`;
      if (typeof item !== "object" || item === null || Array.isArray(item) || isExpr(item)) {
        this.problem("param.value", at);
        continue;
      }
      if ("join" in item) {
        const rules = item.rules;
        if (
          (item.join !== "and" && item.join !== "or") ||
          !Array.isArray(rules) ||
          Object.keys(item).length !== 2
        ) {
          this.problem("param.value", at);
          continue;
        }
        for (const [j, r] of rules.entries()) {
          if (typeof r === "object" && r !== null && !Array.isArray(r) && "join" in r)
            this.problem("param.value", `${at}.rules.${j}`);
          else this.rule(ofCollection, r, `${at}.rules.${j}`);
        }
      } else this.rule(ofCollection, item, at);
    }
  }

  private rule(ofCollection: boolean, r: ParamValue, at: string): void {
    if (typeof r !== "object" || r === null || Array.isArray(r) || isExpr(r)) {
      this.problem("param.value", at);
      return;
    }
    for (const k of Object.keys(r).sort(byCodeUnit))
      if (k !== "field" && k !== "op" && k !== "value") this.problem("param.unknown", `${at}.${k}`);
    if (typeof r.field !== "string" || !r.field) this.problem("param.value", `${at}.field`);
    else this.field(ofCollection, r.field, `${at}.field`);
    if (!FILTER_OPS.includes(r.op as (typeof FILTER_OPS)[number]))
      this.problem("param.value", `${at}.op`);
    const value = r.value;
    if (value === undefined) return;
    if (isExpr(value)) this.expression(value.expr, `${at}.value`);
    else if (typeof value !== "string" && typeof value !== "number")
      this.problem("param.value", `${at}.value`);
  }

  private fields(ofCollection: boolean, v: ParamValue, path: string): void {
    if (!Array.isArray(v)) {
      this.problem("param.value", path);
      return;
    }
    const seen = new Set<string>();
    for (const [i, item] of v.entries()) {
      const at = `${path}.${i}`;
      if (typeof item !== "object" || item === null || Array.isArray(item) || isExpr(item)) {
        this.problem("param.value", at);
        continue;
      }
      for (const k of Object.keys(item).sort(byCodeUnit))
        if (k !== "field" && k !== "value") this.problem("param.unknown", `${at}.${k}`);
      const field = item.field;
      if (typeof field !== "string" || !field || seen.has(field))
        this.problem("param.value", `${at}.field`);
      else {
        seen.add(field);
        this.field(ofCollection, field, `${at}.field`);
      }
      if (item.value !== undefined) this.nested(item.value, `${at}.value`);
    }
  }

  /** Every expression inside a value of free shape. */
  private nested(v: ParamValue, path: string): void {
    if (isExpr(v)) this.expression(v.expr, path);
    else if (Array.isArray(v)) for (const [i, x] of v.entries()) this.nested(x, `${path}.${i}`);
    else if (typeof v === "object" && v !== null)
      for (const [k, x] of Object.entries(v)) this.nested(x, `${path}.${k}`);
  }

  private expression(expr: string, path: string): void {
    for (const part of parseExpression(expr)) {
      if (part.kind === "code") this.problem("expr.code", path);
      if (part.kind !== "cite") continue;
      const { step: name, pick } = part.cite;
      if (name === null) {
        if (!this.perRow) this.problem("expr.noCurrentRow", path);
        continue;
      }
      const cited = this.byName.get(name)?.[0];
      if (!cited) {
        this.problem("expr.unknownStep", path, { name });
        continue;
      }
      if (!this.down.get(cited.id)?.has(this.step.id)) {
        this.problem("expr.notBefore", path, { name });
        continue;
      }
      if (pick !== "item") continue;
      if (!this.perRow) {
        this.problem("expr.noCurrentRow", path);
        continue;
      }
      // A step between the two that remakes the rows: the current row does not come from one of the cited step's.
      const by = [...(this.down.get(cited.id) ?? [])]
        .filter((id) => id !== this.step.id && this.down.get(id)?.has(this.step.id))
        .sort(byCodeUnit)
        .map((id) => this.byId.get(id))
        .find((s) => s && actionOf(s)?.pairs === false);
      // What it proposes instead, written as Juan would cite it: the first row, or all of them (AU-13).
      const instead = printCitation({ ...part.cite, pick: "first" });
      if (by)
        this.problem("expr.cannotPair", path, {
          name,
          by: by.name,
          first: instead,
          all: `${printCitation({ ...part.cite, pick: "first", path: [] }).slice(0, -".first()".length)}.all()`,
        });
    }
  }
}

/** Whether a list of problems lets the automation run: no errors (warnings do not count). */
export const canRun = (problems: readonly Problem[]): boolean =>
  problems.every((p) => p.severity !== "error");
