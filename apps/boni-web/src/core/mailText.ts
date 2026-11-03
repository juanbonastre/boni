/**
 * A mail's text as a mail app shows it (task 48): the reply's quoted part found and folded away, and the
 * placeholders a webmail writes for its inline images («[image: foto.jpg]») taken out when the images themselves
 * are shown. Pure text in, pure text out: nothing here paints markup.
 */

/** Where a quoted earlier message starts, by the lines mail apps write before it (Spanish and English). */
const QUOTE_STARTS: RegExp[] = [
  // Gmail and Apple Mail: «El mar, 3 nov 2026, 10:12, Nombre <…> escribió:», sometimes wrapped onto two lines.
  /^(?:El|On) [^\n]{3,200}?(?:\n[^\n]{0,160})?(?:escribi[o\u00f3]|wrote):[ \t]*$/m,
  // Outlook: a separator line, then «De:» / «From:».
  /^-{2,}\s*(?:Original Message|Mensaje original|Mensaje reenviado|Forwarded message)\s*-{2,}[ \t]*$/im,
  /^_{8,}[ \t]*\n(?:De|From):/m,
  /^(?:De|From): [^\n]+\n(?:Enviado(?: el)?|Sent|Fecha|Date): /m,
  // The quote marks themselves.
  /^>/m,
];

/** The text and, when a reply quotes an earlier message, that quoted part apart (""); never all of it. */
export function splitQuote(body: string): { text: string; quote: string } {
  let at = -1;
  for (const re of QUOTE_STARTS) {
    const m = re.exec(body);
    if (m && m.index > 0 && (at < 0 || m.index < at)) at = m.index;
  }
  if (at <= 0) return { text: body, quote: "" };
  const text = body.slice(0, at).replace(/\s+$/, "");
  if (!text.trim()) return { text: body, quote: "" };
  return { text, quote: body.slice(at).trim() };
}

/** The text without a webmail's placeholders for the images it showed in place (they are shown apart). */
export const withoutImagePlaceholders = (text: string): string =>
  text
    .replace(/[ \t]*\[(?:image|imagen|cid): ?[^\]\n]{1,200}\][ \t]*/gi, "")
    .replace(/\n{3,}/g, "\n\n");

/** A file name that is an image a page can paint (never svg: it can carry scripts). */
export const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif)$/i;
