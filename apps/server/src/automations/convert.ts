/**
 * The flows of before made automations on the server (docs/automatizaciones.md §5.15, AU-150, AU-225 to AU-228; phase
 * F16 S1). When an account's store is first opened (agent.ts `store`), each flow of the person's that is started by
 * hand or at its hours becomes an automation with the same id, in one transaction per flow (`adoptFlow`), and from
 * then on only the new engine runs it (AU-228): the old scheduler and `flows()` no longer see it, «Ejecutar» of its
 * page buttons and `flows.run` start its published version. It is repeatable: an opening after the first converts
 * only what is new.
 *
 * - **What converts.** A flow not deleted, every version of it the person's (`by: "user"`: Boni's own four and any
 *   other preset stay flows until S2 moves them with their callers), with a trigger by hand or by the clock
 *   (`runnableNames`). Each version is translated (`planToAutomation`, pure) and passed through `lowerYes`, so no «Sí»
 *   is born (decision 13); the versions that translate whole keep their number in order and their date and author,
 *   «Convertida» naming the flow version (AU-225). The rest are counted as `skipped`.
 * - **What stays.** A flow whose running version does not translate whole (a step with no step yet: an update or a
 *   delete by id, a reader that names no collection, …), or that `publishChecks` would block over the collections of
 *   today, is `kept`: it goes on running as before, and its row says why, step by step (AU-228). Nothing is lost.
 * - **Its hours.** The automation's hours count from its last run of before (or the flow's save if it never ran), as
 *   the old scheduler counted them: no hour runs twice, none is skipped (AU-226).
 * - **Its runs.** Every finished run of before is copied as a «De antes» row of the automation, with its id, so
 *   «Deshacer lo que hizo» still undoes it (AU-227): in chunks of `COPY_CHUNK`, the server free between them.
 * - **Back.** «Volver al flujo de antes» turns the automation off and the flow runs again (decision 21); «Convertir otra
 *   vez» undoes that while the flow has no version the automation lacks.
 *
 * Nothing of the flow is deleted or changed (its versions, its draft, `runs`, `run_steps`): the old engine sleeps.
 */

import { type Change, type Plan, planToAutomation, runnableNames } from "@boni/agent";
import {
  type Automation,
  blocking,
  keptNames,
  lowerYes,
  type Problem,
  publishChecks,
} from "@boni/automations";
import type { AdoptedVersion, ConversionReason, FlowRow, UserStore } from "@boni/store";
import { type AutomationModels, wireAutomationModels } from "./ai.ts";
import { wireBoni } from "./boni.ts";
import { collectionNamed } from "./collections.ts";
import { aiProblems, contextOf, docHash } from "./publish.ts";
import { scheduleColumn } from "./scheduler.ts";
import { triggerOf } from "./service.ts";

/** Runs of before copied per write: a write of 200 summary rows keeps the server free between them (A-15). */
export const COPY_CHUNK = 200;

/** What one flow came to. */
export type FlowOutcome =
  | { id: string; state: "converted"; versions: number; skipped: number; changes: Change[] }
  | { id: string; state: "kept"; reasons: ConversionReason[]; skipped: number; changes: Change[] }
  /** Not the conversion's in S1: Boni's or a preset's, started by something else than his hand or the clock. */
  | { id: string; state: "left"; why: "notTheUsers" | "trigger" }
  /** Converted, reverted or kept before, with nothing new: no write. */
  | { id: string; state: "already" };

/** Why a flow is not the conversion's in S1, or null when it is. */
function leftOut(versions: readonly FlowRow[]): "notTheUsers" | "trigger" | null {
  if (versions.some((v) => v.by !== "user")) return "notTheUsers";
  const latest = versions[0];
  if (!latest || runnableNames(latest.trigger) === null) return "trigger";
  return null;
}

/** A flow version as an automation, its «Sí» lowered, or why it has no step for some of its plan. */
function translate(
  f: FlowRow,
):
  | { ok: true; automation: Automation; changes: Change[] }
  | { ok: false; reasons: ConversionReason[]; changes: Change[] } {
  const c = planToAutomation({
    id: f.id,
    name: f.name,
    plan: f.plan as Plan,
    trigger: f.trigger,
    from: "flow",
  });
  if (!c.complete)
    return {
      ok: false,
      reasons: c.untranslated.map((u) => ({ step: u.step ?? "", what: u.what, reason: u.reason })),
      changes: c.changes,
    };
  // The translator lowers every «Sí» already; asked again here, so this file alone keeps decision 13.
  return { ok: true, automation: lowerYes(c.automation), changes: c.changes };
}

/** A problem that would stop publishing the running version, as a reason to keep the flow. */
const blockedReason = (p: Problem): ConversionReason => ({
  step: p.step ?? "",
  what: p.code,
  reason: "blocked",
});

/**
 * One flow (see the top of this file), or nothing when it is not the conversion's or was reached before. A flow
 * `kept` before is tried again: the translator may know more now.
 */
export function convertFlow(store: UserStore, id: string, now: number): FlowOutcome {
  const j = store.journal;
  const before = j.flowConversion(id);
  if (before && before.state !== "kept") return { id, state: "already" };
  const versions = j.flowVersions(id);
  const latest = versions[0];
  const why = leftOut(versions);
  if (!latest || why) return { id, state: "left", why: why ?? "trigger" };
  const running = translate(latest);
  const keep = (reasons: ConversionReason[], skipped: number, changes: Change[]): FlowOutcome => {
    const same =
      before &&
      before.skipped === skipped &&
      JSON.stringify(before.reasons) === JSON.stringify(reasons) &&
      JSON.stringify(before.changes) === JSON.stringify(changes);
    if (!same) j.keepFlow(id, now, { reasons, skipped, changes });
    return same ? { id, state: "already" } : { id, state: "kept", reasons, skipped, changes };
  };
  if (!running.ok) return keep(running.reasons, versions.length - 1, running.changes);
  const blocks = [
    ...publishChecks(running.automation, contextOf(store, id, {})).blocks,
    ...blocking(running.automation, aiProblems(store, running.automation)),
  ];
  if (blocks.length) return keep(blocks.map(blockedReason), versions.length - 1, running.changes);
  // Every version that translates whole, oldest first; the running one is the last.
  const named = collectionNamed(store);
  const adopted: AdoptedVersion[] = [];
  let skipped = 0;
  for (const v of [...versions].reverse()) {
    const t = v === latest ? running : translate(v);
    if (!t.ok) {
      skipped++;
      continue;
    }
    const n = adopted.length + 1;
    adopted.push({
      flow: v.version,
      doc: JSON.stringify({ ...t.automation, version: n }),
      hash: docHash(t.automation),
      at: v.created,
      by: v.by,
      names: JSON.stringify(keptNames(t.automation, named)),
    });
  }
  const draft = lowerYes(running.automation);
  const last = j.flowRuns(id).last;
  const done = j.adoptFlow({
    id,
    by: latest.by,
    created: versions[versions.length - 1]?.created ?? latest.created,
    at: now,
    draft: {
      name: latest.name,
      trigger: triggerOf(draft),
      doc: JSON.stringify(draft),
      device: null,
      updated: now,
    },
    versions: adopted,
    enabled: latest.enabled,
    schedule: scheduleColumn(running.automation),
    // AU-226: as the old scheduler counted (flowScheduler.ts `dueSlot`): after the save and after its last run.
    since: Math.max(latest.created, last ?? 0),
    skipped,
    changes: running.changes,
  });
  if (!done) return { id, state: "already" };
  return { id, state: "converted", versions: adopted.length, skipped, changes: running.changes };
}

/** Every flow of the store (see the top of this file), each in its own transaction. */
export function convertFlows(store: UserStore, now: number): FlowOutcome[] {
  return store.journal.flows().map((f) => convertFlow(store, f.id, now));
}

/**
 * The runs of before of every converted flow not copied yet, `COPY_CHUNK` at a time with the server free between
 * chunks (`setImmediate`); `alive` stops it when the store was closed. Resolves with how many were copied.
 */
export async function copyBeforeRuns(
  store: UserStore,
  now: number,
  alive: () => boolean = () => true,
): Promise<number> {
  let copied = 0;
  if (!alive()) return copied;
  for (const c of store.journal.flowConversions()) {
    if (c.state !== "converted" || c.copied !== null) continue;
    for (;;) {
      if (!alive()) return copied;
      const n = store.journal.copyBeforeRuns(c.id, COPY_CHUNK, now);
      copied += n;
      if (n === 0) break;
      await new Promise((r) => setImmediate(r));
    }
  }
  return copied;
}

/** «Volver al flujo de antes» (decision 21): false when the flow was not converted. */
export const revertFlow = (store: UserStore, id: string, now: number): boolean =>
  store.journal.revertFlow(id, now);

/** «Convertir otra vez»: `changed` when the flow got a version while it ran as before, `no` when not reverted. */
export const reconvertFlow = (store: UserStore, id: string, now: number) =>
  store.journal.reconvertFlow(id, now);

/**
 * What the conversion would do, for the deploy to read on a copy of a store before the real one (`boni conversion`,
 * cli.ts): counts, step types, the keys of «Lo que cambia» and why each kept flow stays; flows by their order, never
 * a name, a text or a value of the person's. `replay`: whether a flow's last run can be given again to its automation
 * («Probar»): one by the clock (its hour is the input), or by hand with no form; a form's answers are not kept with
 * the runs of before (`runs` keeps only the mail that started one), so those flows say `inputsNotKept`.
 */
export interface ConversionReport {
  flows: number;
  converted: number;
  kept: number;
  left: number;
  versions: number;
  skipped: number;
  runsToCopy: number;
  stepTypes: Record<string, number>;
  changes: Record<string, number>;
  reasons: Record<string, number>;
  replay: Record<"byClock" | "byHand" | "inputsNotKept" | "neverRan", number>;
  each: {
    n: number;
    state: FlowOutcome["state"];
    trigger: "manual" | "schedule" | "other";
    versions: number;
    runs: number;
    steps: string[];
    reasons: string[];
  }[];
}

/** Runs the conversion on `store` (a copy: it writes) and words what it did as `ConversionReport`. */
export function conversionReport(store: UserStore, now: number): ConversionReport {
  const r: ConversionReport = {
    flows: 0,
    converted: 0,
    kept: 0,
    left: 0,
    versions: 0,
    skipped: 0,
    runsToCopy: 0,
    stepTypes: {},
    changes: {},
    reasons: {},
    replay: { byClock: 0, byHand: 0, inputsNotKept: 0, neverRan: 0 },
    each: [],
  };
  const add = (m: Record<string, number>, k: string) => {
    m[k] = (m[k] ?? 0) + 1;
  };
  store.journal.flows().forEach((f, i) => {
    r.flows++;
    const o = convertFlow(store, f.id, now);
    const t = f.trigger as { manual?: unknown; schedule?: unknown } | null;
    const trigger = t?.manual === true ? "manual" : t?.schedule ? "schedule" : "other";
    const runs = store.journal.flowRuns(f.id).runs;
    const row: ConversionReport["each"][number] = {
      n: i + 1,
      state: o.state,
      trigger,
      versions: store.journal.flowVersions(f.id).length,
      runs,
      steps: [],
      reasons: [],
    };
    if (o.state === "converted") {
      r.converted++;
      r.versions += o.versions;
      r.skipped += o.skipped;
      r.runsToCopy += runs;
      for (const c of o.changes) add(r.changes, c);
      const doc = store.journal.automationDraft(f.id)?.doc;
      const a = doc ? (JSON.parse(doc) as Automation) : null;
      row.steps = (a?.steps ?? []).map((s) => s.type);
      for (const s of row.steps) add(r.stepTypes, s);
      const inputs = trigger === "manual" ? (runnableNames(f.trigger) ?? []) : [];
      add(
        r.replay,
        runs === 0
          ? "neverRan"
          : trigger === "schedule"
            ? "byClock"
            : inputs.length
              ? "inputsNotKept"
              : "byHand",
      );
    } else if (o.state === "kept") {
      r.kept++;
      r.skipped += o.skipped;
      row.reasons = o.reasons.map((x) => `${x.what}:${x.reason}`);
      for (const x of row.reasons) add(r.reasons, x);
    } else if (o.state === "left") {
      r.left++;
      row.reasons = [o.why];
      add(r.reasons, o.why);
    }
    r.each.push(row);
  });
  return r;
}

/** What a stand-in of the dry report is asked when a run would call a model: never, in a conversion. */
const noCall = (): never => {
  throw new Error("conversion-check: no model is called");
};

/**
 * The server's wiring of Boni's code and «Modelos» (main.ts) as the dry report needs it, with no agent made and no
 * sealed key read (`boni conversion-check`, cli.ts): so `publishChecks` sees what it sees on the server, and a flow
 * with a Boni step or a reader converts in the report as it would at the deploy. Boni is reached, as for every
 * account; AI steps are step types (`ai`). A step that names a model of its own would ask «Modelos» for it, which
 * needs the account's keys: the stand-in answers that it does not answer, so such a flow shows as kept (blocked) in
 * the report, the cautious side; the conversion of S1 names no model on any step. Returns the undoing.
 */
export function wireDryConversion(account: number): () => void {
  wireBoni({ reaches: () => true, agentOf: noCall });
  const models: AutomationModels["models"] = {
    stepProvider: noCall,
    overBudget: noCall,
    resolveModel: () => ({ refused: "no-model" }),
    offered: () => false,
  };
  wireAutomationModels({ models, accountOf: () => account });
  return () => {
    wireBoni(null);
    wireAutomationModels(null);
  };
}
