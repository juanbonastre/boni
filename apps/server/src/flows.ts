/**
 * Flows (docs/flujos.md): a plan with a trigger kept as data in the account's journal, a row per version. F1: the
 * mail reading is the flow «Leer correo», saved by code from the plan it builds (a new version only when that plan
 * changes: the collections marked for mail, the modules, the guide) and executed from the journal; each run says
 * its flow and version. What the apps draw: the flows with their runs, and a flow as nodes (its steps, named from
 * the registry) and arrows (its references), with how often each step ran in a period.
 */
import { refsOf } from "@boni/agent";
import type { FlowRow, UserStore } from "@boni/store";

export const MAIL_FLOW = "leer-correo";

/** What a flow's trigger binds to its plan by name, each with what it is (for the trigger's node). */
export interface FlowInput {
  id: string;
  what: "record" | "text" | "list" | "guide" | "options" | "modules" | "value";
}

const INPUT_KINDS: Record<string, FlowInput["what"]> = {
  mail: "record",
  text: "text",
  subject: "text",
  known: "list",
  guide: "guide",
  options: "options",
  modules: "modules",
  adjuntos: "text",
  inv: "value",
};

/** The names a plan takes from outside (not its own steps nor `$item`/`$zip` of an iteration), as inputs. */
export function inputsOf(plan: unknown): FlowInput[] {
  const steps = stepsOf(plan);
  const own = new Set([...steps.map((s) => s.id), "item", "zip"]);
  const seen = new Set<string>();
  const out: FlowInput[] = [];
  for (const s of steps)
    for (const r of refsOf(s))
      if (!own.has(r) && !seen.has(r)) {
        seen.add(r);
        out.push({
          id: r,
          what: INPUT_KINDS[r] ?? (r.startsWith("prefill") ? "value" : "value"),
        });
      }
  return out;
}

const stepsOf = (plan: unknown): { id: string; [k: string]: unknown }[] => {
  const steps = (plan as { steps?: unknown } | null)?.steps;
  return Array.isArray(steps)
    ? steps.filter(
        (s): s is { id: string } =>
          !!s && typeof s === "object" && typeof (s as { id?: unknown }).id === "string",
      )
    : [];
};

/**
 * The flow as its latest version, saved anew only when the plan changed (its hash): the preset the code makes,
 * kept with the user's data so the app can draw it and a run can name it.
 */
export function ensureFlow(
  store: UserStore,
  f: { id: string; name: string; trigger: unknown; plan: unknown; by: string },
  now: number,
): FlowRow {
  const latest = store.journal.flow(f.id);
  const draft = {
    id: f.id,
    name: f.name,
    trigger: f.trigger,
    inputs: inputsOf(f.plan),
    plan: f.plan,
    layout: latest?.layout ?? null,
    by: f.by,
    enabled: latest?.enabled ?? true,
    created: now,
  };
  if (latest && latest.hash === hashOf(f.plan) && latest.by === f.by) return latest;
  return store.journal.saveFlow(draft);
}

/** The hash the journal gives a plan (the same way, so an unchanged plan is found without saving). */
function hashOf(plan: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(plan ?? null))
    .digest("hex")
    .slice(0, 16);
}

import { createHash } from "node:crypto";

export interface FlowSummary {
  id: string;
  name: string;
  version: number;
  trigger: unknown;
  by: string;
  enabled: boolean;
  steps: number;
  runs: number;
  last: number | null;
}

/** Every flow at its latest version, with its runs. */
export function flowsView(store: UserStore): FlowSummary[] {
  return store.journal.flows().map((f) => ({
    id: f.id,
    name: f.name,
    version: f.version,
    trigger: f.trigger,
    by: f.by,
    enabled: f.enabled,
    steps: stepsOf(f.plan).length,
    ...store.journal.flowRuns(f.id),
  }));
}

/** A step as the canvas draws it: what it is, what it says in a word, and how it went in the period. */
export interface FlowNode {
  id: string;
  op: string;
  /** The tool or reader, or the ask's control / the reply's component. */
  what: string;
  /** The tool's title from the registry («Crear»), or null for a reader (the app names readers). */
  title: string | null;
  /** A word more: the collection a record is made in, the reader's question… */
  detail: string | null;
  when: boolean;
  each: boolean;
  /** The step's arguments as text lines (`type: tarea`, `input: $text`), for its panel. */
  args: string[];
  /** The steps and inputs it takes its data from: the arrows into it. */
  deps: string[];
  /** How the step went in the period: how many times it ran, by the policy's decision. */
  ran: Record<string, number>;
}
export interface FlowDetail extends FlowSummary {
  inputs: FlowInput[];
  nodes: FlowNode[];
  days: number;
  versions: { version: number; by: string; created: number }[];
}

const DAY = 24 * 60 * 60_000;

/** A flow drawn: its inputs, its steps as nodes with their arrows, and what the period's runs made of each. */
export function flowView(
  store: UserStore,
  id: string,
  now: number,
  days: number,
  titleOf: (tool: string) => string | null,
  typeName: (key: string) => string | null,
): FlowDetail | null {
  const f = store.journal.flow(id);
  if (!f) return null;
  const steps = stepsOf(f.plan);
  const ids = new Set(steps.map((s) => s.id));
  const inputs = inputsOf(f.plan);
  const counts = store.journal.stepCountsOf(id, now - days * DAY, now);
  const nodes: FlowNode[] = steps.map((s) => {
    const op = String(s.op ?? "");
    const what =
      op === "call"
        ? String(s.tool ?? "")
        : op === "read"
          ? String(s.reader ?? "")
          : op === "ask"
            ? String(s.control ?? "")
            : op === "reply"
              ? String(s.component ?? "")
              : op;
    const args = (
      op === "call"
        ? s.args
        : op === "read"
          ? { input: s.input, ...(s.params ?? {}) }
          : op === "ask"
            ? { prompt: s.prompt, options: s.options }
            : s.data
    ) as Record<string, unknown> | undefined;
    const typeLit =
      op === "call" ? litOf((s.args as Record<string, unknown> | undefined)?.type) : null;
    const ran: Record<string, number> = {};
    for (const c of counts) if (c.step === s.id) ran[c.decision] = (ran[c.decision] ?? 0) + c.n;
    return {
      id: s.id,
      op,
      what,
      title: op === "call" ? titleOf(what) : null,
      detail: typeLit ? (typeName(typeLit) ?? typeLit) : null,
      when: s.when !== undefined,
      each: s.each !== undefined,
      args: Object.entries(args ?? {})
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}: ${exprText(v)}`),
      deps: refsOf(s).filter((r) => r !== s.id && (ids.has(r) || inputs.some((i) => i.id === r))),
      ran,
    };
  });
  return {
    id: f.id,
    name: f.name,
    version: f.version,
    trigger: f.trigger,
    by: f.by,
    enabled: f.enabled,
    steps: steps.length,
    ...store.journal.flowRuns(f.id),
    inputs,
    nodes,
    days,
    versions: store.journal
      .flowVersions(f.id)
      .map((v) => ({ version: v.version, by: v.by, created: v.created })),
  };
}

const litOf = (v: unknown): string | null =>
  v && typeof v === "object" && typeof (v as { lit?: unknown }).lit === "string"
    ? ((v as { lit: string }).lit as string)
    : null;

/** A plan expression as a short text: `$m.asunto`, `"Docencia"`, `concat($text, "…")`, `[a, b]`. */
export function exprText(v: unknown, depth = 0): string {
  if (v === null || v === undefined) return "";
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => exprText(x, depth + 1)).join(", ")}]`;
  const o = v as Record<string, unknown>;
  if ("lit" in o) return typeof o.lit === "string" ? JSON.stringify(cut(o.lit)) : String(o.lit);
  if ("ref" in o) return String(o.ref);
  if ("quote" in o) return `«${cut(String(o.quote))}»`;
  if ("fn" in o && Array.isArray(o.args)) {
    if (depth > 2) return `${String(o.fn)}(…)`;
    return `${String(o.fn)}(${o.args.map((x) => exprText(x, depth + 1)).join(", ")})`;
  }
  return `{${Object.keys(o).join(", ")}}`;
}
const cut = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}…` : s);
