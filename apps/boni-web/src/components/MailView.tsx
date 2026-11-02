// A mail as a mail client shows it (Juan, 2026-11-02): who, to whom, when, the subject, the text and the attachments' names; read only, what arrived.
import type { DataRow, DataType } from "../core/agent.ts";
import { useStore } from "../store.ts";

/**
 * The row of a mail's collection opened as a mail, not as a page: its header (from, to, cc, when), the subject, the
 * attachments by name and the text as it came, all painted as text (it is outside text: never markup). Nothing
 * here edits: the collection is read only (D-22), and nothing says so (Juan, 2026-11-02: no explanations in the app).
 */
export function MailView({ type, row }: { type: DataType; row: DataRow }) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const byKey = (key: string) => {
    const f = type.fields.find((x) => x.key === key);
    const v = f ? row.values[f.id] : null;
    return typeof v === "string" ? v : "";
  };
  const name = byKey("de_nombre");
  const from = byKey("de");
  const when = byKey("fecha");
  const at = Date.parse(when);
  const date = Number.isFinite(at)
    ? new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "es-ES", {
        dateStyle: "full",
        timeStyle: "short",
      }).format(new Date(at))
    : when;
  const attachments = byKey("adjuntos")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const line = (key: string, text: string) =>
    text ? (
      <div className="mail-line" key={key}>
        <dt>{t(`mail.${key}`)}</dt>
        <dd>{text}</dd>
      </div>
    ) : null;
  return (
    <article className="mail-view" aria-label={t("mail.view")}>
      <h1 className="mail-subject">{byKey("asunto") || t("page.untitled")}</h1>
      <dl className="mail-head">
        {line("from", name && from ? `${name} <${from}>` : name || from)}
        {line("to", byKey("para"))}
        {line("cc", byKey("cc"))}
        {line("date", date)}
        {attachments.length > 0 && (
          <div className="mail-line">
            <dt>{t("mail.attachments")}</dt>
            <dd>
              {attachments.map((a) => (
                <span key={a} className="mail-attachment">
                  {a}
                </span>
              ))}
            </dd>
          </div>
        )}
      </dl>
      <pre className="mail-body">{row.body ?? ""}</pre>
    </article>
  );
}
