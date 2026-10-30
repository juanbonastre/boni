import {
  type DatabaseFilter,
  type DatabaseView,
  matchesFilters,
  SYSTEM_COLUMNS,
  type SystemColumn,
} from "@boni/views";
import {
  Calendar as CalendarIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns3,
  LayoutGrid,
  List,
  Maximize2,
  Paperclip,
  Plus,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DataField, DataRow, DataType, DataValue } from "../core/agent.ts";
import type { SystemColumns } from "../core/audit.ts";
import type { T } from "../i18n.ts";
import {
  addRow,
  decideGhost,
  deleteRows,
  editCell,
  loadDataTypes,
  loadRows,
  openFile,
  openProposal,
  openRow,
  resetColumnWidth,
  setColumnWidth,
  toast,
  useStore,
} from "../store.ts";
import { bytes, whoName } from "./Dash.tsx";
import { MenuRow, MenuSep, PointMenu, PopButton } from "./Popover.tsx";
import { ProtectionMenu } from "./Protection.tsx";

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
  named = true,
}: {
  source: string;
  view: DatabaseView;
  onView: (v: DatabaseView) => void;
  /** Its name and protection in its head (not on the collection's own page, whose title has them). */
  named?: boolean;
}) {
  const t = useStore((s) => s.t);
  const types = useStore((s) => s.dataTypes);
  const data = useStore((s) => s.rows[source]);
  const allRows = useStore((s) => s.rows);
  // As Notion: the first rows, more on demand (a collection can hold thousands).
  const [limit, setLimit] = useState(50);
  // The table's chosen rows (Juan, 2026-10-30), here so the head can say what can be done with them.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const also = view.layout === "calendar" ? (view.also ?? []) : [];
  useEffect(() => {
    if (!types) void loadDataTypes();
    void loadRows(source);
  }, [source]);
  useEffect(() => {
    for (const a of also) if (!allRows[a]) void loadRows(a);
  }, [also.join(",")]);
  const type = types?.find((x) => x.id === source);
  if (types && !type) return <p className="doc-gone">{t("db.gone")}</p>;
  const sorted = sortRows(filterRows(data?.rows ?? [], type, view.filter), type, view);
  const rows =
    view.layout === "calendar" || view.layout === "board" ? sorted : sorted.slice(0, limit);
  const more = sorted.length - rows.length;
  const shown = type?.fields.filter((f) => !view.hide?.includes(f.id)) ?? [];
  const titleField = type?.fields.find((f) => f.id === type.titleField);
  const add = async (values: Record<string, DataValue> = {}) => {
    await addRow(source, values);
  };
  return (
    <section className="db" aria-label={type?.name ?? t("db.title")}>
      <header
        className="db-head"
        // Its options stay with rows chosen; a click on one of them lets go of them (Juan, 2026-10-30).
        onPointerDownCapture={(e) => {
          if (picked.size) setPicked(new Set());
        }}
      >
        {named ? (
          <h3 className="db-name">
            {type?.icon && <span className="db-icon">{type.icon}</span>}
            {type?.name ?? "…"}
            {type?.system ? <SystemPill /> : type && <ProtectionMenu type={type} />}
          </h3>
        ) : (
          <span className="db-name" />
        )}
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
        {type && <FilterButton type={type} view={view} onView={onView} />}
        {type && <ViewOptions type={type} view={view} onView={onView} />}
        {!type?.system && (
          <button type="button" className="btn primary small" onClick={() => void add()}>
            <Plus size={14} strokeWidth={2} />
            {t("db.new")}
          </button>
        )}
      </header>
      {!type || !data ? (
        <div className="db-loading">{t("chart.loading")}</div>
      ) : view.layout === "table" ? (
        <TableView
          type={type}
          rows={rows}
          ghosts={data.ghosts ?? []}
          fields={shown}
          titles={data.titles}
          system={view.system ?? []}
          columns={data.columns ?? {}}
          onAdd={() => void add()}
          picked={picked}
          onPick={setPicked}
        />
      ) : view.layout === "board" ? (
        <BoardView type={type} rows={rows} view={view} titles={data.titles} onAdd={add} />
      ) : view.layout === "calendar" ? (
        <CalendarView
          span={view.span ?? "month"}
          onSpan={(span) => onView({ ...view, span })}
          sources={[
            { type, rows: [...(data.ghosts ?? []), ...rows], date: view.date },
            ...also.flatMap((a) => {
              const at = types?.find((x) => x.id === a);
              return at ? [{ type: at, rows: allRows[a]?.rows ?? [] }] : [];
            }),
          ]}
          onAdd={add}
        />
      ) : (
        <CardsView
          type={type}
          rows={rows}
          fields={shown.filter((f) => f.id !== titleField?.id)}
          titles={data.titles}
          gallery={view.layout === "gallery"}
        />
      )}
      {more > 0 && (
        <button type="button" className="db-add-row" onClick={() => setLimit((l) => l + 100)}>
          {t("db.loadMore", { n: more })}
        </button>
      )}
      {/* Over the page's bottom, so nothing above or in the table moves when rows are chosen. */}
      {type &&
        view.layout === "table" &&
        picked.size > 0 &&
        createPortal(
          <SelectionInfo type={type} rows={rows} picked={picked} onPick={setPicked} />,
          document.body,
        )}
    </section>
  );
}

/** Notion's filter: the rows that match every rule (a rule on a field that is gone is left out). */
export function filterRows(
  rows: DataRow[],
  type: DataType | undefined,
  rules: DatabaseFilter[] | undefined,
): DataRow[] {
  if (!type || !rules?.length) return rows;
  const today = ymd(new Date());
  const typeOf = (id: string) => type.fields.find((x) => x.id === id)?.type;
  return rows.filter((row) => matchesFilters(row.values, typeOf, rules, today));
}

/** The operators that fit a field, as Notion offers them. */
export function opsFor(f: DataField): DatabaseFilter["op"][] {
  switch (f.type) {
    case "number":
    case "money":
    case "duration":
      return ["is", "gt", "lt", "empty", "not_empty"];
    case "select":
      return ["is", "is_not", "empty", "not_empty"];
    case "multiselect":
      return ["contains", "not_contains", "empty", "not_empty"];
    case "checkbox":
      return ["checked", "unchecked"];
    case "date":
    case "datetime":
      return ["is", "before", "after", "empty", "not_empty"];
    case "relation":
    case "file":
    case "dates":
      return ["empty", "not_empty"];
    default:
      return ["contains", "not_contains", "is", "is_not", "empty", "not_empty"];
  }
}
const NO_VALUE = new Set(["empty", "not_empty", "checked", "unchecked"]);

/** "Filtro": the view's rules, each a field, an operator and a value; added and removed here. */
function FilterButton({
  type,
  view,
  onView,
}: {
  type: DataType;
  view: DatabaseView;
  onView: (v: DatabaseView) => void;
}) {
  const t = useStore((s) => s.t);
  const rules = view.filter ?? [];
  return (
    <PopButton
      className={`btn ghost small${rules.length ? " on" : ""}`}
      title={t("db.filter")}
      width={420}
      label={rules.length ? `${t("db.filter")} (${rules.length})` : t("db.filter")}
    >
      {() => (
        <div className="pop-section db-filters">
          <FilterEditor
            type={type}
            rules={rules}
            onChange={(next) => onView({ ...view, filter: next.length ? next : undefined })}
          />
        </div>
      )}
    </PopButton>
  );
}

/** Notion's filter rules, edited: a field, an operator that fits it, a value; add and remove. */
export function FilterEditor({
  type,
  rules,
  onChange,
}: {
  type: DataType;
  rules: DatabaseFilter[];
  onChange: (next: DatabaseFilter[]) => void;
}) {
  const t = useStore((s) => s.t);
  const put = onChange;
  const fields = type.fields;
  return (
    <>
      {rules.length === 0 && <p className="muted small">{t("db.noFilter")}</p>}
      {rules.map((r, i) => {
        const f = fields.find((x) => x.id === r.field);
        const ops = f ? opsFor(f) : [];
        const set = (patch: Partial<DatabaseFilter>) =>
          put(rules.map((x, j) => (j === i ? { ...x, ...patch } : x)));
        return (
          <div key={`${r.field}-${i}`} className="db-filter-row">
            <select
              className="input"
              aria-label={t("db.filterField")}
              value={r.field}
              onChange={(e) => {
                const nf = fields.find((x) => x.id === e.target.value);
                if (nf) set({ field: nf.id, op: opsFor(nf)[0] ?? "is", value: undefined });
              }}
            >
              {fields.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <select
              className="input"
              aria-label={t("db.filterOp")}
              value={r.op}
              onChange={(e) => set({ op: e.target.value as DatabaseFilter["op"] })}
            >
              {ops.map((o) => (
                <option key={o} value={o}>
                  {t(`db.ops.${o}`)}
                </option>
              ))}
            </select>
            {!NO_VALUE.has(r.op) && f && (
              <FilterValue field={f} value={r.value} onChange={(value) => set({ value })} />
            )}
            <button
              type="button"
              className="icon-btn tiny"
              aria-label={t("db.filterRemove")}
              title={t("db.filterRemove")}
              onClick={() => put(rules.filter((_, j) => j !== i))}
            >
              <Trash2 size={13} strokeWidth={1.8} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="btn ghost small"
        onClick={() => {
          const f = fields[0];
          if (f) put([...rules, { field: f.id, op: opsFor(f)[0] ?? "contains" }]);
        }}
      >
        <Plus size={14} strokeWidth={1.8} />
        {t("db.filterAdd")}
      </button>
    </>
  );
}

/** A filter rule in words: "Categoría es Salud", "Fecha antes de hoy". */
export function filterText(type: DataType, r: DatabaseFilter, t: T): string {
  const f = type.fields.find((x) => x.id === r.field);
  if (!f) return t("db.gone");
  const value =
    NO_VALUE.has(r.op) || r.value === undefined
      ? ""
      : r.value === "today"
        ? t("db.today")
        : (f.options?.find((o) => o.id === r.value)?.name ?? String(r.value));
  return [f.name, t(`db.ops.${r.op}`), value].filter(Boolean).join(" ");
}

function FilterValue({
  field,
  value,
  onChange,
}: {
  field: DataField;
  value: string | number | undefined;
  onChange: (v: string | number | undefined) => void;
}) {
  const t = useStore((s) => s.t);
  if (field.type === "select" || field.type === "multiselect")
    return (
      <select
        className="input"
        aria-label={t("db.filterValue")}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">—</option>
        {(field.options ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    );
  if (field.type === "date" || field.type === "datetime") {
    const fixed = typeof value === "string" && value !== "today";
    return (
      <>
        <select
          className="input"
          aria-label={t("db.filterValue")}
          value={fixed ? "date" : "today"}
          onChange={(e) => onChange(e.target.value === "today" ? "today" : ymd(new Date()))}
        >
          <option value="today">{t("db.today")}</option>
          <option value="date">{t("db.aDate")}</option>
        </select>
        {fixed && (
          <input
            className="input"
            type="date"
            aria-label={t("db.aDate")}
            value={value}
            onChange={(e) => onChange(e.target.value || "today")}
          />
        )}
      </>
    );
  }
  const numeric = field.type === "number" || field.type === "money" || field.type === "duration";
  return (
    <input
      className="input"
      aria-label={t("db.filterValue")}
      type={numeric ? "number" : "text"}
      defaultValue={value ?? ""}
      onBlur={(e) => {
        const v = e.target.value.trim();
        onChange(v === "" ? undefined : numeric ? Number(v) : v.slice(0, 200));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
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
  const allTypes = useStore((s) => s.dataTypes);
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
          {view.layout === "calendar" && (
            <>
              <MenuSep />
              <div className="menu-head">{t("db.alsoShow")}</div>
              {(allTypes ?? [])
                .filter(
                  (x) =>
                    x.id !== type.id &&
                    x.fields.some((f) => f.type === "date" || f.type === "datetime"),
                )
                .map((x) => {
                  const on = view.also?.includes(x.id) ?? false;
                  return (
                    <MenuRow
                      key={x.id}
                      label={x.name}
                      on={on}
                      onClick={() =>
                        onView({
                          ...view,
                          also: on
                            ? (view.also ?? []).filter((y) => y !== x.id)
                            : [...(view.also ?? []), x.id].slice(0, 10),
                        })
                      }
                    />
                  );
                })}
            </>
          )}
          {view.layout === "table" && (
            <>
              <MenuSep />
              <div className="menu-head">{t("sys.title")}</div>
              {SYSTEM_COLUMNS.map((c) => {
                const on = view.system?.includes(c) ?? false;
                return (
                  <MenuRow
                    key={c}
                    label={t(`sys.${c}`)}
                    on={on}
                    onClick={() =>
                      onView({
                        ...view,
                        system: on
                          ? (view.system ?? []).filter((x) => x !== c)
                          : [...(view.system ?? []), c],
                      })
                    }
                  />
                );
              })}
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

/** A system column's value in words (dates, who, origin, size); nobody edits it. */
export function systemText(
  t: T,
  col: SystemColumn,
  c: SystemColumns | undefined,
  locale: string,
  lang: string,
): string {
  if (!c) return "";
  const date = (at: number | null) =>
    at
      ? new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(at)
      : "";
  switch (col) {
    case "created":
      return date(c.created);
    case "updated":
      return date(c.updated);
    case "seenAt":
      return date(c.seenAt);
    case "createdBy":
      return c.createdBy ? whoName(t, c.createdBy) : "";
    case "updatedBy":
      return c.updatedBy ? whoName(t, c.updatedBy) : "";
    case "editors":
      return c.editors.map((b) => whoName(t, b)).join(", ");
    case "viewers":
      return c.viewers.map((b) => whoName(t, b)).join(", ");
    case "origin":
      return c.origin ? t(`sys.origin.${c.origin}`) : "";
    case "version":
      return String(c.version);
    case "size":
      return bytes(c.size, lang);
  }
}

/** How wide a kind of value is by itself, in px; a column the user widened keeps its own (Juan, 2026-10-30). */
const WIDTH_OF: Partial<Record<string, number>> = {
  checkbox: 72,
  number: 110,
  money: 120,
  duration: 100,
  date: 140,
  datetime: 170,
  time: 90,
  select: 150,
  multiselect: 190,
  relation: 190,
  file: 130,
  email: 200,
  url: 200,
  phone: 140,
};
const widthOf = (f: DataField, title: boolean) => (title ? 280 : (WIDTH_OF[f.type] ?? 200));
const SEL = 36;
const TOOLS = 44;

function TableView({
  type,
  rows,
  ghosts,
  fields,
  titles,
  system,
  columns,
  onAdd,
  picked,
  onPick: setPicked,
}: {
  type: DataType;
  rows: DataRow[];
  ghosts: DataRow[];
  fields: DataField[];
  titles: Record<string, string>;
  system: SystemColumn[];
  columns: Record<string, SystemColumns>;
  onAdd: () => void;
  picked: Set<string>;
  onPick: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const locale = useStore((s) => (s.settings.language === "en" ? "en-GB" : "es-ES"));
  const widths = useStore((s) => s.dataTypes?.find((x) => x.id === type.id)?.rowUi.widths);
  const sys = SYSTEM_COLUMNS.filter((c) => system.includes(c));
  // A mother's table has her daughters' rows: each one's collection is a column (docs/clases.md §2.3; D-11).
  const names = useStore((s) => s.dataTypes);
  const mixed = rows.some((r) => r.type && r.type !== type.id);
  const collectionOf = (r: DataRow) =>
    names?.find((x) => x.id === (r.type ?? type.id))?.name ?? type.name;
  // The title column first, as Notion's.
  const ordered = [
    ...fields.filter((f) => f.id === type.titleField),
    ...fields.filter((f) => f.id !== type.titleField),
  ];
  // Each column as wide as its kind of value, or as the user left it: its edge dragged (moved here without React, kept
  // when let go), a double click on it back to the usual width.
  const table = useRef<HTMLTableElement>(null);
  const cols: { key: string; base: number; name: string; title?: boolean }[] = [
    ...ordered.map((f) => ({
      key: f.id,
      base: widthOf(f, f.id === type.titleField),
      name: f.name,
      title: f.id === type.titleField,
    })),
    ...(mixed ? [{ key: "_collection", base: 150, name: t("db.collection") }] : []),
    ...sys.map((c) => ({ key: `_sys.${c}`, base: 160, name: t(`sys.${c}`) })),
  ];
  const width = (key: string, base: number) => widths?.[key] ?? base;
  // Boni's own tables are read only: no boxes, no menu, no tools (their rows have nothing to be done with).
  const pickable = !type.system;
  const total = (pickable ? SEL + TOOLS : 0) + cols.reduce((n, c) => n + width(c.key, c.base), 0);
  const grab = (key: string, from: number) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = table.current;
    const col = el?.querySelector<HTMLTableColElement>(`col[data-key="${CSS.escape(key)}"]`);
    if (!el || !col) return;
    const x0 = e.clientX;
    let now = from;
    el.classList.add("resizing");
    const move = (ev: PointerEvent) => {
      now = Math.max(48, Math.min(1600, Math.round(from + ev.clientX - x0)));
      col.style.width = `${now}px`;
      el.style.width = `${total - from + now}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      el.classList.remove("resizing");
      if (now !== from) setColumnWidth(type.id, key, now);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  // Rows chosen (Juan, 2026-10-30): a row's box, or a click left of it; Ctrl adds or takes out, Shift a run.
  const anchor = useRef<string | null>(null);
  const choose = (
    id: string,
    e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
    box = false,
  ) =>
    setPicked((cur) => {
      if (e.shiftKey && anchor.current) {
        const a = rows.findIndex((r) => r.id === anchor.current);
        const b = rows.findIndex((r) => r.id === id);
        if (a >= 0 && b >= 0) {
          const [from, to] = a <= b ? [a, b] : [b, a];
          return new Set([...cur, ...rows.slice(from, to + 1).map((r) => r.id)]);
        }
      }
      anchor.current = id;
      if (e.ctrlKey || e.metaKey || box) {
        const next = new Set(cur);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }
      return new Set([id]);
    });
  // Rows gone (deleted, filtered out) leave the selection.
  useEffect(() => {
    setPicked((cur) => {
      const here = new Set(rows.map((r) => r.id));
      const next = new Set([...cur].filter((id) => here.has(id)));
      return next.size === cur.size ? cur : next;
    });
  }, [rows]);
  const remove = (ids: string[]) => {
    void deleteRows(type.id, ids);
    setPicked(new Set());
  };
  // Esc lets go of them (before it goes up a level, App's), Supr sends them to the trash: never while a cell is
  // being written or a menu, a dialog or the search is open (Esc is theirs then).
  useEffect(() => {
    if (!picked.size) return;
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("input:not([type='checkbox']), textarea, select, [contenteditable='true']"))
        return;
      if (document.querySelector(".pop-box, .modal, .find-box")) return;
      if (e.key === "Escape") setPicked(new Set());
      else if (e.key === "Delete" || e.key === "Backspace") remove([...picked]);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });
  // On a collection's own page the whole margin left of the table, up to the sidebar, lights the row beside the
  // pointer and chooses it with a click (Juan, 2026-10-30). Anywhere else, a click outside the block lets go.
  const [lit, setLit] = useState<string | null>(null);
  useEffect(() => {
    const el = table.current;
    const block = el?.closest(".db");
    if (!el || !block || !pickable) return;
    const page = el.closest<HTMLElement>(".content.is-collection");
    const rowAt = (x: number, y: number) => {
      if (!page || x >= el.getBoundingClientRect().left || x < page.getBoundingClientRect().left)
        return null;
      for (const tr of el.querySelectorAll<HTMLElement>("tbody tr[data-row]")) {
        const r = tr.getBoundingClientRect();
        if (y >= r.top && y < r.bottom) return tr.dataset.row ?? null;
      }
      return null;
    };
    const move = (e: PointerEvent) => {
      const id = rowAt(e.clientX, e.clientY);
      setLit((cur) => (cur === id ? cur : id));
    };
    const leave = () => setLit(null);
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const id = rowAt(e.clientX, e.clientY);
      const target = e.target as Element;
      if (id) {
        e.preventDefault();
        choose(id, e);
      } else if (
        picked.size &&
        !block.contains(target) &&
        !target.closest?.(".pop-box, .modal, .find-box, .toast, .db-selinfo")
      )
        setPicked(new Set());
    };
    page?.addEventListener("pointermove", move);
    page?.addEventListener("pointerleave", leave);
    document.addEventListener("pointerdown", down);
    return () => {
      page?.removeEventListener("pointermove", move);
      page?.removeEventListener("pointerleave", leave);
      document.removeEventListener("pointerdown", down);
    };
  });
  useEffect(() => {
    const page = table.current?.closest(".content");
    page?.classList.toggle("db-gutter-on", lit !== null);
    return () => page?.classList.remove("db-gutter-on");
  }, [lit]);
  const all = rows.length > 0 && rows.every((r) => picked.has(r.id));
  const some = picked.size > 0;
  // The right button: the row's menu (a row not chosen is chosen alone first, as in a file manager).
  const [menu, setMenu] = useState<{ x: number; y: number; row: DataRow } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const head = (key: string, base: number, name: string, title?: boolean) => (
    <th key={key} className={title ? "is-title" : key.startsWith("_sys.") ? "sys-col" : undefined}>
      <span className="th-name">{name}</span>
      <span
        className="col-resize"
        title={t("db.resize")}
        aria-hidden="true"
        onPointerDown={grab(key, width(key, base))}
        onDoubleClick={() => resetColumnWidth(type.id, key)}
      />
    </th>
  );
  return (
    <div className="db-table-wrap">
      <table
        ref={table}
        className={`db-table fixed${some ? " has-picked" : ""}`}
        style={{ width: total }}
      >
        <colgroup>
          {pickable && <col style={{ width: SEL }} />}
          {cols.map((c) => (
            <col key={c.key} data-key={c.key} style={{ width: width(c.key, c.base) }} />
          ))}
          {pickable && <col style={{ width: TOOLS }} />}
        </colgroup>
        <thead>
          <tr>
            {pickable && (
              <th className="sel-col">
                {rows.length > 0 && (
                  <input
                    type="checkbox"
                    className="db-check"
                    aria-label={t("db.selectAll")}
                    checked={all}
                    ref={(el) => {
                      if (el) el.indeterminate = some && !all;
                    }}
                    onChange={() => setPicked(all ? new Set() : new Set(rows.map((r) => r.id)))}
                  />
                )}
              </th>
            )}
            {cols.map((c) => head(c.key, c.base, c.name, c.title))}
            {pickable && <th className="row-tools" aria-label={t("db.actions")} />}
          </tr>
        </thead>
        <tbody>
          {/* Pending proposals first, dashed: read only, accepted or rejected here (Juan, 2026-10-22). */}
          {ghosts.map((r) => (
            <tr key={r.id} className="ghost-row">
              {pickable && <td className="sel-col" />}
              {ordered.map((f) => (
                <td key={f.id} className={f.id === type.titleField ? "is-title" : undefined}>
                  <div className="ghost-cell">
                    {f.id === type.titleField ? (
                      <button
                        type="button"
                        className="ghost-text ghost-open"
                        title={t("inbox.open")}
                        onClick={() => void openProposal(r.ghost as string)}
                      >
                        {ghostText(f, r.values[f.id], locale) || t("page.untitled")}
                      </button>
                    ) : (
                      <span className="ghost-text">{ghostText(f, r.values[f.id], locale)}</span>
                    )}
                    {f.id === type.titleField && (
                      <>
                        <span className="ghost-tag">{t("ghost.proposed")}</span>
                        <button
                          type="button"
                          className="icon-btn tiny"
                          title={t("inbox.accept")}
                          aria-label={`${t("inbox.accept")}: ${titleOf(type, r)}`}
                          onClick={() => void decideGhost(type.id, r.ghost as string, true)}
                        >
                          <Check size={13} strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn tiny"
                          title={t("inbox.reject")}
                          aria-label={`${t("inbox.reject")}: ${titleOf(type, r)}`}
                          onClick={() => void decideGhost(type.id, r.ghost as string, false)}
                        >
                          <X size={13} strokeWidth={2} />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              ))}
              {mixed && <td />}
              {sys.map((c) => (
                <td key={c} className="sys-col" />
              ))}
              {pickable && <td className="row-tools" />}
            </tr>
          ))}
          {rows.map((r) => {
            const on = picked.has(r.id);
            const name = titleOf(type, r) || t("page.untitled");
            return (
              <tr
                key={r.id}
                data-row={r.id}
                className={
                  [on && "selected", lit === r.id && "lit"].filter(Boolean).join(" ") || undefined
                }
                onContextMenu={(e) => {
                  if (!pickable) return;
                  e.preventDefault();
                  if (!picked.has(r.id)) {
                    setPicked(new Set([r.id]));
                    anchor.current = r.id;
                  }
                  setMenu({ x: e.clientX, y: e.clientY, row: r });
                }}
              >
                {pickable && (
                  <td
                    className="sel-col"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("input")) return;
                      choose(r.id, e);
                    }}
                  >
                    <input
                      type="checkbox"
                      className="db-check"
                      checked={on}
                      aria-label={`${t("db.select")}: ${name}`}
                      onChange={() => {}}
                      onClick={(e) => {
                        e.stopPropagation();
                        choose(r.id, e, true);
                      }}
                    />
                  </td>
                )}
                {ordered.map((f) => (
                  <td key={f.id} className={f.id === type.titleField ? "is-title" : undefined}>
                    {type.system ? (
                      <span className="db-ro">{ghostText(f, r.values[f.id], locale)}</span>
                    ) : f.id === type.titleField ? (
                      <TitleCell
                        type={type}
                        field={f}
                        row={r}
                        renaming={renaming === r.id}
                        onRename={(yes) => setRenaming(yes ? r.id : null)}
                        onChoose={(e) => choose(r.id, e)}
                      />
                    ) : (
                      <Cell type={type} field={f} row={r} titles={titles} />
                    )}
                  </td>
                ))}
                {mixed && (
                  <td>
                    <span className="db-ro">{collectionOf(r)}</span>
                  </td>
                )}
                {sys.map((c) => {
                  const text = systemText(t, c, columns[r.id], locale, lang);
                  return (
                    <td key={c} className="sys-col">
                      <span className="sys-cell" title={text}>
                        {text}
                      </span>
                    </td>
                  );
                })}
                {pickable && (
                  <td className="row-tools">
                    <button
                      type="button"
                      className="icon-btn tiny"
                      title={t("db.delete")}
                      aria-label={`${t("db.delete")}: ${name}`}
                      onClick={() => remove([r.id])}
                    >
                      <Trash2 size={13} strokeWidth={1.8} />
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!type.system && (
        <button type="button" className="db-add-row" onClick={onAdd}>
          <Plus size={14} strokeWidth={1.8} />
          {t("db.new")}
        </button>
      )}
      {menu && (
        <PointMenu x={menu.x} y={menu.y} label={t("db.rowMenu")} onClose={() => setMenu(null)}>
          {(close) => (
            <div className="menu-list" role="menu">
              {picked.size <= 1 && (
                <MenuRow
                  label={t("db.open")}
                  onClick={() => {
                    close();
                    void openRow(menu.row.type ?? type.id, menu.row.id);
                  }}
                />
              )}
              {picked.size <= 1 && (
                <MenuRow
                  label={t("db.rename")}
                  onClick={() => {
                    close();
                    setRenaming(menu.row.id);
                  }}
                />
              )}
              {picked.size <= 1 && (
                <MenuRow
                  label={t("db.copyLink")}
                  onClick={() => {
                    close();
                    void navigator.clipboard
                      ?.writeText(`boni://note?id=${menu.row.id}`)
                      .then(() => toast(t("db.linkCopied")))
                      .catch(() => {});
                  }}
                />
              )}
              <MenuSep />
              <MenuRow
                label={picked.size > 1 ? t("db.deleteN", { n: picked.size }) : t("db.delete")}
                danger
                onClick={() => {
                  close();
                  remove(picked.size > 1 ? [...picked] : [menu.row.id]);
                }}
              />
            </div>
          )}
        </PointMenu>
      )}
    </div>
  );
}

/** The rows chosen in a table, in a bar over the page's bottom: how many, open one, delete them, let go (Juan,
 * 2026-10-30). */
function SelectionInfo({
  type,
  rows,
  picked,
  onPick,
}: {
  type: DataType;
  rows: DataRow[];
  picked: Set<string>;
  onPick: (s: Set<string>) => void;
}) {
  const t = useStore((s) => s.t);
  const one = picked.size === 1 ? rows.find((r) => picked.has(r.id)) : undefined;
  return (
    <div className="db-selinfo" role="toolbar" aria-label={t("db.selection")}>
      <span className="db-selinfo-count">
        {picked.size === 1 ? t("db.selectedOne") : t("db.selected", { n: picked.size })}
      </span>
      {one && (
        <button
          type="button"
          className="btn ghost small"
          onClick={() => void openRow(one.type ?? type.id, one.id)}
        >
          {t("db.open")}
        </button>
      )}
      <button
        type="button"
        className="btn ghost small danger"
        onClick={() => {
          void deleteRows(type.id, [...picked]);
          onPick(new Set());
        }}
      >
        <Trash2 size={13} strokeWidth={1.8} />
        {picked.size === 1 ? t("db.delete") : t("db.deleteN", { n: picked.size })}
      </button>
      <button
        type="button"
        className="icon-btn tiny"
        title={t("db.unselect")}
        aria-label={t("db.unselect")}
        onClick={() => onPick(new Set())}
      >
        <X size={13} strokeWidth={2} />
      </button>
    </div>
  );
}

/** A row's title in a table (Juan, 2026-10-30): a click opens the row, a double click renames it in place. */
function TitleCell({
  type,
  field,
  row,
  renaming,
  onRename,
  onChoose,
}: {
  type: DataType;
  field: DataField;
  row: DataRow;
  renaming: boolean;
  onRename: (yes: boolean) => void;
  onChoose: (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void;
}) {
  const t = useStore((s) => s.t);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  if (renaming)
    return (
      <TextCell
        field={field}
        value={row.values[field.id] ?? null}
        startEditing
        onDone={() => onRename(false)}
        onSave={(v) => void editCell(type.id, row.id, field.id, v)}
      />
    );
  const title = showValue(field, row.values[field.id] ?? null);
  return (
    <button
      type="button"
      className="db-cell db-title-open"
      title={t("db.titleHint")}
      onClick={(e) => {
        // With Ctrl or Shift, a title chooses its row (as in a file manager) instead of opening it.
        if (e.ctrlKey || e.metaKey || e.shiftKey) return onChoose(e);
        if (timer.current) return;
        timer.current = window.setTimeout(() => {
          timer.current = null;
          void openRow(row.type ?? type.id, row.id);
        }, 240);
      }}
      onDoubleClick={() => {
        if (timer.current) {
          clearTimeout(timer.current);
          timer.current = null;
        }
        onRename(true);
      }}
    >
      {title || <span className="db-empty">{t("page.untitled")}</span>}
    </button>
  );
}

/** Instead of its protection: Boni's own records are read only and no model sees them. */
export function SystemPill() {
  const t = useStore((s) => s.t);
  return (
    <span className="collection-system-pill" title={t("collection.systemHint")}>
      {t("collection.system")}
    </span>
  );
}

/** Notion's "Open": the row as a page, with its properties and its text. */
function OpenButton({ type, row }: { type: DataType; row: DataRow }) {
  const t = useStore((s) => s.t);
  return (
    <button
      type="button"
      className="db-open"
      title={t("db.open")}
      aria-label={`${t("db.open")}: ${titleOf(type, row) || t("page.untitled")}`}
      onClick={() => void openRow(type.id, row.id)}
    >
      <Maximize2 size={12} strokeWidth={2} />
      {t("db.open")}
    </button>
  );
}

/** A ghost row's value as text (it is not edited): an option by its name, a check as ✓. */
function ghostText(f: DataField, v: DataValue | undefined, locale: string): string {
  if (v === null || v === undefined) return "";
  if (f.type === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v))
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${v}T12:00:00Z`));
  if (f.type === "select") return f.options?.find((o) => o.id === v)?.name ?? String(v);
  if (f.type === "checkbox") return v === true ? "✓" : "";
  return typeof v === "string" || typeof v === "number" ? String(v) : "";
}

const titleOf = (type: DataType, r: DataRow) => {
  const v = r.values[type.titleField];
  return typeof v === "string" ? v : "";
};

// ---------------------------------------------------------------- a cell, edited in place

export function Cell({
  type,
  field,
  row,
  titles,
  onSave,
}: {
  type: DataType;
  field: DataField;
  row: DataRow;
  titles: Record<string, string>;
  onSave?: (v: DataValue) => void;
}) {
  const t = useStore((s) => s.t);
  const value = row.values[field.id] ?? null;
  const save = onSave ?? ((v: DataValue) => void editCell(type.id, row.id, field.id, v));
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
    case "file": {
      if (typeof value !== "string") return <span className="db-ro" />;
      const name = titleOf(type, row) || t("db.file");
      return (
        <button
          type="button"
          className="db-file"
          title={t("db.openFile")}
          aria-label={`${t("db.openFile")}: ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            void openFile(value, name);
          }}
        >
          <Paperclip size={12} strokeWidth={2} />
          <span>{t("db.openFile")}</span>
        </button>
      );
    }
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
  startEditing,
  onDone,
}: {
  field: DataField;
  value: DataValue;
  onSave: (v: DataValue) => void;
  /** Written at once (a title renamed by a double click), and told when it is left. */
  startEditing?: boolean;
  onDone?: () => void;
}) {
  const [editing, setEditing] = useState(startEditing ?? false);
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
      // A rename starts with the whole name chosen, as a file's (typing replaces it).
      requestAnimationFrame(() => (startEditing ? ref.current?.select() : ref.current?.focus()));
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
    onDone?.();
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
          onDone?.();
        }
      }}
    />
  );
}

// Formatters made once: building one per cell (toLocaleDateString does) cost most of a table's render.
const DATE_FMT = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeZone: "UTC" });
const DATETIME_FMT = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" });
const MONEY_FMT = new Map<string, Intl.NumberFormat>();
const moneyFmt = (currency: string) => {
  let f = MONEY_FMT.get(currency);
  if (!f) {
    try {
      f = new Intl.NumberFormat("es-ES", { style: "currency", currency });
    } catch {
      f = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 });
    }
    MONEY_FMT.set(currency, f);
  }
  return f;
};

const DATE_FMTS = new Map<string, Intl.DateTimeFormat>();
const dateFmt = (locale: string, o: Intl.DateTimeFormatOptions) => {
  const key = `${locale} ${JSON.stringify(o)}`;
  let f = DATE_FMTS.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...o, timeZone: "UTC" });
    DATE_FMTS.set(key, f);
  }
  return f;
};

function showValue(field: DataField, value: DataValue): string {
  if (value == null) return "";
  if (typeof value === "object" && !Array.isArray(value))
    return moneyFmt(value.currency).format(value.amount);
  if (field.type === "datetime" && typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : DATETIME_FMT.format(d);
  }
  if (field.type === "date" && typeof value === "string") {
    const d = new Date(`${value}T12:00:00Z`);
    return Number.isNaN(d.getTime()) ? value : DATE_FMT.format(d);
  }
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
          <OpenButton type={type} row={row} />
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

const SOURCE_COLORS = [
  "var(--opt-blue)",
  "var(--opt-green)",
  "var(--opt-orange)",
  "var(--opt-purple)",
  "var(--opt-pink)",
  "var(--opt-yellow)",
  "var(--opt-red)",
  "var(--opt-brown)",
];

interface CalItem {
  type: DataType;
  row: DataRow;
  time: string;
  color: string;
}

/** A month, from Monday, of every collection given (each with its colour, as the areas of the agenda). */
function CalendarView({
  sources,
  span,
  onSpan,
  onAdd,
}: {
  sources: { type: DataType; rows: DataRow[]; date?: string }[];
  span: "month" | "week";
  onSpan: (s: "month" | "week") => void;
  onAdd: (values?: Record<string, DataValue>) => Promise<void>;
}) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const locale = lang === "en" ? "en-GB" : "es-ES";
  const dateOf = (type: DataType, chosen?: string) =>
    type.fields.find((f) => f.id === chosen && (f.type === "date" || f.type === "datetime")) ??
    type.fields.find((f) => f.type === "date" || f.type === "datetime");
  const main = sources[0];
  const mainDate = main ? dateOf(main.type, main.date) : undefined;
  // The day the view is on (UTC midnight); the month or the week around it is shown.
  const [anchor, setAnchor] = useState(() => new Date(`${ymd(new Date())}T00:00:00Z`));
  const byDay = useMemo(() => {
    const m = new Map<string, CalItem[]>();
    sources.forEach((src, si) => {
      const df = dateOf(src.type, src.date);
      if (!df) return;
      // The start time (a collection may also have an end time, as the agenda's).
      const times = src.type.fields.filter((f) => f.type === "time");
      const tf =
        times.find((f) => /start|inicio|comienzo|empieza/i.test(`${f.id} ${f.name}`)) ?? times[0];
      for (const r of src.rows) {
        const v = r.values[df.id];
        if (typeof v !== "string") continue;
        const day = v.slice(0, 10);
        const tv = tf ? r.values[tf.id] : null;
        const time =
          typeof tv === "string" ? tv.slice(0, 5) : df.type === "datetime" ? v.slice(11, 16) : "";
        const item = {
          type: src.type,
          row: r,
          time,
          color: SOURCE_COLORS[si % SOURCE_COLORS.length] ?? "var(--accent)",
        };
        m.set(day, [...(m.get(day) ?? []), item]);
      }
    });
    for (const list of m.values())
      list.sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
    return m;
  }, [sources]);
  if (!mainDate) return <p className="db-hint">{t("db.calendarNeedsDate")}</p>;
  const week = span === "week";
  const first = week
    ? new Date(anchor)
    : new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
  const count = week ? 7 : 42;
  const days = Array.from({ length: count }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    return d;
  });
  const shown = week
    ? days
    : days.slice(0, days[35] && days[35].getUTCMonth() !== first.getUTCMonth() ? 35 : 42);
  const today = ymd(new Date());
  const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => dateFmt(locale, o).format(d);
  const long = week
    ? `${fmt(days[0] as Date, { day: "numeric", month: "short" })} – ${fmt(days[6] as Date, { day: "numeric", month: "short", year: "numeric" })}`
    : fmt(first, { month: "long", year: "numeric" });
  // "octubre de 2026" -> "Octubre de 2026" (only the first letter).
  const title = long.charAt(0).toUpperCase() + long.slice(1);
  const step = (n: number) => {
    const d = new Date(anchor);
    if (week) d.setUTCDate(d.getUTCDate() + 7 * n);
    else d.setUTCMonth(d.getUTCMonth() + n, 1);
    setAnchor(d);
  };
  const add = (key: string) =>
    void onAdd({ [mainDate.id]: mainDate.type === "date" ? key : `${key}T09:00:00.000Z` });
  return (
    <div className="db-calendar">
      <div className="db-cal-head">
        <span className="db-cal-title">{title}</span>
        {sources.length > 1 && (
          <span className="db-cal-legend">
            {sources.map((s, i) => (
              <span key={s.type.id} className="db-cal-key">
                <span
                  className="db-dot"
                  style={{ ["--c" as string]: SOURCE_COLORS[i % SOURCE_COLORS.length] }}
                />
                {s.type.name}
              </span>
            ))}
          </span>
        )}
        <div className="db-span" role="radiogroup" aria-label={t("db.span")}>
          {(["month", "week"] as const).map((sp) => (
            <button
              key={sp}
              type="button"
              role="radio"
              aria-checked={span === sp}
              className={`db-layout${span === sp ? " on" : ""}`}
              onClick={() => onSpan(sp)}
            >
              {t(`db.spans.${sp}`)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn ghost small"
          onClick={() => setAnchor(new Date(`${ymd(new Date())}T00:00:00Z`))}
        >
          {t("db.today")}
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => step(-1)}
          aria-label={week ? t("db.prevWeek") : t("db.prevMonth")}
        >
          <ChevronLeft size={16} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => step(1)}
          aria-label={week ? t("db.nextWeek") : t("db.nextMonth")}
        >
          <ChevronRight size={16} strokeWidth={1.8} />
        </button>
      </div>
      {week && (
        <div className="db-cal-weekdays">
          {days.map((d) => (
            <div key={ymd(d)} className={`db-cal-wd${ymd(d) === today ? " today" : ""}`}>
              {fmt(d, { weekday: "short", day: "numeric" })}
            </div>
          ))}
        </div>
      )}
      <div className={`db-cal-grid${week ? " week" : ""}`}>
        {shown.map((d) => {
          const key = ymd(d);
          const items = byDay.get(key) ?? [];
          const visible = week ? items : items.slice(0, 4);
          return (
            <div
              key={key}
              className={`db-cal-day${!week && d.getUTCMonth() !== first.getUTCMonth() ? " other" : ""}${key === today ? " today" : ""}`}
            >
              <div className="db-cal-num">
                {!week && <span>{d.getUTCDate()}</span>}
                <button
                  type="button"
                  className="icon-btn tiny db-cal-add"
                  aria-label={`${t("db.new")}: ${key}`}
                  onClick={() => add(key)}
                >
                  <Plus size={12} strokeWidth={2} />
                </button>
              </div>
              {visible.map((it) => (
                <button
                  key={it.row.id}
                  type="button"
                  className={`db-cal-item${week ? " tall" : ""}${it.row.ghost ? " ghost" : ""}`}
                  style={{ ["--c" as string]: it.color }}
                  title={it.row.ghost ? t("ghost.proposed") : undefined}
                  onClick={() =>
                    it.row.ghost
                      ? void openProposal(it.row.ghost)
                      : void openRow(it.type.id, it.row.id)
                  }
                >
                  {it.time && <span className="db-cal-time">{it.time}</span>}
                  <span className="db-cal-text">
                    {titleOf(it.type, it.row) || t("page.untitled")}
                  </span>
                </button>
              ))}
              {items.length > visible.length && (
                <div className="db-cal-more">+{items.length - visible.length}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
