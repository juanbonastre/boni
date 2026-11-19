/**
 * The proposal of an automation's run (docs/automatizaciones.md AU-193, AU-186, AU-170; phase F14d S3). What a run
 * asked instead of saving («Preguntar», a removal to confirm, a value the policy holds) is one proposal in the inbox,
 * one per run, never one per row: `proposeRun`, when the run ends. Juan accepts it or rejects it; Boni never accepts
 * it on its own (autoAccept.ts takes only `entities.create`, AU-186).
 *
 * Accepting it is the action `automations.accept_run`, which only the acceptance of the proposal may call (P28,
 * `acceptsRun`): it saves every change the run asked, all or nothing in one transaction, with the run's id, so
 * «Deshacer lo que hizo» takes it back with the rest of the run (AU-18). Each value is saved with the label it had
 * when it was asked (AU-170): what came from outside stays from outside. A row changed since the run asked makes the
 * proposal stale, and nothing is saved. The inbox's own «Deshacer» does not take an acceptance back: the run's does
 * (`Agent.restoreProposal`).
 *
 * The proposal's view is code's text over his data: the automation's name, the counts of what it would save and the
 * first changes, each value with where it came from. Every value is painted as plain text.
 */

import { randomUUID } from "node:crypto";
import {
  type ConfirmView,
  codeLabel,
  confirmView,
  type Json,
  leaf,
  plain,
  readStore,
  rec,
  type ToolDef,
  ToolError,
  type ToolRegistry,
  type Val,
} from "@boni/agent";
import {
  AGENT_TYPE,
  type Asked,
  BONI_TRIGGERS,
  type Cell,
  type Labelled,
  parseAutomation,
  StepFault,
} from "@boni/automations";
import { type Label, label } from "@boni/entities";
import { StoreError, type UserStore } from "@boni/store";
import { ACCEPT_RUN, ROWS_AS_CARDS } from "./acceptRunName.ts";
import { storeCollections } from "./collections.ts";
import { ASKED_STEP } from "./record.ts";
import { automationLabel } from "./service.ts";

export { ACCEPT_RUN, ROWS_AS_CARDS };

/** How many changes the proposal's view carries; the rest are read a page at a time (`askedOf`). */
export const PROPOSAL_FIRST = 20;

/** One change a run asked, as the inbox shows it: never its labels' text, only where each value came from. */
export interface AskedView {
  step: string;
  /**
   * The step that asks is an «Agente» in the version that ran: what it changes an AI chose («lo decidió la IA», AU-42,
   * AU-200). Read from that version as kept, never from the change.
   */
  byAgent: boolean;
  /** `confirm`: a removal; `propose`: a create or a change. */
  kind: Asked["kind"];
  action: "create" | "update" | "trash";
  /** The collection's key, and its name now. */
  collection: string;
  name: string | null;
  /** The row it changes or removes, with its title now. */
  row: { id: string; title: string } | null;
  /** The values it would save, each with what the row holds now (a change's before) and whether it came from outside (AU-170). */
  values: Record<string, { value: Cell; before?: Cell; integrity: string; outside: boolean }>;
}

/** What the proposal of a run says, beside the inbox's `ConfirmView`. */
export interface RunProposalView extends ConfirmView {
  run: {
    automation: string;
    name: string;
    version: number | null;
    run: string;
    startedBy: string;
    /** How many changes it asked, and how many of each collection and action. */
    count: number;
    counts: { collection: string; name: string | null; action: AskedView["action"]; n: number }[];
    first: AskedView[];
    /** The proposal is one card of one row (AU-251): that row's index in what the run asked. */
    row?: number;
  };
}

const actionOf = (a: Asked): AskedView["action"] =>
  a.change.kind === "create" ? "create" : a.change.kind === "update" ? "update" : "trash";
const collectionOf = (store: UserStore, a: Asked): string => {
  if (a.change.kind === "create") return a.change.collection;
  const e = store.get(a.change.row.id);
  const t = e ? store.schema().types[e.entity.type] : undefined;
  return t?.key ?? "";
};
const nameOf = (store: UserStore, key: string): string | null =>
  Object.values(store.schema().types).find((t) => t.key === key)?.name ?? null;
const titleOf = (store: UserStore, id: string): string => {
  const e = store.get(id);
  const def = e ? store.schema().types[e.entity.type] : undefined;
  const v = def && e ? e.entity.values[def.titleField] : undefined;
  return typeof v === "string" ? v : "";
};
const isOutside = (l: Labelled[string]["label"]) => l.integrity === "external";

/** What a row holds now in a field, by the field's key. */
function nowOf(store: UserStore, id: string, key: string): Cell | undefined {
  const e = store.get(id);
  const def = e ? store.schema().types[e.entity.type] : undefined;
  const f = def?.fields.find((x) => x.key === key);
  return f && e ? ((e.entity.values[f.id] ?? null) as Cell) : undefined;
}

/** The «Agente» steps of the version a run ran, as kept (a test's draft is kept in its run). */
function agentStepsOf(store: UserStore, run: string): ReadonlySet<string> {
  const r = store.journal.automationRun(run);
  const kept = r?.version != null ? store.journal.automationVersion(r.automation, r.version) : null;
  const doc = kept?.doc ?? r?.doc ?? null;
  if (!doc) return new Set();
  try {
    return new Set(
      parseAutomation(JSON.parse(doc))
        .steps.filter((s) => s.type === AGENT_TYPE)
        .map((s) => s.id),
    );
  } catch {
    return new Set();
  }
}

function viewOf(store: UserStore, a: Asked, agents: ReadonlySet<string>): AskedView {
  const collection = collectionOf(store, a);
  const fields = a.change.kind === "trash" ? {} : a.change.fields;
  const row = a.change.kind === "update" ? a.change.row.id : null;
  return {
    step: a.step,
    byAgent: agents.has(a.step),
    kind: a.kind,
    action: actionOf(a),
    collection,
    name: nameOf(store, collection),
    row:
      a.change.kind === "create"
        ? null
        : { id: a.change.row.id, title: titleOf(store, a.change.row.id) },
    values: Object.fromEntries(
      Object.keys(fields).map((k) => {
        const v = a.values[k];
        const before = row ? nowOf(store, row, k) : undefined;
        return [
          k,
          {
            value: (v?.value ?? fields[k]) as Cell,
            ...(before !== undefined ? { before } : {}),
            integrity: v?.label.integrity ?? "own",
            outside: v ? isOutside(v.label) : false,
          },
        ];
      }),
    ),
  };
}

/** What a run asked, as it kept it (record.ts `keepAsked`): `offset` and `limit` page it. */
function askedRows(store: UserStore, run: string, offset = 0, limit?: number): Asked[] {
  const step = store.journal.automationRunSteps(run).find((s) => s.step === ASKED_STEP);
  if (!step) return [];
  const total = (JSON.parse(step.record) as { asked: number }).asked;
  return store.journal
    .automationRunRows(run, ASKED_STEP, "asked", offset, limit ?? total)
    .map((x) => (typeof x === "string" ? JSON.parse(x) : x) as Asked);
}

/**
 * The cells a run's proposal asks for (AU-207): each step, collection and action once, whatever the rows; a removal
 * is the cell's `remove`. What Juan answers of the proposal is one decision of each.
 */
export function askedCells(
  store: UserStore,
  run: string,
  /** Only the cell of this row of it (one row's card, AU-251). */
  row?: number,
): { step: string; collection: string; action: "create" | "update" | "remove" }[] {
  const seen = new Map<
    string,
    { step: string; collection: string; action: "create" | "update" | "remove" }
  >();
  const all = askedRows(store, run);
  for (const a of row === undefined ? all : all.slice(row, row + 1)) {
    const collection = collectionOf(store, a);
    const act = actionOf(a);
    const action = act === "trash" ? "remove" : act;
    const k = `${a.step}\u0000${collection}\u0000${action}`;
    if (collection && !seen.has(k)) seen.set(k, { step: a.step, collection, action });
  }
  return [...seen.values()];
}

/** A page of what a run asked (the proposal's «Ver todo»): 50 from `offset`, and how many there are. */
export function askedOf(
  store: UserStore,
  run: string,
  offset: number,
): { asked: AskedView[]; total: number } | null {
  const r = store.journal.automationRun(run);
  if (!r) return null;
  const step = store.journal.automationRunSteps(run).find((s) => s.step === ASKED_STEP);
  const total = step ? (JSON.parse(step.record) as { asked: number }).asked : 0;
  const agents = agentStepsOf(store, run);
  return {
    asked: askedRows(store, run, offset, 50).map((a) => viewOf(store, a, agents)),
    total,
  };
}

/** The mail a run started with, when its trigger is Boni's «Llega un correo»: its card says where it came from (AU-251). */
export function triggerMail(store: UserStore, run: string): string | null {
  const r = store.journal.automationRun(run);
  const kept = r?.version != null ? store.journal.automationVersion(r.automation, r.version) : null;
  const doc = kept?.doc ?? r?.doc ?? null;
  if (!r || !doc) return null;
  try {
    const trigger = parseAutomation(JSON.parse(doc)).steps.find((s) => s.id === r.trigger);
    if (trigger?.type !== BONI_TRIGGERS.mail) return null;
    const id = (JSON.parse(r.fields ?? "{}") as { id?: unknown }).id;
    return typeof id === "string" && store.get(id) ? id : null;
  } catch {
    return null;
  }
}

/** What a row's card says (AU-251): the rows of a proposal to create, as the agent's own card of one says them. */
const ROW_TOOL = {
  args: { type: { role: "type" }, values: { role: "value" } },
} as unknown as ToolDef;
function rowCardRows(store: UserStore, a: Asked): RunProposalView["rows"] {
  if (a.change.kind !== "create") return [];
  const code = codeLabel("automations");
  const fields: Record<string, Val> = {};
  for (const [k, v] of Object.entries(a.change.fields)) {
    if (v === null || v === undefined) continue;
    const l = a.values[k];
    fields[k] = leaf((l?.value ?? v) as Json, l?.label ?? code);
  }
  return confirmView(
    ROW_TOOL,
    { type: leaf(a.change.collection, code), values: rec(fields, code) },
    readStore(store),
  ).rows;
}

/**
 * The proposal in the inbox for what a run asked (AU-193): kept as the agent keeps one made by code outside a turn
 * (`Agent.propose`): a run of its own, origin `automation`, that proposed; the automation's run names it. Its
 * arguments are the run's ids, the code's; what it saves is read from the run when it is accepted. When all it asks
 * is to create `ROWS_AS_CARDS` rows or fewer, each row is its own proposal of that one agent run (AU-251), its view
 * the rows of a proposal to create, so the inbox paints the card of always; the run names the first, and the store
 * keeps the run whole while any of them waits. Returns the first.
 */
export function proposeRun(
  store: UserStore,
  id: string,
  run: string,
  asked: readonly Asked[],
): string {
  const journal = store.journal;
  const r = journal.automationRun(run);
  // Its name as the version that ran says it.
  const kept = r?.version != null ? journal.automationVersion(id, r.version) : null;
  const name = kept ? String((JSON.parse(kept.doc) as { name?: unknown }).name ?? "") : "";
  const at = Date.now();
  const agentRun = randomUUID();
  const countsOf = (rows: readonly Asked[]) => {
    const counts = new Map<
      string,
      { collection: string; name: string | null; action: AskedView["action"]; n: number }
    >();
    for (const a of rows) {
      const collection = collectionOf(store, a);
      const action = actionOf(a);
      const k = `${collection}\u0000${action}`;
      const c = counts.get(k) ?? { collection, name: nameOf(store, collection), action, n: 0 };
      c.n++;
      counts.set(k, c);
    }
    return [...counts.values()];
  };
  const code = codeLabel("automations");
  const agents = agentStepsOf(store, run);
  const sourcesOf = (rows: readonly Asked[]) => {
    const sources = new Set<string>();
    for (const a of rows)
      for (const v of Object.values(a.values))
        for (const s of v.label.sources) sources.add(`${s.kind}:${s.id}`);
    return [...sources];
  };
  const perRow =
    asked.length <= ROWS_AS_CARDS &&
    asked.every((a) => a.kind === "propose" && a.change.kind === "create");
  const mail = perRow ? triggerMail(store, run) : null;
  journal.startRun({
    id: agentRun,
    turn: null,
    origin: "automation",
    device: null,
    started: at,
    // The mail it read: each row's card says where it came from, as a mail's proposal of before (inboxCard.ts).
    ...(mail ? { input: mail } : {}),
  });
  const base = {
    automation: id,
    name,
    version: r?.version ?? null,
    run,
    startedBy: r?.startedBy ?? "schedule",
  };
  const add = (rows: readonly Asked[], row: number | null): string => {
    const proposal = randomUUID();
    const view: RunProposalView = {
      tool: ACCEPT_RUN,
      title: "Guardar lo que propuso una automatización",
      rows: row === null ? [] : rowCardRows(store, rows[0] as Asked),
      run: {
        ...base,
        count: rows.length,
        counts: countsOf(rows),
        first: rows.slice(0, PROPOSAL_FIRST).map((a) => viewOf(store, a, agents)),
        ...(row === null ? {} : { row }),
      },
    };
    journal.addProposal({
      id: proposal,
      run: agentRun,
      tool: ACCEPT_RUN,
      args: {
        values: {
          automation: leaf(id, code),
          run: leaf(run, code),
          ...(row === null ? {} : { row: leaf(String(row), code) }),
        },
        origins: [],
      },
      view,
      sources: sourcesOf(rows),
      created: at,
    });
    return proposal;
  };
  const ids = perRow ? asked.map((a, i) => add([a], i)) : [add(asked, null)];
  journal.finishRun(agentRun, "proposed", null, at);
  const first = ids[0] as string;
  journal.setAutomationRunProposal(run, first);
  return first;
}

/**
 * Saves what a run asked (AU-193), all or nothing, with the run's id (AU-18) and each value's label (AU-170).
 * `row`: only that row of it, its proposal being one card of one row (AU-251); the others go on waiting. `edits`:
 * what Juan corrected of that row before accepting it, by field key (null takes a value out), saved as his.
 * `stale`: the run was undone, or a row it changes changed since; nothing is saved.
 */
export async function acceptRun(
  store: UserStore,
  id: string,
  run: string,
  who: { device: string | null; zone: string },
  o: { row?: number; edits?: Record<string, Json | null>; mine?: Label } = {},
): Promise<{ saved: number }> {
  const r = store.journal.automationRun(run);
  if (!r || r.automation !== id || r.test) throw new ToolError("not-found");
  if (r.undone !== null) throw new ToolError("stale");
  let asked = askedRows(store, run);
  if (o.row !== undefined) {
    const one = asked[o.row];
    if (!one || one.change.kind !== "create") throw new ToolError("not-found");
    const mine = o.mine ?? label("user", "personal", [{ kind: "user-edit", id: run }]);
    asked = [o.edits ? edited(store, one, o.edits, mine) : one];
  } else if (o.edits) throw new ToolError("edit-not-allowed");
  if (!asked.length) return { saved: 0 };
  const collections = storeCollections(store, {
    actor: "user",
    device: who.device,
    zone: who.zone,
    own: automationLabel(id),
    run,
  });
  try {
    await collections.applyAll(asked.map((a) => ({ change: a.change, values: a.values })));
  } catch (e) {
    // A row changed or gone since it was asked (`current`, collections.ts), or the store refusing it: nothing saved.
    if (e instanceof StoreError || e instanceof StepFault) throw new ToolError("stale");
    throw e;
  }
  return { saved: asked.length };
}

/**
 * A row to create as Juan corrected it on its card (AU-251): each field he changed is his, with his label; a field
 * of another collection, or one the collection does not have, is refused. Its collection stays the one its «Crear»
 * cell names: a row is never moved to a collection the step does not write.
 */
function edited(
  store: UserStore,
  a: Asked,
  edits: Record<string, Json | null>,
  mine: Label,
): Asked {
  if (a.change.kind !== "create") return a;
  const key = a.change.collection;
  const def = Object.values(store.schema().types).find((t) => t.key === key);
  if (!def) throw new ToolError("stale");
  const fields = { ...a.change.fields };
  const values = { ...a.values };
  for (const [k, v] of Object.entries(edits)) {
    if (!def.fields.some((f) => f.key === k)) throw new ToolError("bad-argument");
    if (v === null) {
      delete fields[k];
      delete values[k];
    } else {
      fields[k] = v as Cell;
      values[k] = { value: v as Cell, label: mine, derived: false };
    }
  }
  return { ...a, change: { ...a.change, fields }, values };
}

/** What the server gives `automations.accept_run` for its run (agent.ts `service`, "automation-runs"). */
export interface RunsService {
  store: UserStore;
  zone: string;
  device: string | null;
}
const serviceOf = (s: unknown): RunsService => {
  const x = s as Partial<RunsService> | null | undefined;
  if (!x || typeof x !== "object" || !x.store || typeof x.zone !== "string")
    throw new ToolError("not-available");
  return x as RunsService;
};
const textOf = (v: Val | undefined): string => {
  const x = v ? plain(v) : null;
  if (typeof x !== "string" || !x) throw new ToolError("bad-argument");
  return x;
};

/** `automations.accept_run`, added to a registry. */
export function withRunProposal(r: ToolRegistry): ToolRegistry {
  r.register({
    name: ACCEPT_RUN,
    icon: "Check",
    effect: "write",
    area: "flows",
    service: "automation-runs",
    alwaysConfirm: true,
    acceptsRun: true,
    undo: ["run"],
    title: "Guardar lo que propuso una automatización",
    describe:
      "Save what a run of one of Juan's automations proposed, with that run's id: only Juan's acceptance of its proposal in the inbox calls it",
    args: {
      automation: { role: "option", required: true, describe: "the automation's id" },
      run: { role: "option", required: true, describe: "the run's id" },
      row: {
        role: "option",
        describe:
          "the one row of what the run asked this proposal saves, when it is one card per row",
      },
      edits: {
        role: "value",
        describe:
          "what Juan corrected of that row on its card, by field key: only his acceptance sets it",
      },
    },
    async run(c, a) {
      const s = serviceOf(c.service);
      const row = a.row ? Number(textOf(a.row)) : undefined;
      if (row !== undefined && (!Number.isInteger(row) || row < 0 || row >= ROWS_AS_CARDS))
        throw new ToolError("bad-argument");
      const edits = a.edits ? (plain(a.edits) as Record<string, Json | null> | null) : null;
      if (edits !== null && (typeof edits !== "object" || Array.isArray(edits)))
        throw new ToolError("bad-argument");
      const done = await acceptRun(
        s.store,
        textOf(a.automation),
        textOf(a.run),
        { device: s.device, zone: s.zone },
        {
          ...(row !== undefined ? { row } : {}),
          ...(edits ? { edits } : {}),
          ...(edits && a.edits?.t === "v" ? { mine: a.edits.label } : {}),
        },
      );
      return leaf(done as never, codeLabel("automations"));
    },
  });
  return r;
}
