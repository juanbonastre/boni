import { PALETTE } from "@boni-calendar/core";
import { Pencil, RefreshCw, Trash2 } from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import type { ExternalCal, ExternalStatus } from "../external.ts";
import { t } from "../i18n.ts";
import { useApp } from "../store.ts";
import { NetworkHint } from "./NetworkHint.tsx";

const COLORS = Object.values(PALETTE);

function Row({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="setting">
      <div className="setting-label">
        <span>{label}</span>
        {hint && <small className="muted">{hint}</small>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function statusText(st: ExternalStatus | undefined, locale: string, tz: string): string {
  if (!st) return t("external.never");
  if (st.state === "loading" && st.at === undefined) return t("external.loading");
  const parts: string[] = [];
  if (st.at !== undefined) {
    const when = new Intl.DateTimeFormat(locale, {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: tz,
    }).format(st.at);
    parts.push(t("external.ok", { n: st.events ?? 0, when }));
  }
  if (st.state === "loading") parts.push(t("external.loading"));
  if (st.state === "error")
    parts.push(
      t("external.error", {
        message: st.message === "not-ical" ? t("external.notIcal") : (st.message ?? ""),
      }),
    );
  if (st.unsupported) parts.push(t("external.unsupported", { n: st.unsupported }));
  return parts.join(" · ");
}

/** Adding or editing one external calendar: name, iCal address, colour. */
function ExternalForm({ initial, onDone }: { initial?: ExternalCal; onDone: () => void }) {
  const externals = useApp((s) => s.settings.externals);
  const used = externals.map((c) => c.color);
  const [name, setName] = useState(initial?.name ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [color, setColor] = useState(
    initial?.color ?? COLORS.find((c) => !used.includes(c)) ?? COLORS[0] ?? "#60a5fa",
  );
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);
  const address = url.trim().replace(/^webcal:\/\//i, "https://");
  const valid = name.trim() !== "" && /^https?:\/\/\S+$/i.test(address);
  const save = () => {
    if (!valid) return;
    const app = useApp.getState();
    if (initial) app.updateExternal(initial.id, { name: name.trim(), url: address, color });
    else app.addExternal({ name: name.trim(), url: address, color });
    onDone();
  };
  return (
    <div className="ext-form">
      <Row label={t("external.name")}>
        <input
          ref={nameRef}
          className="field-input"
          value={name}
          placeholder={t("external.namePlaceholder")}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
      </Row>
      <Row label={t("external.url")} hint={t("external.urlHint")}>
        <input
          className="field-input"
          value={url}
          placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
      </Row>
      <Row label={t("external.color")}>
        <div className="swatches">
          {COLORS.map((c) => (
            <button
              type="button"
              key={c}
              aria-label={c}
              className={`swatch pick ${c === color ? "on" : ""}`}
              style={{ "--c": c } as CSSProperties}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </Row>
      <div className="ext-actions">
        <button type="button" className="btn" onClick={onDone}>
          {t("external.cancel")}
        </button>
        <button type="button" className="btn primary" disabled={!valid} onClick={save}>
          {initial ? t("external.save") : t("external.add")}
        </button>
      </div>
    </div>
  );
}

/**
 * Settings → External calendars: subscriptions by iCal address (Google Calendar...), read-only.
 * The address stays on this device.
 */
export function ExternalSettings() {
  const externals = useApp((s) => s.settings.externals);
  const status = useApp((s) => s.external.status);
  const locale = useApp((s) => s.settings.locale);
  const tz = useApp((s) => s.settings.tz);
  const focus = useApp((s) => s.settingsFocus);
  const [editing, setEditing] = useState<string | null>(focus === "external" ? "new" : null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus !== "external") return;
    ref.current?.scrollIntoView({ block: "start" });
    useApp.getState().set({ settingsFocus: null });
  }, [focus]);
  const app = useApp.getState();
  return (
    <div ref={ref} className="ext-settings">
      <h3>{t("settings.external")}</h3>
      <p className="muted small ext-hint">{t("external.hint")}</p>
      {externals.length > 0 && <NetworkHint />}
      {externals.map((c) =>
        editing === c.id ? (
          <ExternalForm key={c.id} initial={c} onDone={() => setEditing(null)} />
        ) : (
          <Row
            key={c.id}
            label={
              <span className="ext-name">
                <span className="swatch" style={{ "--c": c.color } as CSSProperties} />
                <span>{c.name}</span>
              </span>
            }
            hint={statusText(status[c.id], locale, tz)}
          >
            <button
              type="button"
              className="icon-btn"
              title={t("external.refresh")}
              onClick={() => void app.loadExternal(c.id)}
            >
              <RefreshCw size={14} />
            </button>
            <button
              type="button"
              className="icon-btn"
              title={t("external.edit")}
              onClick={() => setEditing(c.id)}
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              className="icon-btn"
              title={t("external.remove")}
              onClick={() => app.removeExternal(c.id)}
            >
              <Trash2 size={14} />
            </button>
          </Row>
        ),
      )}
      {editing === "new" ? (
        <ExternalForm onDone={() => setEditing(null)} />
      ) : (
        <button type="button" className="btn add" onClick={() => setEditing("new")}>
          {t("external.addCalendar")}
        </button>
      )}
    </div>
  );
}
