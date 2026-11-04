import type { ProposalRow, RunRow, UserStore } from "@boni/store";
import { mailOfPlan } from "./mailReview.ts";

/**
 * What a run of the agent was and what came of it, for the Registro (Juan, 2026-10-22: "Segundo plano · Hecho"
 * said nothing). Made by code from the journal and the operation log: which mail a background reading read, the
 * request Juan wrote; how many proposals it made and how they were decided; what it changed. A run of the retired
 * Markdown mirror is named by its origin alone (no vault path, D-17). Text that came from outside (a mail's subject and sender) stays text: the app never renders it as
 * markup.
 */
export type RunWhat =
  /** Juan's own request in the conversation. */
  | { kind: "request"; text: string }
  /** A new mail read in the background (mail.ts). */
  | { kind: "mail"; subject: string; from: string; account: string | null }
  /** A mail read again to measure a suggested reading guide (mailReview.ts): changes nothing. */
  | { kind: "measure"; subject: string }
  /** The reviewer reading Juan's decisions (mailReview.ts). */
  | { kind: "review" }
  /** A proposal Juan accepted. */
  | { kind: "accepted" }
  | { kind: "other" };

export interface RunChange {
  action: "create" | "update" | "delete" | "restore";
  title: string;
  collection: string;
  undone: boolean;
}

export interface RunInfo {
  what: RunWhat;
  /** The proposals it made, by what happened to them. */
  proposals: Record<ProposalRow["status"], number>;
  /** What it changed (the first few) and how many changes in all. */
  changes: RunChange[];
  changed: number;
  /** A proposal Boni accepted alone («Solo», docs/fiabilidad.md): Juan judges it by leaving it or undoing it. */
  alone?: boolean;
}

/** At most this many changes are named; the rest are counted. */
const NAMED = 5;
const TEXT = 200;

const text = (v: unknown, max = TEXT): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

export type ProposalCounts = Record<ProposalRow["status"], number>;
const NO_PROPOSALS: ProposalCounts = {
  pending: 0,
  accepted: 0,
  rejected: 0,
  postponed: 0,
  stale: 0,
};

/**
 * How many proposals of each state every run made, from one count in the journal (the Registro asks for 50 runs at
 * a time). Counting beats reading every proposal with its arguments: with Juan's journal that read held the server
 * 370 ms on each request of the Registro (2026-11-04, task 43).
 */
export function proposalsByRun(store: UserStore): Map<string, ProposalCounts> {
  const out = new Map<string, ProposalCounts>();
  for (const { run, status, n } of store.journal.proposalCounts()) {
    let c = out.get(run);
    if (!c) {
      c = { ...NO_PROPOSALS };
      out.set(run, c);
    }
    if (status in c) c[status] += n;
  }
  return out;
}

/** What a run says of the mail it read. */
export interface MailSeen {
  subject: string;
  from: string;
}

export function whatOf(
  store: UserStore,
  r: RunRow,
  mailAccount: string | null,
  mails?: Map<string, MailSeen | null>,
): RunWhat {
  if (r.origin === "accepted") return { kind: "accepted" };
  if (r.origin === "turn" || r.turn) {
    const planner = store.journal.modelCalls(r.id).find((m) => m.role === "planner");
    const req = (planner?.request as { input?: { request?: unknown } } | undefined)?.input?.request;
    return { kind: "request", text: text(req, 300) };
  }
  if (r.origin === "background") {
    const plan = r.plan as { steps?: { reader?: string; tool?: string; op?: string }[] } | null;
    const steps = plan?.steps ?? [];
    if (steps[0]?.reader === "review_reading") return { kind: "review" };
    // The run's own plan says which mail it read (no second read of the journal).
    const mail = mailOfPlan(plan);
    let seen = mail ? mails?.get(mail) : null;
    if (mail && seen === undefined) {
      const v = store.get(mail)?.entity.values;
      seen = v ? { subject: text(v.f_asunto), from: text(v.f_de_nombre) || text(v.f_de) } : null;
      mails?.set(mail, seen);
    }
    if (seen) {
      // A reading that may create nothing (no collection to put it in) is the reviewer measuring a guide.
      if (!JSON.stringify(steps).includes("entities.create"))
        return { kind: "measure", subject: seen.subject };
      return { kind: "mail", subject: seen.subject, from: seen.from, account: mailAccount };
    }
  }
  return { kind: "other" };
}

export function runInfo(
  store: UserStore,
  r: RunRow,
  o: {
    proposals?: Map<string, ProposalCounts>;
    mailAccount?: string | null;
    /** The runs in which Boni accepted a proposal alone (autoAccept.ts). */
    alone?: Set<string>;
    /** Only what it was and how many changes, not their names (Boni's «Ejecuciones»: thousands of runs). */
    countOnly?: boolean;
    /** The mails already looked up, by id: many runs read the same mail (the reviewer's measures). */
    mails?: Map<string, MailSeen | null>;
  } = {},
): RunInfo {
  const proposals = { ...NO_PROPOSALS, ...(o.proposals ?? proposalsByRun(store)).get(r.id) };
  const ops = store.runOps(r.id);
  const schema = store.schema().types;
  const changes: RunChange[] = [];
  for (const op of o.countOnly ? [] : ops.slice(0, NAMED)) {
    const e = store.get(op.target)?.entity;
    const def = e ? schema[e.type] : undefined;
    changes.push({
      action: op.kind,
      title: e && def ? text(e.values[def.titleField]) : "",
      collection: def?.name ?? "",
      undone: op.undone,
    });
  }
  return {
    what: whatOf(store, r, o.mailAccount ?? null, o.mails),
    proposals,
    changes,
    changed: ops.length,
    ...(r.origin === "accepted" && o.alone?.has(r.id) ? { alone: true } : {}),
  };
}
