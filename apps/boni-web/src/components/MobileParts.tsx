// The phone's own pieces (docs/design-guide.md, «El móvil»): a large title, a sheet from below, a box to tick and a row that slides.
import { Check, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DataRow, DataType } from "../core/agent.ts";
import { useStore } from "../store.ts";

/**
 * A place's large title (Apple's), with a line above it (Inicio's day) and what goes on its right (the account's
 * initial on Inicio). Deeper screens have it too: the top bar only keeps Back.
 */
export function LargeTitle({
  title,
  right,
  sub,
}: {
  title: string;
  right?: ReactNode;
  sub?: string;
}) {
  return (
    <div className="m-large">
      <div>
        {sub && <p className="m-large-sub">{sub}</p>}
        <h1>{title}</h1>
      </div>
      {right}
    </div>
  );
}

/** A menu in a sheet from below (`ActionSheet`): its title, its actions, and the last row that closes it. */
export interface Menu {
  title: string;
  items: { label: string; icon: ReactNode; danger?: boolean; run: () => void }[];
  /** The last row's label (it closes the menu): "Cancelar" unless a question needs another. */
  cancel?: string;
}

/** A record's title (its title field), or nothing. */
export const titleOf = (d: DataType, r: DataRow) => {
  const v = r.values[d.titleField];
  return typeof v === "string" ? v : "";
};

/**
 * What a phone list needs of a collection: its first date and its first choice (the second line), and its done box
 * when it keeps tasks (its calendar says which one, never a guess).
 */
export function shape(def: DataType) {
  const date = def.fields.find((f) => f.type === "date");
  const done = def.done ? def.fields.find((f) => f.id === def.done) : undefined;
  const choice = def.fields.find((f) => f.type === "select");
  return { date, done, choice };
}

/** A civil day («2026-11-01») as a list says it: «1 nov». */
export function useDay() {
  const lang = useStore((s) => s.settings.language);
  return (d: string) =>
    new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "es-ES", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${d.slice(0, 10)}T12:00:00Z`));
}

/** The box that marks something done, in its row: a tap ticks it and never opens the row. */
export function Tick({ on, toggle, label }: { on: boolean; toggle: () => void; label: string }) {
  return (
    <button
      type="button"
      className={`m-tick${on ? " on" : ""}`}
      aria-pressed={on}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        toggle();
      }}
    >
      {on && <Check size={15} strokeWidth={2.6} />}
    </button>
  );
}

/**
 * A sheet from below (Material 3's modal bottom sheet): its grabber, a title and a close button; a tap outside or
 * Back (Esc, Android's button) closes it. It covers the whole app, wherever it is opened from.
 */
export function BottomSheet({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const t = useStore((s) => s.t);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return createPortal(
    <div className="m-scrim" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="m-bottom-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="m-grabber" aria-hidden="true" />
        <div className="m-sheet-head">
          <h2>{title}</h2>
          <button type="button" className="m-icon" onClick={close} aria-label={t("settings.close")}>
            <X size={22} strokeWidth={1.8} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.querySelector(".m-app") ?? document.body,
  );
}

/**
 * A row that slides: dragged left it shows its actions (done, delete); held down it opens its menu. Scrolling stays
 * the list's (touch-action: pan-y), and the click a mouse sends after a drag or a hold neither opens the row nor
 * closes it.
 */
export function SwipeRow({
  children,
  actions,
  onLong,
}: {
  children: ReactNode;
  actions: { label: string; kind: "good" | "bad"; run: () => void }[];
  onLong: () => void;
}) {
  const width = actions.length * 76;
  const [x, setX] = useState(0);
  const start = useRef<{ x: number; y: number; base: number; moved: boolean } | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swallow = useRef(false);
  const stopHold = () => {
    if (hold.current) clearTimeout(hold.current);
    hold.current = null;
  };
  useEffect(() => stopHold, []);
  return (
    <li className="m-item m-swipe">
      <div className="m-swipe-actions" style={{ width }} aria-hidden={x === 0}>
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            tabIndex={x === 0 ? -1 : 0}
            className={`m-swipe-btn ${a.kind}`}
            onClick={() => {
              setX(0);
              a.run();
            }}
          >
            {a.label}
          </button>
        ))}
      </div>
      <div
        className="m-swipe-row"
        style={{ transform: `translateX(${x}px)`, transition: start.current ? "none" : undefined }}
        onPointerDown={(e) => {
          // A finger sends no click after a drag or a hold: what was kept to swallow ends here.
          swallow.current = false;
          start.current = { x: e.clientX, y: e.clientY, base: x, moved: false };
          hold.current = setTimeout(() => {
            if (start.current && !start.current.moved) {
              start.current = null;
              swallow.current = true;
              onLong();
            }
          }, 520);
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s) return;
          const dx = e.clientX - s.x;
          if (!s.moved && Math.abs(dx) < 8 && Math.abs(e.clientY - s.y) < 8) return;
          stopHold();
          if (!s.moved && Math.abs(e.clientY - s.y) > Math.abs(dx)) {
            start.current = null;
            return;
          }
          if (!s.moved) e.currentTarget.setPointerCapture(e.pointerId);
          s.moved = true;
          setX(Math.max(-width, Math.min(0, s.base + dx)));
        }}
        onPointerUp={() => {
          stopHold();
          const s = start.current;
          start.current = null;
          if (s?.moved) {
            swallow.current = true;
            setX((v) => (v < -width / 2 ? -width : 0));
          }
        }}
        onPointerCancel={() => {
          stopHold();
          start.current = null;
          setX(0);
        }}
        onContextMenu={(e) => e.preventDefault()}
        onClickCapture={(e) => {
          if (swallow.current) {
            swallow.current = false;
            e.stopPropagation();
            e.preventDefault();
            return;
          }
          // A row left open closes on a tap instead of opening.
          if (x !== 0) {
            e.stopPropagation();
            setX(0);
          }
        }}
      >
        {children}
      </div>
    </li>
  );
}
