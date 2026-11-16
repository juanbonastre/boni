/**
 * The editor's own state (docs/automatizaciones.md §5.7): the draft, where the boxes are, what is selected, what is
 * open, the history that Deshacer walks, what is owed to the server and what the last test gave each step. Pure
 * functions from a state to the next one; the component keeps one and calls the client (client.ts) for what `owed`
 * says. Nothing here knows React, the canvas library or the server.
 *
 * What changes the draft comes from edit.ts (the graph) and panel.ts (a step's rows); every such change goes
 * through `change`, which is what makes it undoable and owed to the server (AU-62, AU-68).
 */
import { type Arrow, type Automation, type Cell, FORMAT, type Problem } from "@boni/automations";
import type { Opened, Place, StepTest, TestAnswer } from "./client.ts";
import { notBuilt } from "./pending.ts";

/**
 * Where a new step will go: the four ways of AU-65. Its box is placed once, as it is added (`placeFor` of
 * places.ts, or the point of the right click), and that place is owed to the server like one Juan dropped (AU-05).
 */
export type AddAt =
  /** The «+» of the top: connected to nothing. */
  | { from: "top" }
  /** The «+» of an output with no arrow, or dragging from it: the new step hangs from it. */
  | { from: "output"; step: string; output: string }
  /** The «+» of a selected arrow: the new step goes between its two ends. */
  | { from: "arrow"; arrow: Arrow }
  /** Right click on the canvas: connected to nothing, placed there. */
  | { from: "canvas"; x: number; y: number };

/** What Deshacer brings back: the draft and the boxes (moving and «Ordenar» are undone too, AU-05). */
export interface Snapshot {
  draft: Automation;
  places: Record<string, { x: number; y: number }>;
}

/** «Guardado» in the header (AU-62): one of three, each a key of i18n.ts. */
export type SaveState = "saving" | "saved" | "failed";

/** The one line of «Registro» (AU-64), as data: words.ts says it. */
export type LogLine =
  | { kind: "untested" }
  | { kind: "problems"; count: number; first: string }
  | { kind: "tested"; at: number; ok: true; steps: number; ms: number; wouldWrite: number }
  | { kind: "tested"; at: number; ok: false; failedAt: string; steps: number; ms: number };

export interface EditorState extends Snapshot {
  /** Null on an empty canvas: the automation exists from its first step (AU-61). */
  id: string | null;
  rev: number;
  /** Steps selected, by id, and the selected arrow. Never both. */
  selected: string[];
  arrow: Arrow | null;
  /** The step whose view is open (AU-70). */
  open: string | null;
  /** The panel «Añadir un paso» and where its step will go; null when closed. */
  adding: AddAt | null;
  /** Since the editor opened; never kept between sessions (AU-68). */
  past: Snapshot[];
  future: Snapshot[];
  /** What the server does not have yet: the draft, and the steps whose box moved. */
  owed: { draft: boolean; places: string[] };
  save: SaveState;
  tests: Record<string, StepTest>;
  tested: Record<string, Record<string, Cell>>;
  /** A test is running: the whole automation (`step` null) or one step (AU-64, AU-73). */
  testing: { step: string | null } | null;
  /** The last «Probar» or «Probar paso» answered here, for «Registro». */
  last: (TestAnswer & { at: number }) | null;
  /**
   * The problems shown: none until a test is asked (AU-64, AU-83); then those of the draft as it was then, each
   * dropped as soon as its step changes.
   */
  problems: Problem[];
  /** Required parameters Juan has left, as `<step id>.<param key>`: only these are marked before a test (AU-83). */
  left: string[];
  /** What changing an action took away (AU-82): the parameters' keys, for the notice with its «Deshacer». */
  dropped: { step: string; params: string[] } | null;
}

const fresh = {
  selected: [],
  arrow: null,
  open: null,
  adding: null,
  past: [],
  future: [],
  owed: { draft: false, places: [] },
  save: "saved",
  testing: null,
  last: null,
  problems: [],
  left: [],
  dropped: null,
} satisfies Partial<EditorState>;

/** An empty canvas for «Nueva» (AU-61): nothing saved, the name already worded. */
export function emptyEditor(name: string): EditorState {
  return {
    ...fresh,
    id: null,
    rev: 0,
    draft: { format: FORMAT, id: "", version: 0, name, steps: [], arrows: [], settings: {} },
    places: {},
    tests: {},
    tested: {},
  };
}

/** The editor over what the server has. */
export function openedEditor(opened: Opened): EditorState {
  return {
    ...fresh,
    id: opened.id,
    rev: opened.rev,
    draft: opened.automation,
    places: Object.fromEntries(opened.places.map((p) => [p.step, { x: p.x, y: p.y }])),
    tests: opened.tests,
    tested: opened.tested,
  };
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * A change of the draft or of the boxes: the state before it goes into `past`, `future` empties, and it is owed to
 * the server (the draft when it differs; each step whose place differs). A change that changes nothing is nothing.
 * On an empty canvas nothing is owed until the draft has its first step: that step makes it (`automations.create`).
 */
export function change(state: EditorState, next: Partial<Snapshot>): EditorState {
  const draft = next.draft ?? state.draft;
  const places = next.places ?? state.places;
  const drafted = !same(draft, state.draft);
  const moved = Object.keys(places).filter((k) => !same(places[k], state.places[k]));
  if (!drafted && !moved.length) return state;
  const owesDraft = state.owed.draft || (drafted && (state.id !== null || draft.steps.length > 0));
  const owesPlaces = state.id === null ? [] : [...new Set([...state.owed.places, ...moved])];
  return {
    ...state,
    draft,
    places,
    past: [...state.past, { draft: state.draft, places: state.places }],
    future: [],
    owed: { draft: owesDraft, places: owesPlaces },
    save: owesDraft ? "saving" : state.save,
  };
}

/** Deshacer and Rehacer (AU-68): what comes back is owed to the server like any other change. */
export function undo(_state: EditorState): EditorState {
  return notBuilt("undo (AU-68)");
}
export function redo(_state: EditorState): EditorState {
  return notBuilt("redo (AU-68)");
}

/**
 * The server kept the draft: its `rev`, and the steps whose test it says is stale (AU-92). `sent`: the draft that
 * save carried; when the draft changed while it was out, what changed after it is still owed, and goes next.
 */
export function saved(
  state: EditorState,
  answer: { rev: number; stale: string[] },
  sent?: Automation,
): EditorState {
  const after = sent !== undefined && sent !== state.draft;
  const tests = { ...state.tests };
  for (const step of answer.stale) {
    const kept = tests[step];
    if (kept) tests[step] = { ...kept, stale: true };
  }
  return {
    ...state,
    rev: answer.rev,
    tests,
    owed: { ...state.owed, draft: after },
    save: after ? "saving" : "saved",
  };
}

/** A save did not arrive: «Sin guardar · Reintentar»; what is owed stays owed. */
export function saveFailed(state: EditorState): EditorState {
  return { ...state, save: "failed" };
}

/**
 * «Probar» or «Probar paso» was asked: with problems of `validate` in what it would run, nothing is tested and they
 * are shown (AU-64); otherwise `testing` says so until `tested`.
 */
export function askTest(
  _state: EditorState,
  _step: string | null,
  _problems: readonly Problem[],
): EditorState {
  return notBuilt("askTest (AU-64)");
}

/** A test answered: every step's test as the server now has it. */
export function tested(_state: EditorState, _answer: TestAnswer, _now: number): EditorState {
  return notBuilt("tested (AU-67)");
}

/** The line of «Registro» (AU-64). */
export function logLine(_state: EditorState): LogLine {
  return notBuilt("logLine (AU-64)");
}

/**
 * What an arrow says after a test (AU-67): the rows that passed by it, and whether the count is of a test that is
 * stale (AU-92). Null before any test of its step. An output with no arrow has its count too: `outputCount`.
 */
export function arrowCount(
  _state: EditorState,
  _arrow: Arrow,
): { rows: number; stale: boolean } | null {
  return notBuilt("arrowCount (AU-67, AU-92)");
}
export function outputCount(
  _state: EditorState,
  _step: string,
  _output: string,
): { rows: number; stale: boolean } | null {
  return notBuilt("outputCount (AU-67)");
}

export type { Place };
