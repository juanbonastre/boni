/**
 * The mail's two icons (tasks 68 and 74; Juan, 2026-11-05: buttons as icons, not text a long sender hides; then «el
 * mini icono es demasiado pequeño para verlo, se ve raro»): each one drawing, its mark part of it at the same stroke,
 * never a tiny badge on its corner.
 */

/** A mail kept in Boni: an envelope with an arrow down beside it, the mail brought in (task 74). */
export function KeptMail() {
  return (
    <svg
      className="mail-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden="true"
    >
      <rect x="2" y="5" width="14" height="11" rx="2" />
      <path d="m2.5 6.5 6.5 4.5 6.5-4.5" />
      <path d="M20 9v10" />
      <path d="m17 16 3 3 3-3" />
    </svg>
  );
}

/** Gmail's envelope in its colours and, at its upper right, the arrow of what opens outside Boni (task 74). */
export function GmailMark() {
  return (
    <svg
      className="mail-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      focusable="false"
      aria-hidden="true"
    >
      <g transform="translate(0 5) scale(0.74)">
        <path fill="#4285F4" d="M3.5 19H6v-8.8L2 7.2v10.3A1.5 1.5 0 0 0 3.5 19z" />
        <path fill="#34A853" d="M18 19h2.5a1.5 1.5 0 0 0 1.5-1.5V7.2l-4 3z" />
        <path fill="#FBBC04" d="M18 5.4v4.8l4-3V6.5c0-1.4-1.6-2.2-2.7-1.4z" />
        <path fill="#EA4335" d="M6 10.2V5.4l6 4.5 6-4.5v4.8l-6 4.5z" />
        <path fill="#C5221F" d="M2 6.5v.7l4 3V5.4L4.7 4.5C3.6 3.7 2 4.5 2 6.5z" />
      </g>
      <path
        d="M16.5 2.5H22v5.5M22 2.5l-6.5 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
