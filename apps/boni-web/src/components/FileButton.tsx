// A button that opens the system's file dialog, started by Juan's own click: its picker, never a click made by code (I-32).
import { type ReactNode, useRef } from "react";

export function FileButton({
  className,
  disabled,
  onFile,
  children,
}: {
  className?: string;
  disabled?: boolean;
  onFile: (f: File) => void;
  children: ReactNode;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
      <button
        type="button"
        className={className}
        disabled={disabled}
        onClick={() => input.current?.showPicker()}
      >
        {children}
      </button>
    </>
  );
}
