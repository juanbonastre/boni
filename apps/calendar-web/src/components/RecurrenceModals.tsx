import { civilFromDays, monthNames, type Recurrence, weekdayNames } from "@boni/calendar";
import { useEffect, useState } from "react";
import { onKeys } from "../host.ts";
import { t } from "../i18n.ts";
import { useApp } from "../store.ts";
import { DateField } from "./fields.tsx";

function useEscape(onClose: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    return onKeys(key, true);
  }, [onClose, active]);
}

/** "This event / this and following / all" for edits and deletions inside a series. */
export function ScopeModal() {
  const prompt = useApp((s) => s.scopePrompt);
  const cancel = () => prompt?.onCancel();
  useEscape(cancel, prompt !== null);
  if (!prompt) return null;
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <div
        className="modal scope"
        role="dialog"
        aria-label={t(prompt.kind === "delete" ? "scope.deleteTitle" : "scope.editTitle")}
      >
        <div className="modal-head">
          <h2>{t(prompt.kind === "delete" ? "scope.deleteTitle" : "scope.editTitle")}</h2>
        </div>
        <div className="modal-body">
          <p className="muted">{t("scope.hint")}</p>
          {prompt.notes && prompt.kind === "delete" && (
            <p className="muted">{t("scope.keepPast")}</p>
          )}
          <div className="scope-options">
            <button type="button" className="btn" onClick={() => prompt.onChoose("this")}>
              {t("scope.this")}
            </button>
            <button type="button" className="btn" onClick={() => prompt.onChoose("following")}>
              {t("scope.following")}
            </button>
            <button type="button" className="btn" onClick={() => prompt.onChoose("all")}>
              {t("scope.all")}
            </button>
            <button type="button" className="btn ghost" onClick={cancel}>
              {t("scope.cancel")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const toIso = (day: number) => {
  const { y, m, d } = civilFromDays(day);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};
const fromIso = (s: string): number | null => {
  const [y, m, d] = s.split("-").map(Number);
  return y && m && d ? Math.floor(Date.UTC(y, m - 1, d) / 86_400_000) : null;
};

const dayLabel = (day: number, locale: "es" | "en") => {
  const { y, m, d } = civilFromDays(day);
  return `${d} ${monthNames(locale, "short")[m - 1]} ${y}`;
};

type End = "never" | "date" | "count";

export function RecurrenceModal({
  initial,
  startDay,
  onSave,
  onClose,
}: {
  initial: Recurrence | null;
  startDay: number;
  onSave: (r: Recurrence) => void;
  onClose: () => void;
}) {
  useEscape(onClose);
  const locale = useApp((s) => s.settings.locale);
  const first = useApp((s) => s.settings.firstDay);
  const [freq, setFreq] = useState<Recurrence["freq"]>(initial?.freq ?? "weekly");
  const [interval, setInterval_] = useState(initial?.interval ?? 1);
  const startWd = (((startDay + 4) % 7) + 7) % 7;
  const [days, setDays] = useState<number[]>(
    initial?.byWeekday?.length ? initial.byWeekday : [startWd],
  );
  const [end, setEnd] = useState<End>(
    initial?.until != null ? "date" : initial?.count != null ? "count" : "never",
  );
  const [until, setUntil] = useState(initial?.until ?? startDay + 90);
  const [count, setCount] = useState(initial?.count ?? 10);
  const names = weekdayNames(locale, "short");
  const order = Array.from({ length: 7 }, (_, i) => (first + i) % 7);

  const save = () => {
    const rule: Recurrence = { freq, interval: Math.max(1, Math.floor(interval) || 1) };
    if (freq === "weekly") rule.byWeekday = days.length ? [...days].sort() : [startWd];
    if (end === "date") rule.until = Math.max(until, startDay);
    if (end === "count") rule.count = Math.max(1, Math.floor(count) || 1);
    onSave(rule);
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={t("rec.customTitle")}>
        <div className="modal-head">
          <h2>{t("rec.customTitle")}</h2>
        </div>
        <div className="modal-body">
          <div className="setting">
            <span>{t("rec.every")}</span>
            <span className="rec-inline">
              <input
                type="number"
                min={1}
                max={99}
                className="field-input num"
                value={interval}
                onChange={(e) => setInterval_(Number(e.target.value))}
              />
              <select
                className="select"
                value={freq}
                onChange={(e) => setFreq(e.target.value as Recurrence["freq"])}
              >
                {(["daily", "weekly", "monthly", "yearly"] as const).map((f) => (
                  <option key={f} value={f}>
                    {t(`rec.unit.${f}` as "rec.unit.daily")}
                  </option>
                ))}
              </select>
            </span>
          </div>
          {freq === "weekly" && (
            <div className="setting">
              <span>{t("rec.onDays")}</span>
              <span className="weekday-pick">
                {order.map((d) => (
                  <button
                    type="button"
                    key={d}
                    className={days.includes(d) ? "on" : ""}
                    aria-pressed={days.includes(d)}
                    onClick={() =>
                      setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))
                    }
                  >
                    {names[d]?.slice(0, 2)}
                  </button>
                ))}
              </span>
            </div>
          )}
          <div className="setting">
            <span>{t("rec.ends")}</span>
            <span className="rec-ends">
              <label>
                <input
                  type="radio"
                  name="end"
                  checked={end === "never"}
                  onChange={() => setEnd("never")}
                />{" "}
                {t("rec.never")}
              </label>
              <label>
                <input
                  type="radio"
                  name="end"
                  checked={end === "date"}
                  onChange={() => setEnd("date")}
                />{" "}
                {t("rec.onDate")}
                <DateField
                  className={end === "date" ? "" : "disabled"}
                  label={dayLabel(until, locale)}
                  iso={toIso(until)}
                  min={toIso(startDay)}
                  onChange={(iso) => {
                    const d = fromIso(iso);
                    if (d !== null) {
                      setUntil(d);
                      setEnd("date");
                    }
                  }}
                />
              </label>
              <label>
                <input
                  type="radio"
                  name="end"
                  checked={end === "count"}
                  onChange={() => setEnd("count")}
                />{" "}
                {t("rec.after")}
                <input
                  type="number"
                  min={1}
                  className="field-input num"
                  disabled={end !== "count"}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                />
                {t("rec.times")}
              </label>
            </span>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={onClose}>
              {t("rec.cancel")}
            </button>
            <button type="button" className="btn primary" onClick={save}>
              {t("rec.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
