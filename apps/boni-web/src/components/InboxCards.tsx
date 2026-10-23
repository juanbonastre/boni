import { markdownToBlocks } from "@boni/views";
import { ChevronDown, FileText, Inbox, Mail, Maximize2, Pencil, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ConfirmView, InboxCard, Proposal } from "../core/agent.ts";
import {
  acceptProposal,
  closeProposal,
  dismissProposal,
  loadDataTypes,
  loadInbox,
  openMail,
  openProposal,
  rejectProposal,
  toggleInbox,
  useStore,
} from "../store.ts";
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

/**
 * Correcting a proposal before accepting it (Juan, 2026-10-23): its title and the collection it goes to. The
 * server keeps what changed as a mistake of the reading, and the reviewer learns from it.
 */
function useCorrection(p: Proposal) {
  const t = useStore((s) => s.t);
  const types = useStore((s) => s.dataTypes);
  const c = p.card;
  const [edit, setEdit] = useState<{ title: string; collection: string } | null>(null);
  const can = c?.action === "create" && !!c.collectionId;
  const start = () => {
    if (!types) void loadDataTypes();
    setEdit({ title: c?.title ?? "", collection: c?.collectionId ?? "" });
  };
  const edits = () => {
    if (!edit || !c) return undefined;
    const out: { title?: string; collection?: string } = {};
    const title = edit.title.replace(/\s+/g, " ").trim();
    if (title && title !== c.title) out.title = title;
    if (edit.collection && edit.collection !== c.collectionId) out.collection = edit.collection;
    return out.title || out.collection ? out : undefined;
  };
  const options = [
    ...(types ?? []).filter((x) => x.zone === undefined && x.level !== "private"),
  ].sort((a, b) => a.name.localeCompare(b.name));
  if (c?.collectionId && !options.some((x) => x.id === c.collectionId))
    options.unshift({ id: c.collectionId, name: c.collection ?? "" } as (typeof options)[number]);
  const form = edit && (
    <div className="inbox-correct">
      <label className="inbox-correct-row">
        <span>{t("inbox.correctTitle")}</span>
        <input
          className="input"
          value={edit.title}
          maxLength={300}
          onChange={(e) => setEdit({ ...edit, title: e.target.value })}
        />
      </label>
      <label className="inbox-correct-row">
        <span>{t("inbox.correctCollection")}</span>
        <select
          className="input"
          value={edit.collection}
          onChange={(e) => setEdit({ ...edit, collection: e.target.value })}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <div className="inbox-correct-foot">
        <p className="muted small">{t("inbox.correctHelp")}</p>
        <button type="button" className="btn ghost small" onClick={() => setEdit(null)}>
          {t("inbox.cancelCorrect")}
        </button>
      </div>
    </div>
  );
  const button = can && (
    <button
      type="button"
      className={`icon-btn inbox-fix${edit ? " on" : ""}`}
      aria-pressed={!!edit}
      title={t("inbox.correct")}
      aria-label={t("inbox.correct")}
      onClick={() => (edit ? setEdit(null) : start())}
    >
      <Pencil size={14} strokeWidth={1.8} />
    </button>
  );
  return { form, button, edits };
}

export function ProposalCard({ p, wide = false }: { p: Proposal; wide?: boolean }) {
  const t = useStore((s) => s.t);
  const c = p.card;
  const fmt = useDayFormat();
  const [more, setMore] = useState(c?.mode !== "compact");
  const fix = useCorrection(p);
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
      {c?.source?.kind === "mail" && <MailSource source={c.source} />}
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
      {c.why && <Why why={c.why} />}
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
        {fix.button}
        <button
          type="button"
          className="icon-btn inbox-open"
          onClick={() => void openProposal(p.id)}
          title={t("inbox.open")}
          aria-label={t("inbox.open")}
        >
          <Maximize2 size={14} strokeWidth={1.8} />
        </button>
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
      {fix.form}
      <div className="inbox-actions">
        <DecideButtons
          id={p.id}
          accept={() => void acceptProposal(p.id, fix.edits())}
          reject={() => void rejectProposal(p.id)}
        />
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
 * Aceptar and Rechazar of one proposal: the one clicked turns into a spinner while the server answers (Juan,
 * 2026-10-23), both stay off meanwhile, and other cards can be decided. A failure says why under them; one that
 * can no longer be decided (stale, already decided) can be taken out of the list.
 */
function DecideButtons({
  id,
  accept,
  reject,
}: {
  id: string;
  accept: () => void;
  reject: () => void;
}) {
  const t = useStore((s) => s.t);
  const busy = useStore((s) => s.deciding[id]);
  const failed = useStore((s) => s.decideErrors[id]);
  return (
    <>
      <button
        type="button"
        className={`btn primary decide-btn${busy === "accept" ? " busy" : ""}`}
        disabled={!!busy || !!failed?.gone}
        aria-busy={busy === "accept"}
        aria-label={busy === "accept" ? t("inbox.accepting") : undefined}
        onClick={accept}
      >
        <span className="decide-label">{t("inbox.accept")}</span>
        {busy === "accept" && <span className="spinner" aria-hidden="true" />}
      </button>
      <button
        type="button"
        className={`btn decide-btn${busy === "reject" ? " busy" : ""}`}
        disabled={!!busy || !!failed?.gone}
        aria-busy={busy === "reject"}
        aria-label={busy === "reject" ? t("inbox.rejecting") : undefined}
        onClick={reject}
      >
        <span className="decide-label">{t("inbox.reject")}</span>
        {busy === "reject" && <span className="spinner" aria-hidden="true" />}
      </button>
      {failed && (
        <p className="decide-error" role="alert">
          <span>{failed.text}</span>
          {failed.gone && (
            <button type="button" className="btn ghost small" onClick={() => dismissProposal(id)}>
              {t("inbox.dismiss")}
            </button>
          )}
        </p>
      )}
    </>
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
  all = false,
}: {
  view: ConfirmView;
  card: InboxCard;
  day: (d: string) => string;
  /** Every value, the title and the day too (the proposal's own page). */
  all?: boolean;
}) {
  const t = useStore((s) => s.t);
  // What the card's line already says (the title, the day, the times) is not repeated below it.
  const said = new Set(all ? [] : [card.title, card.day, card.start, card.end].filter(Boolean));
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
        const text =
          typeof value === "string"
            ? value
            : typeof value === "boolean"
              ? t(value ? "inbox.yes" : "inbox.no")
              : JSON.stringify(value);
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

/** Where a mail proposal came from (mailbox and sender), with "Ver correo": its own row in Boni. */
function MailSource({ source }: { source: Extract<InboxCard["source"], { kind: "mail" }> }) {
  const t = useStore((s) => s.t);
  return (
    <p className="inbox-source">
      <Mail size={13} strokeWidth={1.8} aria-hidden="true" />
      <span className="inbox-source-text">
        {source.account ?? t("inbox.mail")}
        {source.from ? ` · ${source.from}` : ""}
      </span>
      {source.open && (
        <button
          type="button"
          className="btn ghost small inbox-see-mail"
          onClick={() => source.open && openMail(source.open)}
        >
          {t("inbox.seeMail")}
        </button>
      )}
    </p>
  );
}

/** Why the proposal was made: the mail's words (in quotes only when the server found them in the mail). */
function Why({ why }: { why: NonNullable<InboxCard["why"]> }) {
  const t = useStore((s) => s.t);
  return (
    <p className="inbox-why" title={why.verbatim ? undefined : t("inbox.whySummary")}>
      <span className="inbox-why-label">{t("inbox.why")}: </span>
      {why.verbatim ? `«${why.text}»` : why.text}
    </p>
  );
}

/**
 * A proposal on a page of its own (Juan, 2026-10-23: its row could not be opened), read-only: what it would add
 * with every value and its note, why it was made, where it came from (with "Ver correo") and the days around it.
 * Accepted or rejected here, it goes back to where it was opened from.
 */
export function ProposalPage({ id, onDone }: { id: string; onDone?: () => void }) {
  const t = useStore((s) => s.t);
  const p = useStore((s) => s.inbox.find((x) => x.id === id));
  const loading = useStore((s) => s.inboxLoading);
  if (!p)
    return (
      <div className="content proposal-page">
        {!loading && <p className="muted center-note">{t("inbox.gone")}</p>}
      </div>
    );
  return <ProposalPageOf p={p} onDone={onDone} />;
}

function ProposalPageOf({ p, onDone }: { p: Proposal; onDone?: () => void }) {
  const t = useStore((s) => s.t);
  const id = p.id;
  const fmt = useDayFormat();
  const fix = useCorrection(p);
  const c = p.card;
  const body = p.view?.rows.find((r) => r.arg === "values.body" || r.arg.endsWith(".body"));
  const rows: ConfirmView | null = p.view
    ? {
        ...p.view,
        rows: p.view.rows.filter(
          (r) => r !== body && !(r.arg === "note" && c?.source?.kind === "note"),
        ),
      }
    : null;
  const decide = async (accept: boolean) => {
    await (accept ? acceptProposal(id, fix.edits()) : rejectProposal(id));
    const s = useStore.getState();
    // A failed decision stays on the page, saying why under its buttons.
    if (s.decideErrors[id]) return;
    if (s.view.kind === "proposal" && s.view.id === id) closeProposal();
    onDone?.();
  };
  return (
    <div className="content proposal-page">
      <header className="pp-head">
        <p className="pp-kind">
          <span className="ghost-tag">{t("ghost.proposed")}</span>
          <span className="muted">{headline(t, p, c)}</span>
        </p>
        <div className="pp-title-row">
          <h2 className="pp-title">{c?.title ?? headline(t, p, c)}</h2>
          {fix.button}
        </div>
      </header>
      {rows && rows.rows.length > 0 && (
        <section className="pp-section">
          <h3>{t("inbox.properties")}</h3>
          {c ? <FieldRows view={rows} card={c} day={fmt.long} all /> : <CallRows view={rows} />}
        </section>
      )}
      {body && typeof body.value === "string" && body.value.trim() && (
        <section className="pp-section">
          <h3>{t("inbox.note")}</h3>
          <div className="inbox-body">
            <MarkdownPreview text={body.value} />
          </div>
        </section>
      )}
      {c?.why && (
        <section className="pp-section">
          <h3>{t("inbox.why")}</h3>
          <p className={`pp-why${c.why.verbatim ? " verbatim" : ""}`}>
            {c.why.verbatim ? `«${c.why.text}»` : c.why.text}
          </p>
          {!c.why.verbatim && <p className="muted small">{t("inbox.whySummary")}</p>}
        </section>
      )}
      {c?.source && (
        <section className="pp-section">
          <h3>{t("inbox.origin")}</h3>
          {c.source.kind === "mail" ? (
            <>
              <MailSource source={c.source} />
              {c.source.subject && <p className="inbox-subject">{c.source.subject}</p>}
              {c.source.excerpt && <p className="inbox-quote long">«{c.source.excerpt}»</p>}
            </>
          ) : (
            <p className="inbox-source">
              <FileText size={13} strokeWidth={1.8} aria-hidden="true" />
              <span>{c.source.path}</span>
            </p>
          )}
        </section>
      )}
      {c?.day && c.context.length > 0 && (
        <section className="pp-section">
          <h3>{t("inbox.days")}</h3>
          <MiniDays
            days={c.context}
            proposed={{ day: c.day, start: c.start, end: c.end, title: c.title ?? "" }}
            short={fmt.short}
          />
        </section>
      )}
      {fix.form}
      <div className="inbox-actions">
        <DecideButtons id={id} accept={() => void decide(true)} reject={() => void decide(false)} />
      </div>
    </div>
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
