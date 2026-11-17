/**
 * The connections of a «Código» step in its view (docs/automatizaciones.md AU-41, AU-43, AU-44, AU-176, AU-179): a
 * table with one row per collection and one column per action, «Leer» always «Sí» and the three of writing «No»,
 * «Preguntar» or «Sí» each on its own, with whether the code uses it; what the code uses without permission in red,
 * with «Permitir» (which sets «Preguntar», never «Sí»); a row's read limits, opened from it; and the sentence under
 * the table. The words come from automations/connections.ts and nothing here decides what the step may do.
 */
import type { CodeContext, Connection, Step, WriteAction, WriteMode } from "@boni/automations";
import { CODE_LIMITS } from "@boni/automations";
import type { FilterItem } from "@boni/views";
import type { ReactNode } from "react";
import {
  actionWord,
  columnWord,
  connectionRows,
  connectionsSentence,
  limitsOf,
  type WriteCell,
} from "../automations/connections.ts";
import type { ConditionField } from "../automations/panel.ts";
import { DO } from "../automations/words.ts";
import type { T } from "../i18n.ts";

const CELLS: readonly WriteCell[] = [false, "ask", "yes"];
const cellValue = (c: WriteCell) => (c === false ? "no" : c);

export function ConnectionsTable({
  t,
  step,
  context,
  locale,
  readOnly,
  fieldsOf,
  filterEditor,
  setCell,
  allow,
  disconnect,
  setLimits,
}: {
  t: T;
  step: Step;
  context: CodeContext;
  locale: string;
  readOnly: boolean;
  /** A collection's fields by key, with their names. */
  fieldsOf: (collection: string) => readonly ConditionField[] | undefined;
  /** The views' filter editor over a collection's fields (AU-43), as the step view paints one. */
  filterEditor: (
    fields: readonly ConditionField[],
    items: FilterItem[],
    set: (next: FilterItem[]) => void,
  ) => ReactNode;
  setCell: (collection: string, action: WriteAction, cell: false | WriteMode) => void;
  allow: (collection: string, action: WriteAction) => void;
  disconnect: (collection: string) => void;
  setLimits: (
    collection: string,
    limits: { where?: FilterItem[]; fields?: string[] | undefined; limit?: number | undefined },
  ) => void;
}) {
  const connections = step.connections ?? [];
  const rows = connectionRows(t, step, context, locale);
  const nameOf = (key: string) => context.collectionName?.(key) ?? key;
  const missing = rows.flatMap((r) =>
    r.cells.filter((c) => c.missing).map((c) => ({ row: r, action: c.action })),
  );
  const title = t("auto.conn.title");
  return (
    <div className="auto-param auto-param-connections" data-param="connections">
      <span className="auto-param-name">{title}</span>
      <div className="auto-param-control">
        {rows.length === 0 ? (
          <p className="muted small auto-conn-none">{t("auto.conn.none")}</p>
        ) : (
          <div className="auto-table-wrap">
            <table className="auto-table auto-conn-table" aria-label={title}>
              <thead>
                <tr>
                  <th>{t("auto.conn.col.collection")}</th>
                  <th>{t("auto.conn.col.read")}</th>
                  {(["create", "update", "remove"] as const).map((a) => (
                    <th key={a}>{columnWord(t, a)}</th>
                  ))}
                  {!readOnly && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.collection} data-collection={r.collection}>
                    <th scope="row" className="auto-conn-name">
                      {r.name}
                    </th>
                    <td className="auto-conn-cell" data-action="read">
                      {[t("auto.conn.mode.yes"), ...r.limits].join(" · ")}
                    </td>
                    {r.cells.map((c) => {
                      const label = `${columnWord(t, c.action)} · ${r.name}`;
                      return (
                        <td
                          key={c.action}
                          className={`auto-conn-cell${c.missing ? " missing" : ""}`}
                          data-action={c.action}
                          data-cell={cellValue(c.cell)}
                        >
                          <select
                            aria-label={label}
                            value={cellValue(c.cell)}
                            disabled={readOnly}
                            data-boni-action="automations.edit"
                            onChange={(e) =>
                              setCell(
                                r.collection,
                                c.action,
                                CELLS.find((x) => cellValue(x) === e.target.value) ?? false,
                              )
                            }
                          >
                            {CELLS.map((x) => (
                              <option key={cellValue(x)} value={cellValue(x)}>
                                {t(`auto.conn.mode.${cellValue(x)}`)}
                              </option>
                            ))}
                          </select>
                          {(c.cell !== false || c.used) && (
                            <span className="auto-conn-use">
                              {t(c.used ? "auto.conn.used" : "auto.conn.unused")}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    {!readOnly && (
                      <td className="auto-conn-row-do">
                        <button
                          type="button"
                          className="btn ghost small"
                          data-boni-action="automations.edit"
                          onClick={() => disconnect(r.collection)}
                        >
                          {t(DO.disconnect)}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {missing.map(({ row, action }) => (
          <div
            key={`${row.collection}-${action}`}
            className="auto-view-notice auto-conn-allow"
            role="alert"
          >
            <span>{t("auto.conn.allow", { action: actionWord(t, action), name: row.name })}</span>
            {!readOnly && (
              <button
                type="button"
                className="btn small"
                data-boni-action="automations.edit"
                onClick={() => allow(row.collection, action)}
              >
                {t(DO.allow)}
              </button>
            )}
          </div>
        ))}
        {connections.map((c) => (
          <ReadLimits
            key={c.collection}
            t={t}
            connection={c}
            name={nameOf(c.collection)}
            locale={locale}
            fields={fieldsOf(c.collection) ?? []}
            filterEditor={filterEditor}
            set={(limits) => setLimits(c.collection, limits)}
          />
        ))}
        {rows.length > 0 && (
          <p className="auto-conn-sentence">{connectionsSentence(t, connections, nameOf)}</p>
        )}
      </div>
    </div>
  );
}

/** A connection's read limits (AU-43), folded under the table: the filter, the fields and the limit. */
function ReadLimits({
  t,
  connection,
  name,
  locale,
  fields,
  filterEditor,
  set,
}: {
  t: T;
  connection: Connection;
  name: string;
  locale: string;
  fields: readonly ConditionField[];
  filterEditor: (
    fields: readonly ConditionField[],
    items: FilterItem[],
    set: (next: FilterItem[]) => void,
  ) => ReactNode;
  set: (limits: {
    where?: FilterItem[];
    fields?: string[] | undefined;
    limit?: number | undefined;
  }) => void;
}) {
  const read = connection.read === false ? {} : connection.read;
  const chosen = read.fields;
  const said = limitsOf(t, connection, locale);
  const toggle = (key: string, on: boolean) => {
    const all = fields.map((f) => f.key);
    const now = new Set(chosen ?? all);
    if (on) now.add(key);
    else now.delete(key);
    const next = all.filter((k) => now.has(k));
    set({ fields: next.length === all.length ? undefined : next });
  };
  return (
    <details className="auto-conn-limits" data-collection={connection.collection}>
      <summary>
        {t("auto.conn.limits", { name })}
        {said.length > 0 && <span className="auto-conn-limits-said"> · {said.join(" · ")}</span>}
      </summary>
      <div className="auto-conn-limit" data-limit="where">
        <span className="auto-param-name">{t("auto.conn.where")}</span>
        <div className="auto-conditions">
          {filterEditor(fields, [...(read.where ?? [])], (next) => set({ where: next }))}
        </div>
      </div>
      <fieldset className="auto-conn-limit auto-conn-fields" data-limit="fields">
        <legend className="auto-param-name">{t("auto.conn.fields")}</legend>
        {fields.map((f) => (
          <label key={f.key} className="auto-conn-field">
            <input
              type="checkbox"
              checked={!chosen || chosen.includes(f.key)}
              data-boni-action="automations.edit"
              onChange={(e) => toggle(f.key, e.target.checked)}
            />
            {f.name}
          </label>
        ))}
      </fieldset>
      <label className="auto-conn-limit" data-limit="limit">
        <span className="auto-param-name">{t("auto.conn.limit")}</span>
        <input
          type="number"
          min={1}
          max={CODE_LIMITS.readRows}
          step={1}
          inputMode="numeric"
          placeholder={t("auto.conn.noLimit")}
          value={read.limit ?? ""}
          data-boni-action="automations.edit"
          onChange={(e) => {
            const n = e.target.value === "" ? undefined : Math.floor(Number(e.target.value));
            set({ limit: n !== undefined && Number.isFinite(n) ? n : undefined });
          }}
        />
      </label>
    </details>
  );
}
