/**
 * Which model does what, per account (Juan, 2026-10-24: the «Modelos» page). Pure: the configuration, its checks,
 * what each route does with the data and what a call costs. The server keeps it in the user's store (the keys
 * sealed apart) and builds the providers from it.
 *
 * Privacy (Juan, option 1): every role goes through OpenRouter asking for providers that neither keep nor collect
 * the data (`provider.zdr: true`, `data_collection: "deny"`); a route is only called "keeps nothing" when the
 * request itself demands it. Anthropic's own API deletes what it receives within 30 days (its commercial policy):
 * shown as such, never as "keeps nothing".
 */

/** What Juan reads: understand his requests, read mail, decide among options, review what was learned. */
export const ROLES = ["planner", "reader", "decider", "reviewer"] as const;
export type Role = (typeof ROLES)[number];

export const CONNECTIONS = ["openrouter", "anthropic", "typesafe"] as const;
export type Connection = (typeof CONNECTIONS)[number];

export interface RoleChoice {
  connection: Connection;
  /** The model's id on that connection ("anthropic/claude-opus-5.5", "claude-opus-5-5", "jev-1.14.0"). */
  model: string;
  /** OpenRouter only: providers that keep nothing (`zdr`) and collect nothing (`data_collection: deny`). */
  zdr?: boolean;
}

export interface ModelsConfig {
  /** The roles Juan chose; a missing one runs as the server's default. */
  roles: Partial<Record<Role, RoleChoice>>;
  /** Monthly spending: warn at `warnAt` (a fraction), stop background work at the limit. */
  budget: { monthlyEur: number; warnAt: number };
  /** Euros per US dollar (providers bill in dollars); Juan can correct it. */
  usdToEur: number;
}

export const DEFAULT_MODELS: ModelsConfig = {
  roles: {},
  budget: { monthlyEur: 10, warnAt: 0.8 },
  usdToEur: 0.9,
};

/** What a route does with the data, as code knows it (never a model's claim). */
export type Privacy = "keeps-nothing" | "deletes-in-30-days" | "may-keep" | "unknown";

export function privacyOf(c: Pick<RoleChoice, "connection" | "zdr">): Privacy {
  if (c.connection === "openrouter") return c.zdr ? "keeps-nothing" : "may-keep";
  if (c.connection === "anthropic") return "deletes-in-30-days";
  return "unknown";
}

const MODEL_ID = /^[A-Za-z0-9._:/~-]{1,120}$/;

/** What is wrong with a configuration (empty: fine). */
export function modelsErrors(x: unknown): string[] {
  const out: string[] = [];
  const o = x as Partial<ModelsConfig> | null;
  if (!o || typeof o !== "object") return ["not an object"];
  const roles = o.roles ?? {};
  if (typeof roles !== "object" || Array.isArray(roles)) out.push("roles: an object");
  else
    for (const [role, c] of Object.entries(roles)) {
      if (!(ROLES as readonly string[]).includes(role)) out.push(`roles.${role}: unknown role`);
      const choice = c as Partial<RoleChoice> | null;
      if (!choice || typeof choice !== "object") {
        out.push(`roles.${role}: an object`);
        continue;
      }
      if (!(CONNECTIONS as readonly string[]).includes(String(choice.connection)))
        out.push(`roles.${role}.connection: one of ${CONNECTIONS.join(", ")}`);
      if (typeof choice.model !== "string" || !MODEL_ID.test(choice.model))
        out.push(`roles.${role}.model: a model id`);
      if (choice.zdr !== undefined && typeof choice.zdr !== "boolean")
        out.push(`roles.${role}.zdr: true or false`);
      if (choice.zdr && choice.connection !== "openrouter")
        out.push(`roles.${role}.zdr: only through OpenRouter`);
      if (role === "decider" && choice.connection === "anthropic")
        out.push("roles.decider: Jev runs on TypeSafe or OpenRouter");
    }
  const b = o.budget;
  if (
    !b ||
    typeof b.monthlyEur !== "number" ||
    !(b.monthlyEur >= 0 && b.monthlyEur <= 10_000) ||
    typeof b.warnAt !== "number" ||
    !(b.warnAt > 0 && b.warnAt <= 1)
  )
    out.push("budget: monthlyEur 0-10000 and warnAt over 0 up to 1");
  if (typeof o.usdToEur !== "number" || !(o.usdToEur > 0.1 && o.usdToEur < 10))
    out.push("usdToEur: a rate between 0.1 and 10");
  return out;
}

/**
 * Anthropic's own API, dollars per million tokens (input, output), from its price table of 2026-10-06. A model
 * not listed costs what its family's newest one does, rounded up, so spending is never under-counted.
 */
const ANTHROPIC_PRICES: Record<string, [number, number]> = {
  "claude-fable-5-1": [10, 50],
  "claude-fable-5": [10, 50],
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
  "claude-opus-4-7": [5, 25],
  "claude-opus-4-6": [5, 25],
  "claude-sonnet-5-5": [2, 10],
  "claude-sonnet-5": [2, 10],
  "claude-sonnet-4-6": [3, 15],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-haiku-4-5": [1, 5],
};
const FAMILY: [RegExp, [number, number]][] = [
  [/fable|mythos/, [10, 50]],
  [/opus/, [5, 25]],
  [/sonnet/, [3, 15]],
  [/haiku/, [1, 5]],
];

/** What a call to Anthropic's API cost, in dollars (Haiku 5.5 costs more past 100K input tokens). */
export function anthropicCost(model: string, input: number, output: number): number {
  const id = model.replace(/-\d{8}$/, "");
  let [i, o] = ANTHROPIC_PRICES[id] ?? FAMILY.find(([re]) => re.test(id))?.[1] ?? [10, 50];
  if (id === "claude-haiku-5-5" && input > 100_000) [i, o] = [0.5, 2.5];
  return (input * i + output * o) / 1_000_000;
}
