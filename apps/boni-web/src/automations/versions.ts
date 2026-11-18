/**
 * «Versiones» as data (docs/automatizaciones.md AU-98, P3b): the list newest first with whose each one is, one version
 * made into a state its read-only canvas draws (as a run is, automations/runs.ts), and two compared: what
 * `diffAutomations` says, marked on each side's steps. Pure: the server keeps the versions; this only says them.
 */
import { type Automation, type AutomationDiff, diffAutomations } from "@boni/automations";
import type { VersionInfo } from "./client.ts";
import { type EditorState, emptyEditor } from "./state.ts";

/** The list as «Versiones» shows it: the newest first, whatever order the server gave. */
export const newestFirst = (list: readonly VersionInfo[]): VersionInfo[] =>
  [...list].sort((a, b) => b.n - a.n);

/** Whose it is: «De Boni» for one Boni wrote (`by` "preset", F16); any other is Juan's, «Tú». */
export const whoseKey = (v: Pick<VersionInfo, "by">) =>
  v.by === "preset" ? "auto.ver.boni" : "auto.ver.you";

/**
 * A version on its canvas, looked at and never changed: its document, the boxes the editor has for the steps it
 * still shares with the draft (the rest are placed as the canvas places a step without a box), no tests.
 */
export function versionEditor(
  id: string,
  doc: Automation,
  places: EditorState["places"],
): EditorState {
  const kept: EditorState["places"] = {};
  for (const s of doc.steps)
    if (places[s.id]) kept[s.id] = places[s.id] as { x: number; y: number };
  return { ...emptyEditor(doc.name), id, draft: doc, places: kept };
}

export type DiffMark = "added" | "removed" | "changed";

/**
 * Two versions side by side: the older on the left, the newer on the right, whichever was chosen first. The older
 * one marks what the newer no longer has, the newer what it added, and both what changed between them.
 */
export function compared(
  a: { n: number; doc: Automation },
  b: { n: number; doc: Automation },
): {
  older: { n: number; doc: Automation; marks: Record<string, DiffMark> };
  newer: { n: number; doc: Automation; marks: Record<string, DiffMark> };
  diff: AutomationDiff;
} {
  const [o, w] = a.n <= b.n ? [a, b] : [b, a];
  const diff = diffAutomations(o.doc, w.doc);
  const older: Record<string, DiffMark> = {};
  const newer: Record<string, DiffMark> = {};
  for (const step of diff.removed) older[step] = "removed";
  for (const step of diff.added) newer[step] = "added";
  for (const c of diff.changed) {
    older[c.step] = "changed";
    newer[c.step] = "changed";
  }
  return { older: { ...o, marks: older }, newer: { ...w, marks: newer }, diff };
}
