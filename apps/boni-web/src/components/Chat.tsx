import { CornerDownLeft, Inbox, ListChecks, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type ConfirmView,
  fillTemplate,
  isProposal,
  lowest,
  type Painted,
  type Pending,
  type Reply,
  type RunDetail,
  type RunSummary,
  reveal,
  textOf,
} from "../core/agent.ts";
import type { T } from "../i18n.ts";
import {
  acceptProposal,
  agentErrorText,
  answerAsk,
  type ChatEntry,
  confirmPending,
  declinePending,
  loadInbox,
  loadRunDetail,
  rejectProposal,
  sendTurn,
  showInbox,
  showLog,
  undoRun,
  useStore,
} from "../store.ts";
import { ProposalCard } from "./InboxCards.tsx";

/**
 * The conversation with Boni's agent (docs/nucleo.md, 7.14). Everything here is painted by this code from
 * labelled values: text is always text (React escapes it; nothing is HTML, Markdown or a link), what came from
 * outside carries a mark, and a confirmation shows the real values of the call with their origin and the
 * warnings against visual tricks, never a model's summary. Its button changes side every time.
 */
export function ChatView({ compact = false }: { compact?: boolean }) {
  const t = useStore((s) => s.t);
  const chat = useStore((s) => s.chat);
  const busy = useStore((s) => s.chatBusy);
  const inbox = useStore((s) => s.inbox);
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    void loadInbox();
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [chat]);
  return (
    <div className={`chat${compact ? " compact" : ""}`}>
      <div className="chat-tools">
        <button type="button" className="pill" onClick={showInbox}>
          <Inbox size={14} strokeWidth={1.8} />
          <span>{inbox.length ? t("inbox.titleN", { n: inbox.length }) : t("inbox.title")}</span>
        </button>
        <button type="button" className="pill" onClick={showLog}>
          <ListChecks size={14} strokeWidth={1.8} />
          <span>{t("log.title")}</span>
        </button>
      </div>
      <div className="chat-thread" aria-live="polite">
        {chat.length === 0 && <p className="muted center-note">{t("chat.empty")}</p>}
        {chat.map((e) => (
          <Turn key={e.id} entry={e} />
        ))}
        {busy && <p className="muted chat-busy">{t("chat.thinking")}</p>}
        <div ref={end} />
      </div>
      <Composer />
    </div>
  );
}

function Composer() {
  const t = useStore((s) => s.t);
  const busy = useStore((s) => s.chatBusy);
  const [text, setText] = useState("");
  const send = () => {
    if (!text.trim() || busy) return;
    void sendTurn(text);
    setText("");
  };
  return (
    <form
      className="chat-composer"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <textarea
        value={text}
        rows={2}
        maxLength={8000}
        placeholder={t("chat.placeholder")}
        aria-label={t("chat.placeholder")}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <button
        type="submit"
        className="btn primary"
        disabled={busy || !text.trim()}
        title={t("chat.send")}
      >
        <CornerDownLeft size={15} strokeWidth={2} />
        {t("chat.send")}
      </button>
    </form>
  );
}

function Turn({ entry }: { entry: ChatEntry }) {
  const t = useStore((s) => s.t);
  const r = entry.result;
  return (
    <div className="turn">
      <div className="turn-request">{entry.request}</div>
      <div className="turn-answer">
        {r?.replies.map((reply, i) => (
          <ReplyView key={i} reply={reply} />
        ))}
        {r?.pending?.kind === "ask" && <AskBox entryId={entry.id} pending={r.pending} />}
        {r?.pending?.kind === "confirm" && <ConfirmCard entryId={entry.id} view={r.pending.view} />}
        {r && <Notices t={t} result={r} />}
        {r?.status === "stopped" && r.error && (
          <p className="turn-error">{agentErrorText(t, r.error)}</p>
        )}
        {entry.error && <p className="turn-error">{entry.error}</p>}
        {r?.status === "done" && r.run && (
          <button type="button" className="link-btn turn-undo" onClick={() => void undoRun(r.run)}>
            <Undo2 size={13} strokeWidth={1.8} />
            {t("chat.undo")}
          </button>
        )}
      </div>
    </div>
  );
}

function Notices({ t, result }: { t: T; result: NonNullable<ChatEntry["result"]> }) {
  const shown = result.notices.filter((n) => n.code !== "denied");
  if (!shown.length) return null;
  return (
    <ul className="turn-notices">
      {shown.map((n, i) => (
        <li key={i}>
          {n.code === "proposals" ? (
            <button type="button" className="link-btn" onClick={showInbox}>
              {t("notice.proposals", { n: n.n ?? 1 })}
            </button>
          ) : (
            t(`notice.${n.code}`)
          )}
        </li>
      ))}
    </ul>
  );
}

/** A value as text, with a mark when it came from outside (an e-mail, a page) or from a model. */
export function ValueText({ p }: { p: Painted }) {
  const t = useStore((s) => s.t);
  if (isProposal(p)) return <span className="val-proposal">{t("chat.inInbox")}</span>;
  const integrity = lowest(p);
  const cls = integrity === "external" ? "val-ext" : integrity === "model" ? "val-model" : "val";
  return (
    <span className={cls} title={integrity === "external" ? t("chat.fromOutside") : undefined}>
      {textOf(p)}
    </span>
  );
}

/** A number in Juan's locale ("42,5"); anything else as text. */
function NumberText({ p }: { p: Painted }) {
  const lang = useStore((s) => s.settings.language);
  if (p.t === "v" && typeof p.value === "number")
    return (
      <span className={lowest(p) === "external" ? "val-ext" : "val"}>
        {new Intl.NumberFormat(lang === "en" ? "en-GB" : "es-ES", {
          maximumFractionDigits: 2,
        }).format(p.value)}
      </span>
    );
  return <ValueText p={p} />;
}

const fieldsOf = (spec: Painted | undefined): string[] | null => {
  if (!spec) return null;
  const v = textOf(spec);
  return v
    ? v
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    : null;
};

function ReplyView({ reply }: { reply: Reply }) {
  const d = reply.data;
  const caption = d.caption ? <div className="reply-caption">{textOf(d.caption)}</div> : null;
  switch (reply.component) {
    case "text": {
      const template = d.template ? textOf(d.template) : "";
      return (
        <p className="reply-text">
          {fillTemplate(template, { a: d.a, b: d.b, c: d.c, d: d.d }).map((part, i) =>
            "text" in part ? <span key={i}>{part.text}</span> : <ValueText key={i} p={part.slot} />,
          )}
        </p>
      );
    }
    case "number":
      return (
        <div className="reply-number">
          {caption}
          <span className="reply-figure">
            {d.value ? <NumberText p={d.value} /> : "—"}
            {d.unit ? <span className="reply-unit"> {textOf(d.unit)}</span> : null}
          </span>
        </div>
      );
    case "list": {
      const items = d.items?.t === "list" ? d.items.items : d.items ? [d.items] : [];
      const fields = fieldsOf(d.fields);
      return (
        <div className="reply-list">
          {caption}
          <ul>
            {items.map((item, i) => (
              <li key={i}>
                {item.t === "rec" && fields ? (
                  fields.map((f) =>
                    item.fields[f] ? <ValueText key={f} p={item.fields[f] as Painted} /> : null,
                  )
                ) : (
                  <ValueText p={item} />
                )}
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case "table": {
      const rows = d.rows?.t === "list" ? d.rows.items : [];
      const first = rows.find((r) => r.t === "rec");
      const fields =
        fieldsOf(d.fields) ??
        (first?.t === "rec"
          ? Object.keys(first.fields).filter((k) => k !== "id" && k !== "type")
          : []);
      return (
        <div className="reply-table">
          {caption}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {fields.map((f) => (
                    <th key={f}>{f}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {r.t === "rec" ? (
                      fields.map((f) => (
                        <td key={f}>
                          {r.fields[f] ? <ValueText p={r.fields[f] as Painted} /> : null}
                        </td>
                      ))
                    ) : (
                      <td colSpan={Math.max(1, fields.length)}>
                        <ValueText p={r} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
  }
}

function AskBox({
  entryId,
  pending,
}: {
  entryId: string;
  pending: Extract<Pending, { kind: "ask" }>;
}) {
  const t = useStore((s) => s.t);
  const busy = useStore((s) => s.chatBusy);
  const [text, setText] = useState("");
  return (
    <div className="ask">
      <p className="ask-prompt">
        <ValueText p={pending.prompt} />
      </p>
      {pending.control === "choice" ? (
        <div className="ask-options">
          {pending.options.map((o, i) => (
            <button
              key={i}
              type="button"
              className="pill"
              disabled={busy}
              onClick={() => void answerAsk(entryId, { choice: i })}
            >
              <ValueText p={o} />
            </button>
          ))}
        </div>
      ) : (
        <form
          className="ask-text"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) void answerAsk(entryId, { text });
          }}
        >
          {/* Never a password field: Boni does not ask for secrets here (docs/nucleo.md, 7.5). */}
          <input
            type="text"
            value={text}
            maxLength={500}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="btn" disabled={busy || !text.trim()}>
            {t("ask.answer")}
          </button>
        </form>
      )}
      <p className="muted small">{t("ask.noSecrets")}</p>
    </div>
  );
}

/** An argument's name for Juan: by its name when it is a known one ("Asunto"), else by its role ("Para"). */
function argLabel(t: T, arg: string, role: string): string {
  const byName = t(`argname.${arg}`);
  if (byName !== `argname.${arg}`) return byName;
  const byRole = t(`arg.${role}`);
  return byRole !== `arg.${role}` ? byRole : arg;
}

/** "values.autor" -> "autor": a record's field without a name from the schema. */
const fieldKey = (arg: string) => (arg.includes(".") ? arg.slice(arg.indexOf(".") + 1) : null);

/** "Enviar correo" -> "enviar correo", for the middle of a sentence. */
const lower = (s: string) => (s ? s[0]?.toLowerCase() + s.slice(1) : s);

/** Where a value came from, in words. */
function provenance(t: T, integrity: string, sources: string[]): string {
  const from = [...new Set(sources)].map((s) => t(`prov.source.${s}`)).join(", ");
  return from ? `${t(`prov.${integrity}`)} · ${from}` : t(`prov.${integrity}`);
}

function Marks({ marks }: { marks: string[] }) {
  const t = useStore((s) => s.t);
  if (!marks.length) return null;
  return (
    <ul className="confirm-marks">
      {marks.map((m) => {
        const [kind, extra] = m.split(":");
        return (
          <li key={m} className="mark-warn">
            {t(`mark.${kind}`, { domain: extra ?? "" })}
          </li>
        );
      })}
    </ul>
  );
}

/** The rows of a call painted from its real arguments: shared by confirmations and the inbox. */
export function CallRows({ view }: { view: ConfirmView }) {
  const t = useStore((s) => s.t);
  return (
    <dl className="confirm-rows">
      {view.rows.map((r) => (
        <div key={r.arg} className="confirm-row">
          <dt>{r.name ?? fieldKey(r.arg) ?? argLabel(t, r.arg, r.role)}</dt>
          <dd>
            <div className={`confirm-value${r.integrity === "external" ? " ext" : ""}`}>
              {r.detail ? (
                <>
                  {reveal(r.detail)}
                  {r.role !== "type" && <span className="muted small"> {reveal(r.value)}</span>}
                </>
              ) : (
                reveal(r.value)
              )}
            </div>
            <div className="confirm-prov muted small">{provenance(t, r.integrity, r.sources)}</div>
            <Marks marks={r.marks} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A confirmation: on its own surface with only the code's components; the accept button changes side every
 * time and only answers after a moment, so it is not accepted out of habit (docs/nucleo.md, 7.5).
 */
function ConfirmCard({ entryId, view }: { entryId: string; view: ConfirmView }) {
  const t = useStore((s) => s.t);
  const busy = useStore((s) => s.chatBusy);
  const flip = useStore((s) => s.confirmFlip);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    setArmed(false);
    const timer = setTimeout(() => setArmed(true), 700);
    return () => clearTimeout(timer);
  }, [view]);
  const accept = (
    <button
      key="accept"
      type="button"
      className="btn primary"
      disabled={busy || !armed}
      onClick={() => void confirmPending(entryId)}
    >
      {t("confirm.accept", { action: lower(view.title) })}
    </button>
  );
  const cancel = (
    <button
      key="cancel"
      type="button"
      className="btn"
      disabled={busy}
      onClick={() => void declinePending(entryId)}
    >
      {t("confirm.cancel")}
    </button>
  );
  return (
    <section className="confirm-card" aria-label={t("confirm.label")}>
      <h3>{t("confirm.title", { action: view.title })}</h3>
      <CallRows view={view} />
      <div className={`confirm-actions${flip ? " flipped" : ""}`}>
        {flip ? [cancel, accept] : [accept, cancel]}
      </div>
    </section>
  );
}

export function InboxView() {
  const t = useStore((s) => s.t);
  const inbox = useStore((s) => s.inbox);
  useEffect(() => {
    void loadInbox();
  }, []);
  return (
    <div className="agent-page">
      <p className="muted small">{t("inbox.help")}</p>
      {inbox.length === 0 && <p className="muted center-note">{t("inbox.empty")}</p>}
      {inbox.map((p) => (
        <ProposalCard key={p.id} p={p} wide />
      ))}
    </div>
  );
}

/** A reading that found nothing to do and changed nothing (Juan, 2026-10-22: grouped, not one line each). */
const quiet = (r: RunSummary) =>
  r.status === "done" &&
  (r.what?.kind === "mail" || r.what?.kind === "measure" || r.what?.kind === "review") &&
  !r.changed &&
  !(r.proposals && Object.values(r.proposals).some((n) => n > 0));

/** The Registro's entries: one per run, quiet readings in a row as one group. */
type LogEntry = { run: RunSummary } | { quiet: RunSummary[] };
function logEntries(runs: RunSummary[]): LogEntry[] {
  const out: LogEntry[] = [];
  for (const r of runs) {
    const last = out.at(-1);
    if (quiet(r) && last && "quiet" in last) last.quiet.push(r);
    else out.push(quiet(r) ? { quiet: [r] } : { run: r });
  }
  // A single quiet reading is an entry like any other.
  return out.map((e) =>
    "quiet" in e && e.quiet.length === 1 ? { run: e.quiet[0] as RunSummary } : e,
  );
}

/** What a run was, in Juan's words (made from the server's `what`; an older server gives only the origin). */
function runTitle(t: T, r: RunSummary): string {
  const w = r.what;
  switch (w?.kind) {
    case "request":
      return w.text ? t("log.what.request", { text: w.text }) : t("log.origin.turn");
    case "mail":
      return t("log.what.mail", { subject: w.subject });
    case "measure":
      return t("log.what.measure", { subject: w.subject });
    case "review":
      return t("log.what.review");
    case "note":
      return t(`log.what.note.${w.action}`, { path: w.path });
    case "accepted":
      return t("log.what.accepted");
    default:
      return t(`log.origin.${r.origin}`);
  }
}

/** What came of it: its proposals, what it changed, or nothing; a stopped run says so. */
function runResult(t: T, r: RunSummary): string {
  const parts: string[] = [];
  if (r.what?.kind === "mail") {
    if (r.what.from) parts.push(t("log.from", { from: r.what.from }));
    if (r.what.account) parts.push(t("log.account", { account: r.what.account }));
  }
  if (r.status.startsWith("stopped")) parts.push(t("log.status.stopped"));
  else if (r.status !== "done" && r.status !== "proposed")
    parts.push(t(`log.status.${r.status.split(":")[0]}`));
  const p = r.proposals;
  if (p)
    for (const k of ["pending", "accepted", "rejected", "stale"] as const)
      if (p[k] > 0) parts.push(t(`log.result.${k}`, { n: p[k] }));
  const changes = r.changes ?? [];
  for (const c of changes)
    parts.push(
      `${t(`log.change.${c.action}`, { title: c.title, collection: c.collection })}${c.undone ? ` ${t("log.change.undone")}` : ""}`,
    );
  if ((r.changed ?? 0) > changes.length)
    parts.push(t("log.change.more", { n: (r.changed ?? 0) - changes.length }));
  if (r.what && quiet(r)) parts.push(t("log.result.nothing"));
  if (!r.what && !parts.length) parts.push(t(`log.status.${r.status.split(":")[0]}`));
  return parts.join(" · ");
}

/** Undo only where there is something to undo (an older server does not say: then as before). */
const undoable = (r: RunSummary) =>
  (r.status === "done" || r.status.startsWith("stopped")) &&
  (r.changed === undefined ||
    (r.changes ?? []).some((c) => !c.undone) ||
    (r.changed ?? 0) > (r.changes ?? []).length);

export function LogView() {
  const t = useStore((s) => s.t);
  const runs = useStore((s) => s.runs);
  const lang = useStore((s) => s.settings.language);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null | "loading">(null);
  const [groups, setGroups] = useState<Set<string>>(new Set());
  const when = new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "es-ES", {
    dateStyle: "short",
    timeStyle: "short",
  });
  const toggle = (id: string) => {
    if (open === id) return setOpen(null);
    setOpen(id);
    setDetail("loading");
    void loadRunDetail(id).then(setDetail);
  };
  const line = (r: RunSummary) => (
    <li key={r.id} className="log-run">
      <div className="list-row">
        <button
          type="button"
          className="link-btn list-main small log-head"
          aria-expanded={open === r.id}
          onClick={() => toggle(r.id)}
        >
          <span className="log-title">{runTitle(t, r)}</span>
          <span className="log-result muted">
            {when.format(r.started)} · {runResult(t, r)}
          </span>
        </button>
        {/* A stopped run may have left changes (a limit stopped it after some): it can be undone too. */}
        {undoable(r) && (
          <button type="button" className="btn ghost" onClick={() => void undoRun(r.id)}>
            <Undo2 size={13} strokeWidth={1.8} />
            {t("chat.undo")}
          </button>
        )}
      </div>
      {open === r.id && <RunSteps t={t} detail={detail} />}
    </li>
  );
  return (
    <div className="agent-page">
      {runs.length === 0 && <p className="muted center-note">{t("log.empty")}</p>}
      <ul className="log-list">
        {logEntries(runs).map((e) => {
          if ("run" in e) return line(e.run);
          const first = e.quiet[0] as RunSummary;
          const last = e.quiet.at(-1) as RunSummary;
          const shown = groups.has(first.id);
          return (
            <li key={`quiet-${first.id}`} className="log-run log-quiet">
              <button
                type="button"
                className="link-btn small log-head"
                aria-expanded={shown}
                onClick={() =>
                  setGroups((g) => {
                    const n = new Set(g);
                    if (n.has(first.id)) n.delete(first.id);
                    else n.add(first.id);
                    return n;
                  })
                }
              >
                <span className="log-title">{t("log.quiet", { n: e.quiet.length })}</span>
                <span className="log-result muted">
                  {when.format(last.started)} – {when.format(first.started)}
                </span>
              </button>
              {shown && <ul className="log-list log-group">{e.quiet.map(line)}</ul>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A run's request and steps, as text (the plan's own words; nothing here is a link or markup). */
function RunSteps({ t, detail }: { t: T; detail: RunDetail | null | "loading" }) {
  if (detail === "loading") return <p className="muted small log-detail">{t("log.loading")}</p>;
  if (!detail) return <p className="muted small log-detail">{t("log.noDetail")}</p>;
  return (
    <div className="log-detail small">
      {detail.request !== null && <p className="log-request">{detail.request}</p>}
      <ol className="log-steps">
        {detail.steps.map((s) => (
          <li key={s.id} className={s.error ? "log-step failed" : "log-step"}>
            <span className="log-step-what">{s.what}</span>{" "}
            <span className="muted">
              {s.error ? agentErrorText(t, s.error) : t(`log.decision.${s.decision ?? "none"}`)}
              {s.rule ? ` (${s.rule})` : ""}
            </span>
            {s.args && <code className="log-args">{s.args}</code>}
          </li>
        ))}
      </ol>
    </div>
  );
}
