import { mkdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import {
  Agent,
  conversation,
  conversationByKey,
  coreTools,
  createConversation,
  deleteConversation,
  ensureSystemTypes,
  type LiveEvent,
  listConversations,
  type ModelProvider,
  type ToolRegistry,
  turnViews,
  updateConversation,
} from "@boni/agent";
import { openUserStore, type UserStore } from "@boni/store";
import { measure } from "./autoAccept.ts";
import { setProtection } from "./data.ts";
import { ensurePresets, installed, setEnabled } from "./extensions.ts";
import { type InboxCard, inboxCard, inboxContext } from "./inboxCard.ts";
import { mailOfRun } from "./mailReview.ts";
import { type AccountModels, type PlannerChoice, serveModels } from "./models.ts";
import { acceptEdits } from "./proposalEdits.ts";
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
 *   POST /api/agent/proposals/:id/accept     { edits?: { title?, collection? } } Juan's corrections, kept
 *   POST /api/agent/proposals/:id/reject
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
 *   GET  /api/agent/events                   -> Server-Sent Events: "notify" ({ text }) and "proposals"
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
}

export class AgentHost {
  private o: AgentHostOptions;
  private stores = new Map<number, UserStore>();
  private agents = new Map<number, Agent>();
  /** The providers each account's agent was last given (they change when Juan chooses other models). */
  private used = new Map<number, Providers>();
  private registry: ToolRegistry = coreTools().freeze();
  private listeners = new Map<number, Set<(event: string, data: unknown) => void>>();
  /** The account's mailbox as the inbox names it (its address), when it has one (mail.ts). */
  mailAccountOf: ((account: number) => string | null) | null = null;
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
      s = openUserStore(join(users, `${account}.db`), this.o.now ? { now: this.o.now } : {});
      ensureSystemTypes(s);
      ensurePresets(s);
      this.stores.set(account, s);
    }
    return s;
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
        ...(this.o.tz ? { tz: this.o.tz } : {}),
        ...(this.o.now ? { now: this.o.now } : {}),
        // To this account's devices only: the recipient is the code's (7.9).
        notify: (text, l) => this.emit(account, "notify", { text, integrity: l.integrity }),
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
  if (!host.onFor(who.account)) return send(res, 503, { error: "agent-off" });
  await answerAgent(host, req, res, route, params, who);
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
    case "GET /api/agent/proposals": {
      const store = host.store(who.account);
      const ctx = inboxContext(store);
      const mailAccount = host.mailAccountOf?.(who.account) ?? null;
      return send(res, 200, {
        proposals: store.journal.proposals("pending").map((p) => {
          let card: InboxCard | null = null;
          try {
            card = inboxCard(store, p, { mailAccount }, ctx);
          } catch {
            // a proposal the card cannot read still shows with its rows
          }
          return {
            id: p.id,
            tool: p.tool,
            view: p.view,
            sources: p.sources,
            created: p.created,
            card,
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
        edits?: { title?: unknown; collection?: unknown; done?: unknown };
      };
      const p = host.store(who.account).journal.proposal(params.id ?? "");
      const edits = b.edits && p ? acceptEdits(host.store(who.account), p, b.edits) : {};
      if ("error" in edits) return send(res, 400, { error: edits.error });
      return send(res, 200, after(await agent.acceptProposal(params.id ?? "", who.trust, edits)));
    }
    case "POST /api/agent/proposals/:id/reject":
      agent.rejectProposal(params.id ?? "");
      return send(res, 200, {});
    case "GET /api/agent/runs": {
      const store = host.store(who.account);
      const proposals = proposalsByRun(store);
      const mailAccount = host.mailAccountOf?.(who.account) ?? null;
      let autoAccept: ReturnType<typeof measure> | null = null;
      try {
        autoAccept = measure(store);
      } catch {
        // the Registro shows without it
      }
      return send(res, 200, {
        ...(autoAccept ? { autoAccept } : {}),
        runs: store.journal.runs(50).map((r) => {
          let info: RunInfo | null = null;
          try {
            info = runInfo(store, r, { proposals, mailAccount });
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
    default:
      return send(res, 404, { error: "not-found" });
  }
}
