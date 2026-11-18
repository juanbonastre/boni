/**
 * The steps that talk to Juan, on the server (docs/automatizaciones.md AU-125, AU-201, AU-203; F15 S2): the
 * `PeoplePort` the engine tells through, and what a run that waits for his answer leaves in the Bandeja.
 *
 * - **«Avisar»** passes through the policy as a call with no recipient (`noticeDecision`, policy.ts) and goes to the
 *   devices its «Dónde» names as saved, a closed list of his own: `all` to the app and the phone, `desktop` to the
 *   app only, `phone` to the phone only. The account's host sends it (`onPeople`, agent.ts); this module names no
 *   device and no person. Its text is plain, cut by the engine.
 * - **«Preguntar»**: each question of a waiting step is one card of the Bandeja (`RequestRow`, the panel of requests
 *   the flows already use), painted by code: the question as plain text with its label, its options, until when.
 *   Its `view.automation` says which run, step and question it is, so its answer goes to the run (runs.ts
 *   `answerAsk`) and not to the agent. No new path: the app's and the phone's lists of paths stay as they are.
 *
 * Who may answer: a personal device only, as accepting a proposal (AU-193, decision 13). A shared device reads the
 * card and cannot answer it or put it away.
 */

import { EventEmitter } from "node:events";
import type { Painted } from "@boni/agent";
import {
  type AskAnswer,
  type AskRecord,
  type Execution,
  type Notice,
  type PeoplePort,
  StepFault,
} from "@boni/automations";
import type { Label } from "@boni/entities";
import type { UserStore } from "@boni/store";
import { noticeDecision } from "./policy.ts";

/** What the account's host sends for a run's people steps: a notice, or that the Bandeja has new questions. */
export type PeopleEvent =
  | { kind: "notice"; automation: string; run: string | null; notice: Notice }
  | { kind: "asked"; automation: string; run: string };

const channels = new WeakMap<UserStore, EventEmitter>();
function channelOf(store: UserStore): EventEmitter {
  let c = channels.get(store);
  if (!c) {
    c = new EventEmitter();
    c.setMaxListeners(0);
    channels.set(store, c);
  }
  return c;
}

/** Listens to what a store's runs tell Juan; gives what stops listening. */
export function onPeople(store: UserStore, listener: (e: PeopleEvent) => void): () => void {
  const c = channelOf(store);
  c.on("people", listener);
  return () => c.off("people", listener);
}
export const tellPeople = (store: UserStore, e: PeopleEvent): void =>
  void channelOf(store).emit("people", e);

/**
 * The engine's port for one run (or one test) of `id`. `run`: the run it is, null in a test (whose notices the
 * engine never sends). `waiting` counts the real runs of an automation that wait now, the run itself left out.
 */
export function peoplePort(
  store: UserStore,
  id: string,
  own: Label,
  run: string | null,
): PeoplePort {
  return {
    async notify(notice) {
      const d = noticeDecision(notice, own);
      // A refusal fails the step without saying which rule: nothing of it is told.
      if (d.kind !== "allow")
        throw new StepFault("the policy refused the notice", { code: "policy.denied" });
      tellPeople(store, { kind: "notice", automation: id, run, notice });
    },
    waiting(automation) {
      const n = store.journal.automationWaiting(automation);
      return run && automation === id && store.journal.automationWait(run) ? n - 1 : n;
    },
  };
}

/**
 * A notice's text as it goes to the app and the phone: the step's own, or, for the one that groups the rest, «y 12
 * más» (the phone has no words of its own; the server's are Spanish, as notices.ts's).
 */
export const noticeText = (n: Notice): string =>
  n.more !== undefined ? `y ${n.more} más` : n.text;

// ---------------------------------------------------------------- the Bandeja's cards

/** The card's control, by «Respuesta» (AU-125): the panel's choice and words, and «Sí o no» and «Varias opciones». */
const CONTROLS: Readonly<Record<AskAnswer, string>> = {
  yesNo: "yesno",
  one: "choice",
  several: "several",
  text: "text",
};

/** Where an automation's card points: the run, the «Preguntar» and its question, and what it takes. */
export interface AskPlace {
  automation: string;
  run: string;
  step: string;
  /** The question's place among the step's (`AskRecord.questions`). */
  i: number;
  answer: AskAnswer;
}

/** The card's id: one per question of a run, the same however often the run waits again. */
export const askCardId = (run: string, step: string, i: number): string => `${run}~${step}~${i}`;

const painted = (value: string, label: Label): Painted => ({
  t: "v",
  value,
  integrity: label.integrity,
  sensitivity: label.sensitivity,
});

/** Where a card of the Bandeja points, when it is an automation's; null for any other (a flow's, the agent's). */
export function askPlace(view: unknown): AskPlace | null {
  if (!view || typeof view !== "object") return null;
  const a = (view as { automation?: unknown }).automation;
  if (!a || typeof a !== "object") return null;
  const p = a as Record<string, unknown>;
  return typeof p.automation === "string" &&
    typeof p.run === "string" &&
    typeof p.step === "string" &&
    typeof p.i === "number" &&
    typeof p.answer === "string" &&
    p.answer in CONTROLS
    ? (p as unknown as AskPlace)
    : null;
}

/** The steps of a waiting execution that wait, with what each asks. */
export function waitingAsks(e: Execution): [string, AskRecord][] {
  return Object.entries(e.steps).flatMap(([step, r]) =>
    r.state === "waiting" && r.ask && !r.ask.ended ? [[step, r.ask] as [string, AskRecord]] : [],
  );
}

/** The earliest instant one of a waiting execution's questions stops waiting. */
export const untilOf = (e: Execution): number =>
  Math.min(...waitingAsks(e).map(([, a]) => a.until));

/**
 * The cards of a run that waits (AU-125, AU-203): one per question not yet in the Bandeja, painted by code, each
 * waiting until its step's limit. Gives how many it added.
 */
export function addAskCards(
  store: UserStore,
  id: string,
  run: string,
  e: Execution,
  now: number,
): number {
  let added = 0;
  for (const [step, ask] of waitingAsks(e))
    ask.questions.forEach((q, i) => {
      const card = askCardId(run, step, i);
      if (store.journal.request(card)) return;
      store.journal.addRequest({
        id: card,
        run,
        view: {
          kind: "ask",
          id: card,
          control: CONTROLS[ask.answer],
          prompt: painted(q.text, q.label),
          options: (q.options ?? []).map((o) => painted(o.value, o.label)),
          automation: { automation: id, run, step, i, answer: ask.answer } satisfies AskPlace,
        },
        created: now,
        expires: ask.until,
      });
      added++;
    });
  if (added) tellPeople(store, { kind: "asked", automation: id, run });
  return added;
}

/** A run's cards still in the Bandeja, ended as `status`: the run was cancelled, or a limit passed. */
export function endAskCards(
  store: UserStore,
  run: string,
  status: "expired" | "dismissed",
  now: number,
  only?: (place: AskPlace) => boolean,
): void {
  for (const r of store.journal.requests("pending")) {
    if (r.run !== run) continue;
    const place = askPlace(r.view);
    if (place && (!only || only(place))) store.journal.setRequest(r.id, status, now);
  }
}
