/**
 * The day's cap of an automation that starts with a mail (docs/automatizaciones.md §5.17, AU-253): «Llega un correo»
 * is its outside, so a mailbox full of mail cannot spend his models. Each automation whose trigger is «Llega un
 * correo» gets 150 model calls a day, and 20 a day for each sender, counted before each call (the journal's
 * `spend`, under the automation's id and the sender's address, by the civil day of his zone). Past it no model is
 * called (`daily-cap`), and the mail's code starts no run: the mail waits in its queue (up to 500) for the next day.
 */

import type { Automation } from "@boni/automations";
import { BONI_TRIGGERS, MAIL_CAP } from "@boni/automations";
import type { UserStore } from "@boni/store";
import { mailHooksOf } from "./boni.ts";
import { senderOf } from "./mailPieces.ts";

/** In the core, so the trigger's panel says the same numbers (AU-253). */
export { MAIL_CAP };

/** The civil day of `now` in `zone`, as the journal counts it. */
const dayOf = (now: number, zone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

const keysOf = (automation: string, sender: string | null) => ({
  all: `mail-cap\u0000${automation}`,
  sender: sender ? `mail-cap\u0000${automation}\u0000${sender}` : null,
});

/** Whether a run of `automation` for a mail of `sender` may still call a model today: both counts under the cap. */
export function mailCapLeft(
  store: UserStore,
  automation: string,
  sender: string | null,
  zone: string,
  now = Date.now(),
): boolean {
  const day = dayOf(now, zone);
  const k = keysOf(automation, sender);
  if (store.journal.spent(day, k.all) >= MAIL_CAP.perDay) return false;
  return !k.sender || store.journal.spent(day, k.sender) < MAIL_CAP.perSender;
}

/** The sender of the mail `id`, as the connector kept it; null without one. */
export function mailSender(store: UserStore, id: unknown): string | null {
  const hooks = mailHooksOf(store);
  if (!hooks || typeof id !== "string") return null;
  const e = store.get(id);
  if (!e || e.entity.deleted !== undefined || e.entity.type !== hooks.type) return null;
  return senderOf(e);
}

/**
 * The cap of one real run (`run`) of `doc`, when it started with «Llega un correo»: asked before every model call,
 * it counts the call it allows and refuses one past the cap. Null for any other run.
 */
export function mailCapOf(
  store: UserStore,
  id: string,
  run: string,
  doc: Automation,
  zone: string,
): (() => boolean) | null {
  const r = store.journal.automationRun(run);
  if (!r) return null;
  const trigger = doc.steps.find((s) => s.id === r.trigger);
  if (trigger?.type !== BONI_TRIGGERS.mail) return null;
  let sender: string | null = null;
  try {
    sender = mailSender(store, (JSON.parse(r.fields ?? "{}") as { id?: unknown }).id);
  } catch {
    sender = null;
  }
  const k = keysOf(id, sender);
  return () => {
    const now = Date.now();
    if (!mailCapLeft(store, id, sender, zone, now)) return false;
    const day = dayOf(now, zone);
    store.journal.spend(day, k.all, 1);
    if (k.sender) store.journal.spend(day, k.sender, 1);
    return true;
  };
}
