// A mail as a mail client shows it (Juan, 2026-11-02): who, to whom, when, the subject, the text and the attachments' names; read only, what arrived.
import { Paperclip } from "lucide-react";
import { useEffect, useState } from "react";
import type { DataRow, DataType } from "../core/agent.ts";
import { IMAGE_FILE, splitQuote, withoutImagePlaceholders } from "../core/mailText.ts";
import { webmailOf } from "../core/webmail.ts";
import { agentApi, fileInline, mailboxHost, openFile, openWebmail, useStore } from "../store.ts";
import { GmailMark } from "./MailIcons.tsx";

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
  // The mail's own images (files it kept) painted after the text, and a reply's quoted part folded (task 48);
  // never an image from the net: only what Boni already keeps, as a data: address.
  const [images, setImages] = useState<{ id: string; name: string; src: string }[]>([]);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const imageIds = fileIds.filter((id) => IMAGE_FILE.test(titles[id] ?? ""));
  const imageKey = imageIds.join(",");
  useEffect(() => {
    let live = true;
    setImages([]);
    setQuoteOpen(false);
    void (async () => {
      const f = filesType?.fields.find((x) => x.type === "file");
      const out: { id: string; name: string; src: string }[] = [];
      for (const id of imageIds) {
        const r = await agentApi.dataRow(id);
        const sha = f && r ? r.values[f.id] : null;
        const src = typeof sha === "string" ? await fileInline(sha) : null;
        if (src) out.push({ id, name: titles[id] ?? "", src });
      }
      if (live) setImages(out);
    })();
    return () => {
      live = false;
    };
  }, [imageKey, row.id, filesType?.id]);
  const { text, quote } = splitQuote(row.body ?? "");
  const shown = images.length ? withoutImagePlaceholders(text) : text;
  const byKey = (key: string) => {
    const f = type.fields.find((x) => x.key === key);
    const v = f ? row.values[f.id] : null;
    return typeof v === "string" ? v : "";
  };
  // The same mail in its webmail (tasks 55 and 68): Gmail's own address of it, which the server finds.
  const [gmail, setGmail] = useState(false);
  useEffect(() => {
    let live = true;
    void mailboxHost().then((h) => live && setGmail(!!h && webmailOf(h) === "gmail"));
    return () => {
      live = false;
    };
  }, []);
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
      {gmail && (
        <p className="mail-actions">
          <button
            type="button"
            className="btn ghost small mail-webmail"
            onClick={() => void openWebmail(row.id)}
          >
            <GmailMark />
            {t("mail.inWebmail", { name: "Gmail" })}
          </button>
        </p>
      )}
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
      <pre className="mail-body">{shown}</pre>
      {quote &&
        (quoteOpen ? (
          <pre className="mail-body mail-quote">{quote}</pre>
        ) : (
          <button
            type="button"
            className="mail-quote-toggle"
            aria-label={t("mail.quoted")}
            title={t("mail.quoted")}
            onClick={() => setQuoteOpen(true)}
          >
            ···
          </button>
        ))}
      {images.length > 0 && (
        <div className="mail-images">
          {images.map((i) => (
            <img key={i.id} src={i.src} alt={i.name} />
          ))}
        </div>
      )}
    </article>
  );
}
