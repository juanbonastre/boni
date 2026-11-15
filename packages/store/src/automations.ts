/**
 * Where an automation lives (docs/automatizaciones.md §7; phase F14b): in the user's store (D-02), next to the
 * flows of before, as tables of the journal side, reached through `store.journal`. Like a flow, an automation is no
 * entity: no collection lists it but Boni's own «Automatizaciones», which is made on each read. A contract: the
 * builder's first server PR adds the migration and makes `Journal` extend `AutomationsJournal`.
 *
 * The migration (one entry of `MIGRATIONS`, after the last one there is then):
 *
 *   CREATE TABLE automations (
 *     id TEXT PRIMARY KEY, by TEXT NOT NULL, created INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
 *   );
 *   CREATE TABLE automation_drafts (
 *     id TEXT PRIMARY KEY, rev INTEGER NOT NULL, name TEXT NOT NULL, doc TEXT NOT NULL,
 *     device TEXT, updated INTEGER NOT NULL
 *   );
 *   CREATE TABLE automation_layout (
 *     id TEXT NOT NULL, step TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, PRIMARY KEY (id, step)
 *   ) WITHOUT ROWID;
 *   CREATE TABLE automation_tests (
 *     id TEXT NOT NULL, step TEXT NOT NULL, print TEXT NOT NULL, at INTEGER NOT NULL, record TEXT NOT NULL,
 *     PRIMARY KEY (id, step)
 *   ) WITHOUT ROWID;
 *   CREATE TABLE automation_test_rows (
 *     id TEXT NOT NULL, step TEXT NOT NULL, output TEXT NOT NULL, chunk INTEGER NOT NULL, rows TEXT NOT NULL,
 *     PRIMARY KEY (id, step, output, chunk)
 *   ) WITHOUT ROWID;
 *
 * What is undone and how (D-02). None of these is in the operation log: nothing here is a record of a collection.
 * - The draft is undone in the editor (AU-68), change by change; each undo is one more save.
 * - «Eliminar» sets `deleted` and its notice's «Deshacer» clears it: the draft, the places and the kept tests stay.
 * - A test writes nothing in any collection (AU-90), so it has nothing to undo.
 * What an automation writes in the collections when it runs for real is F14d's: one group of the operation log per
 * run (AU-18).
 */

/** An automation there is, published or not. Its name is its draft's until it has a version (F14d). */
export interface AutomationRow {
  id: string;
  /** Who made it: `user` in F14b (Boni's and a page's arrive with F16 and F17). */
  by: string;
  created: number;
  deleted: boolean;
}

/**
 * An automation's draft (AU-62, AU-95): the whole document as the editor has it, kept as Juan changes it. One per
 * automation; nothing runs it for real, only «Probar». In F14b every automation has one and no version.
 */
export interface AutomationDraftRow {
  id: string;
  /** Grows by one with each save: what tells one saved draft from the next. Moving a box does not change it (AU-05). */
  rev: number;
  /** The document's `name`, kept apart so the list does not parse every draft. */
  name: string;
  /** The automation as `@boni/automations`' format writes it (JSON). Its `version` is 0 until F14d publishes. */
  doc: string;
  /** The device that wrote it last. */
  device: string | null;
  updated: number;
}

/** Where a step's box is on the canvas (AU-05): presentation only, never part of the automation. */
export interface AutomationPlace {
  step: string;
  x: number;
  y: number;
}

/**
 * The last test of one step (AU-91): its print, when, and the engine's record with each output's rows left out
 * (`out` holds each output's count instead). The rows are kept apart, 50 to a chunk, so a page of them is read
 * without the rest (AU-71, AU-72, A-15).
 */
export interface AutomationTestRow {
  id: string;
  step: string;
  print: string;
  at: number;
  /** JSON: the record with `out` as counts by output. */
  record: string;
}

export interface AutomationsJournal {
  /** The automations not deleted, the newest first, each with its draft's name, `rev` and `updated`. */
  automations(): (AutomationRow & Pick<AutomationDraftRow, "name" | "rev" | "updated">)[];
  /** One automation, deleted or not, or null. */
  automation(id: string): AutomationRow | null;
  /** A new automation with its first draft (`rev` 1), in one transaction. */
  createAutomation(a: Omit<AutomationRow, "deleted">, draft: Omit<AutomationDraftRow, "rev">): void;
  /** «Eliminar» and its «Deshacer». */
  setAutomationDeleted(id: string, deleted: boolean): void;
  automationDraft(id: string): AutomationDraftRow | null;
  /** Keeps a draft over the one it had and gives its new `rev`. */
  saveAutomationDraft(d: Omit<AutomationDraftRow, "rev">): number;
  /** The places of an automation's boxes; a step with none has no entry. */
  automationLayout(id: string): AutomationPlace[];
  /** Sets the places given and leaves the rest; a place of a step the draft no longer has is dropped on a save. */
  placeAutomationSteps(id: string, places: readonly AutomationPlace[]): void;
  /** The last test of every step of an automation that has one. */
  automationTests(id: string): AutomationTestRow[];
  /**
   * Keeps the test of the steps that ran, over the one each had, with their rows by output (each row as JSON, in
   * order); the steps not named keep theirs. A step the draft no longer has loses its test on a save.
   */
  keepAutomationTests(
    id: string,
    steps: readonly (Omit<AutomationTestRow, "id"> & {
      rows: Readonly<Record<string, readonly string[]>>;
    })[],
  ): void;
  /** Some rows of one output of a step's last test, in order, each as it was kept (JSON). */
  automationTestRows(
    id: string,
    step: string,
    output: string,
    offset: number,
    limit: number,
  ): string[];
}
