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
 * - the origin is who started the run. In F14b there is one: Juan's hand on «Probar» in his editor, `{ kind:
 *   "hand", trust, device }`. The origin of a run that starts alone arrives with F14d (AU-167).
 *
 * One counter per run, kept here: every write the policy lets through counts, test or not, and the policy's own limit
 * (P11) counts over the whole run. By Juan's hand `decide` answers P25 and counts nothing: his own tap is the
 * confirmation the limit would ask for.
 * A decision is passed on as it is: this module never turns a «no» into a «sí», and adds no rule.
 */
import { decide, type Origin, type ToolDef, type Trust, type Val } from "@boni/agent";
import type { Decision, Labelled, Policy, PolicyCall } from "@boni/automations";
import { join, type Label } from "@boni/entities";

export interface PolicyFor {
  trust: Trust;
  device: string;
  /** The label of what Juan wrote in the automation: the collection's key a step names. */
  own: Label;
}

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

/** The policy of one run from `origin`: make one per run, never share it between two (its counter is the run's). */
export function runPolicy(origin: Origin, own: Label): Policy & { count: RunCount } {
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

/** The policy of one run started by Juan's hand: make one per run, never share it between two. */
export function handPolicy(who: PolicyFor): Policy & { count: RunCount } {
  return runPolicy({ kind: "hand", trust: who.trust, device: who.device }, who.own);
}
