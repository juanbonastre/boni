/**
 * The panels of «Leer correo»'s own steps (docs/automatizaciones.md §5.17, AU-249, AU-250, AU-253): the day's cap said
 * in «Llega un correo», the table of «Regla del remitente», «Indicaciones» and «Ejemplos» of the «Lectora», and the
 * «Crear» cell of each collection of «Crear en la elegida» with its count. Everything is painted as plain text: a
 * mail's words in «Ejemplos» keep their «de fuera» beside them. The data and the words come from automations/mail.ts;
 * nothing here sets a «Sí» but the select his hand changes.
 */
import { BONI_LIMITS, type ParamValue, RULE_DOES } from "@boni/automations";
import { memo, useCallback, useMemo, useRef } from "react";
import type { CellCount } from "../automations/client.ts";
import { learnedWords, type WriteCell } from "../automations/connections.ts";
import {
  type ChosenRow,
  capWords,
  newRule,
  type RuleRow,
  rulesOf,
  setRule,
} from "../automations/mail.ts";
import { DO, KEY } from "../automations/words.ts";
import type { T } from "../i18n.ts";
import { CELLS, cellValue, modeWord } from "./AutomationConnections.tsx";

/** Each time a field is entered: what tells two runs of typing in the same field apart (AU-68). */
let entered = 0;

/** What a panel of these reads, as the step's view gives every control. */
export interface MailControlProps {
  t: T;
  /** The step's type: whose words its parameters are said with. */
  type: string;
  value: ParamValue | undefined;
  /** `typing`: the run of typing it belongs to; a choice or a row added or erased is one change each. */
  set: (value: ParamValue, typing?: string) => void;
  path: string;
  label: string;
  marked: boolean;
  /** On the phone and a look (AU-74): read, never changed; nothing to add or erase. */
  readOnly: boolean;
  /** A run of typing in one field, entered once: one step of Deshacer (AU-68). */
  typing: (path: string, entered: number) => string;
}

/** «Tope» of «Llega un correo» (AU-253): said, never changed. */
export function MailCap({ t }: { t: T }) {
  const name = t("auto.boni.cap");
  return (
    <div className="auto-param" data-param="cap">
      <span className="auto-param-name">{name}</span>
      <div className="auto-param-control">
        <p className="auto-boni-said">{capWords(t)}</p>
      </div>
    </div>
  );
}

interface RuleWords {
  sender: string;
  do: string;
  collection: string;
  does: Readonly<Record<string, string>>;
  erase: string;
  row: (n: number) => string;
}

/**
 * One row of the table. Drawn again only when its row, its words or the collections change: typing in one sender of
 * five hundred repaints one row (A-15).
 */
const RuleLine = memo(function RuleLine({
  row,
  at,
  words,
  collections,
  readOnly,
  marked,
  change,
  erase,
  enter,
}: {
  row: RuleRow;
  at: number;
  words: RuleWords;
  collections: readonly { key: string; name: string }[];
  readOnly: boolean;
  marked: boolean;
  change: (
    at: number,
    c: { sender: string } | { do: "skip" | "collection" } | { collection: string },
  ) => void;
  erase: (at: number) => void;
  enter: () => void;
}) {
  const sender = typeof row.sender === "string" ? row.sender : "";
  const does = row.do === "collection" ? "collection" : "skip";
  const collection = typeof row.collection === "string" ? row.collection : "";
  const name = words.row(at + 1);
  const known = collection === "" || collections.some((c) => c.key === collection);
  return (
    <tr data-rule={at}>
      <td>
        <input
          className="input auto-input"
          aria-label={`${words.sender} · ${name}`}
          aria-invalid={(marked && sender.trim() === "") || undefined}
          maxLength={BONI_LIMITS.sender}
          spellCheck={false}
          value={sender}
          onFocus={enter}
          onChange={(e) => change(at, { sender: e.target.value })}
        />
      </td>
      <td>
        <select
          aria-label={`${words.do} · ${name}`}
          value={does}
          data-boni-action="automations.edit"
          onChange={(e) =>
            change(at, { do: e.target.value === "collection" ? "collection" : "skip" })
          }
        >
          {RULE_DOES.map((d) => (
            <option key={d} value={d}>
              {words.does[d]}
            </option>
          ))}
        </select>
      </td>
      <td>
        <select
          aria-label={`${words.collection} · ${name}`}
          aria-invalid={(marked && does === "collection" && collection === "") || undefined}
          value={does === "collection" ? collection : ""}
          disabled={does !== "collection"}
          data-boni-action="automations.edit"
          onChange={(e) => change(at, { collection: e.target.value })}
        >
          <option value="">—</option>
          {!known && <option value={collection}>{collection}</option>}
          {collections.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </select>
      </td>
      {!readOnly && (
        <td className="auto-rule-do">
          <button
            type="button"
            className="btn ghost small"
            data-boni-action="automations.edit"
            aria-label={`${words.erase}: ${name}`}
            onClick={() => erase(at)}
          >
            {words.erase}
          </button>
        </td>
      )}
    </tr>
  );
});

/**
 * «Reglas» of «Regla del remitente» (AU-249): a table, «Remitente», «Qué hacer» («No leer», «A una colección») and
 * «Colección», which only «A una colección» names. Each sender is a text of his, fixed in the step; up to 500 rows.
 */
export function SenderRules(
  p: MailControlProps & { collections: readonly { key: string; name: string }[] },
) {
  const { t, type, value, set, path, label, marked, readOnly, typing, collections } = p;
  const rows = rulesOf(value);
  const latest = useRef({ rows, set, typing, path });
  latest.current = { rows, set, typing, path };
  const run = useRef(0);
  const words = useMemo<RuleWords>(
    () => ({
      sender: t(KEY.param(type, "sender")),
      do: t(KEY.param(type, "do")),
      collection: t(KEY.param(type, "collection")),
      does: Object.fromEntries(RULE_DOES.map((d) => [d, t(KEY.choice(type, "do", d))])),
      erase: t(DO.eraseRow),
      row: (n) => t("auto.boni.rule", { n }),
    }),
    [t, type],
  );
  const change = useCallback(
    (
      at: number,
      c: { sender: string } | { do: "skip" | "collection" } | { collection: string },
    ) => {
      const l = latest.current;
      l.set(
        setRule(l.rows, at, c),
        "sender" in c ? l.typing(`${l.path}.${at}.sender`, run.current) : undefined,
      );
    },
    [],
  );
  const erase = useCallback((at: number) => {
    const l = latest.current;
    l.set(l.rows.filter((_, i) => i !== at));
  }, []);
  const enter = useCallback(() => {
    run.current = ++entered;
  }, []);
  return (
    <div className="auto-rules" role="group" aria-label={label}>
      {rows.length === 0 ? (
        <p className="muted small">{t("auto.boni.noRules")}</p>
      ) : (
        <div className="auto-table-wrap">
          <table className="auto-table auto-rules-table" aria-label={label}>
            <thead>
              <tr>
                <th>{words.sender}</th>
                <th>{words.do}</th>
                <th>{words.collection}</th>
                {!readOnly && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <RuleLine
                  // biome-ignore lint/suspicious/noArrayIndexKey: a rule is its place in the table.
                  key={i}
                  row={r}
                  at={i}
                  words={words}
                  collections={collections}
                  readOnly={readOnly}
                  marked={marked}
                  change={change}
                  erase={erase}
                  enter={enter}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!readOnly && rows.length < BONI_LIMITS.rules && (
        <button
          type="button"
          className="btn ghost small auto-rules-add"
          data-boni-action="automations.edit"
          onClick={() => set([...rows, newRule()])}
        >
          {t(DO.addRow)}
        </button>
      )}
    </div>
  );
}

/** «Indicaciones» of the «Lectora» (AU-249): his text for the reader, fixed in the step, as plain text. */
export function MailInstructions(p: MailControlProps) {
  const { value, set, path, label, typing } = p;
  const run = useRef(0);
  return (
    <textarea
      className="input auto-input auto-boni-text"
      aria-label={label}
      maxLength={BONI_LIMITS.instructions}
      value={typeof value === "string" ? value : ""}
      onFocus={() => {
        run.current = ++entered;
      }}
      onChange={(e) => set(e.target.value, typing(path, run.current))}
    />
  );
}

/**
 * «Ejemplos» of the «Lectora» (AU-249, AU-255): each a mail and what it should give. The mail is from outside: it is
 * painted as text with «de fuera» beside its name, and the reader gets it only between its markers. Up to 20.
 */
export function MailExamples(p: MailControlProps) {
  const { t, type, value, set, path, label, marked, readOnly, typing } = p;
  const rows = rulesOf(value);
  const run = useRef(0);
  const mail = t(KEY.param(type, "mail"));
  const want = t(KEY.param(type, "want"));
  const text = (row: RuleRow, key: string) =>
    typeof row[key] === "string" ? (row[key] as string) : "";
  const put = (at: number, key: "mail" | "want", v: string) =>
    set(
      rows.map((r, i) => (i === at ? { ...r, [key]: v } : r)),
      typing(`${path}.${at}.${key}`, run.current),
    );
  const enter = () => {
    run.current = ++entered;
  };
  return (
    <div className="auto-examples" role="group" aria-label={label}>
      {rows.map((r, i) => {
        const name = t("auto.boni.example", { n: i + 1 });
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: an example is its place in the list.
          <div key={i} className="auto-example" role="group" aria-label={name} data-example={i}>
            <label className="auto-example-field">
              <span className="auto-example-name">
                {mail} <span className="auto-outside">{t("auto.boni.outside")}</span>
              </span>
              <textarea
                className="input auto-input auto-boni-text"
                aria-label={`${mail} · ${name}`}
                aria-invalid={(marked && text(r, "mail").trim() === "") || undefined}
                maxLength={BONI_LIMITS.example}
                value={text(r, "mail")}
                onFocus={enter}
                onChange={(e) => put(i, "mail", e.target.value)}
              />
            </label>
            <label className="auto-example-field">
              <span className="auto-example-name">{want}</span>
              <textarea
                className="input auto-input auto-boni-text"
                aria-label={`${want} · ${name}`}
                aria-invalid={(marked && text(r, "want").trim() === "") || undefined}
                maxLength={BONI_LIMITS.example}
                value={text(r, "want")}
                onFocus={enter}
                onChange={(e) => put(i, "want", e.target.value)}
              />
            </label>
            {!readOnly && (
              <button
                type="button"
                className="btn ghost small auto-example-erase"
                data-boni-action="automations.edit"
                aria-label={`${t(DO.eraseRow)}: ${name}`}
                onClick={() => set(rows.filter((_, j) => j !== i))}
              >
                {t(DO.eraseRow)}
              </button>
            )}
          </div>
        );
      })}
      {!readOnly && rows.length < BONI_LIMITS.examples && (
        <button
          type="button"
          className="btn ghost small auto-examples-add"
          data-boni-action="automations.edit"
          onClick={() => set([...rows, { mail: "", want: "" }])}
        >
          {t(DO.addRow)}
        </button>
      )}
    </div>
  );
}

/**
 * The collections of «Crear en la elegida» (AU-250): one row per collection the «Decisora» chooses among, with its
 * «Crear» cell «No», «Preguntar» or «Sí» and, under it, the count of his answers (AU-208); «Solo conocidos» said under a
 * «Sí» it narrows. No «Leer» and no «Desconectar»: «No» is how a collection is taken out.
 */
export function ChosenCells({
  t,
  type,
  rows,
  nameOf,
  readOnly,
  onlyKnown,
  counts,
  set,
}: {
  t: T;
  type: string;
  rows: readonly ChosenRow[];
  nameOf: (collection: string) => string;
  readOnly: boolean;
  onlyKnown: boolean;
  counts: readonly CellCount[];
  set: (collection: string, cell: WriteCell) => void;
}) {
  const title = t(KEY.param(type, "collections"));
  const create = t("auto.conn.col.create");
  return (
    <div className="auto-param auto-param-connections" data-param="connections">
      <span className="auto-param-name">{title}</span>
      <div className="auto-param-control">
        {rows.length === 0 ? (
          <p className="muted small auto-conn-none">{t("auto.boni.noCollections")}</p>
        ) : (
          <div className="auto-table-wrap">
            <table className="auto-table auto-conn-table" aria-label={title}>
              <thead>
                <tr>
                  <th>{t("auto.conn.col.collection")}</th>
                  <th>{create}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const name = nameOf(r.collection);
                  const said = [
                    ...learnedWords(
                      t,
                      r.cell,
                      counts.find((x) => x.collection === r.collection && x.action === "create"),
                    ),
                    ...(r.cell === "yes" && onlyKnown ? [t(KEY.param(type, "onlyKnown"))] : []),
                  ];
                  return (
                    <tr key={r.collection} data-collection={r.collection}>
                      <th scope="row" className="auto-conn-name">
                        {name}
                      </th>
                      <td
                        className="auto-conn-cell"
                        data-action="create"
                        data-cell={cellValue(r.cell)}
                      >
                        <select
                          aria-label={`${create} · ${name}`}
                          value={cellValue(r.cell)}
                          disabled={readOnly}
                          data-boni-action="automations.edit"
                          onChange={(e) =>
                            set(
                              r.collection,
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
