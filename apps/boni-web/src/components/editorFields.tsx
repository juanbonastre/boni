import { type ChartStyle, chartStyle, fullStyle } from "@boni/views";
import {
  ChartArea,
  ChartBar,
  ChartColumn,
  ChartColumnStacked,
  ChartLine,
  ChartPie,
  ChevronDown,
  Hash,
  Plus,
  Table2,
  Trash2,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import * as B from "../core/chartBuilder.ts";
import type { ChartCatalog, ChartFilterRule, ChartSpec, FieldInfo } from "../core/contract.ts";
import { isIsoDate, parseAmount } from "../core/formLogic.ts";
import { PALETTE } from "../core/palette.ts";
import { optionList, useStore } from "../store.ts";
import { SearchList } from "./FormView.tsx";
import { MenuButton } from "./Menu.tsx";

/**
 * The fields of a chart definition (the side panel's editor), and the filters on their own (a chart's filter
 * control). They only change a definition; saving is up to whoever shows them.
 */

function Section({
  title,
  help,
  children,
}: {
  title: string;
  help?: string | null;
  children: ReactNode;
}) {
  return (
    <section className="editor-section">
      <h3>{title}</h3>
      {help && <p className="field-help">{help}</p>}
      {children}
    </section>
  );
}

/** A small whole number. Empty is passed on only when `allowEmpty` (otherwise the last number stays). */
function NumberInput({
  label,
  value,
  allowEmpty = false,
  onChange,
}: {
  label: string;
  value: number | null | undefined;
  allowEmpty?: boolean;
  onChange: (n: number | null) => void;
}) {
  const [text, setText] = useState(value?.toString() ?? "");
  useEffect(() => setText(value?.toString() ?? ""), [value]);
  return (
    <label className="inline-field">
      <span className="field-label">{label}</span>
      <input
        className="input num"
        inputMode="numeric"
        value={text}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 3);
          setText(v);
          const n = Number(v) > 0 ? Number(v) : null;
          if (n != null || allowEmpty) onChange(n);
        }}
      />
    </label>
  );
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (d: string | null) => void;
}) {
  return (
    <label className="inline-field">
      <span className="field-label">{label}</span>
      <input
        type="date"
        className="input date"
        value={value ?? ""}
        onChange={(e) => {
          // only complete dates (or nothing) reach the definition
          const v = e.target.value;
          if (isIsoDate(v)) onChange(v);
          else if (!v) onChange(null);
        }}
      />
    </label>
  );
}

const KIND_ICONS: Record<string, ReactNode> = {
  bar: <ChartColumn size={16} strokeWidth={1.8} />,
  hbar: <ChartBar size={16} strokeWidth={1.8} />,
  line: <ChartLine size={16} strokeWidth={1.8} />,
  donut: <ChartPie size={16} strokeWidth={1.8} />,
  number: <Hash size={16} strokeWidth={1.8} />,
  stacked_bar: <ChartColumnStacked size={16} strokeWidth={1.8} />,
  area: <ChartArea size={16} strokeWidth={1.8} />,
  table: <Table2 size={16} strokeWidth={1.8} />,
};
/** Notion's five, first; the rest of the catalogue under "Other kinds". */
const MAIN_KINDS = ["bar", "hbar", "line", "donut", "number"];

/** One setting as Notion's view settings show it: its name on the left, its value (a menu) on the right. */
function OptRow({
  label,
  value,
  items,
  onPick,
}: {
  label: string;
  value: string;
  items: { id: string; label: string }[];
  onPick: (id: string) => void;
}) {
  const current = items.find((i) => i.id === value)?.label ?? value;
  return (
    <div className="opt-row">
      <span className="opt-label">{label}</span>
      <MenuButton
        className="opt-value"
        ariaLabel={`${label}: ${current}`}
        label={current}
        items={items.map((i) => ({ ...i, on: i.id === value }))}
        onPick={onPick}
      />
    </div>
  );
}

function OptToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="opt-row">
      <span className="opt-label">{label}</span>
      <input
        type="checkbox"
        className="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

/**
 * The chart's settings, laid out as Notion's chart view settings: its name, the chart type as icons, then
 * sections of rows (name on the left, value on the right): the X axis (what it shows, its order, zero
 * values), the Y axis (what it measures, series, running total, comparison, reference line), the period,
 * the filters and the style (colour, and behind "More style options" the height, grid, axis names and data
 * labels). Every change shows at once on the chart's card.
 */
export function EditorForm({
  spec,
  cat,
  edit,
}: {
  spec: ChartSpec;
  cat: ChartCatalog;
  edit: (c: (s: ChartSpec) => ChartSpec) => void;
}) {
  const t = useStore((s) => s.t);
  const [moreStyle, setMoreStyle] = useState(false);
  const style = fullStyle(spec.style);
  const setStyle = (patch: Partial<ChartStyle>) =>
    edit((s) => ({ ...s, style: chartStyle({ ...fullStyle(s.style), ...patch }) ?? {} }));
  const category = B.isCategoryKind(spec.kind);
  const time = !category && spec.kind !== "number";
  const fields = cat.fields.filter((f) => f.can_group !== false);
  const fieldItems = fields.map((f) => ({ id: f.id, label: f.label }));
  const sorts = ["auto", "value_desc", "value_asc", "label"].map((id) => ({
    id,
    label: t(`editor.sort.${id}`),
  }));
  const others = cat.kinds.filter((k) => !MAIN_KINDS.includes(k.id));
  const choose = (list: string[], prefix: string) =>
    list.map((id) => ({ id, label: t(`${prefix}.${id}`) }));
  return (
    <div className="chart-options">
      <label className="field">
        <span className="field-label">{t("editor.title")}</span>
        <input
          className="input title-input"
          value={spec.title}
          onChange={(e) => edit((s) => ({ ...s, title: e.target.value.slice(0, 80) }))}
        />
      </label>

      <section className="opt-section">
        <h3>{t("editor.chartType")}</h3>
        <div className="kind-icons" role="radiogroup" aria-label={t("editor.chartType")}>
          {MAIN_KINDS.filter((k) => cat.kinds.some((c) => c.id === k)).map((k) => {
            const name = cat.kinds.find((c) => c.id === k)?.label ?? k;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={spec.kind === k}
                aria-label={name}
                title={name}
                className={`kind-icon${spec.kind === k ? " on" : ""}`}
                onClick={() => edit((s) => ({ ...s, kind: k }))}
              >
                {KIND_ICONS[k]}
              </button>
            );
          })}
          {others.length > 0 && (
            <MenuButton
              className={`kind-icon more${MAIN_KINDS.includes(spec.kind) ? "" : " on"}`}
              ariaLabel={t("editor.otherKinds")}
              icon={MAIN_KINDS.includes(spec.kind) ? null : KIND_ICONS[spec.kind]}
              label=""
              items={others.map((k) => ({ id: k.id, label: k.label, on: k.id === spec.kind }))}
              onPick={(kind) => edit((s) => ({ ...s, kind }))}
            />
          )}
        </div>
        {cat.kinds.find((k) => k.id === spec.kind)?.help && (
          <p className="field-help">{cat.kinds.find((k) => k.id === spec.kind)?.help}</p>
        )}
      </section>

      {spec.kind !== "number" && (
        <section className="opt-section">
          <h3>{category ? t("editor.data") : t("editor.xSection")}</h3>
          <OptRow
            label={category ? t("editor.groupBy") : t("editor.whatToShow")}
            value={spec.x?.field ?? ""}
            items={fieldItems}
            onPick={(id) =>
              edit((s) => ({
                ...s,
                x: { field: id, granularity: id === "date" ? (s.x?.granularity ?? "month") : null },
              }))
            }
          />
          {spec.x?.field === "date" && (
            <OptRow
              label={t("editor.by")}
              value={spec.x.granularity ?? "month"}
              items={cat.granularities}
              onPick={(g) => edit((s) => ({ ...s, x: { field: "date", granularity: g } }))}
            />
          )}
          <OptRow
            label={t("editor.sortBy")}
            value={spec.sort}
            items={sorts}
            onPick={(sort) => edit((s) => ({ ...s, sort }))}
          />
          {spec.x?.field !== "date" && (
            <NumberInput
              label={t("editor.top")}
              value={spec.top}
              allowEmpty
              onChange={(n) =>
                edit((s) => ({ ...s, top: n == null ? null : Math.min(50, Math.max(1, n)) }))
              }
            />
          )}
          <OptToggle
            label={t("editor.omitZero")}
            checked={style.omitZero}
            onChange={(omitZero) => setStyle({ omitZero })}
          />
          <OptToggle
            label={t("editor.drilldown")}
            checked={spec.drilldown}
            onChange={(drilldown) => edit((s) => ({ ...s, drilldown }))}
          />
        </section>
      )}

      <section className="opt-section">
        <h3>{spec.kind === "number" || category ? t("editor.value") : t("editor.ySection")}</h3>
        <OptRow
          label={t("editor.whatToShow")}
          value={spec.measure}
          items={cat.measures}
          onPick={(measure) => edit((s) => ({ ...s, measure }))}
        />
        {B.SPLIT_KINDS.has(spec.kind) && (
          <OptRow
            label={t("editor.split")}
            value={spec.split?.field ?? ""}
            items={[
              ...(spec.kind === "stacked_bar" ? [] : [{ id: "", label: t("editor.noSplit") }]),
              ...fieldItems,
            ]}
            onPick={(id) =>
              edit((s) => ({
                ...s,
                split: id ? { field: id, granularity: id === "date" ? "month" : null } : null,
              }))
            }
          />
        )}
        {time && (
          <OptToggle
            label={t("editor.cumulative")}
            checked={style.cumulative}
            onChange={(cumulative) => setStyle({ cumulative })}
          />
        )}
        {!spec.split && spec.kind !== "donut" && (
          <OptRow
            label={t("editor.compare")}
            value={spec.compare}
            items={cat.compares}
            onPick={(compare) => edit((s) => ({ ...s, compare }))}
          />
        )}
        {time && (
          <OptRow
            label={t("editor.reference")}
            value={style.reference}
            items={choose(["none", "average"], "editor.ref")}
            onPick={(reference) => setStyle({ reference: reference as ChartStyle["reference"] })}
          />
        )}
      </section>

      <section className="opt-section">
        <h3>{t("editor.period")}</h3>
        <OptRow
          label={t("editor.period")}
          value={spec.period.kind}
          items={cat.periods}
          onPick={(kind) => edit((s) => ({ ...s, period: { kind } }))}
        />
        {spec.period.kind === "last_months" && (
          <NumberInput
            label={t("editor.months")}
            value={spec.period.months}
            onChange={(n) => edit((s) => ({ ...s, period: { ...s.period, months: n ?? 12 } }))}
          />
        )}
        {spec.period.kind === "last_days" && (
          <NumberInput
            label={t("editor.days")}
            value={spec.period.days}
            onChange={(n) => edit((s) => ({ ...s, period: { ...s.period, days: n ?? 30 } }))}
          />
        )}
        {spec.period.kind === "range" && (
          <div className="row wrap">
            <DateInput
              label={t("editor.from")}
              value={spec.period.start}
              onChange={(d) => edit((s) => ({ ...s, period: { ...s.period, start: d } }))}
            />
            <DateInput
              label={t("editor.to")}
              value={spec.period.end}
              onChange={(d) => edit((s) => ({ ...s, period: { ...s.period, end: d } }))}
            />
          </div>
        )}
      </section>

      <FiltersEditor spec={spec} cat={cat} edit={edit} />

      <section className="opt-section">
        <h3>{t("editor.style")}</h3>
        <div className="opt-row">
          <span className="opt-label">{t("editor.color")}</span>
          <div className="opt-swatches" role="radiogroup" aria-label={t("editor.color")}>
            {spec.kind !== "line" && spec.kind !== "number" && (
              <button
                type="button"
                role="radio"
                aria-checked={style.colors === "colorful"}
                title={t("editor.colorful")}
                aria-label={t("editor.colorful")}
                className={`swatch big colorful${style.colors === "colorful" ? " on" : ""}`}
                onClick={() => setStyle({ colors: "colorful" })}
              />
            )}
            {PALETTE.map((c) => (
              <button
                key={c.hex}
                type="button"
                role="radio"
                aria-checked={style.colors === "auto" && spec.color === c.hex}
                title={t(`color.${c.name}`)}
                aria-label={t(`color.${c.name}`)}
                className={`swatch big${style.colors === "auto" && spec.color === c.hex ? " on" : ""}`}
                style={{ background: c.hex }}
                onClick={() =>
                  edit((s) => ({
                    ...s,
                    color: c.hex,
                    style: chartStyle({ ...fullStyle(s.style), colors: "auto" }) ?? {},
                  }))
                }
              />
            ))}
          </div>
        </div>
        <button
          type="button"
          className="opt-row opt-disclosure"
          aria-expanded={moreStyle}
          onClick={() => setMoreStyle((o) => !o)}
        >
          <span className="opt-label">{t("editor.moreStyle")}</span>
          <ChevronDown size={14} strokeWidth={1.8} className={`chev${moreStyle ? " open" : ""}`} />
        </button>
        {moreStyle && (
          <div className="opt-more">
            {spec.kind !== "number" && (
              <OptRow
                label={t("editor.height")}
                value={style.height}
                items={choose(["s", "m", "l", "xl"], "editor.heights")}
                onPick={(height) => setStyle({ height: height as ChartStyle["height"] })}
              />
            )}
            {time && (
              <OptRow
                label={t("editor.grid")}
                value={style.grid}
                items={choose(["h", "v", "both", "none"], "editor.grids")}
                onPick={(grid) => setStyle({ grid: grid as ChartStyle["grid"] })}
              />
            )}
            {spec.kind !== "number" && spec.kind !== "donut" && (
              <OptRow
                label={t("editor.axes")}
                value={style.axes}
                items={choose(["none", "x", "y", "both"], "editor.axesNames")}
                onPick={(axes) => setStyle({ axes: axes as ChartStyle["axes"] })}
              />
            )}
            {spec.kind !== "number" && spec.kind !== "donut" && (
              <OptToggle
                label={t("editor.labels")}
                checked={style.labels}
                onChange={(labels) => setStyle({ labels })}
              />
            )}
          </div>
        )}
      </section>
    </div>
  );
}

export function FiltersEditor({
  spec,
  cat,
  edit,
}: {
  spec: ChartSpec;
  cat: ChartCatalog;
  edit: (c: (s: ChartSpec) => ChartSpec) => void;
}) {
  const t = useStore((s) => s.t);
  const setRule = (i: number, rule: ChartFilterRule | null) =>
    edit((s) => ({
      ...s,
      filters: rule
        ? s.filters.map((r, k) => (k === i ? rule : r))
        : s.filters.filter((_, k) => k !== i),
    }));
  const fieldItems = cat.fields.map((f) => ({ id: f.id, label: f.label }));
  return (
    <Section title={t("editor.filters")} help={t("editor.filtersHelp")}>
      {spec.filters.map((rule, i) => {
        const field = cat.fields.find((f) => f.id === rule.field);
        return (
          <div key={i} className="filter">
            <div className="row">
              <MenuButton
                label={field?.label ?? rule.field}
                items={fieldItems}
                onPick={(f) => setRule(i, B.newRule(f, cat))}
              />
              <MenuButton
                label={B.opLabel(t, rule.field, rule.op)}
                items={(field?.ops ?? [rule.op]).map((op) => ({
                  id: op,
                  label: B.opLabel(t, rule.field, op),
                }))}
                onPick={(op) => {
                  // values of "is" (a list) do not carry over to "contains" (a text), and vice versa
                  const keep = B.LIST_OPS.has(op) === B.LIST_OPS.has(rule.op) && B.needsValues(op);
                  setRule(i, { ...rule, op, values: keep ? rule.values : [] });
                }}
              />
              <span className="spacer" />
              <button
                type="button"
                className="icon-btn"
                onClick={() => setRule(i, null)}
                title={t("editor.removeFilter")}
                aria-label={t("editor.removeFilter")}
              >
                <Trash2 size={15} strokeWidth={1.8} />
              </button>
            </div>
            {field && B.needsValues(rule.op) && (
              <RuleValues
                rule={rule}
                field={field}
                onChange={(values) => setRule(i, { ...rule, values })}
              />
            )}
          </div>
        );
      })}
      <MenuButton
        label={t("editor.addFilter")}
        icon={<Plus size={15} strokeWidth={2} />}
        items={fieldItems}
        onPick={(f) => edit((s) => ({ ...s, filters: [...s.filters, B.newRule(f, cat)] }))}
      />
    </Section>
  );
}

function RuleValues({
  rule,
  field,
  onChange,
}: {
  rule: ChartFilterRule;
  field: FieldInfo;
  onChange: (v: ChartFilterRule["values"]) => void;
}) {
  const t = useStore((s) => s.t);
  const current = rule.values.map(String);
  const [text, setText] = useState(current[0] ?? "");
  if (field.kind === "time") {
    return (
      <DateInput
        label={rule.op === "gte" ? t("editor.from") : t("editor.to")}
        value={current[0]}
        onChange={(d) => onChange(d ? [d] : [])}
      />
    );
  }
  if (field.kind === "number") {
    return (
      <label className="inline-field">
        <span className="field-label">{t("editor.amount")}</span>
        <input
          className="input num wide"
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            const v = e.target.value.replace(/[^\d.,]/g, "").slice(0, 10);
            setText(v);
            const n = parseAmount(v);
            onChange(n == null ? [] : [n]);
          }}
        />
      </label>
    );
  }
  if (rule.op === "contains" || rule.op === "not_contains" || !field.source) {
    return (
      <label className="field">
        <span className="field-label">{t("editor.text")}</span>
        <input
          className="input"
          value={text}
          onChange={(e) => {
            const v = e.target.value.slice(0, 60);
            setText(v);
            onChange(v.trim() ? [v.trim()] : []);
          }}
        />
      </label>
    );
  }
  // "is in the group or is" on categories offers whole groups ("comida") and single categories.
  const prefix = field.id === "category" && (rule.op === "prefix" || rule.op === "not_prefix");
  return (
    <SearchList
      source={prefix ? "groups+categories" : field.source}
      inline={null}
      multi
      selected={current}
      loadOptions={async (source) =>
        source === "groups+categories"
          ? [
              ...(await optionList("groups")).map((o) => ({
                ...o,
                label: t("editor.wholeGroup", { label: o.label }),
              })),
              ...(await optionList("categories")),
            ]
          : optionList(source)
      }
      onChange={(vs) => onChange(vs)}
    />
  );
}
