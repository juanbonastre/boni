/**
 * «¿De dónde viene?» (docs/sistema.md §4.4, F8): who made a record and from what, read from the operation log and the
 * journal. A record a flow proposed leads to that flow's run, the mail that started it and the «Aceptar» that made
 * it; one the user, an assistant by the MCP, an import or the mail's connector wrote says who and when. The app draws
 * the run on the map; nothing here is a model's word.
 */
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

/** A proposal's title as the Bandeja showed it (its view's title row), as text. */
function proposedTitle(p: ProposalRow): string {
  const v = (p.view ?? {}) as { rows?: { arg?: unknown; value?: unknown }[]; title?: unknown };
  const row = Array.isArray(v.rows) ? v.rows.find((r) => r.arg === "values.title") : undefined;
  return text(row?.value ?? v.title);
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
  const by = (): Origin["by"] => {
    if (run) {
      if (run.flow) return "flow";
      if (run.turn || run.origin === "turn") return "chat";
      if (whatOf(store, run, o.mailAccount).kind === "mail") return "flow";
      return "boni";
    }
    if (made.by.startsWith("user")) return "user";
    if (made.by.startsWith("mcp:")) return "assistant";
    if (made.by === "import") return "import";
    if (made.by.startsWith("connector")) return "connector";
    return "boni";
  };
  const who = by();
  // A reading from before flows (no flow on its run) is «Leer correo»'s, as the map counts it.
  const flow = run ? (run.flow ?? (who === "flow" ? MAIL_FLOW : null)) : null;
  const input = (() => {
    // The record its trigger bound; a mail's reading from before flows, the mail its plan read first.
    const at = run ? (run.input ?? (who === "flow" ? mailOfRun(store, run.id) : null)) : null;
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
