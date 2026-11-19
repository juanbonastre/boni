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
  leaf,
  plain,
  ToolError,
  type ToolRegistry,
  type Val,
} from "@boni/agent";
import {
  AGENT_TYPE,
  type AnyAsked,
  type Asked,
  type Cell,
  isPageAsked,
  type Labelled,
  type PageAsked,
  parseAutomation,
  StepFault,
} from "@boni/automations";
import { StoreError, type UserStore } from "@boni/store";
import { getPage } from "../pages.ts";
import { ACCEPT_RUN } from "./acceptRunName.ts";
import { storeCollections } from "./collections.ts";
import { askedLabel, checkPageChange, savePageChange } from "./page.ts";
import { ASKED_STEP } from "./record.ts";
import { automationLabel } from "./service.ts";

export { ACCEPT_RUN };

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
  /**
   * A change of the page a run's chat lives in (AU-137), not of a row: the page, with its title now, and what it
   * changes (a control's value, or a block added at its end). Its `collection` is "" and its `row` null.
   */
  page?: { id: string; title: string; change: "value" | "block"; control?: string };
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
  };
}

const actionOf = (a: AnyAsked): AskedView["action"] =>
  isPageAsked(a)
    ? "update"
    : a.change.kind === "create"
      ? "create"
      : a.change.kind === "update"
        ? "update"
        : "trash";
const collectionOf = (store: UserStore, a: AnyAsked): string => {
  if (isPageAsked(a)) return "";
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

/** A change of the chat's page as the inbox shows it (AU-137): its values with where each came from, never its labels. */
function pageViewOf(store: UserStore, a: PageAsked, agents: ReadonlySet<string>): AskedView {
  return {
    step: a.step,
    byAgent: agents.has(a.step),
    kind: a.kind,
    action: "update",
    collection: "",
    name: null,
    row: null,
    values: Object.fromEntries(
      Object.entries(a.values).map(([k, v]) => [
        k,
        { value: v.value, integrity: v.label.integrity, outside: isOutside(v.label) },
      ]),
    ),
    page: {
      id: a.page,
      title: getPage(store, a.page)?.title ?? "",
      change: a.edit.kind,
      ...(a.edit.kind === "value" ? { control: a.edit.control } : {}),
    },
  };
}

function viewOf(store: UserStore, a: AnyAsked, agents: ReadonlySet<string>): AskedView {
  if (isPageAsked(a)) return pageViewOf(store, a, agents);
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
function askedRows(store: UserStore, run: string, offset = 0, limit?: number): AnyAsked[] {
  const step = store.journal.automationRunSteps(run).find((s) => s.step === ASKED_STEP);
  if (!step) return [];
  const total = (JSON.parse(step.record) as { asked: number }).asked;
  return store.journal
    .automationRunRows(run, ASKED_STEP, "asked", offset, limit ?? total)
    .map((x) => (typeof x === "string" ? JSON.parse(x) : x) as AnyAsked);
}

/**
 * The cells a run's proposal asks for (AU-207): each step, collection and action once, whatever the rows; a removal
 * is the cell's `remove`. What Juan answers of the proposal is one decision of each.
 */
export function askedCells(
  store: UserStore,
  run: string,
): { step: string; collection: string; action: "create" | "update" | "remove" }[] {
  const seen = new Map<
    string,
    { step: string; collection: string; action: "create" | "update" | "remove" }
  >();
  for (const a of askedRows(store, run)) {
    // A change of the chat's page is no cell of a connection (AU-137): it asks every time.
    if (isPageAsked(a)) continue;
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

/**
 * One proposal in the inbox for what a run asked (AU-193): kept as the agent keeps one made by code outside a turn
 * (`Agent.propose`): a run of its own, origin `automation`, that proposed; the automation's run names it. Its
 * arguments are the run's ids, the code's; what it saves is read from the run when it is accepted.
 */
export function proposeRun(
  store: UserStore,
  id: string,
  run: string,
  asked: readonly AnyAsked[],
): string {
  const journal = store.journal;
  const r = journal.automationRun(run);
  // Its name as the version that ran says it.
  const kept = r?.version != null ? journal.automationVersion(id, r.version) : null;
  const name = kept ? String((JSON.parse(kept.doc) as { name?: unknown }).name ?? "") : "";
  const at = Date.now();
  const proposal = randomUUID();
  const agentRun = randomUUID();
  const counts = new Map<
    string,
    { collection: string; name: string | null; action: AskedView["action"]; n: number }
  >();
  for (const a of asked) {
    const collection = collectionOf(store, a);
    const action = actionOf(a);
    // A change of the chat's page is counted by its page, its name the page's title (AU-137).
    const k = isPageAsked(a) ? `\u0000page:${a.page}` : `${collection}\u0000${action}`;
    const name = isPageAsked(a)
      ? (getPage(store, a.page)?.title ?? null)
      : nameOf(store, collection);
    const c = counts.get(k) ?? { collection, name, action, n: 0 };
    c.n++;
    counts.set(k, c);
  }
  const code = codeLabel("automations");
  const agents = agentStepsOf(store, run);
  const view: RunProposalView = {
    tool: ACCEPT_RUN,
    title: "Guardar lo que propuso una automatización",
    rows: [],
    run: {
      automation: id,
      name,
      version: r?.version ?? null,
      run,
      startedBy: r?.startedBy ?? "user",
      count: asked.length,
      counts: [...counts.values()],
      first: asked.slice(0, PROPOSAL_FIRST).map((a) => viewOf(store, a, agents)),
    },
  };
  const sources = new Set<string>();
  for (const a of asked)
    for (const v of Object.values(a.values))
      for (const s of v.label.sources) sources.add(`${s.kind}:${s.id}`);
  journal.startRun({ id: agentRun, turn: null, origin: "automation", device: null, started: at });
  journal.addProposal({
    id: proposal,
    run: agentRun,
    tool: ACCEPT_RUN,
    args: {
      values: { automation: leaf(id, code), run: leaf(run, code) },
      origins: [],
    },
    view,
    sources: [...sources],
    created: at,
  });
  journal.finishRun(agentRun, "proposed", null, at);
  journal.setAutomationRunProposal(run, proposal);
  return proposal;
}

/** A change of the chat's page that could not be saved on accepting (AU-137): the whole acceptance is taken back. */
class PageStale extends Error {}

/**
 * Saves what a run asked (AU-193), all or nothing, with the run's id (AU-18) and each value's label (AU-170).
 * `stale`: the run was undone, or a row it changes changed since; nothing is saved.
 */
export async function acceptRun(
  store: UserStore,
  id: string,
  run: string,
  who: { device: string | null; zone: string },
): Promise<{ saved: number }> {
  const r = store.journal.automationRun(run);
  if (!r || r.automation !== id || r.test) throw new ToolError("not-found");
  if (r.undone !== null) throw new ToolError("stale");
  const asked = askedRows(store, run);
  if (!asked.length) return { saved: 0 };
  const own = automationLabel(id);
  const collections = storeCollections(store, {
    actor: "user",
    device: who.device,
    zone: who.zone,
    own,
    run,
  });
  const rows = asked.filter((a): a is Asked => !isPageAsked(a));
  const pages = asked.filter(isPageAsked);
  // A change of the chat's page the page can no longer take (its control gone, AU-137): nothing saved.
  if (pages.some((a) => checkPageChange(store, a.page, a.edit) !== null))
    throw new ToolError("stale");
  const meta = { actor: "user" as const, device: who.device ?? undefined, run };
  try {
    // The rows and the page's changes in one transaction (AU-18): a page change that fails takes the rows back.
    await collections.applyAll(
      rows.map((a) => ({ change: a.change, values: a.values })),
      () => {
        for (const a of pages)
          if (savePageChange(store, a.page, a.edit, askedLabel(a.values, own), meta) !== null)
            throw new PageStale();
      },
    );
  } catch (e) {
    // A row changed or gone since it was asked (`current`, collections.ts), or the store refusing it: nothing saved.
    if (e instanceof StoreError || e instanceof StepFault || e instanceof PageStale)
      throw new ToolError("stale");
    throw e;
  }
  return { saved: asked.length };
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
    },
    async run(c, a) {
      const s = serviceOf(c.service);
      const done = await acceptRun(s.store, textOf(a.automation), textOf(a.run), {
        device: s.device,
        zone: s.zone,
      });
      return leaf(done as never, codeLabel("automations"));
    },
  });
  return r;
}
