/**
 * The tool name of a run's proposal (proposal.ts `withRunProposal`), alone in a module that imports nothing: the mail's
 * code (mailPieces.ts, mail.ts) reads it without loading proposal.ts, whose import of service.ts would otherwise run
 * the server's registry before this name exists.
 */
export const ACCEPT_RUN = "automations.accept_run";
