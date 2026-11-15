/**
 * The editor's own state (docs/automatizaciones.md §5.7): the draft, where the boxes are, what is selected, what is
 * open, the history that Deshacer walks, what is owed to the server and what the last test gave each step. Pure
 * functions from a state to the next one; the component keeps one and calls the client (client.ts) for what `owed`
 * says. Nothing here knows React, the canvas library or the server.
 *
 * What changes the draft comes from edit.ts (the graph) and panel.ts (a step's rows); every such change goes
 * through `change`, which is what makes it undoable and owed to the server (AU-62, AU-68).
 */
import type { Arrow, Automation, Cell, Problem } from "@boni/automations";
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

/** An empty canvas for «Nueva» (AU-61): nothing saved, the name already worded. */
export function emptyEditor(_name: string): EditorState {
  return notBuilt("emptyEditor (AU-61)");
}

/** The editor over what the server has. */
export function openedEditor(_opened: Opened): EditorState {
  return notBuilt("openedEditor");
}

/**
 * A change of the draft or of the boxes: the state before it goes into `past`, `future` empties, and it is owed to
 * the server (the draft when it differs; each step whose place differs). A change that changes nothing is nothing.
 */
export function change(_state: EditorState, _next: Partial<Snapshot>): EditorState {
  return notBuilt("change (AU-62, AU-68)");
}

/** Deshacer and Rehacer (AU-68): what comes back is owed to the server like any other change. */
export function undo(_state: EditorState): EditorState {
  return notBuilt("undo (AU-68)");
}
export function redo(_state: EditorState): EditorState {
  return notBuilt("redo (AU-68)");
}

/** The server kept the draft: its `rev`, and the steps whose test it says is stale (AU-92). */
export function saved(_state: EditorState, _answer: { rev: number; stale: string[] }): EditorState {
  return notBuilt("saved (AU-62, AU-92)");
}

/** A save did not arrive: «Sin guardar · Reintentar»; what is owed stays owed. */
export function saveFailed(_state: EditorState): EditorState {
  return notBuilt("saveFailed (AU-62)");
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
