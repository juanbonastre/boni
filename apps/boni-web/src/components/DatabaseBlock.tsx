import type { DatabaseView } from "@boni/views";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Columns3,
  LayoutGrid,
  List,
  Plus,
  Table2,
  Trash2,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { DataField, DataRow, DataType, DataValue } from "../core/agent.ts";
import { addRow, deleteRow, editCell, loadDataTypes, loadRows, useStore } from "../store.ts";
import { MenuRow, MenuSep, PopButton } from "./Popover.tsx";

/**
 * A collection of the user's as a Notion database (plan PR 19): its name, the layouts (table, board, list,
 * gallery, calendar), "New", and every cell edited where it is. Values are the user's (the server writes
 * them with the user's label and checks them against the field); a value from outside (a mail's) is shown
 * as plain text like any other, never as a link or HTML.
 */

const LAYOUTS: { id: DatabaseView["layout"]; icon: ReactNode }[] = [
  { id: "table", icon: <Table2 size={14} strokeWidth={1.8} /> },
  { id: "board", icon: <Columns3 size={14} strokeWidth={1.8} /> },
  { id: "list", icon: <List size={14} strokeWidth={1.8} /> },
  { id: "gallery", icon: <LayoutGrid size={14} strokeWidth={1.8} /> },
  { id: "calendar", icon: <CalendarIcon size={14} strokeWidth={1.8} /> },
];

/** Notion's option colours, by name (the core keeps a colour name or none). */
const OPTION_COLORS: Record<string, string> = {
  gray: "var(--opt-gray)",
  brown: "var(--opt-brown)",
  orange: "var(--opt-orange)",
  yellow: "var(--opt-yellow)",
  green: "var(--opt-green)",
  blue: "var(--opt-blue)",
  purple: "var(--opt-purple)",
  pink: "var(--opt-pink)",
  red: "var(--opt-red)",
};
const CYCLE = ["blue", "green", "purple", "orange", "pink", "yellow", "red", "brown", "gray"];
const optionColor = (f: DataField, id: string) => {
  const i = f.options?.findIndex((o) => o.id === id) ?? 0;
  const o = f.options?.[i];
  return (
    OPTION_COLORS[o?.color ?? ""] ?? OPTION_COLORS[CYCLE[Math.max(0, i) % CYCLE.length] ?? "gray"]
  );
};

export function DatabaseBlock({
  source,
  view,
  onView,
}: {
  source: string;
  view: DatabaseView;
  onView: (v: DatabaseView) => void;
}) {
  const t = useStore((s) => s.t);
  const types = useStore((s) => s.dataTypes);
  const data = useStore((s) => s.rows[source]);
  useEffect(() => {
    if (!types) void loadDataTypes();
    void loadRows(source);
  }, [source]);
  const type = types?.find((x) => x.id === source);
  if (types && !type) return <p className="doc-gone">{t("db.gone")}</p>;
  const rows = sortRows(data?.rows ?? [], type, view);
  const shown = type?.fields.filter((f) => !view.hide?.includes(f.id)) ?? [];
  const titleField = type?.fields.find((f) => f.id === type.titleField);
  const add = async (values: Record<string, DataValue> = {}) => {
    await addRow(source, values);
  };
  return (
    <section className="db" aria-label={type?.name ?? t("db.title")}>
      <header className="db-head">
        <h3 className="db-name">
          {type?.icon && <span className="db-icon">{type.icon}</span>}
          {type?.name ?? "…"}
        </h3>
        <div className="db-layouts" role="radiogroup" aria-label={t("db.layout")}>
          {LAYOUTS.map((l) => (
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={view.layout === l.id}
              className={`db-layout${view.layout === l.id ? " on" : ""}`}
              title={t(`db.layouts.${l.id}`)}
              aria-label={t(`db.layouts.${l.id}`)}
              onClick={() => onView({ ...view, layout: l.id })}
            >
              {l.icon}
              <span>{t(`db.layouts.${l.id}`)}</span>
            </button>
          ))}
        </div>
        {type && <ViewOptions type={type} view={view} onView={onView} />}
        <button type="button" className="btn primary small" onClick={() => void add()}>
          <Plus size={14} strokeWidth={2} />
          {t("db.new")}
        </button>
      </header>
      {!type || !data ? (
        <div className="db-loading">{t("chart.loading")}</div>
      ) : view.layout === "table" ? (
        <TableView
          type={type}
          rows={rows}
          fields={shown}
          titles={data.titles}
          onAdd={() => void add()}
        />
      ) : view.layout === "board" ? (
        <BoardView type={type} rows={rows} view={view} titles={data.titles} onAdd={add} />
      ) : view.layout === "calendar" ? (
        <CalendarView type={type} rows={rows} view={view} onAdd={add} />
      ) : (
        <CardsView
          type={type}
          rows={rows}
          fields={shown.filter((f) => f.id !== titleField?.id)}
          titles={data.titles}
          gallery={view.layout === "gallery"}
        />
      )}
    </section>
  );
}

function sortRows(rows: DataRow[], type: DataType | undefined, view: DatabaseView): DataRow[] {
  const s = view.sort;
  if (!type || !s) return rows;
  const f = type.fields.find((x) => x.id === s.field);
  if (!f) return rows;
  const key = (r: DataRow) => {
    const v = r.values[f.id];
    if (typeof v === "number") return v;
    if (v && typeof v === "object" && !Array.isArray(v)) return v.amount;
    if (f.type === "select" && typeof v === "string")
      return f.options?.findIndex((o) => o.id === v) ?? 0;
    return String(v ?? "").toLowerCase();
  };
  return [...rows].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    const c = x < y ? -1 : x > y ? 1 : 0;
    return s.desc ? -c : c;
  });
}

/** The view's options (Notion's "…" of a view): sort, the board's grouping, the calendar's date, the
 * properties shown. */
function ViewOptions({
  type,
  view,
  onView,
}: {
  type: DataType;
  view: DatabaseView;
  onView: (v: DatabaseView) => void;
}) {
  const t = useStore((s) => s.t);
  const selects = type.fields.filter((f) => f.type === "select");
  const dates = type.fields.filter((f) => f.type === "date" || f.type === "datetime");
  return (
    <PopButton
      className="btn ghost small"
      title={t("db.options")}
      width={260}
      label={t("db.options")}
    >
      {() => (
        <div className="menu-list scroll" role="menu">
          <div className="menu-head">{t("db.sortBy")}</div>
          <MenuRow
            label={t("db.noSort")}
            on={!view.sort}
            onClick={() => onView({ ...view, sort: undefined })}
          />
          {type.fields.map((f) => (
            <MenuRow
              key={f.id}
              label={`${f.name}${view.sort?.field === f.id ? (view.sort.desc ? " ↓" : " ↑") : ""}`}
              on={view.sort?.field === f.id}
              onClick={() =>
                onView({
                  ...view,
                  sort: {
                    field: f.id,
                    ...(view.sort?.field === f.id && !view.sort.desc ? { desc: true } : {}),
                  },
                })
              }
            />
          ))}
          {view.layout === "board" && selects.length > 0 && (
            <>
              <MenuSep />
              <div className="menu-head">{t("db.groupBy")}</div>
              {selects.map((f) => (
                <MenuRow
                  key={f.id}
                  label={f.name}
                  on={(view.group ?? selects[0]?.id) === f.id}
                  onClick={() => onView({ ...view, group: f.id })}
                />
              ))}
            </>
          )}
          {view.layout === "calendar" && dates.length > 0 && (
            <>
              <MenuSep />
              <div className="menu-head">{t("db.dateBy")}</div>
              {dates.map((f) => (
                <MenuRow
                  key={f.id}
                  label={f.name}
                  on={(view.date ?? dates[0]?.id) === f.id}
                  onClick={() => onView({ ...view, date: f.id })}
                />
              ))}
            </>
          )}
          <MenuSep />
          <div className="menu-head">{t("db.properties")}</div>
          {type.fields
            .filter((f) => f.id !== type.titleField)
            .map((f) => {
              const hidden = view.hide?.includes(f.id) ?? false;
              return (
                <MenuRow
                  key={f.id}
                  label={f.name}
                  on={!hidden}
                  onClick={() =>
                    onView({
                      ...view,
                      hide: hidden
                        ? (view.hide ?? []).filter((x) => x !== f.id)
                        : [...(view.hide ?? []), f.id],
                    })
                  }
                />
              );
            })}
        </div>
      )}
    </PopButton>
  );
}

// ---------------------------------------------------------------- table

function TableView({
  type,
  rows,
  fields,
  titles,
  onAdd,
}: {
  type: DataType;
  rows: DataRow[];
  fields: DataField[];
  titles: Record<string, string>;
  onAdd: () => void;
}) {
  const t = useStore((s) => s.t);
  // The title column first, as Notion's.
  const ordered = [
    ...fields.filter((f) => f.id === type.titleField),
    ...fields.filter((f) => f.id !== type.titleField),
  ];
  return (
    <div className="db-table-wrap">
      <table className="db-table">
        <thead>
          <tr>
            {ordered.map((f) => (
              <th key={f.id} className={f.id === type.titleField ? "is-title" : undefined}>
                {f.name}
              </th>
            ))}
            <th className="row-tools" aria-label={t("db.actions")} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {ordered.map((f) => (
                <td key={f.id} className={f.id === type.titleField ? "is-title" : undefined}>
                  <Cell type={type} field={f} row={r} titles={titles} />
                </td>
              ))}
              <td className="row-tools">
                <button
                  type="button"
                  className="icon-btn tiny"
                  title={t("db.delete")}
                  aria-label={`${t("db.delete")}: ${titleOf(type, r)}`}
                  onClick={() => void deleteRow(type.id, r.id)}
                >
                  <Trash2 size={13} strokeWidth={1.8} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="db-add-row" onClick={onAdd}>
        <Plus size={14} strokeWidth={1.8} />
        {t("db.new")}
      </button>
    </div>
  );
}

const titleOf = (type: DataType, r: DataRow) => {
  const v = r.values[type.titleField];
  return typeof v === "string" ? v : "";
};

// ---------------------------------------------------------------- a cell, edited in place

function Cell({
  type,
  field,
  row,
  titles,
}: {
  type: DataType;
  field: DataField;
  row: DataRow;
  titles: Record<string, string>;
}) {
  const t = useStore((s) => s.t);
  const value = row.values[field.id] ?? null;
  const save = (v: DataValue) => void editCell(type.id, row.id, field.id, v);
  switch (field.type) {
    case "checkbox":
      return (
        <input
          type="checkbox"
          className="db-check"
          checked={value === true}
          aria-label={field.name}
          onChange={(e) => save(e.target.checked)}
        />
      );
    case "select":
      return (
        <OptionPicker
          field={field}
          picked={typeof value === "string" ? [value] : []}
          onPick={(ids) => save(ids[0] ?? null)}
        />
      );
    case "multiselect":
      return (
        <OptionPicker
          field={field}
          many
          picked={Array.isArray(value) ? value : []}
          onPick={(ids) => save(ids.length ? ids : null)}
        />
      );
    case "relation": {
      const ids = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
      return (
        <span className="db-ro">
          {ids.map((id) => titles[id] || t("page.untitled")).join(", ")}
        </span>
      );
    }
    case "file":
    case "dates":
      return <span className="db-ro">{Array.isArray(value) ? value.join(", ") : ""}</span>;
    default:
      return <TextCell field={field} value={value} onSave={save} />;
  }
}

const INPUT_TYPES: Record<string, string> = {
  number: "number",
  money: "number",
  date: "date",
  time: "time",
  duration: "number",
  url: "url",
  email: "email",
  phone: "tel",
};

/** A text-like value: shown as text, a click makes it a field; Enter or leaving saves, Esc does not. */
function TextCell({
  field,
  value,
  onSave,
}: {
  field: DataField;
  value: DataValue;
  onSave: (v: DataValue) => void;
}) {
  const [editing, setEditing] = useState(false);
  const shown = showValue(field, value);
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? String(value.amount)
      : field.type === "datetime" && typeof value === "string"
        ? value.slice(0, 16)
        : value == null
          ? ""
          : String(value);
  const [text, setText] = useState(raw);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      setText(raw);
      requestAnimationFrame(() => ref.current?.focus());
    }
  }, [editing]);
  if (!editing)
    return (
      <button type="button" className="db-cell" onClick={() => setEditing(true)}>
        {shown || <span className="db-empty">{" "}</span>}
      </button>
    );
  const commit = () => {
    setEditing(false);
    if (text === raw) return;
    const v = text.trim();
    if (!v) return onSave(null);
    if (field.type === "number" || field.type === "duration") {
      const n = Number(v.replace(",", "."));
      if (Number.isFinite(n)) onSave(field.type === "duration" ? Math.round(n) : n);
    } else if (field.type === "money") {
      const n = Number(v.replace(",", "."));
      const currency =
        value && typeof value === "object" && !Array.isArray(value) ? value.currency : "EUR";
      if (Number.isFinite(n)) onSave({ amount: n, currency });
    } else if (field.type === "datetime") onSave(new Date(v).toISOString());
    else onSave(v);
  };
  return (
    <input
      ref={ref}
      className="db-input"
      type={field.type === "datetime" ? "datetime-local" : (INPUT_TYPES[field.type] ?? "text")}
      aria-label={field.name}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") {
          e.preventDefault();
          setEditing(false);
        }
      }}
    />
  );
}

function showValue(field: DataField, value: DataValue): string {
  if (value == null) return "";
  if (typeof value === "object" && !Array.isArray(value))
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: value.currency }).format(
      value.amount,
    );
  if (field.type === "datetime" && typeof value === "string")
    return new Date(value).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });
  if (field.type === "date" && typeof value === "string")
    return new Date(`${value}T12:00:00Z`).toLocaleDateString("es-ES", { dateStyle: "medium" });
  if (field.type === "duration" && typeof value === "number")
    return `${Math.floor(value / 60)} h ${value % 60} min`;
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/** Options as Notion's coloured pills; a click opens the list to pick (one, or several). */
function OptionPicker({
  field,
  picked,
  many,
  onPick,
}: {
  field: DataField;
  picked: string[];
  many?: boolean;
  onPick: (ids: string[]) => void;
}) {
  const t = useStore((s) => s.t);
  const pills = picked.map((id) => {
    const o = field.options?.find((x) => x.id === id);
    return (
      <span key={id} className="db-pill" style={{ ["--c" as string]: optionColor(field, id) }}>
        {o?.name ?? id}
      </span>
    );
  });
  return (
    <PopButton
      className="db-cell"
      title={field.name}
      align="start"
      width={220}
      label={
        pills.length ? (
          <span className="db-pills">{pills}</span>
        ) : (
          <span className="db-empty">{" "}</span>
        )
      }
    >
      {(close) => (
        <div className="menu-list scroll" role="menu">
          {!many && (
            <MenuRow
              label={t("db.none")}
              on={picked.length === 0}
              onClick={() => {
                close();
                onPick([]);
              }}
            />
          )}
          {(field.options ?? []).map((o) => (
            <MenuRow
              key={o.id}
              label={o.name}
              on={picked.includes(o.id)}
              icon={
                <span className="db-dot" style={{ ["--c" as string]: optionColor(field, o.id) }} />
              }
              onClick={() => {
                if (!many) close();
                onPick(
                  many
                    ? picked.includes(o.id)
                      ? picked.filter((x) => x !== o.id)
                      : [...picked, o.id]
                    : [o.id],
                );
              }}
            />
          ))}
        </div>
      )}
    </PopButton>
  );
}

// ---------------------------------------------------------------- board

function BoardView({
  type,
  rows,
  view,
  titles,
  onAdd,
}: {
  type: DataType;
  rows: DataRow[];
  view: DatabaseView;
  titles: Record<string, string>;
  onAdd: (values?: Record<string, DataValue>) => Promise<void>;
}) {
  const t = useStore((s) => s.t);
  const group =
    type.fields.find((f) => f.id === view.group && f.type === "select") ??
    type.fields.find((f) => f.type === "select");
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  if (!group) return <p className="db-hint">{t("db.boardNeedsSelect")}</p>;
  const columns = [
    { id: "", name: t("db.noValue", { field: group.name }) },
    ...(group.options ?? []),
  ];
  const props = type.fields.filter(
    (f) => f.id !== type.titleField && f.id !== group.id && !view.hide?.includes(f.id),
  );
  return (
    <div className="db-board">
      {columns.map((c) => {
        const inCol = rows.filter((r) => (r.values[group.id] ?? "") === c.id);
        if (!c.id && inCol.length === 0) return null;
        return (
          <div
            key={c.id || "none"}
            className={`db-column${over === c.id ? " over" : ""}`}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              setOver(c.id);
            }}
            onDragLeave={() => setOver((o) => (o === c.id ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging) void editCell(type.id, dragging, group.id, c.id || null);
              setDragging(null);
              setOver(null);
            }}
          >
            <div className="db-column-head">
              {c.id ? (
                <span className="db-pill" style={{ ["--c" as string]: optionColor(group, c.id) }}>
                  {c.name}
                </span>
              ) : (
                <span className="muted">{c.name}</span>
              )}
              <span className="db-count">{inCol.length}</span>
            </div>
            {inCol.map((r) => (
              <div
                key={r.id}
                className={`db-card${dragging === r.id ? " dragging" : ""}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", r.id);
                  setDragging(r.id);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
              >
                <CardBody type={type} row={r} fields={props} titles={titles} />
              </div>
            ))}
            <button
              type="button"
              className="db-add-row"
              onClick={() => void onAdd(c.id ? { [group.id]: c.id } : {})}
            >
              <Plus size={14} strokeWidth={1.8} />
              {t("db.new")}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** A card's content: its title (edited in place) and the properties that have a value. */
function CardBody({
  type,
  row,
  fields,
  titles,
}: {
  type: DataType;
  row: DataRow;
  fields: DataField[];
  titles: Record<string, string>;
}) {
  const title = type.fields.find((f) => f.id === type.titleField);
  return (
    <>
      {title && (
        <div className="db-card-title">
          <Cell type={type} field={title} row={row} titles={titles} />
        </div>
      )}
      {fields
        .filter((f) => {
          const v = row.values[f.id];
          return v != null && v !== "" && !(Array.isArray(v) && v.length === 0);
        })
        .map((f) => (
          <div key={f.id} className="db-card-prop" title={f.name}>
            <Cell type={type} field={f} row={row} titles={titles} />
          </div>
        ))}
    </>
  );
}

// ---------------------------------------------------------------- list and gallery

function CardsView({
  type,
  rows,
  fields,
  titles,
  gallery,
}: {
  type: DataType;
  rows: DataRow[];
  fields: DataField[];
  titles: Record<string, string>;
  gallery: boolean;
}) {
  const t = useStore((s) => s.t);
  if (!rows.length) return <p className="db-hint">{t("db.empty")}</p>;
  return (
    <div className={gallery ? "db-gallery" : "db-list"}>
      {rows.map((r) => (
        <div key={r.id} className={gallery ? "db-card" : "db-list-row"}>
          <CardBody type={type} row={r} fields={fields} titles={titles} />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- calendar

const ymd = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

function CalendarView({
  type,
  rows,
  view,
  onAdd,
}: {
  type: DataType;
  rows: DataRow[];
  view: DatabaseView;
  onAdd: (values?: Record<string, DataValue>) => Promise<void>;
}) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const dateField =
    type.fields.find((f) => f.id === view.date && (f.type === "date" || f.type === "datetime")) ??
    type.fields.find((f) => f.type === "date" || f.type === "datetime");
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1));
  });
  const byDay = useMemo(() => {
    const m = new Map<string, DataRow[]>();
    if (!dateField) return m;
    for (const r of rows) {
      const v = r.values[dateField.id];
      if (typeof v !== "string") continue;
      const day = v.slice(0, 10);
      m.set(day, [...(m.get(day) ?? []), r]);
    }
    return m;
  }, [rows, dateField]);
  if (!dateField) return <p className="db-hint">{t("db.calendarNeedsDate")}</p>;
  // Weeks from Monday, covering the month.
  const first = new Date(month);
  const start = new Date(first);
  start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    return d;
  });
  const weeks = days[35] && days[35].getUTCMonth() !== month.getUTCMonth() ? 5 : 6;
  const today = ymd(new Date());
  const title = month.toLocaleDateString(lang === "en" ? "en-GB" : "es-ES", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const step = (n: number) =>
    setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + n, 1)));
  return (
    <div className="db-calendar">
      <div className="db-cal-head">
        <span className="db-cal-title">{title}</span>
        <button
          type="button"
          className="icon-btn"
          onClick={() => step(-1)}
          aria-label={t("db.prevMonth")}
        >
          <ChevronLeft size={16} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => step(1)}
          aria-label={t("db.nextMonth")}
        >
          <ChevronRight size={16} strokeWidth={1.8} />
        </button>
      </div>
      <div className="db-cal-grid">
        {days.slice(0, weeks * 7).map((d) => {
          const key = ymd(d);
          const items = byDay.get(key) ?? [];
          return (
            <div
              key={key}
              className={`db-cal-day${d.getUTCMonth() === month.getUTCMonth() ? "" : " other"}${key === today ? " today" : ""}`}
            >
              <div className="db-cal-num">
                <span>{d.getUTCDate()}</span>
                <button
                  type="button"
                  className="icon-btn tiny db-cal-add"
                  aria-label={`${t("db.new")}: ${key}`}
                  onClick={() =>
                    void onAdd({
                      [dateField.id]: dateField.type === "date" ? key : `${key}T09:00:00.000Z`,
                    })
                  }
                >
                  <Plus size={12} strokeWidth={2} />
                </button>
              </div>
              {items.slice(0, 4).map((r) => (
                <div key={r.id} className="db-cal-item">
                  {titleOf(type, r) || t("page.untitled")}
                </div>
              ))}
              {items.length > 4 && <div className="db-cal-more">+{items.length - 4}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
