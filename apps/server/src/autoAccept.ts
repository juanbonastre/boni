// Accepting a mail's proposals alone: the code's rule, measured over Juan's decisions, and the area «Aceptar solas» of the procedure (docs/fiabilidad.md).
import { randomUUID } from "node:crypto";
import { type Agent, backOff, type CostClass, resolve } from "@boni/agent";
import type { ProposalRow, UserStore } from "@boni/store";
import { likeKey } from "./inboxCard.ts";

/**
 * When Boni accepts a proposal alone ("pseudoaceptado", Juan 2026-10-23: measure first; he turns it on when it is
 * right often enough, and the rule may change as it is seen). The code decides, never a model: a proposal to create
 * something from a mail, when Juan already decided at least `MIN` like it (same sender, same collection) and the
 * last `WINDOW` of those he accepted as they were (no title or collection corrected: a correction means the reading
 * was wrong). The inbox shows the prediction and the Registro how often it would have been right. Since F3 of
 * docs/fiabilidad.md it is an area of the procedure, `AUTO_AREA`, class B with its «Solo» switch: with it on,
 * `acceptAlone` accepts what the rule says and writes each as a decision Juan judges by leaving it (right) or
 * undoing or deleting it (wrong); three wrong in a row or a fifth of the last turn the switch off on its own.
 */
export const MIN = 3;
export const WINDOW = 5;
export const AUTO_AREA = "mail.accept";
export const AUTO_COST: CostClass = "B";
/** Today's rule as the area's thresholds: alone only when every one of the last `WINDOW` was kept as proposed. */
export const AUTO_THRESHOLDS = { ask: 0, do: 1 } as const;
/** A proposal accepted alone and neither undone nor deleted in this long was right. */
export const JUDGE_AFTER = 7 * 24 * 3_600_000;
/** The store setting with each area's «Solo»: `{ [area]: { on, at, by } }`. */
const SETTING = "decisions/auto";

/** A decision that counts as "right as proposed": accepted with no correction of its title or collection. */
export const asProposed = (p: ProposalRow): boolean =>
  p.status === "accepted" && !p.edits?.type && !p.edits?.values?.title;

export function wouldAccept(prior: readonly boolean[]): boolean {
  return prior.length >= MIN && prior.slice(-WINDOW).every(Boolean);
}

/**
 * The rule as a confidence (docs/fiabilidad.md §3.5: today's numbers are the first thresholds): below `MIN` decided
 * there is no basis, 0; from there, the share of the last `WINDOW` kept as proposed, so 1 is `wouldAccept`.
 */
export function confidence(prior: readonly boolean[]): number {
  if (prior.length < MIN) return 0;
  const last = prior.slice(-WINDOW);
  return last.filter(Boolean).length / last.length;
}

// ------------------------------------------------------------------ the «Solo» switch, per area

export interface AutoState {
  on: boolean;
  at: number;
  /** Who turned it last: Juan in Settings, or Boni backing off. */
  by: "juan" | "boni";
}

export function autoStates(store: UserStore): Record<string, AutoState> {
  try {
    const v = JSON.parse(store.setting(SETTING) ?? "{}") as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, AutoState> = {};
    for (const [k, s] of Object.entries(v as Record<string, unknown>)) {
      if (!s || typeof s !== "object") continue;
      const x = s as Record<string, unknown>;
      out[k] = {
        on: x.on === true,
        at: typeof x.at === "number" ? x.at : 0,
        by: x.by === "boni" ? "boni" : "juan",
      };
    }
    return out;
  } catch {
    return {};
  }
}

export const autoOn = (store: UserStore, area: string): boolean =>
  autoStates(store)[area]?.on === true;

export function setAutoState(
  store: UserStore,
  area: string,
  on: boolean,
  by: AutoState["by"],
  at: number,
): void {
  store.setSetting(SETTING, JSON.stringify({ ...autoStates(store), [area]: { on, at, by } }));
}

// ------------------------------------------------------------------ Juan's decisions, replayed

/** What a decision of the area was about: the proposal, and the run that accepted it when Boni did. */
interface AutoDetail {
  proposal?: string;
  run?: string;
}
const detailOf = (d: { detail: unknown }): AutoDetail =>
  d.detail && typeof d.detail === "object" ? (d.detail as AutoDetail) : {};

/** The area's decisions to accept alone, by proposal: what Juan made of each (null while unjudged). */
function aloneByProposal(store: UserStore): Map<string, "right" | "wrong" | null> {
  const out = new Map<string, "right" | "wrong" | null>();
  for (const d of store.journal.decisions(AUTO_AREA, 1000)) {
    const id = detailOf(d).proposal;
    if (d.outcome === "do" && id) out.set(id, d.result);
  }
  return out;
}

/** The runs in which Boni accepted a proposal alone (the Registro names them so). */
export function aloneRuns(store: UserStore): Set<string> {
  const out = new Set<string>();
  for (const d of store.journal.decisions(AUTO_AREA, 1000)) {
    const run = detailOf(d).run;
    if (d.outcome === "do" && run) out.add(run);
  }
  return out;
}

/**
 * The decided proposals to create something from a mail, in the order they were decided, each with whether it
 * was right as proposed. One Boni accepted alone counts by what Juan made of it (kept: right; undone: wrong), and
 * not until he did: Boni's own acceptances never vouch for themselves.
 */
function decided(store: UserStore): { p: ProposalRow; right: boolean }[] {
  const alone = aloneByProposal(store);
  return [...store.journal.proposals("accepted"), ...store.journal.proposals("rejected")]
    .filter(
      (p) =>
        p.tool === "entities.create" &&
        p.decided !== null &&
        // A mail's: its sender is among its sources, not always the first (inboxCard.ts `sourceKey`).
        p.sources.some((s) => s.startsWith("mail:")),
    )
    .sort((a, b) => (a.decided ?? 0) - (b.decided ?? 0) || a.created - b.created)
    .flatMap((p) => {
      if (!alone.has(p.id)) return [{ p, right: asProposed(p) }];
      const r = alone.get(p.id);
      return r ? [{ p, right: r === "right" }] : [];
    });
}

/** For each kind of proposal (likeKey), whether each decision was right as proposed, oldest first. */
export function decisionHistory(store: UserStore): Map<string, boolean[]> {
  const out = new Map<string, boolean[]>();
  for (const { p, right } of decided(store)) {
    const k = likeKey(p);
    if (!k) continue;
    const l = out.get(k);
    if (l) l.push(right);
    else out.set(k, [right]);
  }
  return out;
}

/**
 * The rule replayed over the past decisions (each judged only by what came before it): of the last `LAST`,
 * how many Boni would have accepted alone, and how many of those were kept as proposed. What earns the area its
 * «Solo» (docs/fiabilidad.md §3.4), and what the Registro shows.
 */
export const LAST = 200;
export function measure(store: UserStore): { decided: number; would: number; right: number } {
  const seen = new Map<string, boolean[]>();
  const all = decided(store);
  const from = Math.max(0, all.length - LAST);
  let would = 0;
  let right = 0;
  all.forEach(({ p, right: ok }, i) => {
    const k = likeKey(p);
    const prior = k ? (seen.get(k) ?? []) : [];
    if (i >= from && k && wouldAccept(prior)) {
      would++;
      if (ok) right++;
    }
    if (k) seen.set(k, [...prior, ok]);
  });
  return { decided: all.length - from, would, right };
}

// ------------------------------------------------------------------ accepting alone, and judging it

/** What `acceptAlone` needs of the agent: accepting a proposal under the policy, without judging the run itself. */
type Acceptor = Pick<Agent, "acceptProposal">;

/**
 * With «Solo» on, the proposals of a mail just read: each is a decision of the area, written down with its
 * confidence; the ones the rule is sure of are accepted here (the acceptance run is theirs to undo), the rest wait
 * in the inbox as always. Judges the earlier ones first, so a back-off stops this before it accepts anything.
 */
export async function acceptAlone(
  store: UserStore,
  agent: Acceptor,
  ids: readonly string[],
  now: number,
): Promise<number> {
  judgeAlone(store, now);
  if (!autoOn(store, AUTO_AREA)) return 0;
  const history = decisionHistory(store);
  let n = 0;
  for (const id of ids) {
    const p = store.journal.proposal(id);
    if (!p || p.status !== "pending" || p.tool !== "entities.create") continue;
    const k = likeKey(p);
    if (!k) continue;
    const conf = confidence(history.get(k) ?? []);
    const outcome = resolve(conf, AUTO_COST, true, AUTO_THRESHOLDS);
    const base = {
      id: randomUUID(),
      run: p.run,
      area: AUTO_AREA,
      cost: AUTO_COST,
      p: conf,
      at: now,
    };
    if (outcome !== "do") {
      store.journal.addDecision({ ...base, outcome, detail: { proposal: id } });
      continue;
    }
    const r = await agent.acceptProposal(id, "personal", undefined, { judge: false });
    if (!r.run) {
      console.warn(`mail: proposal ${id} not accepted alone (${r.error ?? r.status})`);
      continue;
    }
    store.journal.addDecision({ ...base, outcome: "do", detail: { proposal: id, run: r.run } });
    n++;
  }
  return n;
}

/**
 * What Juan made of the proposals Boni accepted alone: undone, or its new entry deleted, is wrong at once; left
 * for `JUDGE_AFTER` is right, and then the reading's own decisions (its collection, its fields) were right too, as
 * when he accepts as proposed. Then the back-off: the switch goes off on its own after three wrong in a row or a
 * fifth of the last twenty (docs/fiabilidad.md §3.3).
 */
export function judgeAlone(store: UserStore, now: number): void {
  const rows = store.journal.decisions(AUTO_AREA, LAST);
  for (const d of rows) {
    if (d.outcome !== "do" || d.result) continue;
    const run = detailOf(d).run;
    if (!run) continue;
    const ops = store.runOps(run);
    if (!ops.length) continue;
    const gone =
      !store.runUndoable(run) ||
      ops.some((o) => o.kind === "create" && store.get(o.target)?.entity.deleted !== undefined);
    if (gone) store.journal.setDecisionResult(d.id, "wrong", now);
    else if (now - d.at >= JUDGE_AFTER) {
      store.journal.setDecisionResult(d.id, "right", now);
      for (const x of store.journal.decisionsOf(d.run))
        if (x.outcome === "do" && !x.result) store.journal.setDecisionResult(x.id, "right", now);
    }
  }
  if (!autoOn(store, AUTO_AREA)) return;
  const judged = store.journal
    .decisions(AUTO_AREA, LAST)
    .filter((d) => d.outcome === "do" && d.result);
  if (backOff(judged.map((d) => d.result === "right")))
    setAutoState(store, AUTO_AREA, false, "boni", now);
}
