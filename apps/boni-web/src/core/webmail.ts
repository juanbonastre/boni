/**
 * A mail in its webmail (tasks 55 and 68): only Gmail has one, known by the mailbox's host; the server gives the
 * address of the mail itself (its Gmail thread, in its account: `GET /api/mail/webmail/:id`), never built from the
 * mail's text. Outlook's web has no link by Message-ID, so other mailboxes get none.
 */

/** The webmail of a mailbox, by its IMAP host. */
export function webmailOf(host: string): "gmail" | null {
  return /(^|\.)(gmail|googlemail)\.com$/i.test(host.trim()) ? "gmail" : null;
}
