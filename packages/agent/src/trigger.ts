/**
 * What a flow's trigger gives its plan by name (docs/flujos.md §4.3), as far as running it outside its trigger needs:
 * the names a form asks for (`manual`) and `today` (a schedule). A flow a record starts (`created`: a new mail) cannot
 * be run from a turn: it needs that record.
 */

/** The names a manual trigger's form gives the plan (each the user's text). */
export function manualInputs(trigger: unknown): string[] {
  const t = trigger as { manual?: unknown; inputs?: unknown } | null;
  if (!t?.manual || !Array.isArray(t.inputs)) return [];
  return t.inputs
    .map((i) => (i && typeof i === "object" ? (i as { name?: unknown }).name : null))
    .filter((n): n is string => typeof n === "string" && /^[a-z][a-z0-9_]{0,30}$/.test(n));
}

/** The names a run by hand or by `flows.run` binds for this trigger; null: only a record of its own starts it. */
export function runnableNames(trigger: unknown): string[] | null {
  const t = trigger as { manual?: unknown; schedule?: unknown } | null;
  if (t?.manual === true) return manualInputs(trigger);
  if (t?.schedule && typeof t.schedule === "object") return ["today"];
  return null;
}
