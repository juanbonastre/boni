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
 *
 * **Boni's own (F16 S2c, AU-221, AU-226).** Boni's flows are not converted at the opening: the code that starts each
 * converts it (`convertBoniFlows`, several in one transaction or none) when it brings it up to date, as only it knows
 * when (models.ts for «Aviso del presupuesto»). Each is translated with Boni's triggers and pieces
 * (`planToAutomation`'s `boni`, `bound`), every version whoever saved it, and the automation is Boni's
 * (`BONI_AUTHOR`). From then on Boni's version follows what its code makes (`followBoniFlow`): a new version, Boni's,
 * published only while the one that runs is Boni's too, so a version Juan published stays as he left it; its «Sí»
 * lowered against the one that runs (`lowerYes`), so none is ever born.
 */

import { type Change, type Plan, planToAutomation, runnableNames } from "@boni/agent";
import {
  type Automation,
  type BoniAutomation,
  blocking,
  keptNames,
  lowerYes,
  type Problem,
  parseAutomation,
  publishChecks,
} from "@boni/automations";
import type {
  AdoptedVersion,
  ConversionReason,
  FlowAdoption,
  FlowRow,
  UserStore,
} from "@boni/store";
import { type AutomationModels, wireAutomationModels } from "./ai.ts";
import { BONI_AUTHOR, onNewEngine, wireBoni } from "./boni.ts";
import { collectionNamed } from "./collections.ts";
import { aiProblems, contextOf, docHash } from "./publish.ts";
import { scheduleColumn } from "./scheduler.ts";
import { publishedOf, triggerOf } from "./service.ts";

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

/**
 * How one of Boni's own flows is translated (F16 S2c): which of Boni's automations it is, as the caller knows it from
 * where the flow is stored. The names its code binds are the flow version's own inputs (`FlowRow.inputs`).
 */
export interface BoniFlow {
  id: string;
  boni: BoniAutomation;
}

/** Why a flow is not the conversion's, or null when it is. Boni's are, whoever saved a version and whatever starts them. */
function leftOut(versions: readonly FlowRow[], b?: BoniFlow): "notTheUsers" | "trigger" | null {
  if (b) return versions.length ? null : "trigger";
  if (versions.some((v) => v.by !== "user")) return "notTheUsers";
  const latest = versions[0];
  if (!latest || runnableNames(latest.trigger) === null) return "trigger";
  return null;
}

/** The names a flow version's code binds: its inputs (flows.ts `inputsOf`), each a field of its trigger's row. */
const boundOf = (f: FlowRow): string[] =>
  (Array.isArray(f.inputs) ? (f.inputs as { id?: unknown }[]) : [])
    .map((i) => i.id)
    .filter((id): id is string => typeof id === "string");

/** A flow version as an automation, its «Sí» lowered, or why it has no step for some of its plan. */
function translate(
  f: FlowRow,
  b?: BoniFlow,
):
  | { ok: true; automation: Automation; changes: Change[] }
  | { ok: false; reasons: ConversionReason[]; changes: Change[] } {
  const c = planToAutomation({
    id: f.id,
    name: f.name,
    plan: f.plan as Plan,
    trigger: f.trigger,
    from: "flow",
    ...(b ? { boni: b.boni, bound: boundOf(f) } : {}),
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

/** What a Boni step validates with while its automation is not stored yet: the one the caller named (`BoniFlow`). */
function checksOf(store: UserStore, id: string, b?: BoniFlow) {
  const c = contextOf(store, id, {});
  return b && c.boni ? { ...c, boni: { automation: b.boni } } : c;
}

/**
 * One flow (see the top of this file), or nothing when it is not the conversion's or was reached before. A flow
 * `kept` before is tried again: the translator may know more now.
 */
export function convertFlow(store: UserStore, id: string, now: number): FlowOutcome {
  const p = prepareFlow(store, id, now);
  if (!("adoption" in p)) return p;
  // No «Sí» arrives but by his hand (AU-188, decision 13): the draft is lowered where it is written.
  const adoption = withDraft(p, lowerYes(p.running));
  return store.journal.adoptFlow(adoption) ? p.outcome : { id, state: "already" };
}

/**
 * Boni's flows that go together (AU-226), converted in one transaction or none:
 * while one of them stays (it does not translate whole, or a check would block it), every other stays too, on the
 * engine of before, and nothing is written but the kept one's row. Repeatable as `convertFlow`.
 */
export function convertBoniFlows(
  store: UserStore,
  flows: readonly BoniFlow[],
  now: number,
): FlowOutcome[] {
  const prepared = flows.map((b) => prepareFlow(store, b.id, now, b));
  const adopt = prepared.filter((p) => "adoption" in p);
  if (!adopt.length || adopt.length + prepared.filter(isAlready).length !== prepared.length)
    return prepared.map((p) => ("adoption" in p ? { id: p.outcome.id, state: "already" } : p));
  store.batch(() => {
    // As `convertFlow`: each draft lowered where it is written (AU-188).
    for (const p of adopt)
      if (!store.journal.adoptFlow(withDraft(p, lowerYes(p.running))))
        throw new Error(`${p.adoption.id} was converted meanwhile: none is`);
  });
  return prepared.map((p) => ("adoption" in p ? p.outcome : p));
}

const isAlready = (p: FlowOutcome | Prepared) => !("adoption" in p) && p.state === "already";

/** A conversion ready to write: all of it but its draft, which the writer lowers (`lowerYes`) and adds. */
interface Prepared {
  adoption: Omit<FlowAdoption, "draft">;
  name: string;
  running: Automation;
  outcome: FlowOutcome;
}

/** The adoption with its draft: `draft`, the running document as the writer lowered it. */
const withDraft = (p: Prepared, draft: Automation): FlowAdoption => ({
  ...p.adoption,
  draft: {
    name: p.name,
    trigger: triggerOf(draft),
    doc: JSON.stringify(draft),
    device: null,
    updated: p.adoption.at,
  },
});

/** What converting one flow would write, or what it came to when there is nothing to write (a `kept` row is). */
function prepareFlow(
  store: UserStore,
  id: string,
  now: number,
  b?: BoniFlow,
): FlowOutcome | Prepared {
  const j = store.journal;
  const before = j.flowConversion(id);
  if (before && before.state !== "kept") return { id, state: "already" };
  const versions = j.flowVersions(id);
  const latest = versions[0];
  const why = leftOut(versions, b);
  if (!latest || why) return { id, state: "left", why: why ?? "trigger" };
  const running = translate(latest, b);
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
    ...publishChecks(running.automation, checksOf(store, id, b)).blocks,
    ...blocking(running.automation, aiProblems(store, running.automation)),
  ];
  if (blocks.length) return keep(blocks.map(blockedReason), versions.length - 1, running.changes);
  // Every version that translates whole, oldest first; the running one is the last.
  const named = collectionNamed(store);
  const adopted: AdoptedVersion[] = [];
  let skipped = 0;
  for (const v of [...versions].reverse()) {
    const t = v === latest ? running : translate(v, b);
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
  const last = j.flowRuns(id).last;
  const adoption: Omit<FlowAdoption, "draft"> = {
    id,
    // Boni's are Boni's whoever saved the version that runs (`boniOf`); a person's, the person's.
    by: b ? BONI_AUTHOR : latest.by,
    created: versions[versions.length - 1]?.created ?? latest.created,
    at: now,
    versions: adopted,
    enabled: latest.enabled,
    schedule: scheduleColumn(running.automation),
    // AU-226: as the old scheduler counted (flowScheduler.ts `dueSlot`): after the save and after its last run.
    since: Math.max(latest.created, last ?? 0),
    skipped,
    changes: running.changes,
  };
  return {
    adoption,
    name: latest.name,
    running: running.automation,
    outcome: {
      id,
      state: "converted",
      versions: adopted.length,
      skipped,
      changes: running.changes,
    },
  };
}

/**
 * Boni's converted flow kept current with what its code makes today (F16 S2c): the flow's
 * latest version (flows.ts `ensureFlow` keeps saving Boni's there) translated as at the conversion. Published as a
 * new version by Boni only when the one that runs is Boni's and is not that same document, its «Sí» lowered against
 * the one that runs (`lowerYes`: nothing that was «Preguntar» becomes «Sí»); the draft follows only while it was the
 * running document. A version Juan published runs as he left it, and nothing is written. What it did: `published`,
 * `same`, `his` (Juan's runs), or `not` (not converted, or the version does not translate whole or would be blocked).
 */
export function followBoniFlow(
  store: UserStore,
  b: BoniFlow,
  now: number,
): "published" | "same" | "his" | "not" {
  const j = store.journal;
  if (j.flowConversion(b.id)?.state !== "converted") return "not";
  const row = j.automation(b.id);
  if (!row || row.deleted || row.by !== BONI_AUTHOR) return "not";
  const running = publishedOf(store, b.id);
  const runningInfo = j.automationVersions(b.id).find((v) => v.n === row.published);
  if (!running || !runningInfo) return "not";
  if (runningInfo.by !== BONI_AUTHOR) return "his";
  // Only a version of Boni's code is followed: one saved by a person is never published as Boni's.
  const latest = j.flowVersions(b.id)[0];
  if (!latest || latest.by !== "preset") return "not";
  const t = translate(latest, b);
  if (!t.ok) return "not";
  const next = lowerYes(t.automation, running.automation);
  if (docHash(next) === running.hash) return "same";
  const blocks = [
    ...publishChecks(next, contextOf(store, b.id, running.names)).blocks,
    ...blocking(next, aiProblems(store, next)),
  ];
  if (blocks.length) return "not";
  const draft = j.automationDraft(b.id);
  const n = (j.automationVersions(b.id)[0]?.n ?? 0) + 1;
  store.batch(() => {
    j.publishAutomation(
      {
        id: b.id,
        doc: JSON.stringify({ ...next, version: n }),
        hash: docHash(next),
        at: now,
        device: null,
        by: BONI_AUTHOR,
        names: JSON.stringify(keptNames(next, collectionNamed(store))),
      },
      n,
      scheduleColumn(next),
    );
    // A draft Juan changed stays his; one that was the running document follows it.
    if (draft && docHash(parseAutomation(JSON.parse(draft.doc))) === running.hash)
      j.saveAutomationDraft({
        id: b.id,
        name: next.name,
        trigger: triggerOf(next),
        doc: JSON.stringify({ ...next, version: 0 }),
        device: null,
        updated: now,
      });
  });
  return "published";
}

/**
 * Boni's flows that go together, converted (`convertBoniFlows`) while one is not yet, then each kept current
 * (`followBoniFlow`): what the code that starts them calls when it brings them up to date. A flow Juan sent back
 * («Volver al flujo de antes») stays on the engine of before; one that could not convert is tried again next time.
 */
export function keepBoniFlows(store: UserStore, flows: readonly BoniFlow[], now: number): void {
  if (flows.some((f) => !onNewEngine(store, f.id))) convertBoniFlows(store, flows, now);
  for (const f of flows) followBoniFlow(store, f, now);
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
