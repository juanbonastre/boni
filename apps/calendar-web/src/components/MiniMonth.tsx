/** The sidebar's small month: the visible days highlighted, a click goes to a day. */
import {
  addMonths,
  civilFromDays,
  daysInMonth,
  monthNames,
  monthWeeks,
  startOfMonth,
  weekdayNames,
} from "@boni/calendar";
import { ChevronDown, ChevronUp, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { t } from "../i18n.ts";
import { useApp, useVisible, visibleDays } from "../store.ts";

export function MiniMonth() {
  const settings = useApp((s) => s.settings);
  const view = useApp((s) => s.view);
  const nDays = useApp((s) => s.nDays);
  const start = useVisible((s) => s.start);
  const goTo = useApp((s) => s.goTo);
  const today = useApp.getState().today();
  const n = visibleDays(view, nDays);

  const focus = view === "month" ? start : start + Math.floor((n - 1) / 2);
  const [shown, setShown] = useState(() => startOfMonth(focus));
  useEffect(() => setShown(startOfMonth(focus)), [focus]);

  const weeks = useMemo(
    () => monthWeeks(shown, settings.firstDay, true),
    [shown, settings.firstDay],
  );
  const { y, m } = civilFromDays(shown);
  const monthEnd = shown + daysInMonth(y, m) - 1;
  let visFrom = start;
  let visTo = start + n - 1;
  if (view === "month") {
    visFrom = startOfMonth(start);
    visTo = visFrom + daysInMonth(civilFromDays(start).y, civilFromDays(start).m) - 1;
  }
  const names = weekdayNames(settings.locale, "long");
  const order = Array.from({ length: 7 }, (_, i) => names[(settings.firstDay + i) % 7] ?? "");

  return (
    <div className="mini">
      <div className="mini-head">
        <span className="mini-title">
          {monthNames(settings.locale, "long")[m - 1]} {y}
        </span>
        <span className="mini-actions">
          <button
            type="button"
            className="icon-btn"
            title={t("nav.backToToday")}
            onClick={() => goTo(today)}
          >
            <Undo2 size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title={t("nav.prev")}
            onClick={() => setShown(addMonths(shown, -1))}
          >
            <ChevronUp size={15} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title={t("nav.next")}
            onClick={() => setShown(addMonths(shown, 1))}
          >
            <ChevronDown size={15} />
          </button>
        </span>
      </div>
      <div className="mini-grid">
        {order.map((name) => (
          <span key={name} className="mini-dow">
            {name.slice(0, 2)}
          </span>
        ))}
        {weeks.flatMap((w) =>
          Array.from({ length: 7 }, (_, i) => {
            const day = w + i;
            const inRange = day >= visFrom && day <= visTo;
            const prevIn = i > 0 && day - 1 >= visFrom && day - 1 <= visTo;
            const nextIn = i < 6 && day + 1 >= visFrom && day + 1 <= visTo;
            const other = day < shown || day > monthEnd;
            return (
              <button
                type="button"
                key={day}
                className={`mini-day ${inRange ? "in" : ""} ${inRange && !prevIn ? "in-start" : ""} ${inRange && !nextIn ? "in-end" : ""} ${other ? "other" : ""} ${day === today ? "today" : ""}`}
                onClick={() => goTo(day)}
              >
                {civilFromDays(day).d}
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}
