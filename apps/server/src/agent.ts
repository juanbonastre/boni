import { mkdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import {
  Agent,
  coreTools,
  ensureSystemTypes,
  type ModelProvider,
  type ToolRegistry,
} from "@boni/agent";
import { openUserStore, type UserStore } from "@boni/store";
import { bodyOf, CORS, SAFE, send } from "./reply.ts";

/**
 * The conversation API (docs/nucleo.md, 7; plan PR 11), on the tailnet entry only. Each account has
 * its own store (`users/<id>.db` next to system.db) and its own agent. The device's trust level
 * (identity) is the turn's origin: a confirmation only counts from a personal device. Without a
 * model provider configured the agent is off and every route answers 503 { error: "agent-off" }.
 *
 *   POST /api/agent/turn     { text, conversation? } -> TurnResult (replies, pending, proposals, notices)
 *   POST /api/agent/answer   { run, ask, choice | text }
 *   POST /api/agent/confirm  { run, confirmation }
 *   POST /api/agent/decline  { run, confirmation }
 *   GET  /api/agent/proposals                -> { proposals } pending, with the view painted by the code
 *   POST /api/agent/proposals/:id/accept | /reject
 *   GET  /api/agent/runs                     -> { runs } the latest, for the log
 *   POST /api/agent/runs/:id/undo            -> { undone } every operation of that run
 *   GET  /api/agent/events                   -> Server-Sent Events: "notify" ({ text }) and "proposals"
 */
export interface Providers {
  planner: ModelProvider;
  reader: ModelProvider;
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
  private registry: ToolRegistry = coreTools().freeze();
  private listeners = new Map<number, Set<(event: string, data: unknown) => void>>();
  /** Called after a request that may have changed an account's data (the mirror writes it out). */
  onChanged: ((account: number) => void) | null = null;

  constructor(o: AgentHostOptions) {
    this.o = o;
  }
  /** The accounts' stores can be opened (a data folder), with the agent on or not. */
  get hasData(): boolean {
    return !!this.o.dataDir;
  }
  get on(): boolean {
    return !!(this.o.providers && this.o.dataDir);
  }

  store(account: number): UserStore {
    let s = this.stores.get(account);
    if (!s) {
      if (!this.o.dataDir) throw new Error("no data dir");
      const users = join(this.o.dataDir, "users");
      mkdirSync(users, { recursive: true, mode: 0o700 });
      s = openUserStore(join(users, `${account}.db`), this.o.now ? { now: this.o.now } : {});
      ensureSystemTypes(s);
      this.stores.set(account, s);
    }
    return s;
  }

  agent(account: number): Agent {
    let a = this.agents.get(account);
    if (!a) {
      const p = this.o.providers as Providers;
      a = new Agent({
        store: this.store(account),
        registry: this.registry,
        planner: p.planner,
        reader: p.reader,
        ...(this.o.tz ? { tz: this.o.tz } : {}),
        ...(this.o.now ? { now: this.o.now } : {}),
        // To this account's devices only: the recipient is the code's (7.9).
        notify: (text, l) => this.emit(account, "notify", { text, integrity: l.integrity }),
      });
      this.agents.set(account, a);
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

  close(): void {
    for (const s of this.stores.values()) s.close();
    this.stores.clear();
    this.agents.clear();
  }
}

const str = (v: unknown, max: number) =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : null;

/** One agent request of an authenticated account (`route` from routes.ts, already allowed here). */
export async function serveAgent(
  host: AgentHost,
  req: IncomingMessage,
  res: ServerResponse,
  route: string,
  params: Record<string, string>,
  who: { account: number; device: string; trust: "personal" | "shared" | "ambient" },
): Promise<void> {
  if (!host.on) return send(res, 503, { error: "agent-off" });
  try {
    await answerAgent(host, req, res, route, params, who);
  } finally {
    if (route.startsWith("POST ")) host.onChanged?.(who.account);
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
      const conversation = b.conversation === undefined ? `${who.device}` : str(b.conversation, 80);
      if (!conversation) return bad();
      const r = await agent.turn({
        text,
        origin: { kind: "turn", trust: who.trust, device: who.device },
        conversation: `${who.account}:${conversation}`,
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
      return send(res, 200, after(await agent.answer(run, ask, answer)));
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
          ? after(await agent.confirm(run, c, who.trust))
          : agent.decline(run, c),
      );
    }
    case "GET /api/agent/proposals":
      return send(res, 200, {
        proposals: host
          .store(who.account)
          .journal.proposals("pending")
          .map((p) => ({
            id: p.id,
            tool: p.tool,
            view: p.view,
            sources: p.sources,
            created: p.created,
          })),
      });
    case "POST /api/agent/proposals/:id/accept":
      return send(res, 200, after(await agent.acceptProposal(params.id ?? "", who.trust)));
    case "POST /api/agent/proposals/:id/reject":
      agent.rejectProposal(params.id ?? "");
      return send(res, 200, {});
    case "GET /api/agent/runs":
      return send(res, 200, {
        runs: host
          .store(who.account)
          .journal.runs(50)
          .map((r) => ({
            id: r.id,
            origin: r.origin,
            device: r.device,
            status: r.status,
            started: r.started,
            finished: r.finished,
          })),
      });
    case "POST /api/agent/runs/:id/undo":
      try {
        return send(res, 200, { undone: agent.undoRun(params.id ?? "").length });
      } catch {
        return send(res, 409, { error: "cannot-undo" });
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
