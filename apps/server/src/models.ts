import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AnthropicProvider,
  CONNECTIONS,
  type Connection,
  choiceId,
  codeLabel,
  DEFAULT_MODELS,
  EMPTY_LIST,
  EVAL_DAYS,
  type EvalParts,
  evaluatedFor,
  firstOfTag,
  gateOpen,
  JevProvider,
  KIND_OF_ROLE,
  KINDS,
  type Kind,
  kindsOf,
  leaf,
  listConversations,
  listErrors,
  MODELS_MAX,
  type ModelProvider,
  type ModelRoute,
  type ModelsConfig,
  type ModelsList,
  markOf,
  modelsErrors,
  OpenAIProvider,
  type Privacy,
  parseChoice,
  privacyOf,
  ROLE_OF_KIND,
  ROLES,
  type Role,
  type RoleChoice,
  TAG_NAME_MAX,
  TAG_REF,
  TAGS_MAX,
  tagOfRef,
  type Val,
} from "@boni/agent";
import { type EvalResult, evalModel, evalRole } from "@boni/agent/evals";
import { callKindOf } from "@boni/automations";
import { wrappedKeysIn } from "@boni/identity";
import { fetchText } from "@boni/net";
import {
  type FlowRow,
  open,
  type SpendRow,
  seal,
  type UserStore,
  wrappedKeyProvider,
} from "@boni/store";
import type { AgentHost, Providers } from "./agent.ts";
import type { Db } from "./db.ts";
import { BUDGET_FLOW, ensureFlow } from "./flows.ts";
import { bodyOf, send } from "./reply.ts";
import type { SecretKey } from "./secret.ts";

/**
 * «Modelos» (Juan, 2026-10-24): which model does each role for an account, with what key, what it spends and how
 * it treats the data. Kept in the user's store, outside the operation log: the choices as they are, the keys
 * sealed with the user's data key (never sent back to a device). Without a choice of his, a role runs as the
 * server is configured (its environment), as before. A month's spending warns once at the budget's fraction (Boni's
 * flow «Aviso del presupuesto», below) and, at the budget, stops background work from calling models (the agent's
 * `overBudget`).
 *
 * Privacy (option 1): a role through OpenRouter asks for providers that keep and collect nothing (`zdr`); only
 * then does the page say so. Anthropic's own API deletes what it receives within 30 days.
 */
const OPENROUTER = "https://openrouter.ai/api/v1";
const CONFIG = "models/config";
const KEYS = "models/keys";
const WARNED = "models/warned";
const EVALS = "models/evals";
/** «Modelos» without uses (§5.16): the list, its tags and «De la cuenta» (AU-232), and each model's evaluation. */
const LIST = "models/list";
const MARKS = "models/evaluation";

/**
 * Boni's «Aviso del presupuesto» (docs/sistema.md §4.2, D-53): what `overBudget` did by itself when the month's
 * spending passed the budget's warning, as a flow Juan sees, changes and turns off. Its trigger («El gasto del mes
 * pasa del aviso») gives the month's spending and the budget; its one step tells his devices. One run a month, with no
 * model call. Changing or turning it off changes what is told, never the cap: `overBudget` answers the same.
 */
export const BUDGET_TRIGGER = { spending: "warn" };
export const BUDGET_PLAN = {
  version: 1,
  steps: [
    {
      id: "notify",
      op: "call",
      tool: "notify",
      args: {
        text: {
          fn: "concat",
          args: [
            { lit: "Los modelos llevan " },
            { ref: "$spent" },
            { lit: " € de " },
            { ref: "$budget" },
            { lit: " € este mes." },
          ],
        },
      },
    },
  ],
};
/** The month's spending and the budget as the notice says them (euros; the names of flows.ts `SPENDING_INPUTS`). */
const figuresOf = (eur: number, monthlyEur: number) => ({
  spent: eur.toFixed(2),
  budget: String(monthlyEur),
});
type Figures = ReturnType<typeof figuresOf>;
/** What the trigger binds to the flow's plan: the code's own figures. */
const bindOf = (f: Figures): Record<string, Val> => ({
  spent: leaf(f.spent, codeLabel("spending")),
  budget: leaf(f.budget, codeLabel("spending")),
});
/** Whether a run told: its «Avisar» ran (the journal's step of the tool `notify`, allowed). */
const toldIn = (store: UserStore, run: string): boolean =>
  store.journal
    .steps(run)
    .some(
      (x) => x.decision === "allow" && (x.detail as { tool?: unknown } | null)?.tool === "notify",
    );

/** One evaluation kept for the page (the last few per account). */
export interface Evaluation extends EvalResult {
  role: Role;
  connection: Connection;
  model: string;
  zdr: boolean;
  at: number;
}
const same = (
  e: Pick<Evaluation, "role" | "connection" | "model" | "zdr">,
  c: Pick<Evaluation, "role" | "connection" | "model" | "zdr">,
) => e.role === c.role && e.connection === c.connection && e.model === c.model && e.zdr === c.zdr;

/**
 * A model's last evaluation (AU-234): one part per kind of call it answers, each with its cases and its own date.
 * A new evaluation gives every part one date; those carried from the uses of before keep theirs (AU-244).
 */
export interface ModelEvaluation {
  parts: Partial<Record<Kind, EvalResult & { at: number }>>;
}

export interface ModelsOptions {
  db: Db;
  key: SecretKey;
  host: AgentHost;
  /** What each role runs on when the account chose nothing: the server's environment. */
  defaults: Partial<Record<Role, RoleChoice>>;
  /** The server's own keys (its environment), used when the account has none of its own. */
  serverKeys: Partial<Record<Connection, string>>;
  now?: () => number;
  /** Tests only: the catalogue's download. */
  fetchCatalogue?: (url: string) => Promise<string>;
  /** Tests only: how a role's provider is made (default: the real one for its connection). */
  makeProvider?: (
    v: Pick<RoleView, "role" | "connection" | "model" | "zdr">,
    key: string,
  ) => ModelProvider;
}

/** A role as the page shows it. */
export interface RoleView {
  role: Role;
  connection: Connection;
  model: string;
  zdr: boolean;
  privacy: Privacy;
  /** Juan chose it (else the server's default). */
  chosen: boolean;
  /** The key it needs is missing: it runs on the server's default instead. */
  missingKey: boolean;
}

export class AccountModels {
  private o: ModelsOptions;
  private keysOf = new Map<number, Buffer>();
  private built = new Map<number, { sig: string; providers: Providers | null }>();
  private spent = new Map<number, { at: number; eur: number }>();
  private cached: { at: number; models: CatalogueModel[] } | null = null;
  /** The evaluation running for each account (one at a time). */
  private running = new Map<number, Pick<Evaluation, "role" | "connection" | "model" | "zdr">>();
  /** The model being evaluated for each account (`evaluateModel`), by its id. */
  private runningModel = new Map<number, string>();
  /** What goes on in the background: the evaluations, and a run of «Aviso del presupuesto». */
  private jobs = new Set<Promise<void>>();
  /** The month each account passed the warning with «Aviso del presupuesto» off (said once in the log). */
  private silent = new Map<number, string>();

  constructor(o: ModelsOptions) {
    this.o = o;
  }
  private now = () => (this.o.now ?? Date.now)();

  private dataKey(account: number): Buffer {
    let k = this.keysOf.get(account);
    if (!k) {
      k = wrappedKeyProvider(this.o.key, wrappedKeysIn(this.o.db)).dataKey(String(account));
      this.keysOf.set(account, k);
    }
    return k;
  }

  config(account: number): ModelsConfig {
    const v = this.o.host.store(account).setting(CONFIG);
    if (!v) return structuredClone(DEFAULT_MODELS);
    try {
      const c = { ...DEFAULT_MODELS, ...(JSON.parse(v) as Partial<ModelsConfig>) };
      return modelsErrors(c).length ? structuredClone(DEFAULT_MODELS) : c;
    } catch {
      return structuredClone(DEFAULT_MODELS);
    }
  }

  saveConfig(account: number, c: ModelsConfig): string[] {
    const errors = modelsErrors(c);
    if (errors.length) return errors;
    this.o.host.store(account).setSetting(CONFIG, JSON.stringify(c));
    this.built.delete(account);
    return [];
  }

  /** The account's own keys (never leave the server). */
  private keys(account: number): Partial<Record<Connection, string>> {
    const v = this.o.host.store(account).setting(KEYS);
    if (!v) return {};
    try {
      return JSON.parse(
        open(this.dataKey(account), Buffer.from(v, "base64"), KEYS).toString("utf8"),
      ) as Partial<Record<Connection, string>>;
    } catch {
      return {};
    }
  }

  setKey(account: number, connection: Connection, key: string | null): void {
    const keys = { ...this.keys(account) };
    if (key) keys[connection] = key;
    else delete keys[connection];
    this.o.host
      .store(account)
      .setSetting(
        KEYS,
        Object.keys(keys).length
          ? seal(this.dataKey(account), Buffer.from(JSON.stringify(keys), "utf8"), KEYS).toString(
              "base64",
            )
          : null,
      );
    this.built.delete(account);
  }

  private keyFor(account: number, c: Connection): string | null {
    return this.keys(account)[c] ?? this.o.serverKeys[c] ?? null;
  }

  /** Each role as it runs now: Juan's choice when its key is there, else the server's default. */
  roles(account: number): RoleView[] {
    const c = this.config(account);
    return ROLES.flatMap((role): RoleView[] => {
      const mine = c.roles[role];
      const missingKey = !!mine && !this.keyFor(account, mine.connection);
      const use = mine && !missingKey ? mine : this.o.defaults[role];
      if (!use) return [];
      return [
        {
          role,
          connection: use.connection,
          model: use.model,
          zdr: !!use.zdr,
          privacy: privacyOf(use),
          chosen: !!mine && !missingKey,
          missingKey,
        },
      ];
    });
  }

  /**
   * The providers of an account that chose something of its own (models, keys, rows or tags); null: the server's,
   * unchanged. The agent, the reader and the decider are «De la cuenta»'s rows as they answer now (AU-236); the
   * reviewer is still its use's, for the engine of before until the conversion (AU-244). Built once per what
   * answers, so the agent keeps the same objects until it changes.
   */
  providers(account: number): Providers | null {
    const own = this.keys(account);
    const c = this.config(account);
    const l = this.list(account);
    if (
      !Object.keys(c.roles).length &&
      !Object.keys(own).length &&
      KINDS.every((k) => l.account[k] === null)
    )
      return null;
    const answers = KINDS.map((k) => {
      const r = this.resolveModel(account, k, null);
      return "refused" in r ? null : r;
    });
    const reviewer = this.roles(account).find((v) => v.role === "reviewer");
    const sig = JSON.stringify([
      answers.map((a) => a?.id ?? null),
      reviewer ?? null,
      Object.keys(own).sort(),
      Object.values(own).map((k) => k.length),
    ]);
    const had = this.built.get(account);
    if (had?.sig === sig) return had.providers;
    const [agent, reading, decision] = KINDS.map((k, i) => {
      const a = answers[i];
      return a ? this.make(account, k, a.route) : null;
    });
    const review = reviewer ? this.make(account, "reading", reviewer) : null;
    const providers: Providers | null =
      agent && reading
        ? {
            planner: agent,
            reader: reading,
            ...(decision ? { decider: decision } : {}),
            ...(review ? { reviewer: review } : {}),
          }
        : null;
    this.built.set(account, { sig, providers });
    return providers;
  }

  /** This month (UTC), from its first millisecond to the next month's. */
  private month(): { label: string; from: number; to: number } {
    const d = new Date(this.now());
    const from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const to = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    return { label: new Date(from).toISOString().slice(0, 7), from, to };
  }

  spending(account: number): {
    month: string;
    eur: number;
    rows: (SpendRow & { eur: number })[];
    byDay: { day: string; eur: number; byModel: Record<string, number> }[];
  } {
    const m = this.month();
    const rate = this.config(account).usdToEur;
    const j = this.o.host.store(account).journal;
    const rows = j.spending(m.from, m.to).map((r) => ({ ...r, eur: r.cost * rate }));
    return {
      month: m.label,
      eur: rows.reduce((a, r) => a + r.eur, 0),
      rows,
      byDay: j.spendingByDay(m.from, m.to).map((d) => ({
        day: d.day,
        eur: d.cost * rate,
        byModel: Object.fromEntries(Object.entries(d.byModel).map(([k, v]) => [k, v * rate])),
      })),
    };
  }

  /**
   * The month's budget is spent (asked before each background model call). The month's spending is read again once
   * its figure is 30 s old, also while the calls keep coming (a burst of readings never looks at an old figure for
   * longer). Passing the budget's warning fraction starts Boni's «Aviso del presupuesto» once a month (`warn`). The
   * answer is the cap, and nothing of that flow changes it: on, off or changed, background work stops at the budget
   * (D-53). A «Probar» that asks (`dry`) gets the same answer and starts nothing: the notice waits for the next call
   * that is no test (D-43).
   */
  overBudget(account: number, asking: { dry?: boolean } = {}): boolean {
    const now = this.now();
    let had = this.spent.get(account);
    if (!had || now - had.at >= 30_000) {
      had = { at: now, eur: this.spending(account).eur };
      this.spent.set(account, had);
    }
    const eur = had.eur;
    const { budget } = this.config(account);
    const store = this.o.host.store(account);
    const month = this.month().label;
    // Without a budget (0) there is no warning to pass.
    if (
      !asking.dry &&
      budget.monthlyEur > 0 &&
      eur >= budget.monthlyEur * budget.warnAt &&
      store.setting(WARNED) !== month
    )
      this.warn(account, store, month, figuresOf(eur, budget.monthlyEur));
    return budget.monthlyEur > 0 && eur >= budget.monthlyEur;
  }

  /**
   * The month's spending passed the warning and the month is not marked yet: one run of «Aviso del presupuesto», whose
   * «Avisar» tells the devices. Turned off, nothing is told and the month stays unmarked (turned on later in the
   * month, the next check tells). The month is marked before the run starts, so there is one run a month whatever it
   * does, and the run's own budget check (a model step Juan added to it) starts no other. On, the month's notice is
   * never lost to the machinery: without the flow (it could not be kept), without models for the account (nothing to
   * run it) or when its run stops before its «Avisar» (a model step of his version stopped by the cap, a model down),
   * the code tells as before, with its own text.
   */
  private warn(account: number, store: UserStore, month: string, figures: Figures): void {
    let flow: FlowRow | null = null;
    try {
      flow = this.noticeFlow(store);
    } catch (e) {
      console.warn(`models ${account}: «Aviso del presupuesto» not kept (${(e as Error).message})`);
    }
    const passed = `${figures.spent} € of ${figures.budget} € this month, past the warning`;
    if (flow && !flow.enabled) {
      if (this.silent.get(account) !== month)
        console.log(`models ${account}: ${passed}; «Aviso del presupuesto» is off: no notice`);
      this.silent.set(account, month);
      return;
    }
    store.setSetting(WARNED, month);
    const byCode = (why: string) => {
      this.o.host.notify(
        account,
        `Los modelos llevan ${figures.spent} € de ${figures.budget} € este mes.`,
        "own",
      );
      console.log(`models ${account}: ${passed}: told by code (${why})`);
    };
    const agent = flow ? this.agentOf(account) : null;
    if (!flow || !agent) {
      byCode(flow ? "no models to run the flow" : "the flow could not be kept");
      return;
    }
    const version = flow;
    // After this check has answered: the run is its own work, not a part of the model call that asked.
    const job = Promise.resolve()
      .then(() =>
        agent.background(version.plan, bindOf(figures), [], undefined, {
          id: BUDGET_FLOW,
          version: version.version,
          by: version.by,
        }),
      )
      .then(
        (r) => {
          console.log(
            `models ${account}: ${passed}: «Aviso del presupuesto» v${version.version} ran (${r.status}${r.error ? `, ${r.error}` : ""})`,
          );
          if (r.status === "stopped" && !toldIn(store, r.run))
            byCode("its run stopped before «Avisar»");
        },
        (e) => {
          console.error(
            `models ${account}: «Aviso del presupuesto» failed (${(e as Error).message})`,
          );
          byCode("its run failed");
        },
      )
      // Whatever goes wrong telling, the job ends: nothing here may take the server down.
      .catch((e) =>
        console.error(`models ${account}: the notice failed (${(e as Error).message})`),
      );
    this.jobs.add(job);
    void job.finally(() => this.jobs.delete(job));
  }

  /** Boni's «Aviso del presupuesto» at its latest version: the user's when he saved one, else Boni's, saved only when
   * it changed (as the mail's flows are kept). */
  private noticeFlow(store: UserStore): FlowRow {
    return ensureFlow(
      store,
      {
        id: BUDGET_FLOW,
        name: "Aviso del presupuesto",
        trigger: BUDGET_TRIGGER,
        plan: BUDGET_PLAN,
        by: "preset",
      },
      this.now(),
    );
  }

  /**
   * «Aviso del presupuesto» is among the account's flows from the first time its store is asked for with «Modelos»
   * there (agent.ts `store`), and before «Flujos» or the map list them: on a server with no model at all too, where it
   * never fires. Nothing without a data folder (then there is no store, no agent, and nobody asks the budget).
   */
  keepFlowCurrent(account: number): void {
    if (!this.o.host.hasData) return;
    try {
      this.noticeFlow(this.o.host.store(account));
    } catch (e) {
      console.warn(`models ${account}: «Aviso del presupuesto» not kept (${(e as Error).message})`);
    }
  }

  /** What «Aviso del presupuesto»'s trigger would bind now («Probar»): the month's spending and the budget. */
  noticeBind(account: number): Record<string, Val> {
    return bindOf(figuresOf(this.spending(account).eur, this.config(account).budget.monthlyEur));
  }

  /** The account's agent, or null when it has no models (then the notice is told by code, with no run). */
  private agentOf(account: number): ReturnType<AgentHost["agent"]> | null {
    if (!this.o.host.onFor(account)) return null;
    try {
      return this.o.host.agent(account);
    } catch {
      return null;
    }
  }

  /**
   * OpenRouter's models that some provider serves keeping nothing (its zero-data-retention list), with the
   * cheapest such price per million tokens. Read every 6 hours, through @boni/net.
   */
  async catalogue(): Promise<CatalogueModel[]> {
    if (this.cached && this.now() - this.cached.at < 6 * 3_600_000) return this.cached.models;
    const get =
      this.o.fetchCatalogue ??
      (async (url: string) => (await fetchText(url, { maxBytes: 20_000_000 })).text);
    const [models, zdr] = await Promise.all([
      get(`${OPENROUTER}/models`),
      get(`${OPENROUTER}/endpoints/zdr`),
    ]);
    const list = catalogueOf(JSON.parse(models), JSON.parse(zdr));
    this.cached = { at: this.now(), models: list };
    return list;
  }

  evaluations(account: number): Evaluation[] {
    const v = this.o.host.store(account).setting(EVALS);
    try {
      return v ? (JSON.parse(v) as Evaluation[]) : [];
    } catch {
      return [];
    }
  }

  /** The latest evaluation of this model on this route for this role, if recent enough to take it. */
  evaluated(
    account: number,
    c: Pick<Evaluation, "role" | "connection" | "model" | "zdr">,
  ): Evaluation | null {
    const e = this.evaluations(account).find((x) => same(x, c));
    return e && this.now() - e.at < EVAL_DAYS * 86_400_000 ? e : null;
  }

  /**
   * Evaluates `choice` for `role` in the background (Juan, 2026-10-24: a model takes a role only after this), and
   * the role's current model too when it has no recent evaluation, so the page can compare them. What it costs is
   * written in the journal like any model call, so it counts in the month's spending.
   */
  evaluate(account: number, role: Role, choice: RoleChoice): "started" | "busy" | "no-key" {
    if (this.running.has(account)) return "busy";
    const key = this.keyFor(account, choice.connection);
    if (!key) return "no-key";
    const candidate = {
      role,
      connection: choice.connection,
      model: choice.model,
      zdr: !!choice.zdr,
    };
    const current = this.roles(account).find((r) => r.role === role);
    const reader = this.roles(account).find((r) => r.role === "reader");
    const make = (v: Pick<RoleView, "role" | "connection" | "model" | "zdr">) => {
      const k = this.keyFor(account, v.connection);
      return k ? (this.o.makeProvider ?? provider)(v, k) : null;
    };
    const readerP = reader ? make(reader) : null;
    this.running.set(account, candidate);
    const job = (async () => {
      try {
        const runs: Pick<Evaluation, "role" | "connection" | "model" | "zdr">[] = [candidate];
        if (current && !same(candidate, current) && !this.evaluated(account, current))
          runs.push(current);
        for (const c of runs) {
          const model = make(c);
          if (!model) continue;
          const r = await evalRole(role, model, readerP ?? model);
          this.o.host.store(account).journal.modelCall({
            run: `eval:${this.now()}`,
            role: `eval-${role}`,
            provider: c.connection,
            model: c.model,
            promptHash: "eval",
            request: { evaluation: role },
            response: { right: r.right, total: r.total },
            usage: { input: r.tokens, output: 0, cost: r.cost },
            at: this.now(),
          });
          const kept = [
            { ...c, ...r, at: this.now() },
            ...this.evaluations(account).filter((x) => !same(x, c)),
          ];
          this.o.host.store(account).setSetting(EVALS, JSON.stringify(kept.slice(0, 20)));
          // The desktop of before evaluates by use: its result is that model's part of its kind (AU-244).
          const id = choiceId(c);
          const marks = this.marks(account);
          marks[id] = {
            parts: { ...(marks[id]?.parts ?? {}), [KIND_OF_ROLE[role]]: { ...r, at: this.now() } },
          };
          this.o.host.store(account).setSetting(MARKS, JSON.stringify(marks));
          this.built.delete(account);
        }
      } catch (e) {
        console.error(`models ${account}: evaluation failed (${(e as Error).message})`);
      } finally {
        this.running.delete(account);
        this.spent.delete(account);
        this.o.host.emit(account, "models", {});
      }
    })();
    this.jobs.add(job);
    void job.finally(() => this.jobs.delete(job));
    return "started";
  }

  /** Tests and shutdown: every evaluation and every run of «Aviso del presupuesto» going on has ended. */
  async idle(): Promise<void> {
    await Promise.all([...this.jobs]);
  }

  /**
   * The models a conversation may plan with (AU-242): «El de la cuenta» (`current`, the row «Agente» as it answers)
   * and every loaded model the gate offers for «Agente» (AU-235). No tags: in the chat a model is chosen.
   */
  plannerChoices(account: number): PlannerChoice[] {
    const out: PlannerChoice[] = [];
    const own = this.resolveModel(account, "agent", null);
    if (!("refused" in own))
      out.push({ id: own.id, ...own.route, privacy: privacyOf(own.route), current: true });
    for (const m of this.choices(account, "agent").models)
      if (!out.some((x) => x.id === m.id))
        out.push({
          id: m.id,
          connection: m.connection,
          model: m.model,
          zdr: m.zdr,
          privacy: m.privacy,
          current: false,
        });
    return out;
  }

  /**
   * The provider an AI step's call runs on (AU-199, AU-239): its «Modelo» resolved (`resolveModel`: a model's id,
   * a tag, or nothing for «El de la cuenta»), which keeps its model while its key is there, even once its evaluation
   * is old (AU-235). Why not, as a key the step fails with: `no-model` (nothing answers, or the id is no longer
   * loaded), `no-key` (its key is gone). `tag` is the name of the tag it came by, which «Lo que hizo» says beside it.
   */
  stepProvider(
    account: number,
    kind: Kind,
    value: string | null,
  ):
    | { provider: ModelProvider; model: string; tag: string | null }
    | { refused: "no-model" | "no-key" } {
    const r = this.resolveModel(account, kind, value);
    if ("refused" in r) return r;
    if (!this.keyFor(account, r.route.connection)) return { refused: "no-key" };
    const p = this.make(account, kind, r.route);
    if (!p) return { refused: "no-model" };
    return {
      provider: p,
      model: r.route.model,
      tag: r.tag?.name ?? null,
    };
  }

  /** A planner for a conversation, by its choice's id; null when it is not one of `plannerChoices`. */
  plannerProvider(account: number, id: string): ModelProvider | null {
    const c = this.plannerChoices(account).find((x) => x.id === id && !x.current);
    return c ? this.make(account, "agent", c) : null;
  }

  // -------------------------------------------------------------- «Modelos» without uses (docs/automatizaciones.md §5.16)

  /**
   * The account's list (AU-232): its loaded models in its order, its tags and «De la cuenta». The first time a store
   * is asked, the uses of before become it (AU-244, `migrate`); a list that does not read back is the empty one.
   */
  list(account: number): ModelsList {
    const store = this.o.host.store(account);
    let v = store.setting(LIST);
    if (v === null) {
      this.migrate(account);
      v = store.setting(LIST);
    }
    try {
      const l = JSON.parse(v ?? "") as ModelsList;
      return listErrors(l).length ? structuredClone(EMPTY_LIST) : l;
    } catch {
      return structuredClone(EMPTY_LIST);
    }
  }

  private saveList(account: number, l: ModelsList): string[] {
    // A tag with no models goes by itself when nothing uses it (AU-237).
    const used = this.usesOf(account);
    l.tags = l.tags.filter(
      (t) =>
        l.models.some((m) => m.tags.includes(t.id)) ||
        KINDS.some((k) => l.account[k] === `${TAG_REF}${t.id}`) ||
        (used.byValue.get(`${TAG_REF}${t.id}`)?.automations.size ?? 0) > 0,
    );
    const errors = listErrors(l);
    if (errors.length) return errors;
    this.o.host.store(account).setSetting(LIST, JSON.stringify(l));
    this.built.delete(account);
    return [];
  }

  /** Each model's last evaluation (AU-234), by its id: removed models keep theirs (AU-233). */
  marks(account: number): Record<string, ModelEvaluation> {
    const v = this.o.host.store(account).setting(MARKS);
    try {
      return v ? (JSON.parse(v) as Record<string, ModelEvaluation>) : {};
    } catch {
      return {};
    }
  }

  private partsOf(account: number, id: string): EvalParts {
    const e = this.marks(account)[id];
    const out: EvalParts = {};
    for (const k of KINDS) {
      const p = e?.parts[k];
      if (p) out[k] = { right: p.right, total: p.total, at: p.at };
    }
    return out;
  }

  /** The kinds of call the server brings this model for (its environment): valid there with no evaluation (AU-235). */
  private serverKinds(id: string): Kind[] {
    return KINDS.filter((k) => {
      const d = this.o.defaults[ROLE_OF_KIND[k]];
      return !!d && choiceId({ ...d, zdr: !!d.zdr }) === id;
    });
  }

  /** The server's model of a kind, by its id; null when it brings none. */
  private serverModel(kind: Kind): string | null {
    const d = this.o.defaults[ROLE_OF_KIND[kind]];
    return d ? choiceId({ ...d, zdr: !!d.zdr }) : null;
  }

  /** The models «Modelos» lists: the account's in its order, then the server's it has not placed («Del servidor»). */
  private loaded(account: number, l = this.list(account)): { id: string; tags: string[] }[] {
    const out = [...l.models];
    for (const k of KINDS) {
      const s = this.serverModel(k);
      if (s && !out.some((m) => m.id === s)) out.push({ id: s, tags: [] });
    }
    return out;
  }

  /**
   * What a tag may take for a kind (AU-239): a loaded model with its key, that answers that kind, evaluated for it
   * (current or expired) or the server's for it. Never one never evaluated.
   */
  private usable(account: number, id: string, kind: Kind): boolean {
    const r = parseChoice(id);
    if (!r || !kindsOf(r).includes(kind) || !this.keyFor(account, r.connection)) return false;
    return this.serverKinds(id).includes(kind) || evaluatedFor(this.partsOf(account, id), kind);
  }

  /**
   * The gate (AU-235): a model may be chosen now for a kind with its key and a current evaluation with that kind's
   * cases, or as the server's model of that kind, or as the account's row of that kind (chosen before, it stays
   * when its evaluation expires). The result is never read.
   */
  offered(account: number, id: string, kind: Kind): boolean {
    const r = parseChoice(id);
    if (!r || !kindsOf(r).includes(kind) || !this.keyFor(account, r.connection)) return false;
    // What is already chosen keeps its place when its evaluation expires (AU-235): the row of its kind.
    return (
      this.serverKinds(id).includes(kind) ||
      this.list(account).account[kind] === id ||
      gateOpen(this.partsOf(account, id), kind, this.now())
    );
  }

  /**
   * Which model answers (AU-239), for the chat, the steps, the pieces and «De la cuenta»: a model's id gives that
   * model, while it is loaded; nothing gives the account's row of the kind (its model, or its tag resolved; the
   * server's when it has none, or when its model lost its key, as before); a tag gives the first of its models in
   * the list's order that it may take (`usable`). The person's acts only change the answer: never the clock. It asks
   * no policy: what the call may do is the policy's, for the model that makes it (AU-240).
   */
  resolveModel(
    account: number,
    kind: Kind,
    value: string | null,
  ):
    | { id: string; route: ModelRoute; tag?: { id: string; name: string } }
    | { refused: "no-model" } {
    const l = this.list(account);
    const none = { refused: "no-model" as const };
    const byValue = (v: string, fromRow: boolean) => {
      const tag = tagOfRef(v);
      if (tag) {
        const t = l.tags.find((x) => x.id === tag);
        const id = t ? firstOfTag(l, tag, (m) => this.usable(account, m, kind)) : null;
        const route = id ? parseChoice(id) : null;
        return t && id && route ? { id, route, tag: { id: t.id, name: t.name } } : none;
      }
      const route = parseChoice(v);
      if (!route || !this.loaded(account, l).some((m) => m.id === v)) return none;
      // «El de la cuenta» whose key is gone runs as the server's, as the use did (`roles`).
      if (fromRow && !this.keyFor(account, route.connection)) {
        const s = this.serverModel(kind);
        const sr = s ? parseChoice(s) : null;
        return s && sr ? { id: s, route: sr } : none;
      }
      return { id: v, route };
    };
    if (value) return byValue(value, false);
    const row = l.account[kind];
    if (row) return byValue(row, true);
    const s = this.serverModel(kind);
    const route = s ? parseChoice(s) : null;
    return s && route ? { id: s, route } : none;
  }

  /**
   * What a step's «Modelo» or a row «De la cuenta» may choose for a kind (AU-238): «El de la cuenta» with the model
   * that would answer, every tag with the model it would take now and why not when none («Sin modelo», «Caducada»),
   * and the models the gate offers.
   */
  choices(account: number, kind: Kind) {
    const l = this.list(account);
    const own = this.resolveModel(account, kind, null);
    const modelOf = (id: string) => {
      const r = parseChoice(id) as ModelRoute;
      return {
        id,
        connection: r.connection,
        model: r.model,
        zdr: r.zdr,
        privacy: privacyOf(r),
        server: this.serverKinds(id).length > 0 && !l.models.some((m) => m.id === id),
      };
    };
    return {
      kind,
      account: { value: l.account[kind], answers: "refused" in own ? null : own.id },
      tags: l.tags.map((t) => {
        const r = this.resolveModel(account, kind, `${TAG_REF}${t.id}`);
        const answers = "refused" in r ? null : r.id;
        return {
          id: `${TAG_REF}${t.id}`,
          name: t.name,
          answers,
          state: !answers
            ? ("no-model" as const)
            : this.offered(account, answers, kind)
              ? ("ok" as const)
              : ("expired" as const),
        };
      }),
      models: this.loaded(account, l)
        .filter((m) => this.offered(account, m.id, kind))
        .map((m) => modelOf(m.id)),
    };
  }

  /** The provider a kind of call is made with, for a model; null when it cannot be made. */
  private make(account: number, kind: Kind, r: ModelRoute): ModelProvider | null {
    const key = this.keyFor(account, r.connection);
    if (!key) return null;
    try {
      return (this.o.makeProvider ?? provider)({ role: ROLE_OF_KIND[kind], ...r }, key);
    } catch {
      return null;
    }
  }

  /**
   * Where each model, tag and row is used (AU-233, AU-236, AU-241): the automations whose draft or published version
   * names it in a step's «Modelo», the conversations that chose it, and how many AI steps of each kind choose nothing
   * («El de la cuenta»). One pass over the automations' documents.
   */
  usesOf(account: number): {
    byValue: Map<string, { automations: Set<string>; conversations: number }>;
    byKind: Record<Kind, Set<string>>;
  } {
    const store = this.o.host.store(account);
    const byValue = new Map<string, { automations: Set<string>; conversations: number }>();
    const byKind: Record<Kind, Set<string>> = {
      agent: new Set(),
      reading: new Set(),
      decision: new Set(),
    };
    const at = (v: string) => {
      const had = byValue.get(v);
      if (had) return had;
      const u = { automations: new Set<string>(), conversations: 0 };
      byValue.set(v, u);
      return u;
    };
    for (const { automation, kind, model } of stepModels(store)) {
      if (model) at(model).automations.add(automation);
      else byKind[kind].add(automation);
    }
    for (const c of listConversations(store)) if (c.model) at(c.model).conversations++;
    return { byValue, byKind };
  }

  /**
   * Where a model or a tag is used, as «Quitar» and the tags say it before doing it (AU-233, AU-241): its rows
   * «De la cuenta», the automations and the conversations; and the tags in use a change would leave «Sin modelo».
   */
  private whereUsed(
    account: number,
    value: string,
    after: ModelsList,
  ): { rows: Kind[]; automations: number; conversations: number; tagsLeft: string[] } {
    const l = this.list(account);
    const uses = this.usesOf(account);
    const u = uses.byValue.get(value);
    const tagsLeft = l.tags.flatMap((t) => {
      const ref = `${TAG_REF}${t.id}`;
      const inUse =
        (uses.byValue.get(ref)?.automations.size ?? 0) > 0 ||
        KINDS.some((k) => l.account[k] === ref);
      const left = KINDS.some(
        (k) =>
          firstOfTag(l, t.id, (m) => this.usable(account, m, k)) !== null &&
          firstOfTag(after, t.id, (m) => this.usable(account, m, k)) === null,
      );
      return inUse && left ? [t.name] : [];
    });
    return {
      rows: KINDS.filter((k) => l.account[k] === value),
      automations: u?.automations.size ?? 0,
      conversations: u?.conversations ?? 0,
      tagsLeft,
    };
  }

  /**
   * Loads a model (AU-233): at the end of the list, «Sin evaluar» (offered nowhere until its evaluation), at most
   * `MODELS_MAX`. One loaded before and removed gets its evaluation back.
   */
  addModel(account: number, r: ModelRoute): "added" | "exists" | "full" | "invalid" {
    if (modelsErrors({ ...DEFAULT_MODELS, roles: { reader: r } }).length) return "invalid";
    const id = choiceId(r);
    const l = this.list(account);
    if (l.models.some((m) => m.id === id)) return "exists";
    if (l.models.length >= MODELS_MAX) return "full";
    l.models.push({ id, tags: [] });
    return this.saveList(account, l).length ? "invalid" : "added";
  }

  /**
   * Removes a model (AU-233): asked first (`confirm`) when it is used, saying where. Its evaluation and its spending
   * stay; a row «De la cuenta» that had it goes back to the server's (or «Sin modelo»); a step or a conversation that
   * named it answers `no-model` / the account's, as `resolveModel` says. A server's model is not removed.
   */
  removeModel(
    account: number,
    id: string,
    confirm: boolean,
  ):
    | { done: true }
    | { error: "not-found" | "server" }
    | { error: "in-use"; where: ReturnType<AccountModels["whereUsed"]> } {
    const l = this.list(account);
    if (!l.models.some((m) => m.id === id))
      return { error: this.serverKinds(id).length ? "server" : "not-found" };
    const after: ModelsList = structuredClone(l);
    after.models = after.models.filter((m) => m.id !== id);
    for (const k of KINDS) if (after.account[k] === id) after.account[k] = null;
    const where = this.whereUsed(account, id, after);
    if (
      !confirm &&
      (where.rows.length || where.automations || where.conversations || where.tagsLeft.length)
    )
      return { error: "in-use", where };
    this.saveList(account, after);
    return { done: true };
  }

  /** The list in a new order (AU-232): the same models, each once; the order only says who wins in a tag. */
  orderModels(account: number, ids: string[]): boolean {
    const l = this.list(account);
    if (ids.length !== l.models.length || new Set(ids).size !== ids.length) return false;
    const by = new Map(l.models.map((m) => [m.id, m]));
    if (!ids.every((id) => by.has(id))) return false;
    l.models = ids.map((id) => by.get(id) as ModelsList["models"][number]);
    return !this.saveList(account, l).length;
  }

  /** A new tag (AU-237): a name of the person's, distinct, under an id of its own; null when it cannot be. */
  addTag(account: number, name: string): { id: string } | { error: "invalid" | "full" } {
    const l = this.list(account);
    const n = name.trim();
    if (!n || n.length > TAG_NAME_MAX) return { error: "invalid" };
    if (l.tags.length >= TAGS_MAX) return { error: "full" };
    const id = randomBytes(8).toString("hex");
    l.tags.push({ id, name: n });
    // A tag is kept by its models or its uses: a new one holds until the call that gives it a model.
    const errors = listErrors(l);
    if (errors.length) return { error: "invalid" };
    this.o.host.store(account).setSetting(LIST, JSON.stringify(l));
    return { id: `${TAG_REF}${id}` };
  }

  /** A tag renamed (AU-237): its id stays, so every step and row that names it keeps it. */
  renameTag(account: number, ref: string, name: string): "done" | "not-found" | "invalid" {
    const l = this.list(account);
    const t = l.tags.find((x) => `${TAG_REF}${x.id}` === ref);
    if (!t) return "not-found";
    t.name = name.trim();
    return this.saveList(account, l).length ? "invalid" : "done";
  }

  /**
   * A model's tags (AU-237), asked first (`confirm`) when the change would leave a tag in use «Sin modelo» (AU-241).
   */
  tagModel(
    account: number,
    id: string,
    refs: string[],
    confirm: boolean,
  ):
    | { done: true }
    | { error: "not-found" | "invalid" }
    | { error: "in-use"; where: ReturnType<AccountModels["whereUsed"]> } {
    const l = this.list(account);
    const m = l.models.find((x) => x.id === id);
    if (!m) return { error: "not-found" };
    const tags = refs.map(tagOfRef);
    if (tags.some((t) => !t || !l.tags.some((x) => x.id === t))) return { error: "invalid" };
    const after: ModelsList = structuredClone(l);
    (after.models.find((x) => x.id === id) as ModelsList["models"][number]).tags = [
      ...new Set(tags as string[]),
    ];
    const where = this.whereUsed(account, id, after);
    if (!confirm && where.tagsLeft.length)
      return { error: "in-use", where: { ...where, rows: [], automations: 0, conversations: 0 } };
    return this.saveList(account, after).length ? { error: "invalid" } : { done: true };
  }

  /**
   * A row «De la cuenta» (AU-236): a model or a tag among those its kind may choose (AU-235), or nothing (the server's).
   * What answers changes from the next run of everything that chose nothing; the route says how many before.
   */
  setAccountRow(account: number, kind: Kind, value: string | null): "done" | "not-offered" {
    const l = this.list(account);
    if (value !== null) {
      const tag = tagOfRef(value);
      const ok = tag
        ? (() => {
            const r = this.resolveModel(account, kind, value);
            return !("refused" in r) && this.offered(account, r.id, kind);
          })()
        : this.offered(account, value, kind) && this.loaded(account, l).some((m) => m.id === value);
      if (!ok) return "not-offered";
    }
    l.account[kind] = value;
    return this.saveList(account, l).length ? "not-offered" : "done";
  }

  /**
   * Where the models of a connection are used, as removing its key asks first (AU-233, AU-241): each of them loaded,
   * with where it is used and the tags in use it would leave «Sin modelo». Changes nothing.
   */
  keyUses(account: number, connection: Connection) {
    const l = this.list(account);
    const after: ModelsList = structuredClone(l);
    after.models = after.models.filter((m) => parseChoice(m.id)?.connection !== connection);
    return l.models
      .filter((m) => parseChoice(m.id)?.connection === connection)
      .map((m) => ({ id: m.id, ...this.whereUsed(account, m.id, after) }))
      .filter((w) => w.rows.length || w.automations || w.conversations || w.tagsLeft.length);
  }

  /** A row «Decisión» exists (AU-236): a decision model loaded with its evaluation, or the server's. */
  private hasDecision(account: number): boolean {
    return (
      !!this.serverModel("decision") ||
      this.list(account).models.some((m) => this.offered(account, m.id, "decision"))
    );
  }

  /**
   * Evaluates one model (AU-234), in the background: every case it can answer, once (`evalModel`, its kinds by what
   * it is). The result replaces its last one with every part on one date; one that does not finish keeps nothing.
   * What it costs goes in the journal like any model call. One at a time per account.
   */
  evaluateModel(account: number, id: string): "started" | "busy" | "no-key" | "not-found" {
    if (this.running.has(account) || this.runningModel.has(account)) return "busy";
    const r = parseChoice(id);
    if (!r || !this.loaded(account).some((m) => m.id === id)) return "not-found";
    if (!this.keyFor(account, r.connection)) return "no-key";
    const kinds = kindsOf(r);
    this.runningModel.set(account, id);
    const job = (async () => {
      try {
        const res = await evalModel((k) => {
          const p = this.make(account, k, r);
          if (!p) throw new Error(`${r.connection} cannot make this model`);
          return p;
        }, kinds);
        const at = this.now();
        this.o.host.store(account).journal.modelCall({
          run: `eval:${at}`,
          role: "eval-model",
          provider: r.connection,
          model: r.model,
          promptHash: "eval",
          request: { evaluation: kinds },
          response: { right: res.right, total: res.total },
          usage: { input: res.tokens, output: 0, cost: res.cost },
          at,
        });
        const parts: ModelEvaluation["parts"] = {};
        for (const k of kinds) {
          const p = res.parts[k];
          if (p) parts[k] = { ...p, at };
        }
        this.o.host
          .store(account)
          .setSetting(MARKS, JSON.stringify({ ...this.marks(account), [id]: { parts } }));
      } catch (e) {
        console.error(`models ${account}: evaluation failed (${(e as Error).message})`);
      } finally {
        this.runningModel.delete(account);
        this.spent.delete(account);
        this.built.delete(account);
        this.o.host.emit(account, "models", {});
      }
    })();
    this.jobs.add(job);
    void job.finally(() => this.jobs.delete(job));
    return "started";
  }

  /**
   * What «Modelos» reads (AU-232), asked once: each loaded model with its tags, its evaluation (summed, «Parcial»,
   * «Caducada») and the month's spending already summed per model; the tags; «De la cuenta» with what answers each
   * row and where it is used.
   */
  listView(account: number) {
    const l = this.list(account);
    const now = this.now();
    const marks = this.marks(account);
    const uses = this.usesOf(account);
    const eur = new Map<string, number>();
    for (const r of this.spending(account).rows) {
      const k = `${r.provider}:${r.model}`;
      eur.set(k, (eur.get(k) ?? 0) + r.eur);
    }
    const tagName = new Map(l.tags.map((t) => [t.id, t.name]));
    const usesOf = (v: string) => {
      const u = uses.byValue.get(v);
      return {
        automations: u?.automations.size ?? 0,
        conversations: u?.conversations ?? 0,
        rows: KINDS.filter((k) => l.account[k] === v),
      };
    };
    return {
      models: this.loaded(account, l).map((m) => {
        const r = parseChoice(m.id) as ModelRoute;
        const kinds = kindsOf(r);
        const e = marks[m.id];
        return {
          id: m.id,
          connection: r.connection,
          model: r.model,
          zdr: r.zdr,
          privacy: privacyOf(r),
          server: !l.models.some((x) => x.id === m.id),
          kinds,
          tags: m.tags.map((t) => ({ id: `${TAG_REF}${t}`, name: tagName.get(t) ?? "" })),
          key: !!this.keyFor(account, r.connection),
          evaluation: markOf(this.partsOf(account, m.id), kinds, now),
          cost: e
            ? Object.values(e.parts).reduce((a, p) => a + (p?.cost ?? 0), 0) *
              this.config(account).usdToEur
            : null,
          eur: eur.get(`${r.connection}:${r.model}`) ?? 0,
          uses: usesOf(m.id),
        };
      }),
      tags: l.tags.map((t) => ({
        id: `${TAG_REF}${t.id}`,
        name: t.name,
        uses: usesOf(`${TAG_REF}${t.id}`),
      })),
      account: KINDS.filter((k) => k !== "decision" || this.hasDecision(account)).map((k) => {
        const r = this.resolveModel(account, k, null);
        return {
          kind: k,
          value: l.account[k],
          answers: "refused" in r ? null : r.id,
          automations: uses.byKind[k].size,
        };
      }),
      evaluating: this.runningModel.get(account) ?? null,
    };
  }

  /**
   * The desktop of before chose a use's model (`PUT …/models/roles/:role`): the row of its kind follows, with the model
   * loaded when it was not, so both screens answer with the same model until the new one ships (AU-244).
   */
  followRole(account: number, role: Role, choice: RoleChoice | undefined): void {
    if (role === "reviewer") return;
    const l = this.list(account);
    const kind = KIND_OF_ROLE[role];
    if (!choice) l.account[kind] = null;
    else {
      const id = choiceId({ ...choice, zdr: !!choice.zdr });
      if (!l.models.some((m) => m.id === id)) {
        if (l.models.length >= MODELS_MAX) return;
        l.models.push({ id, tags: [] });
      }
      l.account[kind] = id;
    }
    this.saveList(account, l);
  }

  /** A model's evaluation whole, its cases by part (AU-234, «Ver los casos»); null when it has none. */
  evaluationOf(account: number, id: string): ModelEvaluation | null {
    return this.marks(account)[id] ?? null;
  }

  /**
   * The model a converted step carries (AU-245): none for «Agente», «Lector» and «Decisor» (it reads «De la cuenta»);
   * for «Revisor», the reviewer's own id only when it is another model than the reader's, so it reviews with the one
   * it always did.
   */
  modelRefOf(account: number, use: Role): string | null {
    if (use !== "reviewer") return null;
    const views = this.roles(account);
    const reviewer = views.find((v) => v.role === "reviewer");
    const reader = views.find((v) => v.role === "reader");
    if (!reviewer) return null;
    const id = choiceId(reviewer);
    return reader && choiceId(reader) === id ? null : id;
  }

  /** The model that would answer a use's calls now, by its id (the map, AU-245): the reviewer's own while it has one. */
  answerOf(account: number, use: Role): string | null {
    const own = this.modelRefOf(account, use);
    if (own) return own;
    const r = this.resolveModel(account, KIND_OF_ROLE[use], null);
    return "refused" in r ? null : r.id;
  }

  /**
   * The uses of before become the list (AU-244), once, by code, with no model and without reading the keys. Its
   * models: each use's, every one evaluated lately for the agent or the reader (what `modelChoices` offered, but for
   * the key, which is not read: an id without its key is offered nowhere all the same), and every one a conversation
   * or a step names; «De la cuenta»'s first, the rest by their last evaluation. Its rows: each use's, or the
   * server's. Its evaluations: each use's newest result as the part of its kind, with its date; the reviewer's count
   * as the reading. `models/config` and `models/evals` stay as they were. Run twice, it changes nothing: the list's
   * presence says it ran, and it is written last.
   */
  private migrate(account: number): void {
    const store = this.o.host.store(account);
    if (store.setting(LIST) !== null) return;
    const c = this.config(account);
    const evals = [...this.evaluations(account)].sort((a, b) => b.at - a.at);
    const now = this.now();
    const marks = this.marks(account);
    for (const e of evals) {
      const id = choiceId(e);
      const kind = KIND_OF_ROLE[e.role];
      const had = marks[id]?.parts[kind];
      if (had && had.at >= e.at) continue;
      const { role: _r, connection: _c, model: _m, zdr: _z, ...result } = e;
      marks[id] = { parts: { ...(marks[id]?.parts ?? {}), [kind]: { ...result } } };
    }
    const idOf = (r: RoleChoice | undefined) => (r ? choiceId({ ...r, zdr: !!r.zdr }) : null);
    const rows = {
      agent: idOf(c.roles.planner),
      reading: idOf(c.roles.reader),
      decision: idOf(c.roles.decider),
    };
    const lastEval = (id: string) =>
      Math.max(0, ...Object.values(marks[id]?.parts ?? {}).map((p) => p?.at ?? 0));
    // What something names (the reviewer, a step, a conversation) runs on it: it is never the one left out.
    const named = new Set<string>();
    const reviewer = idOf(c.roles.reviewer);
    if (reviewer) named.add(reviewer);
    for (const s of stepModels(store)) if (s.model && parseChoice(s.model)) named.add(s.model);
    for (const conv of listConversations(store))
      if (conv.model && parseChoice(conv.model)) named.add(conv.model);
    const offeredOnly = new Set<string>();
    for (const e of evals)
      if ((e.role === "planner" || e.role === "reader") && now - e.at < EVAL_DAYS * 86_400_000)
        offeredOnly.add(choiceId(e));
    const first = [...new Set(Object.values(rows).filter((x): x is string => !!x))];
    const byEval = (ids: Iterable<string>, skip: string[]) =>
      [...ids].filter((id) => !skip.includes(id)).sort((a, b) => lastEval(b) - lastEval(a));
    const kept = [...first, ...byEval(named, first)];
    // Past 30, only a model nothing names, there for its evaluation alone, is left out, the oldest evaluated first.
    // (Thirty models named by rows, steps and conversations would be cut too, as a list of more is no list.)
    const extra = byEval(offeredOnly, kept).slice(0, Math.max(0, MODELS_MAX - kept.length));
    const others = byEval([...kept, ...extra], first);
    const list: ModelsList = {
      models: [...first, ...others].slice(0, MODELS_MAX).map((id) => ({ id, tags: [] })),
      tags: [],
      account: rows,
    };
    store.setSetting(MARKS, JSON.stringify(marks));
    store.setSetting(LIST, JSON.stringify(list));
  }

  /** What the page reads. */
  view(account: number) {
    const c = this.config(account);
    const own = this.keys(account);
    const spending = this.spending(account);
    return {
      roles: this.roles(account),
      connections: CONNECTIONS.map((x) => ({
        connection: x,
        mine: !!own[x],
        server: !!this.o.serverKeys[x],
      })),
      budget: c.budget,
      // «Aviso del presupuesto» is on: passing the warning tells (off, Ajustes says the notice is off; D-53).
      notice: this.o.host.store(account).journal.flow(BUDGET_FLOW)?.enabled ?? true,
      usdToEur: c.usdToEur,
      spending,
      over: c.budget.monthlyEur > 0 && spending.eur >= c.budget.monthlyEur,
      evaluations: this.evaluations(account).map(({ cases, ...rest }) => ({ ...rest, cases })),
      evaluating: this.running.get(account) ?? null,
    };
  }
}

/** A model a conversation may plan with. */
export interface PlannerChoice {
  /** `connection:model` (with `:zdr` when it asks for providers that keep nothing). */
  id: string;
  connection: Connection;
  model: string;
  zdr: boolean;
  privacy: Privacy;
  /** The planner role's own model (the account's). */
  current: boolean;
}

/**
 * Every AI step's «Modelo» in the automations, of their drafts and their published versions (AU-233, AU-244): one
 * row per step, its kind of call and its value (null: «El de la cuenta»). A document that does not read is skipped.
 */
function stepModels(store: UserStore): { automation: string; kind: Kind; model: string | null }[] {
  const j = store.journal;
  const out: { automation: string; kind: Kind; model: string | null }[] = [];
  for (const a of j.automations()) {
    const docs = [
      j.automationDraft(a.id)?.doc,
      a.published !== null ? j.automationVersion(a.id, a.published)?.doc : undefined,
    ];
    for (const doc of docs) {
      if (!doc) continue;
      let steps: unknown;
      try {
        steps = (JSON.parse(doc) as { steps?: unknown }).steps;
      } catch {
        continue;
      }
      if (!Array.isArray(steps)) continue;
      for (const s of steps as { type?: unknown; params?: Record<string, unknown> }[]) {
        const kind = callKindOf(s?.type);
        if (!kind) continue;
        const m = s.params?.model;
        out.push({ automation: a.id, kind, model: typeof m === "string" && m !== "" ? m : null });
      }
    }
  }
  return out;
}

/** One role's provider from its choice and key. */
function provider(
  v: Pick<RoleView, "role" | "connection" | "model" | "zdr">,
  key: string,
): ModelProvider {
  if (v.role === "decider") {
    if (v.connection === "anthropic") throw new Error("Jev is not on Anthropic");
    return new JevProvider({
      apiKey: key,
      via: v.connection === "typesafe" ? "typesafe" : "openrouter",
      model: v.model,
    });
  }
  if (v.connection === "anthropic")
    return new AnthropicProvider({
      apiKey: key,
      model: v.model,
      ...(v.role === "planner" ? { effort: "medium" as const, fallbacks: true } : {}),
    });
  if (v.connection === "openrouter")
    return new OpenAIProvider({
      apiKey: key,
      model: v.model,
      baseURL: OPENROUTER,
      zdr: v.zdr,
      // A reader reads and fills a schema: no reasoning first (task 29: it spent the whole answer on it).
      ...(v.role === "reader" ? { reasoning: "off" as const } : {}),
    });
  throw new Error(`${v.connection} has no ${v.role}`);
}

export interface CatalogueModel {
  id: string;
  name: string;
  /** Dollars per million tokens, the cheapest provider that keeps nothing. */
  input: number;
  output: number;
  context: number;
  /** The providers that serve it keeping nothing. */
  providers: string[];
  /** Some of them take a JSON schema for the answer (what readers need). */
  structured: boolean;
}

/** OpenRouter's lists as the page's catalogue (anything unexpected is left out). */
export function catalogueOf(models: unknown, zdr: unknown): CatalogueModel[] {
  const arr = (x: unknown) =>
    Array.isArray((x as { data?: unknown })?.data)
      ? ((x as { data: unknown[] }).data as Record<string, unknown>[])
      : [];
  const names = new Map(
    arr(models).map((m) => [String(m.id), String(m.name ?? m.id).slice(0, 120)]),
  );
  const by = new Map<string, CatalogueModel>();
  for (const e of arr(zdr)) {
    const id = typeof e.model_id === "string" ? e.model_id : null;
    const p = (e.pricing ?? {}) as Record<string, unknown>;
    // Dollars per million tokens, without the float noise of per-token prices.
    const perMillion = (x: unknown) => Math.round(Number(x) * 1e12) / 1e6;
    const input = perMillion(p.prompt);
    const output = perMillion(p.completion);
    if (!id || !Number.isFinite(input) || !Number.isFinite(output)) continue;
    const params = Array.isArray(e.supported_parameters) ? e.supported_parameters.map(String) : [];
    const structured = params.includes("response_format") || params.includes("structured_outputs");
    const had = by.get(id);
    const name = String(e.provider_name ?? "").slice(0, 60);
    if (!had)
      by.set(id, {
        id,
        name: names.get(id) ?? id,
        input,
        output,
        context: Number(e.context_length) || 0,
        providers: name ? [name] : [],
        structured,
      });
    else {
      if (input + output < had.input + had.output) [had.input, had.output] = [input, output];
      if (name && !had.providers.includes(name)) had.providers.push(name);
      had.structured ||= structured;
    }
  }
  return [...by.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The «Modelos» routes, under the agent's (`/api/agent/models…`, tailnet only): they work with the agent off, so a
 * key can be given. Changing anything needs a personal device.
 */
const bad = (res: ServerResponse) => send(res, 400, { error: "bad-request" });

export async function serveModels(
  models: AccountModels,
  req: IncomingMessage,
  res: ServerResponse,
  route: string,
  params: Record<string, string>,
  who: { account: number; trust: "personal" | "shared" | "ambient" },
): Promise<void> {
  if ((route.startsWith("PUT ") || route.startsWith("POST ")) && who.trust !== "personal")
    return send(res, 403, { error: "personal-device-only" });
  // Whether this device may change «Modelos» (AU-243): the screen offers no write a shared device would be refused.
  const personal = who.trust === "personal";
  const listOf = () => ({ ...models.listView(who.account), personal });
  switch (route) {
    case "GET /api/agent/models":
      return send(res, 200, models.view(who.account));
    case "GET /api/agent/models/catalogue":
      try {
        return send(res, 200, { models: await models.catalogue() });
      } catch {
        return send(res, 502, { error: "catalogue-unreachable" });
      }
    case "PUT /api/agent/models/roles/:role": {
      const role = ROLES.find((r) => r === params.role);
      if (!role) return send(res, 404, { error: "not-found" });
      const b = await bodyOf(req);
      const c = models.config(who.account);
      if (b.connection === undefined) delete c.roles[role];
      else {
        const choice: RoleChoice = {
          connection: b.connection as Connection,
          model: String(b.model ?? ""),
          ...(b.zdr === true ? { zdr: true } : {}),
        };
        c.roles[role] = choice;
        const errors = modelsErrors(c);
        if (errors.length) return send(res, 400, { error: "invalid", errors });
        // A model takes a role only after its evaluation (Juan, 2026-10-24).
        // Either gate opens it: the use's of before, or the model's (AU-244), so both screens agree.
        if (
          !models.evaluated(who.account, { role, ...choice, zdr: !!choice.zdr }) &&
          !models.offered(
            who.account,
            choiceId({ ...choice, zdr: !!choice.zdr }),
            KIND_OF_ROLE[role],
          )
        )
          return send(res, 409, { error: "needs-evaluation" });
      }
      const errors = models.saveConfig(who.account, c);
      if (!errors.length) models.followRole(who.account, role, c.roles[role]);
      return errors.length
        ? send(res, 400, { error: "invalid", errors })
        : send(res, 200, models.view(who.account));
    }
    case "PUT /api/agent/models/keys/:connection": {
      const connection = CONNECTIONS.find((x) => x === params.connection);
      if (!connection) return send(res, 404, { error: "not-found" });
      const b = await bodyOf(req);
      const key = b.key === null ? null : typeof b.key === "string" ? b.key.trim() : undefined;
      if (
        key === undefined ||
        (key !== null && (key.length < 10 || key.length > 500 || /\s/.test(key)))
      )
        return send(res, 400, { error: "bad-key" });
      // «Quitar» a key asks first where its models are used (AU-233, AU-241): `dry` changes nothing and says it.
      if (key === null && b.dry === true)
        return send(res, 200, { where: models.keyUses(who.account, connection) });
      models.setKey(who.account, connection, key);
      return send(res, 200, models.view(who.account));
    }
    case "POST /api/agent/models/evaluate": {
      const b = await bodyOf(req);
      const role = ROLES.find((r) => r === b.role);
      if (!role) return bad(res);
      const choice: RoleChoice = {
        connection: b.connection as Connection,
        model: String(b.model ?? ""),
        ...(b.zdr === true ? { zdr: true } : {}),
      };
      if (modelsErrors({ ...DEFAULT_MODELS, roles: { [role]: choice } }).length) return bad(res);
      const r = models.evaluate(who.account, role, choice);
      return r === "started"
        ? send(res, 202, models.view(who.account))
        : send(res, 409, { error: r });
    }
    case "PUT /api/agent/models/budget": {
      const b = await bodyOf(req);
      const c = models.config(who.account);
      const next: ModelsConfig = {
        ...c,
        budget: {
          monthlyEur: typeof b.monthlyEur === "number" ? b.monthlyEur : c.budget.monthlyEur,
          warnAt: typeof b.warnAt === "number" ? b.warnAt : c.budget.warnAt,
        },
        usdToEur: typeof b.usdToEur === "number" ? b.usdToEur : c.usdToEur,
      };
      const errors = models.saveConfig(who.account, next);
      return errors.length
        ? send(res, 400, { error: "invalid", errors })
        : send(res, 200, models.view(who.account));
    }
    // «Modelos» without uses (§5.16): the list, its tags, «De la cuenta» and each model's evaluation.
    case "GET /api/agent/models/list":
      return send(res, 200, listOf());
    case "GET /api/agent/models/choices": {
      const kind = KINDS.find(
        (k) => k === new URL(req.url ?? "/", "http://boni").searchParams.get("kind"),
      );
      if (!kind) return bad(res);
      return send(res, 200, { ...models.choices(who.account, kind), personal });
    }
    case "GET /api/agent/models/evaluation": {
      const id = new URL(req.url ?? "/", "http://boni").searchParams.get("id") ?? "";
      const e = models.evaluationOf(who.account, id);
      return e ? send(res, 200, e) : send(res, 404, { error: "not-found" });
    }
    case "POST /api/agent/models/list": {
      const b = await bodyOf(req);
      const r = models.addModel(who.account, {
        connection: b.connection as Connection,
        model: String(b.model ?? ""),
        zdr: b.zdr === true,
      });
      if (r === "invalid") return bad(res);
      return r === "added" ? send(res, 200, listOf()) : send(res, 409, { error: r });
    }
    case "POST /api/agent/models/list/remove": {
      const b = await bodyOf(req);
      const r = models.removeModel(who.account, String(b.id ?? ""), b.confirm === true);
      if ("done" in r) return send(res, 200, listOf());
      return send(res, r.error === "not-found" ? 404 : 409, r);
    }
    case "PUT /api/agent/models/order": {
      const b = await bodyOf(req);
      const ids = Array.isArray(b.ids) ? b.ids.map(String) : null;
      return ids && models.orderModels(who.account, ids) ? send(res, 200, listOf()) : bad(res);
    }
    case "POST /api/agent/models/tags": {
      const b = await bodyOf(req);
      const r = models.addTag(who.account, String(b.name ?? ""));
      return "id" in r ? send(res, 200, r) : send(res, r.error === "full" ? 409 : 400, r);
    }
    case "PUT /api/agent/models/tags/:tag": {
      const b = await bodyOf(req);
      const r = models.renameTag(who.account, `${TAG_REF}${params.tag}`, String(b.name ?? ""));
      if (r === "not-found") return send(res, 404, { error: r });
      return r === "done" ? send(res, 200, listOf()) : bad(res);
    }
    case "PUT /api/agent/models/tagged": {
      const b = await bodyOf(req);
      const tags = Array.isArray(b.tags) ? b.tags.map(String) : null;
      if (!tags) return bad(res);
      const r = models.tagModel(who.account, String(b.id ?? ""), tags, b.confirm === true);
      if ("done" in r) return send(res, 200, listOf());
      if (r.error === "invalid") return bad(res);
      return send(res, r.error === "not-found" ? 404 : 409, r);
    }
    case "PUT /api/agent/models/account/:kind": {
      const kind = KINDS.find((k) => k === params.kind);
      if (!kind) return send(res, 404, { error: "not-found" });
      const b = await bodyOf(req);
      const value = b.value === null ? null : typeof b.value === "string" ? b.value : undefined;
      if (value === undefined) return bad(res);
      return models.setAccountRow(who.account, kind, value) === "done"
        ? send(res, 200, listOf())
        : send(res, 409, { error: "not-offered" });
    }
    case "POST /api/agent/models/list/evaluate": {
      const b = await bodyOf(req);
      const r = models.evaluateModel(who.account, String(b.id ?? ""));
      if (r === "not-found") return send(res, 404, { error: r });
      return r === "started" ? send(res, 202, listOf()) : send(res, 409, { error: r });
    }
    default:
      return send(res, 404, { error: "not-found" });
  }
}
