import { Check, ChevronDown, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { FormComponent, FormField, Json, Option } from "../core/contract.ts";
import * as F from "../core/formLogic.ts";
import { markPanelEdited, useStore } from "../store.ts";

export type OptionsLoader = (source: string) => Promise<Option[]>;

/**
 * A server-described form. `onSubmit` returns the server's field errors (empty = done; the form is then left by
 * the caller). Values stay while the form is open, so a rejected or failed save loses nothing.
 *
 * `initial` fills it (a shortcut's values). `collapse` (the phone) shows the required fields and those filled in,
 * and folds the rest under "More details". `mode: "values"` edits a shortcut's values: nothing is required and
 * dates are left out (a shortcut uses the day it is tapped). `extra` adds buttons next to the submit button and
 * gets the values as they are now.
 */
export function FormView({
  form,
  today,
  loadOptions,
  onSubmit,
  initial,
  collapse = false,
  mode = "capture",
  submitLabel,
  extra,
}: {
  form: FormComponent;
  today: string;
  loadOptions: OptionsLoader;
  onSubmit: (values: F.Values) => Promise<Record<string, string>>;
  initial?: F.Values;
  collapse?: boolean;
  mode?: "capture" | "values";
  submitLabel?: string;
  extra?: (values: F.Values) => ReactNode;
}) {
  const t = useStore((s) => s.t);
  const [values, setValues] = useState<F.Values>(() => ({
    ...F.initialValues(form, today),
    ...initial,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [more, setMore] = useState(false);
  const fields = form.fields.filter((f) => mode === "capture" || f.type !== "date");
  // Folded: neither required nor filled in by `initial`; an error in one of them unfolds them.
  const folded = (f: FormField) =>
    collapse && !f.required && F.isEmpty(initial?.[f.id] ?? null) && f.type !== "unknown";
  const foldedCount = fields.filter((f) => folded(f) && F.isVisible(f, values)).length;
  const showMore = more || fields.some((f) => folded(f) && errors[f.id]);

  const set = (id: string, v: Json) => {
    setValues((vs) => ({ ...vs, [id]: v }));
    markPanelEdited();
    if (errors[id]) setErrors(({ [id]: _gone, ...rest }) => rest);
  };

  const send = async () => {
    const local = mode === "values" ? {} : F.clientErrors(form, values);
    if (Object.keys(local).length) {
      setErrors(
        Object.fromEntries(Object.entries(local).map(([k, code]) => [k, t(`form.${code}`)])),
      );
      return;
    }
    setSending(true);
    try {
      setErrors(await onSubmit(F.payload(form, values)));
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {fields.map((f) =>
        F.isVisible(f, values) && !folded(f) ? (
          <FieldView
            key={f.id}
            field={f}
            value={values[f.id] ?? null}
            error={errors[f.id]}
            loadOptions={loadOptions}
            today={today}
            set={(v) => set(f.id, v)}
          />
        ) : null,
      )}
      {foldedCount > 0 && (
        <button
          type="button"
          className={`more-toggle${showMore ? " open" : ""}`}
          aria-expanded={showMore}
          onClick={() => setMore(!showMore)}
        >
          <ChevronDown size={18} strokeWidth={1.8} />
          {t("form.more", { n: foldedCount })}
        </button>
      )}
      {showMore &&
        fields.map((f) =>
          F.isVisible(f, values) && folded(f) ? (
            <FieldView
              key={f.id}
              field={f}
              value={values[f.id] ?? null}
              error={errors[f.id]}
              loadOptions={loadOptions}
              today={today}
              set={(v) => set(f.id, v)}
            />
          ) : null,
        )}
      {errors._ && <p className="form-error">{errors._}</p>}
      {Object.keys(errors).length > 0 && !errors._ && (
        <p className="form-error">{t("form.check")}</p>
      )}
      <div className="form-foot">
        {extra?.(values)}
        <button type="submit" className="btn primary wide" disabled={sending}>
          {sending ? t("form.saving") : (submitLabel ?? form.submit.label)}
        </button>
      </div>
    </form>
  );
}

function Label({ field, htmlFor }: { field: FormField; htmlFor?: string }) {
  return (
    <label className="field-label" htmlFor={htmlFor}>
      {field.label}
      {field.required && <span className="req"> *</span>}
    </label>
  );
}

function FieldView({
  field: f,
  value,
  error,
  loadOptions,
  today,
  set,
}: {
  field: FormField;
  value: Json;
  error?: string;
  loadOptions: OptionsLoader;
  today: string;
  set: (v: Json) => void;
}) {
  const t = useStore((s) => s.t);
  const id = `f-${f.id}`;
  // A number from a shortcut shows as typed in Spanish ("1,6"), the way the amount field takes it.
  const text =
    value == null
      ? ""
      : f.type === "amount" && typeof value === "number"
        ? String(value).replace(".", ",")
        : String(value);
  let control: React.ReactNode;
  switch (f.type) {
    case "amount":
      control = (
        <div className={`input-wrap${error ? " invalid" : ""}`}>
          <input
            id={id}
            className="input"
            inputMode="decimal"
            autoComplete="off"
            value={text}
            onChange={(e) => {
              const v = e.target.value;
              if (/^[\d.,]*$/.test(v)) set(v === "" ? null : v);
            }}
          />
          <span className="suffix">{(f.currency ?? "EUR") === "EUR" ? "€" : f.currency}</span>
        </div>
      );
      break;
    case "text":
      control = f.multiline ? (
        <textarea
          id={id}
          className={`input area${error ? " invalid" : ""}`}
          value={text}
          placeholder={f.placeholder ?? undefined}
          onChange={(e) =>
            set(f.max_length ? e.target.value.slice(0, f.max_length) : e.target.value)
          }
        />
      ) : (
        <input
          id={id}
          className={`input${error ? " invalid" : ""}`}
          autoComplete="off"
          value={text}
          placeholder={f.placeholder ?? undefined}
          onChange={(e) =>
            set(f.max_length ? e.target.value.slice(0, f.max_length) : e.target.value)
          }
        />
      );
      break;
    case "date": {
      const quick: [string, string][] = [
        [t("form.today"), today],
        [t("form.yesterday"), F.shiftIso(today, -1)],
        [t("form.dayBefore"), F.shiftIso(today, -2)],
      ];
      control = (
        <div className="row wrap">
          <div className="segmented">
            {quick.map(([label, iso]) => (
              <button
                key={iso}
                type="button"
                className={text === iso ? "on" : ""}
                onClick={() => set(iso)}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            id={id}
            type="date"
            className={`input date${error ? " invalid" : ""}`}
            value={text}
            onChange={(e) => set(e.target.value)}
          />
        </div>
      );
      break;
    }
    case "toggle":
      return (
        <div className="field">
          <label className="toggle-row">
            <input
              type="checkbox"
              className="switch"
              checked={value === true || value === "true"}
              onChange={(e) => set(e.target.checked)}
            />
            <span>{f.label}</span>
          </label>
          {(error || f.help) && (
            <div className={error ? "field-error" : "field-help"}>{error ?? f.help}</div>
          )}
        </div>
      );
    case "choice":
      control =
        f.options && !f.searchable ? (
          <div className="choices" role="radiogroup" aria-label={f.label}>
            {f.options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={text === o.value}
                className={`choice${text === o.value ? " on" : ""}`}
                onClick={() => set(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        ) : (
          <SearchList
            id={id}
            source={f.source ?? null}
            inline={f.options ?? null}
            multi={false}
            selected={text ? [text] : []}
            loadOptions={loadOptions}
            onChange={(picked) => set(picked[0] ?? null)}
          />
        );
      break;
    case "multi_choice":
      control = (
        <SearchList
          id={id}
          source={f.source ?? null}
          inline={f.options ?? null}
          multi
          selected={Array.isArray(value) ? value.map(String) : []}
          loadOptions={loadOptions}
          onChange={(picked) => set(picked)}
        />
      );
      break;
    default:
      control = <div className="muted small">{t("form.unknownField")}</div>;
  }
  return (
    <div className="field">
      <Label field={f} htmlFor={id} />
      {control}
      {(error || f.help) && (
        <div className={error ? "field-error" : "field-help"}>{error ?? f.help}</div>
      )}
    </div>
  );
}

/**
 * A searchable list of options (inline or from a server source), keyboard first: typing filters, arrows move,
 * Enter picks, Esc closes. The selected ones show as removable chips.
 */
export function SearchList({
  id,
  source,
  inline,
  multi,
  selected,
  loadOptions,
  onChange,
}: {
  id?: string;
  source: string | null;
  inline: Option[] | null;
  multi: boolean;
  selected: string[];
  loadOptions: OptionsLoader;
  onChange: (values: string[]) => void;
}) {
  const t = useStore((s) => s.t);
  const [all, setAll] = useState<Option[]>(inline ?? []);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!source) return;
    let live = true;
    loadOptions(source)
      .then((list) => live && setAll(list))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [source]);

  const labels = useMemo(() => new Map(all.map((o) => [o.value, o.label])), [all]);
  const options = useMemo(() => F.filterOptions(all, query).slice(0, 200), [all, query]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (o: Option) => {
    if (multi)
      onChange(
        selected.includes(o.value) ? selected.filter((v) => v !== o.value) : [...selected, o.value],
      );
    else {
      onChange([o.value]);
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <div className="search-list">
      {selected.length > 0 && (
        <div className="picked">
          {selected.map((v) => (
            <span key={v} className="picked-chip">
              {labels.get(v) ?? v}
              <button
                type="button"
                className="icon-btn tiny"
                aria-label={t("form.remove", { label: labels.get(v) ?? v })}
                onClick={() => onChange(selected.filter((s) => s !== v))}
              >
                <X size={12} strokeWidth={2} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        id={id}
        className="input"
        autoComplete="off"
        placeholder={t("form.search")}
        value={query}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(options.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" && open && options[active]) {
            e.preventDefault();
            pick(options[active]!);
          } else if (e.key === "Escape" && open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && (
        <div
          ref={listRef}
          className="options"
          role="listbox"
          aria-multiselectable={multi}
          tabIndex={-1}
        >
          {options.length === 0 && <div className="option empty muted">{t("form.noMatches")}</div>}
          {options.map((o, i) => {
            const on = selected.includes(o.value);
            return (
              <div
                key={o.value}
                role="option"
                tabIndex={-1}
                aria-selected={on}
                className={`option${i === active ? " active" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep the focus in the search box
                  pick(o);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="option-check">{on && <Check size={14} strokeWidth={2} />}</span>
                <span className="option-text">
                  <span className="option-label">{o.label}</span>
                  {o.hint && <span className="option-hint">{o.hint}</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {!open && selected.length === 0 && <div className="field-help">{t("form.typeToSearch")}</div>}
    </div>
  );
}
