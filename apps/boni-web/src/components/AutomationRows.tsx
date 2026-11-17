/**
 * The rows of a step's last test as ENTRADA and SALIDA paint them, E of F14b (docs/automatizaciones.md AU-71, AU-72):
 * «Esquema» (each field with the first row's value cut to one line, a search over more than ten, a related row or a
 * list unfolded one level), «Tabla» and «JSON», 50 rows at a time with «N filas más» for the next 50 (never all of
 * them at once, A-15), and «Haría esto» for a step that writes: one row per row it would write, with the value
 * before and after of each field that changes. Every value is data from anywhere: painted as plain text, never as
 * HTML, Markdown or a link (A-01). Wherever a value is shown to Juan, a choice is its option's name, never its id
 * (F); «JSON» stays the raw data. A field of «Esquema» can be dragged onto a value of the step's view (AU-21).
 */
import type { Cell } from "@boni/automations";
import { useEffect, useMemo, useState } from "react";
import type { RowView } from "../automations/client.ts";
import { type Choices, DO, namedRow } from "../automations/words.ts";
import type { T } from "../i18n.ts";
import { toast, useStore } from "../store.ts";

/** How «Ver como» shows rows: «Haría esto» only for a step that writes. */
export type RowsShow = "schema" | "table" | "json" | "would";

/** The page of rows asked to the server: 50 at most, and how many there are. */
export type RowsAsk = (offset: number) => Promise<{ rows: RowView[]; total: number }>;

/** More than this many fields and «Esquema» has a search over them (AU-71). */
const FIND_FROM = 10;

/** A value in one line of text: what a cell and «Esquema» show; the whole of it is its title. */
export function cellText(t: T, v: Cell | undefined): string {
  if (v === null || v === undefined || v === "") return t("auto.value.empty");
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return t("auto.value.list", { n: v.length });
  return t("auto.value.row", { n: Object.keys(v).length });
}
/** The whole value, as text: a cell's title. */
const fullText = (v: Cell | undefined): string =>
  v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);

/** What a field dragged from ENTRADA carries (AU-21): the step whose rows it is of, its key and the keys inside. */
export interface DraggedField {
  from: string;
  path: string[];
}
const FIELD = "application/x-boni-field";
export function dragField(e: React.DragEvent, field: DraggedField) {
  e.dataTransfer.setData(FIELD, JSON.stringify(field));
  e.dataTransfer.setData("text/plain", field.path.join("."));
  e.dataTransfer.effectAllowed = "copy";
}
export const carriesField = (e: React.DragEvent) => e.dataTransfer.types.includes(FIELD);
export function draggedOf(e: React.DragEvent): DraggedField | null {
  try {
    const v = JSON.parse(e.dataTransfer.getData(FIELD)) as Partial<DraggedField>;
    return typeof v.from === "string" && Array.isArray(v.path) && v.path.length
      ? { from: v.from, path: v.path.map(String) }
      : null;
  } catch {
    return null;
  }
}

/** The fields of the rows, in the order they first appear. */
function columnsOf(rows: readonly Pick<RowView, "json" | "before">[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r.json)) seen.add(k);
    if (r.before) for (const k of Object.keys(r.before)) seen.add(k);
  }
  return [...seen];
}

/**
 * The rows of one input or output, asked a page at a time. `total`: how many there are (what the test counted);
 * `names`: a field's name by its key, where the draft knows it; `choices`: the options of its choices; `from`: the
 * step the rows are of, when its fields can be dragged onto this step's values (ENTRADA). Opened again for another
 * test, it starts over (the caller keys it by the test).
 */
export function TestRows({
  t,
  ask,
  total,
  show,
  names,
  choices,
  from,
  noAsk = false,
}: {
  t: T;
  ask: RowsAsk;
  total: number;
  show: RowsShow;
  names: Readonly<Record<string, string>>;
  choices?: Choices;
  from?: string;
  /** A removal with «Permiso» «Sí»: «Haría esto» says «sin preguntar» of each row it sends to the trash (AU-187). */
  noAsk?: boolean;
}) {
  const locale = useStore((s) => s.settings.language) === "en" ? "en-GB" : "es-ES";
  const [rows, setRows] = useState<RowView[] | null>(null);
  const [more, setMore] = useState(false);
  const [count, setCount] = useState(total);
  // The first page, once: what the head says comes from the test, the rows from the server.
  useEffect(() => {
    let gone = false;
    ask(0).then(
      (r) => {
        if (gone) return;
        setRows(r.rows);
        setCount(r.total);
      },
      (e) => {
        if (gone) return;
        setRows([]);
        toast(String(e instanceof Error ? e.message : e));
      },
    );
    return () => {
      gone = true;
    };
  }, []);
  // Named again only when the rows or the options change, not on each key of the view that remakes `choices` (A-15).
  const options = choices && JSON.stringify(choices);
  const said = useMemo(() => rows?.map((r) => namedRow(r, choices)) ?? null, [rows, options]);
  if (!rows || !said) return <div className="auto-rows-wait" role="status" aria-busy="true" />;
  const left = count - rows.length;
  const next = () => {
    if (more) return;
    setMore(true);
    ask(rows.length)
      .then(
        (r) => {
          setRows((was) => [...(was ?? []), ...r.rows]);
          setCount(r.total);
        },
        (e) => toast(String(e instanceof Error ? e.message : e)),
      )
      .finally(() => setMore(false));
  };
  return (
    <div className="auto-rows">
      {show === "schema" ? (
        <Schema t={t} row={said[0]} names={names} from={from} />
      ) : show === "json" ? (
        <pre className="auto-rows-json">
          {JSON.stringify(
            rows.map((r) => r.json),
            null,
            2,
          )}
        </pre>
      ) : show === "would" ? (
        <WouldTable t={t} rows={said} names={names} noAsk={noAsk} />
      ) : (
        <RowsTable t={t} rows={said} names={names} />
      )}
      {show !== "schema" && left > 0 && (
        <button
          type="button"
          className="btn ghost small auto-rows-more"
          disabled={more}
          onClick={next}
        >
          {t(DO.moreRows, { n: left.toLocaleString(locale) })}
        </button>
      )}
    </div>
  );
}

/** «Esquema» (AU-71): each field of the first row with its value in one line; a list or a row unfolds one level. */
function Schema({
  t,
  row,
  names,
  from,
}: {
  t: T;
  row: RowView | undefined;
  names: Readonly<Record<string, string>>;
  from?: string;
}) {
  const [q, setQ] = useState("");
  const fields = Object.entries(row?.json ?? {});
  const want = q.trim().toLowerCase();
  const shown = want
    ? fields.filter(([k]) => `${k} ${names[k] ?? ""}`.toLowerCase().includes(want))
    : fields;
  return (
    <div className="auto-schema">
      {fields.length > FIND_FROM && (
        <input
          className="auto-schema-find"
          type="search"
          aria-label={t("auto.fields.find")}
          placeholder={t("auto.fields.find")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
      {want && !shown.length ? (
        <p className="muted small">{t("auto.nothingWith", { q: q.trim() })}</p>
      ) : (
        <ul className="auto-schema-list">
          {shown.map(([k, v]) => (
            <SchemaField
              key={k}
              t={t}
              name={names[k] ?? k}
              value={v}
              drag={from ? { from, path: [k] } : undefined}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Dragged, a field of «Esquema» is cited where it is dropped (AU-21); one inside a row, by its key in it. */
const draggable = (drag: DraggedField | undefined) =>
  drag
    ? {
        draggable: true,
        "data-field": drag.path.join("."),
        onDragStart: (e: React.DragEvent) => {
          e.stopPropagation();
          dragField(e, drag);
        },
      }
    : {};

function SchemaField({
  t,
  name,
  value,
  drag,
}: {
  t: T;
  name: string;
  value: Cell;
  drag?: DraggedField;
}) {
  const nested =
    value && typeof value === "object"
      ? Array.isArray(value)
        ? value.map((v, i) => [String(i + 1), v] as const)
        : Object.entries(value)
      : null;
  if (!nested)
    return (
      <li className="auto-schema-field" {...draggable(drag)}>
        <span className="auto-schema-name">{name}</span>
        <span className="auto-schema-value" title={fullText(value)}>
          {cellText(t, value)}
        </span>
      </li>
    );
  return (
    <li className="auto-schema-field">
      <details>
        <summary {...draggable(drag)}>
          <span className="auto-schema-name">{name}</span>
          <span className="auto-schema-value">{cellText(t, value)}</span>
        </summary>
        <ul className="auto-schema-list nested">
          {nested.map(([k, v]) => (
            <li
              key={k}
              className="auto-schema-field"
              {...draggable(
                drag && !Array.isArray(value)
                  ? { from: drag.from, path: [...drag.path, k] }
                  : undefined,
              )}
            >
              <span className="auto-schema-name">{k}</span>
              {/* One level: what is deeper is said as text. */}
              <span className="auto-schema-value" title={fullText(v)}>
                {v && typeof v === "object" ? fullText(v) : cellText(t, v)}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

/** «Tabla» (AU-71, AU-72): a wide one scrolls sideways in its own box, each cell cut to one line. */
function RowsTable({
  t,
  rows,
  names,
}: {
  t: T;
  rows: readonly RowView[];
  names: Readonly<Record<string, string>>;
}) {
  const cols = columnsOf(rows);
  return (
    <div className="auto-table-wrap">
      <table className="auto-table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c} title={names[c] ?? c}>
                {names[c] ?? c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c} title={fullText(r.json[c])}>
                  {cellText(t, r.json[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * «Haría esto» (AU-72, AU-122): one row per row the step would write. To change one, each field that changes says
 * its value before and after; to make one, only after; to send one to the trash, the row as it was, with «sin
 * preguntar» when a run would not ask (AU-187, AU-189: as the card and «Lo que podrá hacer» say it).
 */
export function WouldTable({
  t,
  rows,
  names,
  noAsk = false,
}: {
  t: T;
  rows: readonly Pick<RowView, "json" | "before" | "would">[];
  names: Readonly<Record<string, string>>;
  noAsk?: boolean;
}) {
  const cols = columnsOf(rows);
  return (
    <div className="auto-table-wrap">
      <table className="auto-table auto-would">
        <thead>
          <tr>
            <th>{t("auto.out.would")}</th>
            {cols.map((c) => (
              <th key={c} title={names[c] ?? c}>
                {names[c] ?? c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const would = r.would ?? (r.before ? "update" : "create");
            return (
              <tr key={i} className={`would-${would}`} data-would={would}>
                <td className="auto-would-what">
                  {t(`auto.would.${would}`)}
                  {would === "trash" && noAsk ? ` · ${t("auto.conn.noAsk")}` : ""}
                </td>
                {cols.map((c) => {
                  const before = r.before?.[c];
                  const after = r.json[c];
                  if (would === "trash")
                    return (
                      <td key={c} title={fullText(before ?? after)}>
                        {cellText(t, before ?? after)}
                      </td>
                    );
                  const changed =
                    would === "update" &&
                    JSON.stringify(before ?? null) !== JSON.stringify(after ?? null);
                  if (!changed)
                    return (
                      <td
                        key={c}
                        className={would === "update" ? "same" : undefined}
                        title={fullText(after)}
                      >
                        {cellText(t, after)}
                      </td>
                    );
                  return (
                    <td
                      key={c}
                      className="changed"
                      title={`${fullText(before)} → ${fullText(after)}`}
                    >
                      <del>{cellText(t, before)}</del>
                      <span aria-hidden> → </span>
                      <ins>{cellText(t, after)}</ins>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
