import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * A button that opens a small floating box (a menu or a few controls), calendar style. The box is placed under the
 * button and kept inside the window (it must fit in a widget's small window too). Outside click or Esc closes it;
 * Esc closes only it, never the screen or the panel under it.
 */
export function PopButton({
  label,
  title,
  className = "icon-btn",
  align = "end",
  width,
  onOpenChange,
  children,
}: {
  label: ReactNode;
  title: string;
  className?: string;
  align?: "start" | "end";
  width?: number;
  onOpenChange?: (open: boolean) => void;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const change = (v: boolean) => {
    setOpen(v);
    onOpenChange?.(v);
  };

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const b = button.current?.getBoundingClientRect();
      const r = box.current?.getBoundingClientRect();
      if (!b || !r) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = align === "end" ? b.right - r.width : b.left;
      left = Math.max(4, Math.min(left, vw - r.width - 4));
      let top = b.bottom + 4;
      if (top + r.height > vh - 4) top = Math.max(4, b.top - r.height - 4);
      setPos({ left: Math.round(left), top: Math.round(top) });
    };
    place();
    const ro = new ResizeObserver(place);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (box.current?.contains(target) || button.current?.contains(target)) return;
      // a menu opened from inside this box (a nested picker) counts as inside
      if ((target as Element).closest?.(".pop-box")) return;
      change(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      change(false);
      button.current?.focus();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`${className}${open ? " active" : ""}`}
        title={title}
        aria-label={title}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          change(!open);
        }}
      >
        {label}
      </button>
      {open && (
        <div
          ref={box}
          className="pop-box"
          role="dialog"
          aria-label={title}
          style={{
            left: pos?.left ?? 0,
            top: pos?.top ?? 0,
            visibility: pos ? "visible" : "hidden",
            ...(width ? { width } : {}),
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {children(() => change(false))}
        </div>
      )}
    </>
  );
}

/**
 * A menu where the pointer was (a click or a right click on a block), kept inside the window. Outside click or
 * Esc closes it. It is opened by a click, so listening for the next press can start at once.
 */
export function PointMenu({
  x,
  y,
  label,
  width = 230,
  onClose,
  children,
}: {
  x: number;
  y: number;
  label: string;
  width?: number;
  onClose: () => void;
  children: (close: () => void) => ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      left: Math.round(Math.max(4, Math.min(x, window.innerWidth - r.width - 4))),
      top: Math.round(Math.max(4, Math.min(y, window.innerHeight - r.height - 4))),
    });
  }, [x, y]);
  useEffect(() => {
    const outside = (e: MouseEvent) => {
      if (box.current?.contains(e.target as Node)) return;
      if ((e.target as Element).closest?.(".pop-box")) return;
      onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  return (
    <div
      ref={box}
      className="pop-box"
      role="dialog"
      aria-label={label}
      style={{
        left: pos?.left ?? x,
        top: pos?.top ?? y,
        width,
        visibility: pos ? "visible" : "hidden",
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {children(onClose)}
    </div>
  );
}

/** One row of a menu: a label, a tick when chosen. */
export function MenuRow({
  label,
  on,
  danger,
  icon,
  onClick,
}: {
  label: string;
  on?: boolean;
  danger?: boolean;
  icon?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={Boolean(on)}
      className={`menu-item${on ? " on" : ""}${danger ? " danger" : ""}`}
      onClick={onClick}
    >
      {icon && <span className="menu-icon">{icon}</span>}
      <span className="menu-text">{label}</span>
      {on && <span className="menu-tick">✓</span>}
    </button>
  );
}

export const MenuSep = () => <div className="menu-sep" />;
