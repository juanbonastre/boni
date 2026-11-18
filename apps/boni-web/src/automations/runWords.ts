/**
 * What «Ejecuciones» says of a run (docs/automatizaciones.md AU-99, AU-100, AU-18, AU-190; F14d P2): when it was, how
 * it ended, who started it and with which version, what it did in one line, and the words of a refused touch. All in
 * words of `i18n.ts`, from the run's summary (never its rows); a step is said by its name in the version that ran.
 */
import type { Refused, RunCount, RunSummary } from "./client.ts";
import { localeOf, rowsWords, said, secsWords } from "./words.ts";

type T = (key: string, vars?: Record<string, string | number>) => string;
type Lang = "es" | "en";

/** A run's moment as the list says it: «hoy, 09:12», «ayer, 19:44», «9 nov, 10:05», «9 nov 2025, 10:05». */
export function whenWords(t: T, lang: Lang, zone: string, at: number, now: number): string {
  const locale = localeOf(lang);
  const day = (x: number) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(x);
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
  if (day(at) === day(now)) return t("auto.runs.today", { time });
  if (day(at) === day(now - 86_400_000)) return t("auto.runs.yesterday", { time });
  const sameYear = day(at).slice(0, 4) === day(now).slice(0, 4);
  return new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

/** The run's moment in full, for its bar: «15 nov 2026, 09:12». */
export function fullWhen(lang: Lang, zone: string, at: number): string {
  return new Intl.DateTimeFormat(localeOf(lang), {
    timeZone: zone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

/** Whether it has ended: only then is it undone, retried or said with its time. */
export const ended = (r: RunSummary) => r.state !== "queued" && r.state !== "running";
/**
 * Whether it went badly: a failure, an interruption, an hour it missed, or a state this app does not know. One that
 * waits for his answer, or that he cancelled, did not (AU-203).
 */
export const bad = (r: RunSummary) =>
  r.state !== "done" && r.state !== "waiting" && r.state !== "cancelled" && ended(r);

/**
 * How it ended, in a few words (the list's second line, the bar's start): «Completada · 4,1 s», «Falló en «Analista» · 2,0 s»,
 * «Interrumpida en «Buscar»» (how long, when it is known), «En ejecución: «Buscar»», «En cola», «Omitida: …», «Esperando respuesta · hasta …».
 */
export function howWords(
  t: T,
  lang: Lang,
  r: RunSummary,
  nameOf: (step: string) => string | undefined,
  zone?: string,
): string {
  const secs = r.ms !== null ? ` · ${secsWords(t, lang, r.ms)}` : "";
  // A step the document no longer names is left unsaid, never shown by its id.
  const id = r.error?.step ?? r.step;
  const at = id ? nameOf(id) : undefined;
  switch (r.state) {
    case "queued":
      return t("auto.run.how.queued");
    case "running":
      return at ? t("auto.run.how.runningAt", { step: at }) : t("auto.run.how.running");
    case "done":
      // A «Preguntar» that ended by «sin respuesta» says so (AU-125, AU-203), never only «Completada».
      if (!r.test && r.line?.noAnswer) return `${t("auto.run.how.noAnswer")}${secs}`;
      return `${t(r.test ? "auto.run.how.test" : "auto.run.how.done")}${secs}`;
    case "interrupted":
      return `${at ? t("auto.run.how.interruptedAt", { step: at }) : t("auto.run.how.interrupted")}${secs}`;
    case "missed":
      return t("auto.run.how.missed");
    case "waiting":
      // Until when it waits for an answer (AU-203), in the device's zone; without it, only that it waits.
      return r.until != null && zone
        ? t("auto.run.how.waitingUntil", { when: fullWhen(lang, zone, r.until) })
        : t("auto.run.how.waiting");
    case "cancelled":
      return `${t("auto.run.how.cancelled")}${secs}`;
    default:
      // "failed", and a state a newer server may give: said as a failure, never as nothing.
      return `${at ? t("auto.run.how.failedAt", { step: at }) : t("auto.run.how.failed")}${secs}`;
  }
}

/** Who started it and which version ran (the list's third line): «Manual · versión 3 · reintento». */
export function whoWords(t: T, r: RunSummary): string {
  if (r.test) return t("auto.run.by.test");
  const parts = [t(r.startedBy === "schedule" ? "auto.run.by.schedule" : "auto.run.by.user")];
  if (r.version !== null) parts.push(t("auto.run.by.version", { n: r.version }));
  if (r.retryOf) parts.push(t("auto.run.by.retry"));
  return parts.join(" · ");
}

/** One count of the line: «Creó 1 fila en Tareas», «Propuso modificar 12 filas en Gastos». */
function countWords(
  t: T,
  lang: Lang,
  c: RunCount,
  asked: boolean,
  names: (key: string) => string | undefined,
) {
  const collection = names(c.collection) ?? c.name ?? t("auto.run.did.gone");
  return t(`auto.run.${asked ? "asked" : "did"}.${c.action}`, {
    rows: rowsWords(t, lang, c.n),
    collection,
  });
}

/**
 * What it did, in one line (AU-99), from what the log says it saved and what it proposed: «Creó 1 fila en Tareas ·
 * con datos de fuera», «Propuso modificar 12 filas en Gastos», «Sin cambios». A proposal is counted, and nothing
 * more is promised of it (it waits for Juan, S3). Null while it runs, and for a test, which saves nothing; while it
 * waits for an answer, only what it saved so far (AU-203).
 */
export function didWords(
  t: T,
  lang: Lang,
  r: RunSummary,
  names: (key: string) => string | undefined,
): string | null {
  if (r.test || !ended(r) || r.state === "missed") return null;
  const line = r.line;
  // While it waits for an answer its proposal is not made yet (AU-203): only what it saved so far, if anything.
  const waiting = r.state === "waiting";
  const parts = [
    ...(line?.writes ?? []).map((c) => countWords(t, lang, c, false, names)),
    ...(waiting ? [] : (line?.asked ?? [])).map((c) => countWords(t, lang, c, true, names)),
  ];
  if (!parts.length) return waiting ? null : t("auto.run.did.nothing");
  // What an «Agente» saved without asking, an AI chose (AU-200, AU-204): said in the same line, before «con datos de fuera».
  if (line?.byAgent && line.writes.length) parts.push(t("auto.conn.byAgent"));
  if (line?.outside) parts.push(t("auto.run.did.outside"));
  return parts.join(" · ");
}

/** Why it failed, in words (A-34), as the failure says it in the editor. */
export function failureWords(t: T, lang: Lang, r: RunSummary): string | null {
  const f = r.error?.failure;
  if (!f || typeof f.code !== "string") return null;
  return said(t, "failure", f as never, localeOf(lang));
}

/** The words of a refused touch of a run (S2's `RunRefusal`): «No se pudo deshacer: «Comprar pan» cambió después». */
export function runRefusedWords(t: T, r: Refused): string {
  switch (r.refused) {
    case "not-personal":
      return t("mail.error.personal-device-only");
    case "changed":
      return t("auto.undo.changed", { title: r.title ?? "" });
    case "nothing":
      return t("auto.undo.nothing");
    case "test":
      return t("auto.retry.test");
    case "untested":
      return t("auto.pin.untested");
    case "off":
      return t("auto.run.off");
    case "running":
      return t("auto.run.running");
    default:
      return t("error.generic");
  }
}
