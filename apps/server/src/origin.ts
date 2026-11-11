/**
 * «¿De dónde viene?» (docs/sistema.md §4.4, F8): who made a record and from what, read from the operation log and the
 * journal. A record a flow proposed leads to that flow's run, the mail that started it and the «Aceptar» that made
 * it; one the user, an assistant by the MCP, an import or the mail's connector wrote says who and when. The app draws
 * the run on the map; nothing here is a model's word.
 */
import type { PendingProposal, RecordOrigin } from "@boni/agent";
import type { TypeDef } from "@boni/entities";
import type { ProposalRow, RunRow, UserStore } from "@boni/store";
import { aloneRuns } from "./autoAccept.ts";
import { mapOwnerOf } from "./flowMap.ts";
import { MAIL_FLOW } from "./flows.ts";
import { mailOfRun } from "./mailReview.ts";
import { whatOf } from "./runInfo.ts";

export interface Origin {
  /** Who made it: a flow's run, the conversation, the user, an assistant by the MCP, an import, the mail's connector,
   * or Boni's own code. */
  by: "flow" | "chat" | "user" | "assistant" | "import" | "connector" | "boni";
  /** When it was made. */
  at: number;
  /** The user's device, or the assistant's name. */
  device: string | null;
  /** The run that made it or proposed it, and the node of the map it belongs to: the app draws it there. */
  run: {
    id: string;
    flow: string | null;
    flowVersion: number | null;
    started: number;
    owner: string | null;
  } | null;
  /** The record that started that run (a mail), by its title and collection. */
  input: { id: string; title: string; collection: string } | null;
  /** It came through the Bandeja: what was proposed (its title as proposed), when it was proposed and accepted, and
   * whether Boni accepted it alone. */
  proposal: { title: string; created: number; decided: number | null; alone: boolean } | null;
}

const text = (v: unknown, max = 120): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** A proposal's title as the Bandeja shows it (its view's title row, or its collection's title field's), as text. */
function proposedTitle(p: ProposalRow, def?: TypeDef): string {
  const v = (p.view ?? {}) as { rows?: { arg?: unknown; value?: unknown }[]; title?: unknown };
  const rows = Array.isArray(v.rows) ? v.rows : [];
  const key = def?.fields.find((f) => f.id === def.titleField)?.key;
  const row =
    rows.find((r) => r.arg === "values.title") ??
    (key ? rows.find((r) => r.arg === `values.${key}`) : undefined);
  return text(row?.value ?? v.title);
}

/**
 * Who ran a run, its flow and the record that started it: a reading from before flows (no flow on its run) is «Leer
 * correo»'s, as the map counts it, started by the mail its plan read first.
 */
function ranBy(
  store: UserStore,
  run: RunRow,
  mailAccount: string | null,
): { by: Origin["by"]; flow: string | null; input: string | null } {
  const by: Origin["by"] = run.flow
    ? "flow"
    : run.turn || run.origin === "turn"
      ? "chat"
      : whatOf(store, run, mailAccount).kind === "mail"
        ? "flow"
        : "boni";
  const flow = run.flow ?? (by === "flow" ? MAIL_FLOW : null);
  const input = run.input ?? (by === "flow" ? mailOfRun(store, run.id) : null);
  return { by, flow, input };
}

/** Where a record comes from, or null when the store has no such record. */
export function recordOrigin(
  store: UserStore,
  id: string,
  o: { mailAccount: string | null },
): Origin | null {
  if (!store.get(id)) return null;
  const ops = store.log({ target: id });
  const made = ops.find((x) => x.kind === "create") ?? ops[0];
  if (!made) return null;
  const j = store.journal;
  let run: RunRow | null = made.run ? j.run(made.run) : null;
  let proposal: ProposalRow | null = null;
  let alone = false;
  if (run?.origin === "accepted") {
    // An «Aceptar»: the proposal it applied (kept since 2026-11-06; before, the one accepted as it started).
    proposal =
      (run.proposal ? j.proposal(run.proposal) : null) ?? j.proposalAcceptedNear(run.started, 2000);
    alone = aloneRuns(store).has(run.id);
    run = proposal ? j.run(proposal.run) : null;
  }
  const ran = run ? ranBy(store, run, o.mailAccount) : null;
  const by = (): Origin["by"] => {
    if (ran) return ran.by;
    if (made.by.startsWith("user")) return "user";
    if (made.by.startsWith("mcp:")) return "assistant";
    if (made.by === "import") return "import";
    if (made.by.startsWith("connector")) return "connector";
    return "boni";
  };
  const who = by();
  const flow = ran?.flow ?? null;
  const input = (() => {
    const at = ran?.input ?? null;
    const s = at ? store.get(at) : null;
    const t = s ? store.schema().types[s.entity.type] : undefined;
    if (!at || !s || !t) return null;
    return { id: at, title: text(s.entity.values[t.titleField]), collection: t.name };
  })();
  return {
    by: who,
    at: made.at,
    device:
      who === "assistant" ? made.by.slice("mcp:".length, 40) : who === "user" ? made.device : null,
    run: run
      ? {
          id: run.id,
          flow,
          flowVersion: run.flowVersion,
          started: run.started,
          owner: mapOwnerOf(store, run, o.mailAccount),
        }
      : null,
    input,
    proposal: proposal
      ? {
          title: proposedTitle(proposal),
          created: proposal.created,
          decided: proposal.decided,
          alone,
        }
      : null,
  };
}

/**
 * The same, for a model (the planner's `entities.origin`, the MCP's `origin`; task 86: asked «¿De dónde viene?» in the
 * conversation, the planner could only look for mails with that name): the flow by its name, and the record that started
 * the run by its id alone, so that whoever reads it reads it as the models may see it.
 */
export function originFacts(
  store: UserStore,
  id: string,
  o: { mailAccount: string | null },
): RecordOrigin | null {
  const x = recordOrigin(store, id, o);
  if (!x) return null;
  const flow = x.run?.flow ? store.journal.flow(x.run.flow) : null;
  return {
    by: x.by,
    at: x.at,
    device: x.device,
    flow: x.run?.flow
      ? { id: x.run.flow, name: flow?.name ?? x.run.flow, version: x.run.flowVersion }
      : null,
    input: x.input?.id ?? null,
    proposal: x.proposal
      ? { created: x.proposal.created, decided: x.proposal.decided, alone: x.proposal.alone }
      : null,
    run: x.run?.id ?? null,
  };
}

/** The proposals waiting in the Bandeja, newest first, each with who proposed it and from what (`inbox.pending`). */
export function pendingFacts(
  store: UserStore,
  o: { mailAccount: string | null },
): PendingProposal[] {
  const j = store.journal;
  const types = Object.values(store.schema().types);
  return j
    .proposals("pending")
    .slice()
    .sort((a, b) => b.created - a.created)
    .map((p) => {
      const run = j.run(p.run);
      const ran = run ? ranBy(store, run, o.mailAccount) : null;
      const key = (p.args as { values?: { type?: { value?: unknown } } }).values?.type?.value;
      const type =
        typeof key === "string" ? types.find((t) => t.key === key || t.id === key) : undefined;
      const flow = ran?.flow ? j.flow(ran.flow) : null;
      return {
        id: p.id,
        title: proposedTitle(p, type),
        type: type?.id ?? null,
        created: p.created,
        by: ran?.by ?? "boni",
        flow: ran?.flow
          ? { id: ran.flow, name: flow?.name ?? ran.flow, version: run?.flowVersion ?? null }
          : null,
        input: ran?.input ?? null,
        run: run?.id ?? null,
      };
    });
}
