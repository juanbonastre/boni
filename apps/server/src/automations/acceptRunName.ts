/**
 * The tool name of a run's proposal (proposal.ts `withRunProposal`), alone in a module that imports nothing: the mail's
 * code (mailPieces.ts, mail.ts) reads it without loading proposal.ts, whose import of service.ts would otherwise run
 * the server's registry before this name exists.
 */
export const ACCEPT_RUN = "automations.accept_run";

/**
 * A run's proposal is one card per row (AU-251) when all it asks is to create rows, and they are this many or fewer:
 * each row is its own proposal of `ACCEPT_RUN`, of the one agent run that proposed them all, accepted or discarded on
 * its own. More, or anything but a create, is the one summary card of AU-193, accepted whole.
 */
export const ROWS_AS_CARDS = 5;

/** The row of what its run asked that a proposal of one row accepts (AU-251), or null for the whole run's. */
export function runRowOf(p: { tool: string; view: unknown }): number | null {
  if (p.tool !== ACCEPT_RUN) return null;
  const row = (p.view as { run?: { row?: unknown } } | null)?.run?.row;
  return typeof row === "number" && Number.isInteger(row) && row >= 0 ? row : null;
}
