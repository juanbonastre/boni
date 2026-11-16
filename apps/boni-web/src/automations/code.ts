/**
 * What the editor of a «Código» step needs from the core, as data (docs/automatizaciones.md AU-25, AU-30, AU-31,
 * AU-33, AU-36): the same `CodeContext` the server reads code with, built from what the app holds; the marks of its
 * source, which are `codeProblems` at their place and nothing else; the collections to connect; and its console as
 * the last test kept it, checked before it is painted, since it is the code's text (A-01).
 */
import {
  type Automation,
  CODE_MODES,
  CODE_PARAMS,
  CODE_TYPE,
  type CodeContext,
  type CodeMode,
  type ConsoleLine,
  codeProblems,
  type Step,
} from "@boni/automations";
import type { FieldType } from "@boni/entities";
import type { DataType } from "../core/agent.ts";
import type { StepTest } from "./client.ts";
import type { ConditionField } from "./panel.ts";

export const isCode = (step: Step) => step.type === CODE_TYPE;

/** «Se ejecuta» (AU-30): absent is the first, «Una vez con todas las filas». */
export const modeOf = (step: Step): CodeMode => {
  const m = step.params[CODE_PARAMS.mode];
  return (CODE_MODES as readonly unknown[]).includes(m) ? (m as CodeMode) : "all";
};
export const sourceOf = (step: Step): string => {
  const s = step.params[CODE_PARAMS.source];
  return typeof s === "string" ? s : "";
};

/**
 * The server's context, as the app knows it: a collection by its key and by its name (unique, as the server's
 * `collectionNamed`), and the fields a step's last test gave, by key with their names (AU-36). A step not tested, or
 * whose fields are not known, gives none: nothing is marked of it.
 */
export function codeContextOf(
  collections: readonly DataType[],
  draft: Automation,
  tests: Readonly<Record<string, StepTest>>,
  fieldsOut: (step: string) => readonly ConditionField[],
): CodeContext {
  const byKey = new Map<string, DataType>();
  for (const c of collections) if (c.key) byKey.set(c.key, c);
  return {
    collection: (key) => {
      const c = byKey.get(key);
      return c
        ? {
            key,
            fields: c.fields.map((f) => ({
              key: f.key ?? f.id,
              type: f.type as FieldType,
              ...(f.relation ? { target: f.relation.target } : {}),
            })),
          }
        : undefined;
    },
    collectionNamed: (name) => {
      const found = collections.filter((c) => c.name === name && c.key);
      return found.length === 1 ? found[0]?.key : undefined;
    },
    collectionName: (key) => byKey.get(key)?.name,
    testedFields: (name) => {
      const step = draft.steps.find((s) => s.name === name);
      const test = step ? tests[step.id] : undefined;
      if (!step || !test || test.state !== "done") return undefined;
      const fields = fieldsOut(step.id);
      return fields.length ? fields.map((f) => ({ key: f.key, name: f.name })) : undefined;
    },
  };
}

/** One problem of the source at its place, with what the screen says of it. */
export interface SourceProblem {
  code: string;
  severity: "error" | "warning";
  detail: Record<string, string | number>;
  from: number;
  to: number;
}

/**
 * What is wrong with a «Código»'s source, as validation says it (`codeProblems`, the server's own function): the ones
 * with a place are marks in the editor; the rest (too long, a limit) are said under it.
 */
export function sourceProblems(
  step: Step,
  draft: Automation,
  context: CodeContext,
): { marks: SourceProblem[]; whole: SourceProblem[]; notConnected: string[] } {
  const marks: SourceProblem[] = [];
  const whole: SourceProblem[] = [];
  const notConnected: string[] = [];
  const length = sourceOf(step).length;
  for (const p of codeProblems(step, draft, context)) {
    if (p.param !== CODE_PARAMS.source) continue;
    const detail = (p.detail ?? {}) as Record<string, string | number>;
    const placed = typeof detail.from === "number" && typeof detail.to === "number";
    const one: SourceProblem = {
      code: p.code,
      severity: p.severity,
      detail,
      from: placed ? (detail.from as number) : 0,
      to: placed ? (detail.to as number) : length,
    };
    (placed ? marks : whole).push(one);
    if (p.code === "code.notConnected" && typeof detail.collection === "string")
      if (!notConnected.includes(detail.collection)) notConnected.push(detail.collection);
  }
  return { marks, whole, notConnected };
}

/**
 * Why «Probar paso» waits (AU-31, AU-36): an empty source, or an error of validation in it. A warning (a field the
 * last test did not give) never stops it.
 */
export function codeBlocked(
  step: Step,
  draft: Automation,
  context: CodeContext,
): "empty" | "errors" | null {
  if (!sourceOf(step).trim()) return "empty";
  const { marks, whole } = sourceProblems(step, draft, context);
  return [...marks, ...whole].some((p) => p.severity === "error") ? "errors" : null;
}

/** «Consola» as the last test kept it, each line checked: anything else is left out, never painted (A-01). */
export function consoleOf(test: StepTest | undefined): { lines: ConsoleLine[]; dropped: number } {
  const c = (test as { console?: unknown } | undefined)?.console;
  if (!c || typeof c !== "object") return { lines: [], dropped: 0 };
  const raw = (c as { lines?: unknown }).lines;
  const dropped = (c as { dropped?: unknown }).dropped;
  const lines: ConsoleLine[] = [];
  for (const l of Array.isArray(raw) ? raw : []) {
    if (!l || typeof l !== "object") continue;
    const { level, text, line, row } = l as Record<string, unknown>;
    if (typeof text !== "string") continue;
    lines.push({
      level: level === "info" || level === "warn" || level === "error" ? level : "log",
      text,
      ...(typeof line === "number" ? { line } : {}),
      ...(typeof row === "number" ? { row } : {}),
    });
  }
  return { lines, dropped: typeof dropped === "number" && dropped > 0 ? dropped : 0 };
}
