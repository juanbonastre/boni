import { markdownToBlocks } from "@boni/views";
import { ChevronDown, FileText, Inbox, Mail, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ConfirmView, InboxCard, Proposal } from "../core/agent.ts";
import { acceptProposal, loadInbox, rejectProposal, toggleInbox, useStore } from "../store.ts";
import { CallRows } from "./Chat.tsx";

/**
 * The inbox (Juan, 2026-10-22): a panel on the right that comes out when something new arrives, and the same cards
 * in Conversación → Bandeja. A card says what the proposal does ("Añadir tarea a Docencia"), where it came from
 * (the mailbox and the sender, or the note edited by hand), its day with what is already there (the proposal drawn
 * with a dashed border), and Aceptar / Rechazar. Compact when the source said everything and it happened before
 * (three days, little text), detailed otherwise (the mail's words, the fields, one day): the server's code decides,
 * and "Más detalles" opens it anyway. Everything is painted as text from the server's values: nothing is followed.
 */
export function InboxPanel() {
  const t = useStore((s) => s.t);
  const open = useStore((s) => s.inboxOpen);
  const inbox = useStore((s) => s.inbox);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      if (e.key === "Escape" && !e.defaultPrevented && !st.settingsOpen && !st.panel) {
        e.preventDefault();
        toggleInbox(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;
  return (
    <aside className="side-panel inbox-panel" aria-label={t("inbox.title")}>
      <header className="panel-head">
        <h2>{inbox.length ? t("inbox.titleN", { n: inbox.length }) : t("inbox.title")}</h2>
        <button
          type="button"
          className="icon-btn"
          onClick={() => toggleInbox(false)}
          title={t("settings.close")}
          aria-label={t("settings.close")}
        >
          <X size={16} strokeWidth={1.8} />
        </button>
      </header>
      <div className="panel-body inbox-list">
        {inbox.length === 0 && <p className="muted center-note">{t("inbox.empty")}</p>}
        {inbox.map((p) => (
          <ProposalCard key={p.id} p={p} />
        ))}
      </div>
    </aside>
  );
}

/** The top bar's way into the inbox: its count, the panel open or closed. */
export function InboxButton() {
  const t = useStore((s) => s.t);
  const n = useStore((s) => s.inbox.length);
  const open = useStore((s) => s.inboxOpen);
  useEffect(() => {
    void loadInbox();
  }, []);
  return (
    <button
      type="button"
      className={`pill inbox-btn${open ? " on" : ""}`}
      aria-pressed={open}
      onClick={() => toggleInbox()}
    >
      <Inbox size={14} strokeWidth={1.8} />
      <span>{n ? t("inbox.titleN", { n }) : t("inbox.title")}</span>
    </button>
  );
}

const fileName = (path: string) => (path.split("/").pop() ?? path).replace(/\.md$/i, "");

/** What the proposal does, in words made by code from its arguments. */
function headline(t: ReturnType<typeof useStore.getState>["t"], p: Proposal, c: InboxCard | null) {
  if (c?.action === "create" && c.collection)
    return t(`inbox.add.${c.kind}`, { collection: c.collection });
  if (c?.action === "update" && c.source?.kind === "note")
    return t("inbox.noteEdited", { note: fileName(c.source.path) });
  if (c?.action === "delete" && c.source?.kind === "note")
    return t("inbox.noteRemoved", { note: fileName(c.source.path) });
  return p.view?.title ?? p.tool;
}

function useDayFormat() {
  const lang = useStore((s) => s.settings.language);
  return {
    long: (day: string) =>
      new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "es-ES", {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }).format(new Date(`${day}T12:00:00Z`)),
    short: (day: string) =>
      new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "es-ES", {
        weekday: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${day}T12:00:00Z`)),
  };
}

export function ProposalCard({ p, wide = false }: { p: Proposal; wide?: boolean }) {
  const t = useStore((s) => s.t);
  const c = p.card;
  const fmt = useDayFormat();
  const [more, setMore] = useState(c?.mode !== "compact");
  const when = c?.day
    ? `${fmt.long(c.day)}${c.start ? `, ${c.start}${c.end ? `–${c.end}` : ""}` : ""}`
    : null;
  const body = p.view?.rows.find((r) => r.arg === "values.body" || r.arg.endsWith(".body"));
  const rest: ConfirmView | null = p.view
    ? {
        ...p.view,
        rows: p.view.rows.filter(
          (r) => r !== body && !(r.arg === "note" && c?.source?.kind === "note"),
        ),
      }
    : null;
  // On the inbox's own page (more room), a detailed card from mail is two columns (Juan, 2026-10-23): the mail on
  // the left, the three days with the proposal on the right.
  const two = wide && more && c?.source?.kind === "mail" && !!c.day && c.context.length > 0;
  const source = (
    <>
      {c?.source?.kind === "mail" && (
        <p className="inbox-source">
          <Mail size={13} strokeWidth={1.8} aria-hidden="true" />
          <span>
            {c.source.account ?? t("inbox.mail")}
            {c.source.from ? ` · ${c.source.from}` : ""}
          </span>
        </p>
      )}
      {c?.source?.kind === "note" && (
        <p className="inbox-source">
          <FileText size={13} strokeWidth={1.8} aria-hidden="true" />
          <span>{c.source.path}</span>
        </p>
      )}
      {(c?.title || when) && (
        <p className="inbox-what">
          {c?.title && <span className="inbox-title">{c.title}</span>}
          {when && <span className="muted"> · {when}</span>}
        </p>
      )}
    </>
  );
  const mail = more && c?.source?.kind === "mail" && (c.source.subject || c.source.excerpt) && (
    <div className="inbox-mail">
      {c.source.subject && <p className="inbox-subject">{c.source.subject}</p>}
      {c.source.excerpt && (
        <p className={`inbox-quote${two ? " long" : ""}`}>«{c.source.excerpt}»</p>
      )}
    </div>
  );
  const days = c?.day && c.context.length > 0 && (
    <MiniDays
      days={more && !two ? c.context.filter((d) => d.day === c.day) : c.context}
      proposed={{ day: c.day, start: c.start, end: c.end, title: c.title ?? "" }}
      short={fmt.short}
    />
  );
  const fields = (
    <>
      {more &&
        rest &&
        rest.rows.length > 0 &&
        (c ? <FieldRows view={rest} card={c} day={fmt.long} /> : <CallRows view={rest} />)}
      {more && body && typeof body.value === "string" && (
        <div className="inbox-body">
          <MarkdownPreview text={body.value} />
        </div>
      )}
    </>
  );
  return (
    <section
      className={`card proposal inbox-card${more ? " detailed" : " compact"}${two ? " two" : ""}`}
    >
      <header className="inbox-card-head">
        <h3>{headline(t, p, c)}</h3>
      </header>
      {two ? (
        <div className="inbox-two">
          <div className="inbox-col">
            {source}
            {mail}
            {fields}
          </div>
          <div className="inbox-col">{days}</div>
        </div>
      ) : (
        <>
          {source}
          {mail}
          {days}
          {fields}
        </>
      )}
      <div className="inbox-actions">
        <button type="button" className="btn primary" onClick={() => void acceptProposal(p.id)}>
          {t("inbox.accept")}
        </button>
        <button type="button" className="btn" onClick={() => void rejectProposal(p.id)}>
          {t("inbox.reject")}
        </button>
        <span className="spacer" />
        <button
          type="button"
          className={`btn ghost small inbox-more${more ? " open" : ""}`}
          aria-expanded={more}
          onClick={() => setMore(!more)}
        >
          {more ? t("inbox.less") : t("inbox.more")}
          <ChevronDown size={13} strokeWidth={1.8} />
        </button>
      </div>
    </section>
  );
}

/**
 * The proposal's fields, each with its name and value: where it came from is said once (the source line), not on
 * every row (Juan, 2026-10-22). What will not be applied says so. Text only.
 */
function FieldRows({
  view,
  card,
  day,
}: {
  view: ConfirmView;
  card: InboxCard;
  day: (d: string) => string;
}) {
  const t = useStore((s) => s.t);
  // What the card's line already says (the title, the day, the times) is not repeated below it.
  const said = new Set([card.title, card.day, card.start, card.end].filter(Boolean));
  const rows = view.rows.filter(
    (r) =>
      r.arg !== "type" && r.role !== "type" && !(typeof r.value === "string" && said.has(r.value)),
  );
  if (!rows.length) return null;
  return (
    <dl className="inbox-fields">
      {rows.map((r) => {
        const ignored = r.arg === "ignored" || r.arg.startsWith("ignored");
        const name = ignored
          ? t("inbox.notApplied")
          : (r.name ?? r.arg.replace(/^values\./, "").replace(/^id$/, t("inbox.element")));
        const value = r.detail ?? r.value;
        const text = typeof value === "string" ? value : JSON.stringify(value);
        return (
          <div key={r.arg} className={`inbox-field${ignored ? " warn" : ""}`}>
            <dt>{name}</dt>
            <dd>{/^\d{4}-\d{2}-\d{2}$/.test(text) ? day(text) : text}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * The days around the proposal: what is already there, in time order, and the proposal among it with a dashed
 * border (an entry without time first, as a day's task). A list, not a scaled grid: readable in a narrow panel.
 */
function MiniDays({
  days,
  proposed,
  short,
}: {
  days: InboxCard["context"];
  proposed: { day: string; start: string | null; end: string | null; title: string };
  short: (day: string) => string;
}) {
  const t = useStore((s) => s.t);
  const MAX = 5;
  return (
    <div
      className="mini-days"
      style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
    >
      {days.map((d) => {
        const items = [
          ...d.items.map((i) => ({ ...i, proposed: false })),
          ...(d.day === proposed.day ? [{ ...proposed, proposed: true }] : []),
        ].sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
        const shown = items.slice(0, MAX);
        if (items.length > MAX && !shown.some((i) => i.proposed)) {
          const mine = items.find((i) => i.proposed);
          if (mine) shown[MAX - 1] = mine;
        }
        return (
          <div key={d.day} className={`mini-day${d.day === proposed.day ? " target" : ""}`}>
            <div className="mini-day-head">{short(d.day)}</div>
            {items.length === 0 && <div className="mini-empty muted">{t("inbox.free")}</div>}
            {shown.map((i, n) => (
              <div
                key={`${i.title}-${n}`}
                className={`mini-item${i.proposed ? " proposed" : ""}`}
                title={i.title}
              >
                {i.start && <span className="mini-time">{i.start}</span>}
                <span className="mini-title">{i.title || t("page.untitled")}</span>
              </div>
            ))}
            {items.length > MAX && (
              <div className="mini-more muted">
                {t("inbox.moreItems", { n: items.length - MAX })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A note's Markdown as reading text (headings, lists, to-dos, quotes, code): never HTML, never a link followed. */
function MarkdownPreview({ text }: { text: string }) {
  const blocks = markdownToBlocks(text).slice(0, 60);
  return (
    <div className="md-preview">
      {blocks.map((b) => {
        switch (b.type) {
          case "heading":
            return (
              <p key={b.id} className={`md-h md-h${b.level ?? 1}`}>
                {b.text}
              </p>
            );
          case "bullet":
          case "numbered":
            return (
              <p key={b.id} className="md-li">
                {b.type === "bullet" ? "• " : "· "}
                {b.text}
              </p>
            );
          case "todo":
            return (
              <p key={b.id} className="md-li">
                {b.done ? "☑ " : "☐ "}
                {b.text}
              </p>
            );
          case "quote":
            return (
              <p key={b.id} className="md-quote">
                {b.text}
              </p>
            );
          case "code":
            return (
              <pre key={b.id} className="md-code">
                {b.text}
              </pre>
            );
          case "divider":
            return <hr key={b.id} />;
          default:
            return "text" in b ? (
              <p key={b.id} className="md-p">
                {String(b.text)}
              </p>
            ) : null;
        }
      })}
    </div>
  );
}
