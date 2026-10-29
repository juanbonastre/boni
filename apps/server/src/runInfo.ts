import type { ProposalRow, RunRow, UserStore } from "@boni/store";
import { mailOfRun } from "./mailReview.ts";

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
}

/** At most this many changes are named; the rest are counted. */
const NAMED = 5;
const TEXT = 200;

const text = (v: unknown, max = TEXT): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** The proposals of each run, from one read of the journal (the Registro asks for 50 runs at a time). */
export function proposalsByRun(store: UserStore): Map<string, ProposalRow[]> {
  const out = new Map<string, ProposalRow[]>();
  for (const p of store.journal.proposals()) {
    const l = out.get(p.run);
    if (l) l.push(p);
    else out.set(p.run, [p]);
  }
  return out;
}

function whatOf(store: UserStore, r: RunRow, mailAccount: string | null): RunWhat {
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
    const mail = mailOfRun(store, r.id);
    const m = mail ? store.get(mail) : null;
    if (m) {
      const v = m.entity.values;
      const subject = text(v.f_asunto);
      // A reading that may create nothing (no collection to put it in) is the reviewer measuring a guide.
      if (!JSON.stringify(steps).includes("entities.create")) return { kind: "measure", subject };
      return {
        kind: "mail",
        subject,
        from: text(v.f_de_nombre) || text(v.f_de),
        account: mailAccount,
      };
    }
  }
  return { kind: "other" };
}

export function runInfo(
  store: UserStore,
  r: RunRow,
  o: { proposals?: Map<string, ProposalRow[]>; mailAccount?: string | null } = {},
): RunInfo {
  const mine = (o.proposals ?? proposalsByRun(store)).get(r.id) ?? [];
  const proposals = { pending: 0, accepted: 0, rejected: 0, postponed: 0, stale: 0 };
  for (const p of mine) proposals[p.status]++;
  const ops = store.runOps(r.id);
  const schema = store.schema().types;
  const changes: RunChange[] = [];
  for (const op of ops.slice(0, NAMED)) {
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
    what: whatOf(store, r, o.mailAccount ?? null),
    proposals,
    changes,
    changed: ops.length,
  };
}
