/**
 * The steps that talk to Juan, on the server (docs/automatizaciones.md AU-125, AU-201, AU-203, AU-246, AU-247; F15 S2
 * and P2): the `PeoplePort` the engine tells through, and what a run that waits for his answer leaves.
 *
 * - **«Avisar»** passes through the policy as a call with no recipient (`noticeDecision`, policy.ts) and goes by its
 *   «Por dónde» (AU-246, decision 29 of §10), closed lists of his own fixed in the step: a notification to the devices
 *   its «Dónde» names (`all` to the app and the phone, `desktop` to the app only, `phone` to the phone only), and a
 *   card in the Bandeja with its text and nothing to answer (`view.kind` "notice"). The account's host sends the
 *   notification (`onPeople`, agent.ts); this module names no device and no person. Its text is plain, cut by the
 *   engine.
 * - **«Preguntar»**: its questions live in the run that waits and are answered from it (runs.ts `answerRun`). With
 *   «Bandeja» in its «Por dónde», each question is also one card of the Bandeja (`RequestRow`, the panel of requests
 *   the flows already use), painted by code: the question as plain text with its label, its options, until when. Its
 *   `view.automation` says which run, step and question it is, so its answer goes to the run (runs.ts `answerAsk`)
 *   and not to the agent. With «Notificación», one notification per run of the step (AU-247, `notifyAsks`), which
 *   opens the run.
 *
 * Who may answer: any device signed in to the account, unless the step asks for a personal one; a speaker never
 * (`mayAnswer`, decision 26 of §10).
 */

import { EventEmitter } from "node:events";
import type { Painted, Trust } from "@boni/agent";
import {
  type AskAnswer,
  type AskRecord,
  askNotice,
  DAY_MS,
  type Execution,
  type Notice,
  type PeoplePort,
  StepFault,
  VIA_BORN,
} from "@boni/automations";
import type { Label } from "@boni/entities";
import type { UserStore } from "@boni/store";
import { noticeDecision } from "./policy.ts";

/**
 * What the account's host sends for a run's people steps: a notification (a notice's, or a waiting question's), or
 * that the Bandeja has new cards (`asked`: questions or notices).
 */
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
  /** The notice cards this run left so far: each one's place in its id. */
  let cards = 0;
  return {
    async notify(notice) {
      const d = noticeDecision(notice, own);
      // A refusal fails the step without saying which rule: nothing of it is told.
      if (d.kind !== "allow")
        throw new StepFault("the policy refused the notice", { code: "policy.denied" });
      if (notice.via.includes("notification"))
        tellPeople(store, { kind: "notice", automation: id, run, notice });
      if (run && notice.via.includes("inbox")) {
        cards += 1;
        addNoticeCard(store, run, notice, cards, Date.now());
        tellPeople(store, { kind: "asked", automation: id, run });
      }
    },
    waiting(automation) {
      const n = store.journal.automationWaiting(automation);
      return run && automation === id && store.journal.automationWait(run) ? n - 1 : n;
    },
  };
}

/**
 * A notice's text as it goes to the app and the phone: the step's own; for the one that groups the rest, «y 12 más»;
 * for a notification of several questions, «3 preguntas» (the phone has no words of its own; the server's are
 * Spanish, as notices.ts's).
 */
export const noticeText = (n: Notice): string =>
  n.questions !== undefined
    ? `${n.questions} preguntas`
    : n.more !== undefined
      ? `y ${n.more} más`
      : n.text;

/**
 * A waiting run's notification of its questions (AU-247): one per run of each «Preguntar» with «Notificación» in its
 * «Por dónde», never again for the same step however often the run waits, and it opens the run. Marks each ask it
 * looked at (`notified`) in `e`, which the caller keeps after. Gives how many it told.
 */
export function notifyAsks(
  store: UserStore,
  id: string,
  run: string,
  e: Execution,
  own: Label,
): number {
  let n = 0;
  for (const [step, ask] of waitingAsks(e)) {
    if (ask.notified) continue;
    ask.notified = true;
    const notice = askNotice(id, step, ask, own);
    // As a notice, it passes through the policy as a call with no recipient; refused, nothing is told.
    if (!notice || noticeDecision(notice, own).kind !== "allow") continue;
    tellPeople(store, { kind: "notice", automation: id, run, notice });
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- the Bandeja's cards

/** The card's control, by «Respuesta» (AU-125): the panel's choice and words, and «Sí o no» and «Varias opciones». */
const CONTROLS: Readonly<Record<AskAnswer, string>> = {
  yesNo: "yesno",
  one: "choice",
  several: "several",
  text: "text",
};

/** Where an automation's question points: the run, the «Preguntar» and its question, and what it takes. */
export interface AskPlace {
  automation: string;
  run: string;
  step: string;
  /** The question's place among the step's (`AskRecord.questions`). */
  i: number;
  answer: AskAnswer;
  /** «Solo desde un dispositivo personal» was on in its step (`AskRecord.personal`, decision 26 of §10). */
  personal?: true;
}

/**
 * Whether a device of this trust answers this question (decision 26 of docs/automatizaciones.md §10): any device
 * signed in to the account, personal or shared, unless its step asks for a personal one. A speaker (`ambient`) never
 * does: it speaks, never confirms. The list of cards and a run's view say it (`mayAnswer`), so the screen keeps no
 * rule of its own.
 */
export const mayAnswer = (place: Pick<AskPlace, "personal">, trust: Trust): boolean =>
  trust === "personal" || (trust === "shared" && !place.personal);

/** The card's id: one per question of a run, the same however often the run waits again. */
export const askCardId = (run: string, step: string, i: number): string => `${run}~${step}~${i}`;

const painted = (value: string, label: Label): Painted => ({
  t: "v",
  value,
  integrity: label.integrity,
  sensitivity: label.sensitivity,
});

/** Where a card of the Bandeja points, when it is an automation's question; null for any other. */
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
 * The cards of a run that waits (AU-125, AU-203): with «Bandeja» in its step's «Por dónde» (AU-246; a step kept
 * before it has both), one per question not yet in the Bandeja, painted by code, each waiting until its step's limit.
 * Gives how many it added.
 */
export function addAskCards(
  store: UserStore,
  id: string,
  run: string,
  e: Execution,
  now: number,
): number {
  let added = 0;
  for (const [step, ask] of waitingAsks(e)) {
    if (!(ask.via ?? VIA_BORN.ask).includes("inbox")) continue;
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
          automation: {
            automation: id,
            run,
            step,
            i,
            answer: ask.answer,
            ...(ask.personal ? { personal: true as const } : {}),
          } satisfies AskPlace,
        },
        created: now,
        expires: ask.until,
      });
      added++;
    });
  }
  if (added) tellPeople(store, { kind: "asked", automation: id, run });
  return added;
}

/**
 * A run's cards still in the Bandeja, ended as `status`: `cancelled` when Juan cancelled the run (decision 27 of §10),
 * `expired` when a limit passed or the run stopped waiting for them, `dismissed` when its step had its answers.
 */
export function endAskCards(
  store: UserStore,
  run: string,
  status: "expired" | "dismissed" | "cancelled",
  now: number,
  only?: (place: AskPlace) => boolean,
): void {
  for (const r of store.journal.requests("pending")) {
    if (r.run !== run) continue;
    const place = askPlace(r.view);
    if (place && (!only || only(place))) store.journal.setRequest(r.id, status, now);
  }
}

// ---------------------------------------------------------------- a notice's card (AU-246)

/**
 * How long a notice's card stays in the Bandeja unless Juan puts it away: as long as a question may wait at most
 * (AU-203's 30 days), so nothing stays there for ever.
 */
export const NOTICE_CARD_DAYS = 30;

/** Where a notice's card points: the run and the «Avisar» that left it. */
export interface NoticePlace {
  automation: string;
  run: string;
  step: string;
}

/** The card's id: the run, the step and its place among the cards the run left. */
export const noticeCardId = (run: string, step: string, n: number): string =>
  `${run}~${step}~n${n}`;

/** Where a notice's card of the Bandeja points; null for any other card. */
export function noticePlace(view: unknown): NoticePlace | null {
  if (!view || typeof view !== "object" || (view as { kind?: unknown }).kind !== "notice")
    return null;
  const a = (view as { automation?: unknown }).automation;
  if (!a || typeof a !== "object") return null;
  const p = a as Record<string, unknown>;
  return typeof p.automation === "string" && typeof p.run === "string" && typeof p.step === "string"
    ? { automation: p.automation, run: p.run, step: p.step }
    : null;
}

/** Who puts a notice's card away (decision 26 of §10, as a question's): any device of the account, never a speaker. */
export const mayDismissNotice = (trust: Trust): boolean =>
  trust === "personal" || trust === "shared";

/**
 * A notice's card in the Bandeja (AU-246): its text, painted by code as plain text with its label (the app words the
 * one that groups the rest, `more`), and nothing to answer. It stays until put away, or `NOTICE_CARD_DAYS`.
 */
export function addNoticeCard(
  store: UserStore,
  run: string,
  n: Notice,
  k: number,
  now: number,
): void {
  const id = noticeCardId(run, n.step, k);
  if (store.journal.request(id)) return;
  store.journal.addRequest({
    id,
    run,
    view: {
      kind: "notice",
      id,
      prompt: painted(n.text, n.label),
      ...(n.more !== undefined ? { more: n.more } : {}),
      automation: { automation: n.automation, run, step: n.step } satisfies NoticePlace,
    },
    created: now,
    expires: now + NOTICE_CARD_DAYS * DAY_MS,
  });
}
