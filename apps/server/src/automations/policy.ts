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
 *   box's answer, a request) can claim one (AU-188). The trash carries no fixed `alwaysConfirm` (AU-186): it is told
 *   to `decide` with it, as the list's action is, only when that «Sí» is not there (`actTool`), so without it P5
 *   confirms as before, and with it P28 saves (P5's new sentence).
 *
 * One counter per run, kept here: every write the policy lets through counts, test or not, and the policy's own limit
 * (P11) counts over the whole run of an origin it applies to (not `automation`: its cap is the run's own, AU-17).
 * A decision is passed on as it is: this module never turns a «no» into a «sí», and adds no rule.
 */
import {
  decide,
  leaf,
  type Origin,
  type PolicyRequest,
  type ReachAction,
  type ReachLimits,
  type StepReach,
  type ToolDef,
  type Val,
} from "@boni/agent";
import {
  AGENT_PARAMS,
  AGENT_TYPE,
  type Automation,
  type Connection,
  chatPageOf,
  chatStarted,
  consentOf,
  type Decision,
  type Labelled,
  type Notice,
  PAGE_ACTIONS,
  type PageAbility,
  type Policy,
  type PolicyCall,
  pageAbilitiesOf,
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
    undo: ["trash"],
  },
};

/** The trash as `decide` is told it without the version's «Sí»: the list's action, which Juan confirms (P5). */
const TRASH_CONFIRMED: ToolDef = { ...ACTS.trash, alwaysConfirm: true };

/**
 * The act of one call as `decide` is told it (AU-186): the trash carries P5's confirmation unless `yes`, the «Sí» the
 * server read of the version it keeps (`consentIn`); nothing in the call can say it. The other acts are as listed.
 */
export function actTool(act: keyof typeof ACTS, yes: boolean): ToolDef {
  return act === "trash" && !yes ? TRASH_CONFIRMED : ACTS[act];
}

/**
 * «Avisar» as the policy is told it (AU-201, AU-246, F15): a call with no recipient. Its text is content, and «Dónde» and «Por dónde»
 * values of the step as saved, from closed lists of his own devices and surfaces: none is a destination (P2, P14).
 */
export const NOTICE: ToolDef = {
  name: "notify",
  title: "Avisar",
  run: judgedOnly,
  effect: "notify",
  area: "boni",
  describe: "an automation's step sends a notice to Juan's own devices",
  args: {
    text: { role: "content", required: true, describe: "the text" },
    where: { role: "value", describe: "which of his own devices" },
    via: {
      role: "value",
      describe: "by which of his own surfaces: the notification, the Bandeja or both",
    },
  },
};

/**
 * Whether a notice goes (decided overnight 2026-11-18, for Juan to confirm): every one passes through `decide` as a
 * call of the origin `automation` with no recipient, its text with its own label. Today that is P1's «sí»; a rule
 * that one day refuses a notice refuses it here too. The other way was the closed list of «Dónde» alone, with no
 * call of the policy.
 */
export function noticeDecision(notice: Notice, own: Label): Decision {
  return decide(
    {
      tool: NOTICE,
      // «Dónde» and «Por dónde» are the step's own, fixed as saved (AU-201, AU-246): the automation's label.
      args: {
        text: leaf(notice.text, notice.label),
        where: leaf(notice.where, own),
        via: leaf(notice.via.join(" "), own),
      },
      control: null,
      flow: true,
    },
    AUTOMATION,
    { writes: 0, sensitiveReads: 0 },
  );
}

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
 * a read, or no document at all, is no «Sí». Nor is any cell of an automation that starts in «Mensaje de chat»
 * (AU-137): under a page's chat every write asks, whatever its version says, so a «Sí» that reached it without
 * passing «Publicar» (an old version, a document no check read) writes nothing alone.
 */
export function consentIn(doc: Automation | undefined): (call: PolicyCall) => boolean {
  const chat = doc !== undefined && chatStarted(doc);
  return (call) => {
    if (!doc || chat || call.effect !== "write") return false;
    if (call.automation.id !== doc.id || call.automation.version !== doc.version) return false;
    const step = doc.steps.find((s) => s.id === call.step);
    if (!step) return false;
    const act = actOf(call);
    return act in WRITES
      ? consentOf(step, call.collection, WRITES[act as keyof typeof WRITES]) === "yes"
      : false;
  };
}

/** What P29 reads of the store besides the stored version (AU-166, AU-205): as the store is now. */
export interface ReachStore {
  /** Whether no model may read the collection (its level for models is not `visible`, AU-166). */
  privateTo(collection: string): boolean;
  /** Its fields' types by key, for the filters. */
  types(collection: string): Readonly<Record<string, string>>;
  /** The run's civil day in the person's zone. */
  today(): string;
}

type Reached = Pick<PolicyRequest, "byAgent" | "reach">;
const REACH_ACTS: Readonly<Record<keyof typeof ACTS, ReachAction>> = {
  query: "read",
  get: "read",
  create: "create",
  update: "update",
  trash: "remove",
};

/** A stored connection's cells as P29 reads them: each action «No» or its limits, a fixed value by its key only. */
export function cellsOf(c: Connection): Record<ReachAction, false | ReachLimits> {
  const limits = (o: {
    where?: ReachLimits["where"];
    fields?: readonly string[];
    fixed?: Record<string, unknown>;
    limit?: number;
  }): ReachLimits => ({
    ...(o.where ? { where: o.where } : {}),
    ...(o.fields ? { fields: o.fields } : {}),
    ...(o.fixed ? { fixed: Object.keys(o.fixed) } : {}),
    ...(o.limit !== undefined ? { limit: o.limit } : {}),
  });
  return {
    read: c.read && limits(c.read),
    create: c.create && limits(c.create),
    update: c.update && limits(c.update),
    remove: c.remove && limits(c.remove),
  };
}

/**
 * What an AI step's call carries to P29 (AU-204, AU-205), read from `doc` as the server keeps it and from the run:
 * whether an «Agente» chose it (`byAgent`: the stored step's type) and its reach (the stored step's connection with
 * that collection, the row it touches, the fields a read names, what the step has written with that action). Nothing
 * of it comes from a model, the box, a request or a browser. A call another automation's or version's, or of a step
 * `doc` does not have, is one the server cannot read a connection for: if the engine says it is an «Agente»'s, it
 * goes with no reach, and P29 denies it (`no-reach`). It can only refuse more.
 */
export function reachIn(
  doc: Automation | undefined,
  from: ReachStore,
): (call: PolicyCall) => Reached {
  const steps = new Map((doc?.steps ?? []).map((s) => [s.id, s]));
  return (call) => {
    const mine =
      doc && call.automation.id === doc.id && call.automation.version === doc.version
        ? steps.get(call.step)
        : undefined;
    const byAgent = mine ? mine.type === AGENT_TYPE : call.type === AGENT_TYPE;
    if (!byAgent) return {};
    if (!mine) return { byAgent: true };
    const action = REACH_ACTS[actOf(call)];
    const connection = (mine.connections ?? []).find((c) => c.collection === call.collection);
    const reach: StepReach = {
      collection: call.collection,
      action,
      private: from.privateTo(call.collection),
      cells: connection ? cellsOf(connection) : null,
      ...(action === "read"
        ? { fields: call.fields ?? [] }
        : { row: call.row === undefined ? null : call.row }),
      types: from.types(call.collection),
      today: from.today(),
      written: call.written ?? 0,
    };
    return { byAgent: true, reach };
  };
}

/**
 * «Esta página» (AU-137, F16 S2c): each call of a chat's «Agente» on its page, told to `decide` as the list's page
 * action that does the same (pageActions.ts), with the same effect, arguments and roles: reading a block's figures,
 * putting a value in a control, adding a block. A test holds each pair together.
 */
const PAGE_ARG = { role: "page", required: true, describe: "the page" } as const;
export const PAGE_ACTS: Readonly<Record<PageAbility, ToolDef>> = {
  figures: {
    name: "pages.figures",
    title: "Leer cifras",
    run: judgedOnly,
    effect: "read",
    area: "pages",
    describe: "a chat's «Agente» reads one block of its page as the screen shows it",
    args: { page: PAGE_ARG, block: { role: "option", required: true, describe: "the block" } },
  },
  value: {
    name: "pages.set_value",
    title: "Cambiar valor",
    run: judgedOnly,
    effect: "write",
    area: "pages",
    describe: "a chat's «Agente» changes what one of its page's controls holds",
    args: {
      page: PAGE_ARG,
      control: { role: "option", required: true, describe: "the control" },
      value: { role: "value", required: true, describe: "what it holds" },
    },
    undo: ["run"],
  },
  block: {
    name: "pages.add_block",
    title: "Añadir bloque",
    run: judgedOnly,
    effect: "write",
    area: "pages",
    describe: "a chat's «Agente» adds a block at the end of its page",
    args: { page: PAGE_ARG, block: { role: "definition", required: true, describe: "the block" } },
    undo: ["run"],
  },
};

/**
 * The one place where Juan's «yes» to a page change made alone goes (AU-137): the abilities whose change a chat's
 * «Agente» saves without asking. Empty, the narrower reading (2026-11-19): a value of the page's own control is asked
 * too, as a block is, in the run's proposal. AU-137's «pone un valor en un control suyo (P27) sin preguntar» is
 * Juan's to decide; his «yes» is `["value"]` here, and the test «PAGE_ALONE» flips with it.
 */
export const PAGE_ALONE: readonly PageAbility[] = [];

/** What the server reads of the page a run's chat lives in, as the store is now (P26). */
export interface PageScope {
  /** The page the stored version's «Mensaje de chat» names. */
  page: string;
  /** The collections that page shows, by id (pageChat.ts `pageTypes`). */
  types: readonly string[];
  /** A collection's id by its key, as a block names it; null: none a model may see. */
  typeIdOf(key: string): string | null;
}

type PageRequest = Pick<PolicyRequest, "tool" | "args" | "scope" | "typeIds" | "yes">;

/**
 * A page call of `doc`'s run as `decide` reads it (AU-137), or null when the server cannot read one: an action that is
 * no page ability, a call of another automation or version, of a step `doc` does not have or whose «Esta página»
 * does not give it, or a version with no chat. Its scope (P26) is the stored version's: that step's abilities, the
 * page its «Mensaje de chat» names and the collections that page shows; the page the call names is an argument
 * checked against it, never the scope. `alone`: `PAGE_ALONE`, the «yes» of a change.
 */
export function pageRequest(
  doc: Automation | undefined,
  at: PageScope | undefined,
  call: PolicyCall,
  own: Label,
  alone: readonly PageAbility[] = PAGE_ALONE,
): PageRequest | null {
  const ability = (Object.keys(PAGE_ACTIONS) as PageAbility[]).find(
    (k) => PAGE_ACTIONS[k] === call.action,
  );
  if (!ability || call.page === undefined || !doc || !at) return null;
  if (call.automation.id !== doc.id || call.automation.version !== doc.version) return null;
  const step = doc.steps.find((s) => s.id === call.step);
  const stored = chatPageOf(doc);
  if (!step || step.type !== AGENT_TYPE || !stored || stored !== at.page) return null;
  const tool = PAGE_ACTS[ability];
  const args: Record<string, Val> = {
    page: { t: "v", value: call.page, label: own, derived: false },
  };
  for (const [k, v] of Object.entries(call.values)) args[k] = val(v);
  const typeIds: Record<string, string | null> = {};
  const block = call.values.block?.value;
  if (ability === "block" && block && typeof block === "object" && "collection" in block) {
    const key = (block as { collection?: unknown }).collection;
    typeIds["block.collection"] = typeof key === "string" ? at.typeIdOf(key) : null;
  }
  const abilities = pageAbilitiesOf(step.params[AGENT_PARAMS.page]) ?? [];
  return {
    tool,
    args,
    scope: { actions: abilities.map((a) => PAGE_ACTS[a].name), page: stored, types: at.types },
    typeIds,
    yes: tool.effect === "write" && alone.includes(ability),
  };
}

/**
 * The policy of one run from `origin`: make one per run, never share it between two (its counter is the run's).
 * `yes`: what the server read of the «Sí» for each write (`consentIn`); none without it. `reached`: what an AI step's
 * call carries to P29 (`reachIn`).
 */
export function runPolicy(
  origin: Origin,
  own: Label,
  yes: (call: PolicyCall) => boolean = () => false,
  reached: (call: PolicyCall) => Reached = () => ({}),
  paged: (call: PolicyCall) => PageRequest | null = () => null,
): Policy & { count: RunCount } {
  const count: RunCount = { writes: 0, sensitiveReads: 0 };
  return {
    count,
    decide(call): Decision {
      // A page call (AU-137) is judged as its page action, within the stored chat's scope (P26), or not at all.
      if (call.page !== undefined) {
        const p = paged(call);
        if (!p) return { kind: "deny", rule: "P26", reason: "not-the-chats-page" };
        const d = decide(
          { ...p, control: call.control, flow: true, dry: call.test },
          origin,
          count,
        );
        if (call.effect === "write" && d.kind === "allow") count.writes += 1;
        return d;
      }
      const said = yes(call);
      const d = decide(
        {
          tool: actTool(actOf(call), said),
          args: argsOf(call, own),
          control: call.control,
          flow: true,
          dry: call.test,
          ...(call.rows !== undefined ? { rows: call.rows } : {}),
          yes: said,
          ...reached(call),
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
  from?: ReachStore,
  page?: PageScope,
): Policy & { count: RunCount } {
  return runPolicy(AUTOMATION, own, consentIn(doc), from ? reachIn(doc, from) : undefined, (call) =>
    pageRequest(doc, page, call, own),
  );
}
