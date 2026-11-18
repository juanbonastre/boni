/**
 * The step's view, D of F14b (docs/automatizaciones.md §5.7: AU-63, AU-70, AU-73, AU-74, AU-75 to AU-83): one step
 * over the dimmed canvas in three columns, ENTRADA · «Parámetros | Ajustes» · SALIDA, two under 1100 px. Every
 * parameter is painted by the component of its control (`PARAM_CONTROLS`, AU-80), never by anything of its step's
 * type; what the panel holds is `rowsOf` and its kin (automations/panel.ts), and every change is a pure function of
 * automations/edit.ts made into one change of automations/state.ts, as on the canvas. There is no «Guardar»: the
 * draft is saved as it changes. ENTRADA and SALIDA show the step's last test and «Probar paso» tests it (E,
 * AutomationTest.tsx).
 */
import {
  ACTION,
  AGENT_PARAMS,
  AGENT_TYPE,
  ASK_PARAMS,
  ASK_TYPE,
  type Automation,
  CODE_PARAMS,
  type Control,
  isExpr,
  isPeopleType,
  isTrigger,
  MAX_RETRIES,
  type ParamSpec,
  type ParamValue,
  paramsOf,
  type Step,
  type StepSettings,
} from "@boni/automations";
import type { FilterItem } from "@boni/views";
import { Trash2, X } from "lucide-react";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { citedName } from "../automations/cite.ts";
import { automationsClient, type CellCount, type Sample } from "../automations/client.ts";
import { codeBlocked, codeContextOf, isCode } from "../automations/code.ts";
import { agentConnectable, type AgentDid as Did, didLines } from "../automations/connections.ts";
import {
  allowAction,
  changeAction,
  connectCollection,
  disconnectCollection,
  removeOption,
  rename,
  setCell,
  setFixedValue,
  setParam,
  setRead,
  setReadLimits,
  setSetting,
  setWriteField,
  setWriteLimits,
} from "../automations/edit.ts";
import {
  type ConditionField,
  cannotTest,
  conditionFields,
  conditionFieldsOf,
  fieldsOut,
  knownFields,
  labelsOf,
  markedOf,
  optionsLeft,
  peopleAction,
  rowsOf,
  SETTINGS_ROWS,
  settingsChanged,
  stepsBefore,
  summaryOf,
} from "../automations/panel.ts";
import { change, type EditorState, undo } from "../automations/state.ts";
import { DO, entryWords, KEY, labelWord, type Namer, summaryWords } from "../automations/words.ts";
import type { DataType as AppType, DataField, Planner } from "../core/agent.ts";
import type { T } from "../i18n.ts";
import { agentApi, loadPlanners, useStore } from "../store.ts";
import { CodeConsole, CodeParams, CodeWould } from "./AutomationCode.tsx";
import { type AgentConnections, ConnectionsTable } from "./AutomationConnections.tsx";
import { CiteContext, type CiteView, citeNames, ValueBox } from "./AutomationExpr.tsx";
import { PeopleOut } from "./AutomationPeople.tsx";
import {
  KeptContext,
  StepInput,
  StepOutput,
  setTrial,
  TestStepButton,
  TrialFields,
  trialOf,
  usePhone,
  useStill,
  useTester,
} from "./AutomationTest.tsx";
import { iconOf } from "./automationIcons.ts";
import { FilterItemsEditor, type FilterValueSlot, RecordValue } from "./DatabaseBlock.tsx";
import { MenuRow, PopButton } from "./Popover.tsx";

type Apply = (f: (s: EditorState) => EditorState) => void;

/** What every control of the view reads: the step, the words, the fields it can name, how a typed run is named. */
interface View {
  t: T;
  step: Step;
  draft: Automation;
  collections: readonly AppType[];
  /** The fields a parameter can name: its collection's, or those of the rows that arrive (AU-81). */
  fieldsFor: (param: ParamSpec) => ConditionField[];
  /** A run of typing in one field, entered once: one step of Deshacer (AU-68). */
  typing: (path: string, entered: number) => string;
}
const ViewContext = createContext<View | null>(null);
const useView = () => useContext(ViewContext) as View;

/** Each time a field is entered: what tells two runs of typing in the same field apart (AU-68). */
let entered = 0;

interface ControlProps {
  param: ParamSpec;
  value: ParamValue | undefined;
  /** `typing`: the run of typing it belongs to; a choice, a toggle or a list's entry is one change each. */
  set: (value: ParamValue, typing?: string) => void;
  /** Where it is in the step (`limit`, `sort.0.field`): what names its runs of typing. */
  path: string;
  label: string;
  marked: boolean;
}

/** What paints one control. */
type Painter = (p: ControlProps) => ReactNode;

/** A value's input by what it holds: what the browser offers for it. */
const INPUT_OF: Readonly<Record<string, string>> = {
  text: "text",
  number: "number",
  date: "date",
  time: "time",
};
/** A field's value by the views' type of the field: a number, a box to tick, a date, an option, a row, or text. */
const NUMERIC = new Set(["number", "money", "duration"]);
const DATES = new Set(["date", "datetime"]);
const CHOICES = new Set(["select", "multiselect"]);

/** Intro in a one-line field ends it, as anywhere in the app. */
const enterEnds = (e: React.KeyboardEvent<HTMLElement>) => {
  if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) e.currentTarget.blur();
};

/** A value: text, a number or a date, or with «{ }» an expression (AU-20) that a field dropped on it cites (AU-21). */
function ValueControl(p: ControlProps) {
  const v = useView();
  const run = useRef(0);
  const { param, value, set, path, label, marked } = p;
  // A field named by its key, with no fields known (ChoiceControl), is not a value to cite into.
  if (param.control !== "value") return <FixedValue {...p} run={run} />;
  return (
    <ValueBox
      value={value}
      set={(x, typed) => set(x, typed ? v.typing(path, run.current) : undefined)}
      text={param.of === "text"}
      label={label}
      marked={marked}
      param={path}
      onFocus={() => {
        run.current = ++entered;
      }}
    >
      <FixedValue {...p} run={run} />
    </ValueBox>
  );
}

/**
 * «Opciones» of a «Preguntar» (AU-125): fixed, a list of texts, one input each with «Borrar» and «Añadir» under them;
 * with «{ }», an expression that gives the list (each row its own). Its texts are the step's own, painted as text.
 */
function AskOptionsControl(p: ControlProps) {
  const v = useView();
  const run = useRef(0);
  const { value, set, path, label, marked } = p;
  const list = Array.isArray(value) ? value.map((x) => (typeof x === "string" ? x : "")) : [];
  const optionName = (i: number) => v.t("auto.option.n", { n: i + 1 });
  return (
    <ValueBox
      value={value}
      set={(x, typed) => set(x, typed ? v.typing(path, run.current) : undefined)}
      text={false}
      label={label}
      marked={marked}
      param={path}
      onFocus={() => {
        run.current = ++entered;
      }}
    >
      <div className="auto-ask-options" role="group" aria-label={label}>
        {list.map((o, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: an option is its place in the list.
          <div key={i} className="auto-ask-option">
            <input
              className="input auto-input"
              aria-label={optionName(i)}
              aria-invalid={(marked && o.trim() === "") || undefined}
              value={o}
              onFocus={() => {
                run.current = ++entered;
              }}
              onChange={(e) =>
                set(
                  list.map((x, j) => (j === i ? e.target.value : x)),
                  v.typing(`${path}.${i}`, run.current),
                )
              }
              onKeyDown={enterEnds}
            />
            <button
              type="button"
              className="btn ghost small"
              data-boni-action="automations.edit"
              aria-label={`${v.t(DO.eraseRow)}: ${optionName(i)}`}
              onClick={() => set(list.filter((_, j) => j !== i))}
            >
              {v.t(DO.eraseRow)}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn ghost small auto-ask-option-add"
          data-boni-action="automations.edit"
          onClick={() => set([...list, ""])}
        >
          {v.t(DO.addRow)}
        </button>
      </div>
    </ValueBox>
  );
}

/** The fixed value's own input: text, a number, a date or an hour («Programada»), as the browser offers each. */
function FixedValue({
  param,
  value,
  set,
  path,
  label,
  marked,
  run,
}: ControlProps & { run: React.MutableRefObject<number> }) {
  const v = useView();
  const of = param.control === "value" ? param.of : "text";
  const expr = isExpr(value) ? value : null;
  const text = expr ? expr.expr : value === undefined || value === null ? "" : String(value);
  return (
    <input
      className={`input auto-input${expr ? " expr" : ""}`}
      aria-label={label}
      aria-invalid={marked || undefined}
      type={expr ? "text" : (INPUT_OF[of] ?? "text")}
      value={text}
      onFocus={() => {
        run.current = ++entered;
      }}
      onChange={(e) => {
        const raw = e.target.value;
        const next: ParamValue = expr
          ? { expr: raw }
          : of === "number" && raw.trim() !== ""
            ? Number(raw)
            : raw;
        set(next, v.typing(path, run.current));
      }}
      onKeyDown={enterEnds}
    />
  );
}

/** One of its options (the action too), or one field of those it can name; with none known, a field by its key. */
function ChoiceControl(p: ControlProps) {
  const v = useView();
  const { param, value, set, label, marked } = p;
  if (param.control !== "choice") return null;
  const current = value ?? param.default;
  const now = typeof current === "string" ? current : "";
  if (Array.isArray(param.options)) {
    // «Avisar» and «Preguntar» are said by the step's own word (AU-248); any other action by its phrase.
    const word = (o: string) =>
      v.t(
        param.key === ACTION
          ? peopleAction(v.step)
            ? KEY.step(o)
            : KEY.action(v.step.type, o)
          : KEY.choice(v.step.type, param.key, o),
      );
    if (param.many) return <ManyControl {...p} options={param.options} word={word} />;
    return (
      <select
        className="input"
        aria-label={label}
        aria-invalid={marked || undefined}
        value={now}
        onChange={(e) => set(e.target.value)}
      >
        {!now && <option value="">{v.t("auto.view.choose")}</option>}
        {param.options.map((o) => (
          <option key={o} value={o}>
            {word(o)}
          </option>
        ))}
      </select>
    );
  }
  const fields = v.fieldsFor(param);
  if (!fields.length) return <ValueControl {...p} />;
  return (
    <select
      className="input"
      aria-label={label}
      aria-invalid={marked || undefined}
      value={now}
      onChange={(e) => set(e.target.value)}
    >
      {!now && <option value="">{v.t("auto.view.choose")}</option>}
      {now && !fields.some((f) => f.key === now) && <option value={now}>{now}</option>}
      {fields.map((f) => (
        <option key={f.key} value={f.key}>
          {f.name}
        </option>
      ))}
    </select>
  );
}

/**
 * One or more of a closed list («Por dónde», AU-246): a box for each, in the list's order. The last one chosen
 * cannot be taken off, so the step always reaches him by one at least.
 */
function ManyControl({
  value,
  param,
  set,
  label,
  options,
  word,
}: ControlProps & { options: readonly string[]; word: (o: string) => string }) {
  const current = value ?? param.default;
  const chosen = Array.isArray(current) ? current.filter((x) => typeof x === "string") : [];
  return (
    <fieldset className="auto-many" aria-label={label}>
      {options.map((o) => {
        const on = chosen.includes(o);
        return (
          <label key={o} className="auto-many-item">
            <input
              type="checkbox"
              checked={on}
              disabled={on && chosen.length === 1}
              onChange={(e) =>
                set(options.filter((x) => (x === o ? e.target.checked : chosen.includes(x))))
              }
            />
            <span>{word(o)}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** Yes or no. */
function ToggleControl({ param, value, set, label }: ControlProps) {
  return (
    <input
      type="checkbox"
      className="auto-toggle"
      aria-label={label}
      checked={(value ?? param.default) === true}
      onChange={(e) => set(e.target.checked)}
    />
  );
}

/** The rows of a list's value, the ones that are objects. */
const entriesOf = (v: ParamValue | undefined): Record<string, ParamValue>[] =>
  Array.isArray(v)
    ? v.filter(
        (x): x is Record<string, ParamValue> =>
          typeof x === "object" && x !== null && !Array.isArray(x) && !isExpr(x),
      )
    : [];

/** A new entry of a list: its hidden columns are its id (a rule's output, a field's key), the rest their default. */
function newEntry(columns: readonly ParamSpec[]): Record<string, ParamValue> {
  const entry: Record<string, ParamValue> = {};
  for (const c of columns) {
    if (c.place === "hidden") entry[c.key] = `${c.key}_${Math.random().toString(36).slice(2, 8)}`;
    else if (c.default !== undefined) entry[c.key] = c.default;
  }
  return entry;
}

/**
 * Rows that Juan adds, each folded into one line of what it holds: what is inside an entry is seen once it is
 * opened (AU-75), each column with the control of its own.
 */
function ListControl({ param, value, set, path, label }: ControlProps) {
  const v = useView();
  const [open, setOpen] = useState<number | null>(null);
  if (param.control !== "list") return null;
  const rows = entriesOf(value);
  const columns = param.columns.filter((c) => c.place !== "hidden");
  // A column with `when` is asked only while its row holds one of those values (a «Programada»'s day, AU-114).
  const shown = (r: Record<string, ParamValue>) =>
    columns.filter((c) => !c.when || c.when.in.includes(String(r[c.when.param])));
  const line = (r: Record<string, ParamValue>) => entryWords(v.t, v.step, shown(r), r);
  const put = (i: number, key: string, x: ParamValue, typing?: string) =>
    set(
      rows.map((r, j) => (j === i ? { ...r, [key]: x } : r)),
      typing,
    );
  return (
    <div className="auto-list" role="group" aria-label={label}>
      {rows.map((r, i) => (
        <div key={i} className={`auto-entry${open === i ? " open" : ""}`}>
          <div className="auto-entry-head">
            <button
              type="button"
              className="auto-entry-line"
              aria-expanded={open === i}
              onClick={() => setOpen(open === i ? null : i)}
            >
              {line(r) || v.t("auto.view.entry", { n: i + 1 })}
            </button>
            <button
              type="button"
              className="btn ghost small"
              data-boni-action="automations.edit"
              disabled={rows.length <= (param.min ?? 0)}
              onClick={() => {
                setOpen(null);
                set(rows.filter((_, j) => j !== i));
              }}
            >
              {v.t(DO.eraseRow)}
            </button>
          </div>
          {open === i && (
            <div className="auto-entry-body">
              {shown(r).map((c) => {
                const Painted = PARAM_CONTROLS[c.control];
                const name = v.t(KEY.param(v.step.type, c.key));
                return (
                  <div key={c.key} className="auto-entry-field">
                    <span className="auto-param-name">{name}</span>
                    <Painted
                      param={c}
                      value={r[c.key]}
                      set={(x, typing) => put(i, c.key, x, typing)}
                      path={`${path}.${i}.${c.key}`}
                      label={name}
                      marked={false}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        className="btn ghost small"
        data-boni-action="automations.edit"
        onClick={() => {
          set([...rows, newEntry(param.columns)]);
          setOpen(rows.length);
        }}
      >
        {v.t(DO.addRow)}
      </button>
    </div>
  );
}

/** The fields a condition can name, as the views' editor reads a collection: by their keys. */
function asType(fields: readonly ConditionField[]): AppType {
  const list: DataField[] = fields.map((f) => ({
    id: f.key,
    key: f.key,
    name: f.name,
    type: f.type,
    ...(f.options ? { options: f.options } : {}),
    ...(f.relation ? { relation: f.relation } : {}),
  }));
  return {
    id: "",
    name: "",
    icon: "",
    titleField: list[0]?.id ?? "",
    fields: list,
    count: 0,
    level: "visible",
  } as AppType;
}

/**
 * A condition's value, fixed as the views edit it or with «{ }» an expression with its chips (AU-20, AU-81): a run
 * of typing in it is the conditions' own (ConditionsControl).
 */
const exprValue =
  (path: string): FilterValueSlot =>
  (field, value, onChange, fallback, place) => (
    <ValueBox
      value={value as unknown as ParamValue}
      set={(x) => onChange(x as unknown as string)}
      text={!NUMERIC.has(field.type) && !DATES.has(field.type) && !CHOICES.has(field.type)}
      label={field.name}
      param={`${path}.${place}.value`}
    >
      {fallback}
    </ValueBox>
  );

/** The views' filter (AU-81): «todas» by default, groups «y» or «o» of one level, operators by the field's type. */
function ConditionsControl({ param, value, set, path, label, marked }: ControlProps) {
  const v = useView();
  const run = useRef(0);
  const fields = v.fieldsFor(param);
  const items = (Array.isArray(value) ? value : []) as unknown as FilterItem[];
  return (
    <div
      className={`auto-conditions${marked ? " marked" : ""}`}
      role="group"
      aria-label={label}
      aria-invalid={marked || undefined}
      // Each control of the editor focused starts a run: the keys typed in one value are one step of Deshacer.
      onFocus={() => {
        run.current = ++entered;
      }}
    >
      <FilterItemsEditor
        type={asType(fields)}
        items={items}
        valueSlot={exprValue(path)}
        onChange={(next) => set(next as unknown as ParamValue, v.typing(path, run.current))}
      />
    </div>
  );
}

/** A field's value by the field's type, as the views edit it. */
function FieldValue({
  field,
  value,
  set,
  label,
  typing,
  param,
}: {
  field: ConditionField | undefined;
  value: ParamValue | undefined;
  set: (x: ParamValue, typing?: string) => void;
  label: string;
  typing: (entered: number) => string;
  /** Where the value is in the step (`Problem.param`): what its line is asked for (AU-23). */
  param: string;
}) {
  const run = useRef(0);
  const kind = field?.type ?? "text";
  return (
    <ValueBox
      value={value}
      set={(x, typed) => set(x, typed ? typing(run.current) : undefined)}
      text={
        !field ||
        (!NUMERIC.has(kind) &&
          !DATES.has(kind) &&
          !CHOICES.has(kind) &&
          !field.relation &&
          kind !== "checkbox")
      }
      label={label}
      param={param}
      onFocus={() => {
        run.current = ++entered;
      }}
    >
      <FixedFieldValue
        field={field}
        value={value}
        set={set}
        label={label}
        typing={typing}
        run={run}
      />
    </ValueBox>
  );
}

/** A fixed value under an «Agente»'s «Crear» or «Modificar» (AU-52): the field's own control, a plain value in P1. */
function ConnFixedValue({
  field,
  value,
  label,
  set,
  typing,
}: {
  field: ConditionField;
  value: ParamValue | undefined;
  label: string;
  set: (x: ParamValue, typing?: string) => void;
  typing: (entered: number) => string;
}) {
  const run = useRef(0);
  return (
    <FixedFieldValue
      field={field}
      value={value}
      set={set}
      label={label}
      typing={typing}
      run={run}
    />
  );
}

/** A model's name as «Modelos» shows it, without its provider: the server's text, painted as plain text. */
const modelName = (model: string) => model.replace(/^[a-z0-9-]+\//i, "");

/**
 * «Modelo» of an «Agente» (AU-199): «El de la cuenta» or one of the account's choices for its use; the step keeps the
 * choice's id, never a key or a setting. «El de la cuenta» names the account's (`current`), which follows the account
 * when it changes; the others are the models evaluated for it. A stored id no longer offered says so, and publishing
 * stops on it.
 */
function ModelChoice({
  t,
  value,
  label,
  planners,
  set,
}: {
  t: T;
  value: ParamValue | undefined;
  label: string;
  planners: readonly Planner[];
  set: (id: string) => void;
}) {
  const id = typeof value === "string" ? value : "";
  const gone = id !== "" && !planners.some((p) => p.id === id);
  const own = planners.find((p) => p.current);
  return (
    <select
      className="input auto-agent-model"
      aria-label={label}
      value={id}
      data-boni-action="automations.edit"
      onChange={(e) => set(e.target.value)}
    >
      <option value="">
        {own
          ? t("auto.agent.model.accountIs", { model: modelName(own.model) })
          : t("auto.agent.model.account")}
      </option>
      {planners
        .filter((p) => !p.current || p.id === id)
        .map((p) => (
          <option key={p.id} value={p.id}>
            {modelName(p.model)}
          </option>
        ))}
      {gone && <option value={id}>{t("auto.agent.model.gone", { model: id })}</option>}
    </select>
  );
}

/**
 * «Lo que hizo» of an «Agente» (AU-54), above its answer: its cost, then each unit's lines. Every line is the code's,
 * from what the engine ran, painted as plain text (A-01).
 */
function AgentDidBox({ t, did, locale }: { t: T; did: Did; locale: string }) {
  return (
    <section className="auto-did" aria-label={t("auto.did.title")}>
      <h4 className="auto-did-title">{t("auto.did.title")}</h4>
      <p className="auto-did-head">{did.head}</p>
      {did.units.map((u, i) => (
        <div key={i} className="auto-did-unit">
          {u.title && <h5 className="auto-did-unit-title">{u.title}</h5>}
          <ul className="auto-did-lines">
            {u.lines.map((l, k) => (
              <li key={k}>{l}</li>
            ))}
          </ul>
        </div>
      ))}
      {did.more > 0 && (
        <p className="auto-did-more">
          {t("auto.would.code.more", { n: did.more.toLocaleString(locale) })}
        </p>
      )}
    </section>
  );
}

/** The fixed value of a field by its type: a box to tick, an option, a row, a number, a date or text. */
function FixedFieldValue({
  field,
  value,
  set,
  label,
  typing,
  run,
}: {
  field: ConditionField | undefined;
  value: ParamValue | undefined;
  set: (x: ParamValue, typing?: string) => void;
  label: string;
  typing: (entered: number) => string;
  run: React.MutableRefObject<number>;
}) {
  const v = useView();
  const kind = field?.type ?? "text";
  if (isExpr(value) || !field)
    return (
      <input
        className={`input auto-input${isExpr(value) ? " expr" : ""}`}
        aria-label={label}
        value={
          isExpr(value) ? value.expr : value === undefined || value === null ? "" : String(value)
        }
        onFocus={() => {
          run.current = ++entered;
        }}
        onChange={(e) =>
          set(isExpr(value) ? { expr: e.target.value } : e.target.value, typing(run.current))
        }
        onKeyDown={enterEnds}
      />
    );
  if (kind === "checkbox")
    return (
      <input
        type="checkbox"
        className="auto-toggle"
        aria-label={label}
        checked={value === true}
        onChange={(e) => set(e.target.checked)}
      />
    );
  if (CHOICES.has(kind))
    return (
      <select
        className="input"
        aria-label={label}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => set(e.target.value)}
      >
        <option value="">{v.t("auto.view.choose")}</option>
        {(field.options ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    );
  if (field.relation)
    return (
      <RecordValue
        target={field.relation.target}
        value={typeof value === "string" ? value : undefined}
        onChange={(x) => set(x ?? "")}
      />
    );
  const numeric = NUMERIC.has(kind);
  return (
    <input
      className="input auto-input"
      aria-label={label}
      type={numeric ? "number" : DATES.has(kind) ? "date" : "text"}
      value={value === undefined || value === null ? "" : String(value)}
      onFocus={() => {
        run.current = ++entered;
      }}
      onChange={(e) => {
        const raw = e.target.value;
        set(numeric && raw.trim() !== "" ? Number(raw) : raw, typing(run.current));
      }}
      onKeyDown={enterEnds}
    />
  );
}

/** The fields of a row: only the ones Juan adds, each with its value by the field's type. */
function FieldsControl({ param, value, set, path, label, marked }: ControlProps) {
  const v = useView();
  const run = useRef(0);
  const rows = entriesOf(value);
  const fields = v.fieldsFor(param);
  const put = (i: number, patch: Record<string, ParamValue>, typing?: string) =>
    set(
      rows.map((r, j) => (j === i ? { ...r, ...patch } : r)),
      typing,
    );
  const fieldName = v.t("auto.view.field");
  return (
    <div
      className={`auto-list${marked ? " marked" : ""}`}
      role="group"
      aria-label={label}
      aria-invalid={marked || undefined}
    >
      {rows.map((r, i) => {
        const key = typeof r.field === "string" ? r.field : "";
        const field = fields.find((f) => f.key === key);
        return (
          <div key={i} className="auto-field-row">
            {fields.length ? (
              <select
                className="input"
                aria-label={fieldName}
                value={key}
                onChange={(e) => put(i, { field: e.target.value, value: "" })}
              >
                {!key && <option value="">{v.t("auto.view.choose")}</option>}
                {key && !field && <option value={key}>{key}</option>}
                {fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="input auto-input"
                aria-label={fieldName}
                value={key}
                onFocus={() => {
                  run.current = ++entered;
                }}
                onChange={(e) =>
                  put(i, { field: e.target.value }, v.typing(`${path}.${i}.field`, run.current))
                }
                onKeyDown={enterEnds}
              />
            )}
            <FieldValue
              field={field}
              value={r.value}
              label={field?.name ?? v.t("auto.view.value")}
              set={(x, typing) => put(i, { value: x }, typing)}
              typing={(n) => v.typing(`${path}.${i}.value`, n)}
              param={`${path}.${i}.value`}
            />
            {/* The same trash as a condition's, so «{ }» closes every value's row in one column (AU-20). */}
            <button
              type="button"
              className="icon-btn tiny"
              aria-label={v.t(DO.eraseRow)}
              title={v.t(DO.eraseRow)}
              data-boni-action="automations.edit"
              onClick={() => set(rows.filter((_, j) => j !== i))}
            >
              <Trash2 size={13} strokeWidth={1.8} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="btn ghost small"
        data-boni-action="automations.edit"
        onClick={() => {
          const free = fields.find((f) => !rows.some((r) => r.field === f.key));
          set([...rows, { field: free?.key ?? "", value: "" }]);
        }}
      >
        {v.t(DO.addRow)}
      </button>
    </div>
  );
}

/** The step's collection, by the key its picker holds: what a row picker chooses from. */
function collectionOf(v: View): AppType | undefined {
  const picker = paramsOf(v.step).find((p) => p.control === "picker" && p.of === "collection");
  const key = picker ? v.step.params[picker.key] : undefined;
  return typeof key === "string" ? v.collections.find((d) => d.key === key) : undefined;
}

/** A selector: a collection (by its key), one of its rows, or another step of the automation. */
function PickerControl({ param, value, set, label, marked }: ControlProps) {
  const v = useView();
  if (param.control !== "picker") return null;
  const now = typeof value === "string" ? value : "";
  if (param.of === "row") {
    const of = collectionOf(v);
    return (
      <RecordValue target={of?.id ?? ""} value={now || undefined} onChange={(x) => set(x ?? "")} />
    );
  }
  const choices =
    param.of === "collection"
      ? v.collections.flatMap((d) => (d.key ? [{ id: d.key, name: d.name }] : []))
      : v.draft.steps.filter((s) => s.id !== v.step.id).map((s) => ({ id: s.id, name: s.name }));
  return (
    <select
      className="input"
      aria-label={label}
      aria-invalid={marked || undefined}
      value={now}
      onChange={(e) => set(e.target.value)}
    >
      {!now && <option value="">{v.t("auto.view.choose")}</option>}
      {now && !choices.some((c) => c.id === now) && <option value={now}>{now}</option>}
      {choices.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

/**
 * The same seven controls for every step (AU-80; code and the table of connections come with F14c): a parameter is
 * painted by the one of its control, and by nothing of its step's type.
 */
const PARAM_CONTROLS: Readonly<Record<Control, Painter>> = {
  value: ValueControl,
  choice: ChoiceControl,
  toggle: ToggleControl,
  list: ListControl,
  conditions: ConditionsControl,
  fields: FieldsControl,
  picker: PickerControl,
};

/** The view's own width: three columns from 1100 px, two below (AU-74). */
function useWide(): boolean {
  const query = "(min-width: 1100px)";
  const [wide, setWide] = useState(() => window.matchMedia?.(query).matches ?? true);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const update = () => setWide(m.matches);
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, []);
  return wide;
}

const learning = automationsClient(agentApi);

/**
 * The published cells' counts of one automation (AU-208), read when a step that writes opens: the server's, from
 * his answers. Nothing on an automation never published, or when the read fails.
 */
function useCellCounts(id: string | null, step: string | undefined): readonly CellCount[] {
  const [counts, setCounts] = useState<readonly CellCount[]>([]);
  useEffect(() => {
    if (!id || !step) return;
    let live = true;
    learning
      .learning(id)
      .then((c) => {
        if (live) setCounts(c.filter((x) => x.step === step));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id, step]);
  return counts;
}

export function AutomationStepView({
  state,
  apply,
  names,
  collectionNames,
}: {
  state: EditorState;
  apply: Apply;
  names: Namer;
  collectionNames: Readonly<Record<string, string>>;
}) {
  const t = useStore((s) => s.t);
  const types = useStore((s) => s.dataTypes);
  const lang = useStore((s) => s.settings.language);
  const wide = useWide();
  const phone = usePhone();
  const still = useStill();
  const [tab, setTab] = useState<"params" | "settings">("params");
  /** The phone's one column (AU-74): «Entrada | Parámetros | Salida». */
  const [pane, setPane] = useState<"input" | "params" | "output">("params");
  const [side, setSide] = useState<"input" | "output">("input");
  const box = useRef<HTMLDivElement>(null);
  const step = state.draft.steps.find((s) => s.id === state.open);
  const stepId = step?.id;
  const counts = useCellCounts(state.id, step?.connections?.length ? stepId : undefined);
  // Opened, the view takes the keys: Esc closes it and nothing typed reaches the canvas behind.
  useEffect(() => {
    box.current?.focus();
    setTab("params");
    setSide("input");
    setPane("params");
  }, [stepId]);
  // The last test's first rows as this step sees them, asked once when it opens and again after a test of it or of a
  // step before it, never on a key (AU-20, A-15): what the preview of an expression reads.
  const tester = useTester();
  const [sample, setSample] = useState<{ step: string; sample: Sample | null } | null>(null);
  const tested = stepId
    ? [stepId, ...stepsBefore(state.draft, stepId)].map((id) => state.tests[id]?.at ?? "").join(",")
    : "";
  useEffect(() => {
    if (!stepId || !tester || !/[^,]/.test(tested)) {
      setSample(null);
      return;
    }
    let gone = false;
    tester.sample(stepId).then((x) => {
      if (!gone) setSample({ step: stepId, sample: x });
    });
    return () => {
      gone = true;
    };
  }, [stepId, tested]);
  // The required rows being watched for the focus to leave them (AU-83), each with how to stop watching.
  const watching = useRef(new Map<string, () => void>());
  useEffect(
    () => () => {
      for (const stop of watching.current.values()) stop();
      watching.current.clear();
    },
    [],
  );
  /** The names the version that runs kept (AU-192), for a «Código»'s context. */
  const kept = useContext(KeptContext);
  // «Modelo» of an «Agente» (AU-199): the account's choices for its use, asked when one opens, never on a key.
  const planners = useStore((s) => s.planners);
  const agentOpen = step?.type === AGENT_TYPE;
  useEffect(() => {
    if (agentOpen) loadPlanners();
  }, [agentOpen, stepId]);
  if (!step) return null;

  const collections = types ?? [];
  const fieldsOf = (key: string): ConditionField[] | undefined => {
    const d = collections.find((c) => c.key === key);
    return d ? conditionFieldsOf(d) : undefined;
  };
  const picker = paramsOf(step).find((p) => p.control === "picker" && p.of === "collection");
  const own = picker ? step.params[picker.key] : undefined;
  const view: View = {
    t,
    step,
    draft: state.draft,
    collections,
    fieldsFor: (param) =>
      conditionFields(param, {
        collection: typeof own === "string" ? (fieldsOf(own) ?? []) : [],
        input: new Proxy({} as Record<string, readonly ConditionField[]>, {
          get: (_, input) =>
            typeof input === "string"
              ? knownFields(state.draft, step.id, input, fieldsOf)
              : undefined,
        }),
      }),
    typing: (path, n) => `${step.id}.${path}#${n}`,
  };
  const seen = sample?.step === step.id ? sample.sample : null;
  const cite: CiteView = {
    t,
    draft: state.draft,
    into: step.id,
    ...citeNames(t, state.draft, step.id, fieldsOf, seen),
    sample: seen,
    locale: lang === "en" ? "en-GB" : "es-ES",
    ask: tester
      ? (param, row, expr) => tester.preview({ step: step.id, param, row, expr })
      : undefined,
    said: { collection: (key) => collections.find((c) => c.key === key)?.name },
  };

  const edit = (f: (d: Automation) => Automation, typing?: string) =>
    apply((s) => change(s, { draft: f(s.draft) }, typing ?? null));
  const setAction = (action: string) =>
    apply((s) => {
      const { draft, dropped } = changeAction(s.draft, step.id, action, names);
      const next = change(s, { draft });
      return next !== s && dropped.length
        ? { ...next, dropped: { step: step.id, params: dropped } }
        : next;
    });
  /** Left a required parameter (AU-83): from now on it is marked while it is empty. */
  const leave = (key: string) =>
    apply((s) => {
      const at = `${step.id}.${key}`;
      return s.left.includes(at) ? s : { ...s, left: [...s.left, at] };
    });
  const set = <K extends keyof StepSettings>(key: K, value: StepSettings[K], typing?: string) =>
    edit((d) => setSetting(d, step.id, key, value), typing);

  const left = state.left
    .filter((x) => x.startsWith(`${step.id}.`))
    .map((x) => x.slice(step.id.length + 1));
  const marked = new Set(markedOf(step, left, state.asked).map((p) => p.key));
  const paramName = (key: string) => t(KEY.param(step.type, key));
  const why = cannotTest(step, state.testing !== null);
  const summary = summaryOf(
    step,
    summaryWords(t, collectionNames, step, citedName(state.draft, step.id, cite.names)),
  ).join(" · ");
  const Icon = iconOf(step.type);
  const trigger = isTrigger(step);
  const dropped = state.dropped?.step === step.id ? state.dropped.params : null;
  const changed = settingsChanged(step);
  const rowsSaid = labelsOf(step).filter((l) => l.changesRows);
  const options = optionsLeft(step);
  const close = () => apply((s) => ({ ...s, open: null }));
  /**
   * A required parameter is left once the focus lands somewhere outside it (AU-83). A box it opened (the conditions'
   * editor, a picker's list) is drawn apart from the row, so going into it is not leaving. Watched from the moment the
   * focus enters the row, not from its blur: a control that held the focus and is taken out («Quitar filtro») blurs
   * nothing, and the row is left only when the focus next lands outside it.
   */
  const inRow = (row: HTMLElement, el: EventTarget | null) =>
    el instanceof Node &&
    (row.contains(el) || !!(el as Element).closest?.(".pop-box, [role='menu'], [role='listbox']"));
  const watch = (row: HTMLElement, key: string) => {
    const at = `${step.id}.${key}`;
    if (watching.current.has(at) || state.left.includes(at)) return;
    const on = (e: FocusEvent) => {
      if (inRow(row, e.target)) return;
      stop();
      leave(key);
    };
    const stop = () => {
      document.removeEventListener("focusin", on);
      watching.current.delete(at);
    };
    watching.current.set(at, stop);
    document.addEventListener("focusin", on);
  };
  /** The focus went nowhere (out of the window, a click on nothing): the row is left now. */
  const blurred = (row: HTMLElement, to: EventTarget | null, key: string) => {
    if (to !== null) return;
    if (document.activeElement && inRow(row, document.activeElement)) return;
    watching.current.get(`${step.id}.${key}`)?.();
    leave(key);
  };
  /** «Ir al parámetro» (AU-84): the parameter at fault, in «Parámetros», with the focus in it. */
  const goToParam = (key: string) => {
    setTab("params");
    requestAnimationFrame(() => {
      const row = box.current?.querySelector<HTMLElement>(
        `.auto-param[data-param="${CSS.escape(key)}"]`,
      );
      row?.scrollIntoView({ block: "nearest" });
      row
        ?.querySelector<HTMLElement>("input, select, textarea, [contenteditable='true'], button")
        ?.focus();
    });
  };
  // A «Código» reads its source with the server's own context (AU-36): what it marks is what validation says, with
  // the names the version that runs kept (AU-192).
  const codeContext = isCode(step)
    ? codeContextOf(
        collections,
        state.draft,
        state.tests,
        (id) => fieldsOut(state.draft, id, fieldsOf),
        kept,
      )
    : null;
  const blocked = codeContext ? codeBlocked(step, state.draft, codeContext) : null;
  // An «Agente»'s connections read collections by the same context (AU-41); it cites none by name in a source.
  const isAgent = step.type === AGENT_TYPE;
  const isAsk = step.type === ASK_TYPE;
  const agentContext = isAgent
    ? codeContextOf(
        collections,
        state.draft,
        state.tests,
        (id) => fieldsOut(state.draft, id, fieldsOf),
        kept,
      )
    : null;
  const tableContext = codeContext ?? agentContext;
  const connected = new Set((step.connections ?? []).map((c) => c.collection));
  const agent: AgentConnections | undefined = isAgent
    ? {
        connectable: agentConnectable(collections, connected),
        connect: (key) => edit((d) => connectCollection(d, step.id, key)),
        setRead: (key, on) => edit((d) => setRead(d, step.id, key, on)),
        setWriteLimits: (key, action, limits) =>
          edit((d) => setWriteLimits(d, step.id, key, action, limits)),
        setWriteField: (key, action, keys, field, fill) =>
          edit((d) => setWriteField(d, step.id, key, action, keys, field, fill)),
        fixedValue: (key, action, field, value) => (
          <ConnFixedValue
            field={field}
            value={value}
            label={field.name}
            typing={(n) => view.typing(`connections.${key}.${action}.${field.key}`, n)}
            set={(x, typing) =>
              edit((d) => setFixedValue(d, step.id, key, action, field.key, x), typing)
            }
          />
        ),
      }
    : undefined;
  const agentTest = state.tests[step.id];
  const did =
    isAgent && agentTest
      ? didLines(
          t,
          agentTest,
          step,
          cite.locale,
          (key) => agentContext?.collectionName?.(key) ?? key,
        )
      : null;
  const lastTest = state.tests[step.id];
  const codeFailure =
    lastTest?.state === "failed" && !lastTest.stale ? lastTest.error?.why : undefined;
  const outputWord = (id: string) => {
    if (Array.isArray(step.params.rules))
      for (const r of step.params.rules as { id?: unknown; name?: unknown }[])
        if (r?.id === id && typeof r.name === "string" && r.name) return r.name;
    return t(KEY.output(id));
  };

  const input = (
    <section className="auto-view-col" aria-label={t("auto.view.input")}>
      {wide && <h3 className="auto-view-col-head">{t("auto.view.input")}</h3>}
      {trigger ? (
        <div className="auto-test-data">
          <h4>{t("auto.view.testData")}</h4>
          <TrialFields
            t={t}
            fields={fieldsOut(state.draft, step.id, fieldsOf)}
            values={trialOf(state, step.id)}
            set={(key, value) => apply(setTrial(step.id, key, value))}
          />
        </div>
      ) : (
        <StepInput
          key={step.id}
          state={state}
          step={step}
          inputName={(id) => t(KEY.input(id))}
          withKeys={isCode(step)}
          fieldsOf={(at) =>
            at.input !== undefined
              ? knownFields(state.draft, at.step, at.input, fieldsOf)
              : fieldsOut(state.draft, at.step, fieldsOf)
          }
        />
      )}
    </section>
  );
  const output = (
    <section className="auto-view-col" aria-label={t("auto.view.output")}>
      {wide && <h3 className="auto-view-col-head">{t("auto.view.output")}</h3>}
      {rowsSaid.length > 0 && (
        <ul className="auto-labels auto-view-labels">
          {rowsSaid.map((l) => (
            <li key={l.kind} className="auto-label">
              {labelWord(t, step, l)}
            </li>
          ))}
        </ul>
      )}
      {did && <AgentDidBox t={t} did={did} locale={cite.locale} />}
      {isPeopleType(step.type) && (
        <PeopleOut
          t={t}
          lang={lang === "en" ? "en" : "es"}
          step={step}
          test={state.tests[step.id]}
          reply={state.last?.reply}
          locale={cite.locale}
        />
      )}
      <StepOutput
        key={step.id}
        state={state}
        step={step}
        outputName={(id) => outputWord(id)}
        fields={fieldsOut(state.draft, step.id, fieldsOf)}
        goToParam={goToParam}
      />
      {codeContext && (
        <CodeWould
          t={t}
          test={state.tests[step.id]}
          locale={cite.locale}
          nameOf={(key) => codeContext.collectionName?.(key) ?? key}
          fieldNames={(key) =>
            Object.fromEntries((fieldsOf(key) ?? []).map((f) => [f.key, f.name]))
          }
        />
      )}
      {codeContext && <CodeConsole t={t} test={state.tests[step.id]} locale={cite.locale} />}
    </section>
  );

  const table = tableContext && (
    <ConnectionsTable
      key="connections"
      t={t}
      step={step}
      context={tableContext}
      locale={cite.locale}
      readOnly={still}
      fieldsOf={fieldsOf}
      filterEditor={(fields, items, set) => (
        <FilterItemsEditor type={asType(fields)} items={items} onChange={(next) => set(next)} />
      )}
      setCell={(key, action, cell) => edit((d) => setCell(d, step.id, key, action, cell))}
      allow={(key, action) => edit((d) => allowAction(d, step.id, key, action))}
      disconnect={(key) => edit((d) => disconnectCollection(d, step.id, key))}
      setLimits={(key, limits) => edit((d) => setReadLimits(d, step.id, key, limits))}
      counts={counts}
      {...(agent ? { agent } : {})}
    />
  );

  const params = (
    <div className="auto-view-rows" role="tabpanel" aria-label={t("auto.view.params")}>
      {/* On the phone the parameters are read, never changed (AU-74): every control inside is disabled. */}
      <fieldset className="auto-view-look" disabled={still}>
        {dropped && (
          <div className="auto-view-notice" role="status">
            <span>{t("auto.view.dropped", { names: dropped.map(paramName).join(", ") })}</span>
            <button type="button" className="btn ghost small" onClick={() => apply(undo)}>
              {t(DO.undo)}
            </button>
          </div>
        )}
        {rowsOf(step).flatMap((row) => {
          const { param } = row;
          // «Agente» (AU-50, AU-51): its code is read only with «Las hace este código», and kept when it is not.
          if (
            isAgent &&
            param.key === AGENT_PARAMS.code &&
            step.params[AGENT_PARAMS.reads] !== "code"
          )
            return [];
          const Painted: Painter =
            isAgent && param.key === AGENT_PARAMS.model
              ? (p) => (
                  <ModelChoice
                    t={t}
                    value={p.value}
                    label={p.label}
                    planners={planners}
                    set={(id) =>
                      edit((d) =>
                        id === ""
                          ? removeOption(d, step.id, param.key)
                          : setParam(d, step.id, param.key, id, names),
                      )
                    }
                  />
                )
              : isAgent && param.key === AGENT_PARAMS.code
                ? (p) => (
                    <textarea
                      className="input auto-input auto-agent-code"
                      aria-label={p.label}
                      spellCheck={false}
                      value={typeof p.value === "string" ? p.value : ""}
                      onChange={(e) => p.set(e.target.value, `${step.id}.${param.key}`)}
                    />
                  )
                : isAsk && param.key === ASK_PARAMS.options
                  ? AskOptionsControl
                  : PARAM_CONTROLS[row.param.control];
          const name = paramName(param.key);
          const isMarked = marked.has(param.key);
          const shown = (
            <div
              key={param.key}
              className={`auto-param${isMarked ? " marked" : ""}`}
              data-param={param.key}
              onFocus={(e) => {
                if (param.required) watch(e.currentTarget, param.key);
              }}
              onBlur={(e) => {
                if (param.required) blurred(e.currentTarget, e.relatedTarget, param.key);
              }}
            >
              <span className="auto-param-name">{name}</span>
              <div className="auto-param-control">
                <Painted
                  param={param}
                  value={row.value}
                  path={param.key}
                  label={name}
                  marked={isMarked}
                  set={(value, typing) =>
                    param.key === ACTION && typeof value === "string"
                      ? setAction(value)
                      : edit((d) => setParam(d, step.id, param.key, value, names), typing)
                  }
                />
              </div>
              {row.added && (
                <button
                  type="button"
                  className="btn ghost small auto-param-remove"
                  data-boni-action="automations.edit"
                  aria-label={`${t(DO.removeOption)}: ${name}`}
                  onClick={() => edit((d) => removeOption(d, step.id, param.key))}
                >
                  {t(DO.removeOption)}
                </button>
              )}
            </div>
          );
          // Its connections after «Modelo», in AU-50's order.
          return isAgent && param.key === AGENT_PARAMS.model ? [shown, table] : [shown];
        })}
        {codeContext && (
          <CodeParams
            t={t}
            step={step}
            draft={state.draft}
            context={codeContext}
            locale={cite.locale}
            names={cite.said ?? {}}
            readOnly={still}
            setMode={(m) => edit((d) => setParam(d, step.id, CODE_PARAMS.mode, m, names))}
            setSource={(s) =>
              edit((d) => setParam(d, step.id, CODE_PARAMS.source, s, names), `${step.id}.source`)
            }
            connect={(key) => edit((d) => connectCollection(d, step.id, key))}
            {...(codeFailure ? { failure: codeFailure } : {})}
          />
        )}
        {codeContext && table}
        {options.length > 0 && (
          <PopButton
            label={t(DO.addOption)}
            title={t(DO.addOption)}
            className="btn ghost small"
            align="start"
          >
            {(done) =>
              options.map((o) => (
                <MenuRow
                  key={o.key}
                  label={paramName(o.key)}
                  boniAction="automations.edit"
                  onClick={() => {
                    done();
                    const start: ParamValue =
                      o.default !== undefined ? (o.control === "toggle" ? true : o.default) : "";
                    edit((d) => setParam(d, step.id, o.key, start, names));
                  }}
                />
              ))
            }
          </PopButton>
        )}
      </fieldset>
    </div>
  );

  const s = step.settings ?? {};
  const settingRow = (key: (typeof SETTINGS_ROWS)[number], control: ReactNode) => (
    <div key={key} className="auto-param" data-setting={key}>
      <span className="auto-param-name">{t(KEY.setting(key))}</span>
      <div className="auto-param-control">{control}</div>
    </div>
  );
  const retry = s.retry ?? { times: 0, waitMs: 0 };
  const settings = (
    <div className="auto-view-rows" role="tabpanel" aria-label={t("auto.view.settings")}>
      {SETTINGS_ROWS.map((key) => {
        const name = t(KEY.setting(key));
        if (key === "onError")
          return settingRow(
            key,
            <select
              className="input"
              aria-label={name}
              value={s.onError ?? "stop"}
              onChange={(e) => set("onError", e.target.value as StepSettings["onError"])}
            >
              {(["stop", "continue", "errorOutput"] as const).map((o) => (
                <option key={o} value={o}>
                  {t(`auto.view.onError.${o}`)}
                </option>
              ))}
            </select>,
          );
        if (key === "retry")
          return settingRow(
            key,
            <span className="auto-retry">
              <NumberBox
                label={`${name}: ${t("auto.view.retry.times")}`}
                word={t("auto.view.retry.times")}
                value={retry.times}
                max={MAX_RETRIES}
                set={(times, typing) =>
                  set(
                    "retry",
                    { ...retry, times },
                    typing ? view.typing("retry.times", typing) : undefined,
                  )
                }
              />
              <NumberBox
                label={`${name}: ${t("auto.view.retry.wait")}`}
                word={t("auto.view.retry.wait")}
                value={Math.round(retry.waitMs / 1000)}
                max={3600}
                set={(sec, typing) =>
                  set(
                    "retry",
                    { ...retry, waitMs: sec * 1000 },
                    typing ? view.typing("retry.wait", typing) : undefined,
                  )
                }
              />
            </span>,
          );
        if (key === "note")
          return settingRow(
            key,
            <NoteBox label={name} value={s.note ?? ""} view={view} set={set} />,
          );
        return settingRow(
          key,
          <input
            type="checkbox"
            className="auto-toggle"
            aria-label={name}
            checked={s[key] === true}
            onChange={(e) => set(key, e.target.checked)}
          />,
        );
      })}
    </div>
  );

  const middle = (
    <section className="auto-view-col auto-view-mid">
      <div className="auto-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "params"}
          className="auto-tab"
          onClick={() => setTab("params")}
        >
          {t("auto.view.params")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "settings"}
          className="auto-tab"
          onClick={() => setTab("settings")}
        >
          {changed ? t("auto.view.settingsCount", { n: changed }) : t("auto.view.settings")}
        </button>
      </div>
      {tab === "params" ? params : settings}
    </section>
  );

  return (
    <ViewContext.Provider value={view}>
      <CiteContext.Provider value={cite}>
        <div className="auto-view-back" onPointerDown={close} aria-hidden />
        <div
          ref={box}
          className={`auto-view${phone ? " phone" : wide ? "" : " narrow"}`}
          role="dialog"
          aria-label={step.name}
          tabIndex={-1}
          data-step={step.id}
          onKeyDown={(e) => {
            // Esc in a field leaves the field; the next one closes the view (the canvas's keys). One the field used
            // itself (the code editor closing its completion) is left to it.
            const el = e.target as HTMLElement;
            if (
              e.key === "Escape" &&
              !e.nativeEvent.defaultPrevented &&
              el !== e.currentTarget &&
              el.closest("input, textarea, select, [contenteditable='true']")
            ) {
              e.preventDefault();
              el.blur();
              box.current?.focus();
            }
          }}
        >
          <header className="auto-view-head">
            <span className="auto-card-icon" aria-hidden>
              <Icon size={18} strokeWidth={1.7} />
            </span>
            <div className="auto-view-title">
              {still ? (
                <h2 className="auto-view-name look" title={step.name}>
                  {step.name}
                </h2>
              ) : (
                <NameBox
                  key={step.name}
                  name={step.name}
                  label={t("auto.view.name")}
                  onDone={(name) => edit((d) => rename(d, step.id, name))}
                />
              )}
              {summary && <p className="auto-view-summary">{summary}</p>}
            </div>
            <div className="auto-view-test">
              {(why || blocked) && !still && (
                <span className="auto-view-why">
                  {why?.why === "testing"
                    ? t("auto.view.testing")
                    : why
                      ? t("auto.view.missing", {
                          names: why.params.map((p) => paramName(p.key)).join(", "),
                        })
                      : t(`auto.view.code.${blocked}`)}
                </span>
              )}
              <TestStepButton
                t={t}
                state={state}
                step={step}
                className="btn"
                besideSays
                blocked={blocked !== null}
              />
            </div>
            <button
              type="button"
              className="icon-btn"
              aria-label={t("auto.close")}
              title={t("auto.close")}
              onClick={close}
            >
              <X size={16} strokeWidth={1.8} />
            </button>
          </header>
          {phone ? (
            <div className="auto-view-cols one">
              <section className="auto-view-col">
                <div className="auto-tabs" role="tablist">
                  {(["input", "params", "output"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="tab"
                      aria-selected={pane === p}
                      className="auto-tab"
                      onClick={() => setPane(p)}
                    >
                      {t(`auto.view.${p}`)}
                    </button>
                  ))}
                </div>
                {pane === "input" ? input : pane === "output" ? output : params}
              </section>
            </div>
          ) : wide ? (
            <div className="auto-view-cols">
              {input}
              {middle}
              {output}
            </div>
          ) : (
            <div className="auto-view-cols">
              <section className="auto-view-col auto-view-side">
                <div className="auto-tabs" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={side === "input"}
                    className="auto-tab"
                    onClick={() => setSide("input")}
                  >
                    {t("auto.view.input")}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={side === "output"}
                    className="auto-tab"
                    onClick={() => setSide("output")}
                  >
                    {t("auto.view.output")}
                  </button>
                </div>
                {side === "input" ? input : output}
              </section>
              {middle}
            </div>
          )}
        </div>
      </CiteContext.Provider>
    </ViewContext.Provider>
  );
}

/** The step's name, edited in the view's header (AU-70, AU-86): Intro or leaving keeps it, Esc leaves it as it was. */
function NameBox({
  name,
  label,
  onDone,
}: {
  name: string;
  label: string;
  onDone: (name: string) => void;
}) {
  const [text, setText] = useState(name);
  return (
    <input
      className="auto-view-name"
      aria-label={label}
      title={name}
      data-boni-action="automations.edit"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text.trim() && text !== name) onDone(text);
        else setText(name);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setText(name);
      }}
    />
  );
}

/** A whole number from 0 to `max`, typed as one run (AU-68). */
function NumberBox({
  label,
  word,
  value,
  max,
  set,
}: {
  label: string;
  word: string;
  value: number;
  max: number;
  set: (n: number, entered?: number) => void;
}) {
  const run = useRef(0);
  return (
    <span className="auto-number">
      <input
        className="input auto-input"
        type="number"
        min={0}
        max={max}
        aria-label={label}
        value={value}
        onFocus={() => {
          run.current = ++entered;
        }}
        onChange={(e) => {
          const n = Math.trunc(Number(e.target.value));
          set(Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0, run.current);
        }}
        onKeyDown={enterEnds}
      />
      <span className="auto-number-word">{word}</span>
    </span>
  );
}

/** «Nota»: Juan's own text, typed as one run (AU-68). */
function NoteBox({
  label,
  value,
  view,
  set,
}: {
  label: string;
  value: string;
  view: View;
  set: (key: "note", value: string, typing?: string) => void;
}) {
  const run = useRef(0);
  return (
    <textarea
      className="input auto-note"
      aria-label={label}
      rows={2}
      value={value}
      onFocus={() => {
        run.current = ++entered;
      }}
      onChange={(e) => set("note", e.target.value, view.typing("note", run.current))}
    />
  );
}
