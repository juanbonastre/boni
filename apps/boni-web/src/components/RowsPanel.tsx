import { useEffect, useState } from "react";
import type { DataRow, DataType } from "../core/agent.ts";
import { isDataBlock } from "../core/blocks.ts";
import {
  agentApi,
  errorText,
  loadDataTypes,
  openBlockPanel,
  openRow,
  useEditing,
  useStore,
} from "../store.ts";

/**
 * What a click on a number or a chart opens (design audit, Juan 2026-10-25): the rows it counts, with its filter and
 * its period, as Notion opens a chart's rows; a bar or a point shows only its own (`drill`). The server picks them
 * with the same engine as the number (packages/views `blockRows`), so the list always adds up to it. A row of the
 * user's opens as its page; Boni's own records are read only. The block's menu stays on its handle.
 */
export function RowsPanel({ id, drill, label }: { id: string; drill?: string; label?: string }) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const doc = useEditing();
  const types = useStore((s) => s.dataTypes);
  const block = doc?.spec.blocks.find((b) => b.id === id);
  const data = block && isDataBlock(block) ? block : null;
  const type = types?.find((x) => x.id === data?.collection);
  const [rows, setRows] = useState<{ rows: DataRow[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!types) void loadDataTypes();
  }, []);
  // Asked again when what it counts changes (not its look).
  const key = data
    ? JSON.stringify({ ...data, at: undefined, bg: undefined, color: undefined })
    : "";
  useEffect(() => {
    if (!data) return;
    setRows(null);
    setError(null);
    const { at: _a, ...b } = data;
    agentApi
      .blockRows(b, drill)
      .then((r) => {
        if ("problems" in r) setError(t("block.problem.title"));
        else setRows(r);
      })
      .catch((e) => setError(errorText(t, e)));
  }, [key, drill]);
  if (!data) return <p className="muted panel-body">{t("block.panel.gone")}</p>;
  const locale = lang === "en" ? "en-GB" : "es-ES";
  return (
    <div className="panel-body rows-panel">
      <p className="muted small">{t("rows.hint")}</p>
      {type && (
        <p className="rows-panel-count">
          {type.name}
          {label ? ` · ${label}` : ""}
          {rows ? ` · ${t("rows.count", { n: rows.total })}` : ""}
        </p>
      )}
      {error && (
        <p className="form-error">
          {error}{" "}
          <button type="button" className="btn small" onClick={() => openBlockPanel(id)}>
            {t("block.problem.fix")}
          </button>
        </p>
      )}
      {!rows && !error && <p className="muted">{t("chart.loading")}</p>}
      {rows && type && (
        <RowList
          type={type}
          rows={rows.rows}
          field={data.measure && data.measure !== "count" ? data.field : undefined}
          group={data.groupBy && !data.groupBy.startsWith("@") ? data.groupBy : undefined}
          date={data.date}
          locale={locale}
        />
      )}
      {rows && rows.total > rows.rows.length && (
        <p className="muted small">{t("rows.more", { n: rows.rows.length })}</p>
      )}
    </div>
  );
}

function RowList({
  type,
  rows,
  field,
  group,
  date,
  locale,
}: {
  type: DataType;
  rows: DataRow[];
  field?: string;
  group?: string;
  date?: string;
  locale: string;
}) {
  const t = useStore((s) => s.t);
  const dateField = date ?? type.fields.find((f) => f.type === "date" || f.type === "datetime")?.id;
  const optionName = (fieldId: string, v: unknown) => {
    const f = type.fields.find((x) => x.id === fieldId);
    const name = (x: unknown) => f?.options?.find((o) => o.id === x)?.name ?? String(x ?? "");
    return Array.isArray(v) ? v.map(name).join(", ") : name(v);
  };
  const amount = (v: unknown) => {
    const money = v && typeof v === "object" && "amount" in v;
    const n = typeof v === "number" ? v : money ? Number((v as { amount: number }).amount) : null;
    if (n === null || !Number.isFinite(n)) return "";
    return money
      ? new Intl.NumberFormat(locale, {
          style: "currency",
          currency: "EUR",
          maximumFractionDigits: 4,
        }).format(n)
      : new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n);
  };
  if (!rows.length) return <p className="muted">{t("rows.none")}</p>;
  return (
    <ul className="rows-panel-list">
      {rows.map((r) => {
        const inner = (
          <>
            <span className="rows-panel-title">
              {String(r.values[type.titleField] ?? "") || t("page.untitled")}
            </span>
            <span className="muted small rows-panel-sub">
              {dateField ? String(r.values[dateField] ?? "").slice(0, 10) : ""}
              {group ? ` · ${optionName(group, r.values[group])}` : ""}
            </span>
            {field && <span className="rows-panel-value">{amount(r.values[field])}</span>}
          </>
        );
        return (
          <li key={r.id}>
            {type.system ? (
              <div className="rows-panel-row">{inner}</div>
            ) : (
              <button
                type="button"
                className="rows-panel-row"
                onClick={() => void openRow(type.id, r.id)}
              >
                {inner}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
