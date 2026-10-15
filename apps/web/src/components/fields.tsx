import { type ReactNode, useEffect, useRef, useState } from "react";
import { Menu } from "./Menu.tsx";

/** Text input that keeps a local draft and commits on blur or Enter (one undo step per edit). */
export function DraftInput({
  value,
  onCommit,
  className = "",
  placeholder,
  multiline = false,
  autoFocus = false,
  type = "text",
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  placeholder?: string;
  multiline?: boolean;
  autoFocus?: boolean;
  type?: "text" | "number" | "url";
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (autoFocus) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [autoFocus]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  const common = {
    ref,
    className: `field-input ${className}`,
    placeholder,
    value: draft,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
  };
  if (multiline) {
    return (
      <textarea
        {...common}
        rows={3}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft(value);
            (e.target as HTMLElement).blur();
          }
        }}
      />
    );
  }
  return (
    <input
      {...common}
      type={type}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLElement).blur();
        if (e.key === "Escape") {
          setDraft(value);
          (e.target as HTMLElement).blur();
        }
      }}
    />
  );
}

/** "9", "930", "9:30", "21.15", "9pm" -> minutes since midnight, or null. */
export function parseTime(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  const m = s.match(/^(\d{1,2})(?:[:.h]?(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

export function TimeInput({
  minute,
  format,
  onCommit,
  className = "",
}: {
  minute: number;
  format: (m: number) => string;
  onCommit: (m: number) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(format(minute));
  useEffect(() => setDraft(format(minute)), [minute, format]);
  const commit = () => {
    const p = parseTime(draft);
    if (p === null) setDraft(format(minute));
    else if (p !== minute) onCommit(p);
    else setDraft(format(minute));
  };
  return (
    <input
      className={`field-input time-input ${className}`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLElement).blur();
        if (e.key === "Escape") {
          setDraft(format(minute));
          (e.target as HTMLElement).blur();
        }
      }}
    />
  );
}

export interface Choice {
  id: string;
  label: string;
  color?: string;
}

/** Dropdown for select-like fields; `multi` keeps the menu open and toggles. */
export function ChoicePicker({
  choices,
  selected,
  onChange,
  multi = false,
  placeholder,
  noneLabel,
  trigger,
}: {
  choices: Choice[];
  selected: string[];
  onChange: (ids: string[]) => void;
  multi?: boolean;
  placeholder: string;
  noneLabel?: string;
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const chosen = choices.filter((c) => selected.includes(c.id));
  const pick = (id: string) => {
    if (multi)
      onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    else {
      onChange(selected[0] === id ? [] : [id]);
      setOpen(false);
    }
  };
  return (
    <div className="choice">
      <button type="button" className="choice-btn" onClick={() => setOpen((o) => !o)}>
        {trigger ??
          (chosen.length === 0 ? (
            <span className="muted">{placeholder}</span>
          ) : (
            chosen.map((c) => (
              <span
                key={c.id}
                className="chip"
                style={{ "--c": c.color ?? "var(--muted)" } as React.CSSProperties}
              >
                {c.label}
              </span>
            ))
          ))}
      </button>
      <Menu open={open} onClose={() => setOpen(false)} className="choice-menu">
        {noneLabel && !multi && (
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              onChange([]);
              setOpen(false);
            }}
          >
            <span className="muted">{noneLabel}</span>
          </button>
        )}
        {choices.map((c) => (
          <button type="button" key={c.id} className="menu-item" onClick={() => pick(c.id)}>
            <span
              className="chip"
              style={{ "--c": c.color ?? "var(--muted)" } as React.CSSProperties}
            >
              {c.label}
            </span>
            {selected.includes(c.id) && <span className="menu-tick">✓</span>}
          </button>
        ))}
      </Menu>
    </div>
  );
}

/** Date field that shows a localised label and opens the native picker on click. */
export function DateField({
  label,
  iso,
  onChange,
  min,
  className = "",
}: {
  label: string;
  iso: string;
  onChange: (iso: string) => void;
  min?: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className={`date-field ${className}`}>
      <button
        type="button"
        className="date-btn"
        onClick={() => {
          try {
            ref.current?.showPicker();
          } catch {
            ref.current?.focus();
          }
        }}
      >
        {label}
      </button>
      <input
        ref={ref}
        type="date"
        tabIndex={-1}
        aria-hidden
        className="date-native"
        value={iso}
        min={min}
        onChange={(e) => e.target.value && onChange(e.target.value)}
      />
    </span>
  );
}
