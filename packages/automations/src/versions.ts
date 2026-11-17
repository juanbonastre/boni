/**
 * What «Publicar» and «Versiones» show, as pure functions (docs/automatizaciones.md §5.8: AU-96, AU-98, AU-182, AU-47,
 * AU-192; phase F14d): the difference between two documents (`diffAutomations`), what stops a publish and what is
 * worth a look (`publishChecks`), what the automation will be able to do (`abilities`, which the map reads too), and
 * the names of collections a version keeps (`keptNames`). The same in the app and in the server, which is the one
 * that decides whether it publishes. None of them runs anything or asks for data: what the server knows (which
 * collections hold outside values today, which steps were tested) comes in as arguments.
 */
import { agentSources } from "./agent.ts";
import { actionOf, isTrigger } from "./catalogue.ts";
import { AGENT_TYPE, CODE_PARAMS, CODE_TYPE } from "./code.ts";
import { permissions } from "./connections.ts";
import { citationsIn, codeParts } from "./expression.ts";
import {
  type Arrow,
  AUTOMATION_LIMITS,
  type Automation,
  isExpr,
  limitsOf,
  type ParamValue,
  RUN_LIMIT_KEYS,
  type RunLimit,
  type Step,
} from "./format.ts";
import { byCodeUnit, downstream, touches } from "./graph.ts";
import { readCode } from "./javascript.ts";
import type { Print } from "./partial.ts";
import { type Problem, type ValidationContext, validate } from "./validate.ts";
import { stepChanges, WRITE_ACTIONS, type WriteAction } from "./writes.ts";

// ---------------------------------------------------------------- the difference

/** What changed in one step that both documents have, by its id. */
export interface StepDiff {
  step: string;
  name?: { from: string; to: string };
  type?: { from: string; to: string };
  /** The keys of the parameters added, removed or changed, sorted. */
  params: string[];
  /** The keys of the collections whose connection was added, removed or changed, sorted. */
  connections: string[];
  /** The settings («Si falla», «Reintentar», «Apagado»…) that changed, sorted. */
  settings: string[];
}

export interface AutomationDiff {
  name?: { from: string; to: string };
  /** The ids of the steps only `b` has, and of those only `a` has, sorted. */
  added: string[];
  removed: string[];
  /** The steps both have and that changed, by id. */
  changed: StepDiff[];
  /** The arrows only `b` has, and only `a` has, each list sorted. */
  arrows: { added: Arrow[]; removed: Arrow[] };
  /** The trigger steps among those added, removed or changed: «cambia cómo se inicia». */
  triggers: string[];
  /** The limits whose value a run would hold to changed (`limitsOf`: a default written out is no change). */
  limits: { limit: RunLimit; from: number; to: number }[];
}

/**
 * What changes from `a` to `b` (AU-96, AU-98): «Publicar» compares the draft with the version that runs, and
 * «Versiones» two published versions. Only the document counts: the order steps and arrows are saved in is none, and
 * the layout is not in it (AU-05), so moving a box is no difference. `isSame` says there is none.
 */
export function diffAutomations(a: Automation, b: Automation): AutomationDiff {
  const before = new Map(a.steps.map((s) => [s.id, s]));
  const after = new Map(b.steps.map((s) => [s.id, s]));
  const added = [...after.keys()].filter((id) => !before.has(id)).sort(byCodeUnit);
  const removed = [...before.keys()].filter((id) => !after.has(id)).sort(byCodeUnit);
  const changed: StepDiff[] = [];
  for (const id of [...after.keys()].filter((k) => before.has(k)).sort(byCodeUnit)) {
    const d = stepDiff(before.get(id) as Step, after.get(id) as Step);
    if (d) changed.push(d);
  }
  const key = (r: Arrow) => JSON.stringify([r.from.step, r.from.output, r.to.step, r.to.input]);
  const was = new Set(a.arrows.map(key));
  const is = new Set(b.arrows.map(key));
  const sortArrows = (list: Arrow[]) => [...list].sort((x, y) => byCodeUnit(key(x), key(y)));
  const triggerIds = new Set([...a.steps, ...b.steps].filter((s) => isTrigger(s)).map((s) => s.id));
  const la = limitsOf(a);
  const lb = limitsOf(b);
  return {
    ...(a.name === b.name ? {} : { name: { from: a.name, to: b.name } }),
    added,
    removed,
    changed,
    arrows: {
      added: sortArrows(b.arrows.filter((r) => !was.has(key(r)))),
      removed: sortArrows(a.arrows.filter((r) => !is.has(key(r)))),
    },
    triggers: [...added, ...removed, ...changed.map((c) => c.step)]
      .filter((id) => triggerIds.has(id))
      .sort(byCodeUnit),
    limits: RUN_LIMIT_KEYS.filter((k) => la[k] !== lb[k]).map((k) => ({
      limit: k,
      from: la[k],
      to: lb[k],
    })),
  };
}

/** Whether a difference has nothing in it. */
export const isSame = (d: AutomationDiff): boolean =>
  !d.name &&
  !d.added.length &&
  !d.removed.length &&
  !d.changed.length &&
  !d.arrows.added.length &&
  !d.arrows.removed.length &&
  !d.limits.length;

function stepDiff(a: Step, b: Step): StepDiff | undefined {
  const keys = (x: object, y: object) =>
    [...new Set([...Object.keys(x), ...Object.keys(y)])]
      .filter((k) => !same((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k]))
      .sort(byCodeUnit);
  const byCollection = (s: Step) =>
    Object.fromEntries((s.connections ?? []).map((c) => [c.collection, c]));
  const d: StepDiff = {
    step: a.id,
    ...(a.name === b.name ? {} : { name: { from: a.name, to: b.name } }),
    ...(a.type === b.type ? {} : { type: { from: a.type, to: b.type } }),
    params: keys(a.params, b.params),
    connections: keys(byCollection(a), byCollection(b)),
    settings: keys(a.settings ?? {}, b.settings ?? {}),
  };
  return d.name || d.type || d.params.length || d.connections.length || d.settings.length
    ? d
    : undefined;
}

/** Two plain values (a parsed document's) equal key by key, whatever the order of their keys. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return (
    ka.length === kb.length &&
    ka.every(
      (k) =>
        Object.hasOwn(b, k) &&
        same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    )
  );
}

// ---------------------------------------------------------------- what stops a publish

/** What is worth a look before publishing and stops nothing (AU-96). */
export const LOOKS = [
  "output.unconnected", // as validation's warning. step; detail.output
  "step.unreachable", // no trigger reaches it, so it will not run. step
  "step.untested", // never tested. step
  "step.stale", // its test is from before it changed (AU-92). step
  "output.pinned", // its output is pinned (AU-93). step
  "limit.changed", // a run limit that is not its default. detail: limit, value, default
] as const;
export type LookCode = (typeof LOOKS)[number];

export interface Look {
  code: LookCode;
  step?: string;
  detail?: Record<string, string | number>;
}

export interface PublishChecks {
  /** The errors that stop the publish: each names its step, or none for one of the whole automation. */
  blocks: Problem[];
  /** What is worth a look, in the order of `LOOKS` and then of the steps' ids. */
  looks: Look[];
}

/** What the server knows of the draft's tests: its kept tests' prints, the prints now, the steps pinned. */
export interface TestsKnown {
  /** By step id, the print its last test was kept with (`Kept.print`). */
  kept?: Readonly<Record<string, Print>>;
  /** The prints of the draft as it is now (`stepPrints`). */
  prints?: Readonly<Record<string, Print>>;
  /** The ids of the steps whose output is pinned. */
  pinned?: readonly string[];
}

/** The ids of the steps some trigger reaches, triggers included. */
export function reachedSteps(automation: Automation): Set<string> {
  const down = downstream(automation);
  const out = new Set<string>();
  for (const s of automation.steps)
    if (isTrigger(s)) for (const id of [s.id, ...(down.get(s.id) ?? [])]) out.add(id);
  return out;
}

/**
 * The errors of a validation that stop publishing and running (AU-96): those of the automation as a whole and those
 * on a step some trigger reaches. A step no trigger reaches never runs, so its errors stop neither: «Publicar» says
 * it will not run. The engine refuses a run with the same function, so what publishes runs.
 */
export function blocking<P extends Pick<Problem, "severity" | "step">>(
  automation: Automation,
  problems: readonly P[],
): P[] {
  const reached = reachedSteps(automation);
  const ids = new Set(automation.steps.map((s) => s.id));
  return problems.filter(
    (p) =>
      p.severity === "error" && (p.step === undefined || !ids.has(p.step) || reached.has(p.step)),
  );
}

/**
 * What «Publicar» marks (AU-96, the half of AU-83 that was missing): what stops it (a problem of the validation, or
 * a required parameter left empty, which validation says as `param.required`, on a step a trigger reaches) and what
 * is worth a look and stops nothing.
 */
export function publishChecks(
  automation: Automation,
  context: ValidationContext,
  tests: TestsKnown = {},
): PublishChecks {
  const problems = validate(automation, context) as Problem[];
  const reached = reachedSteps(automation);
  const looks: Look[] = [];
  const ids = [...automation.steps].map((s) => s.id).sort(byCodeUnit);
  for (const p of problems)
    if (p.code === "output.unconnected" && p.step && reached.has(p.step))
      looks.push({ code: p.code, step: p.step, ...(p.detail ? { detail: p.detail } : {}) });
  for (const id of ids) if (!reached.has(id)) looks.push({ code: "step.unreachable", step: id });
  const byId = new Map(automation.steps.map((s) => [s.id, s]));
  for (const id of ids) {
    const step = byId.get(id) as Step;
    if (isTrigger(step) || !reached.has(id)) continue;
    const kept = tests.kept?.[id];
    if (kept === undefined) looks.push({ code: "step.untested", step: id });
    else if (tests.prints?.[id] !== undefined && tests.prints[id] !== kept)
      looks.push({ code: "step.stale", step: id });
  }
  for (const id of [...(tests.pinned ?? [])].sort(byCodeUnit))
    if (byId.has(id)) looks.push({ code: "output.pinned", step: id });
  const set = automation.settings?.limits ?? {};
  for (const limit of RUN_LIMIT_KEYS) {
    const value = set[limit];
    if (value !== undefined && value !== AUTOMATION_LIMITS[limit].default)
      looks.push({
        code: "limit.changed",
        detail: { limit, value, default: AUTOMATION_LIMITS[limit].default },
      });
  }
  return { blocks: blocking(automation, problems), looks };
}

// ---------------------------------------------------------------- what it will be able to do

/** How a write is done: «las guarda», «pregunta», or, removing with «Sí», «sin preguntar» (AU-189). */
export type AbilityHow = "saves" | "asks" | "noAsk";

/**
 * One line of «Lo que podrá hacer» (AU-96, AU-182): one collection and one action, with the steps that do it (what
 * the map reads, AU-47). A write says how; with «Sí», whether it can receive something from outside.
 */
export interface Ability {
  /** The collection's key: the screen says its name, as plain text. */
  collection: string;
  action: "read" | WriteAction;
  /** For a write: the most it can do without asking, over its steps («las guarda» wins over «pregunta»). */
  how?: AbilityHow;
  /** «con datos de fuera»: some step that does it with «Sí» can receive something from outside (decision 11). */
  outside?: true;
  /**
   * «decide la IA» (AU-200): an «Agente» does it, so which rows and which values are its model's choice, inside its
   * connection. The connection's «Como mucho» is the screen's to say, read from the step.
   */
  byAgent?: true;
  /** The ids of the steps that do it, sorted. */
  steps: string[];
}

/** What `abilities` needs beyond the document: what only the server knows, asked once when «Publicar» opens. */
export interface AbilitiesContext {
  /** A collection's key by its name now: what a «Código» cites (`stepChanges`). */
  collectionNamed(name: string): string | undefined;
  /** The keys of the collections that hold some value from outside today (AU-170): the server's query, by collection read. */
  outside?: ReadonlySet<string>;
}

/**
 * The step types the catalogue marks as a source of outside values (a file uploaded, mail: F18; what comes from
 * outside: F20). None in F14d, so «con datos de fuera» comes only from a read of a collection that holds some.
 */
export const OUTSIDE_SOURCES: ReadonlySet<string> = new Set<string>();

const ACTION_ORDER = ["read", ...WRITE_ACTIONS] as const;

/**
 * What the automation will be able to do when it runs on its own (AU-96, AU-182, AU-47), by collection and action, one
 * line each, sorted by collection key and then read, create, update, remove. From the same functions the engine
 * holds a run to: a «Colección» step's action with its «Permiso» and a «Código»'s analysis with its connection's cells
 * (`stepChanges`), and each connection's reads (`permissions`); an action the connection does not give is not in it.
 * Every step counts, the ones no trigger reaches too: it never says less than a version can do.
 */
export function abilities(automation: Automation, context: AbilitiesContext): Ability[] {
  type Line = { how?: AbilityHow; outside: boolean; byAgent: boolean; steps: Set<string> };
  const lines = new Map<string, Line>();
  const line = (collection: string, action: Ability["action"]) => {
    const k = JSON.stringify([collection, action]);
    let l = lines.get(k);
    if (!l) {
      l = { outside: false, byAgent: false, steps: new Set() };
      lines.set(k, l);
    }
    return l;
  };
  const rank: Record<AbilityHow, number> = { asks: 0, saves: 1, noAsk: 1 };
  const fromOutside = outsideSteps(automation, context.outside ?? new Set());

  for (const t of touches(automation))
    if (t.effect === "read") line(t.collection, "read").steps.add(t.step);
  for (const step of automation.steps) {
    const agent = step.type === AGENT_TYPE;
    for (const p of permissions(step.connections ?? []))
      if (p.action === "read") {
        const l = line(p.collection, "read");
        l.steps.add(step.id);
        if (agent) l.byAgent = true;
      }
    for (const change of stepChanges(step, context))
      for (const a of change.actions) {
        if (a.mode === false) continue;
        const how: AbilityHow =
          a.mode === "ask" ? "asks" : a.action === "remove" ? "noAsk" : "saves";
        const l = line(change.collection, a.action);
        l.steps.add(step.id);
        if (l.how === undefined || rank[how] > rank[l.how]) l.how = how;
        if (a.mode === "yes" && fromOutside.has(step.id)) l.outside = true;
        if (agent) l.byAgent = true;
      }
  }
  return [...lines]
    .map(([k, l]) => {
      const [collection, action] = JSON.parse(k) as [string, Ability["action"]];
      return {
        collection,
        action,
        ...(l.how ? { how: l.how } : {}),
        ...(l.outside ? { outside: true as const } : {}),
        ...(l.byAgent ? { byAgent: true as const } : {}),
        steps: [...l.steps].sort(byCodeUnit),
      };
    })
    .sort(
      (x, y) =>
        byCodeUnit(x.collection, y.collection) ||
        ACTION_ORDER.indexOf(x.action) - ACTION_ORDER.indexOf(y.action),
    );
}

/**
 * The steps that can receive something from outside (AU-182, decision 11), computed from the graph without running
 * anything: a step whose path (the steps its rows come from and that decide whether it runs, P15, and the steps it
 * cites, with theirs) holds an outside source or a read of a collection in `outside`. The step's own reads count: a
 * «Código» that reads one, a «Colección» that searches one («Las que cumplan…» decides what it writes by it).
 */
function outsideSteps(automation: Automation, outside: ReadonlySet<string>): Set<string> {
  const byId = new Map(automation.steps.map((s) => [s.id, s]));
  const byName = new Map(automation.steps.map((s) => [s.name, s.id]));
  const into = new Map<string, Set<string>>();
  const link = (to: string, from: string) => {
    if (from === to) return;
    const set = into.get(to) ?? new Set<string>();
    set.add(from);
    into.set(to, set);
  };
  for (const r of automation.arrows) link(r.to.step, r.from.step);
  for (const s of automation.steps)
    for (const name of citedSteps(s)) {
      const id = byName.get(name);
      if (id) link(s.id, id);
    }
  const reads = new Map<string, boolean>();
  for (const s of automation.steps) reads.set(s.id, readsOutside(s, outside));
  const out = new Set<string>();
  for (const s of automation.steps) {
    const seen = new Set<string>([s.id]);
    const todo = [s.id];
    while (todo.length) {
      const id = todo.pop() as string;
      if (reads.get(id)) {
        out.add(s.id);
        break;
      }
      for (const from of into.get(id) ?? [])
        if (!seen.has(from) && byId.has(from)) {
          seen.add(from);
          todo.push(from);
        }
    }
  }
  return out;
}

/** Whether a step itself is a source of outside values, or reads a collection that holds some. */
function readsOutside(step: Step, outside: ReadonlySet<string>): boolean {
  if (OUTSIDE_SOURCES.has(step.type)) return true;
  for (const p of permissions(step.connections ?? []))
    if (p.action === "read" && outside.has(p.collection)) return true;
  const collection = step.params.collection;
  const action = actionOf(step);
  if (typeof collection !== "string" || !action || !outside.has(collection)) return false;
  return action.effect === "read" || step.params.target === "matching";
}

/** The names of the steps a step cites, in its expressions and in its JavaScript. */
function citedSteps(step: Step): Set<string> {
  const out = new Set<string>();
  const walk = (v: ParamValue | undefined) => {
    if (v === undefined || v === null) return;
    if (isExpr(v)) {
      for (const c of citationsIn(v)) if (c.step !== null) out.add(c.step);
      for (const part of codeParts(v.expr).parts)
        for (const s of readCode(part.source, "expression").steps) out.add(s.name);
      return;
    }
    if (Array.isArray(v)) for (const x of v) walk(x);
    else if (typeof v === "object") for (const x of Object.values(v)) walk(x as ParamValue);
  };
  for (const [k, v] of Object.entries(step.params)) {
    if (step.type === CODE_TYPE && k === CODE_PARAMS.source && typeof v === "string") {
      for (const s of readCode(v, "code").steps) out.add(s.name);
      continue;
    }
    walk(v);
  }
  if (step.type === AGENT_TYPE)
    for (const source of agentSources(step))
      for (const s of readCode(source, "code").steps) out.add(s.name);
  return out;
}

// ---------------------------------------------------------------- the names a version keeps

/** By step id, each name its code cites a collection by and the key it was when the version was published. */
export type KeptNames = Record<string, Record<string, string>>;

/**
 * What a version keeps of the names its code cites (AU-192), taken when it is published: for each «Código» (and each
 * «Agente»'s own code, AU-51, AU-58), each
 * `$col('…')` name with the key it has now, only for a collection that step is connected to. At a run the name is
 * looked up there first, so a renamed collection is still the same one; it never widens, since the key must still be
 * one of the step's connections.
 */
export function keptNames(
  automation: Automation,
  collectionNamed: (name: string) => string | undefined,
): KeptNames {
  const out: KeptNames = {};
  for (const step of [...automation.steps].sort((a, b) => byCodeUnit(a.id, b.id))) {
    const source = step.params[CODE_PARAMS.source];
    const sources =
      step.type === CODE_TYPE && typeof source === "string"
        ? [source]
        : step.type === AGENT_TYPE
          ? agentSources(step)
          : [];
    if (!sources.length) continue;
    const connected = new Set((step.connections ?? []).map((c) => c.collection));
    const names: Record<string, string> = {};
    for (const c of sources.flatMap((x) => readCode(x, "code").collections)) {
      const key = collectionNamed(c.name);
      if (key !== undefined && connected.has(key)) names[c.name] = key;
    }
    if (Object.keys(names).length) out[step.id] = names;
  }
  return out;
}

/**
 * A step's names as a run resolves them (AU-192): the kept key first, while it is still one of the step's
 * connections, and else the name as it is now.
 */
export function namedFor(
  step: Step,
  kept: KeptNames,
  now: (name: string) => string | undefined,
): (name: string) => string | undefined {
  const connected = new Set((step.connections ?? []).map((c) => c.collection));
  return (name) => {
    const key = kept[step.id]?.[name];
    return key !== undefined && connected.has(key) ? key : now(name);
  };
}
