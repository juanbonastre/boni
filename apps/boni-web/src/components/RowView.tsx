import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { editRowValue, useStore } from "../store.ts";
import { Cell } from "./DatabaseBlock.tsx";
import { DocEditor } from "./PageView.tsx";

/**
 * A row of a collection opened as a page, as Notion's: its title big, its properties one per line (the
 * name on the left, the value edited in place on the right), then its text with the page's block editor
 * (headings, lists, to-dos...; kept as Markdown, saved by itself a moment after typing).
 */
export function RowView() {
  const t = useStore((s) => s.t);
  const view = useStore((s) => s.view);
  const row = useStore((s) => s.row);
  const doc = useStore((s) => s.rowDoc);
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
  const title =
    typeof row.values[type.titleField] === "string" ? (row.values[type.titleField] as string) : "";
  return (
    <div className="content page-doc">
      <div className="doc row-doc">
        <div className="row-kind">
          {type.icon && <span>{type.icon}</span>}
          {type.name}
        </div>
        {titleField && (
          <RowTitle
            key={row.id}
            value={title}
            placeholder={t("page.untitled")}
            onSave={(v) => void editRowValue(type.id, row.id, type.titleField, v || null)}
          />
        )}
        <div className="row-props">
          {type.fields
            .filter((f) => f.id !== type.titleField)
            .map((f) => (
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
              </div>
            ))}
        </div>
        {doc && <DocEditor key={doc.id} doc={doc} />}
      </div>
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
