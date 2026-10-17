import { useEffect, useRef, useState } from "react";
import { ChartCard } from "./components/ChartCard.tsx";
import { host } from "./host.ts";
import { CHARTS, errorText, refresh, removeWidget, toast, useStore } from "./store.ts";
import { useTheme } from "./theme.ts";

const DRAG_THRESHOLD = 4;

/**
 * One desktop widget: a chart card in its own small window that sits on the desktop, below the other windows
 * (the shell makes it a "dock" window kept below, see apps/desktop/widgets.cjs). It is fully interactive: hover
 * for values, click to see a detail; drag anywhere to move it, the corner to resize it, right click for the menu.
 */
export function WidgetPage({ widgetId, chartId }: { widgetId: string; chartId: string }) {
  useTheme();
  const t = useStore((s) => s.t);
  const desk = host.desktop!;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean; resize: boolean } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // The shell takes note of the pointer and the window at the press, and moves the window with the real pointer
  // once it has moved a few pixels (a plain click stays a click on the chart).
  const onPointerDown = (e: React.PointerEvent, resize: boolean) => {
    if (e.button !== 0 || drag.current) return;
    if (!resize && (e.target as HTMLElement).closest("button, .menu")) return;
    drag.current = { x: e.clientX, y: e.clientY, moved: false, resize };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    desk.widget.dragStart(resize ? "resize" : "move");
    if (resize) e.stopPropagation();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_THRESHOLD) return;
    d.moved = true;
    desk.widget.dragMove();
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    desk.widget.dragEnd();
    // the drag ends with a click on the chart: it must not open a detail
    if (d.moved) suppressClick.current = true;
  };

  const items: [string, () => void][] = [
    [t("widget.open"), () => desk.openMain()],
    [t("widget.manage"), () => desk.openMain(CHARTS)],
    [t("widget.refresh"), () => refresh()],
    [t("widget.hide"), () => desk.widget.hide()],
    [
      t("widget.remove"),
      () => {
        removeWidget(widgetId).catch((e) => toast(errorText(t, e)));
      },
    ],
  ];

  return (
    <div
      className="widget"
      onPointerDown={(e) => onPointerDown(e, false)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClickCapture={(e) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          e.stopPropagation();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <ChartCard chartId={chartId} title="Boni" compact className="widget-card" />
      <div
        className="widget-resize"
        onPointerDown={(e) => onPointerDown(e, true)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        aria-hidden="true"
      />
      {menu && <WidgetMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </div>
  );
}

function WidgetMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: [string, () => void][];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useEffect(() => {
    // Inside the small window: shift left/up when it would stick out.
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
  }, [x, y]);
  return (
    <>
      <div
        className="menu-catcher"
        onPointerDown={onClose}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div ref={ref} className="menu" role="menu" style={pos}>
        {items.map(([label, run]) => (
          <button
            key={label}
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              onClose();
              run();
            }}
          >
            <span className="menu-text">{label}</span>
          </button>
        ))}
      </div>
    </>
  );
}
