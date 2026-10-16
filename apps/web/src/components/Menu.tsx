import { type ReactNode, useEffect, useRef } from "react";
import { eventTarget, onKeys } from "../host.ts";

/** Minimal popup menu: closes on outside click and on Escape. */
export function Menu({
  open,
  onClose,
  className = "",
  children,
}: {
  open: boolean;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const target = eventTarget(e);
      if (ref.current && !(target && ref.current.contains(target))) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", down, true);
    const offKeys = onKeys(key, true);
    return () => {
      document.removeEventListener("mousedown", down, true);
      offKeys();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={ref} className={`menu ${className}`} role="menu">
      {children}
    </div>
  );
}
