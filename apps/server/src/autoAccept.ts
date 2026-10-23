import type { ProposalRow, UserStore } from "@boni/store";
import { likeKey } from "./inboxCard.ts";

/**
 * When Boni could accept a proposal alone ("pseudoaceptado", Juan 2026-10-23: measure first; he turns it on when
 * it is right often enough, and the rule may change as it is seen). The code decides, never a model: a proposal
 * to create something from a mail, when Juan already decided at least `MIN` like it (same sender, same collection)
 * and the last `WINDOW` of those he accepted as they were (no title or collection corrected: a correction means
 * the reading was wrong). Nothing is accepted here; the inbox shows the prediction and the Registro how often it
 * would have been right.
 */
export const MIN = 3;
export const WINDOW = 5;

/** A decision that counts as "right as proposed": accepted with no correction of its title or collection. */
export const asProposed = (p: ProposalRow): boolean =>
  p.status === "accepted" && !p.edits?.type && !p.edits?.values?.title;

export function wouldAccept(prior: readonly boolean[]): boolean {
  return prior.length >= MIN && prior.slice(-WINDOW).every(Boolean);
}

/** Juan's decided proposals to create something from a mail, in the order he decided them. */
function decided(store: UserStore): ProposalRow[] {
  return [...store.journal.proposals("accepted"), ...store.journal.proposals("rejected")]
    .filter(
      (p) =>
        p.tool === "entities.create" &&
        p.decided !== null &&
        (p.sources[0] ?? "").startsWith("mail:"),
    )
    .sort((a, b) => (a.decided ?? 0) - (b.decided ?? 0) || a.created - b.created);
}

/** For each kind of proposal (likeKey), whether each decision was right as proposed, oldest first. */
export function decisionHistory(store: UserStore): Map<string, boolean[]> {
  const out = new Map<string, boolean[]>();
  for (const p of decided(store)) {
    const k = likeKey(p);
    if (!k) continue;
    const l = out.get(k);
    if (l) l.push(asProposed(p));
    else out.set(k, [asProposed(p)]);
  }
  return out;
}

/**
 * The rule replayed over Juan's past decisions (each judged only by what came before it): of the last `LAST`,
 * how many Boni would have accepted alone, and how many of those Juan accepted as they were.
 */
export const LAST = 200;
export function measure(store: UserStore): { decided: number; would: number; right: number } {
  const seen = new Map<string, boolean[]>();
  const all = decided(store);
  const from = Math.max(0, all.length - LAST);
  let would = 0;
  let right = 0;
  all.forEach((p, i) => {
    const k = likeKey(p);
    const prior = k ? (seen.get(k) ?? []) : [];
    if (i >= from && k && wouldAccept(prior)) {
      would++;
      if (asProposed(p)) right++;
    }
    if (k) seen.set(k, [...prior, asProposed(p)]);
  });
  return { decided: all.length - from, would, right };
}
