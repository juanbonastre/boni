import { type ControlBlock, controlValueOk, type PageBlock } from "@boni/views";
import { useEffect, useState } from "react";
import { loadRows, useStore } from "../store.ts";

/**
 * A «Control» block (docs/sistema.md §4.6, F11; D-59): one value of the page, shown as a control the person changes,
 * as a Grafana dashboard's variable. An option is a list of a field's options or of the records a relation points to,
 * «Todas» first (nothing: everything counts); a month, a month picker; a number or a text, a box kept on Enter or
 * when it is left. A change is a page write (the value is saved with the page, undoable, the same on every device);
 * the page's numbers, charts and tables that name it are asked again (the server computes them, never the app).
 */

/** The control with a new value; null or "" takes it out. */
export function withValue(b: ControlBlock, value: string | number | null): PageBlock {
  if (value === null || value === "") {
    const { value: _v, ...rest } = b;
    return rest as PageBlock;
  }
  return { ...b, value } as PageBlock;
}

export function ControlView({
  block,
  onValue,
}: {
  block: ControlBlock;
  onValue: (value: string | number | null) => void;
}) {
  const t = useStore((s) => s.t);
  const id = `ctl-${block.id}`;
  return (
    <div className="ctl" data-boni-action="pages.set_value">
      <label className="ctl-name" htmlFor={id}>
        {block.name}
      </label>
      {block.kind === "option" ? (
        <OptionPicker id={id} block={block} onValue={onValue} />
      ) : block.kind === "month" ? (
        <input
          id={id}
          className="input ctl-input"
          type="month"
          value={typeof block.value === "string" ? block.value : ""}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "" || controlValueOk("month", v)) onValue(v || null);
          }}
        />
      ) : (
        <Typed id={id} block={block} onValue={onValue} placeholder={t("control.any")} />
      )}
    </div>
  );
}

/** An option's choices: the field's options, or the records of the collection a relation points to, by title. */
function OptionPicker({
  id,
  block,
  onValue,
}: {
  id: string;
  block: ControlBlock;
  onValue: (value: string | null) => void;
}) {
  const t = useStore((s) => s.t);
  const field = useStore((s) =>
    s.dataTypes?.find((d) => d.id === block.collection)?.fields.find((f) => f.id === block.field),
  );
  const target = field?.type === "relation" ? (field.relation?.target ?? "") : "";
  const titleField = useStore((s) => s.dataTypes?.find((d) => d.id === target)?.titleField ?? "");
  const rows = useStore((s) => (target ? s.rows[target]?.rows : undefined));
  useEffect(() => {
    if (target && !rows) void loadRows(target);
  }, [target]);
  const choices: { id: string; name: string }[] = target
    ? (rows ?? [])
        .map((r) => {
          const v = r.values[titleField];
          return { id: r.id, name: typeof v === "string" && v ? v : t("page.untitled") };
        })
        .sort((a, b) => a.name.localeCompare(b.name))
    : (field?.options ?? []);
  const value = typeof block.value === "string" ? block.value : "";
  // A value the list does not have (yet, or any longer) stays chosen, said as unknown, until another is picked.
  const known = !value || choices.some((c) => c.id === value);
  return (
    <select
      id={id}
      className="input ctl-input"
      value={value}
      aria-busy={(target !== "" && !rows) || undefined}
      onChange={(e) => onValue(e.target.value || null)}
    >
      <option value="">{t("control.all")}</option>
      {!known && (
        <option value={value}>{target && !rows ? t("chart.loading") : t("control.unknown")}</option>
      )}
      {choices.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

/** A number or a text: kept on Enter or when the box is left; emptied, nothing. */
function Typed({
  id,
  block,
  onValue,
  placeholder,
}: {
  id: string;
  block: ControlBlock;
  onValue: (value: string | number | null) => void;
  placeholder: string;
}) {
  const saved = block.value === undefined ? "" : String(block.value);
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);
  const keep = () => {
    const v = draft.trim();
    if (v === saved) return;
    if (!v) return onValue(null);
    if (block.kind === "number") {
      const n = Number(v.replace(",", "."));
      return controlValueOk("number", n) ? onValue(n) : setDraft(saved);
    }
    return controlValueOk("text", v) ? onValue(v) : setDraft(saved);
  };
  return (
    <input
      id={id}
      className="input ctl-input"
      type="text"
      inputMode={block.kind === "number" ? "decimal" : undefined}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={keep}
      onKeyDown={(e) => {
        if (e.key === "Enter") keep();
        if (e.key === "Escape") setDraft(saved);
      }}
    />
  );
}
