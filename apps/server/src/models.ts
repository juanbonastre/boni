import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AnthropicProvider,
  CONNECTIONS,
  type Connection,
  DEFAULT_MODELS,
  JevProvider,
  type ModelProvider,
  type ModelsConfig,
  modelsErrors,
  OpenAIProvider,
  type Privacy,
  privacyOf,
  ROLES,
  type Role,
  type RoleChoice,
} from "@boni/agent";
import { wrappedKeysIn } from "@boni/identity";
import { fetchText } from "@boni/net";
import { open, type SpendRow, seal, wrappedKeyProvider } from "@boni/store";
import type { AgentHost, Providers } from "./agent.ts";
import type { Db } from "./db.ts";
import { bodyOf, send } from "./reply.ts";
import type { SecretKey } from "./secret.ts";

/**
 * «Modelos» (Juan, 2026-10-24): which model does each role for an account, with what key, what it spends and how
 * it treats the data. Kept in the user's store, outside the operation log: the choices as they are, the keys
 * sealed with the user's data key (never sent back to a device). Without a choice of his, a role runs as the
 * server is configured (its environment), as before. A month's spending warns once at the budget's fraction and,
 * at the budget, stops background work from calling models (the agent's `overBudget`).
 *
 * Privacy (option 1): a role through OpenRouter asks for providers that keep and collect nothing (`zdr`); only
 * then does the page say so. Anthropic's own API deletes what it receives within 30 days.
 */
const OPENROUTER = "https://openrouter.ai/api/v1";
const CONFIG = "models/config";
const KEYS = "models/keys";
const WARNED = "models/warned";

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
   * The providers of an account that chose something of its own (models or keys); null: the server's, unchanged.
   * Built once per configuration, so the agent keeps the same objects until it changes.
   */
  providers(account: number): Providers | null {
    const own = this.keys(account);
    const c = this.config(account);
    if (!Object.keys(c.roles).length && !Object.keys(own).length) return null;
    const views = this.roles(account);
    const sig = JSON.stringify([
      views,
      Object.keys(own).sort(),
      Object.values(own).map((k) => k.length),
    ]);
    const had = this.built.get(account);
    if (had?.sig === sig) return had.providers;
    const byRole = new Map<Role, ModelProvider>();
    for (const v of views) {
      const key = this.keyFor(account, v.connection);
      if (!key) continue;
      try {
        byRole.set(v.role, provider(v, key));
      } catch {
        // a role whose provider cannot be made runs as the server's default below
      }
    }
    const planner = byRole.get("planner");
    const reader = byRole.get("reader");
    const providers: Providers | null =
      planner && reader
        ? {
            planner,
            reader,
            ...(byRole.get("decider") ? { decider: byRole.get("decider") as ModelProvider } : {}),
            ...(byRole.get("reviewer")
              ? { reviewer: byRole.get("reviewer") as ModelProvider }
              : {}),
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
    byDay: { day: string; eur: number }[];
  } {
    const m = this.month();
    const rate = this.config(account).usdToEur;
    const j = this.o.host.store(account).journal;
    const rows = j.spending(m.from, m.to).map((r) => ({ ...r, eur: r.cost * rate }));
    return {
      month: m.label,
      eur: rows.reduce((a, r) => a + r.eur, 0),
      rows,
      byDay: j.spendingByDay(m.from, m.to).map((d) => ({ day: d.day, eur: d.cost * rate })),
    };
  }

  /**
   * The month's budget is spent (asked before each background model call; read again every 30 s). Crossing its
   * warning fraction tells the devices once a month.
   */
  overBudget(account: number): boolean {
    const had = this.spent.get(account);
    const eur = had && this.now() - had.at < 30_000 ? had.eur : this.spending(account).eur;
    this.spent.set(account, { at: this.now(), eur });
    const { budget } = this.config(account);
    const store = this.o.host.store(account);
    const month = this.month().label;
    if (eur >= budget.monthlyEur * budget.warnAt && store.setting(WARNED) !== month) {
      store.setSetting(WARNED, month);
      this.o.host.emit(account, "notify", {
        text: `Los modelos llevan ${eur.toFixed(2)} € de ${budget.monthlyEur} € este mes.`,
        integrity: "own",
      });
    }
    return budget.monthlyEur > 0 && eur >= budget.monthlyEur;
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
      usdToEur: c.usdToEur,
      spending,
      over: c.budget.monthlyEur > 0 && spending.eur >= c.budget.monthlyEur,
    };
  }
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
    return new OpenAIProvider({ apiKey: key, model: v.model, baseURL: OPENROUTER, zdr: v.zdr });
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
export async function serveModels(
  models: AccountModels,
  req: IncomingMessage,
  res: ServerResponse,
  route: string,
  params: Record<string, string>,
  who: { account: number; trust: "personal" | "shared" | "ambient" },
): Promise<void> {
  if (route.startsWith("PUT ") && who.trust !== "personal")
    return send(res, 403, { error: "personal-device-only" });
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
      else
        c.roles[role] = {
          connection: b.connection as Connection,
          model: String(b.model ?? ""),
          ...(b.zdr === true ? { zdr: true } : {}),
        };
      const errors = models.saveConfig(who.account, c);
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
      models.setKey(who.account, connection, key);
      return send(res, 200, models.view(who.account));
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
    default:
      return send(res, 404, { error: "not-found" });
  }
}
