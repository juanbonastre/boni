import { existsSync, mkdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import {
  Agent,
  codeLabel,
  conversation,
  conversationByKey,
  coreTools,
  createConversation,
  deleteConversation,
  ensureSystemTypes,
  type LiveEvent,
  leaf,
  listConversations,
  type ModelProvider,
  runnableNames,
  type ToolRegistry,
  turnViews,
  updateConversation,
  type Val,
} from "@boni/agent";
import { dayToIso, todayIn } from "@boni/calendar";
import { label } from "@boni/entities";
import { openUserStore, type StoreOptions, type UserStore } from "@boni/store";
import { areasView, setAuto } from "./accuracy.ts";
import { aloneRuns, measure } from "./autoAccept.ts";
import { setProtection } from "./data.ts";
import { ensurePresets, installed, setEnabled } from "./extensions.ts";
import type { ExternalItem } from "./externalItems.ts";
import {
  checkFlow,
  createFlow,
  flowCatalog,
  flowProposalView,
  flowsView,
  flowView,
  originOf,
  revertFlow,
  saveUserFlow,
  testView,
  triggerNames,
} from "./flows.ts";
import { type InboxCard, inboxCard, inboxContext, judgeTime, timeOnAccept } from "./inboxCard.ts";
import { learningOn, setLearning } from "./learning.ts";
import { mailOfRun } from "./mailReview.ts";
import { type AccountModels, type PlannerChoice, serveModels } from "./models.ts";
import { pipelineView } from "./pipeline.ts";
import { acceptEdits, intoOf, linkOf, mergeInto } from "./proposalEdits.ts";
import { activate, previousVersion, proposals, reject, revert } from "./proposals.ts";
import { bodyOf, CORS, SAFE, send } from "./reply.ts";
import { proposalsByRun, type RunInfo, runInfo } from "./runInfo.ts";

/**
 * The conversation API (docs/nucleo.md, 7; plan PR 11), on the tailnet entry only. Each account has
 * its own store (`users/<id>.db` next to system.db) and its own agent. The device's trust level
 * (identity) is the turn's origin: a confirmation only counts from a personal device. Without a
 * model provider configured the agent is off and every route answers 503 { error: "agent-off" }.
 *
 *   POST /api/agent/turn     { text, conversation?, live? } -> TurnResult (replies, pending, proposals, notices)
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
  private agents = new Map<number, Agent>();
  /** The providers each account's agent was last given (they change when Juan chooses other models). */
  private used = new Map<number, Providers>();
  private registry: ToolRegistry = coreTools().freeze();
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
  /** The account spent its month's budget (models.ts): background work calls no model. */
  overBudget: ((account: number) => boolean) | null = null;
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
    return s;
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
        overBudget: () => this.overBudget?.(account) ?? false,
        // A reader of mail in the conversation reads with Juan's guide, as the background reading does.
        readingGuide: () => this.readingGuideOf?.(account) ?? null,
        ...(this.o.tz ? { tz: this.o.tz } : {}),
        ...(this.o.now ? { now: this.o.now } : {}),
        // To this account's devices only: the recipient is the code's (7.9).
        notify: (text, l) => this.notify(account, text, l.integrity),
        onRequest: () => this.emit(account, "requests", {}),
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
    return flowView(
      store,
      fid,
      Date.now(),
      days,
      (tool) => host.toolTitle(tool),
      (key) => types.find((t) => t.key === key)?.name ?? null,
    );
  };
  if (route !== "GET /api/agent/flows" && route !== "GET /api/agent/flows/:id" && !mine)
    return send(res, 403, { error: "personal-device-only" });
  switch (route) {
    case "GET /api/agent/flows":
      return send(res, 200, { flows: flowsView(store) });
    case "GET /api/agent/flows/catalog":
      return send(res, 200, flowCatalog(host.tools, store, forEditor().modules));
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
        layout?: unknown;
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
          ...(b.layout !== undefined ? { layout: layoutOf(b.layout) } : {}),
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
      const latest = store.journal.flow(id);
      if (!latest) return send(res, 404, { error: "not-found" });
      if (typeof b.enabled !== "boolean") return send(res, 400, { error: "bad-request" });
      if (b.enabled) {
        const check = checkFlow(store, host.tools, latest, forEditor());
        if (check.problems.length)
          return send(res, 400, { error: "invalid", problems: check.problems });
      }
      store.journal.setFlowEnabled(id, b.enabled);
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
      if (!store.journal.flow(id)) return send(res, 404, { error: "not-found" });
      // Boni's own flows are turned off, never deleted.
      if (store.journal.flowVersions(id).some((v) => v.by === "preset"))
        return send(res, 409, { error: "preset" });
      store.journal.setFlowDeleted(id, true);
      return send(res, 200, {});
    }
    case "POST /api/agent/flows/:id/test": {
      // «Probar» (docs/flujos.md F3): the draft as the editor has it (or the saved flow), dry, with a sample.
      if (!host.onFor(who.account)) return send(res, 503, { error: "agent-off" });
      const f = store.journal.flow(id);
      if (!f) return send(res, 404, { error: "not-found" });
      const b = (await bodyOf(req)) as {
        plan?: unknown;
        trigger?: unknown;
        mail?: unknown;
        inputs?: unknown;
      };
      const plan = b.plan ?? f.plan;
      const trigger = b.trigger ?? f.trigger;
      const check = checkFlow(store, host.tools, { trigger, plan }, forEditor());
      if (check.problems.length)
        return send(res, 400, { error: "invalid", problems: check.problems });
      let bind: Record<string, Val> = {};
      let sample: { mail: string; subject: string } | null = null;
      if (typeof (trigger as { created?: unknown }).created === "string") {
        const mail = b.mail === undefined ? null : str(b.mail, 80);
        const s = await host.mailSample?.(who.account, mail, plan);
        if (!s) return send(res, 409, { error: "no-sample" });
        bind = s.bind;
        sample = { mail: s.mail, subject: s.subject };
      } else {
        const given = (b.inputs && typeof b.inputs === "object" ? b.inputs : {}) as Record<
          string,
          unknown
        >;
        const typed = label("user", "personal", [{ kind: "user-edit", id: `flow:${f.id}` }]);
        for (const n of triggerNames(trigger)) {
          const v = given[n];
          bind[n] =
            typeof v === "string"
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
      return send(
        res,
        200,
        testView(store, r, sample, (tool) => host.toolTitle(tool)),
      );
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
      const q = new URL(req.url ?? "/", "http://boni").searchParams;
      const days = Math.min(90, Math.max(1, Math.round(Number(q.get("days")) || 7)));
      const v = detail(id, days);
      return v ? send(res, 200, v) : send(res, 404, { error: "not-found" });
    }
    default:
      return send(res, 404, { error: "not-found" });
  }
}

/** Where the user left each node: ids to points, nothing else (presentation only). */
function layoutOf(v: unknown): Record<string, { x: number; y: number }> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, { x: number; y: number }> = {};
  for (const [k, p] of Object.entries(v).slice(0, 60)) {
    const x = (p as { x?: unknown } | null)?.x;
    const y = (p as { y?: unknown } | null)?.y;
    if (
      /^[A-Za-z0-9_]{1,40}$/.test(k) &&
      typeof x === "number" &&
      typeof y === "number" &&
      Number.isFinite(x) &&
      Number.isFinite(y)
    )
      out[k] = { x: Math.round(x), y: Math.round(y) };
  }
  return out;
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
      return send(res, 200, { conversation: c, turns: turnViews(store, id) });
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
      const planner = c.model ? (host.plannerFor?.(who.account, c.model) ?? undefined) : undefined;
      const live = liveId(b.live);
      const r = await agent.turn({
        text,
        origin: { kind: "turn", trust: who.trust, device: who.device },
        conversation: c.id,
        ...(live ? { live: host.liveStart(who.account, live) } : {}),
        ...(planner ? { planner } : {}),
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
    case "GET /api/agent/pipeline": {
      // «Modelos» (task 59b): the declared flow's numbers of the last days (7 by default, 90 at most).
      const q = new URL(req.url ?? "/", "http://boni").searchParams;
      const days = Math.min(90, Math.max(1, Math.round(Number(q.get("days")) || 7)));
      return send(
        res,
        200,
        pipelineView(
          host.store(who.account),
          Date.now(),
          days,
          host.mailAccountOf?.(who.account) ?? null,
        ),
      );
    }
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
      // Juan's corrections first (a new title, another collection), as the agent's edits.
      const b = ((await bodyOf(req)) ?? {}) as {
        edits?: { title?: unknown; collection?: unknown; done?: unknown; values?: unknown };
      };
      const store = host.store(who.account);
      const p = store.journal.proposal(params.id ?? "");
      const edits = b.edits && p ? acceptEdits(store, p, b.edits) : {};
      if ("error" in edits) return send(res, 400, { error: edits.error });
      // A task's time the procedure set alone goes with it; what Juan made of a suggested time judges it.
      const timed = p ? timeOnAccept(store, p, edits) : edits;
      // «Enlazar» (task 51): the record is made linked to the external event the calendar already had.
      const link = linkOf(b.edits);
      if ("error" in link) return send(res, 400, { error: link.error });
      let final = timed;
      if (link.id && p) {
        const rows = (p.view as { rows?: { arg: string; value?: unknown }[] }).rows ?? [];
        const typeKey = timed.type ?? rows.find((r) => r.arg === "type")?.value;
        const t = Object.values(store.schema().types).find((x) => x.key === typeKey);
        const field = t ? await host.linkField?.(who.account, t.id, who.device) : null;
        if (!field) return send(res, 400, { error: "no-link-field" });
        final = { ...timed, values: { ...(timed.values ?? {}), [field.key]: link.id } };
      }
      // «Es el mismo» (task 58): the record the calendar already had takes what the proposal adds; no new record.
      const into = intoOf(b.edits);
      if ("error" in into) return send(res, 400, { error: into.error });
      if (into.id && p) {
        const merged = mergeInto(store, p, into.id, final.values ?? {});
        if ("error" in merged) return send(res, 400, { error: merged.error });
        final = { ...final, values: merged.values };
      }
      const r = await agent.acceptProposal(
        params.id ?? "",
        who.trust,
        final,
        into.id ? { into: into.id } : {},
      );
      if (p && !r.error) judgeTime(store, p, final.values ?? {}, Date.now());
      return send(res, 200, after(r));
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
      return d ? send(res, 200, d) : send(res, 404, { error: "not-found" });
    }
    case "POST /api/agent/runs/:id/undo":
      try {
        return send(res, 200, { undone: agent.undoRun(params.id ?? "").length });
      } catch {
        return send(res, 409, { error: "cannot-undo" });
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
