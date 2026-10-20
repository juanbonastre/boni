import { ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

/** A button that opens a menu of options (calendar style: 30 px rows, 10 px radius). */
export function MenuButton({
  label,
  items,
  onPick,
  className = "btn",
  icon,
  ariaLabel,
}: {
  label: ReactNode;
  items: { id: string; label: string; on?: boolean }[];
  onPick: (id: string) => void;
  className?: string;
  icon?: ReactNode;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault(); // Esc closes the menu only, not the screen under it
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="menu-anchor" ref={ref}>
      <button
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        <span className="btn-text">{label}</span>
        <ChevronDown size={14} strokeWidth={1.8} className="chev" />
      </button>
      {open && (
        <div className="menu" role="menu">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              role="menuitem"
              className={`menu-item${it.on ? " on" : ""}`}
              onClick={() => {
                setOpen(false);
                onPick(it.id);
              }}
            >
              <span className="menu-text">{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Segmented options (one of a few), calendar style. Long lists wrap as chips instead. */
export function Choices({
  items,
  value,
  onChange,
  label,
}: {
  items: { id: string; label: string }[];
  value: string | null;
  onChange: (id: string) => void;
  label?: string;
}) {
  return (
    <div className="choices" role="radiogroup" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="radio"
          aria-checked={it.id === value}
          className={`choice${it.id === value ? " on" : ""}`}
          onClick={() => onChange(it.id)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
