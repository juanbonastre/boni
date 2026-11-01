import { ChevronRight, Eye, EyeOff, History } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { HistoryMark } from "../core/blame.ts";
import { editRowValue, setPropHidden, setRowHistory, toggleRowProps, useStore } from "../store.ts";
import { Cell } from "./DatabaseBlock.tsx";
import { HistoryPanel, historyColor, whoLabel } from "./History.tsx";
import { BottomSheet } from "./MobileParts.tsx";
import { DocEditor } from "./PageView.tsx";
import { RelatedSection } from "./Related.tsx";

/**
 * A row of a collection opened as a page, as Notion's: its title big, its properties one per line (the
 * name on the left, the value edited in place on the right), then its text with the page's own block editor
 * (a note is a page, Juan, 2026-10-26: the same "/" and "+", data blocks included; kept as Markdown, the
 * blocks Markdown cannot say as fenced «boni» blocks, saved by itself a moment after typing). The properties
 * start folded under one line (Juan, 2026-10-22: a note opens on its text); each one can be hidden (the eye
 * on hover, as Notion's), and the hidden ones wait under "N ocultas". The collection keeps both for the account.
 */
export function RowView({ mobile = false }: { mobile?: boolean }) {
  const t = useStore((s) => s.t);
  const view = useStore((s) => s.view);
  const row = useStore((s) => s.row);
  const doc = useStore((s) => s.rowDoc);
  const related = useStore((s) => s.related);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const history = useStore((s) => s.rowHistory);
  // On the phone the properties are chips under the title; a tap opens them all in a sheet (Juan, 2026-10-31).
  const [propsSheet, setPropsSheet] = useState(false);
  // With History open, each property in the colour of who changed it last (Juan, 2026-10-30).
  const marks = useStore((s) => s.historyMarks);
  const locale = useStore((s) => (s.settings.language === "en" ? "en-GB" : "es-ES"));
  const markOf = (field: string) => {
    const m = marks?.fields[field];
    return m && (!marks?.focus || marks.focus === m.by) ? m : null;
  };
  const tint = (field: string) => {
    const m = markOf(field);
    return m ? ({ "--who": historyColor(m.by) } as React.CSSProperties) : undefined;
  };
  const type = useStore((s) =>
    s.view.kind === "row"
      ? s.dataTypes?.find((x) => x.id === (s.view as { type: string }).type)
      : undefined,
  );
  if (view.kind !== "row" || !row || !type)
    return (
      <div className="content">
        <div
          className="page-loading"
          role="status"
          aria-busy="true"
          aria-label={t("chart.loading")}
        />
      </div>
    );
  const titleField = type.fields.find((f) => f.id === type.titleField);
  const props = type.fields.filter((f) => f.id !== type.titleField);
  const hiddenIds = new Set(type.rowUi.hidden);
  const visible = props.filter((f) => !hiddenIds.has(f.id));
  const hidden = props.filter((f) => hiddenIds.has(f.id));
  const shown = type.rowUi.open;
  const title =
    typeof row.values[type.titleField] === "string" ? (row.values[type.titleField] as string) : "";
  const propsList = (
    <div className="row-props">
      {visible.map((f) => (
        <div key={f.id} className={`row-prop${markOf(f.id) ? " by-who" : ""}`} style={tint(f.id)}>
          {markOf(f.id) && (
            <span className="blk-who">{whoLabel(t, markOf(f.id) as HistoryMark, locale)}</span>
          )}
          <span className="row-prop-name">{f.name}</span>
          <div className="row-prop-value">
            <Cell
              type={type}
              field={f}
              row={row}
              titles={related?.titles ?? {}}
              onSave={(v) => void editRowValue(type.id, row.id, f.id, v)}
            />
          </div>
          <button
            type="button"
            className="icon-btn row-prop-eye"
            title={t("row.hideProp", { name: f.name })}
            aria-label={t("row.hideProp", { name: f.name })}
            onClick={() => setPropHidden(type.id, f.id, true)}
          >
            <EyeOff size={14} strokeWidth={1.8} />
          </button>
        </div>
      ))}
      {hidden.length > 0 && (
        <>
          <button
            type="button"
            className={`row-props-toggle row-hidden-toggle${hiddenOpen ? " open" : ""}`}
            aria-expanded={hiddenOpen}
            onClick={() => setHiddenOpen(!hiddenOpen)}
          >
            <ChevronRight size={14} strokeWidth={2} />
            {t("row.hiddenProps", { n: hidden.length })}
          </button>
          {hiddenOpen &&
            hidden.map((f) => (
              <div key={f.id} className="row-prop row-prop-hidden">
                <span className="row-prop-name">{f.name}</span>
                <div className="row-prop-value">
                  <Cell
                    type={type}
                    field={f}
                    row={row}
                    titles={related?.titles ?? {}}
                    onSave={(v) => void editRowValue(type.id, row.id, f.id, v)}
                  />
                </div>
                <button
                  type="button"
                  className="icon-btn row-prop-eye"
                  title={t("row.showProp", { name: f.name })}
                  aria-label={t("row.showProp", { name: f.name })}
                  onClick={() => setPropHidden(type.id, f.id, false)}
                >
                  <Eye size={14} strokeWidth={1.8} />
                </button>
              </div>
            ))}
        </>
      )}
    </div>
  );
  return (
    <div className="models-view">
      <div className="content page-doc">
        <div className="doc row-doc">
          <div className="row-kind">
            {type.icon && <span>{type.icon}</span>}
            {type.name}
            <button
              type="button"
              className={`btn ghost small row-history${history ? " on" : ""}`}
              aria-pressed={history}
              onClick={() => setRowHistory(!history)}
            >
              <History size={13} strokeWidth={1.8} aria-hidden="true" />
              {t("history.title")}
            </button>
          </div>
          {titleField && (
            <div
              className={`row-title-wrap${markOf(titleField.id) ? " by-who" : ""}`}
              style={tint(titleField.id)}
            >
              {markOf(titleField.id) && (
                <span className="blk-who">
                  {whoLabel(t, markOf(titleField.id) as HistoryMark, locale)}
                </span>
              )}
              <RowTitle
                key={row.id}
                value={title}
                placeholder={t("page.untitled")}
                onSave={(v) => void editRowValue(type.id, row.id, type.titleField, v || null)}
              />
            </div>
          )}
          {mobile && (
            <div className="m-row-chips">
              {visible.flatMap((f) => {
                const text = chipText(f, row.values[f.id], related?.titles ?? {}, locale);
                return text
                  ? [
                      <button
                        key={f.id}
                        type="button"
                        className="m-chip"
                        title={f.name}
                        onClick={() => setPropsSheet(true)}
                      >
                        {text}
                      </button>,
                    ]
                  : [];
              })}
              {props.length > 0 && (
                <button
                  type="button"
                  className="m-chip ghost"
                  aria-haspopup="dialog"
                  onClick={() => setPropsSheet(true)}
                >
                  {t("row.props")}
                </button>
              )}
            </div>
          )}
          {props.length > 0 && !mobile && (
            <button
              type="button"
              className={`row-props-toggle${shown ? " open" : ""}`}
              aria-expanded={shown}
              onClick={() => toggleRowProps(type.id)}
            >
              <ChevronRight size={14} strokeWidth={2} />
              {shown
                ? t("row.hideProps")
                : visible.length
                  ? t("row.showProps", { n: visible.length })
                  : t("row.hiddenProps", { n: hidden.length })}
              {/* Folded, a dot for each one who changed some of them. */}
              {!shown &&
                [...new Set(props.flatMap((f) => markOf(f.id)?.by ?? []))].map((by) => (
                  <i key={by} className="who-dot" style={{ background: historyColor(by) }} />
                ))}
            </button>
          )}
          {shown && !mobile && propsList}
          {related && related.groups.length > 0 && (
            <RelatedSection type={type.id} groups={related.groups} />
          )}
          {doc && <DocEditor key={doc.id} doc={doc} />}
        </div>
      </div>
      {history && <HistoryPanel id={row.id} type={type.id} onClose={() => setRowHistory(false)} />}
      {mobile && propsSheet && (
        <BottomSheet title={t("row.props")} close={() => setPropsSheet(false)}>
          {propsList}
        </BottomSheet>
      )}
    </div>
  );
}

function RowTitle({
  value,
  placeholder,
  onSave,
}: {
  value: string;
  placeholder: string;
  onSave: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useGrow(ref, text);
  return (
    <textarea
      ref={ref}
      className="doc-title"
      rows={1}
      value={text}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => setText(e.target.value.replace(/\n/g, " "))}
      onBlur={() => text !== value && onSave(text.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
}

function useGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(grow, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const o = new ResizeObserver(grow);
    o.observe(el);
    return () => o.disconnect();
  }, []);
}

/** A property's value as a chip says it: a day, an option's name, a related title, «Hecha»; nothing when empty. */
function chipText(
  f: { type: string; name: string; options?: { id: string; name: string }[] },
  v: unknown,
  titles: Record<string, string>,
  locale: string,
): string {
  if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return "";
  // Free text (a time zone, an address, a long line) reads badly as a chip: it stays in «Propiedades».
  if (f.type === "text" || f.type === "url" || f.type === "email" || f.type === "phone") return "";
  if (f.type === "checkbox") return v === true ? f.name : "";
  if (f.type === "date" && typeof v === "string")
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${v.slice(0, 10)}T12:00:00Z`));
  const one = (x: unknown) =>
    f.options?.find((o) => o.id === x)?.name ??
    titles[String(x)] ??
    (typeof x === "string" ? x : "");
  const text = (Array.isArray(v) ? v.map(one) : [one(v)]).filter(Boolean).join(", ");
  return typeof v === "number" ? String(v) : text.length > 40 ? `${text.slice(0, 39)}…` : text;
}
