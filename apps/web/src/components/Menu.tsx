import { type ReactNode, useEffect, useRef } from "react";

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
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", down, true);
    window.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", down, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={ref} className={`menu ${className}`} role="menu">
      {children}
    </div>
  );
}
