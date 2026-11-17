/**
 * «Ejecuciones» as data (docs/automatizaciones.md AU-99, AU-101; F14d P2): a run made into an editor's state, so its
 * canvas is the editor's own canvas, looked at and never changed; the «Registro» tree's lines, the same for a test in
 * the editor and for a run; and the list of runs kept as pages arrive and as the first page is asked again. Pure: it
 * knows neither React nor the server.
 */
import { type Automation, executionOrder, isTrigger } from "@boni/automations";
import type { RunStep, RunSummary, RunView, StepTest } from "./client.ts";
import { type EditorState, emptyEditor } from "./state.ts";

/** A step's record in a run as the canvas and the step's view read a test's (AU-99). */
export function testOfRun(step: RunStep, at: number): StepTest {
  return {
    state: step.state,
    at,
    ms: step.ms,
    in: step.in,
    out: step.out,
    retries: step.retries,
    failed: step.failed,
    wouldWrite: step.writes?.would ?? 0,
    ...(step.error ? { error: step.error } : {}),
    stale: false,
    ...(step.console ? { console: step.console } : {}),
  };
}

/**
 * The canvas of a run (AU-99): the document it ran, each step with what it gave, and the boxes where the editor has
 * them (a step the draft no longer has is placed as a new one would be). Null when nothing is left of the document.
 */
export function runEditor(view: RunView, places: EditorState["places"]): EditorState | null {
  const doc = view.automation;
  if (!doc) return null;
  const at = view.run.started ?? view.run.at;
  const tests: Record<string, StepTest> = {};
  for (const [id, s] of Object.entries(view.steps)) tests[id] = testOfRun(s, at);
  const kept: EditorState["places"] = {};
  for (const s of doc.steps)
    if (places[s.id]) kept[s.id] = places[s.id] as { x: number; y: number };
  return {
    ...emptyEditor(doc.name),
    id: view.run.automation,
    draft: doc,
    places: kept,
    tests,
    tested: { [view.trigger]: view.fields },
  };
}

/** One line of the «Registro» tree (AU-101): a step, how it ended, its rows in and out, and what it touched. */
export interface TreeLine {
  step: string;
  name: string;
  state: string;
  rowsIn: number;
  rowsOut: number;
  ms: number;
  reads: { collection: string; rows: number }[];
  saved: number;
  asked: number;
  would: number;
  console: number;
  pinned: boolean;
}

const sum = (x: Record<string, number>) => Object.values(x).reduce((n, v) => n + v, 0);

/**
 * The order the lines go in: the order the steps ran, when it is known (`ran`, a test's answer); else from each
 * trigger that has a record, as the engine runs it; then whatever else has one, in the document's order.
 */
export function treeOrder(
  doc: Automation,
  records: Readonly<Record<string, unknown>>,
  ran?: readonly string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const put = (id: string) => {
    if (seen.has(id) || !(id in records)) return;
    seen.add(id);
    out.push(id);
  };
  for (const id of ran ?? []) put(id);
  for (const s of doc.steps) {
    if (!isTrigger(s) || !(s.id in records)) continue;
    try {
      for (const id of executionOrder(doc, s.id)) put(id);
    } catch {
      // A cycle in an old document: what is left goes in the document's order.
    }
  }
  for (const s of doc.steps) put(s.id);
  return out;
}

type Recorded = Pick<StepTest, "state" | "in" | "out" | "ms"> &
  Partial<Pick<RunStep, "reads" | "writes">> & {
    wouldWrite?: number;
    console?: { lines: unknown[]; dropped: number };
  };

/** The tree's lines (AU-101), for a run's steps or the editor's tests: never rows, only their counts. */
export function treeLines(
  doc: Automation,
  records: Readonly<Record<string, Recorded>>,
  opts: { ran?: readonly string[]; pins?: Readonly<Record<string, unknown>> } = {},
): TreeLine[] {
  const names = new Map(doc.steps.map((s) => [s.id, s.name]));
  return treeOrder(doc, records, opts.ran).flatMap((id) => {
    const r = records[id];
    if (!r || r.state === "queued") return [];
    return [
      {
        step: id,
        name: names.get(id) ?? id,
        state: r.state,
        rowsIn: sum(r.in),
        rowsOut: sum(r.out),
        ms: r.ms,
        reads: r.reads ?? [],
        saved: r.writes?.saved ?? 0,
        asked: r.writes?.asked ?? 0,
        would: r.writes?.would ?? r.wouldWrite ?? 0,
        console: r.console ? r.console.lines.length + r.console.dropped : 0,
        pinned: !!opts.pins && id in opts.pins,
      },
    ];
  });
}

/**
 * The list once its first page is asked again (a run began or ended): that page as the server says it now, then
 * the older pages already loaded, without the runs that page brings again.
 */
export function mergeRuns(
  first: readonly RunSummary[],
  loaded: readonly RunSummary[],
): RunSummary[] {
  if (!first.length) return [];
  const ids = new Set(first.map((r) => r.id));
  const oldest = first[first.length - 1]?.at ?? 0;
  return [...first, ...loaded.filter((r) => !ids.has(r.id) && r.at <= oldest)];
}
