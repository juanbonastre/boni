/**
 * The connections of a «Código» or an «Agente» step in its view (docs/automatizaciones.md AU-41, AU-43, AU-44, AU-48,
 * AU-52, AU-176, AU-179, AU-196, AU-200): a table with one row per collection and one column per action, the three of
 * writing «No», «Preguntar» or «Sí» each on its own. In a «Código» «Leer» is always «Sí», with whether the code uses
 * each cell and what it uses without permission in red, with «Permitir» (which sets «Preguntar», never «Sí»). In an
 * «Agente» «Leer» is «No» or «Sí», a collection is connected from «Conectar» (never one no model may read, AU-166), and
 * each action not at «No» opens its own limits: «Solo estas filas», the fields (each «No lo escribe», «Lo decide la
 * IA» or «Fijo») and «Como mucho». The words come from automations/connections.ts and nothing here decides what the
 * step may do.
 */
import type {
  CodeContext,
  Connection,
  ParamValue,
  Step,
  WriteAction,
  WriteMode,
} from "@boni/automations";
import { ACTION_ROWS_MAX, AGENT_TYPE, CODE_LIMITS, MAX_CONNECTIONS } from "@boni/automations";
import type { FilterItem } from "@boni/views";
import type { ReactNode } from "react";
import {
  actionWord,
  columnWord,
  connectionRows,
  connectionsSentence,
  limitsOf,
  type WriteCell,
  writeLimitsOf,
} from "../automations/connections.ts";
import { type FieldFill, fieldFills, type WriteLimits } from "../automations/edit.ts";
import type { ConditionField } from "../automations/panel.ts";
import { DO } from "../automations/words.ts";
import type { T } from "../i18n.ts";
import { MenuRow, PopButton } from "./Popover.tsx";

const CELLS: readonly WriteCell[] = [false, "ask", "yes"];
const cellValue = (c: WriteCell) => (c === false ? "no" : c);
/** «No», «Preguntar», «Sí»: the last two are the words of «Colección»'s «Permiso», by its keys (AU-85, AU-187). */
const modeWord = (t: T, c: WriteCell) =>
  c === false ? t("auto.conn.mode.no") : t(`auto.choice.collection.permission.${c}`);
const FILLS: readonly FieldFill[] = ["none", "ai", "fixed"];

type FilterEditor = (
  fields: readonly ConditionField[],
  items: FilterItem[],
  set: (next: FilterItem[]) => void,
) => ReactNode;

/** What only an «Agente»'s table does (AU-41, AU-48, AU-52, AU-196). */
export interface AgentConnections {
  /** The collections it may connect now, by name: none it holds and none no model may read (AU-166). */
  connectable: readonly { key: string; name: string }[];
  connect: (collection: string) => void;
  setRead: (collection: string, on: boolean) => void;
  setWriteLimits: (collection: string, action: WriteAction, limits: WriteLimits) => void;
  setWriteField: (
    collection: string,
    action: "create" | "update",
    keys: readonly string[],
    field: string,
    fill: FieldFill,
  ) => void;
  /** A field's fixed value, painted by its type as «los campos de una fila» paints one (AU-52, AU-80). */
  fixedValue: (
    collection: string,
    action: "create" | "update",
    field: ConditionField,
    value: ParamValue | undefined,
  ) => ReactNode;
}

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
  agent,
}: {
  t: T;
  step: Step;
  context: CodeContext;
  locale: string;
  readOnly: boolean;
  /** A collection's fields by key, with their names. */
  fieldsOf: (collection: string) => readonly ConditionField[] | undefined;
  /** The views' filter editor over a collection's fields (AU-43), as the step view paints one. */
  filterEditor: FilterEditor;
  setCell: (collection: string, action: WriteAction, cell: false | WriteMode) => void;
  allow: (collection: string, action: WriteAction) => void;
  disconnect: (collection: string) => void;
  setLimits: (
    collection: string,
    limits: { where?: FilterItem[]; fields?: string[] | undefined; limit?: number | undefined },
  ) => void;
  /** Given for an «Agente». */
  agent?: AgentConnections;
}) {
  const connections = step.connections ?? [];
  const isAgent = step.type === AGENT_TYPE && agent !== undefined;
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
          <p className="muted small auto-conn-none">
            {t(isAgent ? "auto.conn.agent.none" : "auto.conn.none")}
          </p>
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
                    {isAgent ? (
                      <td
                        className="auto-conn-cell"
                        data-action="read"
                        data-cell={r.reads ? "yes" : "no"}
                      >
                        <select
                          aria-label={`${columnWord(t, "read")} · ${r.name}`}
                          value={r.reads ? "yes" : "no"}
                          disabled={readOnly}
                          data-boni-action="automations.edit"
                          onChange={(e) => agent.setRead(r.collection, e.target.value === "yes")}
                        >
                          <option value="no">{modeWord(t, false)}</option>
                          <option value="yes">{modeWord(t, "yes")}</option>
                        </select>
                        {r.reads && r.limits.length > 0 && (
                          <span className="auto-conn-use">{r.limits.join(" · ")}</span>
                        )}
                      </td>
                    ) : (
                      <td className="auto-conn-cell" data-action="read">
                        {[modeWord(t, "yes"), ...r.limits].join(" · ")}
                      </td>
                    )}
                    {r.cells.map((c) => {
                      const label = `${columnWord(t, c.action)} · ${r.name}`;
                      const said = isAgent
                        ? c.limits
                        : c.cell !== false || c.used
                          ? [t(c.used ? "auto.conn.used" : "auto.conn.unused"), ...c.limits]
                          : [];
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
                                {modeWord(t, x)}
                              </option>
                            ))}
                          </select>
                          {said.length > 0 && (
                            <span className="auto-conn-use">{said.join(" · ")}</span>
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
        {isAgent &&
          !readOnly &&
          connections.length < MAX_CONNECTIONS &&
          agent.connectable.length > 0 && (
            <div className="auto-conn-connect">
              <PopButton
                label={t(DO.connect)}
                title={t(DO.connect)}
                className="btn ghost small"
                align="start"
              >
                {(done) =>
                  agent.connectable.map((c) => (
                    <MenuRow
                      key={c.key}
                      label={c.name}
                      boniAction="automations.edit"
                      onClick={() => {
                        done();
                        agent.connect(c.key);
                      }}
                    />
                  ))
                }
              </PopButton>
            </div>
          )}
        {connections.map((c) =>
          isAgent ? (
            <AgentLimits
              key={c.collection}
              t={t}
              connection={c}
              name={nameOf(c.collection)}
              locale={locale}
              fields={fieldsOf(c.collection) ?? []}
              filterEditor={filterEditor}
              setRead={(limits) => setLimits(c.collection, limits)}
              agent={agent}
            />
          ) : (
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
          ),
        )}
        {rows.length > 0 && (
          <p className="auto-conn-sentence">
            {connectionsSentence(t, connections, nameOf, step.type, locale)}
          </p>
        )}
      </div>
    </div>
  );
}

type SetRead = (limits: {
  where?: FilterItem[];
  fields?: string[] | undefined;
  limit?: number | undefined;
}) => void;

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
  filterEditor: FilterEditor;
  set: SetRead;
}) {
  const said = limitsOf(t, connection, locale);
  return (
    <details className="auto-conn-limits" data-collection={connection.collection}>
      <summary>
        {t("auto.conn.limits", { name })}
        {said.length > 0 && <span className="auto-conn-limits-said"> · {said.join(" · ")}</span>}
      </summary>
      <ReadControls
        t={t}
        connection={connection}
        fields={fields}
        filterEditor={filterEditor}
        set={set}
      />
    </details>
  );
}

/** «Solo estas filas», «Solo estos campos» and «Límite de filas» of reading (AU-43). */
function ReadControls({
  t,
  connection,
  fields,
  filterEditor,
  set,
}: {
  t: T;
  connection: Connection;
  fields: readonly ConditionField[];
  filterEditor: FilterEditor;
  set: SetRead;
}) {
  const read = connection.read === false ? {} : connection.read;
  const chosen = read.fields;
  const toggle = (key: string, on: boolean) => {
    const all = fields.map((f) => f.key);
    const now = new Set(chosen ?? all);
    if (on) now.add(key);
    else now.delete(key);
    const next = all.filter((k) => now.has(k));
    set({ fields: next.length === all.length ? undefined : next });
  };
  return (
    <>
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
      <RowsLimit
        t={t}
        name={t("auto.conn.limit")}
        limit="limit"
        max={CODE_LIMITS.readRows}
        value={read.limit}
        set={(limit) => set({ limit })}
      />
    </>
  );
}

/** A limit of rows: empty is none. */
function RowsLimit({
  t,
  name,
  limit,
  max,
  value,
  set,
}: {
  t: T;
  name: string;
  limit: string;
  max: number;
  value: number | undefined;
  set: (n: number | undefined) => void;
}) {
  return (
    <label className="auto-conn-limit" data-limit={limit}>
      <span className="auto-param-name">{name}</span>
      <input
        type="number"
        min={1}
        max={max}
        step={1}
        inputMode="numeric"
        placeholder={t("auto.conn.noLimit")}
        value={value ?? ""}
        data-boni-action="automations.edit"
        onChange={(e) => {
          const n = e.target.value === "" ? undefined : Math.floor(Number(e.target.value));
          set(n !== undefined && Number.isFinite(n) ? n : undefined);
        }}
      />
    </label>
  );
}

/**
 * An «Agente»'s connection opened (AU-43, AU-48, AU-52, AU-196): reading's limits when it reads, and under each write
 * action not at «No» its own: «Solo estas filas» (modify, remove), the fields (create, modify) and «Como mucho».
 */
function AgentLimits({
  t,
  connection,
  name,
  locale,
  fields,
  filterEditor,
  setRead,
  agent,
}: {
  t: T;
  connection: Connection;
  name: string;
  locale: string;
  fields: readonly ConditionField[];
  filterEditor: FilterEditor;
  setRead: SetRead;
  agent: AgentConnections;
}) {
  const key = connection.collection;
  const said = [
    ...limitsOf(t, connection, locale),
    ...(["create", "update", "remove"] as const).flatMap((a) =>
      writeLimitsOf(t, connection, a, locale).map((w) => `${columnWord(t, a)} ${w}`),
    ),
  ];
  const keys = fields.map((f) => f.key);
  return (
    <details className="auto-conn-limits" data-collection={key}>
      <summary>
        {t("auto.conn.limits", { name })}
        {said.length > 0 && <span className="auto-conn-limits-said"> · {said.join(" · ")}</span>}
      </summary>
      {connection.read !== false && (
        <section className="auto-conn-action" data-action="read">
          <h4 className="auto-conn-action-name">{columnWord(t, "read")}</h4>
          <ReadControls
            t={t}
            connection={connection}
            fields={fields}
            filterEditor={filterEditor}
            set={setRead}
          />
        </section>
      )}
      {(["create", "update", "remove"] as const).map((a) => {
        const cell = connection[a];
        if (cell === false) return null;
        return (
          <section key={a} className="auto-conn-action" data-action={a}>
            <h4 className="auto-conn-action-name">{columnWord(t, a)}</h4>
            {a !== "create" && (
              <div className="auto-conn-limit" data-limit="where">
                <span className="auto-param-name">{t("auto.conn.where")}</span>
                <div className="auto-conditions">
                  {filterEditor(fields, [...("where" in cell ? (cell.where ?? []) : [])], (next) =>
                    agent.setWriteLimits(key, a, { where: next }),
                  )}
                </div>
              </div>
            )}
            {a !== "remove" && "mode" in cell && (
              <fieldset className="auto-conn-limit auto-conn-write-fields" data-limit="fields">
                <legend className="auto-param-name">{t("auto.conn.write.fields")}</legend>
                {(() => {
                  const writeCell = connection[a] as Exclude<Connection["create"], false>;
                  const fills = fieldFills(writeCell, keys);
                  return fields.map((f) => (
                    <div key={f.key} className="auto-conn-write-field" data-field={f.key}>
                      <span className="auto-conn-write-field-name">{f.name}</span>
                      <select
                        aria-label={`${columnWord(t, a)} · ${f.name}`}
                        value={fills[f.key]}
                        data-boni-action="automations.edit"
                        onChange={(e) =>
                          agent.setWriteField(key, a, keys, f.key, e.target.value as FieldFill)
                        }
                      >
                        {FILLS.map((fill) => (
                          <option key={fill} value={fill}>
                            {t(`auto.conn.field.${fill}`)}
                          </option>
                        ))}
                      </select>
                      {fills[f.key] === "fixed" &&
                        agent.fixedValue(key, a, f, writeCell.fixed?.[f.key])}
                    </div>
                  ));
                })()}
              </fieldset>
            )}
            <RowsLimit
              t={t}
              name={t("auto.conn.most")}
              limit="most"
              max={ACTION_ROWS_MAX}
              value={cell.limit}
              set={(limit) => agent.setWriteLimits(key, a, { limit })}
            />
          </section>
        );
      })}
    </details>
  );
}
