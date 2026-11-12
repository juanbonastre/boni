/**
 * A run in words, the same everywhere (task 90; Juan, 2026-11-06: the Recorrido said `entities.get`, `$mail` and «P20»
 * where the map said «Leer» and «Regla del remitente»): each step by the name the map and the editor give it, what came
 * of it, and in one line what it does; what it read, wrote, proposed and decided, and its models with their cost. The
 * Registro, the map's run card and «Copiar» say it so. Text from a mail or a model stays text.
 */
import type { MapNode, RunDetail, RunStep } from "./agent.ts";
import { deviceZone } from "./clock.ts";

type T = (k: string, p?: Record<string, string | number>) => string;
const or = (t: T, k: string, fallback: string) => {
  const v = t(k);
  return v === k ? fallback : v;
};

/**
 * A step's name, the one the editor, the map, a flow's preview, the Registro and «Copiar» give it (I-27): a reader's
 * in a word («Lectora»), a tool's title («Crear»), a question or a reply; its id only when Boni has no name for it.
 */
export function stepName(t: T, s: { op: string; what: string; title?: string | null }): string {
  if (s.op === "read") return or(t, `flow.node.${s.what}`, s.what);
  if (s.op === "call") return s.title ?? s.what;
  if (s.op === "ask") return t("flows.op.ask");
  if (s.op === "reply") return t("flows.op.reply");
  if (s.op === "agent") return t("flows.op.agent");
  return s.what;
}

/** What a step does, in one line (`flow.desc.<reader or tool>`, a question's or a reply's), or null when none. */
export function stepDesc(t: T, s: Pick<RunStep, "op" | "what">): string | null {
  if (s.op === "ask" || s.op === "reply") return or(t, `flow.desc.op.${s.op}`, "") || null;
  if (s.op !== "read" && s.op !== "call") return null;
  const k = `flow.desc.${s.what}`;
  const v = t(k);
  return v === k ? null : v;
}

/**
 * Why a step stopped, in words: a safety rule («P2-untrusted-destination»), Juan's own stop, or a fault. The code
 * itself is the policy's and the engine's, not the user's: only «Copiar» carries it, to fix what failed.
 */
export function whyText(t: T, code: string): string {
  // The day's budget for models (P13) and a request's own limits (P12) are limits, not safety rules.
  if (/^P13(-|$)/.test(code)) return t("run.why.budget");
  if (/^P12(-|$)/.test(code)) return t("run.why.limit");
  // The policy's rules (P…) and the readers' (R…: what a model may read).
  if (/^[PR]\d+(-|$)/.test(code)) return t("run.why.rule");
  return or(t, `run.why.${code}`, t("run.why.fault"));
}

/** What came of a whole run, in a word or two: «Hecho», «Parado: …» (its code only where it helps, `withCode`). */
export function runStatusLine(t: T, status: string, withCode = false): string {
  if (status === "done") return t("run.node.allow");
  if (status === "stopped" || status.startsWith("stopped:")) {
    const code = status.slice("stopped:".length);
    if (status === "stopped" || !code) return t("run.node.deny");
    const why = whyText(t, code);
    return t("run.node.stopped", { why: withCode ? `${why} (${code})` : why });
  }
  return or(t, `log.status.${status}`, status);
}

/** What came of a step in a run, in a word or two (no rule codes: they are the policy's, not the user's). */
/** The step a run stopped at: the last one an error, a denial or a piece that ended it left; null when none did. */
export function stopStep(
  steps: readonly Pick<RunStep, "id" | "error" | "decision">[],
): string | null {
  const stop = steps.filter(
    (x) => !!x.error || x.decision === "deny" || x.decision === "stopped" || x.decision === "end",
  );
  return stop.at(-1)?.id ?? null;
}

export function runStepLine(t: T, s: Pick<RunStep, "error" | "decision">): string {
  if (s.error) return t("run.node.stopped", { why: whyText(t, s.error) });
  if (s.decision === null) return t("run.node.never");
  return or(t, `run.node.${s.decision}`, s.decision);
}

export interface RunWords {
  steps: {
    id: string;
    name: string;
    line: string;
    desc: string | null;
    answers: string[];
    /** Why it stopped, as the engine says it (only «Copiar» shows it). */
    code: string | null;
  }[];
  read: string[];
  did: string[];
  proposed: string[];
  decided: string[];
  models: string[];
}

/** The run's words: its steps, then what it read, did, proposed and decided, and its models. */
export function runWords(t: T, d: RunDetail, money: (usd: number) => string): RunWords {
  const area = (a: string) => or(t, `log.area.${a}`, a);
  return {
    steps: d.steps.map((s) => ({
      id: s.id,
      name: [stepName(t, s), ...(s.said ?? [])].join(" "),
      line: runStepLine(t, s),
      desc: stepDesc(t, s),
      answers: s.answers,
      code: s.error,
    })),
    read: d.read.map(
      (r) =>
        `${r.collection}: ${r.titles.map((x) => `«${x}»`).join(", ")}${r.n > r.titles.length ? ` +${r.n - r.titles.length}` : ""}`,
    ),
    did: d.changes.map(
      (c) =>
        `${t(`log.change.${c.action}`, { title: c.title, collection: c.collection })}${c.undone ? ` ${t("log.change.undone")}` : ""}`,
    ),
    proposed: d.proposals.map((p) => `«${p.title}» · ${t(`log.proposal.${p.status}`)}`),
    decided: d.decisions.map(
      (x) =>
        `${area(x.area)} · ${Math.round(x.p * 100)} % · ${t(`log.outcome.${x.outcome}`)}${x.result ? ` · ${t(`log.judged.${x.result}`)}` : ""}`,
    ),
    models: d.models.map(
      (m) =>
        `${or(t, `log.role.${m.role}`, m.role)} · ${m.model} · ${m.input} → ${m.output}${m.cost !== null ? ` · ${money(m.cost)}` : ""}`,
    ),
  };
}

/**
 * Dollars as every place says them (the map, a flow's page, the Registro): cents, and a small amount to its first
 * figures («0,004 US$», never «0,00 US$»).
 */
export function moneyText(lang: string, usd: number): string {
  return new Intl.NumberFormat(lang === "en" ? "en-GB" : "es-ES", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.abs(usd) > 0 && Math.abs(usd) < 0.1 ? 4 : 2,
  }).format(usd);
}

/** The run as text to paste in a chat (`Copiar`): the same words, one per line. */
export function runCopy(t: T, d: RunDetail, w: RunWords, when: string): string {
  const lines = [
    `Boni · ${t("log.trace")} · ${runStatusLine(t, d.status, true)} · ${when} (${t("log.copyNote")})`,
    ...(d.request !== null ? [`${t("log.request")}: ${d.request}`] : []),
    `${t("log.steps")}:`,
    ...w.steps.flatMap((s, i) => [
      `${i + 1}. ${s.name} — ${s.line}${s.code ? ` (${s.code})` : ""}`,
      ...(s.desc ? [`   ${s.desc}`] : []),
      ...s.answers.map((a) => `   ${t("log.answer")}: ${a}`),
    ]),
    ...(
      [
        [t("log.read"), w.read],
        [t("log.did"), w.did],
        [t("log.proposed"), w.proposed],
        [t("log.decisions"), w.decided],
        [t("log.models"), w.models],
      ] as const
    ).flatMap(([name, items]) => (items.length ? [`${name}:`, ...items.map((x) => `- ${x}`)] : [])),
  ];
  return lines.join("\n");
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const CIVIL_DAY = /^\d{4}-\d{2}-\d{2}$/;
/**
 * A value as text, as a person reads it: an instant or a day as a date in the user's language and zone, never in ISO
 * form (Juan, 2026-11-02); the rest as it is.
 */
export function valueText(v: unknown, lang: string): string {
  const locale = lang === "en" ? "en-GB" : "es-ES";
  if (typeof v === "string" && INSTANT.test(v)) {
    const ms = Date.parse(v);
    if (!Number.isNaN(ms))
      return new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: deviceZone(),
      }).format(ms);
  }
  if (typeof v === "string" && CIVIL_DAY.test(v)) {
    const [y, m, d] = v.split("-").map(Number);
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
      Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1),
    );
  }
  if (typeof v === "boolean") return v ? "✓" : "✗";
  return typeof v === "string" || typeof v === "number" ? String(v) : JSON.stringify(v);
}

/** A map node's name: its own (a collection, a flow, a page, an assistant), or Boni's word for it (the map, a chat). */
export function mapNodeName(t: T, n: Pick<MapNode, "kind" | "code" | "name">): string {
  if (n.kind === "actor" && n.code === "assistant")
    return t("map.node.assistant", { name: n.name ?? "" });
  if (n.name) return n.name;
  return t(`map.node.${n.code ?? n.kind}`);
}
