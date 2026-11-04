/**
 * A mail in its webmail (task 55): the address that opens it there by its Message-ID, built by code from the id
 * Boni kept, never from the mail's text. Only Gmail has one (a search by `rfc822msgid`, which lands on the
 * thread); Outlook's web has no link by Message-ID, so other mailboxes get none.
 */

/** The webmail of a mailbox, by its IMAP host. */
export function webmailOf(host: string): "gmail" | null {
  return /(^|\.)(gmail|googlemail)\.com$/i.test(host.trim()) ? "gmail" : null;
}

/** Where the mail with `messageId` opens in the mailbox's webmail, or null. */
export function webmailLink(
  host: string,
  messageId: string | null | undefined,
): { name: string; url: string } | null {
  const id = (messageId ?? "").trim().replace(/^<|>$/g, "");
  if (!id || id.length > 300 || /[\s<>"']/.test(id)) return null;
  if (webmailOf(host) === "gmail")
    return {
      name: "Gmail",
      url: `https://mail.google.com/mail/u/0/#search/rfc822msgid:${encodeURIComponent(id)}`,
    };
  return null;
}
