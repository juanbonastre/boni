/** Settings → Desktop (the desktop app only): keep running in the tray, open at login and Boni's address. */
import { type ReactNode, useEffect, useState } from "react";
import { type DesktopPrefs, getHost } from "../host.ts";
import { t } from "../i18n.ts";
import { useApp } from "../store.ts";

function Row({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="setting-label">
        <span>{label}</span>
        <small className="muted">{hint}</small>
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function YesNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      {[false, true].map((v) => (
        <button
          type="button"
          key={String(v)}
          role="radio"
          aria-checked={value === v}
          className={value === v ? "on" : ""}
          onClick={() => onChange(v)}
        >
          {v ? (useApp.getState().settings.locale === "es" ? "Sí" : "Yes") : "No"}
        </button>
      ))}
    </div>
  );
}

/** Boni's address, where the notes a double click opens come from (empty: Boni's desktop app shows them). */
function BoniUrl({
  value,
  onSave,
}: {
  value: string;
  onSave: (patch: Partial<DesktopPrefs>) => Promise<boolean>;
}) {
  const [text, setText] = useState(value);
  const [bad, setBad] = useState(false);
  const save = async () => {
    if (text.trim() === value) return;
    setBad(!(await onSave({ boniUrl: text.trim() })));
  };
  return (
    <Row
      label={t("desktop.boniUrl")}
      hint={bad ? t("desktop.boniUrlBad") : t("desktop.boniUrlHint")}
    >
      <input
        className="field-input"
        aria-invalid={bad}
        value={text}
        placeholder="https://boni.example.ts.net"
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </Row>
  );
}

/** Settings → Desktop (the desktop app only): keep running in the tray, open at login, Boni's address. */
export function DesktopSettings() {
  const desktop = getHost().desktop;
  const [prefs, setPrefs] = useState<DesktopPrefs | null>(null);
  useEffect(() => {
    void desktop?.getPrefs().then(setPrefs);
  }, [desktop]);
  if (!desktop || !prefs) return null;
  const change = async (patch: Partial<DesktopPrefs>) => {
    const r = await desktop.setPrefs(patch);
    if (r.ok) setPrefs(r.value);
    return r.ok;
  };
  return (
    <div className="desktop-settings">
      <h3>{t("settings.desktop")}</h3>
      <Row label={t("desktop.background")} hint={t("desktop.backgroundHint")}>
        <YesNo value={prefs.background} onChange={(v) => void change({ background: v })} />
      </Row>
      <Row label={t("desktop.autostart")} hint={t("desktop.autostartHint")}>
        <YesNo value={prefs.autostart} onChange={(v) => void change({ autostart: v })} />
      </Row>
      <BoniUrl value={prefs.boniUrl ?? ""} onSave={change} />
    </div>
  );
}
