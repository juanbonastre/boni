import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { AI_LEVELS, type AiLevel, type MailView, type Visibility } from "../core/agent.ts";
import { host, type Theme } from "../host.ts";
import type { Lang } from "../i18n.ts";
import {
  changeVisibility,
  checkMail,
  configured,
  forgetMail,
  loadMail,
  loadVisibility,
  login,
  logout,
  openSettings,
  saveMail,
  saveSettings,
  suggestedDevice,
  toast,
  useStore,
} from "../store.ts";

/** Settings (Boni Calendar's modal): account, appearance and, on the desktop, the tray and the widgets. */
export function SettingsModal() {
  const t = useStore((s) => s.t);
  const settings = useStore((s) => s.settings);
  const close = () => openSettings(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
          <h3>{t("settings.account")}</h3>
          <Account />

          {configured(settings) && <AiVisibility />}

          {configured(settings) && <MailSettings />}

          {host.saveExport && configured(settings) && <ExportData />}

          <h3>{t("settings.appearance")}</h3>
          <div className="setting">
            <div className="setting-label">{t("settings.theme")}</div>
            <div className="setting-control">
              <div className="segmented">
                {(["dark", "light", "system"] as Theme[]).map((th) => (
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
                  <span className="muted small">
                    {settings.layerAvailable
                      ? t("settings.widgetsHelp")
                      : t("settings.layerMissing")}
                  </span>
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

/**
 * The account, as Boni Calendar's "Data → Server": logged in ("Logged in as juan · portatil", live or not, Log out),
 * or the login form (address, user, password, this device's name). An old device token works, but asks to log in.
 */
function Account() {
  const t = useStore((s) => s.t);
  const settings = useStore((s) => s.settings);
  const loggedIn = configured(settings) && Boolean(settings.user) && !settings.sessionEnded;
  const [form, setForm] = useState({
    serverUrl: settings.serverUrl,
    user: settings.user,
    password: "",
    device: settings.device,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loggedIn || form.device) return;
    void suggestedDevice().then((device) => setForm((f) => (f.device ? f : { ...f, device })));
  }, [loggedIn]);

  if (loggedIn) {
    return (
      <div className="setting">
        <div className="setting-label">
          <span>{t("account.as", { user: settings.user, device: settings.device })}</span>
          <span className="muted small">
            {settings.serverUrl}
            {host.desktop ? ` · ${settings.live ? t("account.live") : t("account.notLive")}` : ""}
          </span>
        </div>
        <div className="setting-control">
          <button type="button" className="btn" onClick={() => void logout()}>
            {t("account.logout")}
          </button>
        </div>
      </div>
    );
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await login(form);
    setBusy(false);
    if (r.ok) {
      setForm((f) => ({ ...f, password: "" }));
      toast(t("account.welcome", { user: r.settings.user }));
    } else setError(t(`account.error.${r.code}`));
  };
  return (
    <form
      className="server-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {(settings.legacyToken || settings.sessionEnded) && (
        <p className="notice">
          {settings.sessionEnded ? t("account.endedHelp") : t("account.legacyHelp")}
        </p>
      )}
      <label className="field">
        <span className="field-label">{t("settings.url")}</span>
        <input
          className="input"
          value={form.serverUrl}
          placeholder="https://boni.example.ts.net"
          autoComplete="url"
          onChange={set("serverUrl")}
        />
      </label>
      <div className="field-pair">
        <label className="field">
          <span className="field-label">{t("account.user")}</span>
          <input
            className="input"
            value={form.user}
            autoComplete="username"
            onChange={set("user")}
          />
        </label>
        <label className="field">
          <span className="field-label">{t("account.password")}</span>
          <input
            className="input"
            type="password"
            value={form.password}
            autoComplete="current-password"
            onChange={set("password")}
          />
        </label>
      </div>
      <label className="field">
        <span className="field-label">{t("account.device")}</span>
        <input className="input" value={form.device} onChange={set("device")} />
        <span className="field-help">{t("account.deviceHelp")}</span>
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button
          type="submit"
          className="btn primary"
          disabled={
            busy ||
            !form.serverUrl.trim() ||
            !form.user.trim() ||
            !form.password ||
            !form.device.trim()
          }
        >
          {busy ? t("account.loggingIn") : t("account.login")}
        </button>
      </div>
    </form>
  );
}

/** "Tus datos": everything of the account in one zip of open formats, in one click. */
function ExportData() {
  const t = useStore((s) => s.t);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = (await host.saveExport?.()) ?? "error";
      toast(t(`export.${r}`));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h3>{t("export.title")}</h3>
      <div className="setting">
        <div className="setting-label">
          <span>{t("export.label")}</span>
          <span className="muted small">{t("export.help")}</span>
        </div>
        <div className="setting-control">
          <button type="button" className="btn" disabled={busy} onClick={() => void run()}>
            {busy ? t("export.busy") : t("export.button")}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * "Lo que ve la IA": per collection, what the models may see (docs/nucleo.md 7.3). Juan's choice only:
 * the agent has no tool for it, and the server takes it from a personal device only.
 */
function AiVisibility() {
  const t = useStore((s) => s.t);
  const [types, setTypes] = useState<Visibility[] | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadVisibility().then((v) => live && setTypes(v));
    return () => {
      live = false;
    };
  }, []);
  const choose = async (id: string, level: AiLevel) => {
    const before = types;
    setTypes((ts) => ts?.map((x) => (x.id === id ? { ...x, level } : x)) ?? ts);
    if (!(await changeVisibility(id, level))) setTypes(before);
  };
  return (
    <>
      <h3>{t("ai.title")}</h3>
      <p className="muted small setting-note">{t("ai.help")}</p>
      {types === undefined ? null : types === null ? (
        <p className="muted small setting-note">{t("ai.off")}</p>
      ) : (
        types.map((v) => (
          <div className="setting" key={v.id}>
            <div className="setting-label">
              <span>{v.name}</span>
              <span className="muted small">{t("ai.count", { n: v.count })}</span>
            </div>
            <div className="setting-control">
              <div className="segmented" role="radiogroup" aria-label={v.name}>
                {AI_LEVELS.map((l) => (
                  <button
                    key={l}
                    type="button"
                    role="radio"
                    aria-checked={v.level === l}
                    className={v.level === l ? "on" : ""}
                    title={t(`ai.level.${l}.help`)}
                    onClick={() => v.level !== l && void choose(v.id, l)}
                  >
                    {t(`ai.level.${l}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))
      )}
    </>
  );
}

/**
 * "Correo": the account's mailbox (docs/nucleo.md, mail as a source). Boni reads it, read-only, every few
 * minutes; each new mail lands in "Correos" as outside text and the tasks it asks become proposals in the
 * inbox, into one of the collections marked here (the AI picks which). The password is sent once and never
 * comes back; the server tries the connection before it keeps anything.
 */
function MailSettings() {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const [mail, setMail] = useState<MailView | null | undefined>(undefined);
  const [types, setTypes] = useState<Visibility[] | null>(null);
  const [form, setForm] = useState({
    host: "imap.gmail.com",
    user: "",
    password: "",
    folder: "INBOX",
  });
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void loadMail().then((m) => live && setMail(m));
    void loadVisibility().then((v) => live && setTypes(v));
    return () => {
      live = false;
    };
  }, []);
  if (mail === undefined) return null;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await saveMail({
      host: form.host.trim(),
      user: form.user.trim(),
      folder: form.folder.trim() || "INBOX",
      ...(form.password ? { password: form.password } : {}),
    });
    setBusy(false);
    if ("error" in r) return setError(t(`mail.error.${r.error}`));
    setMail(r);
    setEditing(false);
    setForm((f) => ({ ...f, password: "" }));
    toast(t("mail.connected"));
  };
  const toggle = async (id: string, on: boolean) => {
    if (!mail) return;
    const collections = on ? [...mail.collections, id] : mail.collections.filter((c) => c !== id);
    setMail({ ...mail, collections });
    const r = await saveMail({ collections });
    if ("error" in r) {
      setMail(mail);
      toast(t(`mail.error.${r.error}`));
    } else setMail(r);
  };
  const when = (ms: number) =>
    new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "es-ES", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(ms);
  return (
    <>
      <h3>{t("mail.title")}</h3>
      <p className="muted small setting-note">{t("mail.help")}</p>
      {mail && !editing ? (
        <>
          <div className="setting">
            <div className="setting-label">
              <span>{t("mail.connectedAs", { user: mail.user })}</span>
              <span className="muted small">
                {mail.state.lastError
                  ? t(`mail.error.${mail.state.lastError}`)
                  : mail.state.lastCheck
                    ? t("mail.state", { when: when(mail.state.lastCheck), n: mail.state.count })
                    : t("mail.never")}
              </span>
            </div>
            <div className="setting-control">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const m = await checkMail();
                  setBusy(false);
                  if (m) setMail(m);
                }}
              >
                {busy ? t("mail.checking") : t("mail.check")}
              </button>
            </div>
          </div>
          <p className="muted small setting-note">{t("mail.collections")}</p>
          {(types ?? [])
            .filter((v) => v.level !== "hidden" && v.id !== mail.state.type)
            .map((v) => (
              <div className="setting" key={v.id}>
                <div className="setting-label">{v.name}</div>
                <div className="setting-control">
                  <input
                    type="checkbox"
                    className="switch"
                    aria-label={v.name}
                    checked={mail.collections.includes(v.id)}
                    onChange={(e) => void toggle(v.id, e.target.checked)}
                  />
                </div>
              </div>
            ))}
          <div className="modal-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setForm((f) => ({ ...f, host: mail.host, user: mail.user, folder: mail.folder }));
                setEditing(true);
              }}
            >
              {t("mail.change")}
            </button>
            <button
              type="button"
              className="btn"
              onClick={async () => {
                if (await forgetMail()) setMail(null);
              }}
            >
              {t("mail.forget")}
            </button>
          </div>
        </>
      ) : (
        <form
          className="server-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="field-pair">
            <label className="field">
              <span className="field-label">{t("mail.server")}</span>
              <input className="input" value={form.host} onChange={set("host")} />
            </label>
            <label className="field">
              <span className="field-label">{t("mail.folder")}</span>
              <input className="input" value={form.folder} onChange={set("folder")} />
            </label>
          </div>
          <div className="field-pair">
            <label className="field">
              <span className="field-label">{t("mail.user")}</span>
              <input
                className="input"
                value={form.user}
                autoComplete="off"
                placeholder="nombre@example.com"
                onChange={set("user")}
              />
            </label>
            <label className="field">
              <span className="field-label">{t("mail.password")}</span>
              <input
                className="input"
                type="password"
                value={form.password}
                autoComplete="new-password"
                onChange={set("password")}
              />
            </label>
          </div>
          <span className="field-help">{t("mail.passwordHelp")}</span>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            {mail && (
              <button type="button" className="btn" onClick={() => setEditing(false)}>
                {t("mail.cancel")}
              </button>
            )}
            <button
              type="submit"
              className="btn primary"
              disabled={busy || !form.host.trim() || !form.user.trim() || (!mail && !form.password)}
            >
              {busy ? t("mail.connecting") : t("mail.connect")}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
