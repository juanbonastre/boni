/**
 * What a run tells when it ends (docs/automatizaciones.md AU-102, AU-167; decision 12 of §10). Only a real run that
 * started alone (`startedBy` `schedule` and not a retry: a retry is Juan's touch) tells anything; one his hand started
 * says it on its screen.
 *
 * - **A failure** (failed, interrupted, or an hour that did not run) tells once per streak: it tells when the run
 *   before it that marks the streak (store's `streakMark`) ended well, ran another version, or there is none. It goes
 *   to the app and to the phone (`AgentHost.notify`): the only thing of a run that reaches the phone.
 * - **What it saved** tells once per run, in the app only: the counts and the collections' names of its line, with
 *   «Deshacer» beside it (the screen's).
 *
 * The words are the code's: the automation's and the step's names, and the reason from a closed list by the failure's
 * code. Never the message a code threw, what «Parar con error» says, or a row's value, which may come from outside;
 * and the same words whether the row a write missed exists or not (AU-177). Every text is plain text. The notice is
 * kept with the run (`notice`), so its line says it however late the app looks.
 */

import {
  type CodeFailureCode,
  parseAutomation,
  type StepError,
  type StepFailureCode,
} from "@boni/automations";
import type { AutomationRunRow, UserStore } from "@boni/store";
import type { RunCount, RunLine } from "./runs.ts";

export type NoticeKind = "failed" | "wrote";

/** What a run told (AU-102, AU-167), as kept with it. */
export interface RunNotice {
  kind: NoticeKind;
  text: string;
}

/** A notice on the account's stream: what told it, so the app opens that run. */
export interface AutomationNotice extends RunNotice {
  automation: string;
  run: string;
}

/**
 * Why a step failed, in a few words, by its code (failures.ts, code.ts): with no parameter, so nothing a row, a code or
 * a page wrote reaches a notice. The screen says more (boni-web's `auto.failure.*`).
 */
export const NOTICE_REASONS: Record<StepFailureCode | CodeFailureCode, string> = {
  "cite.unknownStep": "cita un paso que no existe",
  "cite.notRun": "cita un paso que no se ejecutó antes",
  "cite.noRows": "un paso que cita no dio filas",
  "cite.noPair": "no se sabe qué fila de un paso citado es la suya",
  "cite.noCurrentRow": "no hay una fila actual que citar",
  "policy.denied": "Boni no lo permite",
  "policy.waits": "necesitaría tu permiso, y una lectura no puede esperar",
  "row.changed": "la fila cambió desde que se leyó",
  "row.missing": "la colección no tiene esa fila",
  "row.many": "coinciden varias filas y solo puede ser una",
  "row.notSaved": "la fila que llega no es de su colección",
  "row.matchUnwritten": "un campo para buscar no está entre los que escribe",
  "value.type": "un valor no es del tipo que hace falta",
  stopped: "lo paró «Parar con error»",
  "run.limit": "llegó a un límite de la ejecución",
  other: "el paso falló",
  "code.threw": "el código falló",
  "code.limit": "el código se pasó de un tope",
  "code.result": "el código no devuelve lo que el paso toma",
  "code.frozen": "el código cambia algo que solo puede leer",
  "code.read.notConnected": "el código lee una colección a la que el paso no está conectado",
  "code.read.query": "el código pide una lectura que no vale",
  "code.unavailable": "ahora no se puede ejecutar código",
  "code.write.unseen": "el código guarda algo que no se vio al publicar",
  "code.write.notAllowed": "la conexión no le deja guardar eso",
  "code.write.outside": "el código guarda fuera de las filas que su conexión le deja",
  "code.write.hidden": "el código guarda un campo que su conexión no le deja ver",
  "code.write.request": "el código pide guardar algo que no vale",
};

const FAILED = new Set(["failed", "interrupted", "missed"]);

/** A run that started alone, real and not a retry: the only one that tells (AU-102, AU-167). */
const alone = (r: AutomationRunRow) => !r.test && r.startedBy === "schedule" && r.retryOf === null;

/** The automation's name as the list says it (its draft's), or its version's. */
function nameOf(store: UserStore, r: AutomationRunRow, doc: { name: string } | null): string {
  return store.journal.automationDraft(r.automation)?.name || doc?.name || "Una automatización";
}

function docOf(store: UserStore, r: AutomationRunRow) {
  if (r.version === null) return null;
  const v = store.journal.automationVersion(r.automation, r.version);
  if (!v) return null;
  try {
    return parseAutomation(JSON.parse(v.doc));
  } catch {
    return null;
  }
}

/** Why it failed, by code: a code's own failure (`why`) first, then the step's; a run refused before it ran. */
function reasonOf(error: (StepError & { refused?: unknown }) | null): string {
  if (!error) return NOTICE_REASONS.other;
  if (error.refused) return "no pudo empezar";
  const code = (error.why?.code ?? error.failure?.code) as keyof typeof NOTICE_REASONS | undefined;
  return (code && NOTICE_REASONS[code]) || NOTICE_REASONS.other;
}

const rows = (n: number) => (n === 1 ? "1 fila" : `${n} filas`);
function said(c: RunCount): string {
  const where = c.name ?? c.collection;
  if (c.action === "create") return `creó ${rows(c.n)} en ${where}`;
  if (c.action === "update") return `modificó ${rows(c.n)} en ${where}`;
  return `mandó a la papelera ${rows(c.n)} de ${where}`;
}
const listed = (parts: string[]) =>
  parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}`;

/** The words of a failure (AU-102). */
function failureText(store: UserStore, r: AutomationRunRow): string {
  const doc = docOf(store, r);
  const name = nameOf(store, r, doc);
  if (r.state === "missed") return `${name} no corrió a su hora: Boni estaba apagado.`;
  const step = r.step ? doc?.steps.find((s) => s.id === r.step)?.name : undefined;
  const at = step ? ` en «${step}»` : "";
  if (r.state === "interrupted") return `${name} se cortó${at}: Boni se apagó mientras corría.`;
  let error: (StepError & { refused?: unknown }) | null = null;
  try {
    error = r.error ? JSON.parse(r.error) : null;
  } catch {
    error = null;
  }
  return `${name} falló${at}: ${reasonOf(error)}.`;
}

/** What a run that ended tells, if anything: read from what the store kept of it. */
export function noticeOf(store: UserStore, r: AutomationRunRow): RunNotice | null {
  if (!alone(r)) return null;
  if (FAILED.has(r.state)) {
    const before = store.journal.streakMark(r.id);
    const opens = !before || before.state === "done" || before.version !== r.version;
    if (opens) return { kind: "failed", text: failureText(store, r) };
  }
  let line: RunLine | null = null;
  try {
    line = r.line ? (JSON.parse(r.line) as RunLine) : null;
  } catch {
    line = null;
  }
  if (!line?.writes.length) return null;
  const name = nameOf(store, r, docOf(store, r));
  return { kind: "wrote", text: `${name} ${listed(line.writes.map(said))}.` };
}

/** Works out what a run that just ended tells and keeps it with the run; null when it tells nothing. */
export function keepNotice(store: UserStore, run: string): AutomationNotice | null {
  const r = store.journal.automationRun(run);
  if (!r || r.state === "queued" || r.state === "running") return null;
  const n = noticeOf(store, r);
  if (!n) return null;
  store.journal.setAutomationRunNotice(run, JSON.stringify(n));
  return { ...n, automation: r.automation, run };
}
