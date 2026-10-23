import { type Json, plain, readStore, type Val } from "@boni/agent";
import type { ProposalRow, UserStore } from "@boni/store";
import { dueField } from "./mail.ts";

/**
 * Juan's corrections to a proposal before accepting it (Juan, 2026-10-23: from the inbox's card he may rename the
 * row and change the collection it goes to; the system takes it as a prediction error and learns from it, see
 * mailReview.ts). Turned into the agent's edits by code: the title replaced; in another collection the title,
 * the note and the day move (the day to that collection's date field), and what was chosen among the first
 * collection's options does not. Null fields: nothing to change.
 */
export function acceptEdits(
  store: UserStore,
  p: ProposalRow,
  req: { title?: unknown; collection?: unknown },
): { type?: string; values?: Record<string, Json | null> } | { error: string } {
  if (req.title === undefined && req.collection === undefined) return {};
  if (p.tool !== "entities.create") return { error: "edit-not-allowed" };
  const stored = (p.args as { values?: { type?: Val; values?: Val } }).values ?? {};
  const ro = readStore(store);
  const types = Object.values(ro.schema().types);
  const oldKey = stored.type ? plain(stored.type) : null;
  const old = types.find((t) => t.key === oldKey);
  const vals = (stored.values ? plain(stored.values) : {}) as Record<string, Json>;
  const titleKey =
    "title" in vals ? "title" : (old?.fields.find((f) => f.id === old.titleField)?.key ?? "title");
  const out: { type?: string; values: Record<string, Json | null> } = { values: {} };
  if (req.title !== undefined) {
    const title = typeof req.title === "string" ? req.title.replace(/\s+/g, " ").trim() : "";
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
    if (!title || [...title].length > 300 || /[\u0000-\u001f\u007f]/.test(title))
      return { error: "bad-title" };
    out.values[titleKey] = title;
  }
  if (req.collection !== undefined && req.collection !== old?.id) {
    const t = types.find((x) => x.id === req.collection);
    if (!t || t.system || t.archived) return { error: "bad-collection" };
    out.type = t.key;
    const dayKey = old?.fields.find(
      (f) => f.type === "date" && typeof vals[f.key] === "string",
    )?.key;
    for (const k of Object.keys(vals))
      if (k !== titleKey && k !== "body" && k !== "$body") out.values[k] = null;
    if (titleKey !== "title") {
      // The title goes under the name every collection has for its title field.
      out.values.title = out.values[titleKey] ?? vals[titleKey] ?? null;
      out.values[titleKey] = null;
    }
    const date = dueField(
      t,
      ro.list(t.id).map((e) => e.entity),
    );
    if (dayKey && date) out.values[date.key] = vals[dayKey] ?? null;
  }
  return out;
}
