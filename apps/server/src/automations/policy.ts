/**
 * The engine's `Policy` over `decide` (docs/automatizaciones.md §6, AU-168; A-01, A-26; phase F14b). F14a asked a
 * test policy; this is the real one. Every read and every write of a step becomes one `Call` of the policy engine:
 *
 * - what is judged comes from the step's action in the catalogue (AU-19), as the gate passes it on: whether it reads
 *   or writes and whether it destroys, and no other list. The act is told to `decide` as a tool shaped like the one
 *   of the list of actions (`ACTIONS`) that does the same to a record, with the same effect, arguments and roles:
 *   reading rows (`entities.query`), one row (`entities.get`), creating (`entities.create`), modifying
 *   (`entities.update`) and sending to the trash (`entities.delete`, which the policy asks about: P5). A test holds
 *   each pair together, origin by origin, so nothing an automation does is judged by another rule than the same act
 *   anywhere else;
 * - the arguments are `PolicyCall.values`, each with its own label, named as the list's action names them: the fields
 *   written in one `values` record, the values of the conditions in one `equals`, a row's id as `id`, and the
 *   collection by its key as `type` (labelled as what Juan wrote) where that action takes one; `control` is the label of the path (AU-164); `rows`, how many rows the call writes (P11 counts each);
 * - `flow: true` (a saved automation, not a plan a model wrote) and `dry: PolicyCall.test`;
 * - the origin is `automation` (P28) for every run of a version, for real or in its test, whoever started it: who
 *   started it never reaches `decide` (AU-195, A-36). `hand` (P25) is not used for a run any more;
 * - with every call, `yes`: whether the document this policy was made over says «Sí» for that step, collection and
 *   action (`consentOf`, AU-186, AU-187). The server reads that document from its store; nothing in the call (the
 *   box's answer, a request) can claim one (AU-188). The trash keeps `alwaysConfirm`, as the list's action does: for
 *   this origin `decide` lifts it only with that «Sí» (P5's new sentence).
 *
 * One counter per run, kept here: every write the policy lets through counts, test or not, and the policy's own limit
 * (P11) counts over the whole run of an origin it applies to (not `automation`: its cap is the run's own, AU-17).
 * A decision is passed on as it is: this module never turns a «no» into a «sí», and adds no rule.
 */
import { decide, type Origin, type ToolDef, type Val } from "@boni/agent";
import {
  type Automation,
  consentOf,
  type Decision,
  type Labelled,
  type Policy,
  type PolicyCall,
  type WriteAction,
} from "@boni/automations";
import { join, type Label } from "@boni/entities";

/** The run's counters, as `decide` reads them. */
export interface RunCount {
  writes: number;
  sensitiveReads: number;
}

const ENTITY = { role: "entity", describe: "the row" } as const;
/** A tool here is only judged: the engine does the act through the gate, never this. */
const judgedOnly = (): never => {
  throw new Error("an automation's act is done by its engine, not by a tool");
};
const TYPE = { role: "type", describe: "the collection" } as const;

/** Each act of a step, as the list's action that does the same to a record is told to the policy. */
export const ACTS: Readonly<Record<"query" | "get" | "create" | "update" | "trash", ToolDef>> = {
  query: {
    name: "entities.query",
    title: "Buscar filas",
    run: judgedOnly,
    effect: "read",
    area: "data",
    describe: "an automation's step reads rows of a collection",
    args: { type: TYPE, equals: { role: "value", describe: "the conditions' values" } },
  },
  get: {
    name: "entities.get",
    title: "Leer una fila",
    run: judgedOnly,
    effect: "read",
    area: "data",
    describe: "an automation's step reads one row",
    args: { id: ENTITY },
  },
  create: {
    name: "entities.create",
    title: "Crear una fila",
    run: judgedOnly,
    effect: "write",
    area: "data",
    describe: "an automation's step creates a row",
    args: { type: TYPE, values: { role: "content", describe: "the fields" } },
    undo: ["run", "screen"],
  },
  update: {
    name: "entities.update",
    title: "Modificar filas",
    run: judgedOnly,
    effect: "write",
    area: "data",
    describe: "an automation's step modifies a row",
    args: { id: ENTITY, values: { role: "content", describe: "the fields" } },
    undo: ["run"],
  },
  trash: {
    name: "entities.delete",
    title: "Eliminar filas",
    run: judgedOnly,
    effect: "write",
    area: "data",
    describe: "an automation's step sends a row to the trash",
    args: { id: ENTITY },
    alwaysConfirm: true,
    undo: ["trash"],
  },
};

/** Which act a call of the gate is: a write with no row known before is a new one (`rows` absent). */
export function actOf(call: PolicyCall): keyof typeof ACTS {
  if (call.effect === "read") return "id" in call.values ? "get" : "query";
  if (call.destroys) return "trash";
  return call.rows === undefined ? "create" : "update";
}

const val = (v: Labelled[string]): Val => ({
  t: "v",
  value: v.value as Extract<Val, { t: "v" }>["value"],
  label: v.label,
  derived: v.derived,
});

/** The arguments of a call, as `decide` reads them for the list's action (`own`: the collection key's label). */
export function argsOf(call: PolicyCall, own: Label): Record<string, Val> {
  const act = actOf(call);
  const args: Record<string, Val> = {};
  if (act === "query" || act === "create")
    args.type = { t: "v", value: call.collection, label: own, derived: false };
  const { id, ...rest } = call.values;
  if (id && act === "get") args.id = val(id);
  const fields = Object.entries(rest);
  if (fields.length && act !== "trash" && act !== "get") {
    const vals = Object.fromEntries(fields.map(([k, v]) => [k, val(v)]));
    const labels = fields.map(([, v]) => v.label);
    args[act === "query" ? "equals" : "values"] = {
      t: "rec",
      fields: vals,
      label: join(labels[0] as Label, ...labels.slice(1)),
      derived: fields.some(([, v]) => v.derived),
    };
  }
  return args;
}

/** The origin of every run of an automation and of its test (P28, A-36): one, whoever starts it; `trust` is not read. */
export const AUTOMATION: Origin = { kind: "automation", trust: "personal" };

const WRITES: Readonly<Record<"create" | "update" | "trash", WriteAction>> = {
  create: "create",
  update: "update",
  trash: "remove",
};

/**
 * Whether `doc`, as the server keeps it, says «Sí» for what a call writes (AU-186): its step's connection cell, or
 * the «Permiso» of a «Colección» step (AU-187). A call of another automation or version, a step `doc` does not have,
 * a read, or no document at all, is no «Sí».
 */
export function consentIn(doc: Automation | undefined): (call: PolicyCall) => boolean {
  return (call) => {
    if (!doc || call.effect !== "write") return false;
    if (call.automation.id !== doc.id || call.automation.version !== doc.version) return false;
    const step = doc.steps.find((s) => s.id === call.step);
    if (!step) return false;
    const act = actOf(call);
    return act in WRITES
      ? consentOf(step, call.collection, WRITES[act as keyof typeof WRITES]) === "yes"
      : false;
  };
}

/**
 * The policy of one run from `origin`: make one per run, never share it between two (its counter is the run's).
 * `yes`: what the server read of the «Sí» for each write (`consentIn`); none without it.
 */
export function runPolicy(
  origin: Origin,
  own: Label,
  yes: (call: PolicyCall) => boolean = () => false,
): Policy & { count: RunCount } {
  const count: RunCount = { writes: 0, sensitiveReads: 0 };
  return {
    count,
    decide(call): Decision {
      const d = decide(
        {
          tool: ACTS[actOf(call)],
          args: argsOf(call, own),
          control: call.control,
          flow: true,
          dry: call.test,
          ...(call.rows !== undefined ? { rows: call.rows } : {}),
          yes: yes(call),
        },
        origin,
        count,
      );
      if (call.effect === "write" && d.kind === "allow")
        count.writes += Math.max(1, call.rows ?? 1);
      return d;
    },
  };
}

/**
 * The policy of one run of `doc`, or of its test (P28): the origin `automation`, the «Sí» read from `doc` as the
 * server keeps it. Make one per run, never share it between two.
 */
export function automationPolicy(
  doc: Automation | undefined,
  own: Label,
): Policy & { count: RunCount } {
  return runPolicy(AUTOMATION, own, consentIn(doc));
}
