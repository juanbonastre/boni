import { Plus, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { OfflineError } from "../core/api.ts";
import * as B from "../core/chartBuilder.ts";
import type { ChartState } from "../core/charts.ts";
import type {
  ChartCatalog,
  ChartFilterRule,
  ChartSpec,
  Dimension,
  FieldInfo,
} from "../core/contract.ts";
import { isIsoDate, parseAmount } from "../core/formLogic.ts";
import {
  CHARTS,
  deleteChart,
  errorText,
  go,
  loadCatalog,
  optionList,
  preview,
  saveChart,
  toast,
  useStore,
} from "../store.ts";
import { ChartCardContent } from "./ChartCard.tsx";
import { SearchList } from "./FormView.tsx";
import { Choices, MenuButton } from "./Menu.tsx";

/** The editor: options on one side, a live preview (computed by the server, not saved) on the other. */
export function ChartEditor({ initial }: { initial: ChartSpec }) {
  const t = useStore((s) => s.t);
  const catalog = useStore((s) => s.catalog);
  const [spec, setSpec] = useState(() => B.normalize(initial));
  const [drill, setDrill] = useState<string | null>(null);
  const [state, setState] = useState<ChartState>({
    data: null,
    loading: true,
    offline: false,
    error: null,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadCatalog().catch(() => undefined);
  }, []);
  // The preview follows the definition once it settles (typing a title must not send a request per key).
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      setState((s) => ({ ...s, loading: true }));
      preview(spec, drill)
        .then((data) => live && setState({ data, loading: false, offline: false, error: null }))
        .catch(
          (e) =>
            live &&
            setState({
              data: null,
              loading: false,
              offline: e instanceof OfflineError,
              error: errorText(t, e),
            }),
        );
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [spec, drill]);

  const edit = (change: (s: ChartSpec) => ChartSpec) => {
    setSpec((s) => B.normalize(change(s)));
    setDrill(null);
  };
  const save = async () => {
    setSaving(true);
    try {
      await saveChart(spec);
      toast(t("charts.saved"));
      go(CHARTS);
    } catch (e) {
      toast(errorText(t, e));
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    try {
      await deleteChart(spec.id);
      toast(t("charts.deleted"));
      go(CHARTS);
    } catch (e) {
      toast(errorText(t, e));
    }
  };

  return (
    <div className="editor">
      <div className="editor-form">
        {catalog ? (
          <EditorForm spec={spec} cat={catalog} edit={edit} />
        ) : (
          <p className="muted">{t("editor.loading")}</p>
        )}
      </div>
      <div className="editor-preview">
        <ChartCardContent
          title={spec.title}
          state={state}
          className="preview"
          onDrill={(key) => setDrill(key)}
          onBack={drill ? () => setDrill(null) : undefined}
        />
        <div className="row">
          <button
            type="button"
            className="btn primary"
            disabled={saving || !spec.title.trim()}
            onClick={() => void save()}
          >
            {spec.id ? t("editor.save") : t("editor.create")}
          </button>
          <button type="button" className="btn ghost" onClick={() => go(CHARTS)}>
            {t("editor.cancel")}
          </button>
          <span className="spacer" />
          {spec.id && (
            // No confirmation dialogs (design guide): the chart can be made again from the list's duplicate.
            <button type="button" className="btn ghost danger" onClick={() => void remove()}>
              <Trash2 size={14} strokeWidth={1.8} />
              {t("editor.delete")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

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

/** A dimension: a field, and for dates its granularity. `none` adds a "nothing" choice (for the series). */
function DimensionPicker({
  value,
  cat,
  none,
  onChange,
}: {
  value: Dimension | null;
  cat: ChartCatalog;
  none?: string;
  onChange: (d: Dimension | null) => void;
}) {
  const t = useStore((s) => s.t);
  const fields = cat.fields.filter((f) => f.can_group !== false);
  const items = [
    ...(none ? [{ id: "", label: none }] : []),
    ...fields.map((f) => ({ id: f.id, label: f.label })),
  ];
  return (
    <>
      <Choices
        items={items}
        value={value?.field ?? ""}
        onChange={(id) =>
          onChange(id ? { field: id, granularity: id === "date" ? "month" : null } : null)
        }
      />
      {value?.field === "date" && (
        <div className="row">
          <span className="muted small">{t("editor.by")}</span>
          <Choices
            items={cat.granularities}
            value={value.granularity ?? "month"}
            onChange={(g) => onChange({ ...value, granularity: g })}
          />
        </div>
      )}
    </>
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

function EditorForm({
  spec,
  cat,
  edit,
}: {
  spec: ChartSpec;
  cat: ChartCatalog;
  edit: (c: (s: ChartSpec) => ChartSpec) => void;
}) {
  const t = useStore((s) => s.t);
  const sorts = ["auto", "value_desc", "value_asc", "label"].map((id) => ({
    id,
    label: t(`editor.sort.${id}`),
  }));
  return (
    <>
      <label className="field">
        <span className="field-label">{t("editor.title")}</span>
        <input
          className="input title-input"
          value={spec.title}
          onChange={(e) => edit((s) => ({ ...s, title: e.target.value.slice(0, 80) }))}
        />
      </label>
      <Section title={t("editor.kind")} help={cat.kinds.find((k) => k.id === spec.kind)?.help}>
        <Choices
          items={cat.kinds}
          value={spec.kind}
          onChange={(kind) => edit((s) => ({ ...s, kind }))}
        />
      </Section>
      <Section
        title={t("editor.measure")}
        help={cat.measures.find((m) => m.id === spec.measure)?.help}
      >
        <Choices
          items={cat.measures}
          value={spec.measure}
          onChange={(measure) => edit((s) => ({ ...s, measure }))}
        />
      </Section>
      {spec.kind !== "number" && (
        <Section title={B.isCategoryKind(spec.kind) ? t("editor.groupBy") : t("editor.xAxis")}>
          <DimensionPicker value={spec.x} cat={cat} onChange={(x) => edit((s) => ({ ...s, x }))} />
        </Section>
      )}
      {B.SPLIT_KINDS.has(spec.kind) && (
        <Section title={t("editor.split")} help={t("editor.splitHelp")}>
          <DimensionPicker
            value={spec.split}
            cat={cat}
            none={spec.kind === "stacked_bar" ? undefined : t("editor.noSplit")}
            onChange={(split) => edit((s) => ({ ...s, split }))}
          />
        </Section>
      )}
      <Section title={t("editor.period")}>
        <Choices
          items={cat.periods}
          value={spec.period.kind}
          onChange={(kind) => edit((s) => ({ ...s, period: { kind } }))}
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
      </Section>
      {!spec.split && spec.kind !== "donut" && (
        <Section title={t("editor.compare")} help={t("editor.compareHelp")}>
          <Choices
            items={cat.compares}
            value={spec.compare}
            onChange={(compare) => edit((s) => ({ ...s, compare }))}
          />
        </Section>
      )}
      <FiltersEditor spec={spec} cat={cat} edit={edit} />
      {spec.kind !== "number" && (
        <Section title={t("editor.order")}>
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
          <Choices
            items={sorts}
            value={spec.sort}
            onChange={(sort) => edit((s) => ({ ...s, sort }))}
          />
          <label className="toggle-row">
            <input
              type="checkbox"
              className="switch"
              checked={spec.drilldown}
              onChange={(e) => edit((s) => ({ ...s, drilldown: e.target.checked }))}
            />
            <span>{t("editor.drilldown")}</span>
          </label>
        </Section>
      )}
      <label className="toggle-row">
        <input
          type="checkbox"
          className="switch"
          checked={spec.home}
          onChange={(e) => edit((s) => ({ ...s, home: e.target.checked }))}
        />
        <span>{t("editor.home")}</span>
      </label>
    </>
  );
}

function FiltersEditor({
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
