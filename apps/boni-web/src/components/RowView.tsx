import { ChevronRight, Eye, EyeOff, History } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { editRowValue, setPropHidden, toggleRowProps, useStore } from "../store.ts";
import { Cell } from "./DatabaseBlock.tsx";
import { HistoryPanel } from "./History.tsx";
import { DocEditor } from "./PageView.tsx";

/**
 * A row of a collection opened as a page, as Notion's: its title big, its properties one per line (the
 * name on the left, the value edited in place on the right), then its text with the page's block editor
 * (headings, lists, to-dos...; kept as Markdown, saved by itself a moment after typing). The properties start
 * folded under one line (Juan, 2026-10-22: a note opens on its text); each one can be hidden (the eye on hover,
 * as Notion's), and the hidden ones wait under "N ocultas". The collection keeps both for the account.
 */
export function RowView() {
  const t = useStore((s) => s.t);
  const view = useStore((s) => s.view);
  const row = useStore((s) => s.row);
  const doc = useStore((s) => s.rowDoc);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [history, setHistory] = useState(false);
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
              onClick={() => setHistory(!history)}
            >
              <History size={13} strokeWidth={1.8} aria-hidden="true" />
              {t("history.title")}
            </button>
          </div>
          {titleField && (
            <RowTitle
              key={row.id}
              value={title}
              placeholder={t("page.untitled")}
              onSave={(v) => void editRowValue(type.id, row.id, type.titleField, v || null)}
            />
          )}
          {props.length > 0 && (
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
            </button>
          )}
          {shown && (
            <div className="row-props">
              {visible.map((f) => (
                <div key={f.id} className="row-prop">
                  <span className="row-prop-name">{f.name}</span>
                  <div className="row-prop-value">
                    <Cell
                      type={type}
                      field={f}
                      row={row}
                      titles={{}}
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
                            titles={{}}
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
          )}
          {doc && <DocEditor key={doc.id} doc={doc} />}
        </div>
      </div>
      {history && <HistoryPanel id={row.id} type={type.id} onClose={() => setHistory(false)} />}
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
