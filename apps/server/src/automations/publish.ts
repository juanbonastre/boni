/**
 * «Publicar», «Versiones», the switch and «Eliminadas» on the server (docs/automatizaciones.md §5.8, phase F14d S1:
 * AU-95, AU-96, AU-98, AU-182, AU-188, AU-191, AU-194). A draft never runs for real: only a published version does,
 * and `runPublished` is the one function that runs one for real (and `resumePublished` the one that goes on with a
 * run that waited for an answer, AU-203). They take the automation's id, never a document:
 * the document it runs and the «Sí» its policy reads both come from the version the store keeps (A-37).
 *
 * What a publish does, in order (AU-95, AU-96):
 * 1. Only from a personal device (decision 13 of §10): setting a «Sí» and publishing are his hand's; a shared one
 *    looks and tests. The route refuses it before the action (http.ts), and this refuses it again.
 * 2. The draft's `rev` the screen shows: a draft changed since by another device is not published (`stale`).
 * 3. The same document as the one that runs (by its print) is nothing to publish (`unchanged`).
 * 4. `publishChecks` over the collections of today, with the names the running version kept (AU-192, `keptKey`): a
 *    problem on a step a trigger reaches stops it (`blocked`, with the problems), whatever the app sent.
 * 5. One new row of `automation_versions`, that never changes, with the document as it will run (its `version` is
 *    its number) and the names its code cites (`keptNames`); it becomes the one that runs, and the first one turns
 *    the switch on (AU-194, decision 12).
 * «Volver a esta» (AU-98) is the same publish with an old version's document instead of the draft: the draft is not
 * touched, and the old version keeps its «Sí», which «Publicar» shows before (decision 13).
 */

import { codeLabel, type Trust } from "@boni/agent";
import {
  type Ability,
  AGENT_TYPE,
  type Automation,
  type AutomationDiff,
  abilities,
  type Box,
  blocking,
  CannotRun,
  type Cell,
  type CodeContext,
  type CodeProblem,
  diffAutomations,
  type Execution,
  type GivenAnswer,
  isReaderType,
  type KeptNames,
  keptNames,
  type Look,
  lowerYes,
  type Problem,
  parseAutomation,
  publishChecks,
  type RunDeps,
  resume,
  run as runAutomation,
  type StartedBy,
  stepPrints,
} from "@boni/automations";
import type { AutomationVersionInfo, UserStore } from "@boni/store";
import { handLabel } from "../actions.ts";
import { modelsOf } from "./ai.ts";
import { sandboxBox } from "./box.ts";
import { collectionNamed, reachStore, storeCollections } from "./collections.ts";
import { pausedDoc } from "./learning.ts";
import { cancelWaits } from "./runs.ts";
import { scheduleColumn } from "./scheduler.ts";
import {
  automationLabel,
  BAD,
  type Hand,
  isError,
  keptTests,
  NOT_FOUND,
  open,
  publishedOf,
  runDeps,
  type ServiceError,
  sha256,
  testedFields,
} from "./service.ts";

/** The print of a document as a version keeps it: its JSON with `version` 0, so a draft and a version compare. */
export const docHash = (a: Automation): string => sha256(JSON.stringify({ ...a, version: 0 }));

/** Why a publish, a switch or a run for real did nothing, beside the service's own errors. */
export type Refusal =
  /** Not from a personal device (decision 13). */
  | { refused: "not-personal" }
  /** The draft changed since the screen read it: its `rev` now. */
  | { refused: "stale"; rev: number }
  /** The same document as the one that runs. */
  | { refused: "unchanged" }
  /** A problem on a step a trigger reaches (AU-96). */
  | { refused: "blocked"; problems: Problem[] }
  /** Never published: nothing to switch on or to run. */
  | { refused: "unpublished" }
  /** Off (AU-194): no run starts for real. */
  | { refused: "off" }
  /** The run did not start: the trigger, or a field of it, is not the version's (`CannotRun`). */
  | { refused: "invalid"; problems: Problem[] };

const refused = (x: unknown): x is Refusal => typeof x === "object" && x !== null && "refused" in x;

/** The key of a collection by its type id and back, from the schema of now. */
function schemaKeys(store: UserStore) {
  const types = Object.values(store.schema().types);
  return {
    typeOf: (key: string) => types.find((t) => t.key === key)?.id,
    nameOf: (key: string) => types.find((t) => t.key === key && !t.archived)?.name,
  };
}

/** What validating a document for publishing reads: today's collections and names, and the names a version kept. */
function contextOf(store: UserStore, id: string, kept: KeptNames): CodeContext {
  const cols = storeCollections(store, {
    actor: "user",
    device: null,
    zone: "UTC",
    own: automationLabel(id),
  });
  const keys = schemaKeys(store);
  return {
    collection: (key) => cols.shape(key),
    collectionNamed: collectionNamed(store),
    collectionName: (key) => keys.nameOf(key),
    keptKey: (step, name) => kept[step]?.[name],
    // The AI steps are step types where a model can be called (AU-57, AU-199): a server with «Modelos».
    ...(modelsOf(store) ? { ai: true } : {}),
    // «Preguntar», «Avisar» and «Responder» are step types: the server asks and tells through its port (AU-203,
    // waits.ts `peoplePort`), with or without models.
    people: true,
  };
}

/**
 * What stops publishing an AI step that only the server can tell (AU-166, AU-199, AU-241): a «Modelo» that would not
 * answer now — a model's id the gate no longer offers for the step's kind (AU-235), a tag «Sin modelo» or whose model
 * has an old evaluation (AU-238) — as `param.value` on `model` (a version already published keeps its own while its
 * key exists, PR 490 choice 6); and a collection no model may read connected to an «Agente» (`connection.notAllowed`
 * with `why: "private"`, on `connections`). Both are errors of the step; `blocking` keeps those a trigger reaches.
 */
export function aiProblems(store: UserStore, a: Automation): Problem[] {
  const m = modelsOf(store);
  if (!m) return [];
  const out: (Problem | CodeProblem)[] = [];
  const reach = reachStore(store, "UTC");
  for (const step of [...a.steps].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))) {
    const agent = step.type === AGENT_TYPE;
    if (!agent && !isReaderType(step.type)) continue;
    const model = step.params.model;
    if (typeof model === "string" && model !== "") {
      const kind = agent ? "agent" : "reading";
      const r = m.models.resolveModel(m.account, kind, model);
      if ("refused" in r || !m.models.offered(m.account, r.id, kind))
        out.push({ code: "param.value", severity: "error", step: step.id, param: "model" });
    }
    if (agent)
      for (const c of step.connections ?? [])
        if (reach.privateTo(c.collection))
          out.push({
            code: "connection.notAllowed",
            severity: "error",
            step: step.id,
            param: "connections",
            detail: { collection: c.collection, why: "private" },
          });
  }
  // A code problem goes in the same list as `publishChecks`'s own (it casts them the same way).
  return out as Problem[];
}

/**
 * Of the collections a document reads, the ones that hold a value from outside today (AU-182, AU-170): one query per
 * collection over its labels (`holdsOutside`), reading no row whole.
 */
export function outsideOf(store: UserStore, a: Automation): Set<string> {
  const keys = schemaKeys(store);
  const read = abilities(a, { collectionNamed: collectionNamed(store) })
    .filter((l) => l.action === "read")
    .map((l) => l.collection);
  const out = new Set<string>();
  for (const key of new Set(read)) {
    const type = keys.typeOf(key);
    if (type && store.journal.holdsOutside(type)) out.add(key);
  }
  return out;
}

/** What «Publicar» shows (AU-96), for the draft of now or, for «Volver a esta», for an old version's document. */
export interface PublishView {
  /** The draft's `rev` this was read with: what the publish sends back (AU-95). */
  rev: number;
  /** The number of the version that runs, or null. */
  running: number | null;
  /** Never published: publishing turns it on (AU-194). */
  first: boolean;
  /** The same document as the one that runs: nothing to publish. */
  same: boolean;
  /** What changes against the version that runs; null when none runs. */
  diff: AutomationDiff | null;
  /** What stops the publish, and what is worth a look. */
  blocks: Problem[];
  looks: Look[];
  /** «Lo que podrá hacer», with «con datos de fuera» from `outside`. */
  abilities: Ability[];
  /** The keys of the collections it reads that hold a value from outside today. */
  outside: string[];
}

/** The document a publish or its screen is about: the draft, or with `version` that version's document. */
function subjectOf(
  store: UserStore,
  id: string,
  version: number | undefined,
): { automation: Automation; rev: number; draft: boolean } | ServiceError {
  const o = open(store, id);
  if (!o) return NOT_FOUND;
  if (version === undefined) return { automation: o.automation, rev: o.draft.rev, draft: true };
  if (!Number.isInteger(version)) return BAD;
  const v = store.journal.automationVersion(id, version);
  if (!v) return NOT_FOUND;
  return { automation: parseAutomation(JSON.parse(v.doc)), rev: o.draft.rev, draft: false };
}

/** What the screen «Publicar» reads (AU-96, AU-98: `version` for «Volver a esta»). A read: it keeps nothing. */
export function publishView(
  store: UserStore,
  id: string,
  version?: number,
): PublishView | ServiceError {
  const subject = subjectOf(store, id, version);
  if (isError(subject)) return subject;
  const a = subject.automation;
  const running = publishedOf(store, id);
  const kept = keptTests(store, id);
  const prints = stepPrints(a, testedFields(store, a, kept), sha256);
  const checks = publishChecks(a, contextOf(store, id, running?.names ?? {}), {
    kept: Object.fromEntries([...kept].map(([step, t]) => [step, t.print])),
    prints,
    // A pinned output is worth a look (AU-93): a real run does not use it.
    pinned: store.journal.automationPins(id).map((p) => p.step),
  });
  checks.blocks.push(...blocking(a, aiProblems(store, a)));
  const outside = outsideOf(store, a);
  return {
    rev: subject.rev,
    running: running?.n ?? null,
    first: store.journal.automation(id)?.published === null,
    same: running !== null && running.hash === docHash(a),
    diff: running ? diffAutomations(running.automation, a) : null,
    blocks: checks.blocks,
    looks: checks.looks,
    abilities: abilities(a, { collectionNamed: collectionNamed(store), outside }),
    outside: [...outside].sort(),
  };
}

export interface PublishRequest {
  /** The draft's `rev` the screen showed. Not read with `version`: the draft is not what is published. */
  rev?: number;
  /** «Volver a esta» (AU-98): the number of the version whose document is published again, as a new one. */
  version?: number;
}

/** «Publicar» and «Volver a esta»: see the top of this file. */
export function publish(
  store: UserStore,
  id: string,
  request: PublishRequest,
  hand: Hand & { trust: Trust },
): { version: number; enabled: boolean } | Refusal | ServiceError {
  if (hand.trust !== "personal") return { refused: "not-personal" };
  if (!request || typeof request !== "object") return BAD;
  const subject = subjectOf(store, id, request.version);
  if (isError(subject)) return subject;
  if (subject.draft && request.rev !== subject.rev) {
    if (!Number.isInteger(request.rev)) return BAD;
    return { refused: "stale", rev: subject.rev };
  }
  const a = subject.automation;
  const running = publishedOf(store, id);
  if (running && running.hash === docHash(a)) return { refused: "unchanged" };
  const blocks = [
    ...publishChecks(a, contextOf(store, id, running?.names ?? {})).blocks,
    ...blocking(a, aiProblems(store, a)),
  ];
  if (blocks.length) return { refused: "blocked", problems: blocks };
  const n = (store.journal.automationVersions(id)[0]?.n ?? 0) + 1;
  const done = store.journal.publishAutomation(
    {
      id,
      doc: JSON.stringify({ ...a, version: n }),
      hash: docHash(a),
      at: hand.now,
      device: hand.device,
      by: "user",
      names: JSON.stringify(keptNames(a, collectionNamed(store))),
    },
    n,
    // Its «Programada» hours, read by the scheduler without the document; they count from now (AU-114).
    scheduleColumn(a),
  );
  return { version: done.n, enabled: done.enabled };
}

/** «Versiones» (AU-98): each version without its document, which runs, and the switch. */
export function versionsOf(
  store: UserStore,
  id: string,
): { versions: AutomationVersionInfo[]; running: number | null; enabled: boolean } | ServiceError {
  const row = store.journal.automation(id);
  if (!row || row.deleted) return NOT_FOUND;
  return {
    versions: store.journal.automationVersions(id),
    running: row.published,
    enabled: row.enabled,
  };
}

/**
 * One version to look at (AU-98): its document as it runs, who and when, and the names its code cited with the key
 * each was (AU-192, `keptNames`): the editor reads the running one's to mark a citation of the draft by a name that
 * collection no longer has (`code.collectionRenamed`) and to offer to rewrite it, as publishing would refuse it.
 */
export function versionOf(
  store: UserStore,
  id: string,
  n: number,
): (AutomationVersionInfo & { automation: Automation; names: KeptNames }) | ServiceError {
  const row = store.journal.automation(id);
  if (!row || row.deleted) return NOT_FOUND;
  if (!Number.isInteger(n)) return BAD;
  const v = store.journal.automationVersion(id, n);
  if (!v) return NOT_FOUND;
  const { doc: text, names, ...info } = v;
  return {
    ...info,
    automation: parseAutomation(JSON.parse(text)),
    names: JSON.parse(names) as KeptNames,
  };
}

/**
 * The switch (AU-194): only a published automation has one, only from a personal device. Turning it on starts
 * nothing: what was due while it was off does not run (AU-114).
 */
export function setEnabled(
  store: UserStore,
  id: string,
  enabled: boolean,
  hand: Hand & { trust: Trust },
): { enabled: boolean } | Refusal | ServiceError {
  if (hand.trust !== "personal") return { refused: "not-personal" };
  const row = store.journal.automation(id);
  if (!row || row.deleted) return NOT_FOUND;
  if (typeof enabled !== "boolean") return BAD;
  if (row.published === null) return { refused: "unpublished" };
  store.journal.setAutomationEnabled(id, enabled, hand.now);
  // Turned off, what waited for an answer is cancelled (AU-203): turning it on again starts nothing.
  if (!enabled) cancelWaits(store, id, hand.now);
  return { enabled };
}

export interface RunRequest {
  /** The trigger it starts in. */
  trigger: string;
  /** What that trigger asks, by field key, as Juan typed them: labelled as his, from his device. */
  fields: Record<string, Cell>;
}

/**
 * The one function that runs an automation for real (AU-95): its published version, read from the store, on. It
 * takes no document: whatever else a request carries never reaches the engine as the automation to run. Deleted,
 * never published or off, nothing starts (AU-191, AU-194). `run`: the run's id, which every operation it saves
 * carries in the log; the execution names the version it ran (`automation.version`). `watch.onStep` is told as each
 * step starts and ends, which is how runs.ts keeps the run as it goes (AU-99); it reaches nothing the run decides.
 */
export async function runPublished(
  store: UserStore,
  id: string,
  request: RunRequest,
  hand: Hand & { trust: Trust; zone: string },
  run: string,
  box: Box = sandboxBox(),
  watch: Pick<RunDeps, "onStep"> = {},
  startedBy: StartedBy = "user",
): Promise<Execution | Refusal | ServiceError> {
  const row = store.journal.automation(id);
  if (!row || row.deleted) return NOT_FOUND;
  if (row.published === null) return { refused: "unpublished" };
  if (!row.enabled) return { refused: "off" };
  if (
    !request ||
    typeof request.trigger !== "string" ||
    !request.fields ||
    typeof request.fields !== "object" ||
    Array.isArray(request.fields)
  )
    return BAD;
  const version = publishedOf(store, id);
  if (!version) return NOT_FOUND;
  // Its cells paused by what Boni learned ask instead (AU-210): lowered, never raised, the version as it is.
  const automation = pausedDoc(store, id, version.automation);
  try {
    return await runAutomation(
      {
        automation,
        trigger: request.trigger,
        // Typed by his hand, or the hour a «Programada» was due: the code's, not his device's.
        fields: {
          json: request.fields,
          label: startedBy === "schedule" ? codeLabel("schedule") : handLabel(hand.device),
        },
        test: false,
        startedBy,
      },
      { ...runDeps(store, id, hand, box, run, { automation, names: version.names }), ...watch },
    );
  } catch (e) {
    if (e instanceof CannotRun) return { refused: "invalid", problems: [...(e.problems ?? [])] };
    throw e;
  }
}

/** What a waiting run started with, as the store keeps it: its version's number, never a document (AU-95). */
export interface ResumeRequest {
  /** The version it started with (`automation_runs.version`). */
  version: number;
  trigger: string;
  fields: Record<string, Cell>;
  startedBy: StartedBy;
}

/**
 * The other way a run for real reaches the engine (AU-95, AU-203): a run that waited for an answer goes on, with the
 * version it started with, read from the store by its number, and the lowest «Sí» between that version's and the one
 * published now (`lowerYes`, AU-125: a step that is not the same in both asks, so waiting never keeps a «Sí» Juan
 * took back), and a cell paused since (AU-210, `pausedDoc`). Like `runPublished`, it takes no document. That version
 * gone, nothing goes on (`NOT_FOUND`); runs.ts checks the switch and the deletion before.
 */
export async function resumePublished(
  store: UserStore,
  id: string,
  request: ResumeRequest,
  hand: Hand & { trust: Trust; zone: string },
  run: string,
  going: { kept: Execution; answers: Record<string, (GivenAnswer | null)[]>; box: Box },
  watch: Pick<RunDeps, "onStep"> = {},
): Promise<Execution | ServiceError> {
  const v = store.journal.automationVersion(id, request.version);
  if (!v) return NOT_FOUND;
  const started = parseAutomation(JSON.parse(v.doc));
  // And a cell paused since it started asks too (AU-210): both only lower.
  const automation = pausedDoc(store, id, lowerYes(started, publishedOf(store, id)?.automation));
  const names = JSON.parse(v.names) as KeptNames;
  return resume(
    {
      automation,
      trigger: request.trigger,
      fields: {
        json: request.fields,
        label: request.startedBy === "schedule" ? codeLabel("schedule") : handLabel(hand.device),
      },
      test: false,
      startedBy: request.startedBy,
    },
    { ...runDeps(store, id, hand, going.box, run, { automation, names }), ...watch },
    going.kept,
    going.answers,
  );
}

export { refused as isRefusal };
