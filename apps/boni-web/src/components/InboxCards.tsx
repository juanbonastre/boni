import { markdownToBlocks } from "@boni/views";
import {
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Inbox,
  Mail,
  Maximize2,
  Pencil,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  ConfirmView,
  DataField,
  DataType,
  DataValue,
  FlowProposalView,
  InboxCard,
  InboxRequest,
  Proposal,
} from "../core/agent.ts";
import { webmailOf } from "../core/webmail.ts";
import {
  acceptProposal,
  answerRequest,
  closeProposal,
  createCollectionNamed,
  dismissProposal,
  dismissRequest,
  loadDataTypes,
  loadInbox,
  mailboxHost,
  openProposal,
  openTrace,
  openWebmail,
  peekMail,
  rejectProposal,
  toggleInbox,
  useStore,
} from "../store.ts";
import { CallRows, ValueText } from "./Chat.tsx";
import { Cell } from "./DatabaseBlock.tsx";
import { triggerText } from "./FlowEditor.tsx";
import { FlowPreview } from "./FlowPreview.tsx";
import { type OptionsLoader, SearchList } from "./FormView.tsx";
import { GmailMark, KeptMail } from "./MailIcons.tsx";

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
  const queue = useInboxQueue();
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
        <h2>{queue.length ? t("inbox.titleN", { n: queue.length }) : t("inbox.title")}</h2>
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
        {queue.length === 0 && <p className="muted center-note">{t("inbox.empty")}</p>}
        {queue.map((x) =>
          "p" in x ? <ProposalCard key={x.p.id} p={x.p} /> : <RequestCard key={x.r.id} r={x.r} />,
        )}
      </div>
    </aside>
  );
}

/**
 * One queue in the order things arrived (Juan, 2026-10-24, option A): proposals and questions mixed, each card
 * saying what it is.
 */
export function useInboxQueue(): ({ p: Proposal } | { r: InboxRequest })[] {
  const inbox = useStore((s) => s.inbox);
  const requests = useStore((s) => s.requests);
  return [
    ...inbox.map((p) => ({ p, at: p.created })),
    ...requests.map((r) => ({ r, at: r.created })),
  ]
    .sort((a, b) => a.at - b.at)
    .map((x) => ("p" in x ? { p: x.p } : { r: x.r }));
}

/** The top bar's way into the inbox: its count, the panel open or closed. */
export function InboxButton() {
  const t = useStore((s) => s.t);
  const n = useStore((s) => s.inbox.length + s.requests.length);
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

/** What the proposal does, in words made by code from its arguments. */
/**
 * The card's title is the proposal's own («Revisar actas»); this is the line under it: where it goes, its
 * collection (Juan, 2026-11-02: «Añadir tarea a Tarea» said nothing). Without a title, «Añadir a Tarea». For a
 * change or a deletion, what the view says.
 */
function headline(t: ReturnType<typeof useStore.getState>["t"], p: Proposal, c: InboxCard | null) {
  if (c?.action === "create" && c.collection)
    return c.title ? c.collection : t("inbox.add.item", { collection: c.collection });
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
/**
 * A collection's kind for the correction's select (task 47): one with a «done» box keeps tasks, one with a day and
 * no box keeps events, the rest keep other things. Grouped, so «tarea o evento» is one choice in the one control.
 */
function kindOf(x: DataType): "task" | "event" | "other" {
  const r = x.roles ?? {};
  if (r.done) return "task";
  if (r.date || r.start) return "event";
  return "other";
}
/** The inbox's collections come inline: nothing to load from a source. */
const NO_OPTIONS: OptionsLoader = async () => [];
const KIND_KEY = {
  task: "inbox.kind.task",
  event: "inbox.kind.event",
  other: "inbox.kind.other",
} as const;
/**
 * The fields of a collection's day, start and end, by their roles (docs/clases.md §6); none without them: a date
 * field that only records the past (a book's «Terminado») is no day to correct.
 */
function whenFields(x: DataType): (DataField | undefined)[] {
  const r = x.roles ?? {};
  const byId = (id: string | undefined) => (id ? x.fields.find((f) => f.id === id) : undefined);
  return [byId(r.date), byId(r.time), byId(r.endTime)];
}

function useCorrection(p: Proposal) {
  const t = useStore((s) => s.t);
  const types = useStore((s) => s.dataTypes);
  const c = p.card;
  const [edit, setEdit] = useState<{
    title: string;
    collection: string;
    /** The proposal's other values by field key, as Juan leaves them. */
    values: Record<string, DataValue>;
    open: boolean;
  } | null>(null);
  const can = c?.action === "create" && !!c.collectionId;
  // The proposal's values by field key, and the titles of what its relations point to (for the cells).
  const proposed = useMemo(() => {
    const values: Record<string, DataValue> = {};
    const titles: Record<string, string> = {};
    for (const r of p.view?.rows ?? []) {
      if (!r.arg.startsWith("values.")) continue;
      const key = r.arg.slice("values.".length);
      const v: unknown = r.value;
      const d: unknown = r.detail;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null)
        values[key] = v;
      else if (Array.isArray(v) && v.every((x): x is string => typeof x === "string"))
        values[key] = v;
      if (typeof v === "string" && typeof d === "string") titles[v] = d;
      if (Array.isArray(v) && Array.isArray(d))
        v.forEach((id, i) => {
          const title = d[i];
          if (typeof id === "string" && typeof title === "string") titles[id] = title;
        });
    }
    return { values, titles };
  }, [p]);
  const start = () => {
    if (!types) void loadDataTypes();
    setEdit({
      title: c?.title ?? "",
      collection: c?.collectionId ?? "",
      values: { ...proposed.values },
      open: false,
    });
  };
  const edits = () => {
    if (!edit || !c) return undefined;
    const out: { title?: string; collection?: string; values?: Record<string, DataValue> } = {};
    const title = edit.title.replace(/\s+/g, " ").trim();
    if (title && title !== c.title) out.title = title;
    if (edit.collection && edit.collection !== c.collectionId) out.collection = edit.collection;
    const values: Record<string, DataValue> = {};
    for (const [k, v] of Object.entries(edit.values))
      if (JSON.stringify(v ?? null) !== JSON.stringify(proposed.values[k] ?? null))
        values[k] = v ?? null;
    if (Object.keys(values).length) out.values = values;
    return out.title || out.collection || out.values ? out : undefined;
  };
  const options = [
    ...(types ?? []).filter((x) => x.zone === undefined && x.level !== "private" && !x.readOnly),
  ].sort((a, b) => a.name.localeCompare(b.name));
  if (c?.collectionId && !options.some((x) => x.id === c.collectionId))
    options.unshift({ id: c.collectionId, name: c.collection ?? "" } as (typeof options)[number]);
  const groups = (["task", "event", "other"] as const).map((k) => ({
    kind: k,
    items: options.filter((o) => kindOf(o) === k),
  }));
  const grouped = groups.some((g) => g.kind !== "other" && g.items.length > 0);
  // Boni's searchable list (the one of relations and forms; task 53): the collections under their kind, the
  // chosen one as a chip, and «Crear «nombre»» for one that does not exist yet.
  const listOptions = useMemo(
    () =>
      grouped
        ? groups.flatMap((g) =>
            g.items.map((o) => ({ value: o.id, label: o.name, group: t(KIND_KEY[g.kind]) })),
          )
        : options.map((o) => ({ value: o.id, label: o.name })),
    [types, grouped, t],
  );
  // Another collection keeps the day and the hours, each under the field that plays its role there (task 47).
  const changeCollection = (id: string) => {
    if (!edit) return;
    const from = (types ?? []).find((x) => x.id === edit.collection);
    const to = (types ?? []).find((x) => x.id === id);
    const values = { ...edit.values };
    if (from && to)
      whenFields(from).forEach((f, i) => {
        const g = whenFields(to)[i];
        if (!f?.key || !g?.key || f.key === g.key || values[f.key] === undefined) return;
        values[g.key] = values[f.key] as DataValue;
        delete values[f.key];
      });
    setEdit({ ...edit, collection: id, values });
  };
  // The chosen collection's day and hours, always in view; its other properties (its title is the line above)
  // folded under «Propiedades»; each with its own cell to change it.
  const chosen = edit ? (types ?? []).find((x) => x.id === edit.collection) : undefined;
  const when = chosen ? whenFields(chosen).filter((f): f is DataField => !!f?.key) : [];
  const props = chosen
    ? chosen.fields.filter(
        (f) => f.id !== chosen.titleField && !!f.key && f.type !== "file" && !when.includes(f),
      )
    : [];
  const cell = (f: DataField) =>
    chosen && (
      <div key={f.id} className="inbox-prop">
        <span className="inbox-prop-name">{f.name}</span>
        <div className="inbox-prop-value">
          <Cell
            type={chosen}
            field={f}
            row={{
              id: `proposal:${p.id}`,
              values: { [f.id]: edit?.values[f.key as string] ?? null },
              updated: 0,
            }}
            titles={proposed.titles}
            onSave={(v) =>
              edit && setEdit({ ...edit, values: { ...edit.values, [f.key as string]: v } })
            }
          />
        </div>
      </div>
    );
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
      <label className="inbox-correct-row" htmlFor={`correct-collection-${p.id}`}>
        <span>{t("inbox.correctCollection")}</span>
        <SearchList
          id={`correct-collection-${p.id}`}
          source={null}
          inline={listOptions}
          multi={false}
          required
          selected={[edit.collection]}
          loadOptions={NO_OPTIONS}
          onChange={([id]) => id && changeCollection(id)}
          onCreate={async (name) => {
            const id = await createCollectionNamed(name);
            if (id) changeCollection(id);
          }}
        />
      </label>
      {when.length > 0 && <div className="inbox-props inbox-when">{when.map(cell)}</div>}
      {props.length > 0 && (
        <button
          type="button"
          className={`row-props-toggle inbox-props-toggle${edit.open ? " open" : ""}`}
          aria-expanded={edit.open}
          onClick={() => setEdit({ ...edit, open: !edit.open })}
        >
          <ChevronRight size={14} strokeWidth={2} />
          {t("inbox.properties")}
        </button>
      )}
      {edit.open && chosen && <div className="inbox-props">{props.map(cell)}</div>}
      <div className="inbox-correct-foot">
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
  return p.flow ? (
    <FlowProposalCard p={p} flow={p.flow} />
  ) : (
    <RecordProposalCard p={p} wide={wide} />
  );
}

/**
 * A flow a model proposed (docs/flujos.md F5): its name, what starts it and what it changes, the flow drawn (what it
 * adds in `--accent`, what it takes away struck); «Activar» saves it as the user's and turns it on.
 */
function FlowProposalCard({ p, flow }: { p: Proposal; flow: FlowProposalView }) {
  const t = useStore((s) => s.t);
  const count = (c: "new" | "changed" | "removed") =>
    flow.nodes.filter((n) => n.change === c).length;
  const said = (c: "new" | "changed" | "removed") => {
    const n = count(c);
    return n ? t(n === 1 ? `inbox.flow.${c}.one` : `inbox.flow.${c}.n`, { n }) : null;
  };
  const steps = flow.nodes.filter((n) => n.change !== "removed").length;
  const summary = flow.changes
    ? [said("new"), said("changed"), said("removed")].filter(Boolean).join(" · ") ||
      t("inbox.flow.same")
    : t(steps === 1 ? "inbox.flow.steps.one" : "inbox.flow.steps", { n: steps });
  return (
    <section className="card proposal inbox-card detailed flow-proposal">
      <p className="inbox-kind">
        <Inbox size={12} strokeWidth={1.8} aria-hidden="true" />
        {t("inbox.kind.flow")}
      </p>
      <header className="inbox-card-head">
        <h3>{flow.changes ? t("inbox.flow.change", { name: flow.changes.name }) : flow.name}</h3>
      </header>
      <p className="inbox-what">
        <span className="inbox-title">{triggerText(t, flow.trigger)}</span>
        <span className="muted"> · {summary}</span>
      </p>
      <FlowPreview flow={flow} />
      <div className="inbox-actions">
        <DecideButtons
          id={p.id}
          accept={() => void acceptProposal(p.id)}
          acceptLabel={t("inbox.flow.activate")}
          reject={() => void rejectProposal(p.id)}
        />
      </div>
    </section>
  );
}

function RecordProposalCard({ p, wide = false }: { p: Proposal; wide?: boolean }) {
  const t = useStore((s) => s.t);
  const c = p.card;
  const fmt = useDayFormat();
  const [more, setMore] = useState(c?.mode !== "compact");
  const fix = useCorrection(p);
  // A time Boni suggests for a task (the first free hour): one tap takes it, and it goes with the acceptance.
  const ask = c?.suggestedTime?.outcome === "ask" ? c.suggestedTime : null;
  const [takeTime, setTakeTime] = useState(false);
  const taken = takeTime && ask ? ask : null;
  const start = c?.start ?? taken?.start ?? null;
  const end = c?.end ?? taken?.end ?? null;
  const when = c?.day
    ? `${fmt.long(c.day)}${start ? `, ${start}${end ? `–${end}` : ""}` : ""}`
    : null;
  // What it was before a reply in the same thread moved it (task 46): the earlier card is gone, this one says it.
  const b = c?.before;
  const before =
    b && (b.day || b.start)
      ? `${b.day ? fmt.long(b.day) : ""}${b.start ? `${b.day ? ", " : ""}${b.start}${b.end ? `–${b.end}` : ""}` : ""}`
      : null;
  // What the calendar already has of it (task 51): said on the line; an external event's id makes «Aceptar»
  // «Enlazar», and the record is made linked to it (task 50) instead of a second one.
  const already = alreadyText(c);
  const same = sameOf(c);
  const overlaps = c?.calendar?.overlaps.length
    ? c.calendar.overlaps.map((o) => o.title).join(", ")
    : null;
  const link = c?.calendar?.already?.external ?? null;
  const edits = () => {
    const e = fix.edits();
    const timed = taken
      ? {
          ...(e ?? {}),
          values: {
            ...(e?.values ?? {}),
            [taken.startKey]: taken.start,
            ...(taken.endKey && taken.end ? { [taken.endKey]: taken.end } : {}),
          },
        }
      : e;
    return link ? { ...(timed ?? {}), link } : timed;
  };
  const body = p.view?.rows.find((r) => r.arg === "values.body" || r.arg.endsWith(".body"));
  const rest: ConfirmView | null = p.view
    ? {
        ...p.view,
        rows: p.view.rows.filter((r) => r !== body),
      }
    : null;
  // On the inbox's own page (more room), a detailed card from mail is two columns (Juan, 2026-10-23): the mail on
  // the left, the three days with the proposal on the right.
  const two = wide && more && c?.source?.kind === "mail" && !!c.day && c.context.length > 0;
  const where = headline(t, p, c);
  const source = (
    <>
      {(where || when) && (
        <p className="inbox-what">
          {where && <span className="inbox-title">{where}</span>}
          {when && <span className="muted"> · {when}</span>}
          {before && (
            <span className="muted inbox-before"> · {t("inbox.before", { when: before })}</span>
          )}
          {already && (
            <span className="inbox-already"> · {t("inbox.already", { what: already })}</span>
          )}
          {same && <span className="inbox-same"> · {t("inbox.same", { what: same.text })}</span>}
          {overlaps && (
            <span className="muted inbox-overlap">
              {" "}
              · {t("inbox.overlaps", { title: overlaps })}
            </span>
          )}
          {ask && !takeTime && (
            <button
              type="button"
              className="btn ghost small inbox-time-ask"
              onClick={() => setTakeTime(true)}
            >
              {t("inbox.timeAsk", { start: ask.start })}
            </button>
          )}
        </p>
      )}
      {c?.source?.kind === "mail" && <MailSource source={c.source} earlier={c.earlier} />}
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
      <p className="inbox-kind">
        <Inbox size={12} strokeWidth={1.8} aria-hidden="true" />
        {t("inbox.kind.proposal")}
      </p>
      <header className="inbox-card-head">
        <h3>{c?.title || where}</h3>
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
      {/* «Más detalles» before what he can change (Juan, 2026-11-02): the mail above it, the correction below. */}
      <button
        type="button"
        className={`btn ghost small inbox-more${more ? " open" : ""}`}
        aria-expanded={more}
        onClick={() => setMore(!more)}
      >
        {more ? t("inbox.less") : t("inbox.more")}
        <ChevronDown size={13} strokeWidth={1.8} />
      </button>
      {fix.form}
      <div className="inbox-actions">
        <DecideButtons
          id={p.id}
          accept={() => void acceptProposal(p.id, edits())}
          {...(link ? { acceptLabel: t("inbox.link") } : {})}
          {...(same
            ? {
                same: {
                  label: t("inbox.sameYes"),
                  run: () =>
                    void acceptProposal(
                      p.id,
                      { ...(edits() ?? {}), ...same.as },
                      { same: same.title },
                    ),
                },
              }
            : {})}
          {...(c?.canMarkDone
            ? { done: () => void acceptProposal(p.id, edits(), { done: true }) }
            : {})}
          reject={() => void rejectProposal(p.id)}
        />
        <span className="spacer" />
        {c?.wouldAccept && <WouldAccept />}
      </div>
    </section>
  );
}

const DAY_MS = 24 * 60 * 60_000;

/**
 * A question from background work (Juan, 2026-10-24): what Boni asks, where it came from, its options as pills or
 * a line to type in, and "Descartar" with how long it still waits. Painted as text from the server's values (what
 * came from outside keeps its mark); answering sends the choice's number or the typed text, never more.
 */
export function RequestCard({ r }: { r: InboxRequest }) {
  const t = useStore((s) => s.t);
  const busy = useStore((s) => s.deciding[r.id]);
  const failed = useStore((s) => s.decideErrors[r.id]);
  const [text, setText] = useState("");
  const off = !!busy || !!failed?.gone;
  // Whole days left, rounded (a new question says 7; less than half a day, "hoy").
  const days = Math.round((r.expires - Date.now()) / DAY_MS);
  const about = r.about;
  return (
    <section className="card inbox-card request-card">
      <p className="inbox-kind">
        <HelpCircle size={12} strokeWidth={1.8} aria-hidden="true" />
        {t("inbox.kind.question")} ·{" "}
        {days >= 1 ? t("inbox.expiresIn", { n: days }) : t("inbox.expiresToday")}
      </p>
      <h3 className="request-prompt">
        <ValueText p={r.ask.prompt} />
      </h3>
      {about?.kind === "mail" && (
        <p className="inbox-source">
          <Mail size={13} strokeWidth={1.8} aria-hidden="true" />
          <span className="inbox-source-text" title={t("chat.fromOutside")}>
            {about.account ?? t("inbox.mail")}
            {about.from ? ` · ${about.from}` : ""}
            {about.subject ? ` · ${about.subject}` : ""}
          </span>
          {r.open && (
            <span className="inbox-source-tools">
              <button
                type="button"
                className="icon-btn inbox-see-mail"
                title={t("inbox.seeMail")}
                aria-label={t("inbox.seeMail")}
                onClick={() => r.open && peekMail(r.open)}
              >
                <KeptMail />
              </button>
            </span>
          )}
        </p>
      )}
      {about?.kind === "review" && <p className="inbox-source muted">{t("inbox.fromReview")}</p>}
      {r.ask.control === "choice" ? (
        <div className="ask-options">
          {r.ask.options.map((o, i) => (
            <button
              key={i}
              type="button"
              className={`pill${busy === "accept" ? " busy" : ""}`}
              disabled={off}
              onClick={() => void answerRequest(r.id, { choice: i })}
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
            if (text.trim()) void answerRequest(r.id, { text });
          }}
        >
          {/* Never a password field: Boni does not ask for secrets here (docs/nucleo.md, 7.5). */}
          <input
            type="text"
            value={text}
            maxLength={500}
            disabled={off}
            aria-label={t("ask.answer")}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            type="submit"
            className={`btn primary decide-btn${busy === "accept" ? " busy" : ""}`}
            disabled={off || !text.trim()}
            aria-busy={busy === "accept"}
            aria-label={busy === "accept" ? t("inbox.answering") : undefined}
          >
            <span className="decide-label">{t("inbox.send")}</span>
            {busy === "accept" && <span className="spinner" aria-hidden="true" />}
          </button>
        </form>
      )}
      <div className="inbox-actions">
        {busy === "accept" && r.ask.control === "choice" && (
          <span className="muted small" role="status">
            {t("inbox.answering")}
          </span>
        )}
        <span className="spacer" />
        <button
          type="button"
          className={`btn ghost small decide-btn${busy === "reject" ? " busy" : ""}`}
          disabled={off}
          title={t("inbox.putAwayHelp")}
          aria-busy={busy === "reject"}
          aria-label={busy === "reject" ? t("inbox.puttingAway") : undefined}
          onClick={() => void dismissRequest(r.id)}
        >
          <span className="decide-label">{t("inbox.putAway")}</span>
          {busy === "reject" && <span className="spinner" aria-hidden="true" />}
        </button>
      </div>
      {failed && (
        <p className="decide-error" role="alert">
          <span>{failed.text}</span>
          {failed.gone && (
            <button type="button" className="btn ghost small" onClick={() => dismissProposal(r.id)}>
              {t("inbox.dismiss")}
            </button>
          )}
        </p>
      )}
    </section>
  );
}

/**
 * Boni would have accepted this one alone (Juan, 2026-10-23: measured before it is ever turned on): a quiet mark,
 * explained on hover; the Registro says how often it would have been right.
 */
function WouldAccept() {
  const t = useStore((s) => s.t);
  return (
    <span className="would-accept" title={t("inbox.wouldAcceptHelp")}>
      <Sparkles size={12} strokeWidth={1.8} aria-hidden="true" />
      {t("inbox.wouldAccept")}
    </span>
  );
}

/**
 * Aceptar, Ya lo hice and Rechazar of one proposal: the one clicked turns into a spinner while the server answers (Juan,
 * 2026-10-23), both stay off meanwhile, and other cards can be decided. A failure says why under them; one that
 * can no longer be decided (stale, already decided) can be taken out of the list.
 */
/** «Clase IPM, 17:00–18:00»: an entry of the calendar as a card names it (tasks 51 and 58). */
const entryText = (a: { title: string; start: string | null; end: string | null }): string =>
  `${a.title}${a.start ? `, ${a.start}${a.end ? `–${a.end}` : ""}` : ""}`;

/** «Ya en el calendario: Clase IPM, 17:00–18:00»: the entry the calendar already has of a proposal (task 51). */
function alreadyText(c: InboxCard | null): string | null {
  const a = c?.calendar?.already;
  return a ? entryText(a) : null;
}

/**
 * The entry a proposal may be («¿Es «Quedada cafe, 16:00–17:00»?», task 58) and how «Es el mismo» accepts it: linked
 * to the external event, or into the record (what the record lacks, the server decides).
 */
function sameOf(
  c: InboxCard | null,
): { title: string; text: string; as: { link: string } | { into: string } } | null {
  const s = c?.calendar?.same;
  if (!s || c?.calendar?.already) return null;
  if (s.external) return { title: s.title, text: entryText(s), as: { link: s.external } };
  if (s.id) return { title: s.title, text: entryText(s), as: { into: s.id } };
  return null;
}

function DecideButtons({
  id,
  accept,
  acceptLabel,
  same,
  done,
  reject,
}: {
  id: string;
  accept: () => void;
  /** «Enlazar» (task 51) where accepting links the record to an event the calendar already has. */
  acceptLabel?: string;
  /** «Es el mismo» (task 58): the proposal goes into the entry the calendar already has at that moment. */
  same?: { label: string; run: () => void };
  /** "Ya lo hice": only where the proposal can be made already done. */
  done?: () => void;
  reject: () => void;
}) {
  const t = useStore((s) => s.t);
  const busy = useStore((s) => s.deciding[id]);
  const failed = useStore((s) => s.decideErrors[id]);
  return (
    <>
      {same && (
        <button
          type="button"
          className="btn decide-btn"
          disabled={!!busy || !!failed?.gone}
          onClick={same.run}
        >
          <span className="decide-label">{same.label}</span>
        </button>
      )}
      <button
        type="button"
        className={`btn primary decide-btn${busy === "accept" ? " busy" : ""}`}
        disabled={!!busy || !!failed?.gone}
        aria-busy={busy === "accept"}
        aria-label={busy === "accept" ? t("inbox.accepting") : undefined}
        onClick={accept}
      >
        <span className="decide-label">{acceptLabel ?? t("inbox.accept")}</span>
        {busy === "accept" && <span className="spinner" aria-hidden="true" />}
      </button>
      {done && (
        <button
          type="button"
          className={`btn decide-btn${busy === "done" ? " busy" : ""}`}
          disabled={!!busy || !!failed?.gone}
          aria-busy={busy === "done"}
          aria-label={busy === "done" ? t("inbox.markingDone") : undefined}
          title={t("inbox.doneHelp")}
          onClick={done}
        >
          <span className="decide-label">{t("inbox.done")}</span>
          {busy === "done" && <span className="spinner" aria-hidden="true" />}
        </button>
      )}
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

/**
 * Where a mail proposal came from (mailbox and sender), with two icons that never give way to a long sender (task 68;
 * Juan, 2026-11-05): the mail kept in Boni, seen in the side panel without leaving the inbox («Agrandar» there opens
 * it whole), and, for a Gmail mailbox, Gmail's own address of that mail in its account (the server finds it). When the
 * proposal also comes from earlier mails of its thread, «+N correos» shows them, each to see the same way.
 */
function MailSource({
  source,
  earlier,
}: {
  source: Extract<InboxCard["source"], { kind: "mail" }>;
  earlier: InboxCard["earlier"];
}) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const [gmail, setGmail] = useState(false);
  const [showEarlier, setShowEarlier] = useState(false);
  useEffect(() => {
    let live = true;
    void mailboxHost().then((h) => live && setGmail(!!h && webmailOf(h) === "gmail"));
    return () => {
      live = false;
    };
  }, []);
  const day = (at: string | null) => {
    const ms = at ? Date.parse(at) : Number.NaN;
    return Number.isFinite(ms)
      ? new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "es-ES", {
          day: "numeric",
          month: "short",
        }).format(ms)
      : "";
  };
  return (
    <>
      <p className="inbox-source">
        <Mail size={13} strokeWidth={1.8} aria-hidden="true" />
        <span className="inbox-source-text">
          {source.account ?? t("inbox.mail")}
          {source.from ? ` · ${source.from}` : ""}
        </span>
        {earlier.length > 0 && (
          <button
            type="button"
            className="btn ghost small inbox-earlier-toggle"
            aria-expanded={showEarlier}
            onClick={() => setShowEarlier(!showEarlier)}
          >
            {earlier.length === 1
              ? t("inbox.earlier.one")
              : t("inbox.earlier", { n: earlier.length })}
          </button>
        )}
        <span className="inbox-source-tools">
          {source.open && (
            <button
              type="button"
              className="icon-btn inbox-see-mail"
              title={t("inbox.seeMail")}
              aria-label={t("inbox.seeMail")}
              onClick={() => source.open && peekMail(source.open)}
            >
              <KeptMail />
            </button>
          )}
          {gmail && source.open && (
            <button
              type="button"
              className="icon-btn inbox-webmail"
              title={t("inbox.inGmail")}
              aria-label={t("inbox.inGmail")}
              onClick={() => source.open && void openWebmail(source.open.id)}
            >
              <GmailMark />
            </button>
          )}
        </span>
      </p>
      {showEarlier && (
        <ul className="inbox-earlier">
          {earlier.map((e) => (
            <li key={e.open.id}>
              <button
                type="button"
                className="inbox-earlier-mail"
                title={t("inbox.seeMail")}
                onClick={() => peekMail(e.open)}
              >
                <span className="inbox-earlier-from">{e.from}</span>
                <span className="inbox-earlier-subject">{e.subject}</span>
                <span className="inbox-earlier-at">{day(e.at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
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
  if (p.flow)
    return (
      <div className="content proposal-page">
        <FlowProposalCard p={p} flow={p.flow} />
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
        rows: p.view.rows.filter((r) => r !== body),
      }
    : null;
  const already = alreadyText(c);
  const same = sameOf(c);
  const link = c?.calendar?.already?.external ?? null;
  const decide = async (how: "accept" | "done" | "reject" | "same") => {
    const e = fix.edits();
    await (how === "reject"
      ? rejectProposal(id)
      : how === "same" && same
        ? acceptProposal(id, { ...(e ?? {}), ...same.as }, { same: same.title })
        : acceptProposal(id, link ? { ...(e ?? {}), link } : e, { done: how === "done" }));
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
          {c?.wouldAccept && <WouldAccept />}
        </p>
        <div className="pp-title-row">
          <h2 className="pp-title">{c?.title ?? headline(t, p, c)}</h2>
          {fix.button}
          {p.run && (
            <button
              type="button"
              className="btn ghost small"
              onClick={() => openTrace(p.run as string)}
            >
              {t("log.trace")}
            </button>
          )}
        </div>
        {already && <p className="inbox-already">{t("inbox.already", { what: already })}</p>}
        {same && <p className="inbox-same">{t("inbox.same", { what: same.text })}</p>}
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
          <MailSource source={c.source} earlier={c.earlier} />
          {c.source.subject && <p className="inbox-subject">{c.source.subject}</p>}
          {c.source.excerpt && <p className="inbox-quote long">«{c.source.excerpt}»</p>}
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
        <DecideButtons
          id={id}
          accept={() => void decide("accept")}
          {...(link ? { acceptLabel: t("inbox.link") } : {})}
          {...(same ? { same: { label: t("inbox.sameYes"), run: () => void decide("same") } } : {})}
          {...(c?.canMarkDone ? { done: () => void decide("done") } : {})}
          reject={() => void decide("reject")}
        />
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
