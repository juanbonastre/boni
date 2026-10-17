import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { host, type Theme } from "../host.ts";
import type { Lang } from "../i18n.ts";
import { openSettings, saveSettings, toast, useStore } from "../store.ts";

/** Settings (calendar-style modal): server, appearance and, on the desktop, the tray and the widgets. */
export function SettingsModal() {
  const t = useStore((s) => s.t);
  const settings = useStore((s) => s.settings);
  const [url, setUrl] = useState(settings.serverUrl);
  const [token, setToken] = useState("");
  const close = () => openSettings(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const saveServer = async () => {
    await saveSettings({ serverUrl: url.trim(), ...(token.trim() ? { token: token.trim() } : {}) });
    setToken("");
    toast(t("settings.saved"));
  };
  const serverChanged = url.trim() !== settings.serverUrl || token.trim() !== "";

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t("settings.title")}>
        <div className="modal-head">
          <h2>{t("settings.title")}</h2>
          <button
            type="button"
            className="icon-btn"
            onClick={close}
            title={t("settings.close")}
            aria-label={t("settings.close")}
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>
        <div className="modal-body">
          <h3>{t("settings.server")}</h3>
          <form
            className="server-form"
            onSubmit={(e) => {
              e.preventDefault();
              void saveServer();
            }}
          >
            <label className="field">
              <span className="field-label">{t("settings.url")}</span>
              <input
                className="input"
                value={url}
                placeholder="https://boni.example.ts.net"
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">{t("settings.token")}</span>
              <input
                className="input"
                type="password"
                autoComplete="off"
                value={token}
                placeholder={settings.hasToken ? t("settings.tokenKept") : ""}
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
            <p className="field-help">{t("settings.tokenHelp")}</p>
            <div className="modal-actions">
              <button
                type="submit"
                className="btn primary"
                disabled={!url.trim() || (!settings.hasToken && !token.trim()) || !serverChanged}
              >
                {t("settings.save")}
              </button>
            </div>
          </form>

          <h3>{t("settings.appearance")}</h3>
          <div className="setting">
            <div className="setting-label">{t("settings.theme")}</div>
            <div className="setting-control">
              <div className="segmented">
                {(["system", "dark", "light"] as Theme[]).map((th) => (
                  <button
                    key={th}
                    type="button"
                    className={settings.theme === th ? "on" : ""}
                    onClick={() => void saveSettings({ theme: th })}
                  >
                    {t(`settings.theme.${th}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="setting">
            <div className="setting-label">{t("settings.language")}</div>
            <div className="setting-control">
              <div className="segmented">
                {(
                  [
                    ["es", "Español"],
                    ["en", "English"],
                  ] as [Lang, string][]
                ).map(([l, label]) => (
                  <button
                    key={l}
                    type="button"
                    className={settings.language === l ? "on" : ""}
                    onClick={() => void saveSettings({ language: l })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {host.desktop && (
            <>
              <h3>{t("settings.desktop")}</h3>
              <div className="setting">
                <div className="setting-label">
                  <span>{t("settings.autostart")}</span>
                  <span className="muted small">{t("settings.autostartHelp")}</span>
                </div>
                <div className="setting-control">
                  <input
                    type="checkbox"
                    className="switch"
                    aria-label={t("settings.autostart")}
                    checked={settings.autostart}
                    onChange={(e) => void saveSettings({ autostart: e.target.checked })}
                  />
                </div>
              </div>
              <div className="setting">
                <div className="setting-label">
                  <span>{t("settings.showWidgets")}</span>
                  {!settings.layerAvailable && (
                    <span className="muted small">{t("settings.layerMissing")}</span>
                  )}
                </div>
                <div className="setting-control">
                  <input
                    type="checkbox"
                    className="switch"
                    aria-label={t("settings.showWidgets")}
                    checked={settings.showWidgets}
                    onChange={(e) => void saveSettings({ showWidgets: e.target.checked })}
                  />
                </div>
              </div>
              <div className="setting">
                <div className="setting-label">{t("settings.resetWidgets")}</div>
                <div className="setting-control">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void saveSettings({ showWidgets: true, resetWidgets: true })}
                  >
                    {t("settings.reset")}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
