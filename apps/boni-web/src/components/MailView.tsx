// A mail as a mail client shows it (Juan, 2026-11-02): who, to whom, when, the subject, the text and the attachments' names; read only, what arrived.
import { Paperclip } from "lucide-react";
import type { DataRow, DataType } from "../core/agent.ts";
import { agentApi, openFile, useStore } from "../store.ts";

/**
 * The row of a mail's collection opened as a mail, not as a page: its header (from, to, cc, when), the subject, the
 * attachments by name and the text as it came, all painted as text (it is outside text: never markup). Nothing
 * here edits: the collection is read only (D-22), and nothing says so (Juan, 2026-11-02: no explanations in the app).
 */
export function MailView({
  type,
  row,
  titles,
}: {
  type: DataType;
  row: DataRow;
  /** The titles of what the row points to: its attachments' names. */
  titles: Record<string, string>;
}) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  // Its attachments as files of the account (the relation the mail keeps), each opened by a click; without them
  // (an older mail), their names as the mail listed them.
  const filesField = type.fields.find((x) => x.key === "archivos" && x.type === "relation");
  const fileIds =
    filesField && Array.isArray(row.values[filesField.id])
      ? (row.values[filesField.id] as string[])
      : [];
  const filesType = useStore((s) =>
    s.dataTypes?.find((x) => x.id === filesField?.relation?.target),
  );
  const open = async (id: string) => {
    const r = await agentApi.dataRow(id);
    const f = filesType?.fields.find((x) => x.type === "file");
    const sha = f && r ? r.values[f.id] : null;
    if (typeof sha === "string") await openFile(sha, titles[id] || t("db.file"));
  };
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
        {fileIds.length > 0 ? (
          <div className="mail-line">
            <dt>{t("mail.attachments")}</dt>
            <dd>
              {fileIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="mail-attachment mail-file"
                  onClick={() => void open(id)}
                >
                  <Paperclip size={12} strokeWidth={2} aria-hidden="true" />
                  {titles[id] || t("db.file")}
                </button>
              ))}
            </dd>
          </div>
        ) : (
          attachments.length > 0 && (
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
          )
        )}
      </dl>
      <pre className="mail-body">{row.body ?? ""}</pre>
    </article>
  );
}
