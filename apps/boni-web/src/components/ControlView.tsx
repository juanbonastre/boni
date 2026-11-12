import { type ControlBlock, controlValueOk, isDay, type PageBlock, spanOf } from "@boni/views";
import { useEffect, useState } from "react";
import { loadRows, useStore } from "../store.ts";

/**
 * A «Control» block (docs/sistema.md §4.6, F11; D-59): one value of the page, shown as a control the person changes,
 * as a Grafana dashboard's variable. An option is a list of a field's options or of the records a relation points to,
 * «Todas» first (nothing: everything counts); a month, a month picker; a period, two days («Desde», «Hasta», both
 * included; task 102); a number or a text, a box kept on Enter or when it is left. A change is a page write (the value is saved with the page, undoable, the same on every device);
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
  const id = `ctl-${block.id}`;
  return (
    <div className="ctl" data-boni-action="pages.set_value">
      <label className="ctl-name" htmlFor={id}>
        {block.name}
      </label>
      <ControlInput id={id} block={block} onValue={onValue} />
    </div>
  );
}

/**
 * What a control of its kind is set with, alone: the page's control, and a link's fixed value for a control of the
 * page it opens (its panel, task 102), which sets `block.value` the same way.
 */
export function ControlInput({
  id,
  block,
  onValue,
  label,
}: {
  id: string;
  block: ControlBlock;
  onValue: (value: string | number | null) => void;
  /** Its name when no label points at it (a panel's row). */
  label?: string;
}) {
  const t = useStore((s) => s.t);
  return block.kind === "option" ? (
    <OptionPicker id={id} block={block} onValue={onValue} label={label} />
  ) : block.kind === "month" ? (
    <input
      id={id}
      className="input ctl-input"
      aria-label={label}
      type="month"
      value={typeof block.value === "string" ? block.value : ""}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "" || controlValueOk("month", v)) onValue(v || null);
      }}
    />
  ) : block.kind === "period" ? (
    <PeriodPicker id={id} block={block} onValue={onValue} />
  ) : (
    <Typed id={id} block={block} onValue={onValue} placeholder={t("control.any")} label={label} />
  );
}

/**
 * A period: its first and its last day (civil days, as the date inputs give them). It is set once both are days,
 * in their order (a first day after the last is turned round); both emptied, nothing. A half-filled one waits here.
 */
function PeriodPicker({
  id,
  block,
  onValue,
}: {
  id: string;
  block: ControlBlock;
  onValue: (value: string | null) => void;
}) {
  const t = useStore((s) => s.t);
  const span = controlValueOk("period", block.value) ? spanOf(block.value) : null;
  const from = span?.start ?? "";
  const to = span?.end ?? "";
  const [draft, setDraft] = useState({ from, to });
  useEffect(() => setDraft({ from, to }), [from, to]);
  const put = (next: { from: string; to: string }) => {
    setDraft(next);
    if (!next.from && !next.to) return onValue(null);
    if (!isDay(next.from) || !isDay(next.to)) return;
    const [a, b] = next.from <= next.to ? [next.from, next.to] : [next.to, next.from];
    if (a !== from || b !== to) onValue(`${a}/${b}`);
  };
  return (
    <span className="ctl-period">
      <input
        id={id}
        className="input ctl-input"
        type="date"
        aria-label={t("control.from")}
        title={t("control.from")}
        value={draft.from}
        onChange={(e) => put({ ...draft, from: e.target.value })}
      />
      <span className="ctl-period-to" aria-hidden="true">
        –
      </span>
      <input
        className="input ctl-input"
        type="date"
        aria-label={t("control.to")}
        title={t("control.to")}
        value={draft.to}
        onChange={(e) => put({ ...draft, to: e.target.value })}
      />
    </span>
  );
}

/** The records of a collection, by title, in order: what a relation's control or rule picks one of. */
export function useRecordChoices(target: string): {
  choices: { id: string; name: string }[];
  loading: boolean;
} {
  const t = useStore((s) => s.t);
  const titleField = useStore((s) => s.dataTypes?.find((d) => d.id === target)?.titleField ?? "");
  const rows = useStore((s) => (target ? s.rows[target]?.rows : undefined));
  useEffect(() => {
    if (target && !rows) void loadRows(target);
  }, [target]);
  const choices = (rows ?? [])
    .map((r) => {
      const v = r.values[titleField];
      return { id: r.id, name: typeof v === "string" && v ? v : t("page.untitled") };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { choices, loading: target !== "" && !rows };
}

/** An option's choices: the field's options, or the records of the collection a relation points to, by title. */
function OptionPicker({
  id,
  block,
  onValue,
  label,
}: {
  id: string;
  block: ControlBlock;
  onValue: (value: string | null) => void;
  label?: string;
}) {
  const t = useStore((s) => s.t);
  const field = useStore((s) =>
    s.dataTypes?.find((d) => d.id === block.collection)?.fields.find((f) => f.id === block.field),
  );
  const target = field?.type === "relation" ? (field.relation?.target ?? "") : "";
  const records = useRecordChoices(target);
  const choices: { id: string; name: string }[] = target ? records.choices : (field?.options ?? []);
  const value = typeof block.value === "string" ? block.value : "";
  // A value the list does not have (yet, or any longer) stays chosen, said as unknown, until another is picked.
  const known = !value || choices.some((c) => c.id === value);
  return (
    <select
      id={id}
      className="input ctl-input"
      aria-label={label}
      value={value}
      aria-busy={records.loading || undefined}
      onChange={(e) => onValue(e.target.value || null)}
    >
      <option value="">{t("control.all")}</option>
      {!known && (
        <option value={value}>{records.loading ? t("chart.loading") : t("control.unknown")}</option>
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
  label,
}: {
  id: string;
  block: ControlBlock;
  onValue: (value: string | number | null) => void;
  placeholder: string;
  label?: string;
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
      aria-label={label}
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
