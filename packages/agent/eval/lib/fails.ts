/**
 * Why an evaluation's case failed, as fixed codes the «Modelos» page says in words (task 132): who failed (the use
 * whose call failed, or the provider) and what, from a closed list. A grader's English detail and a provider's message
 * stay in the result's `note` for the logs; nothing a model or a provider wrote becomes a reason here.
 */
import type { Role } from "../../src/models.ts";

/** Who a failed case is of: a use (the page gives each its label: «Agente», «Lector»…) or the provider. */
export type FailWho = Role | "provider";

/**
 * What failed, for a use. A grader's check declares one of the last four. A provider's `what` is instead one of the
 * codes the provider's refusals become (`refusedCode`, openai.ts: `rate-limit`, `no-credit`, `http-500`…), which the
 * page says with the words it gives a run that stopped on them.
 */
export const FAIL_KINDS = [
  // A reader's (or a decider's) answer the code refused.
  "invalid-answer",
  // The planner gave no plan the code could take, after its second ask.
  "no-plan",
  // The plan asked for a tool or a service that is not there.
  "missing-tool",
  // The graders' kinds.
  "unfinished",
  "missing",
  "extra",
  "wrong",
] as const;
export type FailKind = (typeof FAIL_KINDS)[number];

export interface Failed {
  who: FailWho;
  /** A `FailKind`, `max-tokens` or `refusal` for a use; a fixed refusal code for the provider. */
  what: string;
}

/** A code the page may map, and nothing else: a provider's or an engine's code is short, lower-case and fixed. */
const CODE = /^[a-z0-9-]{1,30}$/;

/** A grader's verdict: its kind, and its English detail for the logs (never painted). */
export interface Miss {
  kind: Exclude<FailKind, "invalid-answer" | "no-plan" | "missing-tool">;
  detail: string;
}
export const miss = (kind: Miss["kind"], detail: string): Miss => ({ kind, detail });

/**
 * A model call of `who` that failed with a provider's code (`ProviderError.code`, or a run's `model-<code>`): an
 * answer that was no JSON is that use's; one that was cut off or refused, too; anything else is the provider's.
 */
export function callFail(code: string, who: Role): Failed {
  const c = code.startsWith("model-") ? code.slice("model-".length) : code;
  if (c === "not-json") return { who, what: who === "planner" ? "no-plan" : "invalid-answer" };
  if (c === "max-tokens" || c === "refusal") return { who, what: c };
  return { who: "provider", what: CODE.test(c) ? c : "failed" };
}

/**
 * A planner evaluation's run that stopped with `error`; `called`: the use whose model call failed, when one did (the
 * run's audit says it). The reader's refusals name their reader (`review_reading` is the reviewer's).
 */
export function runFail(error: string, called: Role | null): Failed {
  const reader = /^reader-failed:([a-z_]{1,30}):/.exec(error);
  if (reader)
    return { who: reader[1] === "review_reading" ? "reviewer" : "reader", what: "invalid-answer" };
  // A server from before AU-59 (PR 444) stopped on the reader's first refusal with this code.
  if (/^R2-reader-output-invalid$/.test(error)) return { who: "reader", what: "invalid-answer" };
  if (error.startsWith("model-")) return callFail(error, called ?? "planner");
  if (error === "plan-invalid") return { who: "planner", what: "no-plan" };
  if (error === "tool-not-available") return { who: "planner", what: "missing-tool" };
  return { who: "planner", what: "unfinished" };
}
