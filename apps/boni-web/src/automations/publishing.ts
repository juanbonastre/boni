/**
 * «Publicar» and what goes with it on the screen, as data and words (docs/automatizaciones.md §5.8, F14d P1): what
 * «Guardado» adds about the version that runs (AU-95), the lines of pantalla 10 (AU-96, AU-182), the limits of
 * «Ajustes» (AU-17) and the words of a refusal. Pure: the server computes the diff, the checks and the abilities with
 * the same functions of `@boni/automations` and decides; this only says them. A step's or a collection's name is
 * text from the user and is painted as plain text by the caller (A-01).
 */
import {
  type Ability,
  AUTOMATION_LIMITS,
  type Automation,
  type AutomationDiff,
  abilities,
  diffAutomations,
  isSame,
  type Look,
  limitsOf,
  RUN_LIMIT_KEYS,
  type RunLimit,
  WRITE_ACTIONS,
} from "@boni/automations";
import type { T } from "../i18n.ts";
import { type EditorState, failedAt } from "./state.ts";
import { amountOf, said } from "./words.ts";

/** What the server says of the published side (`GET …/versions` and the document of the one that runs). */
export interface Published {
  /** The version that runs, or null: never published. */
  running: number | null;
  enabled: boolean;
  /** The document of the version that runs; null while it is being read, or never published. */
  doc: Automation | null;
}

/**
 * What «Guardado» adds (AU-95): «sin publicar», «publicada la versión 4» while the draft is the document that runs,
 * or «cambios sin publicar». The draft is compared with `diffAutomations`, which sees no order and no layout, as the
 * server's print does not see the layout; «Publicar» asks the server's own answer (`same`) before it publishes.
 */
export function publishWord(
  draft: Automation,
  published: Published | null,
): keyof typeof PUBLISH_WORDS | null {
  if (!published) return null;
  if (published.running === null) return "never";
  if (!published.doc) return null;
  return isSame(diffAutomations(published.doc, draft)) ? "running" : "changes";
}

export const PUBLISH_WORDS = {
  never: "auto.pub.never",
  running: "auto.pub.running",
  changes: "auto.pub.changes",
} as const;

/** One line of «Qué cambia» (AU-96): its words and, for a step still in the draft, the step it opens. */
export interface Line {
  text: string;
  step?: string;
}

const PARTS = ["name", "type", "params", "connections", "settings"] as const;

/**
 * «Qué cambia respecto a la versión N» (AU-96): the name, each step added, removed or changed with what changed in
 * it, the arrows, how it starts and each limit. `nameOf`: a step's name in the draft or, removed, in the version.
 */
export function diffLines(
  t: T,
  diff: AutomationDiff,
  nameOf: (step: string) => string,
  locale: string,
): Line[] {
  const out: Line[] = [];
  if (diff.name) out.push({ text: t("auto.pub.diff.name", diff.name) });
  if (diff.triggers.length) out.push({ text: t("auto.pub.diff.triggers") });
  for (const step of diff.added)
    out.push({ text: t("auto.pub.diff.added", { name: nameOf(step) }), step });
  for (const step of diff.removed)
    out.push({ text: t("auto.pub.diff.removed", { name: nameOf(step) }) });
  for (const c of diff.changed) {
    const what = PARTS.filter((p) =>
      p === "name" || p === "type" ? c[p] !== undefined : c[p].length > 0,
    )
      .map((p) => t(`auto.pub.part.${p}`))
      .join(", ");
    out.push({ text: t("auto.pub.diff.changed", { name: nameOf(c.step), what }), step: c.step });
  }
  if (diff.arrows.added.length || diff.arrows.removed.length)
    out.push({
      text: t("auto.pub.diff.arrows", {
        added: diff.arrows.added.length,
        removed: diff.arrows.removed.length,
      }),
    });
  for (const l of diff.limits)
    out.push({
      text: t("auto.pub.diff.limit", {
        limit: t(`auto.limitName.${l.limit}`),
        from: amountOf(l.limit, l.from, locale),
        to: amountOf(l.limit, l.to, locale),
      }),
    });
  return out;
}

/** A line of «Antes de publicar» (AU-96): a problem that stops it (`block`) or something worth a look. */
export interface CheckLine extends Line {
  block: boolean;
}

/**
 * «Antes de publicar»: what stops the publish first, in the words of validation (`said`), then what is worth a look;
 * each with its step, which the screen names as a link that opens it.
 */
export function checkLines(
  t: T,
  view: {
    blocks: readonly { code: string; step?: string; detail?: Record<string, string | number> }[];
    looks: readonly Look[];
  },
  locale: string,
  collection: (key: string) => string | undefined,
): CheckLine[] {
  const out: CheckLine[] = view.blocks.map((p) => ({
    block: true,
    text: said(t, "problem", p, locale, { collection }),
    ...(p.step ? { step: p.step } : {}),
  }));
  for (const l of view.looks) {
    const d = l.detail ?? {};
    const vars: Record<string, string | number> = { ...d };
    if (l.code === "limit.changed" && typeof d.limit === "string") {
      vars.limit = t(`auto.limitName.${d.limit}`);
      for (const k of ["value", "default"] as const)
        if (typeof d[k] === "number") vars[k] = amountOf(d.limit, d[k] as number, locale);
    }
    out.push({
      block: false,
      text: t(`auto.look.${l.code}`, vars),
      ...(l.step ? { step: l.step } : {}),
    });
  }
  return out;
}

/**
 * «Lo que podrá hacer» (AU-182, decision 11): one line per collection and action, «Lee Notas», «Crea filas en
 * Tareas · las guarda · con datos de fuera», «Elimina filas en Gastos · sin preguntar», «Modifica filas en Notas ·
 * pregunta». `name`: a collection's name by its key (the key itself when the app does not know it).
 */
export function abilityLine(t: T, a: Ability, name: (key: string) => string): string {
  const parts = [t(`auto.can.${a.action}`, { collection: name(a.collection) })];
  if (a.how === "saves") parts.push(t("auto.can.saves"));
  else if (a.how === "asks") parts.push(t("auto.can.asks"));
  else if (a.how === "noAsk") parts.push(t("auto.conn.noAsk"));
  if (a.outside) parts.push(t("auto.can.outside"));
  return parts.join(" · ");
}

/**
 * The limits «Ajustes» lists (AU-17): «Tiempo» always, «Filas escritas» when a step writes; model calls arrive with
 * F15 and a step that repeats with F18. `named`: a collection by its name, for what a «Código» cites.
 */
export function shownLimits(
  draft: Automation,
  named: (name: string) => string | undefined,
): RunLimit[] {
  const writes = abilities(draft, { collectionNamed: named }).some((a) =>
    (WRITE_ACTIONS as readonly string[]).includes(a.action),
  );
  return RUN_LIMIT_KEYS.filter((k) => k === "ms" || (k === "rowsWritten" && writes));
}

/** A limit as «Ajustes» types it: seconds for the time, a count for the rest. */
export const limitUnit = (limit: RunLimit): number => (limit === "ms" ? 1000 : 1);

/** The value in the field: what the draft holds, else the default, in the field's unit. */
export const limitField = (draft: Automation, limit: RunLimit): number =>
  limitsOf(draft)[limit] / limitUnit(limit);

/**
 * What typing `typed` in a limit's field gives (AU-17): the draft with it, or `over` when it is over its ceiling,
 * which the field refuses, or `bad` when it is not a whole number above zero. Its default is written as nothing, so a
 * limit put back to its default leaves `settings` as it was before it changed.
 */
export function withLimit(
  draft: Automation,
  limit: RunLimit,
  typed: string,
): Automation | "over" | "bad" {
  const n = Number(typed);
  if (!typed.trim() || !Number.isInteger(n) || n <= 0) return "bad";
  const value = n * limitUnit(limit);
  const { default: base, ceiling } = AUTOMATION_LIMITS[limit];
  if (value > ceiling) return "over";
  const limits = { ...(draft.settings?.limits ?? {}) };
  if (value === base) delete limits[limit];
  else limits[limit] = value;
  const settings = { ...draft.settings };
  if (Object.keys(limits).length) settings.limits = limits;
  else delete settings.limits;
  return { ...draft, settings };
}

/**
 * The limit a test stopped at (AU-17: «Parar por un límite dice cuál fue y lleva a ese ajuste»), whose «Registro»
 * offers «Cambiar el límite»; null when it did not stop at one of the run's limits.
 */
export function stoppedByLimit(state: EditorState): RunLimit | null {
  const step = failedAt(state);
  const failure = step ? state.tests[step]?.error?.failure : undefined;
  const limit = failure?.code === "run.limit" ? failure.detail?.limit : undefined;
  return typeof limit === "string" && (RUN_LIMIT_KEYS as readonly string[]).includes(limit)
    ? (limit as RunLimit)
    : null;
}

/** The words of a refusal of «Publicar», «Encendida» or «Ejecutar» (publish.ts's `Refusal`, S2's runs). */
export function refusedWords(t: T, refused: string): string {
  switch (refused) {
    case "not-personal":
      return t("mail.error.personal-device-only");
    case "stale":
      return t("auto.pub.stale");
    case "blocked":
      return t("auto.pub.blocked");
    case "unchanged":
      return t("auto.pub.same");
    case "off":
      return t("auto.run.off");
    case "running":
      return t("auto.run.running");
    default:
      return t("error.generic");
  }
}
