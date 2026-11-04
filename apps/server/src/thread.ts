/**
 * Threads of mail (task 46): which mails belong together, and whether two proposals say the same thing. A thread
 * is named by its first message's id (RFC 5322: the first of `References`, else `In-Reply-To`); a reply that lost
 * those headers joins by its subject («Re: …» of a recent mail). Two proposals are the same thing when their
 * titles match (`likeTitle`, shared with the calendar: @boni/calendar text.ts), and say the same when their day and
 * hours match too.
 */
import { likeTitle, normalizeTitle } from "@boni/calendar";

export { likeTitle, normalizeTitle };

/** A subject without its reply and forward marks («Re:», «RV:», «Fwd:»…), lower-case, one space between words. */
export function normalizeSubject(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/^(\s*(re|rv|fwd?|fw|tr|aw|sv|vs|wg)\s*(\[\d+\])?\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether a subject carries a reply or forward mark: only then may it join an earlier thread by its words. */
export const isReplySubject = (subject: string): boolean =>
  /^\s*(re|rv|fwd?|fw|tr|aw|sv|vs|wg)\s*(\[\d+\])?\s*:/i.test(subject);

/**
 * The thread a message belongs to: the first id of its References, else what it answers, else (a reply without
 * those headers) the thread of a recent mail with the same subject, else its own id.
 */
export function threadIdOf(
  m: { messageId: string; inReplyTo: string | null; references: string[]; subject: string },
  sameSubject: () => string | null,
  fallback: string,
): string {
  const root = m.references[0] ?? m.inReplyTo;
  if (root) return root.slice(0, 300);
  if (isReplySubject(m.subject)) {
    const earlier = sameSubject();
    if (earlier) return earlier;
  }
  return (m.messageId || fallback).slice(0, 300);
}

/** The day and the hours a proposal's values say, as one comparable text («2026-11-11 17:00–18:00»; "" when none). */
export function whenOf(rows: readonly { arg: string; value?: unknown }[]): string {
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const values = rows.filter((r) => r.arg.startsWith("values.")).map((r) => text(r.value));
  const day = values.find((v) => /^\d{4}-\d\d-\d\d$/.test(v)) ?? "";
  const times = values.filter((v) => /^\d\d:\d\d$/.test(v));
  return `${day}${times.length ? ` ${times.join("–")}` : ""}`.trim();
}

/** The same, in parts, for what a card says a proposal was before. */
export function whenParts(rows: readonly { arg: string; value?: unknown }[]): {
  day: string | null;
  start: string | null;
  end: string | null;
} {
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const values = rows.filter((r) => r.arg.startsWith("values.")).map((r) => text(r.value));
  const times = values.filter((v) => /^\d\d:\d\d$/.test(v));
  return {
    day: values.find((v) => /^\d{4}-\d\d-\d\d$/.test(v)) ?? null,
    start: times[0] ?? null,
    end: times[1] ?? null,
  };
}
