/**
 * The mail's two icons (task 68; Juan, 2026-11-05: buttons as icons, not text a long sender hides): the mail kept in
 * Boni, and Gmail's envelope with the arrow of what opens outside.
 */
import { ArrowUpRight, Database, Mail } from "lucide-react";

/** A mail kept in Boni: an envelope with Boni's mark of data at its corner (task 68). */
export function KeptMail() {
  return (
    <span className="icon-stack" aria-hidden="true">
      <Mail size={15} strokeWidth={1.8} />
      <Database size={8} strokeWidth={2.6} className="icon-badge" />
    </span>
  );
}

/** Gmail's envelope in its colours, with the arrow of what opens outside Boni (task 68). */
export function GmailMark() {
  return (
    <span className="icon-stack" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="15" height="15" focusable="false" aria-hidden="true">
        <path fill="#4285F4" d="M3.5 19H6v-8.8L2 7.2v10.3A1.5 1.5 0 0 0 3.5 19z" />
        <path fill="#34A853" d="M18 19h2.5a1.5 1.5 0 0 0 1.5-1.5V7.2l-4 3z" />
        <path fill="#FBBC04" d="M18 5.4v4.8l4-3V6.5c0-1.4-1.6-2.2-2.7-1.4z" />
        <path fill="#EA4335" d="M6 10.2V5.4l6 4.5 6-4.5v4.8l-6 4.5z" />
        <path fill="#C5221F" d="M2 6.5v.7l4 3V5.4L4.7 4.5C3.6 3.7 2 4.5 2 6.5z" />
      </svg>
      <ArrowUpRight size={9} strokeWidth={2.6} className="icon-badge" />
    </span>
  );
}
