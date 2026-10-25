import type { DatabaseSync } from "node:sqlite";

/**
 * The agent's journal in the user's database (docs/nucleo.md, 7.6 and 7.7): runs and what each step
 * decided (with the rule), every model call in full, the proposals inbox, the confirmations (bound to
 * a hash of the resolved arguments, used once, expiring) and the daily budgets of background work.
 * Plain records: what they mean is the agent's (packages/agent); here they are only kept.
 */
export interface RunRow {
  id: string;
  turn: string | null;
  origin: string;
  device: string | null;
  status: string;
  plan: unknown;
  started: number;
  finished: number | null;
}
export interface StepRow {
  run: string;
  seq: number;
  step: string;
  kind: string;
  decision: string;
  rule: string | null;
  detail: unknown;
  at: number;
}
export interface ModelCallRow {
  run: string;
  role: string;
  provider: string;
  model: string;
  promptHash: string;
  request: unknown;
  response: unknown;
  usage: unknown;
  at: number;
}
export interface ProposalRow {
  id: string;
  run: string;
  tool: string;
  args: unknown;
  view: unknown;
  sources: string[];
  status: "pending" | "accepted" | "rejected" | "postponed" | "stale";
  created: number;
  decided: number | null;
  /** What Juan changed when accepting it (`{ type?: { from, to }, values?: { key: { from, to } } }`). */
  edits: ProposalEdits | null;
}
export interface ProposalEdits {
  type?: { from: string; to: string };
  values?: Record<string, { from: unknown; to: unknown }>;
}
/** A question to Juan from a run with no turn of his (the panel of requests). */
export interface RequestRow {
  id: string;
  run: string;
  /** What the panel paints (the agent's `Pending` view, labelled values). */
  view: unknown;
  status: "pending" | "answered" | "expired" | "dismissed";
  created: number;
  expires: number;
  decided: number | null;
  answer: unknown;
}
/** What model calls cost in a period, per role, provider and model (the «Modelos» page). */
export interface SpendRow {
  role: string;
  provider: string;
  model: string;
  calls: number;
  input: number;
  output: number;
  /** US dollars, of the calls whose cost is known. */
  cost: number;
  /** Calls with no known cost (an older call, a provider that does not say). */
  unpriced: number;
}
export interface ConfirmationRow {
  id: string;
  run: string;
  tool: string;
  hash: string;
  view: unknown;
  expires: number;
  used: number | null;
}

export interface Journal {
  startRun(r: Omit<RunRow, "finished" | "status" | "plan">): void;
  finishRun(id: string, status: string, plan: unknown, at: number): void;
  setPlan(id: string, plan: unknown): void;
  run(id: string): RunRow | null;
  runs(limit?: number): RunRow[];
  step(r: Omit<StepRow, "seq">): void;
  steps(run: string): StepRow[];
  /** Keeps a model call; gives its number (the audit's action refers to it). */
  modelCall(r: ModelCallRow): number;
  modelCalls(run: string): ModelCallRow[];
  /** One model call by its number (the audit's action names it). */
  modelCallById(id: number): ModelCallRow | null;
  addProposal(p: Omit<ProposalRow, "status" | "decided" | "edits">): void;
  proposal(id: string): ProposalRow | null;
  proposals(status?: ProposalRow["status"]): ProposalRow[];
  /** The pending proposals' ids in one string: cheap to compare every second (Boni Calendar polls it). */
  pendingKey(): string;
  setProposal(
    id: string,
    status: ProposalRow["status"],
    at: number,
    edits?: ProposalEdits | null,
  ): void;
  addConfirmation(c: Omit<ConfirmationRow, "used">): void;
  confirmation(id: string): ConfirmationRow | null;
  /** Marks it used; false when it was used already, expired or is not that hash. */
  useConfirmation(id: string, hash: string, at: number): boolean;
  addRequest(r: Omit<RequestRow, "status" | "decided" | "answer">): void;
  request(id: string): RequestRow | null;
  requests(status?: RequestRow["status"]): RequestRow[];
  setRequest(id: string, status: RequestRow["status"], at: number, answer?: unknown): void;
  /** Model calls from `from` to `to` (ms), grouped by role, provider and model. */
  spending(from: number, to: number): SpendRow[];
  /** Their cost per UTC day ("YYYY-MM-DD"), in dollars. */
  spendingByDay(
    from: number,
    to: number,
  ): { day: string; cost: number; byModel: Record<string, number> }[];
  /** A waiting run's state (the agent's, as JSON), kept so it survives a restart. */
  saveRunState(run: string, state: unknown, at: number): void;
  runState(run: string): unknown;
  dropRunState(run: string): void;
  /** How much of a daily budget (`key`, e.g. "reader" or "reader:<sender>") was spent on `day`. */
  spent(day: string, key: string): number;
  spend(day: string, key: string, n: number): void;
}

const j = (v: unknown) => JSON.stringify(v ?? null);
const p = (s: unknown) => (typeof s === "string" ? JSON.parse(s) : null);

export function openJournal(db: DatabaseSync): Journal {
  const runOf = (r: Record<string, unknown>): RunRow => ({
    id: r.id as string,
    turn: (r.turn as string | null) ?? null,
    origin: r.origin as string,
    device: (r.device as string | null) ?? null,
    status: r.status as string,
    plan: p(r.plan),
    started: r.started as number,
    finished: (r.finished as number | null) ?? null,
  });
  const proposalOf = (r: Record<string, unknown>): ProposalRow => ({
    id: r.id as string,
    run: r.run as string,
    tool: r.tool as string,
    args: p(r.args),
    view: p(r.view),
    sources: p(r.sources) ?? [],
    status: r.status as ProposalRow["status"],
    created: r.created as number,
    decided: (r.decided as number | null) ?? null,
    edits: p(r.edits),
  });
  const requestOf = (r: Record<string, unknown>): RequestRow => ({
    id: r.id as string,
    run: r.run as string,
    view: p(r.view),
    status: r.status as RequestRow["status"],
    created: r.created as number,
    expires: r.expires as number,
    decided: (r.decided as number | null) ?? null,
    answer: p(r.answer),
  });
  return {
    startRun: (r) =>
      void db
        .prepare(
          "INSERT INTO runs (id, turn, origin, device, status, started) VALUES (?, ?, ?, ?, 'running', ?)",
        )
        .run(r.id, r.turn, r.origin, r.device, r.started),
    finishRun: (id, status, plan, at) =>
      void db
        .prepare("UPDATE runs SET status = ?, plan = ?, finished = ? WHERE id = ?")
        .run(status, j(plan), at, id),
    setPlan: (id, plan) =>
      void db.prepare("UPDATE runs SET plan = ? WHERE id = ?").run(j(plan), id),
    run: (id) => {
      const r = db.prepare("SELECT * FROM runs WHERE id = ?").get(id);
      return r ? runOf(r) : null;
    },
    runs: (limit = 50) =>
      db.prepare("SELECT * FROM runs ORDER BY started DESC LIMIT ?").all(limit).map(runOf),
    step: (r) => {
      const seq = (
        db
          .prepare("SELECT coalesce(max(seq), 0) + 1 AS n FROM run_steps WHERE run = ?")
          .get(r.run) as { n: number }
      ).n;
      db.prepare(
        "INSERT INTO run_steps (run, seq, step, kind, decision, rule, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(r.run, seq, r.step, r.kind, r.decision, r.rule, j(r.detail), r.at);
    },
    steps: (run) =>
      db
        .prepare("SELECT * FROM run_steps WHERE run = ? ORDER BY seq")
        .all(run)
        .map((r) => ({
          run: r.run as string,
          seq: r.seq as number,
          step: r.step as string,
          kind: r.kind as string,
          decision: r.decision as string,
          rule: (r.rule as string | null) ?? null,
          detail: p(r.detail),
          at: r.at as number,
        })),
    modelCall: (r) =>
      Number(
        db
          .prepare(
            "INSERT INTO model_calls (run, role, provider, model, prompt_hash, request, response, usage, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            r.run,
            r.role,
            r.provider,
            r.model,
            r.promptHash,
            j(r.request),
            j(r.response),
            j(r.usage),
            r.at,
          ).lastInsertRowid,
      ),
    modelCalls: (run) =>
      db
        .prepare("SELECT * FROM model_calls WHERE run = ? ORDER BY rowid")
        .all(run)
        .map((r) => ({
          run: r.run as string,
          role: r.role as string,
          provider: r.provider as string,
          model: r.model as string,
          promptHash: r.prompt_hash as string,
          request: p(r.request),
          response: p(r.response),
          usage: p(r.usage),
          at: r.at as number,
        })),
    modelCallById: (id) => {
      const r = db.prepare("SELECT * FROM model_calls WHERE rowid = ?").get(id);
      return r
        ? {
            run: r.run as string,
            role: r.role as string,
            provider: r.provider as string,
            model: r.model as string,
            promptHash: r.prompt_hash as string,
            request: p(r.request),
            response: p(r.response),
            usage: p(r.usage),
            at: r.at as number,
          }
        : null;
    },
    addProposal: (x) =>
      void db
        .prepare(
          "INSERT INTO proposals (id, run, tool, args, view, sources, status, created) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
        )
        .run(x.id, x.run, x.tool, j(x.args), j(x.view), j(x.sources), x.created),
    proposal: (id) => {
      const r = db.prepare("SELECT * FROM proposals WHERE id = ?").get(id);
      return r ? proposalOf(r) : null;
    },
    proposals: (status) =>
      (status
        ? db.prepare("SELECT * FROM proposals WHERE status = ? ORDER BY created, id").all(status)
        : db.prepare("SELECT * FROM proposals ORDER BY created, id").all()
      ).map(proposalOf),
    pendingKey: () =>
      String(
        (
          db
            .prepare(
              "SELECT group_concat(id, ',') AS k FROM (SELECT id FROM proposals WHERE status = 'pending' ORDER BY id)",
            )
            .get() as { k: string | null }
        ).k ?? "",
      ),
    setProposal: (id, status, at, edits) =>
      void db
        .prepare("UPDATE proposals SET status = ?, decided = ?, edits = ? WHERE id = ?")
        .run(status, at, edits ? j(edits) : null, id),
    addConfirmation: (c) =>
      void db
        .prepare(
          "INSERT INTO confirmations (id, run, tool, hash, view, expires) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(c.id, c.run, c.tool, c.hash, j(c.view), c.expires),
    confirmation: (id) => {
      const r = db.prepare("SELECT * FROM confirmations WHERE id = ?").get(id);
      return r
        ? {
            id: r.id as string,
            run: r.run as string,
            tool: r.tool as string,
            hash: r.hash as string,
            view: p(r.view),
            expires: r.expires as number,
            used: (r.used as number | null) ?? null,
          }
        : null;
    },
    useConfirmation: (id, hash, at) =>
      db
        .prepare(
          "UPDATE confirmations SET used = ? WHERE id = ? AND hash = ? AND used IS NULL AND expires > ?",
        )
        .run(at, id, hash, at).changes > 0,
    addRequest: (r) =>
      void db
        .prepare(
          "INSERT INTO requests (id, run, view, status, created, expires) VALUES (?, ?, ?, 'pending', ?, ?)",
        )
        .run(r.id, r.run, j(r.view), r.created, r.expires),
    request: (id) => {
      const r = db.prepare("SELECT * FROM requests WHERE id = ?").get(id);
      return r ? requestOf(r) : null;
    },
    requests: (status) =>
      (status
        ? db.prepare("SELECT * FROM requests WHERE status = ? ORDER BY created, rowid").all(status)
        : db.prepare("SELECT * FROM requests ORDER BY created, rowid").all()
      ).map(requestOf),
    setRequest: (id, status, at, answer) =>
      void db
        .prepare("UPDATE requests SET status = ?, decided = ?, answer = ? WHERE id = ?")
        .run(status, at, answer === undefined ? null : j(answer), id),
    spending: (from, to) =>
      db
        .prepare(
          `SELECT role, provider, model, count(*) AS calls,
             coalesce(sum(json_extract(usage, '$.input')), 0) AS input,
             coalesce(sum(json_extract(usage, '$.output')), 0) AS output,
             coalesce(sum(json_extract(usage, '$.cost')), 0) AS cost,
             sum(json_extract(usage, '$.cost') IS NULL) AS unpriced
           FROM model_calls WHERE at >= ? AND at < ?
           GROUP BY role, provider, model ORDER BY cost DESC, calls DESC`,
        )
        .all(from, to)
        .map((r) => ({
          role: r.role as string,
          provider: r.provider as string,
          model: r.model as string,
          calls: Number(r.calls),
          input: Number(r.input),
          output: Number(r.output),
          cost: Number(r.cost),
          unpriced: Number(r.unpriced),
        })),
    spendingByDay: (from, to) => {
      const days = new Map<
        string,
        { day: string; cost: number; byModel: Record<string, number> }
      >();
      for (const r of db
        .prepare(
          `SELECT strftime('%Y-%m-%d', at / 1000, 'unixepoch') AS day, model,
             coalesce(sum(json_extract(usage, '$.cost')), 0) AS cost
           FROM model_calls WHERE at >= ? AND at < ? GROUP BY day, model ORDER BY day`,
        )
        .all(from, to)) {
        const d = days.get(r.day as string) ?? { day: r.day as string, cost: 0, byModel: {} };
        d.cost += Number(r.cost);
        d.byModel[r.model as string] = Number(r.cost);
        days.set(d.day, d);
      }
      return [...days.values()];
    },
    saveRunState: (run, state, at) =>
      void db
        .prepare(
          "INSERT INTO waiting_runs (run, state, saved) VALUES (?, ?, ?) ON CONFLICT(run) DO UPDATE SET state = excluded.state, saved = excluded.saved",
        )
        .run(run, j(state), at),
    runState: (run) => {
      const r = db.prepare("SELECT state FROM waiting_runs WHERE run = ?").get(run) as
        | { state: string }
        | undefined;
      return r ? p(r.state) : null;
    },
    dropRunState: (run) => void db.prepare("DELETE FROM waiting_runs WHERE run = ?").run(run),
    spent: (day, key) =>
      (
        db.prepare("SELECT n FROM budgets WHERE day = ? AND key = ?").get(day, key) as
          | { n: number }
          | undefined
      )?.n ?? 0,
    spend: (day, key, n) =>
      void db
        .prepare(
          "INSERT INTO budgets (day, key, n) VALUES (?, ?, ?) ON CONFLICT(day, key) DO UPDATE SET n = n + excluded.n",
        )
        .run(day, key, n),
  };
}
