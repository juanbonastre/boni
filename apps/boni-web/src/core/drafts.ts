/**
 * What Juan is writing to a conversation and has not sent (docs/sistema.md §4.7, F9; task 85): its text and what he
 * pointed at for it (`Ctrl+Shift+E`). One draft per conversation, the same on its screen and in Boni's window, kept
 * when either closes. The conversation that is not made yet (it is made with its first message) has one too, which
 * goes with it when it is made.
 */
import type { Pointed } from "./pointing.ts";

export interface Draft {
  text: string;
  pointed: Pointed[];
}
/** The drafts, by conversation id (`NEW_DRAFT` for the one not made yet). */
export type Drafts = Readonly<Record<string, Draft>>;

const NEW_DRAFT = "new";
const NO_DRAFT: Draft = { text: "", pointed: [] };
const keyOf = (conversation: string | null) => conversation ?? NEW_DRAFT;

/** A conversation's draft (null: the one not made yet); the same empty one for every conversation without any. */
export const draftIn = (drafts: Drafts, conversation: string | null): Draft =>
  drafts[keyOf(conversation)] ?? NO_DRAFT;

/** The drafts with a conversation's changed. An empty one is no draft: nothing is kept of it. */
export function withDraft(
  drafts: Drafts,
  conversation: string | null,
  change: (d: Draft) => Draft,
): Drafts {
  const k = keyOf(conversation);
  const next = change(drafts[k] ?? NO_DRAFT);
  const { [k]: _was, ...rest } = drafts;
  return next.text || next.pointed.length ? { ...rest, [k]: next } : rest;
}

/**
 * The conversation not made yet is `made` now: what is being written to it (typed or pointed at while the server
 * made it) is that conversation's draft, never left for the next new one.
 */
export function madeDraft(drafts: Drafts, made: string): Drafts {
  const { [NEW_DRAFT]: draft, ...rest } = drafts;
  return draft ? { ...rest, [made]: draft } : rest;
}

/** The drafts without a conversation's (it was deleted). */
export function withoutDraft(drafts: Drafts, conversation: string): Drafts {
  const { [conversation]: _was, ...rest } = drafts;
  return rest;
}

/**
 * A conversation kept on the device that could not be read back (gone, or the server out of reach): what was being
 * written to it becomes the new conversation's draft, unless that one already has its own (I-35).
 */
export function draftToNew(drafts: Drafts, conversation: string): Drafts {
  const { [conversation]: draft, ...rest } = drafts;
  return draft && !rest[NEW_DRAFT] ? { ...rest, [NEW_DRAFT]: draft } : rest;
}
