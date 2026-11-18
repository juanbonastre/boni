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

// ---------------------------------------------------------------- «Modelos» without uses (docs/automatizaciones.md §5.16)

/**
 * The kinds of call (§5.16): an «Agente» calls by rounds with tools within its connections, a reader gives a text with
 * no tools and asks for a closed shape, the «Decisora» chooses among the code's options. The step's type fixes the
 * kind, never the model, a tag or the person: reading outside content without tools is how a step calls the model.
 */
export const KINDS = ["agent", "reading", "decision"] as const;
export type Kind = (typeof KINDS)[number];

/** The kind of call each use of before made (AU-244): the reviewer read with the reader's cases. */
export const KIND_OF_ROLE: Record<Role, Kind> = {
  planner: "agent",
  reader: "reading",
  decider: "decision",
  reviewer: "reading",
};
/** The use whose provider a kind of call is built as (rounds with effort; a reader with no reasoning; Jev). */
export const ROLE_OF_KIND: Record<Kind, Exclude<Role, "reviewer">> = {
  agent: "planner",
  reading: "reader",
  decision: "decider",
};

/** At most this many loaded models (AU-232) and tags (AU-237), and a tag's name at most this long. */
export const MODELS_MAX = 30;
export const TAGS_MAX = 20;
export const TAG_NAME_MAX = 24;
/** How long an evaluation (each of its parts) opens the gate (AU-234, AU-235). */
export const EVAL_DAYS = 30;
/** A step's «Modelo» or a row «De la cuenta» naming a tag: `tag:` and the tag's id (AU-238). */
export const TAG_REF = "tag:";

/** A model by its route: the connection, its id there, and (OpenRouter) the providers that keep nothing. */
export interface ModelRoute {
  connection: Connection;
  model: string;
  zdr: boolean;
}

/** A model's id: `connection:model`, with `:zdr` when it asks for providers that keep nothing. Never rewritten. */
export const choiceId = (c: ModelRoute): string =>
  `${c.connection}:${c.model}${c.zdr ? ":zdr" : ""}`;

/** A model's id read back (`choiceId`); null when it is not one. */
export function parseChoice(id: string): ModelRoute | null {
  if (id.startsWith(TAG_REF)) return null;
  const at = id.indexOf(":");
  if (at <= 0) return null;
  const connection = id.slice(0, at) as Connection;
  if (!CONNECTIONS.includes(connection)) return null;
  const zdr = id.endsWith(":zdr");
  const model = id.slice(at + 1, zdr ? -":zdr".length : undefined);
  return model && MODEL_ID.test(model) ? { connection, model, zdr } : null;
}

/** A tag's id in a `tag:` value; null when the value names no tag. */
export const tagOfRef = (v: string | null | undefined): string | null =>
  typeof v === "string" && v.startsWith(TAG_REF) && TAG_ID.test(v.slice(TAG_REF.length))
    ? v.slice(TAG_REF.length)
    : null;
const TAG_ID = /^[a-z0-9]{6,32}$/;

/** Jev, the decision model: it speaks another protocol and answers only that call (AU-234). */
const DECISION_MODEL = /(^|\/)jev-/;

/**
 * The kinds of call a model answers, by what it is (AU-234): a decision model only decisions, any other both the
 * «Agente» and the reading. Which cases its evaluation runs follows from it; never the person or a tag.
 */
export function kindsOf(m: Pick<ModelRoute, "connection" | "model">): Kind[] {
  return m.connection === "typesafe" || DECISION_MODEL.test(m.model)
    ? ["decision"]
    : ["agent", "reading"];
}

/** «Modelos» as the person keeps it (AU-232, AU-236, AU-237), in the user's store beside `ModelsConfig`. */
export interface ModelsList {
  /** The loaded models, in the person's order (the order only says who wins in a tag), each with its tags' ids. */
  models: { id: string; tags: string[] }[];
  /** The tags the person wrote: an id under the name, so renaming breaks nothing. None ships. */
  tags: { id: string; name: string }[];
  /** «De la cuenta»: per kind of call, a model's id, `tag:<id>`, or null (the server's model, or «Sin modelo»). */
  account: Record<Kind, string | null>;
}

export const EMPTY_LIST: ModelsList = {
  models: [],
  tags: [],
  account: { agent: null, reading: null, decision: null },
};

/** What is wrong with a list (empty: fine). */
export function listErrors(x: unknown): string[] {
  const o = x as Partial<ModelsList> | null;
  if (!o || typeof o !== "object") return ["not an object"];
  const out: string[] = [];
  const tags = Array.isArray(o.tags) ? o.tags : null;
  if (!tags) out.push("tags: a list");
  else {
    if (tags.length > TAGS_MAX) out.push(`tags: at most ${TAGS_MAX}`);
    const names = new Set<string>();
    const ids = new Set<string>();
    for (const t of tags) {
      if (!t || typeof t.id !== "string" || !TAG_ID.test(t.id) || ids.has(t.id))
        out.push("tags: each with an id of its own");
      const name = typeof t?.name === "string" ? t.name.trim() : "";
      if (!name || name.length > TAG_NAME_MAX || name !== t.name)
        out.push(`tags: a name of 1 to ${TAG_NAME_MAX} characters`);
      if (names.has(name.toLocaleLowerCase())) out.push("tags: names distinct from each other");
      names.add(name.toLocaleLowerCase());
      ids.add(t?.id);
    }
  }
  const models = Array.isArray(o.models) ? o.models : null;
  if (!models) out.push("models: a list");
  else {
    if (models.length > MODELS_MAX) out.push(`models: at most ${MODELS_MAX}`);
    const seen = new Set<string>();
    for (const m of models) {
      if (!m || typeof m.id !== "string" || !parseChoice(m.id) || seen.has(m.id))
        out.push("models: each a model's id, once");
      seen.add(m?.id);
      if (!Array.isArray(m?.tags) || m.tags.some((t) => !tags?.some((x) => x.id === t)))
        out.push("models: tags among the list's");
      else if (new Set(m.tags).size !== m.tags.length) out.push("models: each tag once");
    }
  }
  const a = o.account;
  if (!a || typeof a !== "object") out.push("account: one row per kind");
  else
    for (const k of KINDS) {
      const v = a[k];
      if (v === null) continue;
      const tag = tagOfRef(v);
      if (tag ? !tags?.some((t) => t.id === tag) : !(typeof v === "string" && parseChoice(v)))
        out.push(`account.${k}: a model's id, a tag or nothing`);
    }
  return out;
}

/** One part of a model's evaluation, as the gate reads it: its count of cases and its own date (AU-244). */
export interface EvalMark {
  right: number;
  total: number;
  at: number;
}
export type EvalParts = Partial<Record<Kind, EvalMark>>;

const current = (p: EvalMark | undefined, now: number) =>
  !!p && now - p.at < EVAL_DAYS * 86_400_000;

/**
 * The gate (AU-235): a model may be chosen for a kind of call only with a part of that kind in its evaluation, of
 * less than `EVAL_DAYS`. Its result is never read: «3 de 24» opens it as «24 de 24» does.
 */
export const gateOpen = (parts: EvalParts | undefined, kind: Kind, now: number): boolean =>
  current(parts?.[kind], now);

/** The model was evaluated for a kind, current or expired (what a tag takes, AU-239; never a model never evaluated). */
export const evaluatedFor = (parts: EvalParts | undefined, kind: Kind): boolean => !!parts?.[kind];

/**
 * A model's evaluation as the list says it (AU-234, AU-244): its parts summed, «Parcial» when a kind it answers has
 * no part (only those carried from the uses of before), «Caducada» when a part is past its days.
 */
export function markOf(
  parts: EvalParts | undefined,
  kinds: readonly Kind[],
  now: number,
): { right: number; total: number; at: number; partial: boolean; expired: boolean } | null {
  const had = kinds.flatMap((k) => (parts?.[k] ? [parts[k] as EvalMark] : []));
  if (!had.length) return null;
  return {
    right: had.reduce((a, p) => a + p.right, 0),
    total: had.reduce((a, p) => a + p.total, 0),
    at: Math.min(...had.map((p) => p.at)),
    partial: had.length < kinds.length,
    expired: had.some((p) => !current(p, now)),
  };
}

/**
 * The model a tag answers with (AU-239): the first of its models, in the list's order, that `usable` takes (its key
 * there, evaluated for that kind, current or expired). The order and the tags are the person's acts only: the clock
 * never changes who answers. Null: «Sin modelo» (AU-241).
 */
export function firstOfTag(
  list: ModelsList,
  tag: string,
  usable: (id: string) => boolean,
): string | null {
  return list.models.find((m) => m.tags.includes(tag) && usable(m.id))?.id ?? null;
}
