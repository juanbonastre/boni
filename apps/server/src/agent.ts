import { existsSync, mkdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import {
  Agent,
  codeLabel,
  conversation,
  conversationByKey,
  createConversation,
  deleteConversation,
  ensureSystemTypes,
  type LiveEvent,
  leaf,
  listConversations,
  type ModelProvider,
  runnableNames,
  ToolError,
  type ToolRegistry,
  turnViews,
  updateConversation,
  type Val,
} from "@boni/agent";
import { dayToIso, todayIn } from "@boni/calendar";
import { type Label, label } from "@boni/entities";
import { openUserStore, type StoreOptions, type UserStore } from "@boni/store";
import { areasView, setAuto } from "./accuracy.ts";
import { serverRegistry } from "./actions.ts";
import { aloneRuns, measure } from "./autoAccept.ts";
import { setProtection } from "./data.ts";
import { ensurePresets, installed, setEnabled } from "./extensions.ts";
import type { ExternalItem } from "./externalItems.ts";
import type { FlowsService } from "./flowActions.ts";
import { flowMap, mapOwnerOf } from "./flowMap.ts";
import {
  checkFlow,
  createFlow,
  drawnRun,
  flowCatalog,
  flowProposalView,
  flowsView,
  flowView,
  MAIL_FLOW,
  originOf,
  revertFlow,
  saveUserFlow,
  type TestView,
  testFacts,
  testView,
  triggerNames,
  WHOLE_FLOW_ONLY,
} from "./flows.ts";
import type { Runner } from "./functions.ts";
import type { InboxService } from "./inboxActions.ts";
import { type InboxCard, inboxCard, inboxContext, judgeTime, timeOnAccept } from "./inboxCard.ts";
import { learningOn, setLearning } from "./learning.ts";
import { mailOfRun } from "./mailReview.ts";
import { type AccountModels, type PlannerChoice, serveModels } from "./models.ts";
import { originFacts, pendingFacts, recordOrigin } from "./origin.ts";
import { acceptEdits, intoOf, linkOf, mergeInto } from "./proposalEdits.ts";
import { activate, previousVersion, proposals, reject, revert } from "./proposals.ts";
import { bodyOf, CORS, SAFE, send } from "./reply.ts";
import { proposalsByRun, type RunInfo, runInfo } from "./runInfo.ts";
import { type SavedChart, screenOf, screenRefs } from "./screen.ts";

/**
 * The conversation API (docs/nucleo.md, 7; plan PR 11), on the tailnet entry only. Each account has
 * its own store (`users/<id>.db` next to system.db) and its own agent. The device's trust level
 * (identity) is the turn's origin: a confirmation only counts from a personal device. Without a
 * model provider configured the agent is off and every route answers 503 { error: "agent-off" }.
 *
 *   POST /api/agent/turn     { text, conversation?, live?, screen? } -> TurnResult (replies, pending, proposals,
 *                            notices); `screen`: what is on the app's screen, by reference (screen.ts, F9)
 *                            `conversation`: one of the list's (else the device's own, as before the list);
 *                            `live`: an id the device made, to watch the turn as it runs (GET .../live/:id)
 *   POST /api/agent/answer   { run, ask, choice | text, live? }
 *   POST /api/agent/confirm  { run, confirmation, live? }
 *   POST /api/agent/decline  { run, confirmation }
 *   GET  /api/agent/proposals                -> { proposals } pending, with the view painted by the code
 *   GET  /api/agent/requests                 -> { requests } questions from background work waiting for Juan
 *                                               (the panel of requests; expired ones end first)
 *   POST /api/agent/requests/:id/answer      { choice | text } -> TurnResult (the run goes on, as background work)
 *   POST /api/agent/requests/:id/dismiss     put away unanswered: its run ends having done nothing more
 *   POST /api/agent/proposals/:id/accept     { edits?: { title?, collection?, values?, done? } } Juan's corrections, kept
 *   POST /api/agent/proposals/:id/reject
 *   POST /api/agent/proposals/:id/restore    { run? } a decision taken back («Deshacer»): the proposal waits again;
 *                                               an accepted one once its run is undone (a personal device)
 *   GET  /api/agent/decisions                -> { areas } how right Boni's decisions are, per area and level of confidence,
 *                                               and whether each area acts alone («Solo») and has earned it
 *   PUT  /api/agent/decisions/:area          { auto } «Solo» on or off for an area (a personal device; on only when earned)
 *   GET  /api/agent/runs                     -> { runs } the latest, for the log, each with what it was and
 *                                               what came of it (runInfo.ts), and `autoAccept`: how often
 *                                               Boni would have accepted alone, and been right (autoAccept.ts)
 *   GET  /api/agent/runs/:id                 -> RunDetail: the request and each step (a personal device only)
 *   GET  /api/agent/origin/:id               -> Origin: who made a record and from what, the run that proposed it
 *                                               («¿De dónde viene?», origin.ts; a personal device only)
 *   POST /api/agent/runs/:id/undo            -> { undone } every operation of that run
 *   GET  /api/agent/conversations            -> { conversations } Juan's conversations, the latest first
 *   POST /api/agent/conversations            { title? } -> { conversation } a new one
 *   GET  /api/agent/conversations/:id        -> { conversation, turns } its turns as the devices show them
 *   PUT  /api/agent/conversations/:id        { title?, model? } -> { conversation } (model: one of /planners)
 *   DELETE /api/agent/conversations/:id      to the trash, with its turns
 *   GET  /api/agent/planners                 -> { planners } the models a conversation may plan with
 *   GET  /api/agent/live/:id?after=n         -> { events, done } what a turn did since event n, while it runs
 *   POST /api/agent/live/:id/stop            -> { stopping } «Parar»: before its next step, or where it waits
 *   GET  /api/agent/events                   -> Server-Sent Events: "notify" ({ text, integrity }), "proposals",
 *                                               "requests"…; open with the models off too (the desktop app's notices)
 *   GET  /api/agent/visibility               -> { types: [{ id, name, level, count }] } what the models may see
 *   PUT  /api/agent/visibility/:type         { level: visible | opaque | hidden } (a personal device only)
 *   GET  /api/agent/extensions               -> { extensions: [{ id, name, description, version, preset, enabled, needs, … }] }
 *   PUT  /api/agent/extensions/:id           { enabled } (a personal device only; off, the extension does nothing)
 *   GET  /api/agent/extensions/proposals     -> { proposals: [card] } versions proposed through the MCP (personal only)
 *   POST /api/agent/extensions/:id/activate  the proposed version becomes the active one (Juan, a personal device)
 *   POST /api/agent/extensions/:id/reject    the proposal goes away
 *   POST /api/agent/extensions/:id/revert    back to the version before the active one (and forward again)
 */
/** The setting that keeps what a run changed in «Flujos», for its Undo (`AgentHost.undoFlows`). */
const FLOW_UNDO = "flows/undo/";

export interface Providers {
  planner: ModelProvider;
  reader: ModelProvider;
  /** The `decider` role (Jev): the mail's choices; optional (the reader decides without it). */
  decider?: ModelProvider;
  /** The reviewer's own model (Modelos); without it, the reader's. */
  reviewer?: ModelProvider;
}

export interface AgentHostOptions {
  /** Where the users' stores live (`users/` in it); null: no agent. */
  dataDir: string | null;
  providers: Providers | null;
  tz?: string;
  now?: () => number;
  /** How each account's store opens (checkpoints from a thread, slow commits said: task 43). */
  storeOptions?: Omit<StoreOptions, "now">;
}

export class AgentHost {
  private o: AgentHostOptions;
  private stores = new Map<number, UserStore>();
  /** The accounts whose «Aviso del presupuesto» was kept current since their store opened (`store`). */
  private flowsKept = new Set<number>();
  private agents = new Map<number, Agent>();
  /** The providers each account's agent was last given (they change when Juan chooses other models). */
  private used = new Map<number, Providers>();
  // The core's tools and Boni's pieces (docs/sistema.md §4.2): a piece runs only in a flow (P20).
  private registry: ToolRegistry = serverRegistry().freeze();
  /** The tools every agent of this server has (the flow editor's catalog, docs/flujos.md). */
  get tools(): ToolRegistry {
    return this.registry;
  }
  /** A tool's title («Crear»), for whoever draws a plan (docs/flujos.md); null for a name the registry lacks. */
  toolTitle(name: string): string | null {
    return this.registry.get(name)?.title ?? null;
  }
  private listeners = new Map<number, Set<(event: string, data: unknown) => void>>();
  /** The account's mailbox as the inbox names it (its address), when it has one (mail.ts). */
  mailAccountOf: ((account: number) => string | null) | null = null;
  /** A saved chart of the account's first pages (the v1 API's), for one pointed at on the screen (F9; http.ts). */
  savedChart: ((account: number, id: string) => SavedChart | null) | null = null;
  /** The account's external calendars' events on some days (externalItems.ts), for the inbox's cards (task 51). */
  externalItems: ((account: number, days: readonly string[]) => ExternalItem[]) | null = null;
  /** The field a record of a collection keeps its link to an external event in, made if missing («Enlazar», task 51). */
  linkField:
    | ((account: number, typeId: string, device: string) => Promise<{ key: string } | null>)
    | null = null;
  /** The collection an account's mail is kept in (mail.ts), when it has one: read only in the apps (D-22). */
  mailTypeOf: ((account: number) => string | null) | null = null;
  /** The mail extension's modules for this account (what read_message gives, per module): the flow editor's. */
  mailModulesOf: ((account: number) => string[]) | null = null;
  /** A mail to try a mail flow with and what it binds to a plan («Probar», mail.ts `sample`). */
  mailSample:
    | ((
        account: number,
        mail: string | null,
        plan: unknown,
      ) => Promise<{ bind: Record<string, Val>; mail: string; subject: string } | null>)
    | null = null;
  /** The account's reading guide for mail as the readers get it (mail.ts `guideOf`), or null (task 23). */
  readingGuideOf: ((account: number) => Val | null) | null = null;
  /** The account's own models (models.ts, «Modelos»); null or a null answer: the server's. */
  providersFor: ((account: number) => Providers | null) | null = null;
  /** The account spent its month's budget (models.ts): background work calls no model. `dry`: a «Probar» asks. */
  overBudget: ((account: number, asking?: { dry: boolean }) => boolean) | null = null;
  /** What Boni's pieces work with for an account (mail.ts `piecesFor`, set by the mail when it starts). */
  pieces: ((account: number) => unknown) | null = null;
  /** The box an extension's function runs in (the real one when null; a stand-in in tests). */
  sandboxRun: Runner | null = null;
  /** Brings Boni's «Leer correo» up to date for an account (mail.ts `keepFlowCurrent`), before «Flujos» shows it. */
  mailFlowCurrent: ((account: number) => void) | null = null;
  /** «Modelos» (models.ts): its routes are served here, under /api/agent/models. */
  models: AccountModels | null = null;
  /** The planners a conversation may use, and one of them by its id (models.ts); none: only the account's. */
  plannerChoices: ((account: number) => PlannerChoice[]) | null = null;
  plannerFor: ((account: number, id: string) => ModelProvider | null) | null = null;
  /** Turns going on, as their devices watch them, by the id the device gave (a quarter of an hour at most). */
  private lives = new Map<string, Live>();

  constructor(o: AgentHostOptions) {
    this.o = o;
  }
  /** The accounts' stores can be opened (a data folder), with the agent on or not. */
  get hasData(): boolean {
    return !!this.o.dataDir;
  }
  get on(): boolean {
    return !!(this.o.dataDir && (this.o.providers || this.providersFor));
  }
  /** This account has models to call: the server's, or its own. */
  onFor(account: number): boolean {
    return !!this.o.dataDir && !!this.providersOf(account);
  }
  private providersOf(account: number): Providers | null {
    return this.providersFor?.(account) ?? this.o.providers;
  }

  store(account: number): UserStore {
    let s = this.stores.get(account);
    if (!s) {
      if (!this.o.dataDir) throw new Error("no data dir");
      const users = join(this.o.dataDir, "users");
      mkdirSync(users, { recursive: true, mode: 0o700 });
      s = openUserStore(join(users, `${account}.db`), {
        ...(this.o.storeOptions ?? {}),
        ...(this.o.now ? { now: this.o.now } : {}),
      });
      ensureSystemTypes(s);
      ensurePresets(s);
      this.stores.set(account, s);
    }
    // Boni's «Aviso del presupuesto» is among the account's flows from the first time its store is asked for with
    // «Modelos» there (models.ts, D-53): once per account, also for a store opened before (the day's copy at start).
    if (this.models && !this.flowsKept.has(account)) {
      this.flowsKept.add(account);
      this.models.keepFlowCurrent(account);
    }
    return s;
  }

  /**
   * Boni's own flows brought up to date for an account before «Flujos» or the map show them: the mail's (mail.ts
   * `keepFlowCurrent`) and «Aviso del presupuesto» (models.ts).
   */
  boniFlowsCurrent(account: number): void {
    this.mailFlowCurrent?.(account);
    this.models?.keepFlowCurrent(account);
  }

  /** The files of the stores open now (the checkpoint worker asks every few seconds). */
  storePaths(): string[] {
    if (!this.o.dataDir) return [];
    const users = join(this.o.dataDir, "users");
    return [...this.stores.keys()].map((id) => join(users, `${id}.db`));
  }

  agent(account: number): Agent {
    let a = this.agents.get(account);
    if (!a) {
      const p = this.providersOf(account);
      if (!p) throw new Error("agent-off");
      a = new Agent({
        store: this.store(account),
        registry: this.registry,
        planner: p.planner,
        reader: p.reader,
        ...(p.decider ? { decider: p.decider } : {}),
        ...(p.reviewer ? { reviewer: p.reviewer } : {}),
        overBudget: (asking) => this.overBudget?.(account, asking) ?? false,
        // A reader of mail in the conversation reads with Juan's guide, as the background reading does.
        readingGuide: () => this.readingGuideOf?.(account) ?? null,
        pieces: () => this.pieces?.(account) ?? null,
        // The steps «Función» and «Aplicar cambios» (task 93): this account's store, and the box.
        functions: () => ({
          store: () => this.store(account),
          ...(this.sandboxRun ? { run: this.sandboxRun } : {}),
        }),
        // «¿De dónde viene?» for the planner (`entities.origin`): what the app draws on the map, as facts.
        origin: {
          of: (id) =>
            originFacts(this.store(account), id, {
              mailAccount: this.mailAccountOf?.(account) ?? null,
            }),
          pending: () =>
            pendingFacts(this.store(account), {
              mailAccount: this.mailAccountOf?.(account) ?? null,
            }),
        },
        ...(this.o.tz ? { tz: this.o.tz } : {}),
        ...(this.o.now ? { now: this.o.now } : {}),
        // To this account's devices only: the recipient is the code's (7.9).
        notify: (text, l) => this.notify(account, text, l.integrity),
        onRequest: () => this.emit(account, "requests", {}),
        // The services an action's area needs (F10): the pages' and the data's writer, with the run it belongs to
        // (its Undo); the flows' and the Bandeja's code, as their routes run it.
        services: (name, run) => this.service(account, name, run),
        undoable: (run) => this.flowsUndoable(account, run),
      });
      this.agents.set(account, a);
      this.used.set(account, p);
    } else {
      // The account chose other models since (Modelos): the same agent goes on with them.
      const p = this.providersOf(account);
      if (p && p !== this.used.get(account)) {
        a.setProviders(p);
        this.used.set(account, p);
      }
    }
    return a;
  }

  /** What an action of an area runs on, for one run (`ToolDef.service`, docs/sistema.md §4.1). */
  private service(
    account: number,
    name: string,
    run: { run: string; action?: number; device?: string; inFlow?: boolean },
  ): unknown {
    const store = this.store(account);
    if (name === "pages" || name === "data")
      return {
        store,
        meta: {
          actor: "agent",
          run: run.run,
          ...(run.action !== undefined ? { action: run.action } : {}),
          ...(run.device ? { device: run.device } : {}),
        },
      };
    const who = { account, device: run.device ?? "agent", trust: "personal" as const };
    if (name === "inbox")
      return {
        correct: async (proposal, edits) => {
          const r = await acceptCorrected(this, who, proposal, edits);
          if ("error" in r) throw new ToolError(r.error);
          return { proposal, run: r.done.run || null, error: r.done.error ?? null };
        },
      } satisfies InboxService;
    if (name !== "flows") return null;
    // What this run switched or deleted, so that its Undo takes it back (`undoFlows`).
    const keep = (flow: string, was: { enabled?: boolean; deleted?: boolean }) => {
      const key = `${FLOW_UNDO}${run.run}`;
      const list = JSON.parse(store.setting(key) ?? "[]") as unknown[];
      store.setSetting(key, JSON.stringify([...list, { flow, ...was }]));
    };
    const named = (flow: string) => store.journal.flow(flow)?.name ?? "";
    return {
      enable: (flow, on) => {
        const r = switchFlow(this, account, flow, on);
        if (r)
          throw new ToolError(
            r.error === "already" ? (on ? "already-on" : "already-off") : `flow-${r.error}`,
          );
        keep(flow, { enabled: !on });
        return { flow, name: named(flow), enabled: on };
      },
      remove: (flow) => {
        const r = trashFlow(store, flow);
        if (r) throw new ToolError(`flow-${r.error}`);
        keep(flow, { deleted: false });
        return { flow, name: named(flow) };
      },
      test: async (flow, inputs, said) => {
        // Trying a flow from a flow's run, or from its «Probar», would never end.
        if (run.inFlow) throw new ToolError("flow-in-flow");
        const r = await tryFlow(this, who, flow, { inputs }, said);
        if (r.status !== 200) throw new ToolError(`flow-${(r.body as { error: string }).error}`);
        // The model reads the decisions and counts, never the sample's or the steps' texts.
        return testFacts(r.body as TestView);
      },
    } satisfies FlowsService;
  }

  /**
   * Takes back what a run switched on or off or deleted in «Flujos» (journal rows, not in the store's log), newest
   * first; how many. Undo of the run (`POST /api/agent/runs/:id/undo`) calls it with the store's own.
   */
  /** Whether a run switched or deleted a flow that its Undo has not taken back yet. */
  flowsUndoable(account: number, run: string): boolean {
    return (this.store(account).setting(`${FLOW_UNDO}${run}`) ?? "[]") !== "[]";
  }

  undoFlows(account: number, run: string): number {
    const store = this.store(account);
    const key = `${FLOW_UNDO}${run}`;
    const list = JSON.parse(store.setting(key) ?? "[]") as {
      flow: string;
      enabled?: boolean;
      deleted?: boolean;
    }[];
    let n = 0;
    for (const c of [...list].reverse()) {
      const f = store.journal.flow(c.flow);
      if (!f) continue;
      const live = store.journal.flows().some((x) => x.id === c.flow);
      if (c.deleted !== undefined) {
        // Brought back only if it is still deleted.
        if (!live) {
          store.journal.setFlowDeleted(c.flow, c.deleted);
          n++;
        }
        continue;
      }
      // Juan's own change since then wins: only a flow still as the run left it is switched back. Switching one
      // back on goes through the same checks as his switch.
      if (c.enabled === undefined || !live || f.enabled === c.enabled) continue;
      if (
        c.enabled
          ? !switchFlow(this, account, c.flow, true)
          : (store.journal.setFlowEnabled(c.flow, false), true)
      )
        n++;
    }
    store.setSetting(key, null);
    return n;
  }

  subscribe(account: number, l: (event: string, data: unknown) => void): () => void {
    const set = this.listeners.get(account) ?? new Set();
    this.listeners.set(account, set);
    set.add(l);
    return () => set.delete(l);
  }
  emit(account: number, event: string, data: unknown): void {
    for (const l of this.listeners.get(account) ?? []) l(event, data);
  }

  /** How a notice reaches the account's devices that are not connected now (UnifiedPush, reminders.ts; task 62). */
  pushNotice: ((account: number, text: string) => void) | null = null;
  /**
   * A notice of Boni's for this account's devices (the agent's `notify`, a flow's «Avisar», the month's budget): to
   * those connected now («notify» on GET /api/agent/events, the desktop app's) and, by UnifiedPush, to the phone
   * with Boni closed. The recipient is the code's, never an argument (docs/nucleo.md 7.9).
   */
  notify(account: number, text: string, integrity: string): void {
    this.emit(account, "notify", { text, integrity });
    this.pushNotice?.(account, text);
  }

  /** A turn about to run, watched from the device that gave `id`: what it does goes here as it happens. */
  liveStart(account: number, id: string): (e: LiveEvent) => void {
    this.liveSweep();
    const live: Live = { account, events: [], run: null, done: false, at: Date.now() };
    this.lives.set(id, live);
    return (e) => {
      if (e.type === "start") live.run = e.run;
      if (e.type === "end" || e.type === "waiting") live.done = true;
      if (live.events.length < LIVE_EVENTS) live.events.push(e);
    };
  }
  /** What the turn `id` of this account did since event `after`; null when there is none. */
  liveRead(
    account: number,
    id: string,
    after: number,
  ): { events: LiveEvent[]; done: boolean } | null {
    this.liveSweep();
    const live = this.lives.get(id);
    if (!live || live.account !== account) return null;
    return { events: live.events.slice(Math.max(0, after)), done: live.done };
  }
  /** The run of the turn `id` of this account, once it started. */
  liveRun(account: number, id: string): string | null {
    const live = this.lives.get(id);
    return live && live.account === account ? live.run : null;
  }
  private liveSweep(): void {
    const old = Date.now() - LIVE_MS;
    for (const [id, l] of this.lives) if (l.at < old) this.lives.delete(id);
  }

  /** The zone the account's days are in (the server's). */
  get tz(): string {
    return this.o.tz ?? "Europe/Madrid";
  }
  /** Today's civil day in the server's zone (YYYY-MM-DD): a scheduled flow's `$today` (docs/flujos.md F4). */
  today(): string {
    return dayToIso(todayIn(this.o.tz ?? "Europe/Madrid", this.o.now?.() ?? Date.now()));
  }

  /** Whether the account has a store already (the scheduler opens none for an account that never used Boni). */
  hasStore(account: number): boolean {
    return (
      this.stores.has(account) ||
      (!!this.o.dataDir && existsSync(join(this.o.dataDir, "users", `${account}.db`)))
    );
  }

  close(): void {
    for (const s of this.stores.values()) s.close();
    this.stores.clear();
    this.flowsKept.clear();
    this.agents.clear();
  }
}

const str = (v: unknown, max: number) =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : null;

interface Live {
  account: number;
  events: LiveEvent[];
  run: string | null;
  done: boolean;
  at: number;
}
const LIVE_MS = 15 * 60_000;
const LIVE_EVENTS = 500;
/** A live id a device made: letters, digits and dashes. */
const liveId = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9-]{8,80}$/.test(v) ? v : null);

/** One agent request of an authenticated account (`route` from routes.ts, already allowed here). */
export async function serveAgent(
  host: AgentHost,
  req: IncomingMessage,
  res: ServerResponse,
  route: string,
  params: Record<string, string>,
  who: { account: number; device: string; trust: "personal" | "shared" | "ambient" },
): Promise<void> {
  // «Modelos» works with the agent off: a key can be given there.
  if (route.includes(" /api/agent/models")) {
    if (!host.models) return send(res, 503, { error: "no-store" });
    return serveModels(host.models, req, res, route, params, who);
  }
  if (route.includes(" /api/agent/conversations") || route.includes(" /api/agent/live/")) {
    if (!host.hasData) return send(res, 503, { error: "no-store" });
    return serveConversations(host, req, res, route, params, who);
  }
  // The flows (docs/flujos.md) are data of the account: drawn with the agent off too.
  if (route.includes(" /api/agent/flows")) {
    if (!host.hasData) return send(res, 503, { error: "no-store" });
    return serveFlows(host, req, res, route, params, who);
  }
  switch (route) {
    // The map (docs/sistema.md §4.4, F8): the account's data and what moves it, drawn with the agent off too, on his
    // personal devices (it names his collections and counts their rows).
    case "GET /api/agent/map": {
      if (!host.hasData) return send(res, 503, { error: "no-store" });
      if (who.trust !== "personal") return send(res, 403, { error: "personal-device-only" });
      host.boniFlowsCurrent(who.account);
      const q = new URL(req.url ?? "/", "http://boni").searchParams;
      const days = Math.min(90, Math.max(1, Math.round(Number(q.get("days")) || 7)));
      return send(
        res,
        200,
        flowMap(host.store(who.account), {
          now: Date.now(),
          days,
          tz: host.tz,
          mailType: host.mailTypeOf?.(who.account) ?? null,
          mailAccount: host.mailAccountOf?.(who.account) ?? null,
          titleOf: (tool) => host.toolTitle(tool),
        }),
      );
    }
    // What the account's agent tells its devices, while it is open: with the models off too, since the desktop app
    // keeps it for Boni's notices (task 62).
    case "GET /api/agent/events": {
      res.writeHead(200, {
        ...CORS,
        ...SAFE,
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      res.write(": connected\n\n");
      const off = host.subscribe(who.account, (event, data) =>
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
      );
      const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
      req.on("close", () => {
        off();
        clearInterval(ping);
      });
      return;
    }
  }
  if (!host.onFor(who.account)) return send(res, 503, { error: "agent-off" });
  await answerAgent(host, req, res, route, params, who);
}

/** The flows of the account (docs/flujos.md, F1): the list with their runs, and one as nodes and arrows. */
async function serveFlows(
  host: AgentHost,
  req: IncomingMessage,
  res: ServerResponse,
  route: string,
  params: Record<string, string>,
  who: { account: number; device: string; trust: "personal" | "shared" | "ambient" },
): Promise<void> {
  const store = host.store(who.account);
  const id = params.id ?? "";
  // Changing a flow is the user's, from a personal device (D-41); reading one, any of his devices.
  const mine = who.trust === "personal";
  const forEditor = () => ({
    modules: host.mailModulesOf?.(who.account) ?? ["tasks", "events"],
    mailType: host.mailTypeOf?.(who.account) ?? null,
  });
  const detail = (fid: string, days = 7) => {
    const types = Object.values(store.schema().types);
    const v = flowView(
      store,
      fid,
      Date.now(),
      days,
      (tool) => host.toolTitle(tool),
      (key) => types.find((t) => t.key === key)?.name ?? null,
    );
    if (!v) return v;
    // The key of the collection the mail's connector brings records to: a trigger on it says «viene del conector
    // Correo» (docs/sistema.md §4.2), the editor's draft as much as the saved version.
    const mailType = host.mailTypeOf?.(who.account) ?? null;
    return { ...v, mailKey: types.find((t) => t.id === mailType)?.key ?? null };
  };
  if (route !== "GET /api/agent/flows" && route !== "GET /api/agent/flows/:id" && !mine)
    return send(res, 403, { error: "personal-device-only" });
  switch (route) {
    case "GET /api/agent/flows":
      host.boniFlowsCurrent(who.account);
      return send(res, 200, { flows: flowsView(store) });
    case "GET /api/agent/flows/catalog":
      return send(res, 200, flowCatalog(host.tools, store, forEditor().modules, { ids: true }));
    case "POST /api/agent/flows/check": {
      const b = (await bodyOf(req)) as { trigger?: unknown; plan?: unknown };
      return send(
        res,
        200,
        checkFlow(store, host.tools, { trigger: b.trigger, plan: b.plan }, forEditor()),
      );
    }
    case "POST /api/agent/flows": {
      const b = (await bodyOf(req)) as { name?: unknown; from?: unknown };
      const name = str(b.name, 80);
      const from = b.from === undefined ? undefined : str(b.from, 80);
      if (!name || from === null) return send(res, 400, { error: "bad-request" });
      const made = createFlow(store, { name, ...(from ? { from } : {}) }, Date.now());
      return made ? send(res, 200, detail(made.id)) : send(res, 404, { error: "not-found" });
    }
    case "PUT /api/agent/flows/:id": {
      const b = (await bodyOf(req)) as {
        base?: unknown;
        name?: unknown;
        trigger?: unknown;
        plan?: unknown;
      };
      if (typeof b.base !== "number" || !b.plan) return send(res, 400, { error: "bad-request" });
      const name = b.name === undefined ? undefined : str(b.name, 80);
      if (name === null) return send(res, 400, { error: "bad-request" });
      const latest = store.journal.flow(id);
      const trigger = b.trigger ?? latest?.trigger;
      const check = checkFlow(store, host.tools, { trigger, plan: b.plan }, forEditor());
      const r = saveUserFlow(
        store,
        id,
        {
          base: b.base,
          plan: b.plan,
          ...(name ? { name } : {}),
          ...(b.trigger !== undefined ? { trigger: b.trigger } : {}),
        },
        check.problems,
        Date.now(),
      );
      if ("error" in r) {
        const status = r.error === "not-found" ? 404 : r.error === "conflict" ? 409 : 400;
        return send(res, status, { error: r.error, problems: check.problems });
      }
      return send(res, 200, detail(id));
    }
    case "PUT /api/agent/flows/:id/enabled": {
      const b = (await bodyOf(req)) as { enabled?: unknown };
      if (typeof b.enabled !== "boolean") return send(res, 400, { error: "bad-request" });
      const r = switchFlow(host, who.account, id, b.enabled);
      if (r?.error === "not-found") return send(res, 404, { error: "not-found" });
      // Already so: nothing to do.
      if (r && r.error !== "already") return send(res, 400, r);
      return send(res, 200, detail(id));
    }
    case "POST /api/agent/flows/:id/revert": {
      const b = (await bodyOf(req)) as { version?: unknown; preset?: unknown };
      const to =
        b.preset === true
          ? ({ preset: true } as const)
          : typeof b.version === "number"
            ? { version: b.version }
            : null;
      if (!to) return send(res, 400, { error: "bad-request" });
      const v = revertFlow(store, id, to, Date.now());
      return v ? send(res, 200, detail(id)) : send(res, 404, { error: "not-found" });
    }
    case "DELETE /api/agent/flows/:id": {
      const r = trashFlow(store, id);
      if (r) return send(res, r.error === "not-found" ? 404 : 409, r);
      return send(res, 200, {});
    }
    case "POST /api/agent/flows/:id/test": {
      const r = await tryFlow(host, who, id, await bodyOf(req));
      return send(res, r.status, r.body);
    }
    case "POST /api/agent/flows/:id/run": {
      if (!host.onFor(who.account)) return send(res, 503, { error: "agent-off" });
      const f = store.journal.flow(id);
      if (!f) return send(res, 404, { error: "not-found" });
      // By hand: a flow with a form, or a scheduled one now (its `$today` today); not one a record starts.
      const names = runnableNames(f.trigger);
      if (!names) return send(res, 409, { error: "not-manual" });
      const b = (await bodyOf(req)) as { inputs?: unknown; conversation?: unknown; live?: unknown };
      const given = (b.inputs && typeof b.inputs === "object" ? b.inputs : {}) as Record<
        string,
        unknown
      >;
      // What the user types in the run's form is his (integrity user), as a turn's words are.
      const typed = label("user", "personal", [{ kind: "user-edit", id: `flow:${f.id}` }]);
      const bind: Record<string, Val> = {};
      for (const n of names) {
        const v = given[n];
        if (v !== undefined && (typeof v !== "string" || v.length > 2000))
          return send(res, 400, { error: "bad-request" });
        bind[n] =
          n === "today" && v === undefined
            ? leaf(host.today(), codeLabel("today"))
            : leaf(typeof v === "string" ? v : "", typed);
      }
      const asked = typeof b.conversation === "string" ? str(b.conversation, 80) : null;
      const c = asked ? conversation(store, asked) : null;
      const live = liveId(b.live);
      const r = await host.agent(who.account).turn({
        text: `«${f.name}»`,
        origin: { kind: "turn", trust: who.trust, device: who.device },
        ...(c ? { conversation: c.id } : {}),
        ...(live ? { live: host.liveStart(who.account, live) } : {}),
        flow: { id: f.id, version: f.version, by: f.by, plan: f.plan, bind },
      });
      if (r.proposals.length) host.emit(who.account, "proposals", { n: r.proposals.length });
      return send(res, 200, r);
    }
    case "GET /api/agent/flows/:id": {
      if (id === MAIL_FLOW) host.mailFlowCurrent?.(who.account);
      const q = new URL(req.url ?? "/", "http://boni").searchParams;
      const days = Math.min(90, Math.max(1, Math.round(Number(q.get("days")) || 7)));
      const v = detail(id, days);
      return v ? send(res, 200, v) : send(res, 404, { error: "not-found" });
    }
    default:
      return send(res, 404, { error: "not-found" });
  }
}

/** Juan's conversations (docs/conversacion.md 3.1) and the turns he watches live (3.5). */
async function serveConversations(
  host: AgentHost,
  req: IncomingMessage,
  res: ServerResponse,
  route: string,
  params: Record<string, string>,
  who: { account: number; device: string; trust: "personal" | "shared" | "ambient" },
): Promise<void> {
  const store = host.store(who.account);
  const id = params.id ?? "";
  switch (route) {
    case "GET /api/agent/conversations":
      return send(res, 200, { conversations: listConversations(store) });
    case "POST /api/agent/conversations": {
      const b = ((await bodyOf(req)) ?? {}) as { title?: unknown };
      const title = b.title === undefined ? "" : str(b.title, 120);
      if (title === null) return send(res, 400, { error: "bad-request" });
      const made = createConversation(store, { title, device: who.device, now: Date.now() });
      return send(res, 200, { conversation: conversation(store, made) });
    }
    case "GET /api/agent/conversations/:id": {
      const c = conversation(store, id);
      if (!c) return send(res, 404, { error: "not-found" });
      return send(res, 200, {
        conversation: c,
        turns: turnViews(store, id, (run) => host.flowsUndoable(who.account, run)),
      });
    }
    case "PUT /api/agent/conversations/:id": {
      const b = ((await bodyOf(req)) ?? {}) as { title?: unknown; model?: unknown };
      const title = b.title === undefined ? undefined : str(b.title, 120);
      const model =
        b.model === undefined || b.model === ""
          ? (b.model as string | undefined)
          : (host.plannerChoices?.(who.account) ?? []).some((p) => p.id === b.model)
            ? (b.model as string)
            : null;
      if (title === null || model === null) return send(res, 400, { error: "bad-request" });
      if (
        !updateConversation(store, id, {
          ...(title !== undefined ? { title } : {}),
          ...(model !== undefined ? { model } : {}),
          device: who.device,
        })
      )
        return send(res, 404, { error: "not-found" });
      return send(res, 200, { conversation: conversation(store, id) });
    }
    case "DELETE /api/agent/conversations/:id":
      if (!deleteConversation(store, id, who.device)) return send(res, 404, { error: "not-found" });
      return send(res, 200, {});
    case "GET /api/agent/live/:id": {
      const after = Number(new URL(req.url ?? "", "http://x").searchParams.get("after") ?? 0) || 0;
      const r = liveId(id) ? host.liveRead(who.account, id, after) : null;
      if (!r) return send(res, 404, { error: "not-found" });
      return send(res, 200, r);
    }
    case "POST /api/agent/live/:id/stop": {
      const run = liveId(id) ? host.liveRun(who.account, id) : null;
      if (!run || !host.onFor(who.account)) return send(res, 404, { error: "not-found" });
      const r = host.agent(who.account).stop(run);
      return send(res, 200, { stopping: r !== null });
    }
    default:
      return send(res, 404, { error: "not-found" });
  }
}

async function answerAgent(
  host: AgentHost,
  req: IncomingMessage,
  res: ServerResponse,
  route: string,
  params: Record<string, string>,
  who: { account: number; device: string; trust: "personal" | "shared" | "ambient" },
): Promise<void> {
  const agent = host.agent(who.account);
  const bad = () => send(res, 400, { error: "bad-request" });
  const after = (r: { proposals: string[] }) => {
    if (r.proposals.length) host.emit(who.account, "proposals", { n: r.proposals.length });
    return r;
  };
  switch (route) {
    case "POST /api/agent/turn": {
      const b = await bodyOf(req);
      const text = str(b.text, 8000);
      if (!text) return bad();
      const asked = b.conversation === undefined ? "" : str(b.conversation, 80);
      if (asked === null) return bad();
      const store = host.store(who.account);
      // One of the list's; a device that predates the list keeps one of its own, as before.
      const c =
        (asked && conversation(store, asked)) ||
        conversation(
          store,
          conversationByKey(store, `${who.device}:${asked}`, {
            device: who.device,
            now: Date.now(),
          }),
        );
      if (!c) return bad();
      // What is on Juan's screen as he writes (F9): the app's references, made into values by the server.
      const refs = b.screen === undefined || b.screen === null ? null : screenRefs(b.screen);
      if (b.screen !== undefined && b.screen !== null && !refs) return bad();
      const screen = refs
        ? screenOf(store, refs, {
            mailAccount: host.mailAccountOf?.(who.account) ?? null,
            today: host.today(),
            chart: (id) => host.savedChart?.(who.account, id) ?? null,
          })
        : null;
      const planner = c.model ? (host.plannerFor?.(who.account, c.model) ?? undefined) : undefined;
      const live = liveId(b.live);
      const r = await agent.turn({
        text,
        origin: { kind: "turn", trust: who.trust, device: who.device },
        conversation: c.id,
        ...(live ? { live: host.liveStart(who.account, live) } : {}),
        ...(planner ? { planner } : {}),
        ...(screen ? { screen } : {}),
      });
      return send(res, 200, after(r));
    }
    case "POST /api/agent/answer": {
      const b = await bodyOf(req);
      const run = str(b.run, 80);
      const ask = str(b.ask, 80);
      if (!run || !ask) return bad();
      const answer =
        typeof b.choice === "number" && Number.isInteger(b.choice)
          ? { choice: b.choice }
          : str(b.text, 500)
            ? { text: b.text as string }
            : null;
      if (!answer) return bad();
      const live = liveId(b.live);
      return send(
        res,
        200,
        after(
          await agent.answer(
            run,
            ask,
            answer,
            undefined,
            live ? host.liveStart(who.account, live) : undefined,
          ),
        ),
      );
    }
    case "POST /api/agent/confirm":
    case "POST /api/agent/decline": {
      const b = await bodyOf(req);
      const run = str(b.run, 80);
      const c = str(b.confirmation, 80);
      if (!run || !c) return bad();
      return send(
        res,
        200,
        route.endsWith("confirm")
          ? after(
              await agent.confirm(
                run,
                c,
                who.trust,
                liveId(b.live) ? host.liveStart(who.account, liveId(b.live) as string) : undefined,
              ),
            )
          : agent.decline(run, c),
      );
    }
    case "GET /api/agent/planners":
      return send(res, 200, {
        planners: (host.plannerChoices?.(who.account) ?? []).map((p) => ({
          id: p.id,
          model: p.model,
          connection: p.connection,
          privacy: p.privacy,
          current: p.current,
        })),
      });
    case "GET /api/agent/proposals": {
      const store = host.store(who.account);
      const ctx = inboxContext(store, {
        external: (day) => host.externalItems?.(who.account, [day]) ?? [],
      });
      const mailAccount = host.mailAccountOf?.(who.account) ?? null;
      return send(res, 200, {
        proposals: store.journal.proposals("pending").map((p) => {
          let card: InboxCard | null = null;
          try {
            card = inboxCard(store, p, { mailAccount }, ctx);
          } catch {
            // a proposal the card cannot read still shows with its rows
          }
          // A flow a model proposed (docs/flujos.md F5): drawn, with what it changes.
          const flow =
            p.tool === "flows.save"
              ? flowProposalView(
                  store,
                  p,
                  (tool) => host.toolTitle(tool),
                  (key) =>
                    Object.values(store.schema().types).find((t) => t.key === key)?.name ?? null,
                )
              : null;
          return {
            id: p.id,
            tool: p.tool,
            view: p.view,
            sources: p.sources,
            created: p.created,
            run: p.run,
            // The flow whose run made it, for «Ver en el mapa» (null: a turn of the conversation).
            madeBy: store.journal.run(p.run)?.flow ?? null,
            card,
            ...(flow ? { flow } : {}),
          };
        }),
      });
    }
    case "GET /api/agent/requests": {
      const store = host.store(who.account);
      const mailAccount = host.mailAccountOf?.(who.account) ?? null;
      return send(res, 200, {
        requests: agent.requests().map((r) => {
          // Where it comes from (the mail that was being read), as the Registro says it.
          let about: RunInfo["what"] | null = null;
          let open: { type: string; id: string } | null = null;
          const run = store.journal.run(r.run);
          try {
            if (run) about = runInfo(store, run, { mailAccount }).what;
            const mail = mailOfRun(store, r.run);
            const m = mail ? store.get(mail) : null;
            if (m) open = { type: m.entity.type, id: m.entity.id };
          } catch {
            // the question shows without where it came from
          }
          return {
            id: r.id,
            run: r.run,
            view: r.view,
            created: r.created,
            expires: r.expires,
            about,
            open,
          };
        }),
      });
    }
    case "POST /api/agent/requests/:id/answer": {
      const r = host.store(who.account).journal.request(params.id ?? "");
      if (!r) return send(res, 404, { error: "not-found" });
      const b = await bodyOf(req);
      const answer =
        typeof b.choice === "number" && Number.isInteger(b.choice)
          ? { choice: b.choice }
          : str(b.text, 500)
            ? { text: b.text as string }
            : null;
      if (!answer) return bad();
      return send(res, 200, after(await agent.answer(r.run, r.id, answer, { trust: who.trust })));
    }
    case "POST /api/agent/requests/:id/dismiss":
      return send(res, 200, { dismissed: agent.dismissRequest(params.id ?? "") });
    case "POST /api/agent/proposals/:id/accept": {
      const b = ((await bodyOf(req)) ?? {}) as { edits?: unknown };
      const r = await acceptCorrected(host, who, params.id ?? "", b.edits);
      return "error" in r ? send(res, 400, { error: r.error }) : send(res, 200, after(r.done));
    }
    case "POST /api/agent/proposals/:id/reject":
      agent.rejectProposal(params.id ?? "");
      return send(res, 200, {});
    case "POST /api/agent/proposals/:id/restore": {
      if (who.trust !== "personal") return send(res, 403, { error: "personal-device-only" });
      const b = ((await bodyOf(req)) ?? {}) as { run?: unknown };
      const r = agent.restoreProposal(
        params.id ?? "",
        typeof b.run === "string" ? b.run : undefined,
      );
      if (r === "ok") return send(res, 200, {});
      return send(res, r === "no-such-proposal" ? 404 : 409, { error: r });
    }
    case "GET /api/agent/decisions":
      return send(res, 200, decisionsView(host.store(who.account)));
    case "PUT /api/agent/decisions/:area": {
      if (who.trust !== "personal") return send(res, 403, { error: "personal-device-only" });
      const store = host.store(who.account);
      const b = await bodyOf(req);
      const area = params.area ?? "";
      if (typeof b.auto !== "boolean" || !areasView(store, Date.now()).some((a) => a.area === area))
        return send(res, 400, { error: "bad-request" });
      const r = setAuto(store, area, b.auto, Date.now());
      if (r === "ok") return send(res, 200, decisionsView(store));
      return send(res, r === "not-earned" ? 409 : 400, { error: r });
    }
    // «Aprender» (docs/preferencias.md §5): off, no learner suggests anything on its own. A personal device only.
    case "PUT /api/agent/learning": {
      if (who.trust !== "personal") return send(res, 403, { error: "personal-device-only" });
      const store = host.store(who.account);
      const b = await bodyOf(req);
      if (typeof b.on !== "boolean") return send(res, 400, { error: "bad-request" });
      setLearning(store, b.on);
      return send(res, 200, decisionsView(store));
    }
    case "GET /api/agent/runs": {
      const store = host.store(who.account);
      const proposals = proposalsByRun(store);
      const mailAccount = host.mailAccountOf?.(who.account) ?? null;
      let autoAccept: ReturnType<typeof measure> | null = null;
      let alone: Set<string> | undefined;
      try {
        autoAccept = measure(store);
        alone = aloneRuns(store);
      } catch {
        // the Registro shows without it
      }
      return send(res, 200, {
        ...(autoAccept ? { autoAccept } : {}),
        runs: store.journal.runs(50).map((r) => {
          let info: RunInfo | null = null;
          try {
            info = runInfo(store, r, { proposals, mailAccount, alone });
          } catch {
            // a run the code cannot describe still shows with its origin and status
          }
          return {
            id: r.id,
            origin: r.origin,
            device: r.device,
            status: r.status,
            started: r.started,
            finished: r.finished,
            ...(info ?? {}),
          };
        }),
      });
    }
    case "GET /api/agent/runs/:id": {
      if (who.trust !== "personal") return send(res, 403, { error: "personal-device-only" });
      const d = agent.runDetail(params.id ?? "");
      if (!d) return send(res, 404, { error: "not-found" });
      // Where the map draws it: its flow, the conversation, the reviewer, the Bandeja (docs/sistema.md §4.4).
      const store = host.store(who.account);
      const r = store.journal.run(d.id);
      const owner = r ? mapOwnerOf(store, r, host.mailAccountOf?.(who.account) ?? null) : null;
      // Drawn over its own version when that is not the flow's latest (its steps by their names then).
      const types = Object.values(store.schema().types);
      const drawn = r
        ? drawnRun(
            store,
            r,
            owner,
            (tool) => host.toolTitle(tool),
            (key) => types.find((t) => t.key === key)?.name ?? null,
          )
        : null;
      return send(res, 200, { ...d, owner, drawn });
    }
    case "GET /api/agent/origin/:id": {
      if (who.trust !== "personal") return send(res, 403, { error: "personal-device-only" });
      const store = host.store(who.account);
      const o = recordOrigin(store, params.id ?? "", {
        mailAccount: host.mailAccountOf?.(who.account) ?? null,
      });
      return o ? send(res, 200, o) : send(res, 404, { error: "not-found" });
    }
    case "POST /api/agent/runs/:id/undo": {
      // The store's operations of the run, then what it switched or deleted in «Flujos» (F10); a later change of
      // Juan's in the way stops both.
      const run = params.id ?? "";
      const store = host.store(who.account);
      try {
        const undone = store.runUndoable(run) ? agent.undoRun(run).length : 0;
        const flows = host.undoFlows(who.account, run);
        return undone + flows
          ? send(res, 200, { undone: undone + flows })
          : send(res, 409, { error: "cannot-undo" });
      } catch {
        return send(res, 409, { error: "cannot-undo" });
      }
    }
    case "GET /api/agent/visibility": {
      const store = host.store(who.account);
      const levels = store.aiAccess();
      const zones = store.zones();
      return send(res, 200, {
        types: Object.values(store.schema().types)
          .filter((t) => !t.system && !t.archived)
          .sort((a, b) => a.name.localeCompare(b.name, "es"))
          .map((t) => ({
            id: t.id,
            name: t.name,
            level: levels[t.id] ?? "visible",
            ...(zones[t.id] ? { zone: zones[t.id] } : {}),
            count: store.list(t.id).length,
          })),
      });
    }
    case "PUT /api/agent/visibility/:type": {
      // Juan's choice, from a personal device: never something the agent or a shared device decides.
      if (who.trust !== "personal") return send(res, 403, { error: "personal-device-only" });
      const b = await bodyOf(req);
      const store = host.store(who.account);
      const r = setProtection(store, params.type ?? "", b, who.device);
      return "error" in r ? send(res, r.status, { error: r.error }) : send(res, 200, r);
    }
    case "GET /api/agent/extensions": {
      // The installed extensions (docs/extensiones.md 3): what each is, what it asks for, on or off; the
      // collections it reads by their names.
      const store = host.store(who.account);
      const types = Object.values(store.schema().types);
      const nameOf = (key: string) => types.find((t) => t.key === key)?.name ?? key;
      return send(res, 200, {
        extensions: installed(store).map((i) => ({
          id: i.manifest.id,
          name: i.manifest.name,
          description: i.manifest.description ?? "",
          version: i.manifest.version,
          preset: i.preset,
          enabled: i.enabled,
          needs: { ...i.manifest.needs, reads: i.manifest.needs.reads.map(nameOf) },
          sources: (i.manifest.sources ?? []).map((s) => s.connector),
          modules: (i.manifest.readers ?? []).map((r) => r.module),
          previous: previousVersion(store, i.manifest.id),
        })),
      });
    }
    case "GET /api/agent/extensions/proposals": {
      // What an assistant proposed through the MCP, as the card Juan activates it from (E3): it shows code.
      if (who.trust !== "personal") return send(res, 403, { error: "personal-device-only" });
      return send(res, 200, { proposals: proposals(host.store(who.account)) });
    }
    case "POST /api/agent/extensions/:id/activate":
    case "POST /api/agent/extensions/:id/reject":
    case "POST /api/agent/extensions/:id/revert": {
      // Only Juan, from a device of his: nothing activates an extension by itself, nor through the MCP (P16).
      if (who.trust !== "personal") return send(res, 403, { error: "personal-device-only" });
      const store = host.store(who.account);
      const id = params.id ?? "";
      const done = route.endsWith("/activate")
        ? activate(store, id, who.device)
        : route.endsWith("/reject")
          ? reject(store, id, who.device)
          : revert(store, id, who.device);
      return done ? send(res, 200, { ok: true }) : send(res, 404, { error: "not-found" });
    }
    case "PUT /api/agent/extensions/:id": {
      // Juan's choice, from a personal device.
      if (who.trust !== "personal") return send(res, 403, { error: "personal-device-only" });
      const b = await bodyOf(req);
      if (typeof b.enabled !== "boolean") return bad();
      const i = setEnabled(host.store(who.account), params.id ?? "", b.enabled, who.device);
      return i
        ? send(res, 200, { id: i.manifest.id, enabled: i.enabled })
        : send(res, 404, { error: "not-found" });
    }
    default:
      return send(res, 404, { error: "not-found" });
  }
}

/**
 * What Settings «Decisiones» shows: every area with its accuracy and «Solo», and whether Boni learns at all. It
 * judges and replays Juan's decisions each time (accuracy.ts); slow on his data, it says so in the log (2 ms with
 * 400 decisions here; Juan saw the pane wait, 2026-11-03).
 */
function decisionsView(store: UserStore) {
  const t0 = performance.now();
  const view = { areas: areasView(store, Date.now()), learning: learningOn(store) };
  const ms = Math.round(performance.now() - t0);
  if (ms > 500) console.warn(`decisions view took ${ms} ms`);
  return view;
}

/**
 * Juan's acceptance of a proposal with his corrections (a new title, another collection, «Enlazar», «Es el mismo»),
 * kept as his edits: the route's «Aceptar», and the action `inbox.correct` (docs/sistema.md §4.1, F10), the same code.
 */
export async function acceptCorrected(
  host: AgentHost,
  who: { account: number; device: string; trust: "personal" | "shared" | "ambient" },
  id: string,
  raw: unknown,
): Promise<{ error: string } | { done: Awaited<ReturnType<Agent["acceptProposal"]>> }> {
  const asked = (raw && typeof raw === "object" ? raw : undefined) as
    | { title?: unknown; collection?: unknown; done?: unknown; values?: unknown }
    | undefined;
  const agent = host.agent(who.account);
  // Juan's corrections first (a new title, another collection), as the agent's edits.
  const store = host.store(who.account);
  const p = store.journal.proposal(id);
  const edits = asked && p ? acceptEdits(store, p, asked) : {};
  if ("error" in edits) return { error: edits.error };
  // A task's time the procedure set alone goes with it; what Juan made of a suggested time judges it.
  const timed = p ? timeOnAccept(store, p, edits) : edits;
  // «Enlazar» (task 51): the record is made linked to the external event the calendar already had.
  const link = linkOf(asked);
  if ("error" in link) return { error: link.error };
  let final = timed;
  if (link.id && p) {
    const rows = (p.view as { rows?: { arg: string; value?: unknown }[] }).rows ?? [];
    const typeKey = timed.type ?? rows.find((r) => r.arg === "type")?.value;
    const t = Object.values(store.schema().types).find((x) => x.key === typeKey);
    const field = t ? await host.linkField?.(who.account, t.id, who.device) : null;
    if (!field) return { error: "no-link-field" };
    final = { ...timed, values: { ...(timed.values ?? {}), [field.key]: link.id } };
  }
  // «Es el mismo» (task 58): the record the calendar already had takes what the proposal adds; no new record.
  const into = intoOf(asked);
  if ("error" in into) return { error: into.error };
  if (into.id && p) {
    const merged = mergeInto(store, p, into.id, final.values ?? {});
    if ("error" in merged) return { error: merged.error };
    final = { ...final, values: merged.values };
  }
  const r = await agent.acceptProposal(id, who.trust, final, into.id ? { into: into.id } : {});
  if (p && !r.error) judgeTime(store, p, final.values ?? {}, Date.now());
  return { done: r };
}

/** What «Flujos» checks a flow against: the mail's reading modules and its collection. */
const editorOf = (host: AgentHost, account: number) => ({
  modules: host.mailModulesOf?.(account) ?? ["tasks", "events"],
  mailType: host.mailTypeOf?.(account) ?? null,
});

/**
 * A flow switched on or off (its switch in «Flujos», and the action `flows.enable`, F10): on, only when it has no
 * problems. Null when done; `already` when it was so.
 */
export function switchFlow(
  host: AgentHost,
  account: number,
  id: string,
  on: boolean,
): { error: string; problems?: unknown } | null {
  const store = host.store(account);
  const latest = store.journal.flow(id);
  if (!latest) return { error: "not-found" };
  if (latest.enabled === on) return { error: "already" };
  if (on) {
    const check = checkFlow(store, host.tools, latest, editorOf(host, account));
    if (check.problems.length) return { error: "invalid", problems: check.problems };
  }
  store.journal.setFlowEnabled(id, on);
  return null;
}

/** A flow to the trash («Borrar» in «Flujos», and `flows.delete`): Boni's own are turned off, never deleted. */
export function trashFlow(store: UserStore, id: string): { error: string } | null {
  if (!store.journal.flow(id)) return { error: "not-found" };
  if (store.journal.flowVersions(id).some((v) => v.by === "preset")) return { error: "preset" };
  store.journal.setFlowDeleted(id, true);
  return null;
}

/**
 * «Probar» (docs/flujos.md F3): the draft as the editor has it (or the saved flow), dry, with a sample. The route's,
 * and the action `flows.test` (the MCP's `flows_test`, task 63 point 13), the same code.
 */
export async function tryFlow(
  host: AgentHost,
  who: { account: number; device: string; trust: "personal" | "shared" | "ambient" },
  id: string,
  raw: unknown,
  /** Whose the form's values are: Juan's, typed in the editor; a model's, from the action. */
  said?: Label,
  /** False from an assistant over the MCP: a flow started by mail is tried in Boni, where its sample is read. */
  sampleMail = true,
): Promise<{ status: number; body: unknown }> {
  // «Probar» (docs/flujos.md F3): the draft as the editor has it (or the saved flow), dry, with a sample.
  if (!host.onFor(who.account)) return { status: 503, body: { error: "agent-off" } };
  const store = host.store(who.account);
  const f = store.journal.flow(id);
  if (!f) return { status: 404, body: { error: "not-found" } };
  const b = (raw && typeof raw === "object" ? raw : {}) as {
    plan?: unknown;
    trigger?: unknown;
    mail?: unknown;
    inputs?: unknown;
  };
  const plan = b.plan ?? f.plan;
  const trigger = b.trigger ?? f.trigger;
  const check = checkFlow(store, host.tools, { trigger, plan }, editorOf(host, who.account));
  // A part of a flow may be tried («Probar hasta aquí»): what only the whole flow must have is not asked here.
  const problems = check.problems.filter((p) => !WHOLE_FLOW_ONLY.has(p.code));
  if (problems.length) return { status: 400, body: { error: "invalid", problems } };
  let bind: Record<string, Val> = {};
  let sample: { mail: string; subject: string } | null = null;
  if (typeof (trigger as { created?: unknown }).created === "string") {
    if (!sampleMail) return { status: 409, body: { error: "mail-sample-in-boni" } };
    const mail = b.mail === undefined ? null : str(b.mail, 80);
    const s = await host.mailSample?.(who.account, mail, plan);
    if (!s) return { status: 409, body: { error: "no-sample" } };
    bind = s.bind;
    sample = { mail: s.mail, subject: s.subject };
  } else {
    const given = (b.inputs && typeof b.inputs === "object" ? b.inputs : {}) as Record<
      string,
      unknown
    >;
    const typed = said ?? label("user", "personal", [{ kind: "user-edit", id: `flow:${f.id}` }]);
    // «Aviso del presupuesto» (D-53): the month's spending and the budget as they are now, the code's own, never
    // what the request brings.
    const figures =
      (trigger as { spending?: unknown }).spending === "warn"
        ? (host.models?.noticeBind(who.account) ?? {})
        : null;
    for (const n of triggerNames(trigger)) {
      const v = given[n];
      bind[n] = figures
        ? (figures[n] ?? leaf("", codeLabel("spending")))
        : typeof v === "string"
          ? leaf(v.slice(0, 2000), typed)
          : leaf(n === "today" ? host.today() : "", codeLabel("today"));
    }
  }
  const unchanged = JSON.stringify(plan) === JSON.stringify(f.plan);
  const r = await host.agent(who.account).dryRun(plan, bind, {
    origin: originOf(trigger, who.device),
    flow: {
      id: f.id,
      version: f.version,
      by: unchanged ? f.by : "user",
      ...(sample ? { input: sample.mail } : {}),
    },
  });
  return { status: 200, body: testView(store, r, sample, (tool) => host.toolTitle(tool), plan) };
}
